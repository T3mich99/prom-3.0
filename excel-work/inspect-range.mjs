import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Products Sheet');
console.log(JSON.stringify({headers: sh.getRange('A1:DD1').values[0], row2: sh.getRange('A2:DD2').values[0], row101: sh.getRange('A101:DD101').values[0]}));
