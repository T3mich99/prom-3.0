import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { inspectWorkbook } from '../../src/excel/template-inspector.mjs';
import { mapTemplateSchema } from '../../src/excel/schema-mapper.mjs';
import { AdaptiveWriterError, writeAdaptiveWorkbook } from '../../src/excel/adaptive-writer.mjs';
import { createWorkbook, fileHash, loadWorkbook, makeTempDir, cleanupTempDir } from './support.mjs';

async function productFixture(t, definition = {}) {
  const dir = await makeTempDir(); t.after(() => cleanupTempDir(dir));
  const inputPath = path.join(dir, 'input.xlsx');
  await createWorkbook(inputPath, [{
    name: 'Reference',
    values: [['Ключ', 'Значение'], ['ref', 'keep']],
  }, {
    name: 'Products',
    values: definition.values ?? [['Код_товару', 'Назва_позиції', 'Ціна', 'Ідентифікатор_товару'], ['old', 'Old', 10, 'U000U']],
    startRow: definition.startRow,
    startColumn: definition.startColumn,
    formulas: definition.formulas,
    merged: definition.merged,
    validations: definition.validations,
  }]);
  const schema = await inspectWorkbook(inputPath);
  const mapping = mapTemplateSchema(schema, definition.mappingOptions);
  return { dir, inputPath, mapping };
}

test('writer refuses non-SAFE mappings and inputPath === outputPath', async (t) => {
  const fixture = await productFixture(t);
  await assert.rejects(
    writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath: fixture.inputPath, mapping: fixture.mapping, rows: [] }),
    (error) => error instanceof AdaptiveWriterError && error.code === 'SAME_INPUT_OUTPUT',
  );
  await assert.rejects(
    writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath: path.join(fixture.dir, 'out.xlsx'), mapping: { status: 'NEEDS_MAPPING' }, rows: [] }),
    (error) => error instanceof AdaptiveWriterError && error.code === 'MAPPING_NOT_SAFE',
  );
});

test('rejects a Windows case-only input/output path variant', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows path identity regression');
    return;
  }
  const fixture = await productFixture(t);
  await assert.rejects(
    writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath: fixture.inputPath.toUpperCase(), mapping: fixture.mapping, rows: [] }),
    (error) => error instanceof AdaptiveWriterError && error.code === 'SAME_INPUT_OUTPUT',
  );
});

test('writer creates a separate copy, preserves sheets/order/header, and writes exact values', async (t) => {
  const fixture = await productFixture(t);
  const outputPath = path.join(fixture.dir, 'output.xlsx');
  const before = await fileHash(fixture.inputPath);
  const result = await writeAdaptiveWorkbook({
    inputPath: fixture.inputPath,
    outputPath,
    mapping: fixture.mapping,
    rows: [{ titleRu: 'Новый товар', price: 125, productId: 'U00123U' }, { titleRu: 'Второй товар', price: 250, productId: 'U00456U' }],
  });
  assert.equal(result.startRow, 3);
  assert.deepEqual(result.validation, { outputExists: true, worksheetsPreserved: true, headerPreserved: true, valuesReadable: true, rowCount: 2, inputHashUnchanged: true });
  assert.equal(await fileHash(fixture.inputPath), before);
  const output = await loadWorkbook(outputPath);
  assert.deepEqual(output.worksheets.map((sheet) => sheet.name), ['Reference', 'Products']);
  const products = output.getWorksheet('Products');
  assert.equal(products.getCell(3, 2).value, 'Новый товар');
  assert.equal(products.getCell(3, 3).value, 125);
  assert.equal(products.getCell(4, 4).value, 'U00456U');
  assert.equal(products.getCell(1, 2).value, 'Назва_позиції');
});

test('undefined optional fields are left untouched and numeric/string primitive types are preserved', async (t) => {
  const fixture = await productFixture(t);
  const outputPath = path.join(fixture.dir, 'optional.xlsx');
  await writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath, mapping: fixture.mapping, rows: [{ titleRu: 'Текст', price: 99, productId: '0000123' }] });
  const output = await loadWorkbook(outputPath);
  const products = output.getWorksheet('Products');
  assert.equal(products.getCell(3, 3).value, 99);
  assert.equal(products.getCell(3, 4).value, '0000123');
  assert.equal(products.getCell(3, 1).value, null);
});

test('unknown row keys and unsupported write modes are rejected', async (t) => {
  const fixture = await productFixture(t);
  const outputPath = path.join(fixture.dir, 'bad.xlsx');
  await assert.rejects(writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath, mapping: fixture.mapping, rows: [{ titelUa: 'typo' }] }), /Unknown row-record key/u);
  await assert.rejects(writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath, mapping: fixture.mapping, rows: [], mode: 'writeRows' }), /appendRows/u);
});

test('formula-bearing mapped targets are not overwritten automatically', async (t) => {
  const fixture = await productFixture(t, {
    values: [['Код_товару', 'Назва_позиції', 'Ціна'], ['old', 'Old', 10]],
    formulas: { C2: '=1+1' },
  });
  await assert.rejects(
    writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath: path.join(fixture.dir, 'formula.xlsx'), mapping: fixture.mapping, rows: [{ titleRu: 'New', price: 20 }] }),
    (error) => error instanceof AdaptiveWriterError && error.code === 'FORMULA_TARGET_UNSAFE',
  );
});

test('appendRows uses absolute used-range coordinates after leading empty rows', async (t) => {
  const fixture = await productFixture(t, {
    startRow: 10,
    values: [
      ['Код_товару', 'Назва_позиції', 'Ціна', 'Ідентифікатор_товару'],
      ['old-1', 'Old 1', 10, 'U001U'],
      ['old-2', 'Old 2', 20, 'U002U'],
      ['old-3', 'Old 3', 30, 'U003U'],
      ['old-4', 'Old 4', 40, 'U004U'],
      ['old-5', 'Old 5', 50, 'U005U'],
    ],
  });
  assert.equal(fixture.mapping.headerRow, 10);
  const outputPath = path.join(fixture.dir, 'leading-empty-rows.xlsx');
  const result = await writeAdaptiveWorkbook({
    inputPath: fixture.inputPath,
    outputPath,
    mapping: fixture.mapping,
    rows: [{ titleRu: 'New 1', price: 60 }, { titleRu: 'New 2', price: 70 }],
  });
  assert.equal(result.startRow, 16);
  const output = await loadWorkbook(outputPath);
  const products = output.getWorksheet('Products');
  assert.equal(products.getCell(11, 2).value, 'Old 1');
  assert.equal(products.getCell(15, 2).value, 'Old 5');
  assert.equal(products.getCell(16, 2).value, 'New 1');
  assert.equal(products.getCell(17, 2).value, 'New 2');
  assert.equal(products.getCell(16, 3).value, 60);
  assert.equal(products.getCell(17, 3).value, 70);
});

test('formula scan uses absolute used-range coordinates below row 1', async (t) => {
  const fixture = await productFixture(t, {
    startRow: 10,
    values: [
      ['Код_товару', 'Назва_позиції', 'Ціна'],
      ['old', 'Old', 10],
      ['formula', 'Formula row', 20],
    ],
    formulas: { C12: '=1+1' },
  });
  await assert.rejects(
    writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath: path.join(fixture.dir, 'absolute-formula.xlsx'), mapping: fixture.mapping, rows: [{ titleRu: 'New', price: 30 }] }),
    (error) => error instanceof AdaptiveWriterError && error.code === 'FORMULA_TARGET_UNSAFE' && error.details.rowNumber === 12,
  );
});

test('merged non-anchor target cells are rejected without unmerging', async (t) => {
  const fixture = await productFixture(t, {
    values: [['Код_товару', 'Назва_позиції', 'Ціна', 'Ціна резервна']],
    merged: ['C2:D2'],
    mappingOptions: { columns: { price: 'D' } },
  });
  await assert.rejects(
    writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath: path.join(fixture.dir, 'merged.xlsx'), mapping: fixture.mapping, rows: [{ price: 20 }] }),
    (error) => error instanceof AdaptiveWriterError && error.code === 'MERGED_CELL_CONFLICT',
  );
});

test('merged anchor target cells are rejected without unmerging', async (t) => {
  const fixture = await productFixture(t, {
    values: [['Код_товару', 'Назва_позиції', 'Ціна', 'Ціна резервна']],
    merged: ['C2:D2'],
    mappingOptions: { columns: { price: 'C' } },
  });
  await assert.rejects(
    writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath: path.join(fixture.dir, 'merged-anchor.xlsx'), mapping: fixture.mapping, rows: [{ price: 20 }] }),
    (error) => error instanceof AdaptiveWriterError && error.code === 'MERGED_CELL_CONFLICT',
  );
});

test('round-trip preserves unrelated sheet and validation structure when library supports it', async (t) => {
  const fixture = await productFixture(t, {
    validations: [{ address: 'A2:A20', validation: { rule: { type: 'list', values: ['+', '-'] } } }],
  });
  const outputPath = path.join(fixture.dir, 'validation.xlsx');
  await writeAdaptiveWorkbook({ inputPath: fixture.inputPath, outputPath, mapping: fixture.mapping, rows: [{ titleRu: 'Validated', price: 33 }] });
  const output = await loadWorkbook(outputPath);
  assert.deepEqual(output.getWorksheet('Reference').getRow(1).values.slice(1, 3), ['Ключ', 'Значение']);
  const validationModel = output.getWorksheet('Products').dataValidations.model;
  assert.ok(validationModel.A2);
  assert.ok(validationModel.A20);
});

test('ExcelJS round-trip preserves hidden sheets, formulas, merges, dimensions, styles, and validation', async (t) => {
  const dir = await makeTempDir(); t.after(() => cleanupTempDir(dir));
  const inputPath = path.join(dir, 'fidelity-input.xlsx');
  const outputPath = path.join(dir, 'fidelity-output.xlsx');
  await createWorkbook(inputPath, [{
    name: 'Reference',
    state: 'hidden',
    values: [['Ключ', 'Значение'], ['ref', 'keep']],
  }, {
    name: 'Products',
    startRow: 10,
    values: [
      ['Код_товару', 'Назва_позиції', 'Ціна', 'Ідентифікатор_товару'],
      ['old-1', 'Old 1', 10, 'U001U'],
      ['old-2', 'Old 2', 20, 'U002U'],
      ['old-3', 'Old 3', 30, 'U003U'],
      ['old-4', 'Old 4', 40, 'U004U'],
      ['old-5', 'Old 5', 50, 'U005U'],
    ],
    formulas: { E12: { formula: '=1+1', result: 2 } },
    merged: ['D13:E13'],
    columnWidths: { 2: 22 },
    rowHeights: { 10: 30 },
    styles: { B10: { font: { bold: true, color: { argb: 'FFFF0000' } } } },
    validations: [{ address: 'A11:A20', validation: { rule: { type: 'list', values: ['+', '-'] } } }],
  }]);
  const before = await fileHash(inputPath);
  const schema = await inspectWorkbook(inputPath);
  const mapping = mapTemplateSchema(schema);
  await writeAdaptiveWorkbook({ inputPath, outputPath, mapping, rows: [{ titleRu: 'New', price: 60 }] });
  const output = await loadWorkbook(outputPath);
  assert.deepEqual(output.worksheets.map((sheet) => sheet.name), ['Reference', 'Products']);
  assert.equal(output.getWorksheet('Reference').state, 'hidden');
  const products = output.getWorksheet('Products');
  assert.equal(products.getCell(16, 2).value, 'New');
  assert.equal(products.getCell(16, 3).value, 60);
  assert.equal(products.getCell(12, 5).formula, '=1+1');
  assert.ok(products._merges.D13);
  assert.equal(products.getColumn(2).width, 22);
  assert.equal(products.getRow(10).height, 30);
  assert.equal(products.getCell(10, 2).font.bold, true);
  assert.equal(products.getCell(10, 2).font.color.argb, 'FFFF0000');
  assert.ok(products.dataValidations.model.A11);
  assert.ok(products.dataValidations.model.A20);
  assert.equal(await fileHash(inputPath), before);
});
