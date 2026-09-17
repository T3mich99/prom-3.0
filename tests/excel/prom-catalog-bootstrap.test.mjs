import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

import {
  bootstrapPromCatalog,
  bootstrapPromCatalogFromMaster,
  confirmPromImportedBatch,
  confirmPromImportedProducts,
  getPromProductRegistry,
  loadPromBootstrap,
  reconcilePromCatalog,
  PROM_REGISTRY_STATES,
  PROM_BOOTSTRAP_STATUSES,
  PROM_RECONCILIATION_STATUSES,
  reservePromProductCode,
  updatePromProductRegistryState,
} from '../../src/excel/prom-catalog-bootstrap.mjs';
import { exportPromDeltaWorkbook } from '../../src/excel/prom-delta-export.mjs';
import { createWorkbook, cleanupTempDir, fileHash, loadWorkbook, makeTempDir } from './support.mjs';

const headers = [
  'Код_товару', 'Назва_позиції', 'Назва_позиції_укр', 'Пошукові_запити', 'Пошукові_запити_укр',
  'Опис', 'Опис_укр', 'Тип_товару', 'Ціна', 'Валюта', 'Одиниця_виміру', 'Посилання_зображення',
  'Наявність', 'Номер_групи', 'Назва_групи', 'Посилання_підрозділу', 'Унікальний_ідентифікатор',
  'Ідентифікатор_товару', 'Ідентифікатор_підрозділу', 'Продукт_на_сайті', 'Виробник', 'Країна_виробник',
  'Назва_Характеристики', 'Одиниця_виміру_Характеристики', 'Значення_Характеристики',
  'Назва_Характеристики 2', 'Одиниця_виміру_Характеристики 2', 'Значення_Характеристики 2',
];

const groupHeaders = [
  'Номер_групи', 'Назва_групи', 'Назва_групи_укр', 'Ідентифікатор_групи',
  'Номер_батьківської_групи', 'Ідентифікатор_батьківської_групи',
];

async function fixture(t) {
  const dir = await makeTempDir();
  t.after(() => cleanupTempDir(dir));
  const sourcePath = path.join(dir, 'prom-source.xlsx');
  const masterTemplatePath = path.join(dir, 'runtime', 'master-template.xlsx');
  const dbPath = path.join(dir, 'prom-registry.sqlite');
  await createWorkbook(sourcePath, [
    {
      name: 'Export Products Sheet',
      values: [
        headers,
        ['UOLDU', 'Old item', 'Старий товар', 'old', 'старий', 'Old description', 'Старий опис', 'Фен', 100, 'UAH', 'шт.', 'https://old/1.png', '+', 10, 'Home', 'https://prom.ua/home', 'old-id', 'old-product', null, 'https://prom.ua/old', 'AND', 'Китай', 'Потужність', null, '100 Вт'],
      ],
    },
    {
      name: 'Export Groups Sheet',
      values: [groupHeaders, [10, 'Home', 'Дім', 'g-10', null, null]],
    },
  ]);
  return { dir, sourcePath, masterTemplatePath, dbPath };
}

function newProduct() {
  return {
    productKey: 'ugopt:new-1',
    productCode: 'UNEW-1U',
    sellingPrice: 449,
    categoryId: 'g-99',
    categoryName: 'Техніка для дому',
    photoUrls: [1, 2, 3, 4, 5].map((index) => `https://lh3.googleusercontent.com/d/new-${index}=w1280`),
    characteristics: [{ name: 'Потужність', unit: null, value: '2200 Вт' }],
    physicalFields: {
      Назва_позиції: 'Фен для волосся 2200 Вт',
      Назва_позиції_укр: 'Фен для волосся 2200 Вт',
      Пошукові_запити: 'фен для волосся',
      Пошукові_запити_укр: 'фен для волосся',
      Опис: 'Опис товару',
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

function headersWithSlots(slotCount, totalColumnCount = 22 + slotCount * 3) {
  const fixed = headers.slice(0, 22);
  const fixedColumnCount = totalColumnCount - slotCount * 3;
  if (fixedColumnCount < fixed.length) throw new RangeError('totalColumnCount is smaller than the required fixed columns');
  const extraFixed = Array.from({ length: fixedColumnCount - fixed.length }, (_, index) => `Додаткове_поле_${index + 1}`);
  const slots = Array.from({ length: slotCount }, (_, index) => [
    index === 0 ? 'Назва_Характеристики' : `Назва_Характеристики ${index + 1}`,
    index === 0 ? 'Одиниця_виміру_Характеристики' : `Одиниця_виміру_Характеристики ${index + 1}`,
    index === 0 ? 'Значення_Характеристики' : `Значення_Характеристики ${index + 1}`,
  ]).flat();
  return [...fixed, ...extraFixed, ...slots];
}

function groupHeadersWithColumns(columnCount = groupHeaders.length) {
  if (columnCount < groupHeaders.length) throw new RangeError('columnCount is smaller than the required group columns');
  return [...groupHeaders, ...Array.from({ length: columnCount - groupHeaders.length }, (_, index) => `Додаткове_поле_групи_${index + 1}`)];
}

function productRowFor(headersValue, { code = 'UROWU', title = 'Товар', price = 100 } = {}) {
  const values = {
    Код_товару: code,
    Назва_позиції: title,
    Назва_позиції_укр: title,
    Тип_товару: 'Фен',
    Ціна: price,
    Валюта: 'UAH',
    Одиниця_виміру: 'шт.',
    Наявність: '+',
    Номер_групи: 10,
    Назва_групи: 'Home',
    Посилання_підрозділу: 'https://prom.ua/home',
    Виробник: 'AND',
    Країна_виробник: 'Китай',
  };
  return headersValue.map((header) => values[header] ?? null);
}

async function schemaVariant(t, variantHeaders, variantGroupHeaders = groupHeaders, rows = []) {
  const dir = await makeTempDir();
  t.after(() => cleanupTempDir(dir));
  const sourcePath = path.join(dir, 'variant.xlsx');
  await createWorkbook(sourcePath, [
    { name: 'Export Products Sheet', values: [variantHeaders, ...rows] },
    { name: 'Export Groups Sheet', values: [variantGroupHeaders] },
  ]);
  return sourcePath;
}

async function structuralFixture(t, slotCount = 19) {
  const dir = await makeTempDir();
  t.after(() => cleanupTempDir(dir));
  const sourcePath = path.join(dir, 'prom-source.xlsx');
  const masterTemplatePath = path.join(dir, 'runtime', 'master-template.xlsx');
  const dbPath = path.join(dir, 'prom-registry.sqlite');
  const productHeaders = headersWithSlots(slotCount, 108);
  const productValues = productRowFor(productHeaders, { code: 'USTRUCTUREU', title: 'Структурний товар' });
  await createWorkbook(sourcePath, [
    { name: 'Export Products Sheet', values: [productHeaders, productValues] },
    { name: 'Export Groups Sheet', values: [groupHeadersWithColumns(15), [10, 'Home', 'Дім', 'g-10', null, null]] },
  ]);
  const bootstrapped = await bootstrapPromCatalog({ sourcePath, masterTemplatePath, dbPath });
  return { dir, sourcePath, masterTemplatePath, dbPath, productHeaders, bootstrapped };
}

test('bootstraps the real Prom structure into a persistent master and registry', async (t) => {
  const paths = await fixture(t);
  const sourceHash = await fileHash(paths.sourcePath);
  const result = await bootstrapPromCatalog(paths);

  assert.equal(result.status, 'BOOTSTRAPPED');
  assert.equal(result.reused, false);
  assert.equal(result.binarySha256, sourceHash);
  assert.equal(await fileHash(paths.sourcePath), sourceHash);
  assert.equal(await fileHash(paths.masterTemplatePath), sourceHash);
  assert.equal(result.template.productSheet.headers.length, headers.length);
  assert.equal(result.columnPolicy.length, headers.length);
  assert.equal(result.characteristicMapping.capacity, 2);
  assert.deepEqual(result.characteristicMapping.slots[0].columns, [22, 23, 24]);
  assert.equal(result.groupMapping.sheetName, 'Export Groups Sheet');
  assert.equal(result.registry.summary.physicalProductRows, 1);
  assert.equal(result.registry.rows[0].status, PROM_REGISTRY_STATES.EXISTING_IN_PROM);

  const loaded = await loadPromBootstrap({ dbPath: paths.dbPath });
  assert.equal(loaded.bootstrapId, result.bootstrapId);
  assert.equal(loaded.schemaFingerprint, result.schemaFingerprint);
  assert.deepEqual(loaded.columnPolicy, result.columnPolicy);
  assert.equal(loaded.registry.rows[0].code, 'UOLDU');
  assert.equal(loaded.masterBinarySha256, sourceHash);

  const reused = await bootstrapPromCatalog(paths);
  assert.equal(reused.reused, true);
  assert.equal(reused.bootstrapId, result.bootstrapId);
});

test('persists reservation and import lifecycle states without changing existing rows', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const reserved = await reservePromProductCode({ dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId, batchId: 'batch-a', productKey: 'ugopt:new-1', productCode: 'UNEW-1U' });
  assert.equal(reserved.status, PROM_REGISTRY_STATES.RESERVED_FOR_IMPORT);
  const duplicate = await reservePromProductCode({ dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId, productKey: 'ugopt:other', productCode: 'UNEW-1U' });
  assert.equal(duplicate.status, PROM_REGISTRY_STATES.ALREADY_RESERVED);

  const secondReserved = await reservePromProductCode({ dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId, batchId: 'batch-b', productKey: 'ugopt:new-2', productCode: 'UNEW-2U' });
  assert.equal(secondReserved.status, PROM_REGISTRY_STATES.RESERVED_FOR_IMPORT);
  const subsetConfirmed = await confirmPromImportedProducts({
    dbPath: paths.dbPath,
    bootstrapId: bootstrapped.bootstrapId,
    registryIds: [reserved.registryId],
  });
  assert.deepEqual(subsetConfirmed.registryIds, [reserved.registryId]);
  const batchConfirmed = await confirmPromImportedBatch({ dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId, batchId: 'batch-b' });
  assert.equal(batchConfirmed.confirmedCount, 1);

  const confirmed = await updatePromProductRegistryState({
    dbPath: paths.dbPath,
    bootstrapId: bootstrapped.bootstrapId,
    productCode: 'UNEW-1U',
    status: PROM_REGISTRY_STATES.CONFIRMED_IN_PROM,
    payload: { productId: 'prom-new-1', sourceUrl: 'https://prom.ua/new-1' },
  });
  assert.equal(confirmed.status, PROM_REGISTRY_STATES.CONFIRMED_IN_PROM);
  const registry = await getPromProductRegistry({ dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId });
  assert.equal(registry.rows.find((row) => row.code === 'UNEW-1U').status, PROM_REGISTRY_STATES.CONFIRMED_IN_PROM);
  assert.equal(registry.rows.find((row) => row.code === 'UNEW-2U').status, PROM_REGISTRY_STATES.CONFIRMED_IN_PROM);
  assert.equal(registry.rows.find((row) => row.code === 'UOLDU').status, PROM_REGISTRY_STATES.EXISTING_IN_PROM);
});

test('delta export can use the persisted master and registry without the source XLSX', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const outputPath = path.join(paths.dir, 'delta.xlsx');
  const result = await exportPromDeltaWorkbook({ bootstrapDbPath: paths.dbPath, outputPath, products: [newProduct()] });
  assert.equal(result.status, 'EXPORTED');
  assert.equal(result.registrySummary.physicalProductRows, 1);
  const workbook = await loadWorkbook(outputPath);
  assert.deepEqual(workbook.getWorksheet('Export Products Sheet').getSheetValues().slice(2).map((row) => row?.[1]), ['UNEW-1U']);
  assert.equal(workbook.getWorksheet('Export Groups Sheet').getCell(2, 2).value, 'Home');
});

test('retains explicit import failure and review states for operator follow-up', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const failed = await reservePromProductCode({ dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId, productCode: 'UFAILED-1U' });
  const review = await reservePromProductCode({ dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId, productCode: 'UREVIEW-1U' });
  await updatePromProductRegistryState({ dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId, registryId: failed.registryId, status: PROM_REGISTRY_STATES.IMPORT_FAILED });
  await updatePromProductRegistryState({ dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId, registryId: review.registryId, status: PROM_REGISTRY_STATES.IMPORT_REVIEW });
  const registry = await getPromProductRegistry({ dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId });
  assert.equal(registry.rows.find((row) => row.code === 'UFAILED-1U').status, PROM_REGISTRY_STATES.IMPORT_FAILED);
  assert.equal(registry.rows.find((row) => row.code === 'UREVIEW-1U').status, PROM_REGISTRY_STATES.IMPORT_REVIEW);
});

test('can recover from the approved master without the original source workbook', async (t) => {
  const paths = await fixture(t);
  const masterOnlyDb = path.join(paths.dir, 'master-only.sqlite');
  await bootstrapPromCatalog({ ...paths, dbPath: path.join(paths.dir, 'initial.sqlite') });
  await fs.rm(paths.sourcePath);
  const recovered = await bootstrapPromCatalogFromMaster({ masterTemplatePath: paths.masterTemplatePath, dbPath: masterOnlyDb });
  assert.equal(recovered.status, PROM_BOOTSTRAP_STATUSES.BOOTSTRAPPED);
  assert.equal(recovered.registry.rows[0].code, 'UOLDU');
  const loaded = await loadPromBootstrap({ dbPath: masterOnlyDb });
  assert.equal(loaded.masterTemplatePath, paths.masterTemplatePath);
  assert.equal(loaded.binarySha256, loaded.masterBinarySha256);
});

test('detects external products, missing products, and collisions without mutating the registry', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const freshPath = path.join(paths.dir, 'fresh-prom-export.xlsx');
  await createWorkbook(freshPath, [
    {
      name: 'Export Products Sheet',
      values: [
        headers,
        ['UOLDU', 'Old item', 'Старий товар', 'old', 'старий', 'Old description', 'Старий опис', 'Фен', 100, 'UAH', 'шт.', 'https://old/1.png', '+', 10, 'Home', 'https://prom.ua/home', 'old-id', 'old-product', null, 'https://prom.ua/old', 'AND', 'Китай', 'Потужність', null, '100 Вт'],
        ['UEXTERNALU', 'External item', 'Зовнішній товар', 'external', 'зовнішній', 'External description', 'Зовнішній опис', 'Фен', 200, 'UAH', 'шт.', 'https://external/1.png', '+', 10, 'Home', 'https://prom.ua/home', 'external-id', 'external-product', null, 'https://prom.ua/external', 'AND', 'Китай', 'Потужність', null, '200 Вт'],
        ['UEXTERNALU', 'External item copy', 'Копія зовнішнього товару', 'external', 'зовнішній', 'External description', 'Зовнішній опис', 'Фен', 200, 'UAH', 'шт.', 'https://external/2.png', '+', 10, 'Home', 'https://prom.ua/home', 'external-id-2', 'external-product-2', null, 'https://prom.ua/external-2', 'AND', 'Китай', 'Потужність', null, '200 Вт'],
      ],
    },
    { name: 'Export Groups Sheet', values: [groupHeaders, [10, 'Home', 'Дім', 'g-10', null, null]] },
  ]);
  const result = await reconcilePromCatalog({ sourcePath: freshPath, dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId });
  assert.equal(result.status, PROM_RECONCILIATION_STATUSES.COLLISIONS_FOUND);
  assert.equal(result.externalProducts.some((item) => item.code === 'UEXTERNALU'), true);
  assert.equal(result.missingProducts.length, 0);
  assert.equal(result.collisions[0].code, 'UEXTERNALU');
  assert.equal(result.registryUpdated, false);
  assert.equal(result.destructiveChangesApplied, false);
});

test('reports a missing persisted product when a fresh export omits it', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const freshPath = path.join(paths.dir, 'fresh-without-old.xlsx');
  await createWorkbook(freshPath, [
    { name: 'Export Products Sheet', values: [headers] },
    { name: 'Export Groups Sheet', values: [groupHeaders, [10, 'Home', 'Дім', 'g-10', null, null]] },
  ]);
  const result = await reconcilePromCatalog({ sourcePath: freshPath, dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId });
  assert.equal(result.status, PROM_RECONCILIATION_STATUSES.MISSING_PRODUCTS_FOUND);
  assert.deepEqual(result.missingProducts.map((item) => item.code), ['UOLDU']);
  assert.equal(result.schema.changed, false);
});

test('detects a changed product/group schema and never replaces the approved master', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const beforeMasterHash = await fileHash(paths.masterTemplatePath);
  const changedPath = path.join(paths.dir, 'changed-schema.xlsx');
  await createWorkbook(changedPath, [
    { name: 'Export Products Sheet', values: [['Назва_позиції', ...headers.filter((header) => header !== 'Назва_позиції')], ['Changed', ...Array(headers.length - 1).fill(null)]] },
    { name: 'Export Groups Sheet', values: [groupHeaders, [10, 'Home', 'Дім', 'g-10', null, null]] },
  ]);
  const result = await bootstrapPromCatalog({ sourcePath: changedPath, masterTemplatePath: paths.masterTemplatePath, dbPath: paths.dbPath });
  assert.equal(result.status, PROM_BOOTSTRAP_STATUSES.TEMPLATE_SCHEMA_CHANGED);
  assert.equal(result.masterReplaced, false);
  assert.equal(await fileHash(paths.masterTemplatePath), beforeMasterHash);
});

test('[A] keeps the structural fingerprint stable when cell values change', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const changedRowsPath = await schemaVariant(t, headers, groupHeaders, [
    productRowFor(headers, { code: 'UOLDU', title: 'Оновлений товар', price: 999 }),
  ]);
  const result = await reconcilePromCatalog({ sourcePath: changedRowsPath, dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId });
  assert.equal(result.schema.changed, false);
  assert.equal(result.schema.expectedFingerprint, bootstrapped.schemaFingerprintV2);
  assert.equal(result.schema.actualFingerprint, bootstrapped.schemaFingerprintV2);
  assert.notEqual(result.schema.legacyActualFingerprint, bootstrapped.schemaFingerprintV1);
  assert.equal(result.binaries.changed, true);
});

test('[B] treats added product rows as data changes, not schema changes', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const addedRowPath = await schemaVariant(t, headers, groupHeaders, [
    productRowFor(headers, { code: 'UOLDU', title: 'Старий товар' }),
    productRowFor(headers, { code: 'UNEWU', title: 'Новий товар' }),
  ]);
  const result = await reconcilePromCatalog({ sourcePath: addedRowPath, dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId });
  assert.equal(result.status, PROM_RECONCILIATION_STATUSES.EXTERNAL_PRODUCTS_FOUND);
  assert.equal(result.externalProducts.map((item) => item.code).join(','), 'UNEWU');
  assert.equal(result.schema.changed, false);
});

test('[C] treats removed product rows as data changes, not schema changes', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const removedRowsPath = await schemaVariant(t, headers, groupHeaders, []);
  const result = await reconcilePromCatalog({ sourcePath: removedRowsPath, dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId });
  assert.equal(result.status, PROM_RECONCILIATION_STATUSES.MISSING_PRODUCTS_FOUND);
  assert.deepEqual(result.missingProducts.map((item) => item.code), ['UOLDU']);
  assert.equal(result.schema.changed, false);
});

test('[D] reports added and removed physical columns as a template schema change', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const changedHeaders = [...headers.slice(0, -1), 'Нове_поле'];
  const changedPath = await schemaVariant(t, changedHeaders, groupHeaders, [productRowFor(changedHeaders)]);
  const result = await reconcilePromCatalog({ sourcePath: changedPath, dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId });
  assert.equal(result.status, PROM_RECONCILIATION_STATUSES.TEMPLATE_SCHEMA_CHANGED);
  assert.deepEqual(result.schema.diff.addedColumns, ['Нове_поле']);
  assert.deepEqual(result.schema.diff.removedColumns, ['Значення_Характеристики 2']);
});

test('[E] reports a renamed physical column as a template schema change', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const changedHeaders = headers.map((header) => header === 'Країна_виробник' ? 'Країна_походження' : header);
  const changedPath = await schemaVariant(t, changedHeaders, groupHeaders, [productRowFor(changedHeaders)]);
  const result = await reconcilePromCatalog({ sourcePath: changedPath, dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId });
  assert.equal(result.status, PROM_RECONCILIATION_STATUSES.TEMPLATE_SCHEMA_CHANGED);
  assert.deepEqual(result.schema.diff.renamedColumns, [{ index: 21, from: 'Країна_виробник', to: 'Країна_походження' }]);
});

test('[F] reports reordered physical columns as a template schema change', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const changedHeaders = [...headers];
  [changedHeaders[1], changedHeaders[2]] = [changedHeaders[2], changedHeaders[1]];
  const changedPath = await schemaVariant(t, changedHeaders, groupHeaders, [productRowFor(changedHeaders)]);
  const result = await reconcilePromCatalog({ sourcePath: changedPath, dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId });
  assert.equal(result.status, PROM_RECONCILIATION_STATUSES.TEMPLATE_SCHEMA_CHANGED);
  assert.equal(result.schema.diff.reorderedColumns, true);
  assert.deepEqual(result.schema.diff.renamedColumns, []);
});

test('[G] detects a characteristic capacity decrease from 19 to 18 slots', async (t) => {
  const paths = await structuralFixture(t, 19);
  const changedPath = await schemaVariant(t, headersWithSlots(18, 108), groupHeadersWithColumns(15), [productRowFor(headersWithSlots(18, 108))]);
  const result = await reconcilePromCatalog({ sourcePath: changedPath, dbPath: paths.dbPath, bootstrapId: paths.bootstrapped.bootstrapId });
  assert.equal(result.status, PROM_RECONCILIATION_STATUSES.TEMPLATE_SCHEMA_CHANGED);
  assert.equal(result.schema.diff.characteristicCapacityChanged, true);
});

test('[H] detects a characteristic capacity increase from 19 to 20 slots', async (t) => {
  const paths = await structuralFixture(t, 19);
  const changedHeaders = headersWithSlots(20, 108);
  const changedPath = await schemaVariant(t, changedHeaders, groupHeadersWithColumns(15), [productRowFor(changedHeaders)]);
  const result = await reconcilePromCatalog({ sourcePath: changedPath, dbPath: paths.dbPath, bootstrapId: paths.bootstrapped.bootstrapId });
  assert.equal(result.status, PROM_RECONCILIATION_STATUSES.TEMPLATE_SCHEMA_CHANGED);
  assert.equal(result.schema.diff.characteristicCapacityChanged, true);
});

test('[I] detects a changed Export Groups Sheet header', async (t) => {
  const paths = await structuralFixture(t, 19);
  const changedGroupHeaders = groupHeadersWithColumns(15);
  changedGroupHeaders[14] = 'Нове_поле_групи';
  const changedPath = await schemaVariant(t, paths.productHeaders, changedGroupHeaders, [productRowFor(paths.productHeaders)]);
  const result = await reconcilePromCatalog({ sourcePath: changedPath, dbPath: paths.dbPath, bootstrapId: paths.bootstrapped.bootstrapId });
  assert.equal(result.status, PROM_RECONCILIATION_STATUSES.TEMPLATE_SCHEMA_CHANGED);
  assert.equal(result.schema.diff.groupSheetChanged, true);
  assert.deepEqual(result.schema.diff.addedColumns, []);
});

test('[J] preserves legacy V1 and restores V2 for legacy-only persisted state after reopen', async (t) => {
  const paths = await fixture(t);
  const bootstrapped = await bootstrapPromCatalog(paths);
  const db = new DatabaseSync(paths.dbPath);
  db.prepare("UPDATE prom_bootstrap_catalog SET structural_schema_fingerprint = '' WHERE bootstrap_id = ?").run(bootstrapped.bootstrapId);
  db.close();
  const loaded = await loadPromBootstrap({ dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId });
  const reopened = await loadPromBootstrap({ dbPath: paths.dbPath, bootstrapId: bootstrapped.bootstrapId });
  assert.equal(loaded.legacySchemaFingerprint, bootstrapped.schemaFingerprintV1);
  assert.equal(loaded.schemaFingerprintV1, bootstrapped.schemaFingerprintV1);
  assert.equal(loaded.schemaFingerprintV2, bootstrapped.schemaFingerprintV2);
  assert.equal(reopened.legacySchemaFingerprint, bootstrapped.schemaFingerprintV1);
  assert.equal(reopened.schemaFingerprintV1, bootstrapped.schemaFingerprintV1);
  assert.equal(reopened.schemaFingerprintV2, bootstrapped.schemaFingerprintV2);
});

test('[K] keeps binary SHA, legacy V1, and structural V2 as separate fingerprints', async (t) => {
  const paths = await fixture(t);
  const result = await bootstrapPromCatalog(paths);
  assert.equal(result.binarySha256, await fileHash(paths.sourcePath));
  assert.notEqual(result.binarySha256, result.schemaFingerprintV1);
  assert.notEqual(result.binarySha256, result.schemaFingerprintV2);
  assert.equal(result.schemaFingerprint, result.schemaFingerprintV1);
  assert.equal(result.templateFingerprint, result.schemaFingerprintV1);
});

test('[L] exports exactly 100 new rows with the full 108-column and 19-slot physical structure', async (t) => {
  const paths = await structuralFixture(t, 19);
  const outputPath = path.join(paths.dir, 'delta-100.xlsx');
  const products = Array.from({ length: 100 }, (_, index) => ({
    ...newProduct(),
    productKey: `ugopt:new-${index + 1}`,
    productCode: `UNEW-${index + 1}U`,
  }));
  const result = await exportPromDeltaWorkbook({ bootstrapDbPath: paths.dbPath, outputPath, products });
  assert.equal(result.status, 'EXPORTED');
  assert.equal(result.products.length, 100);
  const workbook = await loadWorkbook(outputPath);
  const productSheet = workbook.getWorksheet('Export Products Sheet');
  const groupSheet = workbook.getWorksheet('Export Groups Sheet');
  const productRows = productSheet.getSheetValues();
  assert.equal(productRows[1].slice(1).length, 108);
  assert.equal(productRows.length - 2, 100);
  assert.deepEqual(productRows.slice(2).map((row) => row[1]), products.map((item) => item.productCode));
  assert.equal(groupSheet.getRow(1).values.length, 16);
  assert.equal(paths.bootstrapped.template.productSheet.characteristicColumns.length, 19);
});
