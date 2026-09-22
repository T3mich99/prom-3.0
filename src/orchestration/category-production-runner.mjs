import {
  CATEGORY_PRODUCTION_NET_ROI_ANCHORS,
  evaluateProductPricing,
  rankPricingDecisions,
  resolveCategoryProductionNetRoiBps,
  PRICING_STATUSES,
} from '../pricing/market-pricing.mjs';
import {
  buildPromProductCode,
} from '../excel/prom-catalog-registry.mjs';
import { PROM_REGISTRY_STATES } from '../excel/prom-catalog-bootstrap.mjs';
import { exportPromDeltaWorkbook } from '../excel/prom-delta-export.mjs';
import { buildDriveMediaPublicationTask } from '../media/google-drive-media-publication.mjs';
import { advanceProductionProduct, collectOperatorTasks, PRODUCTION_MODES, PRODUCTION_STATUSES } from './production-orchestrator.mjs';
import { collectUgoptCategory } from '../suppliers/ugopt/category-adapter.mjs';
import { collectUgoptProductDetail } from '../suppliers/ugopt/product-detail-adapter.mjs';

export const CATEGORY_PRODUCTION_MODE = PRODUCTION_MODES.CATEGORY_PRODUCTION;

const BLOCKED_REGISTRY_STATES = new Set([
  PROM_REGISTRY_STATES.EXISTING_IN_PROM,
  PROM_REGISTRY_STATES.CONFIRMED_IN_PROM,
  PROM_REGISTRY_STATES.RESERVED_FOR_IMPORT,
]);

const REQUEST_KEYS = new Set(['categoryId', 'categoryUrl', 'categoryName', 'requestKey', 'productInputs', 'export', 'targetCount', 'selectedProductKeys']);
const OPTION_KEYS = new Set([
  'collector', 'collectorOptions', 'resolveCategoryIdentifier', 'registry', 'registryLoader',
  'pricing', 'production', 'content', 'photos', 'characteristics', 'categoryMetadata',
  'stateStore', 'runId', 'excelExporter', 'driveMedia',
  'productDetailCollector', 'productDetailOptions',
]);
const PRODUCT_INPUT_KEYS = new Set([
  'supplierState', 'pricingProduct', 'sourceFacts', 'sourceText', 'categoryContext', 'sourceImages',
  'marketEvidence', 'pricingDecision', 'contentArtifact', 'photoArtifact', 'approvedMedia',
  'resolvedMetadata', 'characteristicMapping', 'publishableMedia', 'promFields',
  'photoCreativeBrief',
  'sourceEvidence',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function sourceTextForGeneration(value) {
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (typeof item === 'string') return [key, item];
    if (Array.isArray(item)) {
      const lines = item.map((entry) => {
        if (isRecord(entry)) {
          const name = text(entry.name);
          const entryValue = text(entry.value);
          if (name && entryValue) return `${name}: ${entryValue}`;
          return name || entryValue;
        }
        return text(entry);
      }).filter(Boolean);
      return [key, lines.join('\n')];
    }
    if (item === null || item === undefined) return [key, ''];
    return [key, isRecord(item) ? JSON.stringify(item) : String(item)];
  }));
}

function requiredString(value, label) {
  if (!text(value)) throw new TypeError(`${label} must be a non-empty string`);
  return text(value);
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`Unsupported ${label} field: ${key}`);
}

export function normalizeCategoryProductionRequest(request) {
  if (!isRecord(request)) throw new TypeError('category production request must be an object');
  assertKnownKeys(request, REQUEST_KEYS, 'category production request');
  const categoryId = request.categoryId === undefined ? undefined : requiredString(request.categoryId, 'categoryId');
  const categoryUrl = request.categoryUrl === undefined ? undefined : requiredString(request.categoryUrl, 'categoryUrl');
  if (categoryId === undefined && categoryUrl === undefined) throw new TypeError('categoryId or categoryUrl is required');
  if (categoryId !== undefined && categoryUrl !== undefined) throw new TypeError('categoryId and categoryUrl are mutually exclusive');
  if (request.categoryName !== undefined) requiredString(request.categoryName, 'categoryName');
  if (request.requestKey !== undefined) requiredString(request.requestKey, 'requestKey');
  if (request.targetCount !== undefined && (!Number.isSafeInteger(request.targetCount) || request.targetCount < 1)) {
    throw new TypeError('targetCount must be a positive integer');
  }
  if (request.selectedProductKeys !== undefined) {
    const keys = request.selectedProductKeys;
    if (request.targetCount === undefined || !Array.isArray(keys) || keys.length > request.targetCount
      || keys.some((key) => typeof key !== 'string' || !key.trim()) || new Set(keys).size !== keys.length) {
      throw new TypeError('selectedProductKeys must be unique product keys within targetCount');
    }
  }
  if (request.productInputs !== undefined) {
    if (!isRecord(request.productInputs)) throw new TypeError('productInputs must be an object');
    for (const [productKey, input] of Object.entries(request.productInputs)) {
      requiredString(productKey, 'productInputs key');
      if (!isRecord(input)) throw new TypeError(`productInputs.${productKey} must be an object`);
      assertKnownKeys(input, PRODUCT_INPUT_KEYS, `productInputs.${productKey}`);
    }
  }
  if (request.export !== undefined) {
    if (!isRecord(request.export)) throw new TypeError('export must be an object');
    assertKnownKeys(request.export, new Set(['inputPath', 'outputPath', 'mappingOptions']), 'export');
    requiredString(request.export.inputPath, 'export.inputPath');
    requiredString(request.export.outputPath, 'export.outputPath');
    if (request.export.mappingOptions !== undefined && !isRecord(request.export.mappingOptions)) throw new TypeError('export.mappingOptions must be an object');
  }
  return clone({ ...request, productInputs: request.productInputs ?? {} });
}

function normalizeOptions(options) {
  if (!isRecord(options)) throw new TypeError('category production options must be an object');
  assertKnownKeys(options, OPTION_KEYS, 'category production options');
  for (const key of ['collectorOptions', 'productDetailOptions', 'pricing', 'production', 'content', 'photos', 'characteristics']) {
    if (options[key] !== undefined && !isRecord(options[key])) throw new TypeError(`options.${key} must be an object`);
  }
  if (options.collector !== undefined && typeof options.collector !== 'function') throw new TypeError('options.collector must be a function');
  if (options.productDetailCollector !== undefined && typeof options.productDetailCollector !== 'function') throw new TypeError('options.productDetailCollector must be a function');
  if (options.resolveCategoryIdentifier !== undefined && typeof options.resolveCategoryIdentifier !== 'function') throw new TypeError('options.resolveCategoryIdentifier must be a function');
  if (options.registry !== undefined && !isRecord(options.registry)) throw new TypeError('options.registry must be an existing Prom registry object');
  if (options.registryLoader !== undefined && typeof options.registryLoader !== 'function') throw new TypeError('options.registryLoader must be a function');
  if (options.excelExporter !== undefined && typeof options.excelExporter !== 'function') throw new TypeError('options.excelExporter must be a function');
  if (options.stateStore !== undefined) {
    if (!isRecord(options.stateStore)
      || typeof options.stateStore.requireRun !== 'function'
      || typeof options.stateStore.reconstructRequest !== 'function'
      || typeof options.stateStore.persistRunResult !== 'function') {
      throw new TypeError('options.stateStore must expose requireRun, reconstructRequest, and persistRunResult');
    }
    requiredString(options.runId, 'options.runId');
  }
  if (options.driveMedia !== undefined && !isRecord(options.driveMedia)) throw new TypeError('options.driveMedia must be an object');
  return options;
}

async function resolveCategory(request, options) {
  if (request.categoryUrl !== undefined) {
    let parsed;
    try { parsed = new URL(request.categoryUrl); } catch { throw new TypeError('categoryUrl must be a valid URL'); }
    return {
      requestKey: request.requestKey ?? `ugopt-category:${parsed.pathname}`,
      requestedName: request.categoryName ?? parsed.pathname,
      sourceCategoryUrl: request.categoryUrl,
      sourceCategoryName: request.categoryName ?? parsed.pathname,
    };
  }
  if (typeof options.resolveCategoryIdentifier !== 'function') {
    const error = new Error('categoryId requires an injected canonical category resolver');
    error.code = 'CATEGORY_IDENTIFIER_RESOLUTION_REQUIRED';
    throw error;
  }
  const resolved = await options.resolveCategoryIdentifier(request.categoryId);
  if (!isRecord(resolved)) throw new TypeError('category resolver must return an object');
  return {
    requestKey: request.requestKey ?? `ugopt-category:${request.categoryId}`,
    requestedName: request.categoryName ?? requiredString(resolved.sourceCategoryName ?? resolved.requestedName, 'resolved category name'),
    sourceCategoryUrl: requiredString(resolved.sourceCategoryUrl ?? resolved.categoryUrl, 'resolved category URL'),
    sourceCategoryName: resolved.sourceCategoryName ?? resolved.requestedName ?? request.categoryName ?? request.categoryId,
  };
}

function candidateCode(candidate) {
  const sku = candidate?.product?.supplierSku;
  if (!text(sku)) return null;
  try { return buildPromProductCode(sku); } catch { return null; }
}

function registryEntries(registry, code) {
  const entry = registry.byCode?.[code];
  if (entry === undefined) return [];
  return Array.isArray(entry) ? entry : [entry];
}

function registryBlock(registry, code) {
  if (registry.collisions?.some((collision) => collision.code === code)) return { reason: 'REGISTRY_COLLISION', status: 'COLLISION' };
  const entries = registryEntries(registry, code);
  if (entries.length === 0) return null;
  const statuses = entries.map((entry) => entry.status);
  if (statuses.some((status) => status === undefined || BLOCKED_REGISTRY_STATES.has(status))) {
    return { reason: 'REGISTRY_DUPLICATE', status: statuses.find((status) => status === undefined || BLOCKED_REGISTRY_STATES.has(status)) ?? 'EXISTING_IN_PROM' };
  }
  return null;
}

function candidateSourceImages(candidate, input) {
  if (input.sourceImages !== undefined) return clone(input.sourceImages);
  if (Array.isArray(candidate?.product?.sourceImages)) return clone(candidate.product.sourceImages);
  const sourceImage = candidate?.product?.sourceImageUrl;
  return text(sourceImage) ? [{ id: `${candidate.selectionKey}-source-1`, reference: sourceImage }] : [];
}

function sourceFactsFor(candidate, input) {
  if (isRecord(input.sourceFacts)) return clone(input.sourceFacts);
  const title = text(candidate?.product?.title);
  if (!title) return null;
  return { type: { ru: title, ua: title } };
}

function selectedProductFor(category, candidate) {
  return {
    requestKey: category.requestKey,
    requestedCategory: category.requestedName,
    resolvedCategory: {
      source: 'ug-opt',
      sourceCategoryUrl: category.sourceCategoryUrl,
      sourceCategoryName: category.sourceCategoryName ?? category.requestedName,
    },
    selectionKey: candidate.selectionKey,
    product: clone(candidate.product),
  };
}

function categoryPricingOptions(options) {
  const suppliedPricing = options.pricing ?? {};
  const suppliedPolicy = suppliedPricing.policy ?? {};
  const suppliedProfitability = suppliedPolicy.profitability ?? {};
  const commission = suppliedPricing.commission ?? {
    rateBps: 2_000,
    source: 'PR30 category production policy',
    provenance: { contract: 'PR30', commissionRate: 0.20 },
  };
  if (commission.rateBps !== 2_000) throw new TypeError('CATEGORY_PRODUCTION requires a 20% Prom commission');
  if (suppliedPricing.commissionResolver !== undefined && typeof suppliedPricing.commissionResolver !== 'function') {
    throw new TypeError('options.pricing.commissionResolver must be a function');
  }
  const commissionResolver = suppliedPricing.commissionResolver === undefined
    ? undefined
    : async (product) => {
      const resolved = await suppliedPricing.commissionResolver(product);
      if (!isRecord(resolved) || resolved.rateBps !== 2_000) throw new TypeError('CATEGORY_PRODUCTION commissionResolver must resolve to 20%');
      return resolved;
    };
  return {
    ...suppliedPricing,
    commission: clone(commission),
    enforceCompetitiveCeiling: false,
    ...(commissionResolver === undefined ? {} : { commissionResolver }),
    policy: {
      ...clone(suppliedPolicy),
      profitability: {
        ...clone(suppliedProfitability),
        rules: [],
        dynamicNetRoiCurve: suppliedProfitability.dynamicNetRoiCurve ?? CATEGORY_PRODUCTION_NET_ROI_ANCHORS,
      },
    },
  };
}

function jobFor(category, candidate, input, options) {
  const evidence = input.sourceEvidence;
  const sourceFacts = evidence?.sourceFacts ?? sourceFactsFor(candidate, input);
  const sourceImages = evidence?.sourceImages ?? candidateSourceImages(candidate, input);
  const categoryContext = input.categoryContext ?? {
    source: 'ug-opt',
    categoryName: category.sourceCategoryName ?? category.requestedName,
    categoryUrl: category.sourceCategoryUrl,
  };
  const job = {
    selectedProduct: selectedProductFor(category, candidate),
    sourceFacts,
    sourceImages,
    categoryContext: clone(categoryContext),
  };
  if (evidence !== undefined) job.sourceEvidence = clone(evidence);
  for (const key of ['supplierState', 'pricingProduct', 'sourceText', 'marketEvidence', 'pricingDecision', 'contentArtifact', 'photoArtifact', 'approvedMedia', 'characteristicMapping', 'photoCreativeBrief']) {
    if (input[key] !== undefined) job[key] = key === 'sourceText' ? sourceTextForGeneration(input[key]) : clone(input[key]);
  }
  if (evidence?.sourceText !== undefined) job.sourceText = sourceTextForGeneration(evidence.sourceText);
  const metadata = input.resolvedMetadata ?? options.categoryMetadata?.[category.requestKey];
  if (metadata !== undefined) job.resolvedMetadata = clone(metadata);
  return job;
}

function basicEligibility(candidate, input) {
  const code = candidateCode(candidate);
  if (code === null) return { eligible: false, reason: 'SUPPLIER_SKU_REQUIRED' };
  if (!Number.isFinite(candidate?.product?.price) && !(isRecord(candidate?.product?.price) && Number.isFinite(Number(candidate.product.price.amount)))) {
    return { eligible: false, reason: 'PURCHASE_PRICE_REQUIRED' };
  }
  if (!text(candidate?.product?.title)) return { eligible: false, reason: 'SOURCE_PRODUCT_INFORMATION_REQUIRED' };
  if (candidateSourceImages(candidate, input).length === 0) return { eligible: false, reason: 'SOURCE_IMAGE_REQUIRED' };
  if (sourceFactsFor(candidate, input) === null) return { eligible: false, reason: 'SOURCE_PRODUCT_INFORMATION_REQUIRED' };
  return { eligible: true, code };
}

async function mediaTask(result, options) {
  const product = result.selectedProduct?.product ?? {};
  const sourceCode = text(product.supplierSku);
  const photos = result.photoArtifact?.artifacts ?? [];
  const files = photos.map((artifact, index) => ({
    index: artifact.photoIndex ?? index + 1,
    role: artifact.role,
    path: artifact.asset?.path,
  }));
  if (options.driveMedia?.outputRoot && options.driveMedia?.config && sourceCode && files.length === 5) {
    return buildDriveMediaPublicationTask({
      productKey: result.productKey,
      sourceCode,
      outputRoot: options.driveMedia.outputRoot,
      files,
      config: options.driveMedia.config,
    });
  }
  return {
    taskType: 'MEDIA_PUBLICATION',
    taskVersion: 'drive-media-v1',
    productKey: result.productKey,
    input: { productKey: result.productKey, sourceCode, files },
    instructions: { providePublicHttpsUrls: true, noFakeUrls: true, noLocalPathsInExcel: true },
    expectedResultSchema: { type: 'publishable-media-v1', required: ['productKey', 'items'] },
    validationAuthority: 'google-drive-media-publication.mjs',
  };
}

function productSummary(results, filtered, categoryCount, ranking, exported, productInputs) {
  const count = (status) => results.filter((result) => result.workflowStatus === status).length;
  return {
    categoryCandidates: categoryCount,
    registrySkipped: filtered.registrySkipped,
    invalidSkipped: filtered.invalidSkipped,
    eligibleCandidates: filtered.candidates.length,
    pricingReady: results.filter((result) => result.pricingDecision?.status === PRICING_STATUSES.READY).length,
    pricingReview: results.filter((result) => result.workflowStatus === PRODUCTION_STATUSES.PRICING_REVIEW).length,
    pricingSkipped: results.filter((result) => result.workflowStatus === PRODUCTION_STATUSES.SKIPPED).length,
    contentReady: results.filter((result) => [PRODUCTION_STATUSES.WAITING_FOR_PHOTOS, PRODUCTION_STATUSES.PHOTO_REVIEW, PRODUCTION_STATUSES.PHOTO_REWORK, PRODUCTION_STATUSES.PHOTO_READY, PRODUCTION_STATUSES.READY_FOR_EXPORT].includes(result.workflowStatus)).length,
    photosFiveReady: results.filter((result) => result.photoArtifact?.quality?.status === 'READY' && result.photoArtifact?.artifacts?.length === 5).length,
    waitingMediaPublication: results.filter((result) => result.workflowStatus === PRODUCTION_STATUSES.READY_FOR_EXPORT && productInputs[result.productKey]?.publishableMedia === undefined).length,
    readyForExcel: count(PRODUCTION_STATUSES.READY_FOR_EXPORT),
    exported: exported?.products?.filter((product) => product.status === 'EXPORTED').length ?? 0,
    failed: count(PRODUCTION_STATUSES.FAILED),
    rankingCount: ranking.ranked.length,
  };
}

async function persistProduct(stateStore, runId, result) {
  if (stateStore === undefined) return;
  await stateStore.persistRunResult(runId, {
    status: result.workflowStatus,
    products: [result],
    operatorTasks: collectOperatorTasks({ results: [result] }),
    summary: { productKey: result.productKey, workflowStatus: result.workflowStatus },
  });
}

function failedSourceEvidence(candidate, error) {
  return {
    productKey: candidate.selectionKey,
    version: 1,
    status: 'REVIEW',
    sourceUrl: candidate.product?.sourceUrl,
    sourceFacts: sourceFactsFor(candidate, {}),
    sourceText: { language: 'uk', title: text(candidate.product?.title), description: '', characteristics: [] },
    sourceImages: candidateSourceImages(candidate, {}),
    diagnostics: [{
      code: typeof error?.code === 'string' ? error.code : 'SOURCE_DETAIL_COLLECTION_FAILED',
      message: 'Official product detail could not be collected and must be reviewed before content generation.',
    }],
    provenance: { supplier: 'ug-opt', authority: 'category-listing-fallback', parser: 'ugopt-product-detail-v1' },
  };
}

async function enrichSourceEvidence(item, collector, collectorOptions, stateStore, runId) {
  if (item.input.sourceEvidence !== undefined || collector === null) return item;
  let evidence;
  try {
    evidence = await collector(item.candidate, collectorOptions);
  } catch (error) {
    evidence = failedSourceEvidence(item.candidate, error);
  }
  if (!isRecord(evidence) || evidence.productKey !== item.candidate.selectionKey) {
    throw new TypeError('productDetailCollector must return source evidence for the selected productKey');
  }
  item.input.sourceEvidence = clone(evidence);
  if (typeof stateStore?.saveArtifact === 'function') stateStore.saveArtifact(runId, item.candidate.selectionKey, 'sourceEvidence', evidence, {
    source: 'ugopt-product-detail-collector',
    sourceUrl: evidence.sourceUrl,
  });
  return item;
}

async function resumeRequest(request, stateStore, runId) {
  if (stateStore === undefined) return request;
  const persisted = await stateStore.reconstructRequest(runId);
  if (!isRecord(persisted)) throw new TypeError('stateStore.reconstructRequest must return the persisted run request');
  const persistedInputs = isRecord(persisted.productInputs) ? clone(persisted.productInputs) : {};
  // A saved plan is useful progress, but is not a generated five-file artifact.
  for (const input of Object.values(persistedInputs)) {
    if (input.photoArtifact && (!Array.isArray(input.photoArtifact.artifacts) || input.photoArtifact.artifacts.length !== 5)) {
      delete input.photoArtifact;
      delete input.approvedMedia;
    }
  }
  const requestInputs = isRecord(request.productInputs) ? request.productInputs : {};
  const mergedInputs = Object.fromEntries([...new Set([...Object.keys(persistedInputs), ...Object.keys(requestInputs)])]
    .map((key) => {
      const persistedInput = persistedInputs[key] ?? {};
      const currentInput = requestInputs[key] ?? {};
      const merged = { ...persistedInput, ...currentInput };
      // A newly supplied full photo artifact must be validated from its current
      // bytes. A stale approvedMedia record from an earlier attempt can only
      // produce a false APPROVED_MEDIA_MISMATCH, so discard it unless the
      // current request explicitly supplies the matching artifact as well.
      if (currentInput.photoArtifact !== undefined && currentInput.approvedMedia === undefined) {
        delete merged.approvedMedia;
      }
      return [key, merged];
    }));
  return { ...request, productInputs: mergedInputs };
}

/**
 * Scan the complete category and filter the persistent registry first.
 * An explicit targetCount selects a new-product batch in source order;
 * without it the entire eligible category goes through production.
 */
export async function runCategoryProduction(request, options = {}) {
  const normalizedRequest = normalizeCategoryProductionRequest(request);
  const normalizedOptions = normalizeOptions(options);
  if (normalizedOptions.stateStore !== undefined) normalizedOptions.stateStore.requireRun(normalizedOptions.runId);
  const runRequest = normalizeCategoryProductionRequest(await resumeRequest(normalizedRequest, normalizedOptions.stateStore, normalizedOptions.runId));
  const category = await resolveCategory(runRequest, normalizedOptions);
  const collector = normalizedOptions.collector ?? collectUgoptCategory;
  const collected = await collector(category, normalizedOptions.collectorOptions ?? {});
  if (!isRecord(collected) || collected.resolution !== 'resolved' || !Array.isArray(collected.candidates)) {
    const error = new Error('UG-OPT category collection did not return a resolved candidate list');
    error.code = 'CATEGORY_COLLECTION_FAILED';
    throw error;
  }
  let registry = normalizedOptions.registry;
  if (registry === undefined && normalizedOptions.registryLoader !== undefined) registry = await normalizedOptions.registryLoader();
  if (!isRecord(registry) || !isRecord(registry.byCode)) throw new TypeError('a persistent Prom registry is required for CATEGORY_PRODUCTION');

  const filtered = { candidates: [], registrySkipped: 0, invalidSkipped: 0, skipped: [] };
  const seenCodes = new Set();
  for (const candidate of collected.candidates) {
    const input = runRequest.productInputs[candidate.selectionKey] ?? {};
    const code = candidateCode(candidate);
    const eligibility = basicEligibility(candidate, input);
    if (code === null || seenCodes.has(code)) {
      filtered.invalidSkipped += 1;
      filtered.skipped.push({ productKey: candidate.selectionKey, code, reason: code === null ? eligibility.reason : 'CANDIDATE_CODE_COLLISION' });
      continue;
    }
    seenCodes.add(code);
    const blocked = registryBlock(registry, code);
    if (blocked !== null) {
      filtered.registrySkipped += 1;
      filtered.skipped.push({ productKey: candidate.selectionKey, code, reason: blocked.reason, status: blocked.status });
      continue;
    }
    if (!eligibility.eligible) {
      filtered.invalidSkipped += 1;
      filtered.skipped.push({ productKey: candidate.selectionKey, code, reason: eligibility.reason });
      continue;
    }
    filtered.candidates.push({ candidate: clone(candidate), input: clone(input), code });
  }

  // Count NEW eligible products, never the first N supplier listings.
  const availableNewCount = filtered.candidates.length;
  const targetCount = runRequest.targetCount ?? null;
  const pool = new Map(filtered.candidates.map((item) => [item.candidate.selectionKey, item]));
  const selectedProductKeys = targetCount === null
    ? [...pool.keys()]
    : runRequest.selectedProductKeys ?? [...pool.keys()].slice(0, targetCount);
  const missingSelectedProductKeys = selectedProductKeys.filter((key) => !pool.has(key));
  const selectedSet = new Set(selectedProductKeys);
  const deferredProductKeys = [...pool.keys()].filter((key) => !selectedSet.has(key));
  filtered.candidates = selectedProductKeys.filter((key) => pool.has(key)).map((key) => pool.get(key));
  const detailCollector = normalizedOptions.productDetailCollector
    ?? (collector === collectUgoptCategory ? collectUgoptProductDetail : null);
  for (const item of filtered.candidates) {
    await enrichSourceEvidence(item, detailCollector, normalizedOptions.productDetailOptions ?? {}, normalizedOptions.stateStore, normalizedOptions.runId);
  }
  const selection = {
    scope: targetCount === null ? 'ALL_ELIGIBLE_NEW_PRODUCTS' : 'REQUESTED_NEW_PRODUCT_COUNT',
    targetCount, availableNewCount, selectedProductKeys, missingSelectedProductKeys,
    deferredProductKeys, selectedCount: filtered.candidates.length,
    shortfall: targetCount === null ? 0 : Math.max(0, targetCount - filtered.candidates.length),
  };

  const productionOptions = {
    ...(normalizedOptions.production ?? {}),
    mode: PRODUCTION_MODES.CATEGORY_PRODUCTION,
    pricing: categoryPricingOptions(normalizedOptions),
    content: normalizedOptions.content ?? {},
    photos: { ...(normalizedOptions.photos ?? {}) },
    characteristics: normalizedOptions.characteristics ?? {},
  };
  const results = [];
  const usedCreativeBriefs = [...(productionOptions.photos.usedCreativeBriefs ?? [])];
  for (const item of filtered.candidates) {
    productionOptions.photos.usedCreativeBriefs = usedCreativeBriefs;
    const result = await advanceProductionProduct(jobFor(category, item.candidate, item.input, normalizedOptions), productionOptions);
    if (item.input.photoCreativeBrief && result.photoArtifact?.plan?.status === 'READY') usedCreativeBriefs.push(clone(item.input.photoCreativeBrief));
    results.push(result);
    await persistProduct(normalizedOptions.stateStore, normalizedOptions.runId, result);
  }

  const decisions = results.filter((result) => isRecord(result.pricingDecision)).map((result) => result.pricingDecision);
  const ranking = rankPricingDecisions(decisions, { policy: productionOptions.pricing.policy });
  const mediaTasks = await Promise.all(results
    .filter((result) => result.workflowStatus === PRODUCTION_STATUSES.READY_FOR_EXPORT && runRequest.productInputs[result.productKey]?.publishableMedia === undefined)
    .map((result) => mediaTask(result, normalizedOptions)));
  const publishableProducts = results
    .filter((result) => result.workflowStatus === PRODUCTION_STATUSES.READY_FOR_EXPORT)
    .map((result) => ({
      productKey: result.productKey,
      productCode: candidateCode({ product: result.productionArtifact.selectedProduct.product }),
      physicalFields: runRequest.productInputs[result.productKey]?.promFields ?? {},
      productionArtifact: result.productionArtifact,
      publishableMedia: runRequest.productInputs[result.productKey]?.publishableMedia,
    }));
  let exported = null;
  const operatorTasks = [...collectOperatorTasks({ results }), ...mediaTasks];
  const selectedBatchReady = results.length > 0 && publishableProducts.length === results.length
    && operatorTasks.length === 0 && missingSelectedProductKeys.length === 0
    && (targetCount !== null || filtered.invalidSkipped === 0);
  const requestedCountMet = targetCount === null || results.length === targetCount;
  const wholeCategoryReady = selectedBatchReady && deferredProductKeys.length === 0 && filtered.invalidSkipped === 0;
  if (runRequest.export !== undefined && selectedBatchReady) {
    const exporter = normalizedOptions.excelExporter ?? exportPromDeltaWorkbook;
    exported = await exporter({
      inputPath: runRequest.export.inputPath,
      outputPath: runRequest.export.outputPath,
      products: publishableProducts,
      templateOptions: runRequest.export.mappingOptions ?? {},
      registry,
    });
  }
  const summary = productSummary(results, filtered, collected.candidates.length, ranking, exported, runRequest.productInputs);
  Object.assign(summary, { requested: targetCount, availableNew: availableNewCount, selected: results.length,
    deferred: deferredProductKeys.length, shortfall: selection.shortfall });
  const status = operatorTasks.length > 0
    ? 'WAITING_FOR_OPERATOR'
    : (exported !== null && exported.status !== 'EXPORTED') ? 'REVIEW_REQUIRED'
    : missingSelectedProductKeys.length > 0 ? 'REVIEW_REQUIRED'
    : !requestedCountMet ? 'INSUFFICIENT_NEW_PRODUCTS'
    : (targetCount === null && filtered.invalidSkipped > 0) || results.some((result) => result.workflowStatus !== PRODUCTION_STATUSES.READY_FOR_EXPORT)
      ? 'PARTIAL'
      : 'COMPLETED';
  const output = {
    mode: CATEGORY_PRODUCTION_MODE,
    status,
    category: clone(category),
    collected: { candidateCount: collected.candidates.length, pagesFetched: collected.pagesFetched ?? null },
    selection,
    filtered: clone(filtered),
    products: results,
    ranking,
    operatorTasks,
    export: exported,
    completion: { wholeCategoryReady, selectedBatchReady, requestedCountMet, scope: selection.scope,
      blockedProducts: results.filter((result) => result.workflowStatus !== PRODUCTION_STATUSES.READY_FOR_EXPORT).map((result) => result.productKey),
      skippedProducts: clone(filtered.skipped),
      partialWorkbookReady: selectedBatchReady && !requestedCountMet && exported?.status === 'EXPORTED',
      finalWorkbookReady: selectedBatchReady && requestedCountMet && exported?.status === 'EXPORTED' },
    summary,
    pricingPolicy: {
      commissionRate: 0.20,
      commissionRateBps: 2_000,
      marketCeiling: 'ANALYTICS_ONLY',
      netRoiForPurchasePriceMinor: (purchasePriceMinor) => resolveCategoryProductionNetRoiBps(purchasePriceMinor),
    },
  };
  if (normalizedOptions.stateStore !== undefined) {
    await normalizedOptions.stateStore.persistRunResult(normalizedOptions.runId, {
      status,
      products: results,
      operatorTasks,
      summary,
    });
  }
  return output;
}
