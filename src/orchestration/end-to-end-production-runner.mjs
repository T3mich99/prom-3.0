import { resolveCategoryRequests } from '../categories/category-resolver.mjs';
import { exportFinalProductsToWorkbook } from '../excel/final-product-excel-bridge.mjs';
import { advanceProductionBatch, advanceProductionProduct, collectOperatorTasks, PRODUCTION_MODES, PRODUCTION_STATUSES } from './production-orchestrator.mjs';
import { evaluateProductPricing, PRICING_STATUSES, rankPricingDecisions, selectTopProfitableProducts } from '../pricing/market-pricing.mjs';
import { selectProducts } from '../selection/product-selector.mjs';
import { collectUgoptCategories } from '../suppliers/ugopt/category-adapter.mjs';
import { loadUgoptCategoryCatalog } from '../suppliers/ugopt/category-catalog.mjs';

export const END_TO_END_RUN_STATUSES = Object.freeze({
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  WAITING_FOR_OPERATOR: 'WAITING_FOR_OPERATOR',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  FAILED: 'FAILED',
});

const MAX_PRODUCTS = 6000;
const REQUEST_KEYS = new Set(['mode', 'categories', 'maxProducts', 'productInputs', 'export']);
const PRODUCT_INPUT_KEYS = new Set([
  'supplierState', 'pricingProduct', 'sourceFacts', 'sourceText', 'categoryContext', 'sourceImages',
  'marketEvidence', 'pricingDecision', 'contentArtifact', 'photoArtifact', 'approvedMedia',
  'resolvedMetadata', 'characteristicMapping', 'publishableMedia',
]);
const EXPORT_KEYS = new Set(['inputPath', 'outputPath', 'mappingOptions']);
const OPTION_KEYS = new Set(['catalogLoader', 'adapterCollector', 'catalogOptions', 'adapterOptions', 'pricing', 'production', 'excelExporter']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertKnownKeys(value, keys, label) {
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new TypeError(`Unsupported ${label} field: ${key}`);
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function record(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function normalizeRequest(request) {
  record(request, 'request');
  assertKnownKeys(request, REQUEST_KEYS, 'request');
  const mode = request.mode ?? 'EXPLICIT_CATEGORIES';
  if (!['EXPLICIT_CATEGORIES', 'FULL_CATALOG'].includes(mode)) throw new TypeError('request.mode is invalid');
  if (mode === 'EXPLICIT_CATEGORIES') {
    if (!Array.isArray(request.categories)) throw new TypeError('request.categories must be an array in EXPLICIT_CATEGORIES mode');
    for (const [index, category] of request.categories.entries()) {
      record(category, `request.categories[${index}]`);
      nonEmptyString(category.requestKey, `request.categories[${index}].requestKey`);
      nonEmptyString(category.requestedName, `request.categories[${index}].requestedName`);
      if (category.limit !== undefined && (!Number.isSafeInteger(category.limit) || category.limit < 0)) throw new TypeError(`request.categories[${index}].limit is invalid`);
    }
  } else if (request.categories !== undefined) {
    throw new TypeError('request.categories is not supported in FULL_CATALOG mode');
  }
  const maxProducts = request.maxProducts ?? MAX_PRODUCTS;
  if (!Number.isSafeInteger(maxProducts) || maxProducts < 0 || maxProducts > MAX_PRODUCTS) throw new TypeError(`request.maxProducts must be between 0 and ${MAX_PRODUCTS}`);
  if (request.productInputs !== undefined) {
    record(request.productInputs, 'request.productInputs');
    for (const [productKey, input] of Object.entries(request.productInputs)) {
      nonEmptyString(productKey, 'request.productInputs key');
      record(input, `request.productInputs.${productKey}`);
      assertKnownKeys(input, PRODUCT_INPUT_KEYS, `request.productInputs.${productKey}`);
    }
  }
  if (request.export !== undefined) {
    record(request.export, 'request.export');
    assertKnownKeys(request.export, EXPORT_KEYS, 'request.export');
    nonEmptyString(request.export.inputPath, 'request.export.inputPath');
    nonEmptyString(request.export.outputPath, 'request.export.outputPath');
    if (request.export.mappingOptions !== undefined) record(request.export.mappingOptions, 'request.export.mappingOptions');
  }
  return clone({ ...request, mode, categories: request.categories ?? [], maxProducts, productInputs: request.productInputs ?? {} });
}

function normalizeOptions(options) {
  record(options, 'options');
  assertKnownKeys(options, OPTION_KEYS, 'options');
  for (const key of ['catalogOptions', 'adapterOptions', 'pricing', 'production']) if (options[key] !== undefined) record(options[key], `options.${key}`);
  if (options.catalogLoader !== undefined && typeof options.catalogLoader !== 'function') throw new TypeError('options.catalogLoader must be a function');
  if (options.adapterCollector !== undefined && typeof options.adapterCollector !== 'function') throw new TypeError('options.adapterCollector must be a function');
  if (options.excelExporter !== undefined && typeof options.excelExporter !== 'function') throw new TypeError('options.excelExporter must be a function');
  return {
    catalogLoader: options.catalogLoader ?? loadUgoptCategoryCatalog,
    adapterCollector: options.adapterCollector ?? collectUgoptCategories,
    catalogOptions: clone(options.catalogOptions ?? {}),
    adapterOptions: clone(options.adapterOptions ?? {}),
    pricing: options.pricing ?? {},
    production: options.production ?? {},
    excelExporter: options.excelExporter ?? exportFinalProductsToWorkbook,
  };
}

function fullCatalogRequest(catalog) {
  return catalog.map((category, index) => ({
    requestKey: `ugopt-catalog-${index + 1}`,
    requestedName: category.sourceCategoryName,
    sourceCategoryUrl: category.sourceCategoryUrl,
    sourceCategoryName: category.sourceCategoryName,
  }));
}

async function collectCandidates(request, options) {
  let catalog = null;
  let resolved = [];
  let unresolved = [];
  if (request.mode === 'FULL_CATALOG' || request.categories.length > 0) {
    catalog = await options.catalogLoader(options.catalogOptions);
    if (!Array.isArray(catalog)) throw new TypeError('catalogLoader must return an array');
  }
  if (request.mode === 'FULL_CATALOG') {
    resolved = fullCatalogRequest(catalog);
  } else {
    const resolution = resolveCategoryRequests({ categories: request.categories }, catalog ?? []);
    resolved = resolution.categories.filter((category) => category.resolution === 'resolved').map((category) => ({
      requestKey: category.requestKey,
      requestedName: category.requestedName,
      sourceCategoryUrl: category.resolvedCategory.sourceCategoryUrl,
      sourceCategoryName: category.resolvedCategory.sourceCategoryName,
      ...(category.limit === undefined ? {} : { limit: category.limit }),
    }));
    unresolved = resolution.categories.filter((category) => category.resolution !== 'resolved').map((category) => clone(category));
  }
  const collected = resolved.length === 0 ? { categories: [] } : await options.adapterCollector({ categories: resolved }, options.adapterOptions);
  if (!isRecord(collected) || !Array.isArray(collected.categories)) throw new TypeError('adapterCollector must return an object with categories');
  const requestedByKey = new Map(resolved.map((category) => [category.requestKey, category]));
  const categoryResults = collected.categories.map((category) => ({
    ...clone(category),
    collectionStatus: category.failure === undefined && category.resolution === 'resolved' ? 'COMPLETED' : 'FAILED',
  }));
  const selectionRequest = {
    categories: categoryResults.map((category) => ({
      requestKey: category.requestKey,
      requestedName: category.requestedName,
      resolution: category.collectionStatus === 'COMPLETED' ? 'resolved' : 'notFound',
      ...(category.collectionStatus === 'COMPLETED' ? { resolvedCategory: category.resolvedCategory } : {}),
      candidates: category.collectionStatus === 'COMPLETED' ? category.candidates : [],
    })),
  };
  const selection = selectProducts(selectionRequest);
  return {
    catalog: catalog === null ? { mode: 'NOT_LOADED', categoryCount: 0 } : { mode: request.mode, categoryCount: catalog.length },
    requestedCategories: request.mode === 'FULL_CATALOG' ? resolved : request.categories,
    collectedCategories: categoryResults,
    unresolvedCategories: unresolved,
    failedCategories: categoryResults.filter((category) => category.collectionStatus === 'FAILED'),
    selection,
    selectedProducts: selection.selectedProducts,
    requestedByKey,
  };
}

function categoryLimitByRequestKey(request) {
  return new Map(request.mode === 'FULL_CATALOG'
    ? []
    : request.categories
      .filter((category) => category.limit !== undefined)
      .map((category) => [category.requestKey, category.limit]));
}

function quotaAwareSelection(ranking, candidates, request, pricingPolicy) {
  const limits = categoryLimitByRequestKey(request);
  if (limits.size === 0) return selectTopProfitableProducts(ranking, { policy: pricingPolicy, maxProducts: request.maxProducts });

  const candidateByProductKey = new Map(candidates.map((candidate) => [candidate.selectionKey, candidate]));
  const selected = [];
  const notSelectedReady = [];
  const categorySelectedCounts = new Map();
  for (const row of ranking.ranked) {
    if (row.status !== PRICING_STATUSES.READY) continue;
    const categoryKey = candidateByProductKey.get(row.productKey)?.requestKey;
    const categoryLimit = limits.get(categoryKey);
    const selectedFromCategory = categorySelectedCounts.get(categoryKey) ?? 0;
    if (selected.length >= request.maxProducts) {
      notSelectedReady.push({ ...clone(row.decision), exclusion: 'GLOBAL_MAX_PRODUCTS' });
      continue;
    }
    if (categoryLimit !== undefined && selectedFromCategory >= categoryLimit) {
      notSelectedReady.push({ ...clone(row.decision), exclusion: 'CATEGORY_LIMIT', requestKey: categoryKey });
      continue;
    }
    selected.push(clone(row.decision));
    categorySelectedCounts.set(categoryKey, selectedFromCategory + 1);
  }
  const review = ranking.ranked.filter((row) => row.status === PRICING_STATUSES.PRICE_REVIEW).map((row) => clone(row.decision));
  const skip = ranking.ranked.filter((row) => row.status === PRICING_STATUSES.SKIP).map((row) => clone(row.decision));
  return {
    candidateCount: ranking.candidateCount,
    readyCount: ranking.ranked.filter((row) => row.status === PRICING_STATUSES.READY).length,
    reviewCount: review.length,
    skipCount: skip.length,
    selectedCount: selected.length,
    capacityRemaining: request.maxProducts - selected.length,
    maxProducts: request.maxProducts,
    selected,
    notSelectedReady,
    review,
    skip,
    ranking: clone(ranking),
    categoryQuotas: Object.fromEntries(limits),
    categorySelectedCounts: Object.fromEntries(categorySelectedCounts),
  };
}

function productInput(request, productKey) {
  return clone(request.productInputs[productKey] ?? {});
}

function pricingProductFor(selectedProduct, input) {
  if (input.pricingProduct !== undefined) return clone(input.pricingProduct);
  const product = selectedProduct.product;
  if (!isRecord(product) || product.price === undefined) return null;
  return {
    productKey: selectedProduct.selectionKey,
    supplier: {
      name: 'ug-opt',
      purchasePrice: isRecord(product.price) ? clone(product.price) : { amount: product.price, currency: 'UAH' },
      provenance: { source: 'selected-product', productKey: selectedProduct.selectionKey },
      ...(typeof product.supplierSku === 'string' ? { supplierSku: product.supplierSku } : {}),
      ...(typeof product.sourceUrl === 'string' ? { sourceUrl: product.sourceUrl } : {}),
    },
    identity: {
      ...(typeof input.sourceFacts?.brand === 'string' ? { brand: input.sourceFacts.brand } : {}),
      ...(typeof input.sourceFacts?.model === 'string' ? { model: input.sourceFacts.model } : {}),
    },
  };
}

function productionJob(selectedProduct, input) {
  const fields = [
    'supplierState', 'pricingProduct', 'sourceFacts', 'sourceText', 'categoryContext', 'sourceImages',
    'marketEvidence', 'pricingDecision', 'contentArtifact', 'photoArtifact', 'approvedMedia',
    'resolvedMetadata', 'characteristicMapping',
  ];
  const job = { selectedProduct: clone(selectedProduct) };
  for (const field of fields) if (input[field] !== undefined) job[field] = clone(input[field]);
  return job;
}

function productionOptions(options) {
  return {
    ...options.production,
    mode: options.production.mode ?? PRODUCTION_MODES.PLUS_FIRST,
    pricing: options.pricing,
  };
}

function marketWaitingResult(selectedProduct, input, options) {
  return advanceProductionProduct(productionJob(selectedProduct, input), productionOptions(options));
}

async function evaluateEconomics(candidates, request, options) {
  const pricing = [];
  const waiting = [];
  const failures = [];
  for (const selectedProduct of candidates) {
    const input = productInput(request, selectedProduct.selectionKey);
    if (input.marketEvidence === undefined && typeof options.pricing.researcher !== 'function') {
      const result = await marketWaitingResult(selectedProduct, input, options);
      waiting.push(result);
      continue;
    }
    const pricingProduct = pricingProductFor(selectedProduct, input);
    if (pricingProduct === null) {
      failures.push({ productKey: selectedProduct.selectionKey, workflowStatus: PRODUCTION_STATUSES.FAILED, diagnostics: [{ code: 'PRICING_PRODUCT_REQUIRED', stage: 'pricing', message: 'A PR22-compatible pricing product is required.' }] });
      continue;
    }
    try {
      const decision = await evaluateProductPricing(pricingProduct, {
        ...options.pricing,
        researcher: input.marketEvidence === undefined ? options.pricing.researcher : async () => clone(input.marketEvidence),
      });
      pricing.push({ selectedProduct, input, decision });
    } catch (error) {
      failures.push({ productKey: selectedProduct.selectionKey, workflowStatus: PRODUCTION_STATUSES.FAILED, diagnostics: [{ code: error.code ?? 'PRICING_EVALUATION_FAILED', stage: 'pricing', message: error.message }] });
    }
  }
  return { pricing, waiting, failures };
}

function economyResult(row) {
  const status = row.decision.status === PRICING_STATUSES.PRICE_REVIEW ? PRODUCTION_STATUSES.PRICING_REVIEW : PRODUCTION_STATUSES.SKIPPED;
  return {
    productKey: row.selectedProduct.selectionKey,
    workflowStatus: status,
    selectedProduct: clone(row.selectedProduct),
    pricingDecision: clone(row.decision),
    nextAction: null,
    diagnostics: row.decision.reasonCodes.map((code) => ({ code, stage: 'pricing', message: 'PR22 excluded this product from automatic production.' })),
  };
}

async function advanceSelected(rows, options) {
  if (rows.length === 0) return { results: [], summary: { total: 0 } };
  const jobs = rows.map((row) => productionJob(row.selectedProduct, {
    ...row.input,
    pricingProduct: pricingProductFor(row.selectedProduct, row.input),
    marketEvidence: row.input.marketEvidence,
    pricingDecision: row.decision,
  }));
  return advanceProductionBatch(jobs, productionOptions(options));
}

async function exportReadyProducts(request, selectedResults, options) {
  if (request.export === undefined) return null;
  const products = selectedResults
    .filter((result) => result.workflowStatus === PRODUCTION_STATUSES.READY_FOR_EXPORT)
    .map((result) => {
      const input = productInput(request, result.productKey);
      return { productionArtifact: result.productionArtifact, publishableMedia: input.publishableMedia };
    });
  return options.excelExporter({
    inputPath: request.export.inputPath,
    outputPath: request.export.outputPath,
    products,
    mappingOptions: request.export.mappingOptions ?? {},
  });
}

function localMediaWaiting(result, request) {
  if (result.workflowStatus !== PRODUCTION_STATUSES.READY_FOR_EXPORT) return result;
  if (productInput(request, result.productKey).publishableMedia !== undefined) return result;
  return {
    ...clone(result),
    workflowStatus: 'WAITING_FOR_MEDIA_PUBLICATION',
    diagnostics: [...result.diagnostics, { code: 'PUBLISHABLE_MEDIA_REQUIRED', stage: 'publication', message: 'Approved local media must be supplied as PR26 publishable public URLs before Excel export.' }],
  };
}

function applyExportStatuses(results, exported) {
  if (!Array.isArray(exported?.products)) return results;
  const byProductKey = new Map(exported.products.map((product) => [product.productKey, product]));
  return results.map((result) => {
    const product = byProductKey.get(result.productKey);
    return product?.status === 'EXPORTED' ? { ...clone(result), workflowStatus: 'EXPORTED' } : result;
  });
}

function summaryFor({ collected, economics, selection, productionResults, exported }) {
  const results = [...economics.waiting, ...economics.failures, ...economics.pricing.filter((row) => row.decision.status !== PRICING_STATUSES.READY).map(economyResult), ...productionResults];
  const count = (status) => results.filter((result) => result.workflowStatus === status).length;
  return {
    catalogCategories: collected.catalog.categoryCount,
    categoriesCompleted: collected.collectedCategories.filter((category) => category.collectionStatus === 'COMPLETED').length,
    categoriesFailed: collected.failedCategories.length + collected.unresolvedCategories.length,
    candidateProducts: collected.selection.summary.selectedCount,
    pricingReady: economics.pricing.filter((row) => row.decision.status === PRICING_STATUSES.READY).length,
    pricingReview: count(PRODUCTION_STATUSES.PRICING_REVIEW),
    pricingSkipped: count(PRODUCTION_STATUSES.SKIPPED),
    selectedProducts: selection.selectedCount,
    waitingMarketResearch: count(PRODUCTION_STATUSES.WAITING_FOR_MARKET_RESEARCH),
    waitingContent: count(PRODUCTION_STATUSES.WAITING_FOR_CONTENT),
    waitingPhotos: count(PRODUCTION_STATUSES.WAITING_FOR_PHOTOS) + count(PRODUCTION_STATUSES.PHOTO_REWORK),
    waitingMediaPublication: count('WAITING_FOR_MEDIA_PUBLICATION'),
    readyForExcel: count(PRODUCTION_STATUSES.READY_FOR_EXPORT),
    exported: exported?.products?.filter((product) => product.status === 'EXPORTED').length ?? 0,
    failed: count(PRODUCTION_STATUSES.FAILED),
  };
}

function runStatus(summary, tasks, categoryFailures) {
  if (summary.failed > 0 && summary.selectedProducts === 0 && tasks.length === 0) return END_TO_END_RUN_STATUSES.FAILED;
  if (tasks.length > 0) return END_TO_END_RUN_STATUSES.WAITING_FOR_OPERATOR;
  if (summary.pricingReview > 0 || categoryFailures > 0) return END_TO_END_RUN_STATUSES.REVIEW_REQUIRED;
  if (summary.waitingMediaPublication > 0 || summary.failed > 0 || summary.pricingSkipped > 0) return END_TO_END_RUN_STATUSES.PARTIAL;
  return END_TO_END_RUN_STATUSES.COMPLETED;
}

/**
 * Stateless PR27 composition boundary. It collects every in-scope candidate,
 * evaluates economics before content/photos, selects at most the PR22-ranked
 * top 6000, then delegates each selected product to PR25 and PR26.
 */
export async function runEndToEndProduction(request, options = {}) {
  const normalizedRequest = normalizeRequest(request);
  const normalizedOptions = normalizeOptions(options);
  const collected = await collectCandidates(normalizedRequest, normalizedOptions);
  const economics = await evaluateEconomics(collected.selectedProducts, normalizedRequest, normalizedOptions);
  const decisions = economics.pricing.map((row) => row.decision);
  const ranking = rankPricingDecisions(decisions, { policy: normalizedOptions.pricing.policy });
  const selection = quotaAwareSelection(ranking, collected.selectedProducts, normalizedRequest, normalizedOptions.pricing.policy);
  const byProductKey = new Map(economics.pricing.map((row) => [row.selectedProduct.selectionKey, row]));
  const selectedRows = selection.selected.map((decision) => byProductKey.get(decision.productKey));
  const produced = await advanceSelected(selectedRows, normalizedOptions);
  const selectedResults = produced.results.map((result) => localMediaWaiting(result, normalizedRequest));
  const exported = await exportReadyProducts(normalizedRequest, selectedResults, normalizedOptions);
  const exportedResults = applyExportStatuses(selectedResults, exported);
  const economicExcluded = economics.pricing.filter((row) => row.decision.status !== PRICING_STATUSES.READY).map(economyResult);
  const notSelected = selection.notSelectedReady.map((decision) => ({
    productKey: decision.productKey,
    workflowStatus: decision.exclusion === 'CATEGORY_LIMIT' ? 'NOT_SELECTED_BY_CATEGORY_QUOTA' : 'NOT_SELECTED_BY_PR22_RANKING',
    pricingDecision: clone(decision),
    diagnostics: [{
      code: decision.exclusion === 'CATEGORY_LIMIT' ? 'CATEGORY_SELECTION_LIMIT' : 'TOP_6000_CAPACITY',
      stage: 'ranking',
      message: decision.exclusion === 'CATEGORY_LIMIT'
        ? 'Economically READY but outside this category final selection limit.'
        : 'Economically READY but outside the PR22 top-product selection.',
    }],
  }));
  const products = [...economics.waiting, ...economics.failures, ...economicExcluded, ...notSelected, ...exportedResults];
  const operatorTasks = collectOperatorTasks({ results: [...economics.waiting, ...exportedResults] });
  const summary = summaryFor({ collected, economics, selection, productionResults: exportedResults, exported });
  const diagnostics = [
    ...collected.unresolvedCategories.map((category) => ({ code: `CATEGORY_${category.resolution.toUpperCase()}`, stage: 'catalog', category: category.requestKey })),
    ...collected.failedCategories.map((category) => ({ code: 'SUPPLIER_CATEGORY_FAILED', stage: 'supplier', category: category.requestKey, failure: clone(category.failure) })),
  ];
  return {
    status: runStatus(summary, operatorTasks, summary.categoriesFailed),
    scope: { mode: normalizedRequest.mode, maxProducts: normalizedRequest.maxProducts },
    catalog: collected.catalog,
    candidates: { products: clone(collected.selectedProducts), selection: clone(collected.selection), categories: clone(collected.collectedCategories) },
    pricing: { decisions: clone(decisions), waiting: clone(economics.waiting) },
    ranking: clone(ranking),
    selected: clone(selection),
    products,
    operatorTasks,
    export: exported === null ? null : clone(exported),
    summary,
    diagnostics,
  };
}

export class EndToEndProductionRunnerError extends Error {
  constructor(message, code = 'END_TO_END_PRODUCTION_RUNNER_ERROR') {
    super(message);
    this.name = 'EndToEndProductionRunnerError';
    this.code = code;
  }
}
