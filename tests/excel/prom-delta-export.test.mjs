import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import { exportPromDeltaWorkbook, buildPromDeltaRow, classifyPromColumns, PROM_COLUMN_CLASSES } from '../../src/excel/prom-delta-export.mjs';
import { createWorkbook, cleanupTempDir, fileHash, loadWorkbook, makeTempDir } from './support.mjs';

const headers = [
  'Код_товару', 'Назва_позиції', 'Назва_позиції_укр', 'Пошукові_запити', 'Пошукові_запити_укр',
  'Опис', 'Опис_укр', 'Тип_товару', 'Ціна', 'Валюта', 'Одиниця_виміру', 'Посилання_зображення',
  'Наявність', 'Номер_групи', 'Назва_групи', 'Посилання_підрозділу', 'Унікальний_ідентифікатор',
  'Ідентифікатор_товару', 'Ідентифікатор_підрозділу', 'Продукт_на_сайті', 'Виробник', 'Країна_виробник',
  'Назва_Характеристики', 'Одиниця_виміру_Характеристики', 'Значення_Характеристики',
  'Назва_Характеристики 2', 'Одиниця_виміру_Характеристики 2', 'Значення_Характеристики 2',
];

const template = {
  productSheet: {
    name: 'Export Products Sheet',
    headers,
    characteristicColumns: [
      { index: 0, columns: [22, 23, 24] },
      { index: 1, columns: [25, 26, 27] },
    ],
  },
  groupSheet: { name: 'Export Groups Sheet' },
};

function product() {
  const urls = [1, 2, 3, 4, 5].map((index) => `https://lh3.googleusercontent.com/d/drive-file-${index}=w1280`);
  return {
    productKey: 'ugopt:123',
    productCode: 'U123U',
    sellingPrice: 449,
    categoryId: 'g-99',
    categoryName: 'Техніка для дому',
    photoUrls: urls,
    characteristics: [{ name: 'Потужність', unit: null, value: '2200 Вт' }],
    physicalFields: {
      Назва_позиції: 'Фен для волосся VGR 2200 Вт чорний',
      Назва_позиції_укр: 'Фен для волосся VGR 2200 Вт чорний',
      Пошукові_запити: 'фен для волос поиск',
      Пошукові_запити_укр: 'фен для волосся',
      Опис: 'Описание товара',
      Опис_укр: 'Опис товару',
      Тип_товару: 'Фен',
      Валюта: 'UAH',
      Одиниця_виміру: 'шт.',
      Наявність: '+',
      Номер_групи: 99,
      Назва_групи: 'Техніка для дому',
      Посилання_підрозділу: 'https://prom.ua/tech',
    },
  };
}

async function sourceFixture(t) {
  const dir = await makeTempDir();
  t.after(() => cleanupTempDir(dir));
  const inputPath = path.join(dir, 'source.xlsx');
  const outputPath = path.join(dir, 'delta.xlsx');
  await createWorkbook(inputPath, [
    { name: 'Export Products Sheet', values: [headers, ['UOLDU', 'Старий товар', 'Старий товар', null, null, null, null, 'Фен', 100, 'UAH', 'шт.', null, '+', 1, 'Old', 'https://prom.ua/old', null, null, null, null, null, null, null, null, null, null, null, null], ['UOLD2U', 'Другий старий товар', 'Другий старий товар', null, null, null, null, 'Фен', 110, 'UAH', 'шт.', null, '+', 2, 'Old 2', 'https://prom.ua/old-2', null, null, null, null, null, null, null, null, null, null, null, null]] },
    { name: 'Export Groups Sheet', values: [['Номер_групи', 'Назва_групи'], [1, 'Old']] },
  ]);
  return { inputPath, outputPath };
}

test('classifies every physical template column without dropping unknown columns', () => {
  const policy = classifyPromColumns(headers);
  assert.equal(policy.length, headers.length);
  assert.equal(policy.find((item) => item.header === 'Код_товару').class, PROM_COLUMN_CLASSES.SOURCE_DERIVED);
  assert.equal(policy.find((item) => item.header === 'Назва_позиції').class, PROM_COLUMN_CLASSES.GENERATED);
  assert.equal(policy.find((item) => item.header === 'Назва_групи').class, PROM_COLUMN_CLASSES.CATEGORY_DERIVED);
  assert.equal(policy.find((item) => item.header === 'Унікальний_ідентифікатор').class, PROM_COLUMN_CLASSES.PROM_ASSIGNED_AFTER_IMPORT);
  assert.equal(policy.every((item) => Object.values(PROM_COLUMN_CLASSES).includes(item.class)), true);
});

test('writes a new delta row with exact width, category, pricing/media values and blank Prom-assigned IDs', () => {
  const row = buildPromDeltaRow(template, product());
  assert.equal(row.length, headers.length);
  assert.equal(row[0], 'U123U');
  assert.equal(row[8], 449);
  assert.equal(row[11], 'https://lh3.googleusercontent.com/d/drive-file-1=w1280, https://lh3.googleusercontent.com/d/drive-file-2=w1280, https://lh3.googleusercontent.com/d/drive-file-3=w1280, https://lh3.googleusercontent.com/d/drive-file-4=w1280, https://lh3.googleusercontent.com/d/drive-file-5=w1280');
  assert.equal(row[16], null);
  assert.equal(row[17], null);
  assert.equal(row[22], 'Потужність');
  assert.equal(row[24], '2200 Вт');
});

test('exports only the new delta rows, preserves the group sheet, and leaves the source workbook unchanged', async (t) => {
  const fixture = await sourceFixture(t);
  const sourceHash = await fileHash(fixture.inputPath);
  const result = await exportPromDeltaWorkbook({ inputPath: fixture.inputPath, outputPath: fixture.outputPath, products: [product()] });
  assert.equal(result.status, 'EXPORTED');
  assert.equal(result.products[0].status, 'EXPORTED');
  const workbook = await loadWorkbook(fixture.outputPath);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Export Products Sheet', 'Export Groups Sheet']);
  const sheet = workbook.getWorksheet('Export Products Sheet');
  assert.deepEqual(sheet.getSheetValues().slice(2).map((row) => row?.[1]), ['U123U']);
  assert.equal(sheet.getCell(2, 17).value, null);
  assert.equal(sheet.getCell(2, 18).value, null);
  assert.equal(workbook.getWorksheet('Export Groups Sheet').getCell(2, 2).value, 'Old');
  assert.equal(await fileHash(fixture.inputPath), sourceHash);
  assert.equal(result.validation.existingRowsExcluded, true);
});

test('does not create an Excel file when public media is unavailable', async (t) => {
  const fixture = await sourceFixture(t);
  const value = product();
  value.photoUrls = ['C:\\photos\\1.png'];
  const result = await exportPromDeltaWorkbook({ inputPath: fixture.inputPath, outputPath: fixture.outputPath, products: [value] });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.outputPath, null);
});


test('duplicate codes within one new batch fail without an output or false EXPORTED statuses', async (t) => {
  const fixture = await sourceFixture(t);
  const result = await exportPromDeltaWorkbook({ ...fixture, products: [product(), product()] });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.outputPath, null);
  assert.ok(result.products.every((item) => item.status !== 'EXPORTED'));
});

test('no ready products do not create a misleading header-only workbook', async (t) => {
  const fixture = await sourceFixture(t);
  const result = await exportPromDeltaWorkbook({ ...fixture, products: [] });
  assert.equal(result.status, 'NO_READY_PRODUCTS');
  assert.equal(result.outputPath, null);
});

test('required unit and positive numeric price are enforced before writing', () => {
  const missingUnit = product();
  delete missingUnit.physicalFields.Одиниця_виміру;
  assert.throws(() => buildPromDeltaRow(template, missingUnit), /Одиниця_виміру/u);
  assert.throws(() => buildPromDeltaRow(template, { ...product(), sellingPrice: 0 }), /positive number/u);
});
