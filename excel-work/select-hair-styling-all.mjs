import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const outputDir = process.argv[2] ?? './outputs/hair-styling-all-2026-09-05';
const outputPath = path.join(outputDir, process.argv[3] ?? 'hair-styling-source-selection.json');
const categoryPages = [
  { url: 'https://ug-opt.in.ua/ua/g38298691-feny', sourceCategory: 'Фени' },
  { url: 'https://ug-opt.in.ua/ua/g107153153-plojki-utyuzhki-gofre', sourceCategory: 'Плойки, праски, гофре' },
  { url: 'https://ug-opt.in.ua/ua/g121627664-rascheskibigudi', sourceCategory: 'Расчески/бигуди' },
];

const decode = (value) => String(value ?? '')
  .replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, '&')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x2F;/g, '/').replace(/\s+/g, ' ').trim();
const normalizeSku = (value) => String(value ?? '').trim().replace(/^U/iu, '').replace(/U$/iu, '').trim();
async function fetchText(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36', 'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message ?? 'unknown error'}`);
}
function parsePage(html, sourceCategory) {
  const items = [];
  for (const match of html.matchAll(/<li[^>]*data-product-id="(\d+)"[\s\S]*?<\/li>/gu)) {
    const raw = match[0];
    const get = (pattern) => raw.match(pattern)?.[1] ?? '';
    const sku = decode(get(/cs-product-list__sku[\s\S]*?<span title="([^"]+)"/u));
    const relativeUrl = decode(get(/data-product-url="([^"]+)"/u));
    const title = decode(get(/data-product-name="([^"]+)"/u));
    const image = decode(get(/data-product-big-picture="([^"]+)"/u));
    const rawPrice = decode(get(/data-product-price="([^"]+)"/u));
    const price = Number(rawPrice.replace(/[^\d.,]/gu, '').replace(',', '.'));
    if (match[1] && sku && relativeUrl && title && image && Number.isFinite(price)) {
      items.push({ page_id: match[1], sku, title, price, source_url: new URL(relativeUrl, 'https://ug-opt.in.ua').toString(), images: [image], source_category: sourceCategory });
    }
  }
  return { items, pageCount: Number(html.match(/data-pagination-pages-count="(\d+)"/u)?.[1] ?? 0) };
}

async function readJsonIfPresent(filePath) { try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return null; } }
function collectPriorSkus(value, target) {
  if (!value) return;
  if (Array.isArray(value)) { for (const item of value) collectPriorSkus(item, target); return; }
  if (typeof value !== 'object') return;
  if (value.sku !== undefined) target.add(normalizeSku(value.sku));
  if (value.code !== undefined) target.add(normalizeSku(value.code));
  if (Array.isArray(value.codes)) for (const item of value.codes) target.add(normalizeSku(item));
  for (const [key, child] of Object.entries(value)) {
    if (key === 'images' && child && typeof child === 'object') for (const imageKey of Object.keys(child)) target.add(normalizeSku(imageKey));
    else if (key !== 'products' && key !== 'selected') collectPriorSkus(child, target);
  }
}
async function collectJsonFiles(dir, found = []) {
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (path.resolve(full) === path.resolve(outputPath)) continue;
      if (entry.isDirectory()) await collectJsonFiles(full, found);
      else if (entry.isFile() && /\.jsonl?$/iu.test(entry.name)) found.push(full);
    }
  } catch {}
  return found;
}
async function collectXlsxSkus(filePath, target) {
  try {
    const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
    const sheet = wb.worksheets.getItem('Export Products Sheet');
    const values = sheet.getUsedRange().values;
    const codeIndex = values[0].findIndex((v) => String(v ?? '') === 'Код_товару');
    if (codeIndex >= 0) for (const row of values.slice(1)) { const code = normalizeSku(row[codeIndex]); if (/^\d+$/u.test(code)) target.add(code); }
  } catch {}
}

const priorSkus = new Set();
const priorRoots = ['C:/Users/Dell/Documents/ChatGPT/пром/outputs', 'C:/Users/Dell/Documents/kasta/outputs'];
for (const filePath of (await Promise.all(priorRoots.map((root) => collectJsonFiles(root)))).flat()) {
  const raw = await fs.readFile(filePath, 'utf8');
  if (filePath.endsWith('.jsonl')) { for (const line of raw.split(/\r?\n/u).filter(Boolean)) collectPriorSkus(JSON.parse(line.replace(/^\uFEFF/u, '')), priorSkus); }
  else collectPriorSkus(JSON.parse(raw.replace(/^\uFEFF/u, '')), priorSkus);
}
for (const filePath of [
  'C:/Users/Dell/Downloads/export-products-04-09-26_10-30-25.xlsx',
  'C:/Users/Dell/Downloads/Prom-UGOPT-100-final-ready-2026-09-01.xlsx',
  'C:/Users/Dell/Downloads/Prom-UGOPT-95-final-no-temporary.xlsx',
  'C:/Users/Dell/Downloads/Prom-import-100-new.xlsx',
]) await collectXlsxSkus(filePath, priorSkus);
priorSkus.delete('');

const listedBySku = new Map();
const pageReport = [];
for (const category of categoryPages) {
  const first = parsePage(await fetchText(`${category.url}?product_items_per_page=48&page=1`), category.sourceCategory);
  const second = parsePage(await fetchText(`${category.url}?product_items_per_page=48&page=2`), category.sourceCategory);
  const pageCount = Math.max(first.pageCount, second.pageCount, 1);
  for (const item of [...first.items, ...second.items]) listedBySku.set(item.sku, item);
  for (let page = 3; page <= pageCount; page += 1) {
    for (const item of parsePage(await fetchText(`${category.url}?product_items_per_page=48&page=${page}`), category.sourceCategory).items) listedBySku.set(item.sku, item);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  pageReport.push({ url: category.url, sourceCategory: category.sourceCategory, pagesFetched: pageCount, uniqueOnCategoryPage: new Set([...first.items, ...second.items].map((x) => x.sku)).size });
}
const listed = [...listedBySku.values()];
const selected = listed.filter((item) => !priorSkus.has(normalizeSku(item.sku)));
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, JSON.stringify({
  categoryPages, fetchedAt: new Date().toISOString(), pageReport, scannedUnique: listed.length, priorSkuCount: priorSkus.size, selectedCount: selected.length,
  selectionRule: 'All current products from the four requested hair-styling types, excluding every SKU already found in previous exports or local batches.',
  note: 'Source category «Плойки, праски, гофре» covers both curling irons and hair straighteners; «Расчески/бигуди» covers combs and curlers.',
  codes: selected.map((item) => `U${item.sku}U`), products: selected,
}, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, pageReport, scannedUnique: listed.length, priorSkuCount: priorSkus.size, selected: selected.length, products: selected.map((item) => ({ sku: item.sku, title: item.title, price: item.price, sourceCategory: item.source_category })) }, null, 2));
