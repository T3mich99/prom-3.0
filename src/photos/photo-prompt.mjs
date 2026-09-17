import { assertCurrentPhotoStyle } from './photo-style-profile.mjs';
import { isRecordValue } from './photo-contract.mjs';
import {
  PHOTO_GENERATION_POLICY,
  formatUsedPoses,
  getPhotoRoleContract,
  promptClaims,
  promptText,
  validatePhotoPromptContract,
} from './photo-policy.mjs';

function assertPhoto(photo) {
  if (!isRecordValue(photo)) throw new TypeError('photo prompt input must be an object');
  if (typeof photo.index !== 'number' || typeof photo.role !== 'string') throw new TypeError('photo prompt input must contain index and role');
  if (!isRecordValue(photo.visualDirection)) throw new TypeError('photo prompt input.visualDirection must be an object');
  if (!Array.isArray(photo.verifiedClaims) || !Array.isArray(photo.text)) throw new TypeError('photo prompt input must contain verifiedClaims and text arrays');
}

/** Build a provider-neutral prompt from an already validated planned photo. */
export function buildPhotoPrompt(photo, options = {}) {
  assertPhoto(photo);
  assertCurrentPhotoStyle(photo.visualDirection.styleProfile);
  validatePhotoPromptContract(photo, options);
  const roleContract = getPhotoRoleContract(photo.role);
  const visibleText = promptText(photo).map((item) => item.value).join(' | ') || '(no visible selling copy required)';
  const claims = promptClaims(photo.verifiedClaims).map((claim) => `${claim.field}=${claim.value}`).join('; ') || '(no additional factual claim supplied)';
  const usedPoses = options.usedPoseContext ?? photo.visualDirection.usedPosesToAvoid;
  return [
    `Create one standalone square ${PHOTO_GENERATION_POLICY.format.toUpperCase()} e-commerce product image, targeting exactly ${PHOTO_GENERATION_POLICY.width}x${PHOTO_GENERATION_POLICY.height} pixels; a square 1254x1254 provider result is also accepted by the contract.`,
    'Use the supplied source product images as the sole physical appearance authority.',
    'Preserve the actual product shape, color, controls, connectors, display, accessories, and any genuine brand/logo physically printed on the product.',
    'Preserve the genuine brand identity when it is verified; do not render, spell, or mention any model identifier in the image or visible copy, including printed markings on the product itself.',
    'Do not invent features, specifications, accessories, model numbers, certifications, badges, or performance results; use no watermark.',
    'Render the approved selling text inside this image as part of the generated advertising visual; do not rely on a later canvas or post-processing text overlay.',
    'All selling text must be Ukrainian, short, readable on a product card, and must not cover the product, logo, controls, attachments, or other functional details.',
    `Repository style ${photo.visualDirection.styleProfile.fingerprint}: ${photo.visualDirection.styleProfile.instructions.join(" ")}` ,
    `Style references (style only; the supplier photos remain the product identity authority): ${JSON.stringify(photo.visualDirection.styleProfile.references)}.`,
    `premium visual contract: ${PHOTO_GENERATION_POLICY.premiumVisualStyle.join('; ')}.`,
    `This is photo ${photo.index}, role ${photo.role}. Commercial objective: ${photo.objective}`,
    ...(photo.visualDirection.creativeConcept ? [
      `Individual creative concept: ${JSON.stringify(photo.visualDirection.creativeConcept)}. Follow this scene, layout, lighting and message; do not copy the style reference's scene or positioning.`,
      photo.role === 'final' ? 'Object-only product photograph: no text, no icons, no panels. Use the planned composition distinct from hero.' : 'Use bold readable Ukrainian headings, restrained informative pictograms and verified useful benefits, as in the approved commercial infographic reference. Adapt the layout for this photo; do not repeat the same panels in all five images.',
    ] : []),
    `Role contract: ${roleContract.visualTask}. The source image defines product identity, not final composition. Planned product-specific presentation: ${photo.visualDirection.compositionIntent}. Scene: ${photo.visualDirection.sceneIntent}; placement: ${photo.visualDirection.productPlacement}; camera viewpoint: ${photo.visualDirection.cameraViewpoint}; product orientation: ${photo.visualDirection.productOrientation}; crop: ${photo.visualDirection.cropIntent}; position key: ${photo.visualDirection.positionKey}; composition key ${photo.visualDirection.compositionKey}.`,
    `Do not reuse these already used presentations: ${formatUsedPoses(usedPoses)}. Changing only the background, props, lighting, or text does not count as a different product presentation.`,
    `Only these verified structured claims may be used: ${claims}.`,
    `Approved Ukrainian visible text to integrate in the image: ${visibleText}.`,
    'Keep the exact product as the primary visual object; context and typography support it. Make this composition visibly different from the other four roles.',
    'Create one image only: no collage and no contact sheet. An infographic is allowed only as one single image for its planned role.',
  ].join(' ');
}
