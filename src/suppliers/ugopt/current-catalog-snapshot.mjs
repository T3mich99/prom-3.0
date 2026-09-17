import { resolveCategoryRequests } from '../../categories/category-resolver.mjs';
import { buildUgoptCatalogSnapshot } from './daily-catalog-sync.mjs';
import { collectUgoptCategories } from './category-adapter.mjs';
import { loadUgoptCategoryCatalog } from './category-catalog.mjs';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function dependencyOptions(options, key) {
  const value = options[key] ?? {};
  if (!isRecord(value)) throw new TypeError(`${key} must be an object`);
  return options.fetchImpl === undefined ? clone(value) : { ...clone(value), fetchImpl: options.fetchImpl };
}

function fullCatalogCategories(catalog) {
  return catalog.map((category, index) => ({
    requestKey: `ugopt-catalog-${index + 1}`,
    requestedName: category.sourceCategoryName,
    sourceCategoryUrl: category.sourceCategoryUrl,
    sourceCategoryName: category.sourceCategoryName,
  }));
}

function resolvedCategories(productionRequest, catalog) {
  if (!isRecord(productionRequest)) throw new TypeError('productionRequest must be an object');
  if (productionRequest.mode === 'FULL_CATALOG') return { requested: fullCatalogCategories(catalog), unresolved: [] };
  if (productionRequest.mode !== undefined && productionRequest.mode !== 'EXPLICIT_CATEGORIES') {
    throw new TypeError('productionRequest.mode is invalid');
  }
  if (!Array.isArray(productionRequest.categories)) throw new TypeError('productionRequest.categories must be an array');
  const resolution = resolveCategoryRequests({ categories: productionRequest.categories }, catalog);
  return {
    requested: resolution.categories.filter((category) => category.resolution === 'resolved').map((category) => ({
      requestKey: category.requestKey,
      requestedName: category.requestedName,
      sourceCategoryUrl: category.resolvedCategory.sourceCategoryUrl,
      sourceCategoryName: category.resolvedCategory.sourceCategoryName,
    })),
    unresolved: resolution.categories.filter((category) => category.resolution !== 'resolved').map((category) => category.requestKey),
  };
}

function minorFromCatalogPrice(price) {
  if (!Number.isFinite(price) || price < 0) return undefined;
  const minor = Math.round(price * 100);
  if (!Number.isSafeInteger(minor) || Math.abs((minor / 100) - price) > Number.EPSILON) return undefined;
  return minor;
}

function snapshotProduct(candidate, category) {
  const product = candidate?.product;
  if (!isRecord(product) || typeof candidate.selectionKey !== 'string' || !candidate.selectionKey) return null;
  const output = {
    productKey: candidate.selectionKey,
    supplier: 'ug-opt',
    availability: 'UNKNOWN',
    currency: 'UAH',
    categoryKey: category.requestKey,
    provenance: {
      source: 'ug-opt-category-adapter',
      sourceCategoryUrl: category.sourceCategoryUrl,
      sourceCategoryName: category.sourceCategoryName,
      sourceProductId: product.sourceProductId,
    },
  };
  if (typeof product.supplierSku === 'string' && product.supplierSku) output.supplierSku = product.supplierSku;
  if (typeof product.sourceUrl === 'string' && product.sourceUrl) output.sourceUrl = product.sourceUrl;
  const priceMinor = minorFromCatalogPrice(product.price);
  if (priceMinor !== undefined) output.purchasePriceMinor = priceMinor;
  return output;
}

/**
 * Builds the PR23 snapshot from the existing live UG-OPT category catalog and
 * adapter boundaries. The current category-card contract has no confirmed
 * stock signal, so availability is deliberately UNKNOWN rather than inferred
 * from a successful page request.
 */
export async function collectCurrentUgoptCatalogSnapshot({ productionRequest, scanId, ...options } = {}) {
  if (!isRecord(options)) throw new TypeError('options must be an object');
  const catalogLoader = options.catalogLoader ?? loadUgoptCategoryCatalog;
  const adapterCollector = options.adapterCollector ?? collectUgoptCategories;
  if (typeof catalogLoader !== 'function') throw new TypeError('catalogLoader must be a function');
  if (typeof adapterCollector !== 'function') throw new TypeError('adapterCollector must be a function');
  if (scanId !== undefined) requiredString(scanId, 'scanId');

  const catalog = await catalogLoader(dependencyOptions(options, 'catalogOptions'));
  if (!Array.isArray(catalog)) throw new TypeError('catalogLoader must return an array');
  const resolved = resolvedCategories(productionRequest, catalog);
  const requestedKeys = productionRequest.mode === 'FULL_CATALOG'
    ? resolved.requested.map((category) => category.requestKey)
    : productionRequest.categories.map((category) => category.requestKey);
  if (requestedKeys.length === 0) throw new TypeError('productionRequest must request at least one category for live supplier monitoring');

  const collected = resolved.requested.length === 0
    ? { categories: [] }
    : await adapterCollector({ categories: resolved.requested }, dependencyOptions(options, 'adapterOptions'));
  if (!isRecord(collected) || !Array.isArray(collected.categories)) throw new TypeError('adapterCollector must return an object with categories');

  const resultByKey = new Map(collected.categories.map((category) => [category.requestKey, category]));
  const completedCategoryKeys = [];
  const failedCategoryKeys = [...resolved.unresolved];
  const products = [];
  const seenProducts = new Set();
  for (const category of resolved.requested) {
    const result = resultByKey.get(category.requestKey);
    if (!result || result.failure !== undefined || result.resolution !== 'resolved' || !Array.isArray(result.candidates)) {
      failedCategoryKeys.push(category.requestKey);
      continue;
    }
    completedCategoryKeys.push(category.requestKey);
    for (const candidate of result.candidates) {
      const product = snapshotProduct(candidate, category);
      if (product === null || seenProducts.has(product.productKey)) continue;
      seenProducts.add(product.productKey);
      products.push(product);
    }
  }
  const complete = failedCategoryKeys.length === 0 && completedCategoryKeys.length === requestedKeys.length;
  return buildUgoptCatalogSnapshot({
    supplier: 'ug-opt',
    ...(scanId === undefined ? {} : { scanId }),
    scope: { requestedCategoryKeys: requestedKeys, completedCategoryKeys, failedCategoryKeys },
    complete,
    products,
  });
}
