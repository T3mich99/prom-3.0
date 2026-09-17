import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const sourcePath = process.argv[2] ?? './outputs/hair-styling-all-2026-09-05/hair-styling-requested-source-data.json';
const promptsPath = process.argv[3] ?? './outputs/hair-styling-all-2026-09-05/hair-photo-prompts.json';
const outputDir = process.argv[4] ?? './outputs/hair-styling-next-100-2026-09-05';
await fs.mkdir(outputDir, { recursive: true });
const sourceData = JSON.parse((await fs.readFile(sourcePath, 'utf8')).replace(/^\uFEFF/u, ''));
const promptData = JSON.parse((await fs.readFile(promptsPath, 'utf8')).replace(/^\uFEFF/u, ''));
const source = Array.isArray(sourceData) ? sourceData : sourceData.products;
const bySku = new Map(source.map((p) => [String(p.sku), p]));
const photoRoot = path.resolve(path.dirname(promptsPath), 'photos');
const roles = ['01_main', '02_benefits', '03_features', '04_use', '05_details'];
const pending = [];
for (const p of promptData.products) {
  const sku = String(p.sku);
  const count = roles.filter((role) => fsSync.existsSync(path.join(photoRoot, sku, `${role}.png`))).length;
  if (count < roles.length) pending.push({ prompt: p, count });
}
const chosen = pending.slice(0, 100).map((x) => x.prompt);
const selectedSource = chosen.map((p) => bySku.get(String(p.sku))).filter(Boolean);
if (selectedSource.length !== chosen.length) throw new Error('Some selected products are missing in source data');
const outSource = { ...sourceData, products: selectedSource, selectedCount: selectedSource.length, selectionRule: 'Next 100 products without a complete five-image AI photo set; completed products excluded.' };
await fs.writeFile(path.join(outputDir, 'hair-next-100-source-data.json'), JSON.stringify(outSource, null, 2), 'utf8');
await fs.writeFile(path.join(outputDir, 'hair-next-100-photo-prompts.json'), JSON.stringify({ ...promptData, count: chosen.length, products: chosen }, null, 2), 'utf8');
console.log(JSON.stringify({ pendingProducts: pending.length, selectedProducts: selectedSource.length, completeExcluded: promptData.products.length - pending.length, outputDir, first: chosen[0]?.sku, last: chosen.at(-1)?.sku }, null, 2));
