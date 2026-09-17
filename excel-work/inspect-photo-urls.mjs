import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import { getCliArgument } from '../src/config/run-config.mjs';
import { PROM_SHEETS, headerIndex } from '../src/contracts/prom-excel.mjs';

const inputPath = getCliArgument(process.argv, 2);
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = wb.worksheets.getItem(PROM_SHEETS.PRODUCTS);
const used = sheet.getUsedRange().values;
const header = used[0].map((v) => String(v ?? ''));
const ix = (name) => headerIndex(header, name);
const photoIx = ix('Посилання_зображення');
const codeIx = ix('Код_товару');
const rows = used.slice(1).filter((r) => String(r[codeIx] ?? '').trim() !== '');
const photoCells = rows.slice(0, 5).map((r) => String(r[photoIx] ?? ''));
console.log(JSON.stringify({
  file: inputPath,
  sheetCount: wb.worksheets.items.length,
  products: rows.length,
  photoColumn: photoIx,
  examples: photoCells,
}, null, 2));
