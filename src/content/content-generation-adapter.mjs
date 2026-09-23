import {
  CONTENT_FIELDS,
  applyContentFieldRework,
  validateContentArtifactStructure,
} from './content-contract.mjs';
import { CONTENT_STATUSES, validateContentArtifact } from './content-quality.mjs';
import {
  COMMERCIAL_CONTENT_PROFILE,
  validateCommercialContentArtifact,
} from './commercial-content-quality.mjs';
import {
  buildContentGenerationRequest,
  buildContentReworkRequest,
  stableJson,
  validateContentGenerationInput,
} from './content-generation-prompt.mjs';

const INITIAL_INPUT_OPTIONS = new Set(['generator', 'policy', 'commercialPolicy', 'profile', 'editorialHistory']);
const REWORK_INPUT_KEYS = new Set(['artifact', 'quality', 'sourceFacts']);
const RESPONSE_TOP_LEVEL_KEYS = new Set(['content', 'claims']);
const REWORK_RESPONSE_TOP_LEVEL_KEYS = new Set(['content']);
const CONTENT_KEYS = new Set(CONTENT_FIELDS);
const LOCALIZED_CONTENT_FIELDS = new Set(['title', 'description', 'keywords']);
const CHARACTERISTIC_KEYS = new Set(['name', 'value']);
const CLAIM_KEYS = new Set(['field', 'value', 'contentField']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function validateOptions(options) {
  assertRecord(options, 'options');
  for (const key of Object.keys(options)) {
    if (!INITIAL_INPUT_OPTIONS.has(key)) throw new TypeError(`Unsupported generation option: ${key}`);
  }
  if (typeof options.generator !== 'function') throw new TypeError('options.generator must be a function');
  if (options.profile !== undefined && !['base-v1', COMMERCIAL_CONTENT_PROFILE].includes(options.profile)) {
    throw new TypeError(`Unsupported content profile: ${options.profile}`);
  }
  if (options.commercialPolicy !== undefined && !isRecord(options.commercialPolicy)) {
    throw new TypeError('options.commercialPolicy must be an object');
  }
  if (options.editorialHistory !== undefined && !Array.isArray(options.editorialHistory)) {
    throw new TypeError('options.editorialHistory must be an array');
  }
}

function qualityFor(artifact, options) {
  const profile = options.profile ?? COMMERCIAL_CONTENT_PROFILE;
  if (profile === COMMERCIAL_CONTENT_PROFILE) {
    const qualityOptions = {};
    if (options.policy !== undefined) qualityOptions.basePolicy = options.policy;
    if (options.commercialPolicy !== undefined) qualityOptions.policy = options.commercialPolicy;
    if (options.editorialHistory !== undefined) qualityOptions.editorialHistory = options.editorialHistory;
    return validateCommercialContentArtifact(artifact, qualityOptions);
  }
  return validateContentArtifact(artifact, options.policy === undefined ? {} : { policy: options.policy });
}

function responseError(message, cause = undefined, details = undefined) {
  return new ContentGenerationError(message, 'GENERATOR_RESPONSE_INVALID', details, cause);
}

function parseRawResponse(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw responseError('Generator returned invalid JSON', error);
    }
  }
  if (!isRecord(parsed)) throw responseError('Generator response must be a JSON object');
  try {
    return structuredClone(parsed);
  } catch (error) {
    throw responseError('Generator response must contain cloneable JSON-compatible values', error);
  }
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw responseError(`Unknown ${label} field: ${key}`);
  }
}

function parseLocalizedField(value, field) {
  if (!isRecord(value)) throw responseError(`Generated content.${field} must be an object`);
  assertAllowedKeys(value, new Set(['ru', 'ua']), `content.${field}`);
  for (const language of ['ru', 'ua']) {
    if (hasOwn(value, language) && typeof value[language] !== 'string') {
      throw responseError(`Generated content.${field}.${language} must be a string`);
    }
  }
  return value;
}

function parseCharacteristics(value) {
  if (!Array.isArray(value)) throw responseError('Generated content.characteristics must be an array');
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) throw responseError(`Generated content.characteristics[${index}] must be an object`);
    assertAllowedKeys(item, CHARACTERISTIC_KEYS, `content.characteristics[${index}]`);
    for (const key of CHARACTERISTIC_KEYS) {
      if (hasOwn(item, key) && typeof item[key] !== 'string') {
        throw responseError(`Generated content.characteristics[${index}].${key} must be a string`);
      }
    }
  }
  return value;
}

function parseContent(value) {
  if (!isRecord(value)) throw responseError('Generator response.content must be an object');
  assertAllowedKeys(value, CONTENT_KEYS, 'content');
  const content = {};
  for (const field of Object.keys(value)) {
    content[field] = LOCALIZED_CONTENT_FIELDS.has(field)
      ? parseLocalizedField(value[field], field)
      : parseCharacteristics(value[field]);
  }
  return content;
}

function parseClaims(value) {
  if (!Array.isArray(value)) throw responseError('Generator response.claims must be an array');
  for (const [index, claim] of value.entries()) {
    if (!isRecord(claim)) throw responseError(`Generator response.claims[${index}] must be an object`);
    assertAllowedKeys(claim, CLAIM_KEYS, `claims[${index}]`);
  }
  return value;
}

function parseStructuredResponse(raw, { reworkFields = null } = {}) {
  const parsed = parseRawResponse(raw);
  const allowedTopLevel = reworkFields === null ? RESPONSE_TOP_LEVEL_KEYS : REWORK_RESPONSE_TOP_LEVEL_KEYS;
  assertAllowedKeys(parsed, allowedTopLevel, 'top-level response');
  if (!hasOwn(parsed, 'content')) throw responseError('Generator response.content is required');

  const content = parseContent(parsed.content);
  if (reworkFields !== null) {
    const expected = new Set(reworkFields);
    for (const field of Object.keys(content)) {
      if (!expected.has(field)) throw responseError(`Rework response contains unrequested field: ${field}`);
    }
    for (const field of expected) {
      if (!hasOwn(content, field)) throw responseError(`Rework response is missing requested field: ${field}`);
    }
  }

  const result = { content };
  if (hasOwn(parsed, 'claims')) result.claims = parseClaims(parsed.claims);
  return result;
}

function assertArtifactStructure(artifact) {
  try {
    validateContentArtifactStructure(artifact);
  } catch (error) {
    throw new ContentGenerationError('Generated content does not satisfy the Content Artifact structure', 'CONTENT_ARTIFACT_INVALID', undefined, error);
  }
}

async function callGenerator(generator, request) {
  try {
    return await generator(request);
  } catch (error) {
    throw new ContentGenerationError('Injected content generator failed', 'GENERATOR_FAILURE', undefined, error);
  }
}

function generationResult({ artifact, quality, operation, fields }) {
  return {
    status: quality.status,
    artifact,
    quality,
    reworkPlan: quality.reworkPlan,
    generation: {
      operation,
      fields: [...fields],
    },
  };
}

function validateReworkInput(input, options) {
  assertRecord(input, 'rework input');
  for (const key of Object.keys(input)) {
    if (!REWORK_INPUT_KEYS.has(key)) throw new TypeError(`Unsupported rework input field: ${key}`);
  }
  assertRecord(input.artifact, 'rework input.artifact');
  assertRecord(input.quality, 'rework input.quality');
  if (!hasOwn(input, 'sourceFacts')) throw new TypeError('rework input.sourceFacts is required');
  assertArtifactStructure(input.artifact);
  validateContentGenerationInput({ productKey: input.artifact.productKey, sourceFacts: input.sourceFacts });
  const artifactFacts = input.artifact.sourceFacts ?? {};
  if (stableJson(artifactFacts) !== stableJson(input.sourceFacts)) {
    throw new ContentGenerationError('Rework sourceFacts must exactly match artifact.sourceFacts', 'SOURCE_FACTS_MISMATCH');
  }
  const currentQuality = qualityFor(input.artifact, options);
  if (stableJson(input.quality) !== stableJson(currentQuality)) {
    throw new ContentGenerationError('Supplied quality result does not match the current artifact quality', 'QUALITY_RESULT_MISMATCH');
  }
  if (currentQuality.status !== CONTENT_STATUSES.REWORK || !Array.isArray(currentQuality.reworkPlan?.fields) || currentQuality.reworkPlan.fields.length === 0) {
    throw new ContentGenerationError('Only a REWORK quality result can start field-level rework', 'REWORK_NOT_ELIGIBLE');
  }
  const fields = currentQuality.reworkPlan.fields.map((entry) => {
    if (!isRecord(entry) || !CONTENT_FIELDS.includes(entry.field) || !Array.isArray(entry.reasonCodes)
      || entry.reasonCodes.some((code) => typeof code !== 'string')) {
        throw new TypeError('quality.reworkPlan.fields has an invalid entry');
    }
    return { field: entry.field, reasonCodes: [...entry.reasonCodes] };
  });
  if (new Set(fields.map((entry) => entry.field)).size !== fields.length) {
    throw new TypeError('quality.reworkPlan.fields must not contain duplicate fields');
  }
  return fields;
}

/** Generate one version-1 Content Artifact through an injected provider-neutral generator. */
export async function generateContentArtifact(input, options = {}) {
  validateOptions(options);
  validateContentGenerationInput(input);
  const request = buildContentGenerationRequest(input);
  const rawResponse = await callGenerator(options.generator, request);
  const response = parseStructuredResponse(rawResponse);
  const artifact = {
    productKey: input.productKey,
    version: 1,
    content: structuredClone(response.content),
    sourceFacts: structuredClone(input.sourceFacts),
  };
  if (response.claims !== undefined) artifact.claims = structuredClone(response.claims);
  assertArtifactStructure(artifact);
  const quality = qualityFor(artifact, options);
  return generationResult({ artifact, quality, operation: 'initial', fields: CONTENT_FIELDS });
}

/** Rework only the fields named by the existing Content Quality reworkPlan. */
export async function reworkContentArtifact(input, options = {}) {
  validateOptions(options);
  const fields = validateReworkInput(input, options);
  const previousValues = Object.fromEntries(fields.map(({ field }) => [field, input.artifact.content[field] ?? null]));
  const request = buildContentReworkRequest({
    productKey: input.artifact.productKey,
    sourceFacts: input.sourceFacts,
    fields,
    previousValues,
  });
  const rawResponse = await callGenerator(options.generator, request);
  const response = parseStructuredResponse(rawResponse, { reworkFields: fields.map((entry) => entry.field) });

  let artifact;
  try {
    artifact = applyContentFieldRework(input.artifact, response.content);
  } catch (error) {
    throw new ContentGenerationError('Reworked content does not satisfy the Content Artifact structure', 'CONTENT_ARTIFACT_INVALID', undefined, error);
  }
  const quality = qualityFor(artifact, options);
  return generationResult({
    artifact,
    quality,
    operation: 'rework',
    fields: fields.map((entry) => entry.field),
  });
}

export class ContentGenerationError extends Error {
  constructor(message, code = 'CONTENT_GENERATION_ERROR', details = undefined, cause = undefined) {
    super(message, cause === undefined ? {} : { cause });
    this.name = 'ContentGenerationError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
