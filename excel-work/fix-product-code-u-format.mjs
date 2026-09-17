import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2] ?? './outputs/home-misc-next-100-2026-09-01/Prom-home-misc-next-100-final-2026-09-02-v2.xlsx';
const sourcePath = process.argv[3] ?? './outputs/home-misc-next-100-2026-09-01/next-100-source-data-enriched.json';
const outputPath = process.argv[4] ?? './outputs/home-misc-next-100-2026-09-01/Prom-home-misc-next-100-final-2026-09-02-v3.xlsx';
const outputDir = path.dirname(outputPath);
await fs.mkdir(outputDir, { recursive: true });

const clean = (v) => String(v ?? '').trim();
const bare = (v) => clean(v).replace(/^U/iu, '').replace(/U$/iu, '');
const numeric = (v) => {
  const n = Number(bare(v));
  return Number.isFinite(n) ? n : null;
};

const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const sourceSku = new Map();
for (const product of source.products ?? []) {
  const sku = clean(product.sku);
  sourceSku.set(sku, sku);
  if (numeric(sku) !== null) sourceSku.set(String(numeric(sku)), sku);
}

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const used = products.getUsedRange();
const values = used.values;
const headers = values[0];
const ix = Object.fromEntries(headers.map((h, i) => [h, i]));
const rows = values.slice(1).filter((row) => clean(row[ix['Код_товару']]) !== '');
const qa = [];
for (const row of rows) {
  const previous = bare(row[ix['Код_товару']]) || bare(row[ix['Ідентифікатор_товару']]);
  const supplierCode = sourceSku.get(previous) ?? previous;
  const wrapped = `U${supplierCode}U`;
  row[ix['Код_товару']] = wrapped;
  if (ix['Ідентифікатор_товару'] !== undefined) row[ix['Ідентифікатор_товару']] = wrapped;
  qa.push({ supplierCode, code: wrapped, uniqueId: row[ix['Унікальний_ідентифікатор']] });
}

products.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;
products.getRangeByIndexes(1, ix['Код_товару'], rows.length, 1).format.numberFormat = '@';
if (ix['Ідентифікатор_товару'] !== undefined) products.getRangeByIndexes(1, ix['Ідентифікатор_товару'], rows.length, 1).format.numberFormat = '@';
products.freezePanes.freezeRows(1);
products.showGridLines = false;

const checks = {
  products: rows.length,
  codeFormat: qa.filter((r) => /^U.+U$/u.test(r.code)).length,
  productIdFormat: qa.filter((r) => /^U.+U$/u.test(r.code)).length,
  uniqueIdsNumeric: qa.filter((r) => Number.isFinite(Number(r.uniqueId))).length,
  sheets: ['Export Products Sheet', 'Export Groups Sheet'],
};
if (checks.codeFormat !== rows.length || checks.productIdFormat !== rows.length || checks.uniqueIdsNumeric !== rows.length) throw new Error(`Code format QA failed: ${JSON.stringify(checks)}`);

const formulaErrors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'code format formula scan' });
checks.noFormulaErrors = /matched 0 entries/iu.test(formulaErrors.ndjson ?? '');
if (!checks.noFormulaErrors) throw new Error(`Formula errors found: ${formulaErrors.ndjson}`);
const preview = await wb.render({ sheetName: 'Export Products Sheet', range: 'A1:Z8', scale: 1, format: 'png' });
await fs.writeFile(path.join(outputDir, 'prom-code-u-format-preview.png'), new Uint8Array(await preview.arrayBuffer()));
await fs.writeFile(path.join(outputDir, 'prom-code-u-format-qa-2026-09-02.json'), JSON.stringify({ checks, rows: qa }, null, 2), 'utf8');
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, checks, sample: qa.slice(0, 5) }, null, 2));
