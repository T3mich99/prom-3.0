import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import {
  buildExistingPromCatalogRegistry,
  buildPromProductCode,
  checkPromCatalogCode,
  inspectPromCatalogTemplate,
} from '../../src/excel/prom-catalog-registry.mjs';
import { createWorkbook, cleanupTempDir, makeTempDir } from './support.mjs';

const productHeaders = [
  'Код_товару', 'Назва_позиції', 'Назва_позиції_укр', 'Посилання_зображення',
  'Номер_групи', 'Назва_групи', 'Посилання_підрозділу', 'Унікальний_ідентифікатор',
  'Ідентифікатор_товару', 'Ідентифікатор_групи', 'Продукт_на_сайті',
  'Назва_Характеристики', 'Одиниця_виміру_Характеристики', 'Значення_Характеристики',
  'Назва_Характеристики 2', 'Одиниця_виміру_Характеристики 2', 'Значення_Характеристики 2',
];

const groupHeaders = ['Номер_групи', 'Назва_групи', 'Назва_групи_укр', 'Ідентифікатор_групи', 'Номер_батьківської_групи', 'Ідентифікатор_батьківської_групи'];

async function fixture(t) {
  const dir = await makeTempDir();
  t.after(() => cleanupTempDir(dir));
  const inputPath = path.join(dir, 'prom-export.xlsx');
  await createWorkbook(inputPath, [
    {
      name: 'Export Products Sheet',
      values: [
        productHeaders,
        ['U1U', 'Existing one', 'Наявний один', 'https://old/1.png', 10, 'Home', 'https://prom.ua/home', '100', 'p-1', 'g-10', 'https://prom.ua/p-1', 'Колір', null, 'білий'],
        ['U1U', 'Existing one', 'Наявний один', 'https://old/1.png', 10, 'Home', 'https://prom.ua/home', '100', 'p-1', 'g-10', 'https://prom.ua/p-1', 'Колір', null, 'білий'],
        ['U2U', 'Different title', 'Інша назва', 'https://old/2.png', 11, 'Kitchen', 'https://prom.ua/kitchen', '101', 'p-2', 'g-11', 'https://prom.ua/p-2'],
        [null, 'Blank code row', 'Рядок без коду'],
      ],
    },
    {
      name: 'Export Groups Sheet',
      values: [groupHeaders, [10, 'Home', 'Дім', 'g-10', null, null], [11, 'Kitchen', 'Кухня', 'g-11', null, null]],
    },
  ]);
  return inputPath;
}

test('audits the Prom workbook dynamically and builds a collision-aware registry', async (t) => {
  const inputPath = await fixture(t);
  const template = await inspectPromCatalogTemplate(inputPath);
  assert.equal(template.productSheet.columnCount, productHeaders.length);
  assert.equal(template.productSheet.rowCount, 4);
  assert.equal(template.productSheet.characteristicColumns.length, 2);
  assert.equal(template.groupSheet.rowCount, 2);

  const registry = await buildExistingPromCatalogRegistry(inputPath);
  assert.deepEqual(registry.summary, {
    physicalProductRows: 4,
    rowsWithCode: 3,
    rowsWithoutCode: 1,
    uniqueCodes: 2,
    collisionCodes: 1,
    collisionRows: 2,
    eligibleRegistrySize: 1,
  });
  assert.equal(registry.collisions[0].code, 'U1U');
  assert.equal(registry.collisions[0].kind, 'IDENTICAL');
  assert.equal(checkPromCatalogCode(registry, 'U1U').status, 'EXISTING_CODE_COLLISION');
  assert.equal(checkPromCatalogCode(registry, 'U2U').status, 'ALREADY_EXISTS');
  assert.equal(checkPromCatalogCode(registry, 'U3U').status, 'AVAILABLE');
});

test('supplier product codes use the stable outer-U form without rewriting the source identifier', () => {
  assert.equal(buildPromProductCode('123'), 'U123U');
  assert.equal(buildPromProductCode('U123U'), 'U123U');
  assert.equal(buildPromProductCode('VD-PB042'), 'UVD-PB042U');
  assert.equal(buildPromProductCode('UKC-200*80'), 'UUKC-200*80U');
  assert.throws(() => buildPromProductCode('12 3'), /whitespace/u);
});
