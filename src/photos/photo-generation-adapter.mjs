import {
  PHOTO_STATUSES,
  assetReference,
  isEconomicFactKey,
  isRecordValue,
  resolvePhotoQualityPolicy,
} from './photo-contract.mjs';
import { buildPhotoPrompt } from './photo-prompt.mjs';
import { validatePhotoProductionPlan } from './photo-production-plan.mjs';
import { validatePhotoPromptContract } from './photo-policy.mjs';

const GENERATION_OPTIONS = new Set(['generator', 'policy', 'sourceFacts', 'usedPoseContext']);
const ARTIFACT_KEYS = new Set([
  'productKey',
  'photoIndex',
  'role',
  'asset',
  'claimsUsed',
  'sourceImageRefs',
  'text',
  'hash',
  'providerArtifactId',
  'message',
  'composition',
  'productPosition',
  'fidelity',
]);
const ASSET_KEYS = new Set(['path', 'url', 'reference', 'width', 'height', 'format']);
const CLAIM_KEYS = new Set(['field', 'value']);
const FIDELITY_KEYS = new Set(['brandChanged', 'colorChanged', 'modelChanged', 'productChanged']);

function assertRecord(value, label) {
  if (!isRecordValue(value)) throw new TypeError(`${label} must be an object`);
}

function clone(value) {
  return structuredClone(value);
}

function normalizePoseContext(value) {
  if (!Array.isArray(value)) throw new TypeError('usedPoseContext must be an array');
  return value.map((pose, index) => {
    if (!isRecordValue(pose)
      || !Number.isSafeInteger(pose.photoIndex)
      || typeof pose.role !== 'string'
      || typeof pose.compositionIntent !== 'string'
      || typeof pose.productOrientation !== 'string'
      || typeof pose.cameraViewpoint !== 'string'
      || typeof pose.positionKey !== 'string') {
      throw new TypeError(`usedPoseContext[${index}] is invalid`);
    }
    return {
      photoIndex: pose.photoIndex,
      role: pose.role,
      compositionIntent: pose.compositionIntent,
      productOrientation: pose.productOrientation,
      cameraViewpoint: pose.cameraViewpoint,
      positionKey: pose.positionKey,
    };
  });
}

function responseError(message, details = undefined, cause = undefined) {
  return new PhotoGenerationError(message, 'PHOTO_GENERATOR_RESPONSE_INVALID', details, cause);
}

function validateOptions(options) {
  assertRecord(options, 'photo generation options');
  for (const key of Object.keys(options)) {
    if (!GENERATION_OPTIONS.has(key)) throw new TypeError(`Unsupported photo generation option: ${key}`);
  }
  if (typeof options.generator !== 'function') throw new TypeError('photo generation options.generator must be a function');
  return {
    policy: resolvePhotoQualityPolicy(options.policy ?? {}),
    usedPoseContext: options.usedPoseContext === undefined ? undefined : normalizePoseContext(options.usedPoseContext),
  };
}

function parseText(value) {
  if (!Array.isArray(value)) throw responseError('Generated photo text must be an array');
  return value.map((item, index) => {
    assertRecord(item, `generated photo text[${index}]`);
    for (const key of Object.keys(item)) if (!['kind', 'language', 'value'].includes(key)) throw responseError(`Unknown generated photo text field: ${key}`);
    if (typeof item.kind !== 'string' || !item.kind.trim() || typeof item.language !== 'string' || !item.language.trim() || typeof item.value !== 'string' || !item.value.trim()) {
      throw responseError(`Generated photo text[${index}] must contain kind, language, and value strings`);
    }
    return { kind: item.kind, language: item.language, value: item.value };
  });
}

function parseAsset(value, policy) {
  assertRecord(value, 'generated photo asset');
  for (const key of Object.keys(value)) if (!ASSET_KEYS.has(key)) throw responseError(`Unknown generated photo asset field: ${key}`);
  const reference = assetReference(value);
  if (!reference) throw responseError('Generated photo asset must contain path, url, or reference');
  if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)) throw responseError('Generated photo asset must contain integer width and height');
  if (value.format !== undefined && (typeof value.format !== 'string' || !policy.allowedFormats.includes(value.format.toLowerCase()))) {
    throw responseError('Generated photo asset has an unsupported format');
  }
  const asset = {
    ...(value.path !== undefined ? { path: value.path } : {}),
    ...(value.url !== undefined ? { url: value.url } : {}),
    ...(value.reference !== undefined ? { reference: value.reference } : {}),
    width: value.width,
    height: value.height,
  };
  if (value.format !== undefined) asset.format = value.format.toLowerCase();
  return asset;
}

function parseClaims(value) {
  if (!Array.isArray(value)) throw responseError('Generated photo claimsUsed must be an array');
  return value.map((claim, index) => {
    assertRecord(claim, `generated photo claimsUsed[${index}]`);
    for (const key of Object.keys(claim)) if (!CLAIM_KEYS.has(key)) throw responseError(`Unknown generated photo claim field: ${key}`);
    if (typeof claim.field !== 'string' || !claim.field.trim() || typeof claim.value !== 'string' || !claim.value.trim()) throw responseError('Generated photo claimsUsed requires field and value strings');
    if (isEconomicFactKey(claim.field)) throw responseError('Generated photo claimsUsed cannot contain economic metadata');
    return { field: claim.field, value: claim.value };
  });
}

function parseFidelity(value) {
  if (value === undefined) return undefined;
  assertRecord(value, 'generated photo fidelity');
  for (const key of Object.keys(value)) if (!FIDELITY_KEYS.has(key)) throw responseError(`Unknown generated photo fidelity field: ${key}`);
  for (const key of Object.keys(value)) if (typeof value[key] !== 'boolean') throw responseError(`generated photo fidelity.${key} must be boolean`);
  return { ...value };
}

function parseResponse(raw, planPhoto, policy) {
  try {
    if (!isRecordValue(raw)) throw responseError('Photo generator response must be an object');
    for (const key of Object.keys(raw)) if (!ARTIFACT_KEYS.has(key)) throw responseError(`Unknown generated photo artifact field: ${key}`);
    if (raw.productKey !== planPhoto.productKey) throw responseError('Generated photo productKey does not match the plan');
    if (raw.photoIndex !== planPhoto.index) throw responseError('Generated photo photoIndex does not match the plan');
    if (raw.role !== planPhoto.role) throw responseError('Generated photo role does not match the plan');
    if (!Object.prototype.hasOwnProperty.call(raw, 'claimsUsed')) throw responseError('Generated photo claimsUsed is required');
    const sourceImageRefs = raw.sourceImageRefs;
    if (!Array.isArray(sourceImageRefs) || sourceImageRefs.length === 0) throw responseError('Generated photo sourceImageRefs are required');
    const normalizedRefs = sourceImageRefs.map((ref, index) => {
      assertRecord(ref, `generated photo sourceImageRefs[${index}]`);
      const keys = Object.keys(ref);
      for (const key of keys) if (!['id', 'url', 'path', 'reference', 'role', 'provenance'].includes(key)) throw responseError(`Unknown generated source image field: ${key}`);
      const reference = ['url', 'path', 'reference'].find((key) => typeof ref[key] === 'string' && ref[key].trim());
      if (typeof ref.id !== 'string' || !ref.id.trim() || !reference) throw responseError('Generated photo sourceImageRefs contain an invalid reference');
      const normalized = { id: ref.id, reference: ref[reference] };
      if (ref.role !== undefined) normalized.role = ref.role;
      if (ref.provenance !== undefined) normalized.provenance = ref.provenance;
      return normalized;
    });
    const artifact = {
      productKey: raw.productKey,
      photoIndex: raw.photoIndex,
      role: raw.role,
      asset: parseAsset(raw.asset, policy),
      claimsUsed: parseClaims(raw.claimsUsed),
      sourceImageRefs: normalizedRefs,
    };
    if (raw.text !== undefined) artifact.text = parseText(raw.text);
    for (const key of ['hash', 'providerArtifactId', 'message']) {
      if (raw[key] !== undefined) {
        if (typeof raw[key] !== 'string' || !raw[key].trim()) throw responseError(`generated photo ${key} must be a non-empty string`);
        artifact[key] = raw[key];
      }
    }
    if (raw.composition !== undefined) {
      if (typeof raw.composition !== 'string' || !raw.composition.trim()) throw responseError('generated photo composition must be a non-empty string');
      artifact.composition = raw.composition;
    }
    if (raw.productPosition !== undefined) {
      if (typeof raw.productPosition !== 'string' || !raw.productPosition.trim()) throw responseError('generated photo productPosition must be a non-empty string');
      artifact.productPosition = raw.productPosition;
    }
    const fidelity = parseFidelity(raw.fidelity);
    if (fidelity !== undefined) artifact.fidelity = fidelity;
    return artifact;
  } catch (error) {
    if (error instanceof PhotoGenerationError) throw error;
    throw responseError(error.message, undefined, error);
  }
}

function requestFor(plan, photo, sourceFacts, usedPoseContext = undefined) {
  const promptOptions = {
    ...(sourceFacts === undefined ? {} : { sourceFacts }),
    ...(usedPoseContext === undefined ? {} : { usedPoseContext }),
  };
  validatePhotoPromptContract(photo, promptOptions);
  return {
    productKey: plan.productKey,
    photoIndex: photo.index,
    role: photo.role,
    objective: photo.objective,
    verifiedClaims: clone(photo.verifiedClaims),
    photoCopy: clone(photo.photoCopy),
    text: clone(photo.text),
    visualDirection: clone(photo.visualDirection),
    sourceImageRefs: clone(photo.sourceImageRefs),
    ...(usedPoseContext === undefined ? {} : { usedPoseContext: clone(usedPoseContext) }),
    preservationConstraints: clone(plan.preservationConstraints),
    fidelityVerification: plan.fidelityVerification,
    prompt: buildPhotoPrompt(photo, promptOptions),
  };
}

async function generateOne(plan, photo, generator, policy, sourceFacts, usedPoseContext = undefined) {
  const request = requestFor(plan, photo, sourceFacts, usedPoseContext);
  let raw;
  try {
    raw = await generator(request);
  } catch (error) {
    throw new PhotoGenerationError('Injected photo generator failed', 'PHOTO_GENERATOR_FAILURE', undefined, error);
  }
  return parseResponse(raw, { ...photo, productKey: plan.productKey }, policy);
}

function validateGenerationPlan(plan, policy, sourceFacts) {
  validatePhotoProductionPlan(plan, { policy });
  try {
    for (const photo of plan.photos) requestFor(plan, photo, sourceFacts);
  } catch (error) {
    throw new PhotoGenerationError('Photo prompt violates the central generation policy', 'PHOTO_PROMPT_POLICY_INVALID', undefined, error);
  }
}

/** Generate five metadata-bearing photo artifacts through an injected provider-neutral generator. */
export async function generateProductPhotos(plan, options = {}) {
  const { policy, usedPoseContext } = validateOptions(options);
  validateGenerationPlan(plan, policy, options.sourceFacts);
  if (plan.status !== PHOTO_STATUSES.READY) throw new PhotoGenerationError('Photo plan is not READY', 'PHOTO_PLAN_NOT_READY');
  const artifacts = [];
  for (const photo of plan.photos) artifacts.push(await generateOne(plan, photo, options.generator, policy, options.sourceFacts, usedPoseContext));
  return {
    status: PHOTO_STATUSES.READY,
    productKey: plan.productKey,
    version: plan.version,
    artifacts,
  };
}

export async function generatePlannedPhotoArtifacts(plan, photos, options = {}) {
  const { policy, usedPoseContext: configuredPoseContext } = validateOptions(options);
  validateGenerationPlan(plan, policy, options.sourceFacts);
  if (!Array.isArray(photos) || photos.length === 0) throw new TypeError('photos must be a non-empty array');
  const expected = new Set(plan.photos.map((photo) => photo.index));
  const selected = photos.map((photo) => {
    if (!isRecordValue(photo) || !expected.has(photo.index)) throw new TypeError('photos contains an unknown planned photo');
    return photo;
  });
  const selectedIndexes = new Set(selected.map((photo) => photo.index));
  const usedPoseContext = configuredPoseContext ?? plan.photos
    .filter((photo) => !selectedIndexes.has(photo.index))
    .map((photo) => ({
      photoIndex: photo.index,
      role: photo.role,
      compositionIntent: photo.visualDirection.compositionIntent,
      productOrientation: photo.visualDirection.productOrientation,
      cameraViewpoint: photo.visualDirection.cameraViewpoint,
      positionKey: photo.visualDirection.positionKey,
    }));
  return Promise.all(selected.map((photo) => generateOne(plan, photo, options.generator, policy, options.sourceFacts, usedPoseContext)));
}

export class PhotoGenerationError extends Error {
  constructor(message, code = 'PHOTO_GENERATION_ERROR', details = undefined, cause = undefined) {
    super(message, cause === undefined ? {} : { cause });
    this.name = 'PhotoGenerationError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
