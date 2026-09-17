import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const beforePath = process.argv[2];
const afterPath = process.argv[3];
const before = await SpreadsheetFile.importXlsx(await FileBlob.load(beforePath));
const after = await SpreadsheetFile.importXlsx(await FileBlob.load(afterPath));
const norm = (v) => v === null || v === undefined ? null : String(v);
const sheets = ['Export Products Sheet', 'Export Groups Sheet', 'Content QA'];
const result = { sheetsChecked: sheets.length, nonPhotoDifferences: 0, photoDifferences: 0, details: [] };
for (const name of sheets) {
  const a = before.worksheets.getItem(name).getUsedRange().values;
  const b = after.worksheets.getItem(name).getUsedRange().values;
  let differences = 0;
  const photoIx = name === 'Export Products Sheet' ? a[0].map(norm).indexOf('Посилання_зображення') : -1;
  const rows = Math.max(a.length, b.length);
  const cols = Math.max(...a.map((r) => r.length), ...b.map((r) => r.length));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const av = norm(a[r]?.[c]); const bv = norm(b[r]?.[c]);
    if (av === bv) continue;
    if (name === 'Export Products Sheet' && c === photoIx) result.photoDifferences++;
    else { result.nonPhotoDifferences++; differences++; }
  }
  result.details.push({ name, beforeRows: a.length, afterRows: b.length, nonPhotoDifferences: differences });
}
console.log(JSON.stringify(result, null, 2));
