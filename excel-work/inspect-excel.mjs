import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const inputPath = process.argv[2];
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const summary = await workbook.inspect({ kind: 'workbook,sheet,table', maxChars: 7000, tableMaxRows: 5, tableMaxCols: 12, tableMaxCellChars: 100 });
console.log(summary.ndjson);
const sheets = await workbook.inspect({ kind: 'sheet', include: 'id,name', maxChars: 4000 });
console.log(sheets.ndjson);
