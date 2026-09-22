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
  const getFirst = (patterns) => {
    for (const pattern of patterns) {
      const value = raw.match(pattern)?.[1] ?? '';
      if (value) return value;
    }
    return '';
  };
  const supplierSku = decodeHtml(getFirst([
    /cs-product-list__sku[\s\S]*?<span\b[^>]*title="([\p{L}\p{N}_-]+)"/iu,
  ]));
  const sourceUrl = absoluteUrl(decodeHtml(getFirst([
    /data-product-url="([^"]+)"/iu,
    /class="[^"]*cs-goods-title[^"]*"[^>]*href="([^"]+)"/iu,
  ])), origin);
  const title = decodeHtml(getFirst([
    /data-product-name="([^"]+)"/iu,
    /class="[^"]*cs-goods-title[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/iu,
  ]));
  const sourceImageUrl = absoluteUrl(decodeHtml(getFirst([
    /data-product-big-picture="([^"]+)"/iu,
    /class="[^"]*cs-product-list__image[^"]*"[^>]*src="([^"]+)"/iu,
  ])), origin);
  const price = parsePrice(getFirst([
    /data-product-price="([^"]+)"/iu,
    /class="[^"]*cs-goods-price__value[^"]*"[^>]*>\s*([^<]+?)\s*</iu,
  ]));
  const sourceProductId = decodeHtml(getFirst([
    /^<li\b[^>]*data-product-id="([^"]+)"/iu,
  ]));

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
