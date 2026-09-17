import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://ug-opt.in.ua/ua/g41338853-vse-dlya-ukladki';
const OUT = path.resolve('outputs/ugopt-hair-100-premium-v1/source');
const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'accept-language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.6',
};

const historicFiles = [
  'outputs/hair-styling-next-100-2026-09-05/hair-next-100-source-data.json',
  'outputs/hair-styling-all-2026-09-05/hair-styling-source-selection.json',
  'outputs/hair-styling-all-2026-09-05/hair-styling-requested-source-data.json',
  'outputs/bigdrop-hair-50-new-2026-09-09/bigdrop-hair-50-manifest.json',
];

function decodeHtml(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#34;|&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(href) {
  if (!href) return null;
  const url = href.startsWith('http') ? href : `https://ug-opt.in.ua${href}`;
  return url.replace(/[?#].*$/, '').replace(/\/$/, '');
}

function keyCode(value) {
  return decodeHtml(value).toUpperCase().replace(/^U|U$/g, '').replace(/\s+/g, '');
}

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 700));
    }
  }
}

function allMatches(html, regex) {
  return [...html.matchAll(regex)].map(match => match[1] || match[0]);
}

function textMatch(html, regex) {
  const match = html.match(regex);
  return match ? decodeHtml(match[1]) : '';
}

function sourceImageUrl(url) {
  return url
    .replace(/_w\d+_h\d+(?=_[^.]+\.[a-z]{2,5}$)/i, '_w1280_h1280')
    .replace(/_w\d+_h\d+(?=\.[a-z]{2,5}$)/i, '_w1280_h1280');
}

function parseImages(html) {
  const productImages = [];
  for (const tag of allMatches(html, /<img\b[^>]*>/gi)) {
    if (!/cs-product-image__img|cs-images__img/i.test(tag)) continue;
    const src = tag.match(/\ssrc="([^"]+)"/i)?.[1];
    if (!src || !/images\.prom\.ua/i.test(src) || /optovij-magazin/i.test(src)) continue;
    const normalized = sourceImageUrl(src);
    if (!productImages.includes(normalized)) productImages.push(normalized);
  }
  const og = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1];
  if (og && /images\.prom\.ua/i.test(og)) {
    const normalized = sourceImageUrl(og);
    productImages.unshift(normalized);
  }
  return [...new Set(productImages)].slice(0, 5);
}

function parseAttributes(html) {
  const attributes = [];
  const rows = [...html.matchAll(/<tr[^>]*data-qaid="attribute_item"[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const row of rows) {
    const name = textMatch(row[1], /data-qaid="attribute_name"[^>]*>([\s\S]*?)<\/td>/i);
    const value = textMatch(row[1], /data-qaid="attribute_value"[^>]*>([\s\S]*?)<\/td>/i);
    if (name && value) attributes.push({ name, value });
  }
  return attributes;
}

function attr(attrs, name) {
  return attrs.find(item => item.name.toLocaleLowerCase('uk-UA') === name.toLocaleLowerCase('uk-UA'))?.value || '';
}

function categoryFor(title, attrs) {
  const value = `${title} ${attr(attrs, 'Тип')}`.toLowerCase();
  if (/фен|hair dryer/.test(value)) return 'Фени та фен-щітки для волосся';
  if (/плойк|щипц.*завив|локон/.test(value)) return 'Плойки та щипці для завивки волосся';
  if (/гофре/.test(value)) return 'Щипці-гофре для волосся';
  if (/випрям|праск|утюж/.test(value)) return 'Випрямлячі для волосся';
  if (/бігуд/.test(value)) return 'Бігуді для волосся';
  if (/гребінець|расческ|щітк/.test(value)) return 'Щітки та гребінці для волосся';
  if (/стайлер/.test(value)) return 'Стайлери та мультистайлери для волосся';
  return 'Прилади для укладання волосся';
}

function stylingItem(title, attrs) {
  const value = `${title} ${attr(attrs, 'Тип')}`.toLowerCase();
  if (/бритв|тример|машинка.*стриж|епілятор|для носа|для бород/.test(value)) return false;
  return /фен|стайлер|плойк|випрям|праск|утюж|гофре|бігуд|гребінець|расческ|щітк|щипц/.test(value);
}

function parseProduct(url, html) {
  const title = textMatch(html, /data-qaid="product_name"[^>]*>([\s\S]*?)<\/span>/i);
  const code = textMatch(html, /data-qaid="product_code"[^>]*>([\s\S]*?)<\/span>/i);
  const priceText = textMatch(html, /data-qaid="product_price"[^>]*>([\s\S]*?)<\/span>/i);
  const price = Number((priceText.match(/[\d\s]+/)?.[0] || '0').replace(/\s+/g, ''));
  const availability = textMatch(html, /data-qaid="presence_data"[^>]*>([\s\S]*?)<\/li>/i) || 'Готово до відправки';
  const description = textMatch(html, /data-qaid="product_description"[^>]*>([\s\S]*?)<\/div>/i);
  const attrs = parseAttributes(html);
  const images = parseImages(html);
  const supplierCategoryId = html.match(/"categoryId":(\d+)/)?.[1] || '';
  return {
    sourceUrl: url,
    pageId: url.match(/\/p(\d+)-/i)?.[1] || '',
    sku: code,
    title,
    price,
    availability,
    description,
    attributes: attrs,
    images,
    manufacturer: attr(attrs, 'Виробник') || 'AND',
    country: attr(attrs, 'Країна виробник') || 'Китай',
    supplierCategoryId,
    promGroup: categoryFor(title, attrs),
  };
}

async function historicCodes() {
  const codes = new Set();
  for (const file of historicFiles) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      const root = Array.isArray(parsed) ? parsed : parsed.products || [];
      const codeList = Array.isArray(parsed?.codes) ? parsed.codes : [];
      for (const code of codeList) codes.add(keyCode(code));
      for (const item of root) {
        for (const field of ['sku', 'code', 'supplierCode', 'Код_товару']) {
          if (item?.[field]) codes.add(keyCode(item[field]));
        }
      }
    } catch { /* Historical exclusions are best effort. */ }
  }
  codes.delete('');
  return codes;
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const current = cursor++;
      if (current >= items.length) return;
      try { output[current] = await mapper(items[current], current); }
      catch (error) { output[current] = { error: String(error), sourceUrl: items[current] }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

await fs.mkdir(OUT, { recursive: true });
const usedCodes = await historicCodes();
const categoryUrls = [BASE, ...Array.from({ length: 34 }, (_, index) => `${BASE}/page_${index + 2}`)];
const pageHtml = await mapLimit(categoryUrls, 5, async url => ({ url, html: await get(url) }));
const candidates = [...new Set(pageHtml.flatMap(({ html }) => allMatches(html, /href="([^"]*\/p\d+-[^"?#]+\.html)"/gi).map(normalizeUrl).filter(Boolean)))];

const productPages = await mapLimit(candidates, 6, async url => ({ url, html: await get(url) }));
const parsed = productPages
  .filter(item => !item.error)
  .map(item => parseProduct(item.url, item.html))
  .filter(item => item.title && item.sku && item.price > 0 && item.images.length && stylingItem(item.title, item.attributes));

const unique = [];
const seen = new Set();
for (const item of parsed) {
  const code = keyCode(item.sku);
  if (!code || seen.has(code) || usedCodes.has(code)) continue;
  seen.add(code);
  unique.push(item);
}
const selected = unique.slice(0, 100);
const fallback = unique.length < 100 ? parsed.filter(item => !seen.has(keyCode(item.sku))).slice(0, 100 - unique.length) : [];
const finalProducts = [...selected, ...fallback].slice(0, 100).map((item, index) => ({ ...item, index: index + 1 }));

const report = {
  generatedAt: new Date().toISOString(),
  sourceCategory: BASE,
  categoryPagesFetched: pageHtml.filter(p => !p.error).length,
  productUrlsFound: candidates.length,
  productsParsed: parsed.length,
  historicCodesExcluded: usedCodes.size,
  newEligibleProducts: unique.length,
  fallbackUsed: fallback.length,
  selectedCount: finalProducts.length,
  selected: finalProducts.map(item => ({ index: item.index, sku: item.sku, title: item.title, price: item.price, sourceUrl: item.sourceUrl, images: item.images.length, group: item.promGroup })),
};

await fs.writeFile(path.join(OUT, 'selection.json'), JSON.stringify(finalProducts, null, 2));
await fs.writeFile(path.join(OUT, 'selection-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
