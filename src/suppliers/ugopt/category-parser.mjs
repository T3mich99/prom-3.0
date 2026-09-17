const DEFAULT_ORIGIN = 'https://ug-opt.in.ua';

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&quot;/gu, '"')
    .replace(/&#34;/gu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&#x2F;/giu, '/')
    .replace(/\s+/gu, ' ')
    .trim();
}

function absoluteUrl(value, origin) {
  if (!value) return '';
  return new URL(value, origin).toString();
}

function parsePrice(value) {
  const normalized = decodeHtml(value).replace(/[^\d.,]/gu, '').replace(',', '.');
  const price = Number(normalized);
  return Number.isFinite(price) ? price : null;
}

function parseCard(raw, { origin }) {
  const get = (pattern) => raw.match(pattern)?.[1] ?? '';
  const supplierSku = decodeHtml(get(/cs-product-list__sku[\s\S]*?<span\b[^>]*title="([^"]+)"/iu));
  const sourceUrl = absoluteUrl(decodeHtml(get(/data-product-url="([^"]+)"/iu)), origin);
  const title = decodeHtml(get(/data-product-name="([^"]+)"/iu));
  const sourceImageUrl = absoluteUrl(decodeHtml(get(/data-product-big-picture="([^"]+)"/iu)), origin);
  const price = parsePrice(get(/data-product-price="([^"]+)"/iu));
  const sourceProductId = decodeHtml(get(/^<li\b[^>]*data-product-id="([^"]+)"/iu));

  if (!sourceProductId || !supplierSku || !sourceUrl || !title) return null;

  const product = {
    supplier: 'ug-opt',
    sourceUrl,
    supplierSku,
    title,
    sourceProductId,
  };
  if (price !== null) product.price = price;
  if (sourceImageUrl) product.sourceImageUrl = sourceImageUrl;

  return {
    selectionKey: `ugopt:${supplierSku}`,
    product,
  };
}

/**
 * Parse one UG-OPT category page without network or filesystem access.
 * The selectors intentionally follow the card markup used by the existing
 * UG-OPT selectors. The returned order is the order of cards in the HTML.
 */
export function parseUgoptCategoryHtml(html, options = {}) {
  if (typeof html !== 'string') throw new TypeError('html must be a string');

  const origin = options.origin ?? DEFAULT_ORIGIN;
  const paginationMarker = html.match(/data-pagination-pages-count="(\d+)"/iu);
  if (!paginationMarker) throw new Error('Unrecognized UG-OPT category page: missing pagination marker');
  const candidates = [];
  for (const match of html.matchAll(/<li\b[^>]*data-product-id="\d+"[\s\S]*?<\/li>/giu)) {
    const candidate = parseCard(match[0], { origin });
    if (candidate) candidates.push(candidate);
  }

  return {
    pageCount: Number(paginationMarker[1]),
    candidates,
  };
}
