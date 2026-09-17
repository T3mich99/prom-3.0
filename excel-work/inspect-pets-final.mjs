import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const p = wb.worksheets.getItem('Export Products Sheet').getUsedRange().values;
const g = wb.worksheets.getItem('Export Groups Sheet').getUsedRange().values;
console.log(JSON.stringify({
  headers: p[0].slice(0, 30),
  product: p[1].slice(0, 30),
  groupMatches: g.filter((r) => ['149376321', '270'].includes(String(r[0])) || String(r[1]).toLowerCase().includes('живот')).slice(0, 20),
}, null, 2));
