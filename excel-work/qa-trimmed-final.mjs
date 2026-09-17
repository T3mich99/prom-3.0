import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import fs from 'node:fs/promises';

const inputPath = process.argv[2];
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const rows = products.getRange('A2:AP90').values;
const currentMap = JSON.parse(await fs.readFile('excel-work/drive-map-v2.json', 'utf8'));
const oldMap = JSON.parse(await fs.readFile('excel-work/current-drive-map.json', 'utf8'));
const allowed = new Set(Object.values(currentMap).filter((x) => x && !x.fallback && x.url).map((x) => x.url));
const oldUrls = new Set(Object.values(oldMap).filter((x) => x && x.url).map((x) => x.url));
const removeCodes = new Set(['0149', '34621', '34012', '34020', '10962', '14230', '14239', '34663', '34668', '34675', '54692']);
const stripCode = (v) => String(v ?? '').replace(/^U|U$/g, '');
const checks = { rows: rows.length, removedPresent: 0, photosAllNew: 0, oldLinks: 0, emptyPhotos: 0, numericUniqueIds: 0, categories: 0, ruKeywords25: 0, uaKeywords25: 0, htmlRu250: 0, htmlUa270: 0, retailOnly: 0 };

for (const row of rows) {
  const code = stripCode(row[0]);
  if (removeCodes.has(code)) checks.removedPresent++;
  const links = String(row[14] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!links.length) checks.emptyPhotos++;
  if (links.length && links.every((url) => allowed.has(url))) checks.photosAllNew++;
  if (links.some((url) => oldUrls.has(url))) checks.oldLinks++;
  if (Number(row[24]) === Number(code) && /^\d+$/.test(String(row[24] ?? ''))) checks.numericUniqueIds++;
  if (row[17] && row[18]) checks.categories++;
  if (String(row[3] ?? '').split(',').filter((x) => x.trim()).length >= 25) checks.ruKeywords25++;
  if (String(row[4] ?? '').split(',').filter((x) => x.trim()).length >= 25) checks.uaKeywords25++;
  if (String(row[44] ?? '').length <= 250) checks.htmlRu250++;
  if (String(row[45] ?? '').length <= 270) checks.htmlUa270++;
  if (!row[12] && !row[13]) checks.retailOnly++;
}
const formulaErrors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'trimmed final QA formula scan' });
console.log(JSON.stringify({ checks, formulaErrors: formulaErrors.ndjson || '' }, null, 2));
