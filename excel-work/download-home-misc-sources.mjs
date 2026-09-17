import fs from 'node:fs/promises';
import path from 'node:path';

const batchRoot = process.argv[2] ?? 'C:/Users/Dell/Documents/ChatGPT/пром/outputs/home-misc-next-100-2026-09-01';
const payload = JSON.parse(await fs.readFile(path.join(batchRoot, 'next-100-source-data-enriched.json'), 'utf8'));
const sourceRoot = path.join(batchRoot, 'sources');

async function download(url, dest) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await fs.writeFile(dest, bytes);
}

let downloaded = 0;
let skipped = 0;
for (const product of payload.products ?? []) {
  const dir = path.join(sourceRoot, String(product.sku));
  const existing = (await fs.readdir(dir).catch(() => [])).filter((name) => /\.(jpe?g|png|webp)$/iu.test(name));
  if (existing.length) { skipped += 1; continue; }
  const urls = [...new Set((product.images ?? []).filter((url) => /^https:\/\/images\.prom\.ua\//iu.test(url)))];
  if (!urls.length) throw new Error(`No Prom image for ${product.sku}`);
  await fs.mkdir(dir, { recursive: true });
  const preferred = urls.find((url) => /_w500_h500_/iu.test(url)) ?? urls.find((url) => /_w200_h200_/iu.test(url)) ?? urls[0];
  await download(preferred, path.join(dir, 'source.jpg'));
  downloaded += 1;
  console.log(JSON.stringify({ sku: product.sku, downloaded: preferred }));
}
console.log(JSON.stringify({ downloaded, skipped }));
