import { parseUgoptCategoryCatalogHtml, UgoptCategoryCatalogParseError } from './category-catalog-parser.mjs';

export const UGOPT_CATEGORY_CATALOG_URL = 'https://ug-opt.in.ua/ua/';
const UGOPT_HOSTNAME = 'ug-opt.in.ua';
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36',
  'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
};

export class UgoptCategoryCatalogError extends Error {
  constructor(message, { kind, status, cause } = {}) {
    super(message, cause === undefined ? {} : { cause });
    this.name = 'UgoptCategoryCatalogError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

function validateSourceUrl(sourceUrl) {
  if (typeof sourceUrl !== 'string' || sourceUrl.trim().length === 0) {
    throw new TypeError('sourceUrl must be a non-empty string');
  }
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new TypeError('sourceUrl must be a valid URL');
  }
  if (!/^https?:$/u.test(parsed.protocol) || parsed.hostname !== UGOPT_HOSTNAME) {
    throw new TypeError(`sourceUrl must use the UG-OPT hostname ${UGOPT_HOSTNAME}`);
  }
  if (parsed.hash || !parsed.pathname.startsWith('/ua/')) {
    throw new TypeError('sourceUrl must be a UG-OPT Ukrainian catalog page');
  }
  return parsed.toString();
}

function validateFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
}

/**
 * Load the live UG-OPT navigation once and return the resolver-compatible
 * source-category catalog. Network, HTTP, and parse failures are explicit.
 */
export async function loadUgoptCategoryCatalog(options = {}) {
  const sourceUrl = validateSourceUrl(options.sourceUrl ?? UGOPT_CATEGORY_CATALOG_URL);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  validateFetch(fetchImpl);

  let response;
  try {
    response = await fetchImpl(sourceUrl, { headers: REQUEST_HEADERS });
  } catch (error) {
    throw new UgoptCategoryCatalogError(
      `UG-OPT category catalog request failed: ${error instanceof Error ? error.message : String(error)}`,
      { kind: 'network', cause: error },
    );
  }
  if (!response || response.ok !== true) {
    const status = Number.isInteger(response?.status) ? response.status : undefined;
    throw new UgoptCategoryCatalogError(
      `UG-OPT category catalog request failed${status === undefined ? '' : ` with HTTP ${status}`}`,
      { kind: 'http', status },
    );
  }

  let html;
  try {
    html = await response.text();
  } catch (error) {
    throw new UgoptCategoryCatalogError(
      `UG-OPT category catalog response could not be read: ${error instanceof Error ? error.message : String(error)}`,
      { kind: 'network', cause: error },
    );
  }

  try {
    return parseUgoptCategoryCatalogHtml(html, { origin: new URL(sourceUrl).origin });
  } catch (error) {
    if (error instanceof UgoptCategoryCatalogParseError) {
      throw new UgoptCategoryCatalogError(error.message, { kind: 'parse', cause: error });
    }
    throw new UgoptCategoryCatalogError(
      `UG-OPT category catalog could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      { kind: 'parse', cause: error },
    );
  }
}
