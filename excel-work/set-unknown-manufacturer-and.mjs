import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const outDir = path.dirname(outputPath);
await fs.mkdir(outDir, { recursive: true });

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = wb.worksheets.getItem('Export Products Sheet');
const used = sheet.getUsedRange();
const values = used.values;
const headers = values[0].map((v) => String(v ?? ''));
const ix = Object.fromEntries(headers.map((h, i) => [h, i]));
const codeIx = ix['Код_товару'];
const manufacturerIx = ix['Виробник'];
if (codeIx === undefined || manufacturerIx === undefined) throw new Error('Required columns not found');

let productCount = 0;
let changedCount = 0;
for (let r = 1; r < values.length; r += 1) {
  const code = String(values[r][codeIx] ?? '').trim();
  if (!code) continue;
  productCount += 1;
  if (!String(values[r][manufacturerIx] ?? '').trim()) {
    sheet.getRangeByIndexes(r, manufacturerIx, 1, 1).values = [['AND']];
    changedCount += 1;
  }
}

const formulaErrors = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'manufacturer AND formula scan',
});
const qa = { products: productCount, manufacturerSetToAND: changedCount, formulaErrors: formulaErrors.ndjson || '' };
if (!/matched 0 entries/iu.test(qa.formulaErrors)) throw new Error(JSON.stringify(qa));
await fs.writeFile(path.join(outDir, 'manufacturer-and-qa.json'), JSON.stringify(qa, null, 2), 'utf8');
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, qa }, null, 2));
