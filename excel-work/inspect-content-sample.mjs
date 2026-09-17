import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Products Sheet');
const rows = sh.getRange('A2:G6').values;
for (const r of rows) console.log(JSON.stringify({code:r[0], ru:r[5], ua:r[6]}));
