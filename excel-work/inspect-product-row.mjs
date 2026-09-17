import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import { PROM_SHEETS, headerIndex } from '../src/contracts/prom-excel.mjs';
import { stripOuterU } from '../src/contracts/product-identifiers.mjs';

const inputPath = process.argv[2];
const wanted = stripOuterU(process.argv[3]);
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = wb.worksheets.getItem(PROM_SHEETS.PRODUCTS);
const values = sheet.getUsedRange().values;
const headers = values[0].map((v) => String(v ?? ''));
const codeIx = headerIndex(headers, 'Код_товару');
const rows = values.slice(1).filter((r) => stripOuterU(r[codeIx]) === wanted);
console.log(JSON.stringify({
  file: inputPath,
  matches: rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]]))),
}, null, 2));
