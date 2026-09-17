import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const mapPath = process.argv[4];
const localRoot = process.argv[5];
const currentMap = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const roles = ['01_main.png', '02_benefits.png', '03_features.png', '04_use.png', '05_details.png'];

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const productRows = products.getRange('A2:DD90').values;
if (productRows.length !== 89) throw new Error(`Expected 89 product rows, got ${productRows.length}`);

const stripCode = (v) => String(v ?? '').replace(/^U|U$/g, '').trim();
const required = new Map([
  ['35359', { 'Код запчастини': 35359, 'Виробник': 'Без бренду' }],
  ['35358', { 'Код запчастини': 35358, 'Виробник': 'Без бренду' }],
]);

const photoCounts = [];
const requiredQa = [];
for (let rowIndex = 0; rowIndex < productRows.length; rowIndex++) {
  const row = productRows[rowIndex];
  const code = stripCode(row[0]);
  const links = [];
  for (const role of roles) {
    const localPath = path.join(localRoot, code, role);
    try { await fs.access(localPath); } catch { throw new Error(`New local photo missing: ${localPath}`); }
    const entry = currentMap[`${code}_${role}`];
    if (!entry || entry.fallback || !entry.url) throw new Error(`Current Drive link missing for ${code}_${role}`);
    links.push(entry.url);
  }
  products.getRange(`O${rowIndex + 2}`).values = [[links.join(', ')]];
  photoCounts.push(links.length);

  const req = required.get(code);
  if (req) {
    row[28] = req['Виробник'];
    const existing = new Map();
    for (let i = 51; i < row.length; i += 3) {
      if (row[i]) existing.set(String(row[i]), i);
    }
    for (const [name, value] of Object.entries(req)) {
      let index = existing.get(name);
      if (index === undefined) {
        for (let i = 51; i < row.length; i += 3) {
          if (!row[i]) { index = i; break; }
        }
      }
      if (index === undefined) throw new Error(`No characteristic slot for ${code}: ${name}`);
      row[index] = name;
      row[index + 1] = null;
      row[index + 2] = value;
    }
    requiredQa.push({ code, partCode: req['Код запчастини'], manufacturer: req['Виробник'] });
  }
}
products.getRange('A2:DD90').values = productRows;

const photoQa = wb.worksheets.getItem('Photo QA');
const qaRows = photoQa.getRange('A2:M90').values;
const countsByCode = new Map(productRows.map((row, i) => [stripCode(row[0]), photoCounts[i]]));
for (const row of qaRows) {
  const code = stripCode(row[0]);
  const count = countsByCode.get(code);
  if (count === undefined) continue;
  row[1] = count;
  row[2] = 0;
  row[3] = count;
  row[11] = count === 5 ? 'Готово: 5 нових AI-фото' : `Потрібні нові фото: ${count}/5`;
  row[12] = 'Фото з batch-100-ai-v2; публічні прямі посилання для Prom.ua.';
}
photoQa.getRange('A2:M90').values = qaRows;

const formulaErrors = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'Prom-ready final workbook formula error scan',
});
const preview = await wb.render({ sheetName: 'Photo QA', range: 'A1:M18', scale: 1, format: 'png' });
await fs.writeFile(path.join(path.dirname(outputPath), 'prom-ready-photo-qa-preview.png'), new Uint8Array(await preview.arrayBuffer()));

const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
await fs.writeFile(path.join(path.dirname(outputPath), 'prom-ready-final-qa.json'), JSON.stringify({
  products: productRows.length,
  photos: { min: Math.min(...photoCounts), max: Math.max(...photoCounts), allFive: photoCounts.every((n) => n === 5), onlyCurrentMap: true },
  requiredCharacteristics: requiredQa,
  formulaErrors: formulaErrors.ndjson || '',
}, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, products: productRows.length, photosPerProduct: { min: Math.min(...photoCounts), max: Math.max(...photoCounts) }, requiredCharacteristics: requiredQa, formulaErrors: formulaErrors.ndjson || '' }));
