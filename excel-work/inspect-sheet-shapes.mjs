import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import { PROM_SHEETS } from '../src/contracts/prom-excel.mjs';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
for (const name of [PROM_SHEETS.PRODUCTS, PROM_SHEETS.GROUPS]) {
  const sheet = wb.worksheets.getItem(name);
  const used = sheet.getUsedRange();
  const v = used.values;
  const nonblankRows = v.slice(1).filter((r) => r.some((x) => String(x ?? '').trim() !== '')).length;
  console.log(JSON.stringify({ name, rows: v.length, cols: v[0]?.length, nonblankRows, first: v.slice(0, 3) }, null, 2));
}
