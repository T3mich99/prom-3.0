import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Products Sheet');
const v = sh.getUsedRange().values;
const h = v[0]; const ix = Object.fromEntries(h.map((x, i) => [x, i]));
const groups = new Set(['149376352','149376358','149376359','156201185']);
const rows = v.slice(1).filter(r => groups.has(String(r[ix['Номер_групи']] ?? ''))).slice(0, 6);
console.log(JSON.stringify({ headers: h.slice(0, 35), rows: rows.map(r => r.slice(0, 35)) }, null, 2));
