import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Products Sheet');
for (const r of sh.getRange('A2:AA101').values) console.log(`${r[0]}\t${r[17]}\t${r[18]}\t${r[26]}`);
