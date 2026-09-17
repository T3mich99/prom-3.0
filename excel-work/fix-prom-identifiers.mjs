import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2] ?? './outputs/home-misc-next-100-2026-09-01/Prom-home-misc-next-100-final-2026-09-02.xlsx';
const outputPath = process.argv[3] ?? inputPath;
const outputDir = path.dirname(outputPath);
await fs.mkdir(outputDir, { recursive: true });
const clean = (v) => String(v ?? '').replace(/\s+/gu, ' ').trim();
const nonblank = (v) => clean(v) !== '';
const positiveInteger = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const used = products.getUsedRange();
const headers = used.values[0];
const ix = Object.fromEntries(headers.map((h, i) => [h, i]));
for (const h of ['Код_товару', 'Унікальний_ідентифікатор', 'Ідентифікатор_товару']) {
  if (ix[h] === undefined) throw new Error(`Missing product field: ${h}`);
}

const rows = used.values.slice(1).filter((row) => nonblank(row[ix['Код_товару']]));
const seenUnique = new Set();
const seenProduct = new Set();
for (const row of rows) {
  const code = clean(row[ix['Код_товару']]).replace(/^U/iu, '').replace(/U$/iu, '');
  const codeNumber = Number(code);
  if (!positiveInteger(codeNumber)) throw new Error(`Invalid numeric code: ${code}`);
  // Prom rule: the marketplace identifier is numeric; the product identifier is separate.
  row[ix['Код_товару']] = codeNumber;
  row[ix['Унікальний_ідентифікатор']] = codeNumber;
  row[ix['Ідентифікатор_товару']] = `U${code}U`;
  if (seenUnique.has(String(codeNumber))) throw new Error(`Duplicate unique identifier: ${codeNumber}`);
  if (seenProduct.has(`U${code}U`)) throw new Error(`Duplicate product identifier: U${code}U`);
  seenUnique.add(String(codeNumber));
  seenProduct.add(`U${code}U`);
}

products.getRangeByIndexes(1, 0, used.values.length - 1, headers.length).clear({ applyTo: 'contents' });
products.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;
for (const h of ['Код_товару', 'Унікальний_ідентифікатор']) products.getRangeByIndexes(1, ix[h], rows.length, 1).format.numberFormat = '0';

const qaSheet = wb.worksheets.getItem('Prom QA');
if (qaSheet) {
  const qaUsed = qaSheet.getUsedRange();
  const qaValues = qaUsed.values.map((row) => [...row]);
  const header = qaValues[0];
  header.push('Унікальний ID числовий', 'ID товару окремий');
  for (let i = 1; i < qaValues.length; i++) {
    const row = qaValues[i];
    const product = rows[i - 1];
    row.push(positiveInteger(product[ix['Унікальний_ідентифікатор']]), product[ix['Ідентифікатор_товару']] !== String(product[ix['Унікальний_ідентифікатор']]));
  }
  qaSheet.getRangeByIndexes(0, 0, qaValues.length, header.length).values = qaValues;
  qaSheet.getRange('O1:P1').format = { fill: '#17365D', font: { bold: true, color: '#FFFFFF' }, horizontal_alignment: 'center', vertical_alignment: 'center', wrap_text: true };
  qaSheet.getRange(`O2:P${qaValues.length}`).format = { horizontal_alignment: 'center' };
  qaSheet.getRange('O:P').format.column_width = 18;
}

const uniqueIds = rows.map((r) => Number(r[ix['Унікальний_ідентифікатор']]));
const productIds = rows.map((r) => clean(r[ix['Ідентифікатор_товару']]));
const checks = {
  products: rows.length,
  numericPositiveUniqueIds: rows.every((r) => positiveInteger(r[ix['Унікальний_ідентифікатор']])) && new Set(uniqueIds).size === rows.length,
  separateUniqueProductIds: rows.every((r) => clean(r[ix['Ідентифікатор_товару']]) !== String(r[ix['Унікальний_ідентифікатор']])) && new Set(productIds).size === rows.length,
  productCodesNumeric: rows.every((r) => positiveInteger(r[ix['Код_товару']])),
};
if (!checks.numericPositiveUniqueIds || !checks.separateUniqueProductIds || !checks.productCodesNumeric) throw new Error(`Identifier QA failed: ${JSON.stringify(checks)}`);

const formulaErrors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'identifier fix formula error scan' });
const previews = [
  ['prom-products-identifiers-preview.png', { sheetName: 'Export Products Sheet', range: 'A1:AA8', scale: 1, format: 'png' }],
  ['prom-qa-identifiers-preview.png', { sheetName: 'Prom QA', range: 'A1:P15', scale: 1, format: 'png' }],
];
for (const [name, options] of previews) {
  const image = await wb.render(options);
  await fs.writeFile(path.join(outputDir, name), new Uint8Array(await image.arrayBuffer()));
}
await fs.writeFile(path.join(outputDir, 'identifier-fix-qa-2026-09-02.json'), JSON.stringify({ checks, formulaErrors: formulaErrors.ndjson || '' }, null, 2), 'utf8');
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, checks, formulaErrors: formulaErrors.ndjson || '' }, null, 2));
