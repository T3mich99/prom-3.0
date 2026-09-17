export const PHOTO_STATUSES = Object.freeze({
  READY: 'READY',
  REVIEW: 'REVIEW',
  REWORK: 'REWORK',
});

export const PHOTO_ACCEPTED_DIMENSIONS = Object.freeze([
  Object.freeze({ width: 1280, height: 1280 }),
  Object.freeze({ width: 1254, height: 1254 }),
]);

export function isAcceptedPhotoDimensions(width, height) {
  return PHOTO_ACCEPTED_DIMENSIONS.some((dimensions) => dimensions.width === width && dimensions.height === height);
}

export const PHOTO_ROLE_ORDER = Object.freeze([
  'hero',
  'usage',
  'benefits',
  'feature',
  'final',
]);

export const PHOTO_ROLE_DEFINITIONS = Object.freeze({
  hero: Object.freeze({
    purpose: 'immediately communicate what the product is',
    objective: 'Show the exact product large and dominant in a clean listing composition.',
    maxTextElements: 2,
  }),
  usage: Object.freeze({
    purpose: 'show a realistic use or result scenario',
    objective: 'Show where and how the buyer uses the exact product in a believable context.',
    maxTextElements: 2,
  }),
  benefits: Object.freeze({
    purpose: 'show two to four verified benefits or characteristics',
    objective: 'Explain a small set of the strongest verified attributes with concise Ukrainian microcopy.',
    maxTextElements: 4,
  }),
  feature: Object.freeze({
    purpose: 'explain one major feature or function',
    objective: 'Visually explain one important verified feature without inventing accessories or performance.',
    maxTextElements: 2,
  }),
  final: Object.freeze({
    purpose: 'complete the gallery with a clean final selling image',
    objective: 'Present the exact product in a distinct clean gallery composition with minimal copy.',
    maxTextElements: 1,
  }),
});

const DEFAULT_TEXT_LIMITS = Object.freeze({
  hero: 2,
  usage: 2,
  benefits: 4,
  feature: 2,
  final: 1,
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function clone(value) {
  return structuredClone(value);
}

function mergePolicy(base, override) {
  const merged = clone(base);
  for (const [key, value] of Object.entries(override)) {
    if (key === 'text') {
      const { maxElementsByRole, ...textValues } = value;
      Object.assign(merged.text, textValues);
      if (maxElementsByRole) merged.text.maxElementsByRole = { ...merged.text.maxElementsByRole, ...maxElementsByRole };
    }
    else if (key === 'duplicate') Object.assign(merged.duplicate, value);
    else if (key === 'fidelity') Object.assign(merged.fidelity, value);
    else merged[key] = value;
  }
  return merged;
}

export const DEFAULT_PHOTO_QUALITY_POLICY = deepFreeze({
  requiredPhotoCount: 5,
  width: 1280,
  height: 1280,
  roleOrder: [...PHOTO_ROLE_ORDER],
  allowedFormats: ['png', 'jpg', 'jpeg'],
  text: {
    maxElementsByRole: { ...DEFAULT_TEXT_LIMITS },
    maxCharactersPerElement: 160,
  },
  duplicate: {
    repeatedMetadataSeverity: 'review',
  },
  fidelity: {
    requireSourceImageRefs: true,
  },
});

const POLICY_KEYS = new Set(Object.keys(DEFAULT_PHOTO_QUALITY_POLICY));
const TEXT_POLICY_KEYS = new Set(Object.keys(DEFAULT_PHOTO_QUALITY_POLICY.text));
const DUPLICATE_POLICY_KEYS = new Set(Object.keys(DEFAULT_PHOTO_QUALITY_POLICY.duplicate));
const FIDELITY_POLICY_KEYS = new Set(Object.keys(DEFAULT_PHOTO_QUALITY_POLICY.fidelity));

export function resolvePhotoQualityPolicy(override = {}) {
  assertRecord(override, 'photo policy override');
  for (const section of Object.keys(override)) {
    if (!POLICY_KEYS.has(section)) throw new TypeError(`Unsupported photo policy section: ${section}`);
    if (!isRecord(override[section]) && !['requiredPhotoCount', 'width', 'height', 'roleOrder', 'allowedFormats'].includes(section)) {
      throw new TypeError(`photo policy.${section} must be an object`);
    }
  }
  if ('requiredPhotoCount' in override && !Number.isSafeInteger(override.requiredPhotoCount)) {
    throw new TypeError('photo policy.requiredPhotoCount must be a positive integer');
  }
  if ('width' in override && !Number.isSafeInteger(override.width)) throw new TypeError('photo policy.width must be a positive integer');
  if ('height' in override && !Number.isSafeInteger(override.height)) throw new TypeError('photo policy.height must be a positive integer');
  if ('roleOrder' in override && !Array.isArray(override.roleOrder)) throw new TypeError('photo policy.roleOrder must be an array');
  if ('allowedFormats' in override && !Array.isArray(override.allowedFormats)) throw new TypeError('photo policy.allowedFormats must be an array');
  if (override.text) {
    for (const key of Object.keys(override.text)) {
      if (!TEXT_POLICY_KEYS.has(key)) throw new TypeError(`Unsupported photo policy option: text.${key}`);
    }
    if (override.text.maxElementsByRole !== undefined) {
      assertRecord(override.text.maxElementsByRole, 'photo policy.text.maxElementsByRole');
      for (const role of Object.keys(override.text.maxElementsByRole)) {
        if (!PHOTO_ROLE_ORDER.includes(role)) throw new TypeError(`Unsupported photo text role: ${role}`);
      }
    }
  }
  if (override.duplicate) {
    for (const key of Object.keys(override.duplicate)) {
      if (!DUPLICATE_POLICY_KEYS.has(key)) throw new TypeError(`Unsupported photo policy option: duplicate.${key}`);
    }
  }
  if (override.fidelity) {
    for (const key of Object.keys(override.fidelity)) {
      if (!FIDELITY_POLICY_KEYS.has(key)) throw new TypeError(`Unsupported photo policy option: fidelity.${key}`);
    }
  }

  const merged = mergePolicy(DEFAULT_PHOTO_QUALITY_POLICY, override);
  for (const [name, value] of Object.entries({
    requiredPhotoCount: merged.requiredPhotoCount,
    width: merged.width,
    height: merged.height,
    'text.maxCharactersPerElement': merged.text.maxCharactersPerElement,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`photo policy.${name} must be a positive integer`);
  }
  if (merged.requiredPhotoCount !== 5) throw new TypeError('photo policy.requiredPhotoCount must be exactly 5 in v1');
  if (merged.width !== 1280 || merged.height !== 1280) throw new TypeError('photo policy dimensions must be exactly 1280x1280 in v1');
  if (new Set(merged.roleOrder).size !== PHOTO_ROLE_ORDER.length || !sameJson(merged.roleOrder, PHOTO_ROLE_ORDER)) {
    throw new TypeError('photo policy.roleOrder must match the canonical five-photo order in v1');
  }
  if (!Array.isArray(merged.allowedFormats) || merged.allowedFormats.length === 0) {
    throw new TypeError('photo policy.allowedFormats must be a non-empty array');
  }
  if (new Set(merged.allowedFormats).size !== merged.allowedFormats.length
    || merged.allowedFormats.some((format) => typeof format !== 'string' || !['png', 'jpg', 'jpeg'].includes(format.toLowerCase()))) {
    throw new TypeError('photo policy.allowedFormats may contain only png, jpg, or jpeg without duplicates');
  }
  for (const role of PHOTO_ROLE_ORDER) {
    const limit = merged.text.maxElementsByRole[role];
    if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError(`photo policy.text.maxElementsByRole.${role} must be a non-negative integer`);
  }
  if (!['review', 'rework'].includes(merged.duplicate.repeatedMetadataSeverity)) {
    throw new TypeError('photo policy.duplicate.repeatedMetadataSeverity must be review or rework');
  }
  if (typeof merged.fidelity.requireSourceImageRefs !== 'boolean') {
    throw new TypeError('photo policy.fidelity.requireSourceImageRefs must be boolean');
  }
  merged.allowedFormats = merged.allowedFormats.map((format) => format.toLowerCase());
  return deepFreeze(merged);
}

export const ECONOMIC_FACT_TOKENS = Object.freeze([
  'price',
  'cost',
  'commission',
  'margin',
  'profit',
  'currency',
  'delivery',
  'market',
]);

export function isEconomicFactKey(key) {
  const normalized = String(key).toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '');
  return ECONOMIC_FACT_TOKENS.some((token) => normalized.includes(token))
    || ['rrp', 'purchaseprice', 'supplierprice', 'purchasecost', 'priceprom'].includes(normalized);
}

export function assertSourceImages(sourceImages) {
  if (!Array.isArray(sourceImages)) throw new TypeError('sourceImages must be an array');
  return sourceImages.map((image, index) => {
    assertRecord(image, `sourceImages[${index}]`);
    for (const key of Object.keys(image)) {
      if (!['id', 'url', 'path', 'reference', 'role', 'provenance'].includes(key)) {
        throw new TypeError(`Unsupported sourceImages[${index}] field: ${key}`);
      }
    }
    if (typeof image.id !== 'string' || !image.id.trim()) throw new TypeError(`sourceImages[${index}].id must be a non-empty string`);
    const referenceKey = ['url', 'path', 'reference'].find((key) => typeof image[key] === 'string' && image[key].trim());
    if (!referenceKey) throw new TypeError(`sourceImages[${index}] must contain url, path, or reference`);
    for (const key of ['role', 'provenance']) {
      if (image[key] !== undefined && typeof image[key] !== 'string') throw new TypeError(`sourceImages[${index}].${key} must be a string`);
    }
    const result = {
      id: image.id,
      reference: image[referenceKey],
    };
    if (image.role !== undefined) result.role = image.role;
    if (image.provenance !== undefined) result.provenance = image.provenance;
    return result;
  });
}

export function assertPhotoTextElements(text, label = 'text') {
  if (!Array.isArray(text)) throw new TypeError(`${label} must be an array`);
  return text.map((element, index) => {
    assertRecord(element, `${label}[${index}]`);
    for (const key of Object.keys(element)) {
      if (!['kind', 'language', 'value'].includes(key)) throw new TypeError(`Unsupported ${label}[${index}] field: ${key}`);
    }
    if (typeof element.kind !== 'string' || !element.kind.trim()) throw new TypeError(`${label}[${index}].kind must be a non-empty string`);
    if (element.language !== 'uk') throw new TypeError(`${label}[${index}].language must be uk`);
    if (typeof element.value !== 'string' || !element.value.trim()) throw new TypeError(`${label}[${index}].value must be a non-empty string`);
    return { kind: element.kind, language: element.language, value: element.value };
  });
}

export function assetReference(asset) {
  if (!isRecord(asset)) return '';
  for (const key of ['reference', 'url', 'path']) {
    if (typeof asset[key] === 'string' && asset[key].trim()) return asset[key];
  }
  return '';
}

export function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function aggregatePhotoStatus(statuses) {
  if (statuses.includes(PHOTO_STATUSES.REWORK)) return PHOTO_STATUSES.REWORK;
  if (statuses.includes(PHOTO_STATUSES.REVIEW)) return PHOTO_STATUSES.REVIEW;
  return PHOTO_STATUSES.READY;
}

export function isRecordValue(value) {
  return isRecord(value);
}
