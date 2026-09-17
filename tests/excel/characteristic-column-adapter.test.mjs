import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { generateContentArtifact } from '../../src/content/content-generation-adapter.mjs';
import { buildCharacteristicColumnPlan } from '../../src/excel/characteristic-column-adapter.mjs';
import { buildContentExcelRow } from '../../src/excel/content-row-adapter.mjs';
import { inspectWorkbook } from '../../src/excel/template-inspector.mjs';
import { mapTemplateSchema } from '../../src/excel/schema-mapper.mjs';
import { AdaptiveWriterError, writeAdaptiveWorkbook } from '../../src/excel/adaptive-writer.mjs';
import { createWorkbook, fileHash, loadWorkbook, makeTempDir, cleanupTempDir } from './support.mjs';

function keywordsAtLength(length) {
  const terms = Array.from({ length: 25 }, (_, index) => `пошукова фраза товару ${index + 1}`);
  const base = terms.join(', ');
  assert.ok(base.length <= length);
  return `${base}${'x'.repeat(length - base.length)}`;
}

function longText(prefix) {
  return Array.from({ length: 45 }, (_, index) => `${prefix} пояснює перевагу та спосіб використання номер ${index + 1}`).join(' ');
}

function artifact(characteristics = [
  { name: 'Потужність', value: '2200 Вт' },
  { name: 'Колір', value: 'чорний' },
], overrides = {}) {
  return {
    productKey: 'ugopt:characteristics-1',
    version: 1,
    content: {
      title: { ru: 'Фен для волос', ua: 'Фен для волосся' },
      description: { ru: longText('Описание товара'), ua: longText('Опис товару') },
      keywords: { ru: keywordsAtLength(800), ua: keywordsAtLength(800) },
      characteristics,
    },
    sourceFacts: { power: '2200 Вт', color: 'чорний' },
    ...overrides,
  };
}

function selectedProduct(productKey) {
  return {
    selectionKey: productKey,
    product: { supplierSku: productKey.split(':').at(-1) },
  };
}

function response(content) {
  return { content };
}

function validGeneratedContent() {
  return {
    title: { ru: 'Фен для волос', ua: 'Фен для волосся' },
    description: { ru: longText('Описание товара'), ua: longText('Опис товару') },
    keywords: { ru: keywordsAtLength(800), ua: keywordsAtLength(800) },
    characteristics: [
      { name: 'Потужність', value: '2200 Вт' },
      { name: 'Колір', value: 'чорний' },
    ],
  };
}

function slotHeaders(language = 'ua', count = 2) {
  const roles = language === 'ru'
    ? ['Название_характеристики', 'Единица_измерения_характеристики', 'Значение_характеристики']
    : ['Назва_Характеристики', 'Одиниця_виміру_Характеристики', 'Значення_Характеристики'];
  return Array.from({ length: count }, (_, index) => roles.map((header) => {
    if (language === 'ru' && index > 0) return `${header}_${index + 1}`;
    return header;
  })).flat();
}

function writerHeaders() {
  return [
    'Код_товару', 'Назва_позиції', 'Назва_позиції_укр', 'Опис', 'Опис_укр',
    'Пошукові_запити', 'Пошукові_запити_укр', 'Ціна', 'Виробник',
    'Одиниця_виміру', 'Посилання_зображення', 'Ідентифікатор_групи',
    'Назва_групи', 'Унікальний_ідентифікатор', 'Ідентифікатор_товару',
    'Валюта', 'Наявність', ...slotHeaders('ua', 2),
  ];
}

async function templateFixture(t, {
  headers = ['Код_товару', 'Назва_позиції', ...slotHeaders()],
  rows = [['old-code', 'Старий товар', ...Array(headers.length - 2).fill(null)]],
  startRow = 1,
  startColumn = 1,
  formulas,
  merged,
} = {}) {
  const dir = await makeTempDir();
  t.after(() => cleanupTempDir(dir));
  const inputPath = path.join(dir, 'input.xlsx');
  await createWorkbook(inputPath, [{
    name: 'Reference',
    values: [['Ключ', 'Значення'], ['keep', 'yes']],
  }, {
    name: 'Products',
    values: [headers, ...rows],
    startRow,
    startColumn,
    formulas,
    merged,
  }]);
  const schema = await inspectWorkbook(inputPath);
  const mapping = mapTemplateSchema(schema);
  return { dir, inputPath, mapping, schema };
}

test('audited repeated characteristic triples are detected and mapped in artifact order', async (t) => {
  const fixture = await templateFixture(t);
  const columns = fixture.mapping.dynamicCharacteristicColumns;
  assert.equal(columns.length, 6);
  assert.deepEqual(columns.slice(0, 3).map((column) => column.originalHeader), slotHeaders().slice(0, 3));
  const plan = buildCharacteristicColumnPlan({ contentArtifact: artifact(), mapping: fixture.mapping });
  assert.equal(plan.status, 'SAFE');
  assert.equal(plan.unitHandling, 'leave-unwritten');
  assert.deepEqual(plan.mappedCharacteristics, [
    { characteristicIndex: 0, slotIndex: 0, name: 'Потужність', value: '2200 Вт', nameColumnIndex: 2, valueColumnIndex: 4 },
    { characteristicIndex: 1, slotIndex: 1, name: 'Колір', value: 'чорний', nameColumnIndex: 5, valueColumnIndex: 7 },
  ]);
  assert.deepEqual(plan.writes.map(({ characteristicIndex, role, value, columnIndex }) => ({ characteristicIndex, role, value, columnIndex })), [
    { characteristicIndex: 0, role: 'name', value: 'Потужність', columnIndex: 2 },
    { characteristicIndex: 0, role: 'value', value: '2200 Вт', columnIndex: 4 },
    { characteristicIndex: 1, role: 'name', value: 'Колір', columnIndex: 5 },
    { characteristicIndex: 1, role: 'value', value: 'чорний', columnIndex: 7 },
  ]);
});

test('Russian indexed characteristic triples are supported without semantic matching', async (t) => {
  const fixture = await templateFixture(t, { headers: ['Код_товару', 'Назва_позиції', ...slotHeaders('ru', 2)] });
  const plan = buildCharacteristicColumnPlan({ contentArtifact: artifact(), mapping: fixture.mapping });
  assert.equal(plan.status, 'SAFE');
  assert.deepEqual(plan.writes.map((write) => write.columnIndex), [2, 4, 5, 7]);
  assert.equal(plan.writes.some((write) => write.originalHeader.endsWith('_2')), true);
});

test('READY is required and REVIEW or REWORK produce no writable characteristic plan', async (t) => {
  const fixture = await templateFixture(t);
  const reviewArtifact = artifact();
  delete reviewArtifact.content.characteristics;
  const review = buildCharacteristicColumnPlan({ contentArtifact: reviewArtifact, mapping: fixture.mapping });
  assert.equal(review.status, 'REVIEW');
  assert.deepEqual(review.writes, []);

  const reworkArtifact = artifact();
  reworkArtifact.content.title = { ru: '', ua: '' };
  const rework = buildCharacteristicColumnPlan({ contentArtifact: reworkArtifact, mapping: fixture.mapping });
  assert.equal(rework.status, 'REWORK');
  assert.deepEqual(rework.writes, []);
});

test('exact names and values, including formatting, are preserved and order is not changed', async (t) => {
  const fixture = await templateFixture(t);
  const characteristics = [
    { name: '  Код  ', value: '0005' },
    { name: 'Діапазон', value: '10,5 мм' },
  ];
  const before = structuredClone(characteristics);
  const plan = buildCharacteristicColumnPlan({ contentArtifact: artifact(characteristics), mapping: fixture.mapping });
  assert.deepEqual(plan.mappedCharacteristics.map(({ name, value }) => ({ name, value })), characteristics);
  assert.deepEqual(plan.writes.map((write) => write.value), ['  Код  ', '0005', 'Діапазон', '10,5 мм']);
  assert.deepEqual(characteristics, before);
});

test('plans are deterministic and do not mutate artifact or mapping', async (t) => {
  const fixture = await templateFixture(t);
  const inputArtifact = artifact();
  const beforeArtifact = structuredClone(inputArtifact);
  const beforeMapping = structuredClone(fixture.mapping);
  const first = buildCharacteristicColumnPlan({ contentArtifact: inputArtifact, mapping: fixture.mapping });
  const second = buildCharacteristicColumnPlan({ contentArtifact: inputArtifact, mapping: fixture.mapping });
  assert.deepEqual(first, second);
  assert.deepEqual(inputArtifact, beforeArtifact);
  assert.deepEqual(fixture.mapping, beforeMapping);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'timestamp'), false);
});

test('zero characteristic columns are UNSUPPORTED and named property columns are not guessed', async (t) => {
  const noColumns = await templateFixture(t, { headers: ['Код_товару', 'Назва_позиції', 'Ціна'] });
  const noColumnPlan = buildCharacteristicColumnPlan({ contentArtifact: artifact(), mapping: noColumns.mapping });
  assert.equal(noColumnPlan.status, 'UNSUPPORTED');
  assert.equal(noColumnPlan.diagnostics[0].code, 'NO_CHARACTERISTIC_COLUMNS');

  const named = await templateFixture(t, { headers: ['Код_товару', 'Назва_позиції', 'Потужність', 'Колір'] });
  const namedPlan = buildCharacteristicColumnPlan({ contentArtifact: artifact(), mapping: named.mapping });
  assert.equal(namedPlan.status, 'UNSUPPORTED');
  assert.deepEqual(namedPlan.writes, []);
});

test('zero characteristics remain blocked by the existing Content Quality REVIEW result', async (t) => {
  const fixture = await templateFixture(t);
  const plan = buildCharacteristicColumnPlan({ contentArtifact: artifact([]), mapping: fixture.mapping });
  assert.equal(plan.status, 'REVIEW');
  assert.equal(plan.diagnostics[0].code, 'CONTENT_NOT_READY');
  assert.deepEqual(plan.writes, []);
});

test('incomplete, out-of-order, duplicate, and normalization-collision slots are never guessed', async (t) => {
  const incomplete = await templateFixture(t, { headers: ['Код_товару', 'Назва_позиції', 'Назва_Характеристики', 'Значення_Характеристики'] });
  assert.equal(buildCharacteristicColumnPlan({ contentArtifact: artifact(), mapping: incomplete.mapping }).status, 'UNSUPPORTED');

  const outOfOrder = await templateFixture(t, { headers: ['Код_товару', 'Назва_позиції', 'Назва_Характеристики', 'Значення_Характеристики', 'Одиниця_виміру_Характеристики'] });
  assert.equal(buildCharacteristicColumnPlan({ contentArtifact: artifact(), mapping: outOfOrder.mapping }).status, 'NEEDS_MAPPING');

  const collision = await templateFixture(t, { headers: ['Код_товару', 'Назва_позиції', 'Назва_Характеристики', 'Назва Характеристики', 'Одиниця_виміру_Характеристики', 'Значення_Характеристики'] });
  const collisionPlan = buildCharacteristicColumnPlan({ contentArtifact: artifact(), mapping: collision.mapping });
  assert.equal(collisionPlan.status, 'NEEDS_MAPPING');
  assert.equal(collisionPlan.diagnostics[0].code, 'AMBIGUOUS_CHARACTERISTIC_SLOT');
});

test('insufficient capacity lists every excess characteristic and does not emit partial writes', async (t) => {
  const fixture = await templateFixture(t, { headers: ['Код_товару', 'Назва_позиції', ...slotHeaders('ua', 1)] });
  const plan = buildCharacteristicColumnPlan({ contentArtifact: artifact([
    { name: 'A', value: '1' },
    { name: 'B', value: '2' },
  ]), mapping: fixture.mapping });
  assert.equal(plan.status, 'NEEDS_MAPPING');
  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.unresolvedCharacteristics, [{ characteristicIndex: 1, name: 'B', value: '2', reason: 'INSUFFICIENT_CHARACTERISTIC_CAPACITY' }]);
});

test('canonical columns remain separate from dynamic characteristic targets', async (t) => {
  const fixture = await templateFixture(t);
  const plan = buildCharacteristicColumnPlan({ contentArtifact: artifact(), mapping: fixture.mapping });
  const canonicalIndexes = new Set(fixture.mapping.mappings.map((item) => item.columnIndex));
  assert.equal(plan.writes.every((write) => !canonicalIndexes.has(write.columnIndex)), true);
  assert.equal(plan.writes.every((write) => write.columnIndex >= 2), true);
});

test('writer aligns characteristic sidecars with canonical rows and preserves extra capacity', async (t) => {
  const fixture = await templateFixture(t, {
    headers: ['Код_товару', 'Назва_позиції', ...slotHeaders('ua', 2)],
    rows: [['old-code', 'Старий товар', ...Array(6).fill(null)]],
  });
  const first = artifact([{ name: 'Потужність', value: '2200 Вт' }], { productKey: 'ugopt:first' });
  const second = artifact([{ name: 'Потужність', value: '1800 Вт' }], { productKey: 'ugopt:second' });
  const firstRow = { titleRu: 'Перший товар' };
  const secondRow = { titleRu: 'Другий товар' };
  const firstPlan = buildCharacteristicColumnPlan({ contentArtifact: first, mapping: fixture.mapping });
  const secondPlan = buildCharacteristicColumnPlan({ contentArtifact: second, mapping: fixture.mapping });
  const beforeRows = structuredClone([firstRow, secondRow]);
  const beforePlans = structuredClone([firstPlan, secondPlan]);
  const outputPath = path.join(fixture.dir, 'output.xlsx');
  const before = await fileHash(fixture.inputPath);
  const result = await writeAdaptiveWorkbook({
    inputPath: fixture.inputPath,
    outputPath,
    mapping: fixture.mapping,
    rows: [firstRow, secondRow],
    characteristicPlans: [firstPlan, secondPlan],
  });
  assert.equal(result.startRow, 3);
  assert.equal(result.validation.characteristicRowCount, 2);
  const output = await loadWorkbook(outputPath);
  assert.deepEqual(output.worksheets.map((sheet) => sheet.name), ['Reference', 'Products']);
  const sheet = output.getWorksheet('Products');
  assert.equal(sheet.getCell(2, 2).value, 'Старий товар');
  assert.equal(sheet.getCell(3, 2).value, firstRow.titleRu);
  assert.equal(sheet.getCell(3, 3).value, 'Потужність');
  assert.equal(sheet.getCell(3, 4).value, null);
  assert.equal(sheet.getCell(3, 5).value, '2200 Вт');
  assert.equal(sheet.getCell(4, 3).value, 'Потужність');
  assert.equal(sheet.getCell(4, 5).value, '1800 Вт');
  assert.equal(sheet.getCell(3, 6).value, null);
  assert.deepEqual([firstRow, secondRow], beforeRows);
  assert.deepEqual([firstPlan, secondPlan], beforePlans);
  assert.equal(await fileHash(fixture.inputPath), before);
});

test('unit cells remain untouched and a pre-existing would-be row is never overwritten', async (t) => {
  const headers = ['Код_товару', 'Назва_позиції', ...slotHeaders('ua', 1)];
  const fixture = await templateFixture(t, {
    headers,
    rows: [
      ['old-code', 'Старий товар', ...Array(3).fill(null)],
      [null, null, null, 'TEMPLATE UNIT', null, null],
    ],
  });
  const value = artifact([{ name: 'Потужність', value: '2200 Вт' }]);
  const plan = buildCharacteristicColumnPlan({ contentArtifact: value, mapping: fixture.mapping });
  const outputPath = path.join(fixture.dir, 'unit-preserved.xlsx');
  const row = { titleRu: 'Новий товар' };
  const result = await writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath, mapping: fixture.mapping, rows: [row], characteristicPlans: [plan] });
  assert.equal(result.startRow, 4);
  const output = await loadWorkbook(outputPath);
  const sheet = output.getWorksheet('Products');
  assert.equal(sheet.getCell(3, 4).value, 'TEMPLATE UNIT');
  assert.equal(sheet.getCell(4, 3).value, 'Потужність');
  assert.equal(sheet.getCell(4, 4).value, null);
  assert.equal(sheet.getCell(4, 5).value, '2200 Вт');
});

test('leading rows and offset columns retain absolute dynamic write coordinates', async (t) => {
  const fixture = await templateFixture(t, {
    headers: ['Код_товару', 'Назва_позиції', ...slotHeaders('ru', 2)],
    rows: [['old-code', 'Старий товар', ...Array(6).fill(null)]],
    startRow: 10,
    startColumn: 3,
  });
  const value = artifact([{ name: 'Потужність', value: '2200 Вт' }]);
  const row = { titleRu: 'Товар зі зміщенням' };
  const plan = buildCharacteristicColumnPlan({ contentArtifact: value, mapping: fixture.mapping });
  await writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath: path.join(fixture.dir, 'offset.xlsx'), mapping: fixture.mapping, rows: [row], characteristicPlans: [plan] });
  const output = await loadWorkbook(path.join(fixture.dir, 'offset.xlsx'));
  const sheet = output.getWorksheet('Products');
  assert.equal(fixture.mapping.headerRow, 10);
  assert.equal(fixture.mapping.dynamicCharacteristicColumns[0].columnIndex, 4);
  assert.equal(sheet.getCell(12, 5).value, 'Потужність');
  assert.equal(sheet.getCell(12, 7).value, '2200 Вт');
});

test('dynamic formula targets are rejected conservatively', async (t) => {
  const fixture = await templateFixture(t, {
    formulas: { E2: '=1+1' },
  });
  const value = artifact([{ name: 'Потужність', value: '2200 Вт' }]);
  const row = { titleRu: 'Товар з формулою' };
  const plan = buildCharacteristicColumnPlan({ contentArtifact: value, mapping: fixture.mapping });
  await assert.rejects(
    writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath: path.join(fixture.dir, 'formula.xlsx'), mapping: fixture.mapping, rows: [row], characteristicPlans: [plan] }),
    (error) => error instanceof AdaptiveWriterError && error.code === 'FORMULA_TARGET_UNSAFE',
  );
});

test('dynamic anchor and non-anchor merged targets are rejected', async (t) => {
  const value = artifact([{ name: 'Потужність', value: '2200 Вт' }]);
  const row = { titleRu: 'Товар з обʼєднанням' };
  const anchorFixture = await templateFixture(t, { merged: ['C3:D3'] });
  const anchorPlan = buildCharacteristicColumnPlan({ contentArtifact: value, mapping: anchorFixture.mapping });
  await assert.rejects(
    writeAdaptiveWorkbook({ inputPath: anchorFixture.inputPath, outputPath: path.join(anchorFixture.dir, 'merged-anchor.xlsx'), mapping: anchorFixture.mapping, rows: [row], characteristicPlans: [anchorPlan] }),
    (error) => error instanceof AdaptiveWriterError && error.code === 'MERGED_CELL_CONFLICT',
  );

  const nonAnchorFixture = await templateFixture(t, { merged: ['C3:D3'] });
  const nonAnchorPlan = buildCharacteristicColumnPlan({ contentArtifact: value, mapping: nonAnchorFixture.mapping });
  nonAnchorPlan.writes[0].columnIndex = 3;
  nonAnchorPlan.writes[0].columnLetter = 'D';
  nonAnchorPlan.writes[0].originalHeader = nonAnchorFixture.mapping.dynamicCharacteristicColumns[1].originalHeader;
  await assert.rejects(
    writeAdaptiveWorkbook({ inputPath: nonAnchorFixture.inputPath, outputPath: path.join(nonAnchorFixture.dir, 'merged-non-anchor.xlsx'), mapping: nonAnchorFixture.mapping, rows: [row], characteristicPlans: [nonAnchorPlan] }),
    (error) => error instanceof AdaptiveWriterError && error.code === 'MERGED_CELL_CONFLICT',
  );
});

test('duplicate characteristic targets and sidecar row counts are rejected', async (t) => {
  const fixture = await templateFixture(t);
  const value = artifact([{ name: 'Потужність', value: '2200 Вт' }]);
  const row = { titleRu: 'Товар з дубльованою ціллю' };
  const plan = buildCharacteristicColumnPlan({ contentArtifact: value, mapping: fixture.mapping });
  plan.writes[1].columnIndex = plan.writes[0].columnIndex;
  plan.writes[1].columnLetter = plan.writes[0].columnLetter;
  plan.writes[1].originalHeader = plan.writes[0].originalHeader;
  await assert.rejects(
    writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath: path.join(fixture.dir, 'duplicate.xlsx'), mapping: fixture.mapping, rows: [row], characteristicPlans: [plan] }),
    (error) => error instanceof AdaptiveWriterError && error.code === 'CHARACTERISTIC_TARGET_CONFLICT',
  );
  await assert.rejects(
    writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath: path.join(fixture.dir, 'count.xlsx'), mapping: fixture.mapping, rows: [row], characteristicPlans: [] }),
    (error) => error instanceof AdaptiveWriterError && error.code === 'CHARACTERISTIC_ROWS_MISMATCH',
  );
});

test('verified generation flows through Content Row Adapter, characteristic plan, and XLSX reload', async (t) => {
  const headers = writerHeaders();
  const fixture = await templateFixture(t, {
    headers,
    rows: [['old-code', 'Старий товар', ...Array(headers.length - 2).fill(null)]],
  });
  const input = {
    productKey: 'ugopt:generated-1',
    sourceFacts: { power: '2200 Вт', color: 'чорний' },
  };
  const generated = await generateContentArtifact(input, {
    generator: async () => response(validGeneratedContent()),
  });
  assert.equal(generated.status, 'READY');
  const rowResult = buildContentExcelRow({ selectedProduct: selectedProduct(input.productKey), contentArtifact: generated.artifact });
  const plan = buildCharacteristicColumnPlan({ contentArtifact: generated.artifact, mapping: fixture.mapping });
  assert.equal(rowResult.status, 'READY');
  assert.equal(plan.status, 'SAFE');
  await writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath: path.join(fixture.dir, 'generated.xlsx'), mapping: fixture.mapping, rows: [rowResult.row], characteristicPlans: [plan] });
  const output = await loadWorkbook(path.join(fixture.dir, 'generated.xlsx'));
  const sheet = output.getWorksheet('Products');
  assert.equal(sheet.getCell(3, 2).value, generated.artifact.content.title.ru);
  assert.equal(sheet.getCell(3, 18).value, 'Потужність');
  assert.equal(sheet.getCell(3, 20).value, '2200 Вт');
  assert.equal(sheet.getCell(3, 21).value, 'Колір');
  assert.equal(sheet.getCell(3, 23).value, 'чорний');
});
