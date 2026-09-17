import { resolveCategoryRequests } from '../categories/category-resolver.mjs';
import { selectProducts } from '../selection/product-selector.mjs';
import { loadUgoptCategoryCatalog } from '../suppliers/ugopt/category-catalog.mjs';
import { collectUgoptCategories } from '../suppliers/ugopt/category-adapter.mjs';

export class UgoptRunOrchestrationError extends Error {
  constructor(message, { kind, category, failure, cause } = {}) {
    super(message, cause === undefined ? {} : { cause });
    this.name = 'UgoptRunOrchestrationError';
    this.kind = kind;
    if (category !== undefined) this.category = category;
    if (failure !== undefined) this.failure = failure;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function dependencyOptions(options, optionName) {
  const configured = options[optionName] ?? {};
  if (!isRecord(configured)) throw new TypeError(`${optionName} must be an object`);
  return options.fetchImpl === undefined ? { ...configured } : { ...configured, fetchImpl: options.fetchImpl };
}

function mapResolvedCategory(category) {
  const resolvedCategory = category.resolvedCategory;
  const mapped = {
    requestKey: category.requestKey,
    requestedName: category.requestedName,
    sourceCategoryUrl: resolvedCategory.sourceCategoryUrl,
    sourceCategoryName: resolvedCategory.sourceCategoryName,
  };
  if (Object.prototype.hasOwnProperty.call(category, 'limit')) mapped.limit = category.limit;
  return mapped;
}

function statusFor(resolutionSummary) {
  if (resolutionSummary.resolvedCount === resolutionSummary.requestedCount) return 'completed';
  if (resolutionSummary.resolvedCount > 0) return 'partial';
  return 'blocked';
}

function emptySelectionRequest(runRequest) {
  return { ...runRequest, categories: [] };
}

function throwForAdapterFailure(category) {
  if (!category?.failure) return;
  throw new UgoptRunOrchestrationError(
    `UG-OPT category adapter failed for ${category.requestKey}: ${category.failure.message ?? category.failure.kind}`,
    { kind: 'adapter', category: category.requestKey, failure: category.failure },
  );
}

/**
 * Resolve human UG-OPT category requests, collect only resolved supplier
 * categories, and select products using the existing Product Selector.
 * Catalog and adapter dependencies are injectable so automated tests stay
 * offline; an injected fetchImpl is forwarded to both existing loaders.
 */
export async function runUgoptProductSelection(runRequest, options = {}) {
  if (!isRecord(options)) throw new TypeError('options must be an object');
  const catalogLoader = options.catalogLoader ?? loadUgoptCategoryCatalog;
  const adapterCollector = options.adapterCollector ?? collectUgoptCategories;
  if (typeof catalogLoader !== 'function') throw new TypeError('catalogLoader must be a function');
  if (typeof adapterCollector !== 'function') throw new TypeError('adapterCollector must be a function');

  const catalog = await catalogLoader(dependencyOptions(options, 'catalogOptions'));
  const resolution = resolveCategoryRequests(runRequest, catalog);
  const resolvedCategories = resolution.categories.filter((category) => category.resolution === 'resolved');
  const adapterRequest = {
    ...runRequest,
    categories: resolvedCategories.map(mapResolvedCategory),
  };

  let selection;
  if (resolvedCategories.length === 0) {
    selection = selectProducts(emptySelectionRequest(runRequest));
  } else {
    const collectedRequest = await adapterCollector(adapterRequest, dependencyOptions(options, 'adapterOptions'));
    if (!isRecord(collectedRequest) || !Array.isArray(collectedRequest.categories)) {
      throw new UgoptRunOrchestrationError('UG-OPT category adapter returned an invalid request result', { kind: 'adapter-contract' });
    }
    collectedRequest.categories.forEach(throwForAdapterFailure);
    selection = selectProducts(collectedRequest);
  }

  const runStatus = statusFor(resolution.summary);
  return {
    runStatus,
    request: runRequest,
    catalogSummary: {
      source: 'ug-opt',
      categoryCount: catalog.length,
    },
    resolution,
    selectedProducts: selection.selectedProducts,
    selection,
    summary: {
      requestedCategoryCount: resolution.summary.requestedCount,
      resolvedCategoryCount: resolution.summary.resolvedCount,
      notFoundCategoryCount: resolution.summary.notFoundCount,
      ambiguousCategoryCount: resolution.summary.ambiguousCount,
      selectedProductCount: selection.summary.selectedCount,
      selectedCount: selection.summary.selectedCount,
    },
  };
}
