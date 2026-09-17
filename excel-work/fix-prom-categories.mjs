import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = process.argv[2] ?? './outputs/home-misc-next-100-2026-09-01/Prom-home-misc-next-100-final-2026-09-02.xlsx';
const outputPath = process.argv[3] ?? inputPath;
const outputDir = path.dirname(outputPath);
const referencePath = process.argv[4] ?? './outputs/prom-product-factory-2026-09-01-final/Prom-UGOPT-100-final-ready-2026-09-01.xlsx';
const categoriesPath = process.argv[5] ?? 'C:/Users/Dell/Documents/kasta/outputs/prom-commission-categories.json';
await fs.mkdir(outputDir, { recursive: true });

const clean = (v) => String(v ?? '').replace(/\s+/gu, ' ').trim();
const nonblank = (v) => clean(v) !== '';
const numeric = (v) => Number.isFinite(Number(v)) && nonblank(v);

// Russian category labels for IDs that were not present in the prior Prom export.
// Ukrainian labels come directly from the current Prom category list.
const ruNames = {
  '611': 'Соковыжималки',
  '82111': 'Антистатики и пропитки для одежды',
  '151408': 'Швабры и запасные насадки',
  '151409': 'Губки для посуды',
  '151415': 'Дозаторы для моющих средств',
  '151605': 'Щётки для одежды',
  '152209': 'Кухонные маслянки',
  '152601': 'Пепельницы',
  '152904': 'Штопоры, открывалки и укупорщики для бутылок',
  '154007': 'Губки и мочалки для ванной',
  '154103': 'Ящики и корзины для хранения',
  '162528': 'Домашние тонометры',
  '302306': 'Охранные системы и сигнализации',
  '330502': 'Зубные щётки',
  '342406': 'Велосипедные насосы',
  '370823': 'Сушки для посуды',
  '370826': 'Декор для мебели',
  '371103': 'Мебельные ролики и колёса',
  '371105': 'Мебельные крючки и подвесы',
  '380410': 'Чехлы для одежды, обуви',
  '3011808': 'Велобахилы',
  '3221019': 'Стельки',
  '4050702': 'Ковры',
  '14201523': 'Клеевые стержни',
  '15230423': 'Прессы и орехоколы',
  '37034006': 'Вешалки для одежды',
  '322100303': 'Щётки и губки для обуви',
};

const readGroupMap = async (filePath) => {
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
  const sheet = wb.worksheets.getItem('Export Groups Sheet');
  const values = sheet.getUsedRange().values;
  const map = new Map();
  for (const row of values.slice(1)) {
    const id = clean(row[3]);
    const number = Number(row[0]);
    const ru = clean(row[1]);
    const ua = clean(row[2]);
    if (id && Number.isFinite(number) && ru && !map.has(id)) map.set(id, { number, ru, ua: ua || ru });
  }
  return map;
};

const categories = JSON.parse(await fs.readFile(categoriesPath, 'utf8'));
const categoryById = new Map(categories.map((c) => [String(c.id), c]));
const referenceGroups = await readGroupMap(referencePath);

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = wb.worksheets.getItem('Export Products Sheet');
const productUsed = products.getUsedRange();
const headers = productUsed.values[0];
const ix = Object.fromEntries(headers.map((h, i) => [h, i]));
const required = ['Код_товару', 'Номер_групи', 'Назва_групи', 'Ідентифікатор_підрозділу', 'Посилання_підрозділу'];
for (const h of required) if (ix[h] === undefined) throw new Error(`Missing product field: ${h}`);

const productRows = productUsed.values.slice(1).filter((row) => nonblank(row[ix['Код_товару']]));
const categoryIds = [...new Set(productRows.map((row) => clean(row[ix['Ідентифікатор_підрозділу']])).filter(Boolean))];
const groupsSheet = wb.worksheets.getItem('Export Groups Sheet');
const groupUsed = groupsSheet.getUsedRange();
const groupHeaders = groupUsed.values[0];
const groupRows = groupUsed.values.slice(1).map((row) => [...row]);
const currentGroups = new Map();
const usedGroupNumbers = new Set();
for (const row of groupRows) {
  const id = clean(row[3]);
  const number = Number(row[0]);
  if (id && Number.isFinite(number)) currentGroups.set(id, { number, ru: clean(row[1]), ua: clean(row[2]) });
  if (Number.isFinite(number)) usedGroupNumbers.add(number);
}

const mappings = new Map();
let nextGroupNumber = 156211512;
for (const id of categoryIds) {
  const cat = categoryById.get(id);
  if (!cat) throw new Error(`Category ID not found in Prom category list: ${id}`);
  const old = referenceGroups.get(id);
  const current = currentGroups.get(id);
  let number = old?.number ?? current?.number;
  if (!Number.isFinite(number)) {
    while (usedGroupNumbers.has(nextGroupNumber)) nextGroupNumber += 1;
    number = nextGroupNumber;
    nextGroupNumber += 1;
  }
  usedGroupNumbers.add(number);
  const ru = ruNames[id] || old?.ru || current?.ru;
  if (!ru) throw new Error(`Russian category name is missing for Prom category ${id}`);
  const ua = clean(cat.name) || old?.ua || current?.ua || ru;
  mappings.set(id, { number, ru, ua });
}

for (const row of productRows) {
  const id = clean(row[ix['Ідентифікатор_підрозділу']]);
  const mapping = mappings.get(id);
  if (!mapping) throw new Error(`No category mapping for product ${row[ix['Код_товару']]} / ${id}`);
  row[ix['Номер_групи']] = mapping.number;
  row[ix['Назва_групи']] = mapping.ru;
  // The exact Prom category is carried by the numeric subdivision ID and group row.
  // Keep this compatibility field empty, as in the accepted Prom export template.
  row[ix['Посилання_підрозділу']] = null;
}

products.getRangeByIndexes(1, 0, productUsed.values.length - 1, headers.length).clear({ applyTo: 'contents' });
products.getRangeByIndexes(1, 0, productRows.length, headers.length).values = productRows;
for (const h of ['Код_товару', 'Номер_групи', 'Унікальний_ідентифікатор', 'Ідентифікатор_товару', 'Ідентифікатор_підрозділу']) {
  if (ix[h] !== undefined) products.getRangeByIndexes(1, ix[h], productRows.length, 1).format.numberFormat = '0';
}

const existingGroupIds = new Set();
for (const row of groupRows) {
  const id = clean(row[3]);
  if (id) existingGroupIds.add(id);
  const mapping = mappings.get(id);
  if (mapping) {
    row[0] = mapping.number;
    row[1] = mapping.ru;
    row[2] = mapping.ua;
    row[3] = Number(id);
  }
}
for (const [id, mapping] of mappings) {
  if (existingGroupIds.has(id)) continue;
  const row = Array(groupHeaders.length).fill(null);
  row[0] = mapping.number;
  row[1] = mapping.ru;
  row[2] = mapping.ua;
  row[3] = Number(id);
  groupRows.push(row);
}
groupsSheet.getRangeByIndexes(0, 0, groupRows.length + 1, groupHeaders.length).values = [groupHeaders, ...groupRows];
groupsSheet.getRangeByIndexes(1, 0, groupRows.length, 4).format.numberFormat = '0';

let qaSheet = null;
try { qaSheet = wb.worksheets.getItem('Prom QA'); } catch {}
if (qaSheet) {
  qaSheet.getRange('E1').values = [['Категорія Prom']];
  qaSheet.getRangeByIndexes(1, 4, productRows.length, 1).values = productRows.map((row) => [row[ix['Назва_групи']]]);
}

const categoryRowsPresent = categoryIds.every((id) => groupRows.some((row) => clean(row[3]) === id && numeric(row[0]) && nonblank(row[1]) && nonblank(row[2])));
const productCategoriesPresent = productRows.every((row) => {
  const id = clean(row[ix['Ідентифікатор_підрозділу']]);
  const mapping = mappings.get(id);
  return numeric(row[ix['Ідентифікатор_підрозділу']]) && mapping && Number(row[ix['Номер_групи']]) === mapping.number && clean(row[ix['Назва_групи']]) === mapping.ru;
});
const checks = {
  products: productRows.length,
  uniquePromCategories: categoryIds.length,
  productCategoriesPresent,
  categoryRowsPresent,
  categoriesInProductSheet: productRows.filter((row) => numeric(row[ix['Ідентифікатор_підрозділу']]) && nonblank(row[ix['Номер_групи']]) && nonblank(row[ix['Назва_групи']])).length,
  categoriesInGroupsSheet: categoryIds.filter((id) => groupRows.some((row) => clean(row[3]) === id)).length,
  categories: Object.fromEntries(categoryIds.map((id) => [id, mappings.get(id)])),
};
if (!checks.productCategoriesPresent || !checks.categoryRowsPresent) throw new Error(`Category QA failed: ${JSON.stringify(checks)}`);

const formulaErrors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'category fix formula error scan' });
const previews = [
  ['prom-products-category-preview.png', { sheetName: 'Export Products Sheet', range: 'Q1:U12', scale: 1, format: 'png' }],
  ['prom-groups-category-preview.png', { sheetName: 'Export Groups Sheet', range: 'A1:D20', scale: 1, format: 'png' }],
];
if (qaSheet) previews.push(['prom-qa-category-preview.png', { sheetName: 'Prom QA', range: 'A1:N15', scale: 1, format: 'png' }]);
for (const [name, options] of previews) {
  const image = await wb.render(options);
  await fs.writeFile(path.join(outputDir, name), new Uint8Array(await image.arrayBuffer()));
}
await fs.writeFile(path.join(outputDir, 'category-fix-qa-2026-09-02.json'), JSON.stringify({ checks, formulaErrors: formulaErrors.ndjson || '' }, null, 2), 'utf8');
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, checks, formulaErrors: formulaErrors.ndjson || '' }, null, 2));
