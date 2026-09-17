import {
  PHOTO_ROLE_ORDER,
  isEconomicFactKey,
  isRecordValue,
  sameJson,
} from './photo-contract.mjs';

const ROLE_CONTRACTS = {
  hero: {
    objective: 'Show the exact product large and dominant in a premium advertising key visual.',
    visualTask: 'communicate the product category and its strongest verified identity cue',
    maxClaims: 0,
  },
  usage: {
    objective: 'Show the exact product in a realistic buyer-use editorial lifestyle scenario.',
    visualTask: 'show the practical result and context of use without a stock-photo look',
    maxClaims: 0,
  },
  benefits: {
    objective: 'Present two or three strongest verified benefits in a restrained premium infographic composition.',
    visualTask: 'make verified buyer benefits scannable without badge clutter',
    maxClaims: 3,
  },
  feature: {
    objective: 'Explain one verified product feature through a premium close-up or macro composition.',
    visualTask: 'explain one real construction or operating detail without invented technology',
    maxClaims: 1,
  },
  final: {
    objective: 'Close the gallery with a distinct premium editorial product presentation.',
    visualTask: 'leave a clean, memorable final impression without duplicating the hero',
    maxClaims: 0,
  },
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function pose(compositionIntent, sceneIntent, productPlacement, cameraViewpoint, productOrientation, cropIntent, positionKey) {
  return {
    compositionIntent,
    sceneIntent,
    productPlacement,
    cameraViewpoint,
    productOrientation,
    cropIntent,
    positionKey,
  };
}

const PRODUCT_POSE_LIBRARY = deepFreeze({
  'hair-styling': [
    {
      hero: pose('upright hero on a warm vanity surface with the working head turned toward the camera', 'premium vanity studio with open negative space for the headline', 'the complete product dominates the right side of the frame', 'front three-quarter view from the handle side', 'upright with the working end angled slightly upward', 'large full-product crop with the silhouette and genuine details visible', 'hero-right-vertical'),
      usage: pose('the product is held horizontally beside finished hair during a believable styling moment', 'bright bathroom vanity with a restrained lifestyle context', 'product in the foreground and the result secondary in the background', 'natural eye-level side view aligned with the styling action', 'horizontal and aimed toward the hair being styled', 'medium contextual crop that keeps the product larger than the person', 'usage-left-horizontal'),
      benefits: pose('the product rests diagonally with a controlled information area alongside it', 'premium tabletop catalog scene with soft directional light', 'product occupies the lower-right while benefits use clear negative space', 'slightly elevated oblique catalog view', 'diagonal from lower-left toward upper-right', 'balanced crop showing the full body and a quiet copy area', 'benefits-lower-right'),
      feature: pose('the working head and one verified attachment are arranged as a purposeful detail study', 'controlled close-up studio surface with no unrelated props', 'feature occupies the foreground and the remaining product anchors the frame', 'close side detail view aimed at the functional end', 'feature-facing orientation with the attachment visibly connected or beside it', 'tight detail crop that keeps the identified feature recognizable', 'feature-front-close'),
      final: pose('the product lies in a relaxed editorial arrangement across folded textiles', 'calm premium bedroom or dressing-table environment distinct from the hero', 'complete product leads from the lower-left toward the center', 'low side perspective with a short focal distance', 'resting horizontal presentation with the opposite side visible', 'clean alternate crop with the full product and a small lifestyle context', 'final-lower-left'),
    },
    {
      hero: pose('the product stands in a sculptural three-quarter presentation against a softly lit shelf', 'minimal premium interior with vertical negative space on the left', 'product is centered-left and visually taller than the surrounding setting', 'rear three-quarter view that reveals the opposite side without hiding controls', 'upright with the body turned away from the source-image angle', 'tall crop with full product edges and brand area visible', 'hero-left-upright'),
      usage: pose('the product is shown in a close hand-to-hair action with its cable and working direction readable', 'natural bedroom dressing scene with the user secondary and softly cropped', 'product fills the lower foreground while the action explains use', 'over-shoulder viewpoint toward the working end', 'angled upward toward the hair rather than parallel to the frame', 'close contextual crop centered on the real use point', 'usage-bottom-action'),
      benefits: pose('the product is placed across a clean tray with a structured benefit area above it', 'premium studio tray scene with warm neutral materials', 'product runs left-to-right below the copy, fully visible', 'near top-down view with a slight front tilt', 'horizontal side profile with the control side exposed', 'wide balanced crop with room for three short verified accents', 'benefits-bottom-horizontal'),
      feature: pose('a verified barrel, brush surface, or control is shown in a precise macro detail with the body entering from the edge', 'focused product-detail scene using only the product and its real element', 'the functional detail is the largest object and remains connected to product identity', 'macro front-side viewpoint', 'rotated so the verified control or attachment faces the lens', 'tight macro crop with enough surrounding body to prove identity', 'feature-upper-macro'),
      final: pose('the product is presented at a shallow diagonal on a polished counter with a reflected silhouette', 'quiet editorial counter scene with controlled highlights', 'product leads from upper-right toward lower-center', 'low front viewpoint opposite the hero direction', 'shallow diagonal with the handle or body closest to the viewer', 'medium-wide showcase crop with a complete product and restrained context', 'final-upper-right'),
    },
  ],
  storage: [
    {
      hero: pose('the exact item is shown open and standing in a clean front three-quarter catalog pose', 'bright organized interior with calm negative space', 'product is large and centered with all compartments or openings readable', 'front three-quarter viewpoint at product height', 'upright open presentation', 'full-product crop with the complete outline visible', 'hero-center-open'),
      usage: pose('the item is placed in its real storage location with a few verified-use objects inside', 'tidy cabinet, shelf, or countertop context appropriate to the source facts', 'product remains foreground-dominant while stored items support the use case', 'side viewpoint into the storage space', 'angled toward the interior and away from the hero view', 'medium crop showing how the buyer accesses the item', 'usage-side-interior'),
      benefits: pose('the product is viewed from above with its organization logic clearly arranged', 'premium neutral surface with a clean information zone', 'product occupies the lower half with benefits in open upper space', 'top-oblique viewpoint', 'flat or shallow-open orientation', 'wide crop showing compartments, capacity, or access points', 'benefits-top-oblique'),
      feature: pose('one verified compartment, hinge, handle, or included component is isolated in a clean detail presentation', 'controlled detail tabletop without decorative clutter', 'the real functional element is closest to the camera', 'close side detail viewpoint', 'turned to expose the verified construction detail', 'tight crop with the feature and enough product context', 'feature-side-detail'),
      final: pose('the complete item is shown filled and ready in a refined interior arrangement', 'aspirational organized home setting distinct from the hero', 'product anchors the lower-left and the result reads immediately', 'low diagonal viewpoint from the opposite corner', 'resting open at a new angle', 'clean editorial crop with the complete item and useful context', 'final-corner-open'),
    },
    {
      hero: pose('the exact item is shown closed or compact in a sculptural three-quarter product portrait', 'minimal shelf scene with a soft architectural background', 'product dominates the left two-thirds with its outline unobstructed', 'rear three-quarter viewpoint', 'closed or compact orientation if supported by the source facts', 'large crop emphasizing material and silhouette', 'hero-left-compact'),
      usage: pose('the item is being opened, carried, or accessed in the real context supported by its purpose', 'natural home-use scene with hands only when the action is genuine', 'product is closest to the lens and the action explains the benefit', 'overhead use viewpoint', 'opening or access direction turned toward the buyer', 'medium crop focused on the interaction point', 'usage-top-action'),
      benefits: pose('the product is arranged in a flat-lay with verified organization benefits separated by generous space', 'light premium tabletop with quiet geometric shadows', 'product runs diagonally through the lower half', 'near top-down catalog view', 'flat diagonal presentation unlike the hero', 'wide crop with complete outline and restrained copy area', 'benefits-diagonal-flat'),
      feature: pose('the most useful verified opening, divider, or surface is shown as a clean close-up', 'material-focused studio setting', 'feature fills the frame while one edge preserves the product identity', 'macro overhead-side viewpoint', 'feature turned directly toward the camera', 'tight crop that exposes construction without inventing parts', 'feature-overhead-detail'),
      final: pose('the item is staged in a finished organized room with a calm product-first perspective', 'soft editorial home interior with a distinct color temperature', 'product leads from the right toward the center', 'low front-side viewpoint', 'resting in a different closed/open state supported by the facts', 'medium-wide final showcase crop', 'final-right-room'),
    },
  ],
  kitchen: [
    {
      hero: pose('the exact kitchen product is displayed as a strong sculptural catalog object', 'premium kitchen counter with clean daylight and no unrelated props', 'product is large and centered with its working surface prominent', 'front three-quarter counter-height view', 'upright or resting in its natural ready-to-use position', 'full-product crop with edges and handles visible', 'hero-counter-center'),
      usage: pose('the product is shown in the real kitchen action supported by the verified purpose', 'believable cooking or serving scene with food secondary to the product', 'product is foreground-first and the action explains the use', 'side action viewpoint at counter height', 'turned toward the real task rather than the hero angle', 'medium contextual crop with the product dominant', 'usage-side-task'),
      benefits: pose('the product is arranged with its useful surface or capacity facing the viewer and concise benefit copy nearby', 'bright tabletop catalog scene', 'product spans the lower frame with clean upper negative space', 'slightly elevated overhead view', 'horizontal or shallow diagonal presentation', 'wide balanced crop showing the useful area clearly', 'benefits-overhead-wide'),
      feature: pose('one verified handle, control, surface, or included element receives a precise close-up', 'controlled material-detail scene with restrained reflections', 'the feature occupies the foreground and the body confirms the product', 'close side macro viewpoint', 'feature-facing turn that differs from the hero presentation', 'tight detail crop without hiding the relevant construction', 'feature-material-close'),
      final: pose('the product is staged in a finished serving or countertop moment as the last gallery impression', 'warm editorial kitchen environment distinct from the hero', 'product leads diagonally through the frame with the result secondary', 'low opposite-corner viewpoint', 'resting at a new diagonal or side orientation', 'complete showcase crop with calm premium balance', 'final-diagonal-counter'),
    },
  ],
  general: [
    {
      hero: pose('the exact product is arranged in its most legible natural presentation for a premium catalog portrait', 'clean neutral studio with a product-specific supporting surface', 'product dominates the center-right with its full outline readable', 'front three-quarter viewpoint chosen from the product silhouette', 'natural ready-to-use orientation', 'large full-product crop with all genuine visible details', 'hero-natural-right'),
      usage: pose('the product is shown in the real use scenario supported by its verified purpose', 'restrained lifestyle context relevant to the source facts', 'product is the nearest and clearest object in the action', 'side or over-shoulder use viewpoint selected for the product', 'turned toward the action rather than the hero view', 'medium use-context crop with the product dominant', 'usage-context-side'),
      benefits: pose('the product is presented in a distinct catalog arrangement beside two or three verified benefit accents', 'premium neutral surface with structured negative space', 'product occupies a different area and scale from the hero', 'elevated or near top-down viewpoint selected for the shape', 'horizontal, flat, or diagonal orientation selected from the product form', 'balanced crop showing the complete object and copy space', 'benefits-structured-area'),
      feature: pose('the most important verified construction detail or attachment is isolated in a product-specific detail study', 'controlled close-up environment without invented props', 'the selected feature is closest to the lens while identity remains clear', 'macro or close side viewpoint selected for the feature', 'rotated to expose the verified detail', 'tight crop preserving enough context to identify the product', 'feature-detail-selected'),
      final: pose('the product is shown in a new finished showcase arrangement that closes the gallery', 'aspirational neutral environment distinct from the hero and usage scenes', 'product leads from a new frame position with a calm editorial balance', 'low, overhead, or opposite-corner viewpoint selected from unused presentations', 'new resting or action orientation not used by the previous slots', 'clean final crop with the complete product visible', 'final-new-showcase'),
    },
  ],
});

const PREMIUM_VISUAL_STYLE = Object.freeze([
  'high-end commercial product photography',
  'premium modern e-commerce aesthetic',
  'editorial composition',
  'professional studio lighting',
  'controlled highlights',
  'realistic contact shadows',
  'realistic materials',
  'clean visual hierarchy',
  'restrained typography',
  'low visual noise',
  'premium neutral environments',
  'no cheap marketplace banner aesthetic',
  'no recycled generic infographic template; use a product-specific layout',
  'no random AI decor',
]);

export const PHOTO_GENERATION_POLICY = deepFreeze({
  preserveBrand: true,
  allowModelText: false,
  allowUnverifiedClaims: false,
  allowUnverifiedAccessories: false,
  allowInventedSpecifications: false,
  requirePremiumVisualContract: true,
  requireVisualQa: true,
  width: 1280,
  height: 1280,
  format: 'png',
  roles: [...PHOTO_ROLE_ORDER],
  premiumVisualStyle: [...PREMIUM_VISUAL_STYLE],
  roleContracts: ROLE_CONTRACTS,
});

export function getPhotoRoleContract(role) {
  return PHOTO_GENERATION_POLICY.roleContracts[role];
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function productProfileKey(verifiedClaims) {
  const signal = verifiedClaims.map((claim) => `${claim.field}:${claim.value}`).join(' ').toLocaleLowerCase('uk-UA');
  if (/(волос|фен|плой|стайлер|щіт|hair|curl|dryer)/u.test(signal)) return 'hair-styling';
  if (/(контейнер|органайзер|підстав|зберіган|полиц|storage)/u.test(signal)) return 'storage';
  if (/(сковор|посуд|кух|готув|serving)/u.test(signal)) return 'kitchen';
  return 'general';
}

function poseSummary(photo) {
  return {
    photoIndex: photo.index,
    role: photo.role,
    compositionIntent: photo.compositionIntent,
    productOrientation: photo.productOrientation,
    cameraViewpoint: photo.cameraViewpoint,
    positionKey: photo.positionKey,
  };
}

const ATTACHMENT_FIELDS = new Set([
  'attachment',
  'accessory',
  'accessories',
  'насадка',
  'насадки',
  'аксесуар',
  'аксесуари',
  'комплектація',
  'комплект',
].map(normalizedField));

function hasAttachmentClaim(verifiedClaims) {
  return verifiedClaims.some((claim) => ATTACHMENT_FIELDS.has(normalizedField(claim.field)));
}

function adaptFeaturePose(featurePose, hasAttachment) {
  if (hasAttachment) return featurePose;
  return Object.fromEntries(Object.entries(featurePose).map(([key, value]) => [
    key,
    value
      .replace(/one verified attachment/gu, 'one verified construction detail')
      .replace(/the attachment visibly connected or beside it/gu, 'the verified detail facing the camera')
      .replace(/included component/gu, 'verified construction detail')
      .replace(/attachment/gu, 'verified detail'),
  ]));
}

/**
 * Select all five product-specific presentations before any provider call.
 * Source references affect identity context only; they never prescribe the
 * generated composition.
 */
export function buildProductVisualPlan({ productKey, verifiedClaims, sourceImageRefs }) {
  if (typeof productKey !== 'string' || !productKey.trim()) throw new TypeError('productKey must be a non-empty string');
  if (!Array.isArray(verifiedClaims) || verifiedClaims.length === 0) throw new TypeError('verifiedClaims must be a non-empty array');
  if (!Array.isArray(sourceImageRefs) || sourceImageRefs.length === 0) throw new TypeError('sourceImageRefs must be a non-empty array');
  const profileKey = productProfileKey(verifiedClaims);
  const variants = PRODUCT_POSE_LIBRARY[profileKey] ?? PRODUCT_POSE_LIBRARY.general;
  const sourceSignature = sourceImageRefs.map((image) => `${image.id}:${image.role ?? ''}`).join('|');
  const variantIndex = stableHash(`${productKey}|${profileKey}|${sourceSignature}|${verifiedClaims.map((claim) => `${claim.field}:${claim.value}`).join('|')}`) % variants.length;
  const variant = variants[variantIndex];
  const attachmentVerified = hasAttachmentClaim(verifiedClaims);
  const selected = PHOTO_ROLE_ORDER.map((role, index) => ({
    index: index + 1,
    role,
    ...(role === 'feature' ? adaptFeaturePose(variant[role], attachmentVerified) : variant[role]),
    profileKey,
    variantKey: `${profileKey}-${variantIndex}`,
  }));
  return selected.map((photo, index) => ({
    ...photo,
    usedPosesToAvoid: selected.slice(0, index).map(poseSummary),
  }));
}

export function isModelFactKey(key) {
  const normalized = String(key).toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '');
  return ['model', 'modelid', 'modelnumber', 'sku', 'suppliersku', 'article', 'artikul'].includes(normalized);
}

export function isBrandFactKey(key) {
  return ['brand', 'manufacturer', 'producer', 'vendor', 'виробник', 'бренд'].includes(String(key).trim().toLocaleLowerCase('uk-UA'));
}

function normalizedField(key) {
  return String(key).trim().toLocaleLowerCase('uk-UA').replace(/[\s_-]+/gu, '');
}

function firstClaim(claims, fields) {
  const wanted = new Set(fields.map(normalizedField));
  return claims.find((claim) => wanted.has(normalizedField(claim.field)));
}

function typeClaim(claims) {
  return firstClaim(claims, ['type', 'productType', 'товар', 'тип', 'category', 'категорія']);
}

function useClaim(claims) {
  return firstClaim(claims, ['purpose', 'usage', 'application', 'use', 'призначення', 'застосування', 'сфера використання']);
}

function usefulClaims(claims) {
  const excludedTypeFields = new Set(['type', 'productType', 'товар', 'тип', 'category', 'категорія'].map(normalizedField));
  return claims.filter((claim) => !isEconomicFactKey(claim.field)
    && !isModelFactKey(claim.field)
    && !isBrandFactKey(claim.field)
    && !excludedTypeFields.has(normalizedField(claim.field)));
}

function copyClaim(field, value) {
  return { field, value };
}

/** Build short, role-specific Ukrainian copy from verified source facts only. */
export function buildPhotoCopy(role, verifiedClaims) {
  if (!Array.isArray(verifiedClaims)) throw new TypeError('verifiedClaims must be an array');
  const type = typeClaim(verifiedClaims);
  if (!type) return null;
  const usage = useClaim(verifiedClaims);
  const brand = verifiedClaims.find((claim) => isBrandFactKey(claim.field));
  const facts = usefulClaims(verifiedClaims);
  const feature = firstClaim(verifiedClaims, [
    'attachment',
    'accessory',
    'accessories',
    'насадка',
    'насадки',
    'аксесуар',
    'аксесуари',
    'комплектація',
    'комплект',
  ]) ?? facts[0];
  const copy = {
    hero: {
      headline: type.value,
      subtitle: brand?.value ?? (usage ? `Для ${usage.value}` : 'Продумане рішення'),
      supportingFacts: [],
    },
    usage: {
      headline: usage ? `Для ${usage.value}` : 'Зручно користуватися',
      subtitle: type.value,
      supportingFacts: [],
    },
    benefits: {
      headline: `Переваги: ${type.value}`,
      subtitle: undefined,
      supportingFacts: facts.slice(0, 3),
    },
    feature: {
      headline: 'Важлива деталь',
      subtitle: undefined,
      supportingFacts: feature ? [feature] : [],
    },
    final: {
      headline: type.value,
      subtitle: undefined,
      supportingFacts: [],
    },
  }[role];
  if (!copy) throw new TypeError('photo role is not in the central photo policy');
  return {
    headline: copy.headline,
    ...(copy.subtitle === undefined ? {} : { subtitle: copy.subtitle }),
    supportingFacts: copy.supportingFacts.map((claim) => copyClaim(claim.field, claim.value)),
  };
}

function claimString(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function promptClaims(claims) {
  if (!Array.isArray(claims)) throw new TypeError('photo.verifiedClaims must be an array');
  return claims.filter((claim) => isRecordValue(claim)
    && typeof claim.field === 'string'
    && typeof claim.value === 'string'
    && !isEconomicFactKey(claim.field)
    && !isModelFactKey(claim.field));
}

export function promptText(photo) {
  if (!isRecordValue(photo.photoCopy)) return [];
  const copy = photo.photoCopy;
  const items = copy.headline === undefined ? [] : [{ kind: 'headline', language: 'uk', value: copy.headline }];
  if (copy.subtitle !== undefined) items.push({ kind: 'subtitle', language: 'uk', value: copy.subtitle });
  for (const claim of copy.supportingFacts ?? []) items.push({ kind: 'supporting-fact', language: 'uk', value: claim.value });
  return items;
}

function poseLabel(pose) {
  return `photo ${pose.photoIndex} (${pose.role}): ${pose.compositionIntent}; orientation ${pose.productOrientation}; viewpoint ${pose.cameraViewpoint}; position ${pose.positionKey}`;
}

export function formatUsedPoses(poses) {
  if (!Array.isArray(poses) || poses.length === 0) return 'none; every planned presentation is still available';
  return poses.map(poseLabel).join(' | ');
}

function sourceClaimSet(sourceFacts) {
  if (sourceFacts === undefined) return null;
  if (!isRecordValue(sourceFacts)) throw new TypeError('sourceFacts must be an object');
  return new Set(Object.entries(sourceFacts).flatMap(([field, value]) => {
    const stringValue = claimString(value);
    return stringValue === null ? [] : [`${field}\u0000${stringValue}`];
  }));
}

function validateCopy(photo, allowedSourceClaims) {
  if (!isRecordValue(photo.photoCopy)) throw new TypeError('planned photo must contain photoCopy');
  const copy = photo.photoCopy;
  for (const key of Object.keys(copy)) if (!['headline', 'subtitle', 'supportingFacts'].includes(key)) throw new TypeError(`Unsupported photoCopy field: ${key}`);
  for (const key of ['headline', 'subtitle']) {
    if (copy[key] !== undefined && (typeof copy[key] !== 'string' || !copy[key].trim())) throw new TypeError(`photoCopy.${key} must be a non-empty string`);
  }
  if (!Array.isArray(copy.supportingFacts)) throw new TypeError('photoCopy.supportingFacts must be an array');
  for (const claim of copy.supportingFacts) {
    if (!isRecordValue(claim) || typeof claim.field !== 'string' || typeof claim.value !== 'string' || !claim.field.trim() || !claim.value.trim()) {
      throw new TypeError('photoCopy.supportingFacts require field and value strings');
    }
    if (isEconomicFactKey(claim.field) || isModelFactKey(claim.field)) throw new TypeError('photoCopy cannot expose economic facts or model identifiers');
    if (allowedSourceClaims && !allowedSourceClaims.has(`${claim.field}\u0000${claim.value}`)) throw new TypeError('photoCopy contains an unverified supporting fact');
  }
}

/** Validate the central pre-generation policy without inspecting image pixels. */
export function validatePhotoPromptContract(photo, options = {}) {
  if (!isRecordValue(photo)) throw new TypeError('planned photo must be an object');
  const role = photo.role;
  const contract = getPhotoRoleContract(role);
  if (!contract || !PHOTO_ROLE_ORDER.includes(role)) throw new TypeError('planned photo role is not in the central photo policy');
  if (photo.objective !== contract.objective) throw new TypeError(`planned ${role} photo objective violates the central photo policy`);
  if (!isRecordValue(photo.visualDirection)
    || ['compositionKey', 'compositionIntent', 'scene', 'sceneIntent', 'productPlacement', 'cameraAngle', 'cameraViewpoint', 'productOrientation', 'crop', 'cropIntent', 'positionKey', 'variation'].some((key) => typeof photo.visualDirection[key] !== 'string' || !photo.visualDirection[key].trim())
    || !photo.visualDirection.variation.startsWith('product-specific-')
    || !photo.visualDirection.variation.endsWith(`-${role}`)
    || !Array.isArray(photo.visualDirection.usedPosesToAvoid)
    || photo.visualDirection.usedPosesToAvoid.some((pose) => !isRecordValue(pose) || !Number.isSafeInteger(pose.photoIndex) || typeof pose.role !== 'string' || typeof pose.compositionIntent !== 'string' || typeof pose.productOrientation !== 'string' || typeof pose.cameraViewpoint !== 'string' || typeof pose.positionKey !== 'string')) {
    throw new TypeError(`planned ${role} photo visual direction violates the central photo policy`);
  }
  if (!Array.isArray(photo.verifiedClaims)) throw new TypeError('planned photo verifiedClaims must be an array');
  const allowedSourceClaims = sourceClaimSet(options.sourceFacts);
  for (const claim of photo.verifiedClaims) {
    if (!isRecordValue(claim) || typeof claim.field !== 'string' || typeof claim.value !== 'string') {
      throw new TypeError('planned photo claim is invalid');
    }
    if (isEconomicFactKey(claim.field)) throw new TypeError('economic claims are forbidden by the central photo policy');
    if (allowedSourceClaims && !allowedSourceClaims.has(`${claim.field}\u0000${claim.value}`)) {
      throw new TypeError('planned photo contains an unverified claim');
    }
  }
  validateCopy(photo, allowedSourceClaims);
  if (!Array.isArray(photo.text)) throw new TypeError('planned photo text must be an array');
  const expectedText = promptText(photo);
  if (!sameJson(photo.text, expectedText)) throw new TypeError('planned photo visible text must be generated from photoCopy');
  const modelValues = photo.verifiedClaims.filter((claim) => isModelFactKey(claim.field)).map((claim) => claim.value);
  if (photo.text.some((item) => modelValues.some((model) => model && item.value.includes(model)))) {
    throw new TypeError('model identifiers must not appear in visible photo text');
  }
  return true;
}
