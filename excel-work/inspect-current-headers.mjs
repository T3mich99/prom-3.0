import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import { getCliArgument } from '../src/config/run-config.mjs';
import { PROM_SHEETS } from '../src/contracts/prom-excel.mjs';

const inputPath = getCliArgument(process.argv, 2);
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sh = wb.worksheets.getItem(PROM_SHEETS.PRODUCTS);
const headers = sh.getRange('A1:DD1').values[0];
const row = sh.getRange('A2:DD2').values[0];
const letters = (n) => { let s = ''; while (n >= 0) { s = String.fromCharCode((n % 26) + 65) + s; n = Math.floor(n / 26) - 1; } return s; };
console.log(JSON.stringify(headers.map((header, i) => ({ col: letters(i), header, value: row[i] })).filter(x => x.header != null && String(x.header).trim() !== ''), null, 2));
