import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const inputPath = process.argv[2] ?? './outputs/home-misc-next-100-2026-09-01/Prom-home-misc-next-100-final-2026-09-02.xlsx';
const pricePath = process.argv[3] ?? './outputs/home-misc-next-100-2026-09-01/current-ugopt-prices-2026-09-02.json';
const mapPath = process.argv[4] ?? './outputs/home-misc-next-100-2026-09-01/drive-map-new.json';
const outputPath = process.argv[5] ?? './outputs/home-misc-next-100-2026-09-01/Prom-home-misc-next-100-final-2026-09-02-v2.xlsx';
const outputDir = path.dirname(outputPath);
await fs.mkdir(outputDir, { recursive: true });

const clean = (v) => String(v ?? '').replace(/\s+/gu, ' ').trim();
const normCode = (v) => clean(v).replace(/^U/iu, '').replace(/U$/iu, '');
const numericCode = (v) => {
  const code = normCode(v);
  const n = Number(code);
  return Number.isFinite(n) ? String(n) : '';
};
const rawPrice = (cost) => cost * 1.90 / 0.80;
const retailPrice = (raw) => {
  const step = raw < 100 ? 5 : 10;
  return Math.ceil((raw - 1e-9) / step) * step;
};
const commissionPct = 20;
const markupPct = 137.5; // (1.90 / 0.80 - 1) × 100, before the 20% Prom fee.
// Prom's importer was rejecting the Drive `uc?export=download` URLs even though
// they return image/png in a browser. Use Google's direct image endpoint instead:
// it returns the image bytes without the Drive download wrapper/redirect.
const downloadUrl = (id) => `https://lh3.googleusercontent.com/d/${id}=w1280`;

const pricesPayload = JSON.parse(await fs.readFile(pricePath, 'utf8'));
const prices = new Map();
for (const item of pricesPayload.products ?? []) {
  prices.set(normCode(item.sku), item);
  prices.set(numericCode(item.sku), item);
}

const driveManifest = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const driveFiles = driveManifest.files ?? {};
const roles = ['01_main', '02_benefits', '03_features', '04_use', '05_details'];
const driveByCodeRole = new Map();
for (const [key, item] of Object.entries(driveFiles)) {
  const match = key.match(/^(.+?)_(01_main|02_benefits|03_features|04_use|05_details)\.png$/u);
  if (!match || !item?.id) continue;
  driveByCodeRole.set(`${normCode(match[1])}_${match[2]}`, item);
  driveByCodeRole.set(`${numericCode(match[1])}_${match[2]}`, item);
}

const sourceWb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sourceProducts = sourceWb.worksheets.getItem('Export Products Sheet');
const used = sourceProducts.getUsedRange();
const headers = used.values[0];
const ix = Object.fromEntries(headers.map((h, i) => [h, i]));
for (const required of ['Код_товару', 'Ціна', 'Посилання_зображення', 'Особисті_нотатки']) {
  if (ix[required] === undefined) throw new Error(`Missing field: ${required}`);
}

const rows = used.values.slice(1).filter((row) => clean(row[ix['Код_товару']]) !== '');
const qa = [];
const updatedRows = [];
const excluded = [];

for (const row of rows) {
  const code = normCode(row[ix['Код_товару']]);
  const priceItem = prices.get(code) ?? prices.get(numericCode(code));
  const links = roles.map((role) => {
    const item = driveByCodeRole.get(`${code}_${role}`) ?? driveByCodeRole.get(`${numericCode(code)}_${role}`);
    return item?.id ? downloadUrl(item.id) : '';
  });
  if (!priceItem || !Number.isFinite(Number(priceItem.current_price)) || links.some((link) => !link)) {
    excluded.push({ code, reason: !priceItem ? 'Не знайдена актуальна ціна Юг-Опт' : links.some((link) => !link) ? 'Немає повного набору 5 фото в цільовій папці Drive' : 'Некоректна ціна' });
    continue;
  }
  const cost = Number(priceItem.current_price);
  const raw = rawPrice(cost);
  const finalPrice = retailPrice(raw);
  const netProfit = finalPrice * (1 - commissionPct / 100) - cost;
  row[ix['Ціна']] = finalPrice;
  row[ix['Посилання_зображення']] = links.join(', ');
  if (ix['Оптова_ціна'] !== undefined) row[ix['Оптова_ціна']] = null;
  if (ix['Мінімальне_замовлення_опт'] !== undefined) row[ix['Мінімальне_замовлення_опт']] = null;
  row[ix['Особисті_нотатки']] = `UGOPT_PROM_TIERED_V1 | закупівля ${cost.toFixed(2).replace(/\.00$/u, '')} грн | комісія ${commissionPct.toFixed(2)}% | націнка ${markupPct.toFixed(2)}% | чистий прибуток ${((netProfit / cost) * 100).toFixed(2)}% | ціна до округлення ${raw.toFixed(2)} грн | RETAIL_ONLY | AI-фото: 5/5 | фото лише з цільової папки Google Drive`;
  const paidCommission = finalPrice * commissionPct / 100;
  qa.push({
    code,
    cost,
    rawPrice: Number(raw.toFixed(2)),
    finalPrice,
    commission: Number(paidCommission.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    netProfitPct: Number(((netProfit / cost) * 100).toFixed(2)),
    photoCount: links.length,
    driveFolderId: driveManifest.folderId,
    links,
    currentPriceStatus: priceItem.status,
  });
  updatedRows.push(row);
}

if (!updatedRows.length) throw new Error('No rows survived price/photo validation');

// Rebuild a compact workbook so stale formatted rows and non-export tabs cannot be
// interpreted as extra import positions by Prom.
const groupsValues = sourceWb.worksheets.getItem('Export Groups Sheet').getUsedRange().values;
const wb = Workbook.create();
const products = wb.worksheets.add('Export Products Sheet');
products.getRangeByIndexes(0, 0, updatedRows.length + 1, headers.length).values = [headers, ...updatedRows];
products.getRangeByIndexes(0, 0, 1, headers.length).format = { fill: '#17365D', font: { bold: true, color: '#FFFFFF' }, wrap_text: true, vertical_alignment: 'center' };
products.getRangeByIndexes(1, 0, updatedRows.length, headers.length).format = { vertical_alignment: 'top', wrap_text: true };
for (const h of ['Код_товару', 'Ціна', 'Унікальний_ідентифікатор', 'Ідентифікатор_підрозділу']) {
  if (ix[h] !== undefined) products.getRangeByIndexes(1, ix[h], updatedRows.length, 1).format.numberFormat = '0';
}
products.freezePanes.freezeRows(1);
products.showGridLines = false;
const groups = wb.worksheets.add('Export Groups Sheet');
groups.getRangeByIndexes(0, 0, groupsValues.length, groupsValues[0].length).values = groupsValues;
groups.getRangeByIndexes(0, 0, 1, groupsValues[0].length).format = { fill: '#17365D', font: { bold: true, color: '#FFFFFF' }, wrap_text: true, vertical_alignment: 'center' };
groups.getRangeByIndexes(1, 0, Math.max(1, groupsValues.length - 1), groupsValues[0].length).format = { vertical_alignment: 'top', wrap_text: true };
groups.freezePanes.freezeRows(1);
groups.showGridLines = false;

const checks = {
  sourceRows: rows.length,
  exportedRows: updatedRows.length,
  excluded,
  allFivePhotos: qa.every((r) => r.photoCount === 5),
  allPhotosFromTargetFolder: qa.every((r) => r.links.every((link) => link.startsWith('https://lh3.googleusercontent.com/d/')) && r.driveFolderId === driveManifest.folderId),
  currentPricesFetched: qa.filter((r) => r.currentPriceStatus === 'ok').length,
  fallbackPrices: qa.filter((r) => r.currentPriceStatus !== 'ok').length,
  allPricesRoundedUp: qa.every((r) => r.finalPrice >= r.rawPrice),
  allNetProfitAtLeast90Pct: qa.every((r) => r.netProfit + 1e-9 >= r.cost * 0.90),
  retailOnly: updatedRows.every((row) => !clean(row[ix['Оптова_ціна']]) && !clean(row[ix['Мінімальне_замовлення_опт']])),
  numericUniqueIds: updatedRows.every((row) => Number.isFinite(Number(row[ix['Унікальний_ідентифікатор']]))),
  noFormulaErrors: true,
  driveFolderId: driveManifest.folderId,
};
if (!checks.allFivePhotos || !checks.allPhotosFromTargetFolder || !checks.currentPricesFetched || !checks.allPricesRoundedUp || !checks.allNetProfitAtLeast90Pct || !checks.retailOnly || !checks.numericUniqueIds) {
  throw new Error(`Validation failed: ${JSON.stringify(checks)}`);
}

const formulaErrors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'Prom final formula error scan' });
checks.noFormulaErrors = /matched 0 entries/iu.test(formulaErrors.ndjson ?? '');
if (!checks.noFormulaErrors) throw new Error(`Formula errors found: ${formulaErrors.ndjson}`);

const preview = await wb.render({ sheetName: 'Export Products Sheet', range: 'A1:O8', scale: 1, format: 'png' });
await fs.writeFile(path.join(outputDir, 'prom-photo-price-fixed-preview.png'), new Uint8Array(await preview.arrayBuffer()));
await fs.writeFile(path.join(outputDir, 'prom-photo-price-fixed-qa-2026-09-02.json'), JSON.stringify({ checks, rows: qa }, null, 2), 'utf8');

const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, checks }, null, 2));
