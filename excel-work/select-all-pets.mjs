import fs from 'node:fs/promises';
import path from 'node:path';

const categoryUrl = process.argv[2] ?? 'https://ug-opt.in.ua/ua/g115953897-tovary-dlya-zhivotnyh';
const outputDir = process.argv[3] ?? './outputs/pets-all-2026-09-05';
const outputPath = path.join(outputDir, process.argv[4] ?? 'all-pets-source-selection.json');
const additionalPriorFiles = process.argv.slice(5);

const priorFiles = [
  'C:/Users/Dell/Documents/kasta/outputs/home-misc-100/current-prom-export-index.json',
  'C:/Users/Dell/Documents/kasta/outputs/home-misc-100/source-data.json',
  'C:/Users/Dell/Documents/kasta/outputs/home-misc-100/source-data-current-export.json',
  'C:/Users/Dell/Documents/ChatGPT/пром/outputs/home-misc-next-100-2026-09-04-attached-export-index.json',
  ...additionalPriorFiles,
];
const outputRoot = path.resolve(process.cwd(), 'outputs');
async function collectLocalSelectionManifests(dir) {
  const found = [];
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...await collectLocalSelectionManifests(fullPath));
      else if (entry.isFile() && entry.name === 'next-100-source-selection.json') found.push(fullPath);
    }
  } catch {}
  return found;
}
priorFiles.push(...await collectLocalSelectionManifests(outputRoot));

const decode = (value) => String(value ?? '')
  .replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, '&')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x2F;/g, '/').replace(/\s+/g, ' ').trim();
const normalizeSku = (value) => String(value ?? '').trim().replace(/^U|U$/g, '').trim();
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
async function fetchText(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/128 Safari/537.36', 'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message ?? 'unknown error'}`);
}
function parsePage(html) {
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
    if (match[1] && sku && relativeUrl && title && image && Number.isFinite(price)) items.push({
      page_id: match[1], sku, title, price, source_url: new URL(relativeUrl, 'https://ug-opt.in.ua').toString(),
      images: [image], source_category: 'Товари для тварин',
    });
  }
  return { items, pageCount: Number(html.match(/data-pagination-pages-count="(\d+)"/u)?.[1] ?? 0) };
}

const priorSkus = new Set();
for (const filePath of priorFiles) collectPriorSkus(await readJsonIfPresent(filePath), priorSkus);
priorSkus.delete('');
const first = parsePage(await fetchText(`${categoryUrl}?product_items_per_page=48&page=1`));
const second = parsePage(await fetchText(`${categoryUrl}?product_items_per_page=48&page=2`));
const pageCount = Math.max(first.pageCount, second.pageCount, 1);
const bySku = new Map([...first.items, ...second.items].map((item) => [item.sku, item]));
for (let page = 3; page <= pageCount; page += 1) {
  for (const item of parsePage(await fetchText(`${categoryUrl}?product_items_per_page=48&page=${page}`)).items) bySku.set(item.sku, item);
  await new Promise((resolve) => setTimeout(resolve, 250));
}
const listed = [...bySku.values()];
const selected = listed.filter((item) => !priorSkus.has(normalizeSku(item.sku)));
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, JSON.stringify({
  categoryUrl, sourceCategory: 'Товари для тварин', fetchedAt: new Date().toISOString(),
  pagination: { pagesFetched: pageCount, perPageRequested: 48 }, scannedUnique: listed.length,
  priorSkuCount: priorSkus.size, selectedCount: selected.length,
  selectionRule: 'All current category products not present in prior Prom exports or local batches.',
  codes: selected.map((item) => `U${item.sku}U`), products: selected,
}, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, pagesFetched: pageCount, scannedUnique: listed.length, priorSkuCount: priorSkus.size, selected: selected.length, products: selected.map((item) => ({ sku: item.sku, title: item.title, price: item.price })) }, null, 2));
