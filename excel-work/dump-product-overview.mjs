import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Products Sheet');
const rows = sh.getRange('A2:S101').values;
for (const r of rows) console.log(JSON.stringify({code:String(r[0]??'').replace(/^U|U$/g,''),ru:r[1],ua:r[2],catId:r[17],cat:r[18],price:r[8]}));
