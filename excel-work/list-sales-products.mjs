import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Products Sheet');
const r = sh.getUsedRange();
const h = r.values[0];
const ix = Object.fromEntries(h.map((x,i)=>[x,i]));
for (const row of r.values.slice(1).filter(x=>String(x[ix['Код_товару']]??'').trim())) {
  console.log([row[ix['Код_товару']], row[ix['Назва_позиції']], row[ix['Назва_позиції_укр']], row[ix['Назва_групи']], row[ix['Значення_Характеристики']] ?? ''].join('\t'));
}
