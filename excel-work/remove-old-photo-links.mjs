import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const mapPath = process.argv[4];
const currentMap = JSON.parse(await fs.readFile(mapPath, 'utf8'));

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const rows = products.getRange('A2:A101').values;
const roles = ['01_main.png', '02_benefits.png', '03_features.png', '04_use.png', '05_details.png'];
const stripCode = (v) => String(v ?? '').replace(/^U|U$/g, '').trim();

const photoRows = [];
for (const [value] of rows) {
  const code = stripCode(value);
  const links = roles
    .map((role) => currentMap[`${code}_${role}`])
    .filter((entry) => entry && !entry.fallback && entry.url)
    .map((entry) => entry.url);
  products.getRange(`O${photoRows.length + 2}`).values = [[links.join(', ')]];
  photoRows.push({ code, currentAi: links.length, totalLinks: links.length, oldLinksRemoved: true });
}

const photoQa = wb.worksheets.getItem('Photo QA');
const qaRows = photoQa.getRange('A2:M101').values;
const qaByCode = new Map(photoRows.map((r) => [r.code, r]));
for (const row of qaRows) {
  const code = stripCode(row[0]);
  const p = qaByCode.get(code);
  if (!p) continue;
  row[1] = p.currentAi;
  row[2] = 0;
  row[3] = p.totalLinks;
  row[11] = p.currentAi === 5 ? 'Готово: 5 нових AI-фото' : `Потрібні нові фото: ${p.currentAi}/5`;
  row[12] = p.currentAi === 5
    ? 'У колонці зображень лише нові фото з batch-100-ai-v2.'
    : 'Старі фото видалені; нові фото для цієї картки ще не підставлені.';
}
photoQa.getRange('A2:M101').values = qaRows;

const formulaErrors = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'new-only photo link formula error scan',
});
const preview = await wb.render({ sheetName: 'Photo QA', range: 'A1:M18', scale: 1, format: 'png' });
await fs.writeFile(path.join(path.dirname(outputPath), 'qa-new-only-photos-preview.png'), new Uint8Array(await preview.arrayBuffer()));

const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
await fs.writeFile(path.join(path.dirname(outputPath), 'photo-new-only-qa.json'), JSON.stringify({
  rule: 'Only current batch-100-ai-v2 Drive links; fallback/old links removed',
  products: photoRows,
  formulaErrors: formulaErrors.ndjson || '',
}, null, 2), 'utf8');

console.log(JSON.stringify({
  outputPath,
  products: photoRows.length,
  withFiveNewAi: photoRows.filter((r) => r.currentAi === 5).length,
  withPartialNewAi: photoRows.filter((r) => r.currentAi > 0 && r.currentAi < 5).length,
  withoutNewAi: photoRows.filter((r) => r.currentAi === 0).length,
  oldLinksRemoved: photoRows.length,
  formulaErrors: formulaErrors.ndjson || '',
}));
