import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2] ?? './outputs/pets-all-2026-09-05/Prom-pets-all-content-draft-2026-09-05.xlsx';
const mapPath = process.argv[3] ?? './outputs/pets-all-2026-09-05/pets-drive-upload-map.jsonl';
const outputDir = process.argv[4] ?? './outputs/pets-all-2026-09-05';
await fs.mkdir(outputDir, { recursive: true });

const driveEntries = (await fs.readFile(mapPath, 'utf8'))
  .split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
const driveFiles = Object.fromEntries(driveEntries.map((item) => [`${item.sku}_${item.role}.png`, item]));
const folderId = '1ON7z6_MnJwGCiM1w9wvjYNUynWRbHO5g';
const roles = ['01_main', '02_benefits', '03_features', '04_use', '05_details'];
const clean = (v) => String(v ?? '').replace(/\s+/gu, ' ').trim();
const nonblank = (v) => v !== null && v !== undefined && clean(v) !== '';
const normalizeCode = (v) => clean(v).replace(/^U/iu, '').replace(/U$/iu, '');
const drivePublicUrl = (item) => item?.id ? `https://lh3.googleusercontent.com/d/${item.id}=w1280` : '';

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const used = products.getUsedRange();
const headers = used.values[0];
const ix = Object.fromEntries(headers.map((h, i) => [h, i]));
const required = ['Код_товару', 'Посилання_зображення', 'Унікальний_ідентифікатор', 'Ідентифікатор_товару', 'Ідентифікатор_підрозділу', 'Оптова_ціна', 'Мінімальне_замовлення_опт', 'Пошукові_запити', 'Пошукові_запити_укр', 'Опис', 'Опис_укр'];
for (const h of required) if (ix[h] === undefined) throw new Error(`Missing field: ${h}`);

const allRows = products.getRangeByIndexes(1, 0, Math.max(1, used.values.length - 1), headers.length).values;
const qa = [];
const completeRows = [];
const excluded = [];

for (const row of allRows) {
  const code = normalizeCode(row[ix['Код_товару']]);
  if (!code) continue;
  const links = roles.map((role) => drivePublicUrl(driveFiles[`${code}_${role}.png`])).filter(Boolean);
  if (links.length !== 5) {
    excluded.push({ code, reason: `Немає повного набору нових AI-фото: ${links.length}/5` });
    continue;
  }

  row[ix['Посилання_зображення']] = links.join(', ');
  row[ix['Код_товару']] = `U${code}U`;
  if (ix['Оптова_ціна'] !== undefined) row[ix['Оптова_ціна']] = null;
  if (ix['Мінімальне_замовлення_опт'] !== undefined) row[ix['Мінімальне_замовлення_опт']] = null;
  if (ix['Виробник'] !== undefined && !nonblank(row[ix['Виробник']])) row[ix['Виробник']] = 'AND';
  if (ix['Особисті_нотатки'] !== undefined) {
    const currentNote = clean(row[ix['Особисті_нотатки']]);
    row[ix['Особисті_нотатки']] = currentNote
      .replace(/AI-фото:\s*\d+\/5/iu, 'AI-фото: 5/5')
      .replace(/\s*$/u, ' | фото лише з цільової папки Google Drive');
  }

  const numericIds = ['Унікальний_ідентифікатор', 'Ідентифікатор_товару', 'Ідентифікатор_підрозділу']
    .every((h) => Number.isFinite(Number(row[ix[h]])));
  const ruKeywords = clean(row[ix['Пошукові_запити']]);
  const uaKeywords = clean(row[ix['Пошукові_запити_укр']]);
  const ruCount = ruKeywords ? ruKeywords.split(',').map(clean).filter(Boolean).length : 0;
  const uaCount = uaKeywords ? uaKeywords.split(',').map(clean).filter(Boolean).length : 0;
  qa.push({
    code, titleRu: row[ix['Назва_позиції']] ?? '', titleUa: row[ix['Назва_позиції_укр']] ?? '',
    categoryId: row[ix['Ідентифікатор_підрозділу']] ?? '', category: row[ix['Назва_групи']] ?? '',
    price: row[ix['Ціна']] ?? '', photos: links.length,
    directDriveUrls: links.every((u) => /^https:\/\/lh3\.googleusercontent\.com\/d\/[A-Za-z0-9_-]+=w1280$/u.test(u)),
    numericIds, retailOnly: !nonblank(row[ix['Оптова_ціна']]) && !nonblank(row[ix['Мінімальне_замовлення_опт']]),
    ruPhrases: ruCount, uaPhrases: uaCount, ruChars: ruKeywords.length, uaChars: uaKeywords.length,
  });
  completeRows.push(row);
}

if (completeRows.length === 0) throw new Error('No complete products with 5 new Drive photos');
products.getRangeByIndexes(1, 0, Math.max(1, used.values.length - 1), headers.length).clear({ applyTo: 'contents' });
products.getRangeByIndexes(1, 0, completeRows.length, headers.length).values = completeRows;
for (const h of ['Унікальний_ідентифікатор', 'Ідентифікатор_товару', 'Ідентифікатор_підрозділу']) {
  products.getRangeByIndexes(1, ix[h], completeRows.length, 1).format.numberFormat = '0';
}
products.freezePanes.freezeRows(1);
products.showGridLines = false;

for (const name of ['Content QA', 'Photo Queue', 'Photo QA', 'Prom QA']) {
  try { wb.worksheets.getItem(name).delete(); } catch {}
}
const qaSheet = wb.worksheets.add('Prom QA');
const qaHeader = ['Код', 'Назва RU', 'Назва UA', 'Prom ID категорії', 'Група', 'Ціна', 'Нових фото', 'Прямі Drive URL', 'Числові ID', 'Тільки роздріб', 'RU фраз', 'UA фраз', 'RU символів', 'UA символів'];
const qaRows = qa.map((r) => [r.code, r.titleRu, r.titleUa, r.categoryId, r.category, r.price, r.photos, r.directDriveUrls, r.numericIds, r.retailOnly, r.ruPhrases, r.uaPhrases, r.ruChars, r.uaChars]);
qaSheet.getRange(`A1:N${qaRows.length + 1}`).values = [qaHeader, ...qaRows];
qaSheet.getRange('A1:N1').format = { fill: '#17365D', font: { bold: true, color: '#FFFFFF' }, horizontal_alignment: 'center', vertical_alignment: 'center', wrap_text: true };
qaSheet.getRange(`A2:N${qaRows.length + 1}`).format = { vertical_alignment: 'top', wrap_text: true };
qaSheet.getRange('A:A').format.column_width = 12;
qaSheet.getRange('B:C').format.column_width = 34;
qaSheet.getRange('D:F').format.column_width = 15;
qaSheet.getRange('G:J').format.column_width = 14;
qaSheet.getRange('K:N').format.column_width = 12;
try { qaSheet.tables.add(`A1:N${qaRows.length + 1}`, true, 'PromQAPets'); } catch {}

const checks = {
  products: completeRows.length,
  excludedProducts: excluded,
  allFiveNewDrivePhotos: qa.every((r) => r.photos === 5),
  allDirectDriveUrls: qa.every((r) => r.directDriveUrls),
  allNumericIds: qa.every((r) => r.numericIds),
  retailOnly: qa.every((r) => r.retailOnly),
  uniqueCodes: new Set(qa.map((r) => r.code)).size === qa.length,
  ruKeywords25Plus: qa.filter((r) => r.ruPhrases >= 25).length,
  uaKeywords25Plus: qa.filter((r) => r.uaPhrases >= 25).length,
  ruKeywords1024OrLess: qa.filter((r) => r.ruChars <= 1024).length,
  uaKeywords1024OrLess: qa.filter((r) => r.uaChars <= 1024).length,
  driveFolderId: folderId,
};
if (!checks.allFiveNewDrivePhotos || !checks.allDirectDriveUrls || !checks.allNumericIds || !checks.retailOnly || !checks.uniqueCodes || checks.ruKeywords25Plus !== completeRows.length || checks.uaKeywords25Plus !== completeRows.length || checks.ruKeywords1024OrLess !== completeRows.length || checks.uaKeywords1024OrLess !== completeRows.length) {
  throw new Error(`Prom QA failed: ${JSON.stringify(checks)}`);
}

const formulaErrors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'Prom pets final formula error scan' });
for (const [fileName, options] of [
  ['pets-prom-products-preview.png', { sheetName: 'Export Products Sheet', range: 'A1:O12', scale: 1, format: 'png' }],
  ['pets-prom-qa-preview.png', { sheetName: 'Prom QA', range: 'A1:N15', scale: 1, format: 'png' }],
]) {
  const image = await wb.render(options);
  await fs.writeFile(path.join(outputDir, fileName), new Uint8Array(await image.arrayBuffer()));
}
await fs.writeFile(path.join(outputDir, 'pets-prom-final-qa-2026-09-05.json'), JSON.stringify({ checks, formulaErrors: formulaErrors.ndjson || '', excluded, products: qa }, null, 2), 'utf8');
const outputPath = path.join(outputDir, 'Prom-pets-all-final-2026-09-05.xlsx');
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, checks, formulaErrors: formulaErrors.ndjson || '' }, null, 2));
