import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Products Sheet');
const rows = sh.getRange('A2:G11').values;
for (const r of rows) console.log(JSON.stringify({code:r[0], ru:r[3], ua:r[4], ruLen:String(r[3]??'').length, uaLen:String(r[4]??'').length}));
