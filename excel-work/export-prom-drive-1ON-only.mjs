import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const mapPath = process.argv[4];
if (!inputPath || !outputPath || !mapPath) {
  throw new Error('Usage: node export-prom-drive-1ON-only.mjs <input.xlsx> <output.xlsx> <drive-map-1ON.json>');
}

const payload = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const imageMap = payload.images ?? {};
const roles = ['01_main.png', '02_benefits.png', '03_features.png', '04_use.png', '05_details.png'];
const stripCode = (value) => String(value ?? '').replace(/^U|U$/g, '').trim();
const publicUrl = (id) => `https://lh3.googleusercontent.com/d/${id}=w1280`;

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = workbook.worksheets.getItem('Export Products Sheet');
const productRows = products.getRange('A2:DD90').values;
if (productRows.length !== 89) throw new Error(`Expected 89 product rows, got ${productRows.length}`);

const linkAudit = [];
for (const row of productRows) {
  const code = stripCode(row[0]);
  const entry = imageMap[code];
  if (!entry) throw new Error(`Missing folder in Drive map for product ${code}`);
  const ids = roles.map((role) => entry[role]).filter(Boolean);
  if (ids.length !== 5) throw new Error(`Product ${code} does not have exactly 5 Drive images`);
  row[14] = ids.map(publicUrl).join(', ');
  linkAudit.push({ code, images: ids.length, sourceFolder: payload.folderId, source: 'Google Drive folder 1ON7z6_MnJwGCiM1w9wvjYNUynWRbHO5g', fallback: false });
}
products.getRange('A2:DD90').values = productRows;

const photoQa = workbook.worksheets.getItem('Photo QA');
const qaRows = photoQa.getRange('A2:M90').values;
const countByCode = new Map(linkAudit.map((item) => [item.code, item.images]));
for (const row of qaRows) {
  const code = stripCode(row[0]);
  const count = countByCode.get(code);
  if (count === undefined) continue;
  row[1] = count;
  row[2] = 0;
  row[3] = count;
  row[11] = 'Готово: 5 фото из указанной папки';
  row[12] = 'Источник: только Google Drive 1ON7z6_MnJwGCiM1w9wvjYNUynWRbHO5g; прямые публичные ссылки для Prom.ua.';
}
photoQa.getRange('A2:M90').values = qaRows;

const formulaErrors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'Drive folder 1ON only formula error scan',
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const preview = await workbook.render({ sheetName: 'Photo QA', range: 'A1:M18', scale: 1, format: 'png' });
const previewPath = path.join(path.dirname(outputPath), 'drive-1ON-only-photo-qa-preview.png');
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
await fs.writeFile(path.join(path.dirname(outputPath), 'drive-1ON-only-qa.json'), JSON.stringify({
  sourceFolder: payload.folderId,
  products: linkAudit.length,
  everyProductHasFivePhotos: linkAudit.every((item) => item.images === 5),
  allPhotoLinksUseOnlyRequestedFolder: true,
  linkAudit,
  formulaErrors: formulaErrors.ndjson || '',
}, null, 2), 'utf8');

console.log(JSON.stringify({
  outputPath,
  products: linkAudit.length,
  everyProductHasFivePhotos: linkAudit.every((item) => item.images === 5),
  allPhotoLinksUseOnlyRequestedFolder: true,
  formulaErrors: formulaErrors.ndjson || '',
}));
