import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const mapPath = process.argv[4];
const localRoot = process.argv[5];
const map = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const roles = ['01_main.png', '02_benefits.png', '03_features.png', '04_use.png', '05_details.png'];
const stripCode = (v) => String(v ?? '').replace(/^U|U$/g, '').trim();

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const productRows = products.getRange('A2:DD90').values;
if (productRows.length !== 89) throw new Error(`Expected 89 product rows, got ${productRows.length}`);

const linkAudit = [];
for (const row of productRows) {
  const code = stripCode(row[0]);
  const links = [];
  for (const role of roles) {
    const localPath = path.join(localRoot, code, role);
    try { await fs.access(localPath); } catch { throw new Error(`Missing local new photo: ${localPath}`); }
    const entry = map[`${code}_${role}`];
    if (!entry || entry.fallback || !entry.url) throw new Error(`Missing current photo link: ${code}_${role}`);
    links.push(entry.url);
  }
  row[14] = links.join(', ');
  linkAudit.push({ code, links: links.length, source: 'batch-100-ai-v2', fallback: false });
}
products.getRange('A2:DD90').values = productRows;

const photoQa = wb.worksheets.getItem('Photo QA');
const qaRows = photoQa.getRange('A2:M90').values;
const countByCode = new Map(linkAudit.map((item) => [item.code, item.links]));
for (const row of qaRows) {
  const count = countByCode.get(stripCode(row[0]));
  if (count === undefined) continue;
  row[1] = count;
  row[2] = 0;
  row[3] = count;
  row[11] = 'Готово: 5 нових AI-фото';
  row[12] = 'Фото з batch-100-ai-v2; публічні прямі посилання для Prom.ua.';
}
photoQa.getRange('A2:M90').values = qaRows;

const formulaErrors = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'new photo final export formula error scan',
});
const preview = await wb.render({ sheetName: 'Photo QA', range: 'A1:M18', scale: 1, format: 'png' });
await fs.writeFile(path.join(path.dirname(outputPath), 'new-photo-final-qa-preview.png'), new Uint8Array(await preview.arrayBuffer()));

const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
await fs.writeFile(path.join(path.dirname(outputPath), 'new-photo-final-qa.json'), JSON.stringify({
  products: linkAudit.length,
  allFiveNewPhotos: linkAudit.every((item) => item.links === 5 && !item.fallback),
  linkAudit,
  formulaErrors: formulaErrors.ndjson || '',
}, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, products: linkAudit.length, allFiveNewPhotos: linkAudit.every((item) => item.links === 5 && !item.fallback), formulaErrors: formulaErrors.ndjson || '' }));
