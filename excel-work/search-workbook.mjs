import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const pattern = new RegExp(process.argv[3] ?? '.', 'iu');
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = wb.worksheets.getItem('Export Products Sheet');
const values = sheet.getUsedRange().values;
const headers = values[0].map((v) => String(v ?? ''));
const ix = Object.fromEntries(headers.map((h, i) => [h, i]));
const rows = values.slice(1).filter((r) => pattern.test(String(r[ix['Назва_позиції']] ?? '') + ' ' + String(r[ix['Назва_позиції_укр']] ?? '') + ' ' + String(r[ix['Назва_групи']] ?? '')));
console.log(JSON.stringify(rows.map((r) => ({
  code: r[ix['Код_товару']],
  titleRu: r[ix['Назва_позиції']],
  titleUa: r[ix['Назва_позиції_укр']],
  groupId: r[ix['Номер_групи']],
  group: r[ix['Назва_групи']],
})), null, 2));
