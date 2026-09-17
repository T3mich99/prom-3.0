import fs from 'node:fs/promises';

const inputPath = process.argv[2] ?? 'C:/Users/Dell/Documents/ChatGPT/пром/outputs/home-misc-next-100-2026-09-01/next-100-source-selection.json';
const outputPath = process.argv[3] ?? 'C:/Users/Dell/Documents/ChatGPT/пром/outputs/home-misc-next-100-2026-09-01/next-100-source-data-enriched.json';

const decode = (value) => String(value ?? '')
  .replace(/&quot;/g, '"')
  .replace(/&#34;/g, '"')
  .replace(/&amp;/g, '&')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#x2F;/g, '/')
  .replace(/\s+/g, ' ')
  .trim();

async function fetchText(url, attempts = 4) {
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
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message ?? 'unknown error'}`);
}

function extractDetails(product, html) {
  const ldRaw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/iu)?.[1] ?? '{}';
  let ld = {};
  try { ld = JSON.parse(ldRaw); } catch {}
  const attributes = [...html.matchAll(/data-qaid="attribute_item"[\s\S]*?data-qaid="attribute_name">([\s\S]*?)<\/td>[\s\S]*?data-qaid="attribute_value">([\s\S]*?)<\/td>/gu)]
    .map(([, name, value]) => ({
      name: decode(name.replace(/<[^>]+>/gu, '')),
      value: decode(value.replace(/<[^>]+>/gu, '')),
    }))
    .filter((attribute) => attribute.name && attribute.value);
  const htmlImages = [...html.matchAll(/(?:data-zoom-image|data-original|src)="(https:\/\/images\.prom\.ua\/[^" ]+)"/gu)]
    .map((match) => decode(match[1]));
  const ldImages = Array.isArray(ld.image) ? ld.image : (ld.image ? [ld.image] : []);
  const categoryId = html.match(/product_category(?:&#34;|&quot;|\\"):\s*(?:&#34;|&quot;|\\")([^&#34;"\\]+)/u)?.[1] ?? '';
  return {
    ...product,
    supplier_category_id: categoryId,
    description: decode(ld.description),
    attributes,
    images: [...new Set([...product.images, ...ldImages, ...htmlImages])].slice(0, 10),
  };
}

const payload = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const products = payload.products ?? [];
const enriched = [];
for (let start = 0; start < products.length; start += 8) {
  const chunk = await Promise.all(products.slice(start, start + 8).map(async (product) => {
    try {
      const html = await fetchText(product.source_url);
      return extractDetails(product, html);
    } catch (error) {
      return { ...product, source_error: String(error) };
    }
  }));
  enriched.push(...chunk);
  console.log(JSON.stringify({ completed: enriched.length, total: products.length }));
  await new Promise((resolve) => setTimeout(resolve, 400));
}

const invalid = enriched.filter((product) => product.source_error || !product.title || product.price <= 0 || !product.images?.length);
if (invalid.length) {
  throw new Error(`Source validation failed for ${invalid.length} product(s): ${invalid.map((product) => product.sku).join(', ')}`);
}

await fs.writeFile(outputPath, JSON.stringify({
  ...payload,
  enrichedAt: new Date().toISOString(),
  products: enriched,
  sourceValidation: {
    selected: enriched.length,
    invalid: invalid.length,
    withAttributes: enriched.filter((product) => product.attributes?.length).length,
    withDescription: enriched.filter((product) => product.description).length,
    withSupplierImages: enriched.filter((product) => product.images?.length).length,
  },
}, null, 2), 'utf8');

console.log(JSON.stringify({ outputPath, selected: enriched.length, invalid: invalid.length }));
