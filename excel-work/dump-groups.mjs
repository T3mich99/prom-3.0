import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Groups Sheet');
const rows = sh.getRange('A2:F264').values;
for (const r of rows) console.log([r[0], r[1], r[2], r[3], r[4], r[5]].map((x)=>String(x??'')).join('\t'));
