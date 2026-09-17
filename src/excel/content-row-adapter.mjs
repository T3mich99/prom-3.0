import { CANONICAL_FIELDS } from './schema-mapper.mjs';
import { CONTENT_STATUSES, validateContentArtifact } from '../content/content-quality.mjs';

const CONTENT_ROW_INPUT_KEYS = new Set(['selectedProduct', 'contentArtifact', 'resolvedMetadata']);
const CONTENT_CANONICAL_FIELDS = new Set([
  'titleRu',
  'titleUa',
  'descriptionRu',
  'descriptionUa',
  'keywordsRu',
  'keywordsUa',
]);
const DEFERRED_CANONICAL_FIELDS = new Map([
  ['price', 'NO_PROVEN_FINAL_SELLING_PRICE'],
  ['photoUrls', 'NO_PROVEN_APPROVED_MEDIA'],
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function assertPrimitive(value, label) {
  if (value !== null && typeof value !== 'string' && typeof value !== 'boolean'
    && !(typeof value === 'number' && Number.isFinite(value))) {
    throw new TypeError(`${label} must be a primitive cell value`);
  }
}

function validateInput(input) {
  assertRecord(input, 'input');
  for (const key of Object.keys(input)) {
    if (!CONTENT_ROW_INPUT_KEYS.has(key)) throw new TypeError(`Unsupported input field: ${key}`);
  }
  assertRecord(input.selectedProduct, 'selectedProduct');
  if (typeof input.selectedProduct.selectionKey !== 'string' || input.selectedProduct.selectionKey.length === 0) {
    throw new TypeError('selectedProduct.selectionKey must be a non-empty string');
  }
  if (!hasOwn(input.selectedProduct, 'product')) throw new TypeError('selectedProduct.product is required');
  assertRecord(input.contentArtifact, 'contentArtifact');
  const resolvedMetadata = input.resolvedMetadata === undefined ? {} : input.resolvedMetadata;
  assertRecord(resolvedMetadata, 'resolvedMetadata');
  return resolvedMetadata;
}

function validateMetadata(resolvedMetadata) {
  for (const [field, value] of Object.entries(resolvedMetadata)) {
    if (!CANONICAL_FIELDS.includes(field)) throw new TypeError(`Unknown resolved metadata field: ${field}`);
    if (CONTENT_CANONICAL_FIELDS.has(field)) throw new TypeError(`Resolved metadata cannot override content field: ${field}`);
    if (value !== undefined) assertPrimitive(value, `resolvedMetadata.${field}`);
  }
}

function contentRowValues(artifact) {
  return {
    titleRu: artifact.content.title.ru,
    titleUa: artifact.content.title.ua,
    descriptionRu: artifact.content.description.ru,
    descriptionUa: artifact.content.description.ua,
    keywordsRu: artifact.content.keywords.ru,
    keywordsUa: artifact.content.keywords.ua,
  };
}

function deferredFieldsFor(resolvedMetadata) {
  const deferred = [{ field: 'characteristics', reason: 'NO_CANONICAL_EXCEL_TARGET' }];
  for (const [field, reason] of DEFERRED_CANONICAL_FIELDS) {
    if (hasOwn(resolvedMetadata, field) && resolvedMetadata[field] !== undefined) deferred.push({ field, reason });
  }
  return deferred;
}

function buildReadyRow(artifact, resolvedMetadata) {
  const values = { ...contentRowValues(artifact) };
  for (const field of CANONICAL_FIELDS) {
    if (CONTENT_CANONICAL_FIELDS.has(field) || DEFERRED_CANONICAL_FIELDS.has(field)) continue;
    if (hasOwn(resolvedMetadata, field) && resolvedMetadata[field] !== undefined) values[field] = resolvedMetadata[field];
  }
  return Object.fromEntries(CANONICAL_FIELDS.filter((field) => hasOwn(values, field)).map((field) => [field, values[field]]));
}

/**
 * Convert one selected product and its validated content artifact into a
 * canonical semantic row for the Adaptive Excel Writer.
 *
 * The adapter never reads or writes a workbook. It only accepts canonical,
 * already-resolved optional metadata and preserves its values unchanged.
 */
export function buildContentExcelRow(input, options = {}) {
  assertRecord(options, 'options');
  const resolvedMetadata = validateInput(input);
  validateMetadata(resolvedMetadata);

  const { selectedProduct, contentArtifact } = input;
  const quality = validateContentArtifact(contentArtifact, options.policy === undefined ? {} : { policy: options.policy });
  if (selectedProduct.selectionKey !== contentArtifact.productKey) {
    throw new ContentExcelRowAdapterError(
      'selectedProduct.selectionKey must exactly equal contentArtifact.productKey',
      'PRODUCT_IDENTITY_MISMATCH',
      { selectionKey: selectedProduct.selectionKey, productKey: contentArtifact.productKey },
    );
  }

  const ready = quality.status === CONTENT_STATUSES.READY;
  const emittedMetadataFields = CANONICAL_FIELDS.filter((field) => (
    !CONTENT_CANONICAL_FIELDS.has(field)
    && !DEFERRED_CANONICAL_FIELDS.has(field)
    && hasOwn(resolvedMetadata, field)
    && resolvedMetadata[field] !== undefined
  ));

  return {
    status: quality.status,
    productKey: contentArtifact.productKey,
    row: ready ? buildReadyRow(contentArtifact, resolvedMetadata) : null,
    deferredFields: deferredFieldsFor(resolvedMetadata),
    quality,
    provenance: {
      identity: 'selectedProduct.selectionKey=contentArtifact.productKey',
      content: 'contentArtifact',
      resolvedMetadataFields: emittedMetadataFields,
    },
  };
}

export class ContentExcelRowAdapterError extends Error {
  constructor(message, code = 'CONTENT_EXCEL_ROW_ADAPTER_ERROR', details = undefined) {
    super(message);
    this.name = 'ContentExcelRowAdapterError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
