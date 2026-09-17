import {
  buildContentExcelRow,
} from '../excel/content-row-adapter.mjs';
import {
  buildCharacteristicColumnPlan,
} from '../excel/characteristic-column-adapter.mjs';
import {
  CANONICAL_FIELDS,
  mapTemplateSchema,
} from '../excel/schema-mapper.mjs';
import { inspectWorkbook } from '../excel/template-inspector.mjs';
import { writeAdaptiveWorkbook } from '../excel/adaptive-writer.mjs';
import {
  COMMERCIAL_CONTENT_PROFILE,
  validateCommercialContentArtifact,
} from '../content/commercial-content-quality.mjs';
import { CONTENT_STATUSES } from '../content/content-quality.mjs';
import { PHOTO_ROLE_ORDER } from '../photos/photo-contract.mjs';
import { PRICING_STATUSES } from '../pricing/market-pricing.mjs';
import { PRODUCTION_STATUSES } from '../orchestration/production-orchestrator.mjs';

export const FINAL_EXCEL_STATUSES = Object.freeze({
  READY_FOR_EXCEL: 'READY_FOR_EXCEL',
  WAITING_FOR_MEDIA_PUBLICATION: 'WAITING_FOR_MEDIA_PUBLICATION',
  EXPORT_REVIEW: 'EXPORT_REVIEW',
  NEEDS_TEMPLATE_MAPPING: 'NEEDS_TEMPLATE_MAPPING',
  EXPORTED: 'EXPORTED',
  FAILED: 'FAILED',
});

const INPUT_KEYS = new Set(['productionArtifact', 'publishableMedia', 'mapping']);
const PRODUCTION_ARTIFACT_KEYS = new Set([
  'productKey', 'workflowStatus', 'selectedProduct', 'pricingDecision', 'contentArtifact',
  'characteristicPlan', 'approvedMedia', 'resolvedMetadata', 'provenance', 'diagnostics',
]);
const PUBLISHABLE_MEDIA_KEYS = new Set(['productKey', 'version', 'items']);
const PUBLISHABLE_ITEM_KEYS = new Set(['index', 'role', 'approvedAssetRef', 'sha256', 'publicUrl']);
const LOCAL_URL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
const REQUIRED_EXPORT_FIELDS = Object.freeze(['titleRu', 'price', 'photoUrls']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function clone(value) {
  return structuredClone(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new FinalProductExcelBridgeError(`${label} must be an object`, 'INVALID_RECORD');
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new FinalProductExcelBridgeError(`Unsupported ${label} field: ${key}`, 'UNSUPPORTED_FIELD');
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new FinalProductExcelBridgeError(`${label} must be a non-empty string`, 'INVALID_STRING');
  return value;
}

function diagnostic(code, message, details = undefined) {
  return details === undefined ? { code, message } : { code, message, ...details };
}

function blocked(status, productKey, diagnostics, provenance = {}) {
  return {
    status,
    productKey,
    row: null,
    characteristicPlan: null,
    diagnostics: clone(diagnostics),
    provenance: clone(provenance),
  };
}

function assertProductionArtifact(value) {
  assertRecord(value, 'productionArtifact');
  assertKnownKeys(value, PRODUCTION_ARTIFACT_KEYS, 'productionArtifact');
  const productKey = nonEmptyString(value.productKey, 'productionArtifact.productKey');
  if (value.workflowStatus !== PRODUCTION_STATUSES.READY_FOR_EXPORT) {
    return { productKey, issue: diagnostic('PRODUCTION_ARTIFACT_NOT_READY', 'Production artifact must have workflowStatus READY_FOR_EXPORT.') };
  }
  assertRecord(value.selectedProduct, 'productionArtifact.selectedProduct');
  if (value.selectedProduct.selectionKey !== productKey) {
    return { productKey, issue: diagnostic('PRODUCT_IDENTITY_MISMATCH', 'selectedProduct.selectionKey does not match productionArtifact.productKey.') };
  }
  for (const field of ['pricingDecision', 'contentArtifact', 'approvedMedia', 'provenance']) {
    assertRecord(value[field], `productionArtifact.${field}`);
  }
  if (value.contentArtifact.productKey !== productKey
    || value.pricingDecision.productKey !== productKey
    || value.approvedMedia.productKey !== productKey) {
    return { productKey, issue: diagnostic('PRODUCT_IDENTITY_MISMATCH', 'A production artifact boundary has a different productKey.') };
  }
  if (value.provenance.pricing !== 'PR22 market-pricing.mjs'
    || value.provenance.content !== COMMERCIAL_CONTENT_PROFILE
    || value.provenance.photos !== 'PR24 real-photo-production.mjs') {
    return { productKey, issue: diagnostic('PRODUCTION_PROVENANCE_INVALID', 'Production artifact does not retain the required PR22, commercial-content, and PR24 provenance.') };
  }
  return { productKey, artifact: clone(value) };
}

function minorFromAmount(amount, label) {
  if (typeof amount !== 'string' || !/^\d+\.\d{2}$/u.test(amount)) {
    throw new FinalProductExcelBridgeError(`${label}.amount must be a two-decimal money string`, 'PRICE_FORMAT_INVALID');
  }
  const [whole, fraction] = amount.split('.');
  const minor = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(minor)) throw new FinalProductExcelBridgeError(`${label}.amount is outside the safe money range`, 'PRICE_FORMAT_INVALID');
  return minor;
}

function sellingPriceInMajorUah(pricingDecision, productKey) {
  if (pricingDecision.status !== PRICING_STATUSES.READY) {
    return { issue: diagnostic('PRICING_NOT_READY', 'Only a READY PR22 pricing decision may provide an Excel selling price.') };
  }
  if (pricingDecision.productKey !== productKey) {
    return { issue: diagnostic('PRODUCT_IDENTITY_MISMATCH', 'pricingDecision.productKey does not match productionArtifact.productKey.') };
  }
  if (!isRecord(pricingDecision.supplier) || !isRecord(pricingDecision.market)
    || !isRecord(pricingDecision.commission) || !isRecord(pricingDecision.profitability)
    || !Array.isArray(pricingDecision.reasonCodes) || !isRecord(pricingDecision.diagnostics)) {
    return { issue: diagnostic('PRICING_DECISION_PROVENANCE_INCOMPLETE', 'A READY pricing decision must retain the complete PR22 decision evidence and profitability records.') };
  }
  const price = pricingDecision.pricing?.recommendedPrice;
  if (!isRecord(price) || price.currency !== 'UAH' || !Number.isSafeInteger(price.amountMinor) || price.amountMinor <= 0) {
    return { issue: diagnostic('FINAL_SELLING_PRICE_INVALID', 'PR22 READY pricing must include a positive UAH pricing.recommendedPrice in minor units.') };
  }
  try {
    if (minorFromAmount(price.amount, 'pricing.recommendedPrice') !== price.amountMinor) {
      return { issue: diagnostic('FINAL_SELLING_PRICE_INVALID', 'PR22 recommended price amount and amountMinor disagree.') };
    }
  } catch (error) {
    if (error instanceof FinalProductExcelBridgeError) return { issue: diagnostic(error.code, error.message) };
    throw error;
  }
  return {
    price: price.amountMinor / 100,
    provenance: {
      source: 'pricingDecision.pricing.recommendedPrice',
      amountMinor: price.amountMinor,
      currency: price.currency,
    },
  };
}

function publicUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^(?:[a-z]:[\\/]|\\\\|\.?(?:[\\/]))/iu.test(value.trim())) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || LOCAL_URL_HOSTS.has(host)
    || host.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/u.test(host)
    || host.endsWith('.invalid') || host === 'example.com' || host.endsWith('.example.com')) return null;
  return parsed.toString();
}

function approvedPhotoByIndex(approvedMedia, productKey) {
  if (!Array.isArray(approvedMedia.photos) || approvedMedia.photos.length !== PHOTO_ROLE_ORDER.length) {
    throw new FinalProductExcelBridgeError('Approved Media must contain exactly five local photo records.', 'APPROVED_MEDIA_INVALID');
  }
  const byIndex = new Map();
  for (const item of approvedMedia.photos) {
    assertRecord(item, 'approvedMedia.photos item');
    if (!Number.isSafeInteger(item.index) || item.index < 1 || item.index > PHOTO_ROLE_ORDER.length || byIndex.has(item.index)) {
      throw new FinalProductExcelBridgeError('Approved Media photo indexes must be exactly 1 through 5.', 'APPROVED_MEDIA_INVALID');
    }
    if (typeof item.assetRef !== 'string' || !item.assetRef.trim()) {
      throw new FinalProductExcelBridgeError('Approved Media photo records must retain their local assetRef.', 'APPROVED_MEDIA_INVALID');
    }
    byIndex.set(item.index, item);
  }
  if (approvedMedia.productKey !== productKey) throw new FinalProductExcelBridgeError('Approved Media productKey does not match the production artifact.', 'PRODUCT_IDENTITY_MISMATCH');
  return byIndex;
}

/** Validate public URL references that correspond to already-approved local media; this performs no network request. */
export function validatePublishableMedia({ productKey, approvedMedia, publishableMedia }) {
  const key = nonEmptyString(productKey, 'productKey');
  assertRecord(approvedMedia, 'approvedMedia');
  assertRecord(publishableMedia, 'publishableMedia');
  assertKnownKeys(publishableMedia, PUBLISHABLE_MEDIA_KEYS, 'publishableMedia');
  if (publishableMedia.productKey !== key) throw new FinalProductExcelBridgeError('publishableMedia.productKey does not match productKey.', 'PRODUCT_IDENTITY_MISMATCH');
  if (!Array.isArray(publishableMedia.items) || publishableMedia.items.length !== PHOTO_ROLE_ORDER.length) {
    throw new FinalProductExcelBridgeError('Publishable Media must contain exactly five items.', 'PUBLISHABLE_MEDIA_COUNT_INVALID');
  }
  const approvedByIndex = approvedPhotoByIndex(approvedMedia, key);
  const seenIndexes = new Set();
  const seenUrls = new Set();
  const items = publishableMedia.items.map((item) => {
    assertRecord(item, 'publishableMedia.items item');
    assertKnownKeys(item, PUBLISHABLE_ITEM_KEYS, 'publishableMedia.items item');
    if (!Number.isSafeInteger(item.index) || item.index < 1 || item.index > PHOTO_ROLE_ORDER.length || seenIndexes.has(item.index)) {
      throw new FinalProductExcelBridgeError('Publishable Media indexes must be exactly 1 through 5.', 'PUBLISHABLE_MEDIA_INDEX_INVALID');
    }
    seenIndexes.add(item.index);
    if (item.role !== PHOTO_ROLE_ORDER[item.index - 1]) {
      throw new FinalProductExcelBridgeError('Publishable Media role does not match the canonical photo order.', 'PUBLISHABLE_MEDIA_ROLE_INVALID');
    }
    const approved = approvedByIndex.get(item.index);
    if (!approved || item.approvedAssetRef !== approved.assetRef) {
      throw new FinalProductExcelBridgeError('Publishable Media item does not correspond to its approved local media record.', 'PUBLISHABLE_MEDIA_PROVENANCE_MISMATCH');
    }
    if (item.sha256 !== undefined && (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(item.sha256))) {
      throw new FinalProductExcelBridgeError('Publishable Media sha256 must be a SHA-256 hex string when supplied.', 'PUBLISHABLE_MEDIA_HASH_INVALID');
    }
    const url = publicUrl(item.publicUrl);
    if (!url) throw new FinalProductExcelBridgeError('Publishable Media publicUrl must be a non-local, non-placeholder HTTPS URL.', 'PUBLISHABLE_MEDIA_URL_INVALID');
    if (seenUrls.has(url)) throw new FinalProductExcelBridgeError('Each Publishable Media item must use a distinct publicUrl.', 'PUBLISHABLE_MEDIA_URL_DUPLICATE');
    seenUrls.add(url);
    return {
      index: item.index,
      role: item.role,
      approvedAssetRef: item.approvedAssetRef,
      ...(item.sha256 === undefined ? {} : { sha256: item.sha256 }),
      publicUrl: url,
    };
  });
  if (items.some((item, index) => item.index !== index + 1)) {
    throw new FinalProductExcelBridgeError('Publishable Media items must already be in canonical index order.', 'PUBLISHABLE_MEDIA_ORDER_INVALID');
  }
  return {
    productKey: key,
    ...(publishableMedia.version === undefined ? {} : { version: clone(publishableMedia.version) }),
    items,
    photoUrls: items.map((item) => item.publicUrl).join(', '),
    validation: 'STRUCTURAL_ONLY_NO_NETWORK',
  };
}

function resolvedMetadataForContent(value) {
  const metadata = value === undefined ? {} : value;
  assertRecord(metadata, 'productionArtifact.resolvedMetadata');
  if (metadata.price !== undefined || metadata.photoUrls !== undefined) {
    throw new FinalProductExcelBridgeError('resolvedMetadata may not provide price or photoUrls; those are final bridge authorities.', 'AUTHORITATIVE_FIELD_OVERRIDE');
  }
  return clone(metadata);
}

function mappedFieldSet(mapping) {
  return new Set(mapping.mappings.map((entry) => entry.canonicalField));
}

function projectRow(row, mapping) {
  if (mapping === undefined) return Object.fromEntries(CANONICAL_FIELDS.filter((field) => hasOwn(row, field)).map((field) => [field, row[field]]));
  const mapped = mappedFieldSet(mapping);
  return Object.fromEntries(CANONICAL_FIELDS
    .filter((field) => mapped.has(field) && hasOwn(row, field))
    .map((field) => [field, row[field]]));
}

function templateReadiness(mapping, row) {
  if (mapping === undefined) return null;
  if (mapping.status !== 'SAFE') return diagnostic('TEMPLATE_MAPPING_NOT_SAFE', 'Workbook template mapping is not SAFE.');
  const mapped = mappedFieldSet(mapping);
  const missing = REQUIRED_EXPORT_FIELDS.filter((field) => !mapped.has(field));
  if (missing.length) return diagnostic('FINAL_EXPORT_FIELDS_UNMAPPED', 'Template must map titleRu, price, and photoUrls for final export.', { fields: missing });
  const categoryMapped = mapped.has('categoryId') || mapped.has('categoryName');
  if (categoryMapped && (row.categoryId === undefined || row.categoryName === undefined)) {
    return diagnostic('PROM_CATEGORY_REQUIRED', 'A template that maps category fields requires explicit categoryId and categoryName metadata.');
  }
  return null;
}

function commercialContentReadiness(contentArtifact, productKey) {
  if (contentArtifact.productKey !== productKey) return { issue: diagnostic('PRODUCT_IDENTITY_MISMATCH', 'contentArtifact.productKey does not match productionArtifact.productKey.') };
  const quality = validateCommercialContentArtifact(contentArtifact);
  if (quality.status !== CONTENT_STATUSES.READY) {
    return { issue: diagnostic('COMMERCIAL_CONTENT_NOT_READY', 'Content must pass Commercial Content Quality v2 before Excel export.', { contentStatus: quality.status }), quality };
  }
  return { quality };
}

function normalizeInput(input) {
  assertRecord(input, 'input');
  assertKnownKeys(input, INPUT_KEYS, 'input');
  return {
    productionArtifact: clone(input.productionArtifact),
    ...(input.publishableMedia === undefined ? {} : { publishableMedia: clone(input.publishableMedia) }),
    ...(input.mapping === undefined ? {} : { mapping: clone(input.mapping) }),
  };
}

/** Compose a canonical, non-publishing Prom/Excel row from one PR25 production artifact. */
export function buildFinalProductExcelRecord(input) {
  const normalized = normalizeInput(input);
  const production = assertProductionArtifact(normalized.productionArtifact);
  if (production.issue) return blocked(FINAL_EXCEL_STATUSES.EXPORT_REVIEW, production.productKey, [production.issue]);
  const { artifact, productKey } = production;
  const price = sellingPriceInMajorUah(artifact.pricingDecision, productKey);
  if (price.issue) return blocked(FINAL_EXCEL_STATUSES.EXPORT_REVIEW, productKey, [price.issue]);
  const commercial = commercialContentReadiness(artifact.contentArtifact, productKey);
  if (commercial.issue) return blocked(FINAL_EXCEL_STATUSES.EXPORT_REVIEW, productKey, [commercial.issue]);
  if (normalized.publishableMedia === undefined) {
    return blocked(FINAL_EXCEL_STATUSES.WAITING_FOR_MEDIA_PUBLICATION, productKey, [
      diagnostic('PUBLISHABLE_MEDIA_REQUIRED', 'Approved local files are not public URLs; provide a validated Publishable Media artifact.'),
    ], { approvedMedia: 'local-only' });
  }

  let media;
  let content;
  try {
    media = validatePublishableMedia({ productKey, approvedMedia: artifact.approvedMedia, publishableMedia: normalized.publishableMedia });
    content = buildContentExcelRow({
      selectedProduct: artifact.selectedProduct,
      contentArtifact: artifact.contentArtifact,
      resolvedMetadata: resolvedMetadataForContent(artifact.resolvedMetadata),
    });
  } catch (error) {
    if (error instanceof FinalProductExcelBridgeError) {
      return blocked(FINAL_EXCEL_STATUSES.EXPORT_REVIEW, productKey, [diagnostic(error.code, error.message)]);
    }
    throw error;
  }
  if (content.status !== CONTENT_STATUSES.READY || content.row === null) {
    return blocked(FINAL_EXCEL_STATUSES.EXPORT_REVIEW, productKey, [diagnostic('CONTENT_ROW_NOT_READY', 'The existing Content Row Adapter did not produce a READY canonical row.')]);
  }
  const completeRow = { ...content.row, price: price.price, photoUrls: media.photoUrls };
  const mappingIssue = templateReadiness(normalized.mapping, completeRow);
  if (mappingIssue) {
    return blocked(
      mappingIssue.code === 'TEMPLATE_MAPPING_NOT_SAFE' || mappingIssue.code === 'FINAL_EXPORT_FIELDS_UNMAPPED'
        ? FINAL_EXCEL_STATUSES.NEEDS_TEMPLATE_MAPPING
        : FINAL_EXCEL_STATUSES.EXPORT_REVIEW,
      productKey,
      [mappingIssue],
    );
  }

  let characteristicPlan = null;
  if (normalized.mapping !== undefined) {
    characteristicPlan = buildCharacteristicColumnPlan({ contentArtifact: artifact.contentArtifact, mapping: normalized.mapping });
    if (characteristicPlan.status !== 'SAFE') {
      return blocked(FINAL_EXCEL_STATUSES.NEEDS_TEMPLATE_MAPPING, productKey, [
        diagnostic('CHARACTERISTIC_PLAN_NOT_SAFE', 'The existing Characteristic Column Plan is not SAFE for this template.', { characteristicStatus: characteristicPlan.status }),
      ]);
    }
  }
  const row = projectRow(completeRow, normalized.mapping);
  return {
    status: FINAL_EXCEL_STATUSES.READY_FOR_EXCEL,
    productKey,
    row,
    characteristicPlan,
    diagnostics: [],
    provenance: {
      identity: 'productionArtifact.productKey=selectedProduct.selectionKey=pricingDecision.productKey=contentArtifact.productKey=approvedMedia.productKey=publishableMedia.productKey',
      price: price.provenance,
      content: 'buildContentExcelRow + Commercial Content Quality v2',
      media: 'validated Publishable Media structural contract',
      ...(normalized.mapping === undefined ? { characteristics: 'deferred-until-template-mapping' } : { characteristics: 'buildCharacteristicColumnPlan' }),
    },
  };
}

function exportInput(value) {
  assertRecord(value, 'export input');
  const allowed = new Set(['inputPath', 'outputPath', 'products', 'mappingOptions']);
  assertKnownKeys(value, allowed, 'export input');
  if (!Array.isArray(value.products)) throw new FinalProductExcelBridgeError('products must be an array', 'INVALID_PRODUCTS');
  if (!isRecord(value.mappingOptions ?? {})) throw new FinalProductExcelBridgeError('mappingOptions must be an object', 'INVALID_MAPPING_OPTIONS');
  return {
    inputPath: value.inputPath,
    outputPath: value.outputPath,
    products: clone(value.products),
    mappingOptions: clone(value.mappingOptions ?? {}),
  };
}

/** Inspect, map, compose, and safely write only export-ready products to a separate XLSX output. */
export async function exportFinalProductsToWorkbook(input) {
  const value = exportInput(input);
  const template = await inspectWorkbook(value.inputPath);
  const mapping = mapTemplateSchema(template, value.mappingOptions);
  const productResults = value.products.map((product) => buildFinalProductExcelRecord({ ...product, mapping }));
  if (mapping.status !== 'SAFE') {
    return {
      status: FINAL_EXCEL_STATUSES.NEEDS_TEMPLATE_MAPPING,
      mapping,
      products: productResults,
      workbook: null,
    };
  }
  const ready = productResults.filter((result) => result.status === FINAL_EXCEL_STATUSES.READY_FOR_EXCEL);
  if (ready.length === 0) {
    return {
      status: FINAL_EXCEL_STATUSES.READY_FOR_EXCEL,
      mapping,
      products: productResults,
      workbook: null,
    };
  }
  try {
    const workbook = await writeAdaptiveWorkbook({
      inputPath: value.inputPath,
      outputPath: value.outputPath,
      mapping,
      rows: ready.map((result) => result.row),
      characteristicPlans: ready.map((result) => result.characteristicPlan),
    });
    return {
      status: FINAL_EXCEL_STATUSES.EXPORTED,
      mapping,
      products: productResults.map((result) => result.status === FINAL_EXCEL_STATUSES.READY_FOR_EXCEL
        ? { ...result, status: FINAL_EXCEL_STATUSES.EXPORTED }
        : result),
      workbook,
    };
  } catch (error) {
    return {
      status: FINAL_EXCEL_STATUSES.FAILED,
      mapping,
      products: productResults,
      workbook: null,
      error: {
        code: typeof error?.code === 'string' ? error.code : 'XLSX_EXPORT_FAILED',
        message: error instanceof Error ? error.message : 'Adaptive workbook export failed.',
      },
    };
  }
}

export class FinalProductExcelBridgeError extends Error {
  constructor(message, code = 'FINAL_PRODUCT_EXCEL_BRIDGE_ERROR', details = undefined) {
    super(message);
    this.name = 'FinalProductExcelBridgeError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
