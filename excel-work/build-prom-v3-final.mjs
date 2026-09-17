import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2];
const mapPath = process.argv[3];
const outputPath = process.argv[4];
if (!inputPath || !mapPath || !outputPath) throw new Error('Usage: build-prom-v3-final.mjs CONTENT_XLSX DRIVE_MAP_JSON OUTPUT_XLSX');
const outputDir = path.dirname(outputPath);
await fs.mkdir(outputDir, { recursive: true });

const clean = (v) => String(v ?? '').replace(/\s+/gu, ' ').trim();
const nonblank = (v) => clean(v) !== '';
const normCode = (v) => clean(v).replace(/^U/iu, '').replace(/U$/iu, '');
const norm = (v) => clean(v).toLocaleLowerCase('uk-UA').replace(/[’'`]/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const roles = ['01_main', '02_benefits', '03_features', '04_use', '05_details'];
const driveMap = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const sourceData = JSON.parse(await fs.readFile('./outputs/home-misc-next-100-2026-09-02/next-100-source-data-enriched.json', 'utf8')).products;
const sourceBySku = new Map(sourceData.map((p) => [clean(p.sku), p]));
const directDriveUrl = (id) => `https://lh3.googleusercontent.com/d/${id}=w1280`;

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const used = products.getUsedRange();
const headers = used.values[0];
const ix = Object.fromEntries(headers.map((h, i) => [h, i]));
const required = [
  'Код_товару', 'Назва_позиції', 'Назва_позиції_укр', 'Опис', 'Опис_укр',
  'Пошукові_запити', 'Пошукові_запити_укр', 'Посилання_зображення',
  'Ціна', 'Оптова_ціна', 'Мінімальне_замовлення_опт', 'Унікальний_ідентифікатор',
  'Ідентифікатор_товару', 'Ідентифікатор_підрозділу', 'Особисті_нотатки',
  'Виробник', 'Назва_групи',
];
for (const h of required) if (ix[h] === undefined) throw new Error(`Missing Prom field: ${h}`);
const nameSlots = headers.map((h, i) => h === 'Назва_Характеристики' ? i : -1).filter((i) => i >= 0);
const valueSlots = headers.map((h, i) => h === 'Значення_Характеристики' ? i : -1).filter((i) => i >= 0);
if (!nameSlots.length || nameSlots.length !== valueSlots.length) throw new Error('Characteristic columns are incomplete');

const allRows = used.values.slice(1).filter((r) => nonblank(r[ix['Код_товару']]));
const completeRows = [];
const excluded = [];
const qa = [];
for (const row of allRows) {
  const code = normCode(row[ix['Код_товару']]);
  const photoIds = roles.map((role) => driveMap[`${code}/${role}.png`]);
  const missingRoles = roles.filter((role) => !driveMap[`${code}/${role}.png`]);
  if (missingRoles.length) {
    excluded.push({ code, reason: 'Немає повного набору нових фото в цільовій папці Google Drive', missingRoles });
    continue;
  }
  const p = sourceBySku.get(code) ?? sourceBySku.get(code.padStart(5, '0'));
  if (!p) throw new Error(`Source data not found for ${code}`);

  const supplierCode = clean(p.sku) || code;
  const numericCode = Number(supplierCode);
  if (!Number.isInteger(numericCode) || numericCode <= 0) throw new Error(`Invalid numeric identifier for ${supplierCode}`);
  row[ix['Код_товару']] = `U${supplierCode}U`;
  row[ix['Унікальний_ідентифікатор']] = numericCode;
  row[ix['Ідентифікатор_товару']] = `U${numericCode}U`;
  row[ix['Посилання_зображення']] = photoIds.map(directDriveUrl).join(', ');
  row[ix['Оптова_ціна']] = null;
  row[ix['Мінімальне_замовлення_опт']] = null;

  const sourceManufacturer = (p.attributes ?? []).find((a) => /^(?:виробник|manufacturer)$/iu.test(clean(a.name)))?.value;
  const manufacturer = nonblank(row[ix['Виробник']]) ? clean(row[ix['Виробник']]) : (nonblank(sourceManufacturer) ? clean(sourceManufacturer) : 'AND');
  row[ix['Виробник']] = manufacturer;
  let manufacturerSlot = nameSlots.find((slot) => /виробник/iu.test(clean(row[slot])));
  if (manufacturerSlot === undefined) manufacturerSlot = nameSlots.find((slot) => !nonblank(row[slot]));
  if (manufacturerSlot === undefined) throw new Error(`No characteristic slot for manufacturer ${supplierCode}`);
  row[manufacturerSlot] = 'Виробник';
  row[valueSlots[nameSlots.indexOf(manufacturerSlot)]] = manufacturer;

  const pricingNote = clean(row[ix['Особисті_нотатки']]);
  const cleanPricingNote = pricingNote
    .replace(/\s*\|\s*AI-фото:.*$/iu, '')
    .replace(/\s*\|\s*RETAIL_ONLY/giu, '')
    .replace(/\s*\|\s*$/u, '')
    .trim();
  row[ix['Особисті_нотатки']] = `${cleanPricingNote} | RETAIL_ONLY | AI-фото: 5/5 | фото лише з цільової папки Google Drive`;
  const ruKw = clean(row[ix['Пошукові_запити']]);
  const uaKw = clean(row[ix['Пошукові_запити_укр']]);
  const group = clean(row[ix['Назва_групи']]);
  const categoryId = clean(row[ix['Ідентифікатор_підрозділу']]);
  const ruHtml = clean(row[ix['HTML_опис']] ?? '');
  const uaHtml = clean(row[ix['HTML_опис_укр']] ?? '');
  qa.push({
    code: supplierCode,
    titleRu: clean(row[ix['Назва_позиції']]),
    titleUa: clean(row[ix['Назва_позиції_укр']]),
    group,
    categoryId,
    manufacturer,
    imageUrls: row[ix['Посилання_зображення']],
    ruKeywords: ruKw.split(',').map(clean).filter(Boolean).length,
    uaKeywords: uaKw.split(',').map(clean).filter(Boolean).length,
    ruKeywordChars: ruKw.length,
    uaKeywordChars: uaKw.length,
    htmlRuChars: ruHtml.length,
    htmlUaChars: uaHtml.length,
  });
  completeRows.push(row);
}
if (!completeRows.length) throw new Error('No products with all five new Drive photos');

products.getRangeByIndexes(1, 0, Math.max(1, used.values.length - 1), headers.length).clear({ applyTo: 'contents' });
products.getRangeByIndexes(1, 0, completeRows.length, headers.length).values = completeRows;
for (const h of ['Унікальний_ідентифікатор', 'Ідентифікатор_підрозділу']) products.getRangeByIndexes(1, ix[h], completeRows.length, 1).format.numberFormat = '0';
products.freezePanes.freezeRows(1);
products.showGridLines = false;

for (const sheetName of ['Prom QA', 'Content QA', 'Photo Queue', 'Photo QA']) {
  try { wb.worksheets.getItem(sheetName).delete(); } catch {}
}
const categoryOk = completeRows.every((r) => nonblank(r[ix['Назва_групи']]) && nonblank(r[ix['Ідентифікатор_підрозділу']]) && !/коренева група|root/iu.test(`${r[ix['Назва_групи']]} ${r[ix['Ідентифікатор_підрозділу']]}`));
const checks = {
  products: completeRows.length,
  excludedProducts: excluded,
  allFivePhotosFromTargetDriveFolder: qa.every((r) => r.imageUrls.split(', ').length === 5 && r.imageUrls.split(', ').every((u) => /^https:\/\/lh3\.googleusercontent\.com\/d\/[^=]+=w1280$/u.test(u))),
  driveMapEntriesUsed: qa.length * 5,
  supplierCodesUFormat: completeRows.every((r) => /^U\d+U$/u.test(clean(r[ix['Код_товару']]))),
  uniqueIdentifiersNumeric: completeRows.every((r) => Number.isInteger(Number(r[ix['Унікальний_ідентифікатор']])) && Number(r[ix['Унікальний_ідентифікатор']]) > 0),
  productIdentifiersUFormat: completeRows.every((r) => /^U\d+U$/u.test(clean(r[ix['Ідентифікатор_товару']]))),
  retailOnly: completeRows.every((r) => !nonblank(r[ix['Оптова_ціна']]) && !nonblank(r[ix['Мінімальне_замовлення_опт']]) && /RETAIL_ONLY/iu.test(clean(r[ix['Особисті_нотатки']]))),
  categoriesExplicit: categoryOk,
  manufacturersFilled: completeRows.every((r) => nonblank(r[ix['Виробник']]) && nameSlots.some((slot) => /виробник/iu.test(clean(r[slot])) && nonblank(r[valueSlots[nameSlots.indexOf(slot)]]))),
  ruKeywords25Plus: qa.filter((r) => r.ruKeywords >= 25).length,
  uaKeywords25Plus: qa.filter((r) => r.uaKeywords >= 25).length,
  ruKeywordsWithin1024: qa.filter((r) => r.ruKeywordChars <= 1024).length,
  uaKeywordsWithin1024: qa.filter((r) => r.uaKeywordChars <= 1024).length,
  htmlRuWithin250: qa.filter((r) => r.htmlRuChars > 0 && r.htmlRuChars <= 250).length,
  htmlUaWithin270: qa.filter((r) => r.htmlUaChars > 0 && r.htmlUaChars <= 270).length,
  sheets: wb.worksheets.items.map((s) => s.name),
};
if (!checks.allFivePhotosFromTargetDriveFolder || !checks.supplierCodesUFormat || !checks.uniqueIdentifiersNumeric || !checks.productIdentifiersUFormat || !checks.retailOnly || !checks.categoriesExplicit || !checks.manufacturersFilled || checks.ruKeywords25Plus !== completeRows.length || checks.uaKeywords25Plus !== completeRows.length || checks.ruKeywordsWithin1024 !== completeRows.length || checks.uaKeywordsWithin1024 !== completeRows.length || checks.htmlRuWithin250 !== completeRows.length || checks.htmlUaWithin270 !== completeRows.length || checks.sheets.length !== 2) throw new Error(`Final Prom QA failed: ${JSON.stringify(checks)}`);

const formulaErrors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'Prom v3 final formula error scan' });
const preview = await wb.render({ sheetName: 'Export Products Sheet', range: 'A1:O12', scale: 1, format: 'png' });
await fs.writeFile(path.join(outputDir, 'prom-v3-products-preview.png'), new Uint8Array(await preview.arrayBuffer()));
await fs.writeFile(path.join(outputDir, 'prom-v3-final-qa-2026-09-03.json'), JSON.stringify({ checks, formulaErrors: formulaErrors.ndjson || '', excluded, products: qa }, null, 2), 'utf8');
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, checks, formulaErrors: formulaErrors.ndjson || '' }, null, 2));
