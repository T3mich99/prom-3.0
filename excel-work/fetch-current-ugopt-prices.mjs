import fs from 'node:fs/promises';

const inputPath = 'C:/Users/Dell/Documents/ChatGPT/пром/outputs/home-misc-next-100-2026-09-01/next-100-source-data-enriched.json';
const outputPath = 'C:/Users/Dell/Documents/ChatGPT/пром/outputs/home-misc-next-100-2026-09-01/current-ugopt-prices-2026-09-02.json';

const decode = (value) => String(value ?? '')
  .replace(/&quot;/g, '"')
  .replace(/&#34;/g, '"')
  .replace(/&amp;/g, '&')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/gu, ' ')
  .trim();

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36',
          'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  throw new Error(lastError?.message ?? 'unknown error');
}

function parsePrice(html) {
  const raw = decode(html.match(/data-product-price="([^"]+)"/u)?.[1] ?? '');
  const match = raw.replace(/\u00a0/gu, ' ').match(/[\d\s.,]+/u);
  if (!match) return null;
  const normalized = match[0].replace(/\s/gu, '').replace(',', '.');
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? price : null;
}

const payload = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const products = payload.products ?? [];
const rows = [];
for (let start = 0; start < products.length; start += 8) {
  const chunk = await Promise.all(products.slice(start, start + 8).map(async (product) => {
    try {
      const html = await fetchText(product.source_url);
      const currentPrice = parsePrice(html);
      if (!currentPrice) throw new Error('price not found');
      return { sku: String(product.sku), source_url: product.source_url, cached_price: Number(product.price), current_price: currentPrice, status: 'ok' };
    } catch (error) {
      return { sku: String(product.sku), source_url: product.source_url, cached_price: Number(product.price), current_price: Number(product.price), status: 'fallback_cached', error: String(error) };
    }
  }));
  rows.push(...chunk);
  console.log(JSON.stringify({ completed: rows.length, total: products.length, failed: rows.filter((row) => row.status !== 'ok').length }));
  await new Promise((resolve) => setTimeout(resolve, 250));
}

await fs.writeFile(outputPath, JSON.stringify({
  fetchedAt: new Date().toISOString(),
  source: 'ug-opt.in.ua product pages',
  formula: 'Prom price = purchase price × 1.90 / 0.80',
  products: rows,
}, null, 2), 'utf8');

console.log(JSON.stringify({ outputPath, total: rows.length, current: rows.filter((row) => row.status === 'ok').length, fallback: rows.filter((row) => row.status !== 'ok').length }, null, 2));
