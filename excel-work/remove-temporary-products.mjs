import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputDir = process.argv[3];
const removeCodes = new Set(['8861', '9230', '9231', '96306', '10583']);

if (!inputPath || !outputDir) {
  throw new Error('Usage: node remove-temporary-products.mjs <input.xlsx> <outputDir>');
}

await fs.mkdir(outputDir, { recursive: true });

const normalizeCode = (value) => String(value ?? '').replace(/^U|U$/g, '');
const nonblank = (value) => value !== null && value !== undefined && String(value).trim() !== '';

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const productsSheet = wb.worksheets.getItem('Export Products Sheet');
const pricingSheet = wb.worksheets.getItem('Pricing QA');
const groupsSheet = wb.worksheets.getItem('Export Groups Sheet');

const productAll = productsSheet.getRange('A1:DD101').values;
const pricingAll = pricingSheet.getRange('A1:M101').values;
const productHeader = productAll[0];
const pricingHeader = pricingAll[0];
const productsKept = productAll.slice(1).filter((row) => !removeCodes.has(normalizeCode(row[0])));
const pricingKept = pricingAll.slice(1).filter((row) => !removeCodes.has(normalizeCode(row[0])));

if (productsKept.length !== 95 || pricingKept.length !== 95) {
  throw new Error('Unexpected kept row count: ' + JSON.stringify({ products: productsKept.length, pricing: pricingKept.length }));
}

for (const table of [...productsSheet.tables.items]) table.delete();
productsSheet.getRangeByIndexes(1, 0, 100, productHeader.length).clear({ applyTo: 'contents' });
productsSheet.getRangeByIndexes(1, 0, productsKept.length, productHeader.length).values = productsKept;
productsSheet.tables.add('A1:DD96', true, 'ProductsTable95');

for (const table of [...pricingSheet.tables.items]) table.delete();
pricingSheet.getRangeByIndexes(1, 0, 100, pricingHeader.length).clear({ applyTo: 'contents' });
pricingSheet.getRangeByIndexes(1, 0, pricingKept.length, pricingHeader.length).values = pricingKept;
pricingSheet.tables.add('A1:M96', true, 'PricingQATable95');

const headerIndex = new Map(productHeader.map((h, i) => [String(h), i]));
const requiredHeaders = [
  'Назва_позиції',
  'Назва_позиції_укр',
  'Опис',
  'Опис_укр',
  'Ціна',
  'Валюта',
  'Посилання_зображення',
  'Номер_групи',
  'Назва_групи'
];
const contentQa = Object.fromEntries(requiredHeaders.map((header) => {
  const index = headerIndex.get(header);
  return [header, { present: index !== undefined, filled: index === undefined ? 0 : productsKept.filter((row) => nonblank(row[index])).length }];
}));
const characteristicHeaders = productHeader
  .map((h, i) => ({ header: String(h), index: i }))
  .filter(({ header }) => /характер|параметр|властив/i.test(header));
const characteristicsQa = characteristicHeaders.map(({ header, index }) => ({
  header,
  filled: productsKept.filter((row) => nonblank(row[index])).length
}));

const checks = {
  products: productsKept.length,
  pricingRows: pricingKept.length,
  groupsRows: Math.max(0, groupsSheet.getUsedRange(true).values.length - 1),
  removedCodes: [...removeCodes],
  removedProductsAbsent: [...removeCodes].every((code) => !productsKept.some((row) => normalizeCode(row[0]) === code)),
  removedPricingAbsent: [...removeCodes].every((code) => !pricingKept.some((row) => normalizeCode(row[0]) === code)),
  retailOnly: productsKept.every((row) => !nonblank(row[12]) && !nonblank(row[13])),
  contentQa,
  characteristicsQa
};

const formulaErrors = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'trimmed workbook formula error scan'
});

const previews = [
  ['products-preview.png', { sheetName: 'Export Products Sheet', range: 'A1:T12', scale: 1, format: 'png' }],
  ['groups-preview.png', { sheetName: 'Export Groups Sheet', range: 'A1:L15', scale: 1, format: 'png' }],
  ['pricing-preview.png', { sheetName: 'Pricing QA', range: 'A1:M12', scale: 1, format: 'png' }]
];
for (const [fileName, options] of previews) {
  const preview = await wb.render(options);
  await fs.writeFile(path.join(outputDir, fileName), new Uint8Array(await preview.arrayBuffer()));
}

await fs.writeFile(path.join(outputDir, 'content-qa.json'), JSON.stringify({ checks, formulaErrors: formulaErrors.ndjson || '' }, null, 2), 'utf8');
const out = await SpreadsheetFile.exportXlsx(wb);
const outputPath = path.join(outputDir, 'Prom-UGOPT-95-final-no-temporary.xlsx');
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, checks, formulaErrors: formulaErrors.ndjson || '' }));
