import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Groups Sheet');
const rows = sh.getUsedRange().values.slice(1);
console.log(rows.filter((r) => /Фен|фен|Плой|плой|Бігуд|бигуд|Расчес|Гребін|утюж|Випрям/iu.test(String(r[0]) + ' ' + String(r[1]) + ' ' + String(r[2])) || String(r[0]) === '149376305'));
