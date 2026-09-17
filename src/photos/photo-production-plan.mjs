import { resolvePhotoStyle, assertPhotoStyleSnapshot } from './photo-style-profile.mjs';
import { applyPhotoCreativeBrief } from './photo-creative-brief.mjs';
import { validateContentArtifact } from '../content/content-quality.mjs';
import {
  PHOTO_ROLE_ORDER,
  PHOTO_STATUSES,
  assertPhotoTextElements,
  assertSourceImages,
  isEconomicFactKey,
  isRecordValue,
  resolvePhotoQualityPolicy,
  sameJson,
} from './photo-contract.mjs';
import {
  buildPhotoCopy,
  buildProductVisualPlan,
  getPhotoRoleContract,
  promptText,
  validatePhotoPromptContract,
} from './photo-policy.mjs';

const ALLOWED_PLAN_KEYS = new Set([
  'status',
  'productKey',
  'version',
  'photos',
  'sourceImageRefs',
  'preservationConstraints',
  'fidelityVerification',
  'diagnostics',
]);
const ALLOWED_PHOTO_KEYS = new Set([
  'index',
  'role',
  'objective',
  'verifiedClaims',
  'photoCopy',
  'text',
  'visualDirection',
  'sourceImageRefs',
]);

function assertRecord(value, label) {
  if (!isRecordValue(value)) throw new TypeError(`${label} must be an object`);
}

function clone(value) {
  return structuredClone(value);
}

function diagnostic(code, severity, message) {
  return { code, severity, message };
}

function claimValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function verifiedClaims(sourceFacts) {
  return Object.entries(sourceFacts)
    .filter(([field]) => !isEconomicFactKey(field))
    .map(([field, value]) => ({ field, value: claimValue(value) }))
    .filter((claim) => claim.value !== null && claim.value.trim() !== '');
}

function selectedProductKey(selectedProduct) {
  assertRecord(selectedProduct, 'selectedProduct');
  if (typeof selectedProduct.selectionKey !== 'string' || !selectedProduct.selectionKey.trim()) {
    throw new TypeError('selectedProduct.selectionKey must be a non-empty string');
  }
  return selectedProduct.selectionKey;
}

function planPhoto({ index, role, claims, sourceImageRefs, productPose, styleProfile }) {
  const contract = getPhotoRoleContract(role);
  const photoCopy = productPose.creativeConcept?.photoCopy ?? buildPhotoCopy(role, claims);
  if (photoCopy === null) return null;
  const visualDirection = {
    ...(productPose.creativeConcept ? { creativeConcept: clone(productPose.creativeConcept) } : {}),
    styleProfile: clone(styleProfile),
    compositionKey: `${productPose.profileKey}-${productPose.variantKey}-${index}-${role}`,
    profileKey: productPose.profileKey,
    variantKey: productPose.variantKey,
    compositionIntent: productPose.compositionIntent,
    productPlacement: productPose.productPlacement,
    scene: productPose.sceneIntent,
    sceneIntent: productPose.sceneIntent,
    cameraAngle: productPose.cameraViewpoint,
    cameraViewpoint: productPose.cameraViewpoint,
    productOrientation: productPose.productOrientation,
    crop: productPose.cropIntent,
    cropIntent: productPose.cropIntent,
    positionKey: productPose.positionKey,
    usedPosesToAvoid: clone(productPose.usedPosesToAvoid),
    variation: `product-specific-${productPose.profileKey}-${productPose.variantKey}-${role}`,
  };
  return {
    index,
    role,
    objective: contract.objective,
    verifiedClaims: clone(claims),
    photoCopy,
    text: promptText({ photoCopy }),
    visualDirection,
    sourceImageRefs: clone(sourceImageRefs),
  };
}

const PRESERVATION_CONSTRAINTS = Object.freeze([
  'preserve the physical product shape, color, controls, connectors, display, and distinguishing details',
  'preserve any genuine brand mark physically printed on the product',
  'do not add or remove accessories, buttons, parts, features, or package elements',
  'use source images as the sole physical appearance authority',
  'source images establish product identity, not final composition',
  'do not substitute an old, generic, nearby, or other-product image',
]);

/** Build a deterministic provider-neutral five-photo production plan. */
export function buildPhotoProductionPlan(input, options = {}) {
  assertRecord(input, 'photo plan input');
  for (const key of Object.keys(input)) {
    if (!['selectedProduct', 'contentArtifact', 'sourceImages', 'sourceFacts', 'photoCreativeBrief'].includes(key)) {
      throw new TypeError(`Unsupported photo plan input field: ${key}`);
    }
  }
  const policy = resolvePhotoQualityPolicy(options.policy ?? {});
  const productKey = selectedProductKey(input.selectedProduct);
  assertRecord(input.sourceFacts, 'sourceFacts');
  const sourceImageRefs = assertSourceImages(input.sourceImages);
  assertRecord(input.contentArtifact, 'contentArtifact');
  if (input.contentArtifact.productKey !== productKey) {
    throw new TypeError('contentArtifact.productKey must match selectedProduct.selectionKey');
  }
  const contentQuality = validateContentArtifact(input.contentArtifact);

  const diagnostics = [];
  if (sourceImageRefs.length === 0) {
    diagnostics.push(diagnostic('SOURCE_IMAGES_REQUIRED', 'rework', 'At least one usable source image is required to establish product identity.'));
  }
  if (contentQuality.status !== 'READY') {
    diagnostics.push(diagnostic('CONTENT_NOT_READY', contentQuality.status === 'REWORK' ? 'rework' : 'review', 'Photo planning is blocked until Content Quality is READY.'));
  }
  if (diagnostics.length > 0) {
    const status = diagnostics.some((item) => item.severity === 'rework') ? PHOTO_STATUSES.REWORK : PHOTO_STATUSES.REVIEW;
    return {
      status,
      productKey,
      version: input.contentArtifact.version,
      photos: [],
      sourceImageRefs: clone(sourceImageRefs),
      preservationConstraints: [...PRESERVATION_CONSTRAINTS],
      fidelityVerification: 'STRUCTURAL_ONLY',
      diagnostics,
    };
  }

  const claims = verifiedClaims(input.sourceFacts);
  let visualPlan = buildProductVisualPlan({ productKey, verifiedClaims: claims, sourceImageRefs });
  if (input.photoCreativeBrief !== undefined) visualPlan = applyPhotoCreativeBrief(visualPlan, input.photoCreativeBrief, productKey);
  const styleProfile = resolvePhotoStyle({ productKey, categoryKey: input.selectedProduct.resolvedCategory?.sourceCategoryUrl ?? input.selectedProduct.requestedCategory ?? "", family: visualPlan[0].profileKey });
  const photos = PHOTO_ROLE_ORDER.map((role, index) => planPhoto({
    index: index + 1,
    role,
    claims,
    sourceImageRefs,
    productPose: visualPlan[index],
    styleProfile,
  }));
  if (photos.some((photo) => photo === null)) {
    return {
      status: PHOTO_STATUSES.REWORK,
      productKey,
      version: input.contentArtifact.version,
      photos: [],
      sourceImageRefs: clone(sourceImageRefs),
      preservationConstraints: [...PRESERVATION_CONSTRAINTS],
      fidelityVerification: 'STRUCTURAL_ONLY',
      diagnostics: [diagnostic('PHOTO_COPY_REQUIRED', 'rework', 'A verified Ukrainian product type is required to build selling copy for all five photo roles.')],
    };
  }
  const plan = {
    status: PHOTO_STATUSES.READY,
    productKey,
    version: input.contentArtifact.version,
    photos,
    sourceImageRefs: clone(sourceImageRefs),
    preservationConstraints: [...PRESERVATION_CONSTRAINTS],
    fidelityVerification: 'STRUCTURAL_ONLY',
    diagnostics: [],
  };
  validatePhotoProductionPlan(plan, { policy });
  for (const photo of plan.photos) validatePhotoPromptContract(photo, { sourceFacts: input.sourceFacts });
  return plan;
}

export function validatePhotoProductionPlan(plan, options = {}) {
  assertRecord(plan, 'photo production plan');
  const policy = resolvePhotoQualityPolicy(options.policy ?? {});
  for (const key of Object.keys(plan)) {
    if (!ALLOWED_PLAN_KEYS.has(key)) throw new TypeError(`Unsupported photo production plan field: ${key}`);
  }
  if (!Object.values(PHOTO_STATUSES).includes(plan.status)) throw new TypeError('photo production plan.status is invalid');
  if (typeof plan.productKey !== 'string' || !plan.productKey.trim()) throw new TypeError('photo production plan.productKey must be a non-empty string');
  if (!Number.isSafeInteger(plan.version) || plan.version < 1) throw new TypeError('photo production plan.version must be a positive integer');
  const refs = assertSourceImages(plan.sourceImageRefs);
  if (typeof plan.fidelityVerification !== 'string' || plan.fidelityVerification !== 'STRUCTURAL_ONLY') {
    throw new TypeError('photo production plan.fidelityVerification must be STRUCTURAL_ONLY');
  }
  if (!Array.isArray(plan.preservationConstraints) || plan.preservationConstraints.length === 0
    || plan.preservationConstraints.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new TypeError('photo production plan.preservationConstraints must be a non-empty string array');
  }
  if (!Array.isArray(plan.diagnostics)) throw new TypeError('photo production plan.diagnostics must be an array');
  if (!Array.isArray(plan.photos)) throw new TypeError('photo production plan.photos must be an array');
  if (plan.status === PHOTO_STATUSES.READY && plan.photos.length !== policy.requiredPhotoCount) {
    throw new TypeError('READY photo production plan must contain exactly five photos');
  }
  const indexes = new Set();
  const roles = new Set();
  for (const [position, photo] of plan.photos.entries()) {
    assertRecord(photo, `photo production plan.photos[${position}]`);
    for (const key of Object.keys(photo)) {
      if (!ALLOWED_PHOTO_KEYS.has(key)) throw new TypeError(`Unsupported planned photo field: ${key}`);
    }
    if (!Number.isSafeInteger(photo.index) || photo.index < 1 || photo.index > 5) throw new TypeError(`planned photo ${position} has an invalid index`);
    if (indexes.has(photo.index)) throw new TypeError('planned photo indexes must be unique');
    indexes.add(photo.index);
    if (photo.index !== position + 1) throw new TypeError('planned photo order must be 1 through 5');
    if (!PHOTO_ROLE_ORDER.includes(photo.role) || roles.has(photo.role)) throw new TypeError('planned photo roles must be unique and canonical');
    roles.add(photo.role);
    if (typeof photo.objective !== 'string' || !photo.objective.trim()) throw new TypeError('planned photo objective must be a non-empty string');
    if (!Array.isArray(photo.verifiedClaims)) throw new TypeError('planned photo.verifiedClaims must be an array');
    for (const claim of photo.verifiedClaims) {
      assertRecord(claim, 'planned photo verified claim');
      if (typeof claim.field !== 'string' || !claim.field.trim() || typeof claim.value !== 'string' || !claim.value.trim()) {
        throw new TypeError('planned photo verified claims require field and value strings');
      }
      if (isEconomicFactKey(claim.field)) throw new TypeError('economic source facts cannot appear in a photo plan');
    }
    const text = assertPhotoTextElements(photo.text, `planned photo ${photo.index}.text`);
    if (text.length > policy.text.maxElementsByRole[photo.role]) throw new TypeError(`planned photo ${photo.index} exceeds its text density limit`);
    if (text.some((item) => item.value.length > policy.text.maxCharactersPerElement)) throw new TypeError(`planned photo ${photo.index} contains an oversized text element`);
    assertPhotoStyleSnapshot(photo.visualDirection?.styleProfile);
    assertRecord(photo.visualDirection, `planned photo ${photo.index}.visualDirection`);
    if (typeof photo.visualDirection.compositionKey !== 'string' || !photo.visualDirection.compositionKey.trim()) {
      throw new TypeError(`planned photo ${photo.index}.visualDirection.compositionKey must be non-empty`);
    }
    for (const key of ['compositionIntent', 'sceneIntent', 'cameraAngle', 'cameraViewpoint', 'productOrientation', 'crop', 'cropIntent', 'positionKey']) {
      if (typeof photo.visualDirection[key] !== 'string' || !photo.visualDirection[key].trim()) throw new TypeError(`planned photo ${photo.index}.visualDirection.${key} must be non-empty`);
    }
    if (!Array.isArray(photo.visualDirection.usedPosesToAvoid)) throw new TypeError(`planned photo ${photo.index}.visualDirection.usedPosesToAvoid must be an array`);
    if (photo.visualDirection.usedPosesToAvoid.length !== photo.index - 1
      || !sameJson(photo.visualDirection.usedPosesToAvoid.map((pose) => pose.photoIndex), Array.from({ length: photo.index - 1 }, (_, index) => index + 1))) {
      throw new TypeError(`planned photo ${photo.index}.visualDirection.usedPosesToAvoid must list earlier photo indexes in order`);
    }
    if (photo.visualDirection.usedPosesToAvoid.some((pose) => !isRecordValue(pose)
      || !Number.isSafeInteger(pose.photoIndex)
      || typeof pose.role !== 'string'
      || typeof pose.compositionIntent !== 'string'
      || typeof pose.productOrientation !== 'string'
      || typeof pose.cameraViewpoint !== 'string'
      || typeof pose.positionKey !== 'string')) {
      throw new TypeError(`planned photo ${photo.index}.visualDirection.usedPosesToAvoid contains an invalid pose summary`);
    }
    const photoRefs = assertSourceImages(photo.sourceImageRefs);
    if (!sameJson(photoRefs, refs)) throw new TypeError(`planned photo ${photo.index}.sourceImageRefs must match plan sourceImageRefs`);
    validatePhotoPromptContract(photo);
  }
  if (plan.status === PHOTO_STATUSES.READY) {
    for (const key of ['compositionKey', 'compositionIntent', 'scene', 'sceneIntent', 'productPlacement', 'cameraAngle', 'cameraViewpoint', 'productOrientation', 'crop', 'cropIntent', 'positionKey']) {
      const values = plan.photos.map((photo) => photo.visualDirection[key]);
      if (new Set(values).size !== values.length) throw new TypeError(`READY photo plan requires distinct visual ${key} values`);
    }
  }
  if (plan.status === PHOTO_STATUSES.READY && (!sameJson([...indexes], [1, 2, 3, 4, 5]) || !sameJson([...roles], policy.roleOrder))) {
    throw new TypeError('READY photo production plan must contain the canonical five photo roles');
  }
  return true;
}

export function getSafePhotoClaims(sourceFacts) {
  assertRecord(sourceFacts, 'sourceFacts');
  return verifiedClaims(sourceFacts).map(clone);
}
