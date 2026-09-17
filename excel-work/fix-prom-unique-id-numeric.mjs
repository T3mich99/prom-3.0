import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sh = wb.worksheets.getItem('Export Products Sheet');
const rows = sh.getRange('A2:A101').values;
const numericIds = rows.map(([value]) => {
  const digits = String(value ?? '').replace(/^U|U$/g, '').trim();
  if (!/^\d+$/.test(digits)) throw new Error(`Non-numeric source code: ${value}`);
  return [Number(digits)];
});
sh.getRange('Y2:Y101').values = numericIds;

const checkRows = sh.getRange('A2:Y101').values;
const invalid = checkRows.filter((row) => !Number.isFinite(row[24]) || !/^\d+$/.test(String(row[24])));
if (invalid.length) throw new Error(`Unique identifier QA failed for ${invalid.length} rows`);

const formulaErrors = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'unique identifier numeric formula error scan',
});

const preview = await wb.render({ sheetName: 'Export Products Sheet', range: 'A1:Z12', scale: 1, format: 'png' });
await fs.writeFile(path.join(path.dirname(outputPath), 'products-id-preview.png'), new Uint8Array(await preview.arrayBuffer()));
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
await fs.writeFile(path.join(path.dirname(outputPath), 'unique-id-qa.json'), JSON.stringify({ rows: numericIds.length, numericIds: numericIds.length, formulaErrors: formulaErrors.ndjson || '' }, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, rows: numericIds.length, numericUniqueIdentifiers: numericIds.length, formulaErrors: formulaErrors.ndjson || '' }));
