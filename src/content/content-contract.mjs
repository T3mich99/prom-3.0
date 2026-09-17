export const CONTENT_FIELDS = Object.freeze([
  'title',
  'description',
  'keywords',
  'characteristics',
]);

export const CONTENT_LANGUAGES = Object.freeze(['ru', 'ua']);

const TEXT_FIELDS = new Set(['title', 'description', 'keywords']);
const ALLOWED_ARTIFACT_KEYS = new Set(['productKey', 'version', 'content', 'sourceFacts', 'claims']);
const ALLOWED_CLAIM_KEYS = new Set(['field', 'value', 'contentField']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function clone(value) {
  return structuredClone(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function assertLocalizedField(value, field) {
  assertRecord(value, `content.${field}`);
  for (const key of Object.keys(value)) {
    if (!CONTENT_LANGUAGES.includes(key)) throw new TypeError(`Unsupported language in content.${field}: ${key}`);
    if (typeof value[key] !== 'string') throw new TypeError(`content.${field}.${key} must be a string`);
  }
}

function assertCharacteristics(value) {
  if (!Array.isArray(value)) throw new TypeError('content.characteristics must be an array');
  for (const [index, item] of value.entries()) {
    assertRecord(item, `content.characteristics[${index}]`);
    for (const key of ['name', 'value']) {
      if (key in item && typeof item[key] !== 'string') {
        throw new TypeError(`content.characteristics[${index}].${key} must be a string`);
      }
    }
  }
}

function assertClaims(value) {
  if (!Array.isArray(value)) throw new TypeError('claims must be an array');
  for (const [index, claim] of value.entries()) {
    assertRecord(claim, `claims[${index}]`);
    for (const key of Object.keys(claim)) {
      if (!ALLOWED_CLAIM_KEYS.has(key)) throw new TypeError(`Unsupported claim field: ${key}`);
    }
    if (typeof claim.field !== 'string' || !claim.field.trim()) {
      throw new TypeError(`claims[${index}].field must be a non-empty string`);
    }
    if (typeof claim.value !== 'string' || !claim.value.trim()) {
      throw new TypeError(`claims[${index}].value must be a non-empty string`);
    }
    if (claim.contentField !== undefined && !CONTENT_FIELDS.includes(claim.contentField)) {
      throw new TypeError(`Unsupported claim content field: ${claim.contentField}`);
    }
  }
}

export function validateContentArtifactStructure(artifact) {
  assertRecord(artifact, 'artifact');
  for (const key of Object.keys(artifact)) {
    if (!ALLOWED_ARTIFACT_KEYS.has(key)) throw new TypeError(`Unsupported artifact field: ${key}`);
  }
  if (typeof artifact.productKey !== 'string' || !artifact.productKey.trim()) {
    throw new TypeError('productKey must be a non-empty string');
  }
  if (!Number.isSafeInteger(artifact.version) || artifact.version < 1) {
    throw new TypeError('version must be a positive integer');
  }
  assertRecord(artifact.content, 'content');
  for (const key of Object.keys(artifact.content)) {
    if (!CONTENT_FIELDS.includes(key)) throw new TypeError(`Unsupported content field: ${key}`);
    if (TEXT_FIELDS.has(key)) assertLocalizedField(artifact.content[key], key);
    if (key === 'characteristics') assertCharacteristics(artifact.content[key]);
  }
  if (artifact.sourceFacts !== undefined) assertRecord(artifact.sourceFacts, 'sourceFacts');
  if (artifact.claims !== undefined) assertClaims(artifact.claims);
  return true;
}

export function applyContentFieldRework(originalArtifact, replacements) {
  validateContentArtifactStructure(originalArtifact);
  assertRecord(replacements, 'replacements');
  for (const field of Object.keys(replacements)) {
    if (!CONTENT_FIELDS.includes(field)) throw new TypeError(`Unsupported replacement field: ${field}`);
  }

  const result = clone(originalArtifact);
  const replacementFields = Object.keys(replacements);
  if (replacementFields.length === 0) return result;

  for (const field of replacementFields) result.content[field] = clone(replacements[field]);
  result.version += 1;
  validateContentArtifactStructure(result);
  return result;
}
