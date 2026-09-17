import { parseUgoptCategoryHtml } from './category-parser.mjs';
import { selectProducts } from '../../selection/product-selector.mjs';

const UGOPT_ORIGIN = 'https://ug-opt.in.ua';
const ALLOWED_UGOPT_HOSTNAMES = new Set(['ug-opt.in.ua']);
const PAGE_SIZE = 48;
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36',
  'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
}

function validateCategoryRequest(category) {
  if (!isRecord(category)) throw new TypeError('category request must be an object');
  requireNonEmptyString(category.requestKey, 'requestKey');
  requireNonEmptyString(category.requestedName, 'requestedName');
  requireNonEmptyString(category.sourceCategoryUrl, 'sourceCategoryUrl');
  let parsed;
  try {
    parsed = new URL(category.sourceCategoryUrl);
  } catch {
    throw new TypeError('sourceCategoryUrl must be a valid URL');
  }
  if (!/^https?:$/u.test(parsed.protocol)) throw new TypeError('sourceCategoryUrl must use HTTP or HTTPS');
  if (!ALLOWED_UGOPT_HOSTNAMES.has(parsed.hostname)) {
    throw new TypeError('sourceCategoryUrl must use an allowed UG-OPT hostname');
  }
  return parsed.toString();
}

function validateFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
}

function pageUrl(sourceCategoryUrl, page, pageSize) {
  const url = new URL(sourceCategoryUrl);
  url.searchParams.set('product_items_per_page', String(pageSize));
  url.searchParams.set('page', String(page));
  return url.toString();
}

function failureCategory(category, failure, pagesFetched = 0) {
  return {
    requestKey: category.requestKey,
    requestedName: category.requestedName,
    sourceCategoryUrl: category.sourceCategoryUrl,
    ...(Object.prototype.hasOwnProperty.call(category, 'limit') ? { limit: category.limit } : {}),
    resolution: 'notFound',
    candidates: [],
    pagesFetched,
    failure,
  };
}

function failureFromError(error) {
  return { kind: 'network', message: error instanceof Error ? error.message : String(error) };
}

function deduplicateCategoryCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.selectionKey)) return false;
    seen.add(candidate.selectionKey);
    return true;
  });
}

async function fetchPage(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url, { headers: REQUEST_HEADERS });
  } catch (error) {
    return { failure: failureFromError(error) };
  }
  if (!response || response.ok !== true) {
    const status = Number.isInteger(response?.status) ? response.status : null;
    return {
      failure: {
        kind: 'http',
        status,
        message: `UG-OPT category request failed${status === null ? '' : ` with HTTP ${status}`}`,
      },
    };
  }
  try {
    return { html: await response.text() };
  } catch (error) {
    return { failure: { kind: 'network', message: error instanceof Error ? error.message : String(error) } };
  }
}

function resolvedCategory(category) {
  return {
    source: 'ug-opt',
    sourceCategoryUrl: category.sourceCategoryUrl,
    sourceCategoryName: category.sourceCategoryName ?? category.requestedName,
  };
}

/**
 * Collect one runtime-requested UG-OPT category. Fetch failures are returned
 * as explicit notFound results so callers can preserve the requested category
 * in the selector report without silently falling back elsewhere.
 */
export async function collectUgoptCategory(category, options = {}) {
  const sourceCategoryUrl = validateCategoryRequest(category);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  validateFetch(fetchImpl);
  const pageSize = options.pageSize ?? PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new TypeError('pageSize must be a positive integer');

  const sourceCategory = { ...category, sourceCategoryUrl };
  const pages = [];
  const firstPage = await fetchPage(fetchImpl, pageUrl(sourceCategoryUrl, 1, pageSize));
  if (firstPage.failure) return failureCategory(sourceCategory, firstPage.failure);
  try {
    pages.push(parseUgoptCategoryHtml(firstPage.html, { origin: UGOPT_ORIGIN }));
  } catch (error) {
    return failureCategory(sourceCategory, { kind: 'parse', message: error instanceof Error ? error.message : String(error) });
  }

  const pageCount = Math.max(pages[0].pageCount, 1);
  for (let page = 2; page <= pageCount; page += 1) {
    const result = await fetchPage(fetchImpl, pageUrl(sourceCategoryUrl, page, pageSize));
    if (result.failure) return failureCategory(sourceCategory, result.failure, pages.length);
    try {
      pages.push(parseUgoptCategoryHtml(result.html, { origin: UGOPT_ORIGIN }));
    } catch (error) {
      return failureCategory(sourceCategory, { kind: 'parse', message: error instanceof Error ? error.message : String(error) }, pages.length);
    }
  }

  const candidates = deduplicateCategoryCandidates(pages.flatMap((page) => page.candidates));
  return {
    requestKey: sourceCategory.requestKey,
    requestedName: sourceCategory.requestedName,
    sourceCategoryUrl: sourceCategory.sourceCategoryUrl,
    ...(Object.prototype.hasOwnProperty.call(sourceCategory, 'limit') ? { limit: sourceCategory.limit } : {}),
    resolution: 'resolved',
    resolvedCategory: resolvedCategory(sourceCategory),
    candidates,
    pagesFetched: pages.length,
  };
}

/** Collect all runtime-requested categories in request order. */
export async function collectUgoptCategories(runRequest, options = {}) {
  if (!isRecord(runRequest) || !Array.isArray(runRequest.categories)) {
    throw new TypeError('runRequest.categories must be an array');
  }
  const categories = [];
  for (const category of runRequest.categories) categories.push(await collectUgoptCategory(category, options));
  return { ...runRequest, categories };
}

/** Collect UG-OPT candidates and pass the resulting request to Product Selector v1. */
export async function collectAndSelectUgoptCategories(runRequest, options = {}) {
  const collectedRequest = await collectUgoptCategories(runRequest, options);
  return {
    collectedRequest,
    selection: selectProducts(collectedRequest),
  };
}
