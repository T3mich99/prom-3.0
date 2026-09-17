import {
  PHOTO_STATUSES,
  aggregatePhotoStatus,
  assetReference,
  isEconomicFactKey,
  isAcceptedPhotoDimensions,
  isRecordValue,
  resolvePhotoQualityPolicy,
  sameJson,
} from './photo-contract.mjs';
import { isModelFactKey } from './photo-policy.mjs';
import { generatePlannedPhotoArtifacts } from './photo-generation-adapter.mjs';
import { getSafePhotoClaims, validatePhotoProductionPlan } from './photo-production-plan.mjs';

const VISUAL_CHECK_KEYS = Object.freeze([
  'productIdentityPreserved',
  'noModelTransformation',
  'brandPreserved',
  'noVisibleModelText',
  'noFabricatedClaims',
  'noFabricatedSpecifications',
  'noUnsupportedAccessories',
  'compositionMatchesRole',
  'premiumCommercialQuality',
  'noDarkHalos',
  'noCheapMarketplaceAesthetic',
  'noObviousAiVisualDefects',
  'slotDistinct',
  'sceneDistinct',
  'layoutDistinct',
  'productSpecificDesign',
  'productPositionDistinct',
  'textDoesNotCoverProduct',
  'textReadable',
]);

const VISUAL_REASON_CODES = Object.freeze({
  productIdentityPreserved: 'VISUAL_PRODUCT_IDENTITY_FAILED',
  noModelTransformation: 'VISUAL_MODEL_TRANSFORMATION',
  brandPreserved: 'VISUAL_BRAND_NOT_PRESERVED',
  noVisibleModelText: 'VISUAL_MODEL_TEXT',
  noFabricatedClaims: 'VISUAL_UNVERIFIED_CLAIM',
  noFabricatedSpecifications: 'VISUAL_UNVERIFIED_SPECIFICATION',
  noUnsupportedAccessories: 'VISUAL_UNSUPPORTED_ACCESSORY',
  compositionMatchesRole: 'VISUAL_ROLE_MISMATCH',
  premiumCommercialQuality: 'VISUAL_PREMIUM_QUALITY_FAILED',
  noDarkHalos: 'VISUAL_DARK_HALO',
  noCheapMarketplaceAesthetic: 'VISUAL_CHEAP_AESTHETIC',
  noObviousAiVisualDefects: 'VISUAL_AI_DEFECT',
  slotDistinct: 'VISUAL_SLOT_DUPLICATE',
  sceneDistinct: 'VISUAL_SCENE_DUPLICATE',
  layoutDistinct: 'VISUAL_LAYOUT_DUPLICATE',
  productSpecificDesign: 'VISUAL_GENERIC_PRODUCT_TEMPLATE',
  productPositionDistinct: 'VISUAL_POSITION_DUPLICATE',
  textDoesNotCoverProduct: 'VISUAL_TEXT_COVERS_PRODUCT',
  textReadable: 'VISUAL_TEXT_UNREADABLE',
});

function assertRecord(value, label) {
  if (!isRecordValue(value)) throw new TypeError(`${label} must be an object`);
}

function clone(value) {
  return structuredClone(value);
}

function unique(values) {
  return [...new Set(values)];
}

function issue(code, severity, message) {
  return { code, severity, message };
}

function addIssue(report, value) {
  if (!report.issues.some((item) => item.code === value.code)) report.issues.push(value);
}

function normalizeRefs(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((ref, index) => {
    assertRecord(ref, `photo sourceImageRefs[${index}]`);
    const referenceKey = ['url', 'path', 'reference'].find((key) => typeof ref[key] === 'string' && ref[key].trim());
    if (typeof ref.id !== 'string' || !ref.id.trim() || !referenceKey) throw new TypeError(`photo sourceImageRefs[${index}] is invalid`);
    const normalized = { id: ref.id, reference: ref[referenceKey] };
    if (ref.role !== undefined) normalized.role = ref.role;
    if (ref.provenance !== undefined) normalized.provenance = ref.provenance;
    return normalized;
  });
}

function validateText(value, report, expected, policy, role, sourceFacts) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    addIssue(report, issue('PHOTO_TEXT_INVALID', 'rework', 'Structured generated text must be an array.'));
    return;
  }
  const modelValues = Object.entries(sourceFacts)
    .filter(([field]) => isModelFactKey(field))
    .map(([, value]) => String(value));
  for (const [index, item] of value.entries()) {
    if (!isRecordValue(item) || typeof item.kind !== 'string' || typeof item.language !== 'string' || typeof item.value !== 'string') {
      addIssue(report, issue('PHOTO_TEXT_INVALID', 'rework', `Structured generated text item ${index} is invalid.`));
      continue;
    }
    if (item.language !== 'uk') addIssue(report, issue('NON_UKRAINIAN_TEXT', 'rework', 'Returned structured selling text is not marked Ukrainian.'));
    if (!item.value.trim()) addIssue(report, issue('PHOTO_TEXT_INVALID', 'rework', `Structured generated text item ${index} is empty.`));
    if (item.value.length > policy.text.maxCharactersPerElement) addIssue(report, issue('TEXT_DENSITY_EXCEEDED', 'rework', 'A generated text element exceeds the configured length limit.'));
    if (modelValues.some((model) => model && item.value.includes(model))) addIssue(report, issue('PHOTO_MODEL_TEXT_FORBIDDEN', 'rework', 'Model identifiers must not appear in visible photo text.'));
  }
  if (value.length > policy.text.maxElementsByRole[role]) addIssue(report, issue('TEXT_DENSITY_EXCEEDED', 'rework', 'Generated text exceeds the configured role density limit.'));
  if (!sameJson(value, expected)) addIssue(report, issue('TEXT_NOT_APPROVED', 'rework', 'Returned structured text differs from the approved Ukrainian plan text.'));
}

function validateClaims(value, report, expectedClaims, sourceFacts) {
  if (!Array.isArray(value)) {
    addIssue(report, issue('CLAIMS_INVALID', 'rework', 'claimsUsed must be an array.'));
    return;
  }
  const safeClaims = getSafePhotoClaims(sourceFacts);
  for (const [index, claim] of value.entries()) {
    if (!isRecordValue(claim) || typeof claim.field !== 'string' || typeof claim.value !== 'string' || !claim.field.trim() || !claim.value.trim()) {
      addIssue(report, issue('CLAIMS_INVALID', 'rework', `claimsUsed item ${index} is invalid.`));
      continue;
    }
    if (isEconomicFactKey(claim.field)) {
      addIssue(report, issue('ECONOMIC_CLAIM_FORBIDDEN', 'rework', 'Economic source facts cannot be used in photo claims.'));
      continue;
    }
    const exact = expectedClaims.some((item) => item.field === claim.field && item.value === claim.value)
      && safeClaims.some((item) => item.field === claim.field && item.value === claim.value);
    if (!exact) addIssue(report, issue('UNSUPPORTED_CLAIM', 'rework', 'Every structured photo claim must exactly match a verified source fact.'));
  }
}

function validateFidelity(value, report) {
  if (value === undefined) return;
  if (!isRecordValue(value)) {
    addIssue(report, issue('FIDELITY_METADATA_INVALID', 'rework', 'Structured fidelity evidence is invalid.'));
    return;
  }
  if (['brandChanged', 'colorChanged', 'modelChanged', 'productChanged'].some((key) => value[key] === true)) {
    addIssue(report, issue('PRODUCT_FIDELITY_CHANGED', 'rework', 'Generated metadata reports a change to the source product.'));
  }
}

function validateOne({ artifact, planned, report, plan, sourceFacts, policy }) {
  if (!isRecordValue(artifact)) {
    addIssue(report, issue('PHOTO_ARTIFACT_INVALID', 'rework', 'Generated photo artifact must be an object.'));
    return;
  }
  if (artifact.productKey !== plan.productKey) addIssue(report, issue('PRODUCT_KEY_MISMATCH', 'rework', 'Generated photo productKey does not match the plan.'));
  if (artifact.photoIndex !== planned.index) addIssue(report, issue('PHOTO_INDEX_MISMATCH', 'rework', 'Generated photo index does not match its planned position.'));
  if (artifact.role !== planned.role) addIssue(report, issue('PHOTO_ROLE_MISMATCH', 'rework', 'Generated photo role does not match its planned position.'));
  const asset = artifact.asset;
  if (!isRecordValue(asset) || !assetReference(asset)) {
    addIssue(report, issue('PHOTO_ASSET_MISSING', 'rework', 'Generated photo asset reference is missing.'));
  } else {
    if (!isAcceptedPhotoDimensions(asset.width, asset.height)) {
      if (asset.width !== policy.width) addIssue(report, issue('PHOTO_WIDTH_INVALID', 'rework', 'Generated photo width must be 1280 or 1254 pixels in an accepted square output.'));
      if (asset.height !== policy.height) addIssue(report, issue('PHOTO_HEIGHT_INVALID', 'rework', 'Generated photo height must be 1280 or 1254 pixels in an accepted square output.'));
    }
    if (asset.format !== undefined && !policy.allowedFormats.includes(String(asset.format).toLowerCase())) {
      addIssue(report, issue('PHOTO_FORMAT_UNSUPPORTED', 'rework', 'Generated photo format is not supported by the photo contract.'));
    }
  }
  if (!Array.isArray(artifact.sourceImageRefs) || artifact.sourceImageRefs.length === 0) {
    if (policy.fidelity.requireSourceImageRefs) addIssue(report, issue('SOURCE_IMAGE_REFS_REQUIRED', 'rework', 'Generated photo must retain source image references.'));
  } else {
    try {
      if (!sameJson(normalizeRefs(artifact.sourceImageRefs), planned.sourceImageRefs)) {
        addIssue(report, issue('SOURCE_IMAGE_REFS_MISMATCH', 'rework', 'Generated photo source image references do not match the plan.'));
      }
    } catch {
      addIssue(report, issue('SOURCE_IMAGE_REFS_INVALID', 'rework', 'Generated photo source image references are malformed.'));
    }
  }
  validateClaims(artifact.claimsUsed, report, planned.verifiedClaims, sourceFacts);
  validateText(artifact.text, report, planned.text, policy, planned.role, sourceFacts);
  validateFidelity(artifact.fidelity, report);
}

function resultStatus(report, policy) {
  if (report.issues.some((item) => item.severity === 'rework')) return PHOTO_STATUSES.REWORK;
  if (report.issues.some((item) => item.severity === 'review')) return PHOTO_STATUSES.REVIEW;
  return PHOTO_STATUSES.READY;
}

function buildApprovedMediaArtifact(plan, artifacts, reports) {
  if (reports.some((report) => report.status !== PHOTO_STATUSES.READY)) return undefined;
  return {
    productKey: plan.productKey,
    version: plan.version,
    photos: artifacts.map((artifact, index) => {
      const photo = {
        index: index + 1,
        assetRef: assetReference(artifact.asset),
        width: artifact.asset.width,
        height: artifact.asset.height,
      };
      if (artifact.asset.format !== undefined) photo.format = artifact.asset.format;
      return photo;
    }),
  };
}

function visualQaRequired(plan) {
  return {
    productKey: plan.productKey,
    version: plan.version,
    status: PHOTO_STATUSES.REVIEW,
    verification: 'OPERATOR_CHECKLIST',
    photos: plan.photos.map((photo) => ({
      photoIndex: photo.index,
      role: photo.role,
      status: PHOTO_STATUSES.REVIEW,
      reasonCodes: ['VISUAL_QA_REQUIRED'],
      checks: Object.fromEntries(VISUAL_CHECK_KEYS.map((key) => [key, false])),
    })),
  };
}

function validateVisualQa(value, plan) {
  if (value === undefined) return visualQaRequired(plan);
  assertRecord(value, 'photo QA visualQa');
  if (value.productKey !== plan.productKey || value.version !== plan.version) throw new TypeError('photo QA visualQa identity does not match the plan');
  if (value.verification !== 'OPERATOR_CHECKLIST') throw new TypeError('photo QA visualQa.verification must be OPERATOR_CHECKLIST');
  if (!Array.isArray(value.photos) || value.photos.length !== plan.photos.length) throw new TypeError('photo QA visualQa.photos must contain exactly five photos');
  const photos = plan.photos.map((planned) => {
    const item = value.photos.find((candidate) => candidate?.photoIndex === planned.index);
    if (!isRecordValue(item) || item.role !== planned.role || !isRecordValue(item.checks)) throw new TypeError(`photo QA visualQa photo ${planned.index} is invalid`);
    for (const key of Object.keys(item.checks)) if (!VISUAL_CHECK_KEYS.includes(key)) throw new TypeError(`Unsupported visual QA check: ${key}`);
    for (const key of VISUAL_CHECK_KEYS) if (typeof item.checks[key] !== 'boolean') throw new TypeError(`visual QA check ${key} must be boolean`);
    const failedChecks = VISUAL_CHECK_KEYS.filter((key) => item.checks[key] === false);
    const status = failedChecks.length > 0 ? PHOTO_STATUSES.REWORK : PHOTO_STATUSES.READY;
    return {
      photoIndex: planned.index,
      role: planned.role,
      status,
      reasonCodes: failedChecks.map((key) => VISUAL_REASON_CODES[key]),
      checks: Object.fromEntries(VISUAL_CHECK_KEYS.map((key) => [key, item.checks[key]])),
    };
  });
  const status = aggregatePhotoStatus(photos.map((photo) => photo.status));
  if (value.status !== status) throw new TypeError('photo QA visualQa.status does not match its checklist');
  return { productKey: plan.productKey, version: plan.version, status, verification: 'OPERATOR_CHECKLIST', photos };
}

function applyVisualQa(reports, visualQa) {
  for (const visualPhoto of visualQa.photos) {
    const report = reports[visualPhoto.photoIndex - 1];
    if (!report) continue;
    for (const code of visualPhoto.reasonCodes) {
      addIssue(report, issue(code, visualPhoto.status === PHOTO_STATUSES.REWORK ? 'rework' : 'review', 'Operator visual QA did not approve this photo.'));
    }
  }
}

function applySeriesMetadataQa(reports, artifacts, policy) {
  const seenMessages = new Map();
  const seenCompositions = new Map();
  const seenPositions = new Map();
  for (const [index, artifact] of artifacts.entries()) {
    if (!isRecordValue(artifact)) continue;
    const report = reports[index] ?? reports[reports.length - 1];
    if (!report) continue;
    for (const [field, seen, code, severity, label] of [
      ['message', seenMessages, 'PHOTO_REPEATED_METADATA', policy.duplicate.repeatedMetadataSeverity, 'message'],
      ['composition', seenCompositions, 'PHOTO_DUPLICATE_COMPOSITION', 'rework', 'composition'],
      ['productPosition', seenPositions, 'PHOTO_DUPLICATE_POSITION', 'rework', 'product position'],
    ]) {
      const value = artifact[field];
      if (typeof value !== 'string' || !value.trim()) continue;
      if (seen.has(value)) addIssue(report, issue(code, severity, `Photo repeats ${label} from photo ${seen.get(value)}.`));
      else seen.set(value, report.photoIndex);
    }
  }
}

function seriesQaResult(plan, artifacts, reports) {
  const directions = plan.photos.map((photo) => photo.visualDirection);
  const intentKeys = directions.map((direction) => JSON.stringify([
    direction.compositionIntent,
    direction.scene,
    direction.sceneIntent,
    direction.productPlacement,
    direction.cameraAngle,
    direction.cameraViewpoint,
    direction.productOrientation,
    direction.crop,
    direction.cropIntent,
  ]));
  const explicitCompositions = artifacts.map((artifact) => artifact?.composition).filter((value) => typeof value === 'string' && value.trim());
  const explicitPositions = artifacts.map((artifact) => artifact?.productPosition).filter((value) => typeof value === 'string' && value.trim());
  const messages = artifacts.map((artifact) => artifact?.message).filter((value) => typeof value === 'string' && value.trim());
  const checks = {
    fiveRoles: plan.photos.length === 5,
    distinctRoles: new Set(plan.photos.map((photo) => photo.role)).size === plan.photos.length,
    distinctCompositionIntent: new Set(intentKeys).size === intentKeys.length,
    distinctCameraViewpoints: new Set(directions.map((direction) => direction.cameraViewpoint)).size === directions.length,
    distinctProductPositions: new Set(directions.map((direction) => direction.positionKey)).size === directions.length
      && (explicitPositions.length === 0 || (explicitPositions.length === artifacts.length && new Set(explicitPositions).size === explicitPositions.length)),
    distinctGeneratedCompositions: explicitCompositions.length === 0
      || (explicitCompositions.length === artifacts.length && new Set(explicitCompositions).size === explicitCompositions.length),
    distinctMarketingMessages: messages.length === 0
      || (messages.length === artifacts.length && new Set(messages).size === messages.length),
  };
  return {
    status: aggregatePhotoStatus(reports.map((report) => report.status)),
    verification: 'STRUCTURAL_ONLY',
    checks,
    reasonCodes: unique(reports.flatMap((report) => report.reasonCodes)),
  };
}

function visualQaForNextPlan(value, plan, targetIndexes) {
  if (value === undefined) return undefined;
  return {
    productKey: plan.productKey,
    version: plan.version,
    status: PHOTO_STATUSES.REWORK,
    verification: 'OPERATOR_CHECKLIST',
    photos: value.photos.map((photo) => ({
      ...clone(photo),
      checks: targetIndexes.has(photo.photoIndex)
        ? Object.fromEntries(VISUAL_CHECK_KEYS.map((key) => [key, false]))
        : clone(photo.checks),
    })),
  };
}

function approvedPoseContext(plan, quality) {
  const readyIndexes = new Set(quality.photos
    .filter((photo) => photo.status === PHOTO_STATUSES.READY)
    .map((photo) => photo.photoIndex));
  return plan.photos
    .filter((photo) => readyIndexes.has(photo.index))
    .map((photo) => ({
      photoIndex: photo.index,
      role: photo.role,
      compositionIntent: photo.visualDirection.compositionIntent,
      productOrientation: photo.visualDirection.productOrientation,
      cameraViewpoint: photo.visualDirection.cameraViewpoint,
      positionKey: photo.visualDirection.positionKey,
    }));
}

/** Validate generated photo metadata without claiming pixel-level vision QA. */
export function validatePhotoArtifacts(input, options = {}) {
  assertRecord(input, 'photo QA input');
  for (const key of Object.keys(input)) if (!['plan', 'artifacts', 'sourceFacts', 'visualQa'].includes(key)) throw new TypeError(`Unsupported photo QA input field: ${key}`);
  if (!Array.isArray(input.artifacts)) throw new TypeError('photo QA input.artifacts must be an array');
  assertRecord(input.sourceFacts, 'photo QA input.sourceFacts');
  const policy = resolvePhotoQualityPolicy(options.policy ?? {});
  validatePhotoProductionPlan(input.plan, { policy });
  if (input.plan.status !== PHOTO_STATUSES.READY) throw new TypeError('photo QA requires a READY photo production plan');

  const reports = input.plan.photos.map((planned) => ({
    photoIndex: planned.index,
    role: planned.role,
    status: PHOTO_STATUSES.READY,
    reasonCodes: [],
    issues: [],
  }));
  if (input.artifacts.length !== policy.requiredPhotoCount) {
    for (const report of reports) addIssue(report, issue('PHOTO_COUNT_INVALID', 'rework', 'Exactly five generated photo artifacts are required; extras are never silently truncated.'));
  }
  const artifacts = input.artifacts;
  for (const [index, planned] of input.plan.photos.entries()) {
    validateOne({
      artifact: artifacts[index],
      planned,
      report: reports[index],
      plan: input.plan,
      sourceFacts: input.sourceFacts,
      policy,
    });
  }

  const seen = new Map();
  for (const [index, artifact] of artifacts.entries()) {
    if (!isRecordValue(artifact) || !isRecordValue(artifact.asset)) continue;
    const report = reports[index] ?? reports[reports.length - 1];
    if (!report) continue;
    for (const [kind, value] of [['asset', assetReference(artifact.asset)], ['hash', artifact.hash], ['providerArtifactId', artifact.providerArtifactId]]) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const key = `${kind}:${value}`;
      if (seen.has(key)) {
        addIssue(report, issue('PHOTO_DUPLICATE_ASSET', 'rework', `Photo duplicates photo ${seen.get(key)} by ${kind}.`));
      } else seen.set(key, report.photoIndex);
    }
  }

  const visualQa = input.visualQa !== undefined || options.requireVisualQa === true
    ? validateVisualQa(input.visualQa, input.plan)
    : undefined;
  if (visualQa !== undefined) applyVisualQa(reports, visualQa);
  applySeriesMetadataQa(reports, artifacts, policy);

  for (const report of reports) {
    report.reasonCodes = unique(report.issues.map((item) => item.code));
    report.status = resultStatus(report, policy);
    delete report.issues;
  }
  const status = aggregatePhotoStatus(reports.map((report) => report.status));
  const seriesQa = seriesQaResult(input.plan, artifacts, reports);
  const reworkPlan = {
    photos: reports
      .filter((report) => report.status !== PHOTO_STATUSES.READY)
      .map((report) => ({ photoIndex: report.photoIndex, reasonCodes: [...report.reasonCodes] })),
  };
  const result = {
    productKey: input.plan.productKey,
    version: input.plan.version,
    status,
    fidelityVerification: 'STRUCTURAL_ONLY',
    photos: reports,
    seriesQa,
    reworkPlan,
    summary: {
      readyPhotoCount: reports.filter((report) => report.status === PHOTO_STATUSES.READY).length,
      reviewPhotoCount: reports.filter((report) => report.status === PHOTO_STATUSES.REVIEW).length,
      reworkPhotoCount: reports.filter((report) => report.status === PHOTO_STATUSES.REWORK).length,
      artifactCount: input.artifacts.length,
    },
  };
  if (visualQa !== undefined) result.visualQa = visualQa;
  const approved = buildApprovedMediaArtifact(input.plan, artifacts, reports);
  if (approved !== undefined) result.approvedMediaArtifact = approved;
  return result;
}

function validateReworkInput(input, options) {
  assertRecord(input, 'photo rework input');
  for (const key of Object.keys(input)) if (!['plan', 'artifacts', 'quality', 'sourceFacts', 'visualQa'].includes(key)) throw new TypeError(`Unsupported photo rework input field: ${key}`);
  if (!Array.isArray(input.artifacts)) throw new TypeError('photo rework input.artifacts must be an array');
  assertRecord(input.quality, 'photo rework input.quality');
  assertRecord(input.sourceFacts, 'photo rework input.sourceFacts');
  const policy = resolvePhotoQualityPolicy(options.policy ?? {});
  const current = validatePhotoArtifacts({ plan: input.plan, artifacts: input.artifacts, sourceFacts: input.sourceFacts, ...(input.visualQa === undefined ? {} : { visualQa: input.visualQa }) }, { policy });
  if (!sameJson(input.quality, current)) throw new PhotoReworkError('Supplied Photo QA result does not match the current artifacts', 'PHOTO_QUALITY_RESULT_MISMATCH');
  if (current.status === PHOTO_STATUSES.READY || current.reworkPlan.photos.length === 0) {
    throw new PhotoReworkError('Only a non-READY Photo QA result can start photo rework', 'PHOTO_REWORK_NOT_ELIGIBLE');
  }
  return { current, policy };
}

/** Regenerate only non-READY photos after authenticating the current Photo QA result. */
export async function reworkProductPhotos(input, options = {}) {
  assertRecord(options, 'photo rework options');
  for (const key of Object.keys(options)) if (!['generator', 'policy'].includes(key)) throw new TypeError(`Unsupported photo rework option: ${key}`);
  if (typeof options.generator !== 'function') throw new TypeError('photo rework options.generator must be a function');
  const { current, policy } = validateReworkInput(input, options);
  const targetIndexes = new Set(current.reworkPlan.photos.map((entry) => entry.photoIndex));
  const targetPhotos = input.plan.photos.filter((photo) => targetIndexes.has(photo.index));
  const regenerated = await generatePlannedPhotoArtifacts(input.plan, targetPhotos, {
    generator: options.generator,
    policy,
    usedPoseContext: approvedPoseContext(input.plan, current),
  });
  const regeneratedByIndex = new Map(regenerated.map((artifact) => [artifact.photoIndex, artifact]));
  const nextArtifacts = input.plan.photos.map((photo, index) => targetIndexes.has(photo.index) ? regeneratedByIndex.get(photo.index) : input.artifacts[index]);
  const nextPlan = { ...clone(input.plan), version: input.plan.version + 1 };
  const quality = validatePhotoArtifacts({
    plan: nextPlan,
    artifacts: nextArtifacts,
    sourceFacts: input.sourceFacts,
    ...(input.visualQa === undefined ? {} : { visualQa: visualQaForNextPlan(input.visualQa, nextPlan, targetIndexes) }),
  }, { policy });
  const result = {
    status: quality.status,
    productKey: nextPlan.productKey,
    version: nextPlan.version,
    plan: nextPlan,
    artifacts: nextArtifacts,
    quality,
    reworkPlan: quality.reworkPlan,
  };
  if (quality.approvedMediaArtifact !== undefined) result.approvedMediaArtifact = quality.approvedMediaArtifact;
  return result;
}

export class PhotoReworkError extends Error {
  constructor(message, code = 'PHOTO_REWORK_ERROR', details = undefined, cause = undefined) {
    super(message, cause === undefined ? {} : { cause });
    this.name = 'PhotoReworkError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
