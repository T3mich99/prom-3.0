import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('outputs/ugopt-hair-100-premium-v1');
const products = JSON.parse(await fs.readFile(path.join(ROOT, 'source/selection.json'), 'utf8'));
const refsRoot = path.join(ROOT, 'refs');
await fs.mkdir(refsRoot, { recursive: true });

const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
};

function safeSku(sku) {
  return String(sku).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'sku';
}

async function image(url, destination) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) throw new Error(`not-image: ${contentType}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 3000) throw new Error(`image too small: ${bytes.length}`);
  await fs.writeFile(destination, bytes);
  return { contentType, bytes: bytes.length };
}

async function mapLimit(items, limit, mapper) {
  const result = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { result[index] = await mapper(items[index], index); }
      catch (error) { result[index] = { ok: false, error: String(error) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

const jobs = [];
for (const product of products) {
  const folderName = `${String(product.index).padStart(3, '0')}_${safeSku(product.sku)}`;
  const folder = path.join(refsRoot, folderName);
  await fs.mkdir(folder, { recursive: true });
  product.referenceFiles = [];
  for (const [position, url] of product.images.slice(0, 4).entries()) {
    const filename = `source-${position + 1}.jpg`;
    product.referenceFiles.push(path.join(folder, filename));
    jobs.push({ product, url, destination: path.join(folder, filename), filename });
  }
}

const results = await mapLimit(jobs, 6, async job => ({ ok: true, ...await image(job.url, job.destination) }));
for (const [index, job] of jobs.entries()) {
  const result = results[index];
  if (!result.ok) job.product.referenceFiles = job.product.referenceFiles.filter(file => file !== job.destination);
}
const report = {
  generatedAt: new Date().toISOString(),
  totalProducts: products.length,
  requestedImages: jobs.length,
  downloadedImages: results.filter(result => result.ok).length,
  failedImages: results.filter(result => !result.ok).length,
  productsWithReference: products.filter(product => product.referenceFiles.length > 0).length,
  failures: jobs.map((job, index) => ({ url: job.url, destination: job.destination, ...results[index] })).filter(item => !item.ok),
};
await fs.writeFile(path.join(ROOT, 'source/selection-with-refs.json'), JSON.stringify(products, null, 2));
await fs.writeFile(path.join(ROOT, 'source/reference-download-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
