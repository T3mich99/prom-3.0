import fs from 'node:fs/promises';
import path from 'node:path';

const batchRoot = process.argv[2] ?? 'C:/Users/Dell/Documents/ChatGPT/пром/outputs/home-misc-next-100-2026-09-01';
const payloadFile = process.argv[3] ?? 'next-100-source-data-enriched.json';
const payload = JSON.parse(await fs.readFile(path.join(batchRoot, payloadFile), 'utf8'));
const sourceRoot = path.join(batchRoot, 'sources');

async function download(url, dest) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  await fs.writeFile(dest, new Uint8Array(await response.arrayBuffer()));
}

let added = 0;
for (const product of payload.products ?? []) {
  const dir = path.join(sourceRoot, String(product.sku));
  await fs.mkdir(dir, { recursive: true });
  const urls = [...new Set((product.images ?? [])
    .filter((url) => /^https:\/\/images\.prom\.ua\//iu.test(url))
    .filter((url) => !/1910148269|optovij-magazin-yug-opt/iu.test(url)))];
  const preferred = urls
    .filter((url) => /_w500_h500_/iu.test(url))
    .concat(urls.filter((url) => !/_w500_h500_/iu.test(url)));
  let index = 0;
  for (const url of preferred.slice(0, 6)) {
    const existing = index === 0 ? 'source.jpg' : `source-${index + 1}.jpg`;
    const dest = path.join(dir, existing);
    try {
      await fs.access(dest);
      index += 1;
      continue;
    } catch {}
    await download(url, dest);
    added += 1;
    index += 1;
  }
}
console.log(JSON.stringify({ added }));
