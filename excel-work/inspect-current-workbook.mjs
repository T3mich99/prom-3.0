import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import { getCliArgument } from '../src/config/run-config.mjs';
import { PROM_SHEETS, headerIndex } from '../src/contracts/prom-excel.mjs';

const inputPath = getCliArgument(process.argv, 2);
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem(PROM_SHEETS.PRODUCTS);
const values = products.getUsedRange().values;
const codeIx = headerIndex(values[0], 'Код_товару');
const nonblankCodes = values.slice(1).map((row) => row[codeIx]).filter((v) => String(v ?? '').trim() !== '');
const sheetNames = [];
for (const name of [PROM_SHEETS.PRODUCTS, PROM_SHEETS.GROUPS, 'Prom QA', 'Content QA', 'Photo Queue', 'Photo QA']) {
  try { wb.worksheets.getItem(name); sheetNames.push(name); } catch {}
}
console.log(JSON.stringify({ usedRows: values.length - 1, nonblankCodes: nonblankCodes.length, firstCode: nonblankCodes[0], lastCodes: nonblankCodes.slice(-10), sheetNames }, null, 2));
