import { parseUgoptProductDetailHtml } from './product-detail-parser.mjs';

function productUrl(candidate) {
  const value = candidate?.product?.sourceUrl ?? candidate?.sourceUrl;
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('candidate product sourceUrl is required');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/(^|\.)ug-opt\.in\.ua$/iu.test(url.hostname)) throw new TypeError('UG-OPT product URL must use the official HTTPS host');
  return url;
}

/** Fetch and parse one official supplier product page without retries or partial trust. */
export async function collectUgoptProductDetail(candidate, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const url = productUrl(candidate);
  let response;
  try { response = await fetchImpl(url, { headers: { accept: 'text/html' }, redirect: 'follow' }); } catch (cause) {
    const error = new Error(`UG-OPT product request failed: ${url}`);
    error.code = 'UGOPT_PRODUCT_NETWORK_ERROR';
    error.cause = cause;
    throw error;
  }
  if (!response?.ok) {
    const error = new Error(`UG-OPT product request returned HTTP ${response?.status ?? 'unknown'}: ${url}`);
    error.code = 'UGOPT_PRODUCT_HTTP_ERROR';
    throw error;
  }
  const html = await response.text();
  try {
    return parseUgoptProductDetailHtml(html, { productKey: candidate.selectionKey, sourceUrl: url.toString(), origin: url.origin });
  } catch (cause) {
    const error = new Error(`UG-OPT product page could not be parsed: ${url}`);
    error.code = 'UGOPT_PRODUCT_PARSE_ERROR';
    error.cause = cause;
    throw error;
  }
}
