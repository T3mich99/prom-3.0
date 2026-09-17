import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Groups Sheet');
console.log(JSON.stringify(sh.getRange('A1:F30').values, null, 2));
