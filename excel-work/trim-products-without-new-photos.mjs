import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const removeCodes = new Set(['0149', '34621', '34012', '34020', '10962', '14230', '14239', '34663', '34668', '34675', '54692']);
const normalizeCode = (v) => String(v ?? '').replace(/^U|U$/g, '').trim();
const nonblank = (v) => v !== null && v !== undefined && String(v).trim() !== '';

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const pricing = wb.worksheets.getItem('Pricing QA');
const photoQa = wb.worksheets.getItem('Photo QA');

const productAll = products.getRange('A1:DD101').values;
const pricingAll = pricing.getRange('A1:M101').values;
const photoAll = photoQa.getRange('A1:M101').values;
const productHeader = productAll[0];
const pricingHeader = pricingAll[0];
const photoHeader = photoAll[0];
const productsKept = productAll.slice(1).filter((row) => !removeCodes.has(normalizeCode(row[0])));
const pricingKept = pricingAll.slice(1).filter((row) => !removeCodes.has(normalizeCode(row[0])));
const photoKept = photoAll.slice(1).filter((row) => !removeCodes.has(normalizeCode(row[0])));

if (productsKept.length !== 89 || pricingKept.length !== 89 || photoKept.length !== 89) {
  throw new Error(JSON.stringify({ products: productsKept.length, pricing: pricingKept.length, photoQa: photoKept.length }));
}

for (const table of [...products.tables.items]) table.delete();
products.getRangeByIndexes(1, 0, 100, productHeader.length).clear({ applyTo: 'contents' });
products.getRangeByIndexes(1, 0, productsKept.length, productHeader.length).values = productsKept;
products.tables.add('A1:DD90', true, 'ProductsTable89');

for (const table of [...pricing.tables.items]) table.delete();
pricing.getRangeByIndexes(1, 0, 100, pricingHeader.length).clear({ applyTo: 'contents' });
pricing.getRangeByIndexes(1, 0, pricingKept.length, pricingHeader.length).values = pricingKept;
pricing.tables.add('A1:M90', true, 'PricingQATable89');

for (const table of [...photoQa.tables.items]) table.delete();
photoQa.getRangeByIndexes(1, 0, 100, photoHeader.length).clear({ applyTo: 'contents' });
photoQa.getRangeByIndexes(1, 0, photoKept.length, photoHeader.length).values = photoKept;
photoQa.tables.add('A1:M90', true, 'PhotoQATable89');

const keptCodes = productsKept.map((row) => normalizeCode(row[0]));
const photoCounts = productsKept.map((row) => String(row[14] ?? '').split(',').map((x) => x.trim()).filter(Boolean).length);
const formulaErrors = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'trimmed Prom export formula error scan',
});

const previews = [
  ['products-trimmed-preview.png', { sheetName: 'Export Products Sheet', range: 'A1:T12', scale: 1, format: 'png' }],
  ['photo-qa-trimmed-preview.png', { sheetName: 'Photo QA', range: 'A1:M18', scale: 1, format: 'png' }],
  ['pricing-trimmed-preview.png', { sheetName: 'Pricing QA', range: 'A1:M12', scale: 1, format: 'png' }],
];
for (const [fileName, options] of previews) {
  const preview = await wb.render(options);
  await fs.writeFile(path.join(path.dirname(outputPath), fileName), new Uint8Array(await preview.arrayBuffer()));
}

const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
await fs.writeFile(path.join(path.dirname(outputPath), 'trimmed-final-qa.json'), JSON.stringify({
  products: keptCodes.length,
  removedCodes: [...removeCodes],
  removedCount: removeCodes.size,
  allRemovedAbsent: [...removeCodes].every((code) => !keptCodes.includes(code)),
  photoLinks: { min: Math.min(...photoCounts), max: Math.max(...photoCounts), allNonblank: photoCounts.every((n) => n > 0), withFive: photoCounts.filter((n) => n === 5).length, withFour: photoCounts.filter((n) => n === 4).length },
  retailOnly: productsKept.every((row) => !nonblank(row[12]) && !nonblank(row[13])),
  formulaErrors: formulaErrors.ndjson || '',
}, null, 2), 'utf8');

console.log(JSON.stringify({
  outputPath,
  products: keptCodes.length,
  removedCount: removeCodes.size,
  removedCodes: [...removeCodes],
  photoLinksMin: Math.min(...photoCounts),
  photoLinksMax: Math.max(...photoCounts),
  withFivePhotos: photoCounts.filter((n) => n === 5).length,
  withFourPhotos: photoCounts.filter((n) => n === 4).length,
  formulaErrors: formulaErrors.ndjson || '',
}));
