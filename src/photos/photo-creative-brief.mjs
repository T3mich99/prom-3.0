import { createHash } from 'node:crypto';
import { PHOTO_ROLE_ORDER, isRecordValue } from './photo-contract.mjs';

export const CREATIVE_FIELDS = Object.freeze(['message', 'scene', 'composition', 'camera', 'placement', 'orientation', 'crop', 'layout', 'lighting']);
const normalized = (value) => value.normalize('NFKC').toLocaleLowerCase('uk').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Descriptive metadata catches exact reuse. Pixel-level similarity still needs visual QA.
export function validatePhotoCreativeBrief(brief, productKey) {
  if (!isRecordValue(brief) || brief.productKey !== productKey || brief.version !== 1) throw new TypeError('Creative brief requires matching productKey and version 1');
  if (typeof brief.rationale !== 'string' || !brief.rationale.trim()) throw new TypeError('Creative brief requires a product-specific rationale');
  if (!Array.isArray(brief.photos) || brief.photos.length !== 5) throw new TypeError('Creative brief requires five separate photo concepts');
  for (const [index, photo] of brief.photos.entries()) {
    if (!isRecordValue(photo) || photo.role !== PHOTO_ROLE_ORDER[index]) throw new TypeError('Creative brief roles must be hero, usage, benefits, feature, final');
    for (const field of CREATIVE_FIELDS) {
      if (typeof photo[field] !== 'string' || !normalized(photo[field])) throw new TypeError(`Creative brief ${photo.role}.${field} is required`);
    }
    if (!isRecordValue(photo.photoCopy)) throw new TypeError('Creative brief requires photoCopy for each role');
    if (photo.role === 'final') {
      if (Object.keys(photo.photoCopy).length !== 1 || !Array.isArray(photo.photoCopy.supportingFacts) || photo.photoCopy.supportingFacts.length) throw new TypeError('Final photo must be object-only with photoCopy: { supportingFacts: [] }');
    } else if (typeof photo.photoCopy.headline !== 'string' || !photo.photoCopy.headline.trim()) throw new TypeError('Infographic photos require an individual Ukrainian headline');
  }
  for (const field of ['message', 'scene', 'composition', 'layout']) {
    if (new Set(brief.photos.map((photo) => normalized(photo[field]))).size !== 5) throw new TypeError(`Creative brief repeats ${field}; every photo needs a different concept`);
  }
  if (new Set(brief.photos.slice(0, 4).map((photo) => normalized(photo.photoCopy.headline))).size !== 4) throw new TypeError('Creative brief repeats visible headlines');
  return true;
}

export function creativeSceneSignature(photo) {
  return fingerprint(['scene', 'composition', 'layout', 'lighting'].map((key) => normalized(photo[key])));
}

export function findCreativeReuse(brief, previous = []) {
  validatePhotoCreativeBrief(brief, brief.productKey);
  const matches = [];
  for (const other of previous) {
    if (other.productKey === brief.productKey) continue;
    validatePhotoCreativeBrief(other, other.productKey);
    for (const photo of brief.photos) {
      if (other.photos.some((old) => creativeSceneSignature(old) === creativeSceneSignature(photo))) matches.push({ role: photo.role, otherProductKey: other.productKey });
    }
  }
  return matches;
}

export function applyPhotoCreativeBrief(visualPlan, brief, productKey) {
  validatePhotoCreativeBrief(brief, productKey);
  const selected = visualPlan.map((base, index) => {
    const concept = brief.photos[index];
    return { ...base, variantKey: `custom-${fingerprint(brief).slice(0, 16)}`,
      compositionIntent: concept.composition, sceneIntent: concept.scene,
      productPlacement: concept.placement, cameraViewpoint: concept.camera,
      productOrientation: concept.orientation, cropIntent: concept.crop,
      positionKey: `${concept.placement} / ${concept.crop}`,
      creativeConcept: structuredClone(concept),
    };
  });
  return selected.map((photo, index) => ({ ...photo, usedPosesToAvoid: selected.slice(0, index).map((previous) => ({
    photoIndex: previous.index, role: previous.role, compositionIntent: previous.compositionIntent,
    productOrientation: previous.productOrientation, cameraViewpoint: previous.cameraViewpoint, positionKey: previous.positionKey,
  })) }));
}
