import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { CANONICAL_FIELDS } from '../../src/excel/schema-mapper.mjs';
import { buildContentExcelRow, ContentExcelRowAdapterError } from '../../src/excel/content-row-adapter.mjs';
import { inspectWorkbook } from '../../src/excel/template-inspector.mjs';
import { mapTemplateSchema } from '../../src/excel/schema-mapper.mjs';
import { writeAdaptiveWorkbook } from '../../src/excel/adaptive-writer.mjs';
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

function artifact(overrides = {}) {
  return {
    productKey: 'ugopt:F-001',
    version: 1,
    content: {
      title: { ru: 'Фен для волос', ua: 'Фен для волосся' },
      description: { ru: longText('Описание товара'), ua: longText('Опис товару') },
      keywords: { ru: keywordsAtLength(800), ua: keywordsAtLength(800) },
      characteristics: [{ name: 'Мощность', value: '2200 Вт' }],
    },
    sourceFacts: { power: '2200 Вт' },
    ...overrides,
  };
}

function selectedProduct(selectionKey = 'ugopt:F-001', product = { supplierSku: 'F-001' }) {
  return {
    requestKey: 'hair-dryers',
    requestedCategory: 'Фени',
    resolvedCategory: { source: 'ug-opt', sourceCategoryName: 'Фени' },
    selectionKey,
    product,
  };
}

function readyInput(overrides = {}) {
  return {
    selectedProduct: selectedProduct(),
    contentArtifact: artifact(),
    ...overrides,
  };
}

test('maps READY bilingual content exactly and emits only canonical fields in canonical order', () => {
  const result = buildContentExcelRow(readyInput(), {
    policy: { description: { minimumVisibleCharacters: 1000 } },
  });
  assert.equal(result.status, 'READY');
  assert.equal(result.row.titleRu, 'Фен для волос');
  assert.equal(result.row.titleUa, 'Фен для волосся');
  assert.equal(result.row.descriptionRu, readyInput().contentArtifact.content.description.ru);
  assert.equal(result.row.descriptionUa, readyInput().contentArtifact.content.description.ua);
  assert.equal(result.row.keywordsRu, readyInput().contentArtifact.content.keywords.ru);
  assert.equal(result.row.keywordsUa, readyInput().contentArtifact.content.keywords.ua);
  assert.deepEqual(Object.keys(result.row), ['titleRu', 'titleUa', 'descriptionRu', 'descriptionUa', 'keywordsRu', 'keywordsUa']);
  assert.equal(Object.keys(result.row).every((key) => CANONICAL_FIELDS.includes(key)), true);
});

test('preserves exact content strings without normalization or translation', () => {
  const value = artifact();
  value.content.title = { ru: 'Фен для волос — 2200 Вт', ua: 'Фен для волосся 2200 Вт' };
  value.content.description = { ru: `${'x'.repeat(1000)}  `, ua: `${'у'.repeat(1000)}  ` };
  value.content.keywords = { ru: keywordsAtLength(800), ua: keywordsAtLength(800) };
  const result = buildContentExcelRow({ selectedProduct: selectedProduct(), contentArtifact: value });
  assert.equal(result.status, 'READY');
  assert.equal(result.row.titleRu, 'Фен для волос — 2200 Вт');
  assert.equal(result.row.titleUa, 'Фен для волосся 2200 Вт');
  assert.equal(result.row.descriptionRu, `${'x'.repeat(1000)}  `);
});

test('requires exact selected-product and content-artifact identity', () => {
  assert.throws(
    () => buildContentExcelRow(readyInput({ selectedProduct: selectedProduct('ugopt:F-002') })),
    (error) => error instanceof ContentExcelRowAdapterError
      && error.code === 'PRODUCT_IDENTITY_MISMATCH'
      && error.details.selectionKey === 'ugopt:F-002'
      && error.details.productKey === 'ugopt:F-001',
  );
});

test('REVIEW content is blocked and preserves the quality result', () => {
  const value = artifact();
  delete value.content.characteristics;
  const result = buildContentExcelRow({ selectedProduct: selectedProduct(), contentArtifact: value });
  assert.equal(result.status, 'REVIEW');
  assert.equal(result.row, null);
  assert.equal(result.quality.fields.characteristics.status, 'REVIEW');
  assert.deepEqual(result.quality.reworkPlan, { fields: [] });
});

test('REWORK content is blocked and preserves the field-level rework plan', () => {
  const value = artifact();
  value.content.title = { ru: '', ua: '' };
  const result = buildContentExcelRow({ selectedProduct: selectedProduct(), contentArtifact: value });
  assert.equal(result.status, 'REWORK');
  assert.equal(result.row, null);
  assert.deepEqual(result.quality.reworkPlan.fields, [{ field: 'title', reasonCodes: ['TITLE_MISSING'] }]);
});

test('characteristics are explicitly deferred instead of silently discarded', () => {
  const result = buildContentExcelRow(readyInput());
  assert.deepEqual(result.deferredFields, [{ field: 'characteristics', reason: 'NO_CANONICAL_EXCEL_TARGET' }]);
  assert.equal(Object.prototype.hasOwnProperty.call(result.row, 'characteristics'), false);
});

test('supplier price never leaks into canonical selling price and approved photos are not assumed', () => {
  const result = buildContentExcelRow({
    ...readyInput({
      selectedProduct: selectedProduct('ugopt:F-001', {
        supplierSku: 'F-001',
        price: 230,
        sourceImageUrl: 'https://example.invalid/source.png',
      }),
    }),
    resolvedMetadata: {
      price: 230,
      photoUrls: 'https://example.invalid/generated.png',
    },
  });
  assert.equal(result.row.price, undefined);
  assert.equal(result.row.photoUrls, undefined);
  assert.deepEqual(result.deferredFields, [
    { field: 'characteristics', reason: 'NO_CANONICAL_EXCEL_TARGET' },
    { field: 'price', reason: 'NO_PROVEN_FINAL_SELLING_PRICE' },
    { field: 'photoUrls', reason: 'NO_PROVEN_APPROVED_MEDIA' },
  ]);
});

test('does not infer a Prom category from supplier category metadata', () => {
  const result = buildContentExcelRow(readyInput());
  assert.equal(result.row.categoryId, undefined);
  assert.equal(result.row.categoryName, undefined);
  const withResolvedPromCategory = buildContentExcelRow({
    ...readyInput(),
    resolvedMetadata: { categoryId: '611', categoryName: 'Соковижималки' },
  });
  assert.equal(withResolvedPromCategory.row.categoryId, '611');
  assert.equal(withResolvedPromCategory.row.categoryName, 'Соковижималки');
});

test('passes explicit resolved metadata without defaults and preserves leading-zero identifiers', () => {
  const result = buildContentExcelRow({
    ...readyInput(),
    resolvedMetadata: {
      productCode: '0000123',
      productId: 'P-0000123',
      manufacturer: 'AND',
      availability: true,
      currency: 'UAH',
    },
  });
  assert.equal(result.row.productCode, '0000123');
  assert.equal(result.row.productId, 'P-0000123');
  assert.equal(result.row.manufacturer, 'AND');
  assert.equal(result.row.availability, true);
  assert.equal(result.row.currency, 'UAH');
  assert.equal(result.row.unit, undefined);
  assert.deepEqual(result.provenance.resolvedMetadataFields, ['productCode', 'manufacturer', 'productId', 'currency', 'availability']);
});

test('rejects unknown metadata and content-field overrides', () => {
  assert.throws(() => buildContentExcelRow({ ...readyInput(), resolvedMetadata: { typo: 'x' } }), /Unknown resolved metadata field/u);
  assert.throws(() => buildContentExcelRow({ ...readyInput(), resolvedMetadata: { titleRu: 'other' } }), /cannot override content field/u);
});

test('does not mutate inputs and repeated invocation is deterministic', () => {
  const input = readyInput({ resolvedMetadata: { productCode: '0000123', manufacturer: 'AND' } });
  const before = structuredClone(input);
  const options = { policy: { description: { minimumVisibleCharacters: 1000 } } };
  const policyBefore = structuredClone(options.policy);
  const first = buildContentExcelRow(input, options);
  const second = buildContentExcelRow(input, options);
  assert.deepEqual(input, before);
  assert.deepEqual(options.policy, policyBefore);
  assert.deepEqual(first, second);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'timestamp'), false);
});

test('READY row crosses the Adaptive Writer boundary and survives XLSX reload', async (t) => {
  const dir = await makeTempDir(); t.after(() => cleanupTempDir(dir));
  const inputPath = path.join(dir, 'input.xlsx');
  const outputPath = path.join(dir, 'output.xlsx');
  await createWorkbook(inputPath, [{
    name: 'Products',
    values: [[
      'Код_товару', 'Назва_позиції', 'Назва_позиції_укр', 'Опис', 'Опис_укр',
      'Пошукові_запити', 'Пошукові_запити_укр',
    ], ['old', 'Old', 'Старий', 'old description', 'старий опис', 'old keywords', 'старі ключові слова']],
  }]);
  const before = await fileHash(inputPath);
  const rowResult = buildContentExcelRow({
    ...readyInput(),
    resolvedMetadata: { productCode: '0000123' },
  });
  assert.equal(rowResult.status, 'READY');
  const mapping = mapTemplateSchema(await inspectWorkbook(inputPath));
  assert.equal(mapping.status, 'SAFE');
  await writeAdaptiveWorkbook({ inputPath, outputPath, mapping, rows: [rowResult.row] });
  const output = await loadWorkbook(outputPath);
  const sheet = output.getWorksheet('Products');
  assert.equal(sheet.getCell(3, 1).value, '0000123');
  assert.equal(sheet.getCell(3, 2).value, rowResult.row.titleRu);
  assert.equal(sheet.getCell(3, 3).value, rowResult.row.titleUa);
  assert.equal(sheet.getCell(3, 4).value, rowResult.row.descriptionRu);
  assert.equal(sheet.getCell(3, 5).value, rowResult.row.descriptionUa);
  assert.equal(sheet.getCell(3, 6).value, rowResult.row.keywordsRu);
  assert.equal(sheet.getCell(3, 7).value, rowResult.row.keywordsUa);
  assert.equal(await fileHash(inputPath), before);
});
