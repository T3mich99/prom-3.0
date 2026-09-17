import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { inspectWorkbook } from '../../src/excel/template-inspector.mjs';
import { fileHash, createWorkbook, makeTempDir, cleanupTempDir } from './support.mjs';

function productValues({ headerRow = 1, headers = ['Код_товару', 'Назва_позиції', 'Ціна', 'Невідоме'], rows = [['00123', 'Товар', 100, 'x']] } = {}) {
  return [...Array.from({ length: headerRow - 1 }, () => ['Інструкція']), headers, ...rows];
}

test('inspector reads a valid xlsx, identifies product sheet, and supports header row 1', async (t) => {
  const dir = await makeTempDir(); t.after(() => cleanupTempDir(dir));
  const file = path.join(dir, 'valid.xlsx');
  await createWorkbook(file, [
    { name: 'Reference', values: [['Ключ', 'Значення'], ['a', 'b']] },
    { name: 'Products', values: productValues() },
  ]);
  const before = await fileHash(file);
  const schema = await inspectWorkbook(file);
  assert.equal(schema.workbookType, 'xlsx');
  assert.deepEqual(schema.sheets.map((sheet) => sheet.name), ['Reference', 'Products']);
  assert.equal(schema.candidateProductSheets.length, 1);
  assert.equal(schema.candidateProductSheets[0].name, 'Products');
  assert.equal(schema.sheets[1].candidateHeaderRows[0].rowNumber, 1);
  assert.equal(await fileHash(file), before);
});

test('inspector discovers a header below title/instruction rows and preserves original headers', async (t) => {
  const dir = await makeTempDir(); t.after(() => cleanupTempDir(dir));
  const file = path.join(dir, 'below-header.xlsx');
  await createWorkbook(file, [{ name: 'Products', values: productValues({ headerRow: 3, headers: ['  КОД__ТОВАРУ  ', 'Назва_позиції', 'Ціна', 'Невідомий заголовок'] }) }]);
  const schema = await inspectWorkbook(file);
  const sheet = schema.sheets[0];
  const header = sheet.headerCandidates.find((candidate) => candidate.rowNumber === 3);
  assert.ok(header);
  assert.equal(header.columns[0].normalizedHeader, 'код товару');
  assert.equal(header.columns[0].originalHeader, '  КОД__ТОВАРУ  ');
  assert.equal(header.columns[3].kind, 'unknown');
});

test('service/reference worksheets do not automatically win product-sheet selection', async (t) => {
  const dir = await makeTempDir(); t.after(() => cleanupTempDir(dir));
  const file = path.join(dir, 'service.xlsx');
  await createWorkbook(file, [
    { name: '__Service', values: [['Код_товару', 'Назва_позиції', 'Ціна'], ['x', 'service', 1]] },
    { name: 'Products', values: productValues() },
  ]);
  const schema = await inspectWorkbook(file);
  assert.equal(schema.sheets[0].serviceLike, true);
  assert.deepEqual(schema.candidateProductSheets.map((sheet) => sheet.name), ['Products']);
});

test('ambiguous product worksheets are exposed without silently choosing the first', async (t) => {
  const dir = await makeTempDir(); t.after(() => cleanupTempDir(dir));
  const file = path.join(dir, 'ambiguous-sheets.xlsx');
  await createWorkbook(file, [
    { name: 'Products A', values: productValues() },
    { name: 'Products B', values: productValues() },
  ]);
  const schema = await inspectWorkbook(file);
  assert.equal(schema.candidateProductSheets.length, 2);
  assert.equal(schema.candidateProductSheets[0].score, schema.candidateProductSheets[1].score);
});

test('unsupported extensions are explicit and do not read as xlsx', async () => {
  const schema = await inspectWorkbook('template.xls');
  assert.equal(schema.workbookType, 'xls');
  assert.equal(schema.diagnostics[0].code, 'UNSUPPORTED_EXTENSION');
});

test('header-like rows, known aliases, and dynamic characteristic columns are structural only', async (t) => {
  const dir = await makeTempDir(); t.after(() => cleanupTempDir(dir));
  const file = path.join(dir, 'dynamic.xlsx');
  await createWorkbook(file, [{
    name: 'Products',
    values: productValues({ headers: ['Код_товару', 'Назва_позиції', 'Назва_Характеристики', 'Значення_Характеристики', 'Невідоме'] }),
  }]);
  const schema = await inspectWorkbook(file);
  const columns = schema.sheets[0].headerCandidates[0].columns;
  assert.equal(columns[2].kind, 'dynamicCharacteristic');
  assert.equal(columns[4].kind, 'unknown');
  assert.equal(columns[1].canonicalCandidates[0], 'titleRu');
});

test('repeated equally strong header rows remain ambiguous', async (t) => {
  const dir = await makeTempDir(); t.after(() => cleanupTempDir(dir));
  const file = path.join(dir, 'ambiguous-header.xlsx');
  await createWorkbook(file, [{ name: 'Products', values: [productValues()[0], productValues()[0], ['001', 'Товар', 100, 'x']] }]);
  const schema = await inspectWorkbook(file);
  assert.equal(schema.sheets[0].candidateHeaderRows.filter((row) => row.recognizedCount > 0).length, 2);
});
