import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) throw new Error('Usage: node extract-attached-prom-index.mjs INPUT.xlsx OUTPUT.json');

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = workbook.worksheets.getItem('Export Products Sheet');
const rows = sheet.getUsedRange().values;
const headers = rows[0].map((v) => String(v ?? '').trim());
const index = Object.fromEntries(headers.map((h, i) => [h, i]));
const codeIndex = index['Код_товару'];
if (codeIndex === undefined) throw new Error('Код_товару column not found');

const normalize = (value) => {
  const raw = String(value ?? '').trim();
  return raw.replace(/^U/i, '').replace(/U$/i, '').trim();
};
const products = rows.slice(1)
  .filter((row) => String(row[codeIndex] ?? '').trim())
  .map((row) => ({
    code: String(row[codeIndex] ?? '').trim(),
    normalizedCode: normalize(row[codeIndex]),
    titleRu: String(row[index['Назва_позиції'] ?? -1] ?? '').trim(),
    titleUa: String(row[index['Назва_позиції_укр'] ?? -1] ?? '').trim(),
  }));
const codes = [...new Set(products.map((p) => p.normalizedCode).filter(Boolean))];
await fs.mkdir(new URL('.', `file:///${outputPath.replaceAll('\\', '/')}`).pathname, { recursive: true }).catch(() => {});
await fs.writeFile(outputPath, JSON.stringify({ sourceFile: inputPath, count: codes.length, codes, products }, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, count: codes.length, first: codes.slice(0, 10) }));
