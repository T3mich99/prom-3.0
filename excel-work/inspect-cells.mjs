import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Products Sheet');
console.log(JSON.stringify({p2:sh.getRange('N2:T5').values, html:sh.getRange('AM2:AP5').values}));
