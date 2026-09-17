import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const mapPath = process.argv[3];
const payload = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const imageMap = payload.images ?? {};
const roles = ['01_main.png', '02_benefits.png', '03_features.png', '04_use.png', '05_details.png'];
const stripCode = (value) => String(value ?? '').replace(/^U|U$/g, '').trim();
const publicUrl = (id) => `https://lh3.googleusercontent.com/d/${id}=w1280`;
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = workbook.worksheets.getItem('Export Products Sheet');
const rows = products.getRange('A2:O90').values;
let mismatches = [];
let allFive = 0;
for (const row of rows) {
  const code = stripCode(row[0]);
  const expected = roles.map((role) => publicUrl(imageMap[code]?.[role]));
  const actual = String(row[14] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (actual.length === 5 && expected.every((url, i) => url === actual[i])) allFive++;
  else mismatches.push({ code, expected, actual });
}
const formulaErrors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'Drive 1ON-only QA formula error scan',
});
console.log(JSON.stringify({
  sourceFolder: payload.folderId,
  rows: rows.length,
  exactFivePhotoRows: allFive,
  mismatches,
  sample: rows.slice(0, 2).map((row) => ({ code: stripCode(row[0]), photoLinks: String(row[14] ?? '').split(',').map((x) => x.trim()).filter(Boolean) })),
  formulaErrors: formulaErrors.ndjson || '',
}, null, 2));
