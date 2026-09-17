import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.argv[2] ?? './outputs/pets-all-2026-09-05';
const data = JSON.parse(await fs.readFile(path.join(root, 'all-pets-source-data-enriched.json'), 'utf8'));
const roles = ['01_main', '02_benefits', '03_features', '04_use', '05_details'];
const failures = []; const rows = [];
for (const p of data.products) {
  const dir = path.join(root, 'photos', String(p.sku)); let ok = true;
  for (const role of roles) {
    const file = path.join(dir, `${role}.png`);
    try { const meta = await sharp(file).metadata(); const pass = meta.format === 'png' && meta.width === 1280 && meta.height === 1280; if (!pass) failures.push({ sku: p.sku, role, format: meta.format, width: meta.width, height: meta.height }); }
    catch (e) { ok = false; failures.push({ sku: p.sku, role, error: e.message }); }
  }
  rows.push({ sku: String(p.sku), roles: roles.length, ok });
}
const result = { products: rows.length, expectedPhotos: rows.length * roles.length, validProducts: rows.filter((x) => x.ok).length, failures };
await fs.writeFile(path.join(root, 'pets-photos-qa.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
if (failures.length) process.exitCode = 1;
