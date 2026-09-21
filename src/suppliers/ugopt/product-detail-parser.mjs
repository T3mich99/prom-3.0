const DEFAULT_ORIGIN = 'https://ug-opt.in.ua';

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;|&ldquo;|&rdquo;/gu, '"')
    .replace(/&apos;|&#39;|&lsquo;|&rsquo;/gu, "'")
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/\s+/gu, ' ')
    .trim();
}

function stripHtml(value) {
  return decodeHtml(String(value ?? '')
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<\/p\s*>/giu, '\n')
    .replace(/<\/li\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' '));
}

function absoluteUrl(value, origin) {
  if (!value) return '';
  try { return new URL(decodeHtml(value), origin).toString(); } catch { return ''; }
}

function productJsonLd(html) {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]));
      const candidates = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed]);
      const product = candidates.find((item) => item && (item['@type'] === 'Product' || item['@type']?.includes?.('Product')));
      if (product) return product;
    } catch { /* another JSON-LD block may contain the product */ }
  }
  return null;
}

function characteristicPairs(html) {
  const pairs = [];
  const seen = new Set();
  const add = (name, value) => {
    const normalizedName = stripHtml(name);
    const normalizedValue = stripHtml(value);
    if (!normalizedName || !normalizedValue) return;
    const identity = `${normalizedName}\u0000${normalizedValue}`;
    if (!seen.has(identity)) pairs.push({ name: normalizedName, value: normalizedValue });
    seen.add(identity);
  };
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/giu)].map((match) => match[1]);
    if (cells.length >= 2) add(cells[0], cells[1]);
  }
  for (const item of html.matchAll(/<[^>]+data-qaid=["']product_characteristic_item["'][^>]*>([\s\S]*?)(?=<[^>]+data-qaid=["']product_characteristic_item["']|<\/table>|<\/ul>)/giu)) {
    const name = item[1].match(/data-qaid=["']product_characteristic_name["'][^>]*>([\s\S]*?)<\//iu)?.[1];
    const value = item[1].match(/data-qaid=["']product_characteristic_value["'][^>]*>([\s\S]*?)<\//iu)?.[1];
    add(name, value);
  }
  return pairs;
}

const MEASUREMENT_RULES = Object.freeze([
  { key: 'reservoirCapacityMl', labels: [/об['’]?єм.*(?:резервуар|бак|ємн)/iu, /місткість/iu, /объем.*(?:резервуар|бак|емк)/iu], units: ['мл', 'ml', 'л', 'l'] },
  { key: 'powerW', labels: [/потужність/iu, /мощность/iu], units: ['вт', 'w'] },
  { key: 'voltageV', labels: [/напруг/iu, /напряж/iu], units: ['в', 'v'] },
]);

function normalizedMeasurement(value, units) {
  const pattern = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${units.join('|')})(?![\\p{L}])`, 'iu');
  const match = decodeHtml(value).match(pattern);
  if (!match) return null;
  let amount = Number(match[1].replace(',', '.'));
  const unit = match[2].toLocaleLowerCase('uk-UA');
  if (unit === 'л' || unit === 'l') amount *= 1000;
  return Number.isFinite(amount) ? amount : null;
}

function measurementDiagnostics(characteristics, description) {
  const diagnostics = [];
  for (const rule of MEASUREMENT_RULES) {
    const tableValues = characteristics
      .filter((item) => rule.labels.some((label) => label.test(item.name)))
      .map((item) => normalizedMeasurement(item.value, rule.units))
      .filter((value) => value !== null);
    const descriptionLines = description.split(/\n|[.;]/u);
    const textValues = descriptionLines
      .filter((line) => rule.labels.some((label) => label.test(line)))
      .map((line) => normalizedMeasurement(line, rule.units))
      .filter((value) => value !== null);
    const values = [...new Set([...tableValues, ...textValues])];
    if (values.length > 1) diagnostics.push({
      code: 'SOURCE_FACT_CONFLICT',
      field: rule.key,
      values,
      message: `Supplier page contains conflicting values for ${rule.key}.`,
    });
  }
  return diagnostics;
}

function imageUrls(product, html, origin) {
  const values = [];
  const add = (value) => {
    const url = absoluteUrl(value, origin);
    if (url && !values.includes(url)) values.push(url);
  };
  for (const value of Array.isArray(product?.image) ? product.image : [product?.image]) add(value);
  for (const match of html.matchAll(/(?:data-product-big-picture|data-zoom-image|data-original)=["']([^"']+)["']/giu)) add(match[1]);
  return values;
}

function variantDiagnostics(title, description, characteristics) {
  const combined = `${title}\n${description}\n${characteristics.map((item) => `${item.name}: ${item.value}`).join('\n')}`;
  const diagnostics = [];
  if (/\b(?:в|у)\s+асортименті\b|різн(?:і|их)\s+кольор|разн(?:ые|ых)\s+цвет/iu.test(combined)) {
    diagnostics.push({
      code: 'SOURCE_VARIANT_AMBIGUOUS',
      field: 'variant',
      message: 'Supplier offers an unspecified assortment or multiple colors; one sellable variant must be selected explicitly.',
    });
  }
  return diagnostics;
}

function canonicalFactKey(name, index) {
  const value = decodeHtml(name);
  if (/потужність|мощность/iu.test(value)) return 'power';
  if (/напруг|напряж/iu.test(value)) return 'voltage';
  if (/об['’]?єм.*(?:резервуар|бак|ємн)|місткість|объем.*(?:резервуар|бак|емк)/iu.test(value)) return 'reservoirCapacity';
  if (/колір|цвет/iu.test(value)) return 'color';
  if (/матеріал|материал/iu.test(value)) return 'material';
  if (/комплектац/iu.test(value)) return 'includedAccessories';
  return `supplierFact${index + 1}`;
}

function productBrand(product) {
  return decodeHtml(typeof product?.brand === 'string' ? product.brand : product?.brand?.name);
}

function publicType(title, brand, model) {
  let value = title;
  for (const token of [brand, model]) if (token) value = value.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu'), ' ');
  value = value.replace(/\b(?=[\p{L}\d-]*\d)(?=[\p{L}\d-]*\p{L})[\p{L}\d]+(?:-[\p{L}\d]+)+\b/giu, ' ');
  return value.replace(/[|,;–—-]+\s*$/gu, '').replace(/\s+/gu, ' ').trim() || title;
}

/** Parse one official UG-OPT product page into fail-closed source evidence. */
export function parseUgoptProductDetailHtml(html, { productKey, sourceUrl, origin = DEFAULT_ORIGIN } = {}) {
  if (typeof html !== 'string') throw new TypeError('html must be a string');
  if (typeof productKey !== 'string' || !productKey.trim()) throw new TypeError('productKey must be a non-empty string');
  const product = productJsonLd(html);
  if (!product) throw new Error('Unrecognized UG-OPT product page: Product JSON-LD is missing');
  const title = decodeHtml(product.name);
  const description = stripHtml(product.description);
  const characteristics = characteristicPairs(html);
  const images = imageUrls(product, html, origin);
  if (!title) throw new Error('Unrecognized UG-OPT product page: product name is missing');
  const diagnostics = [
    ...measurementDiagnostics(characteristics, description),
    ...variantDiagnostics(title, description, characteristics),
  ];
  if (images.length === 0) diagnostics.push({ code: 'SOURCE_IMAGE_REQUIRED', field: 'sourceImages', message: 'Official product page contains no usable source image.' });
  const brand = productBrand(product);
  const model = decodeHtml(product.model ?? product.mpn);
  const type = publicType(title, brand, model);
  const characteristicFacts = Object.fromEntries(characteristics.map((item, index) => [canonicalFactKey(item.name, index), item.value]));
  const sourceFacts = {
    type: { ru: type, ua: type },
    ...(brand ? { brand: { ru: brand, ua: brand } } : {}),
    ...(model ? { model } : {}),
    ...characteristicFacts,
  };
  return {
    productKey,
    version: 1,
    status: diagnostics.length === 0 ? 'READY' : 'REVIEW',
    sourceUrl: absoluteUrl(sourceUrl ?? product.url, origin),
    sourceFacts,
    sourceText: { language: 'uk', title, description, characteristics },
    sourceImages: images.map((reference, index) => ({ id: `${productKey}-source-${index + 1}`, reference })),
    diagnostics,
    provenance: { supplier: 'ug-opt', authority: 'official-product-page', parser: 'ugopt-product-detail-v1' },
  };
}
