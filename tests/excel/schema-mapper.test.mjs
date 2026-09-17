import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { inspectWorkbook } from '../../src/excel/template-inspector.mjs';
import {
  ALIAS_REGISTRY,
  CANONICAL_FIELDS,
  mapTemplateSchema,
} from '../../src/excel/schema-mapper.mjs';
import { createWorkbook, makeTempDir, cleanupTempDir } from './support.mjs';

async function schemaFor(t, values, name = 'Products') {
  const dir = await makeTempDir(); t.after(() => cleanupTempDir(dir));
  const file = path.join(dir, 'mapping.xlsx');
  await createWorkbook(file, [{ name, values }]);
  return inspectWorkbook(file);
}

test('exact aliases map safely, unknown headers remain unmapped, and optional fields do not block SAFE', async (t) => {
  const schema = await schemaFor(t, [['Код_товару', 'Назва_позиції', 'Невідоме'], ['00123', 'Товар', 'x']]);
  const result = mapTemplateSchema(schema);
  assert.equal(result.status, 'SAFE');
  assert.equal(result.mappings.find((item) => item.canonicalField === 'titleRu').confidence, 'exact-alias');
  assert.ok(result.unmappedOptionalFields.includes('manufacturer'));
  assert.equal(schema.sheets[0].headerCandidates[0].columns[2].kind, 'unknown');
});

test('missing required canonical field prevents SAFE', async (t) => {
  const schema = await schemaFor(t, [['Ціна', 'Невідоме'], [100, 'x']]);
  const result = mapTemplateSchema(schema);
  assert.equal(result.status, 'NEEDS_MAPPING');
  assert.deepEqual(result.unmappedRequiredFields, ['titleRu']);
});

test('two physical columns matching one canonical field require mapping', async (t) => {
  const schema = await schemaFor(t, [['Назва_позиції', 'Назва позиції', 'Ціна'], ['a', 'b', 100]]);
  const result = mapTemplateSchema(schema);
  assert.equal(result.status, 'NEEDS_MAPPING');
  assert.equal(result.ambiguousMappings.some((item) => item.canonicalField === 'titleRu'), true);
});

test('ambiguous sheets and ambiguous header rows return NEEDS_MAPPING', async (t) => {
  const sheetSchema = await schemaFor(t, [['Код_товару', 'Назва_позиції', 'Ціна'], ['1', 'a', 1]], 'Products');
  sheetSchema.candidateProductSheets.push({ ...sheetSchema.candidateProductSheets[0], name: 'Products 2', index: 1 });
  const sheetResult = mapTemplateSchema(sheetSchema);
  assert.equal(sheetResult.status, 'NEEDS_MAPPING');
  const headerSchema = await schemaFor(t, [['Код_товару', 'Назва_позиції', 'Ціна'], ['Код_товару', 'Назва_позиції', 'Ціна'], ['1', 'a', 1]]);
  const headerResult = mapTemplateSchema(headerSchema);
  assert.equal(headerResult.status, 'NEEDS_MAPPING');
  assert.equal(headerResult.diagnostics[0].code, 'AMBIGUOUS_HEADER_ROW');
});

test('ambiguous selling-price labels never auto-select a price column', async (t) => {
  const schema = await schemaFor(t, [['Код_товару', 'Назва_позиції', 'Ціна закупівлі', 'Ціна продажу', 'РРЦ'], ['1', 'Товар', 10, 20, 25]]);
  const result = mapTemplateSchema(schema);
  assert.equal(result.status, 'NEEDS_MAPPING');
  assert.equal(result.mappings.some((item) => item.canonicalField === 'price'), false);
  assert.equal(result.ambiguousMappings.find((item) => item.canonicalField === 'price').reason.includes('exact selling-price alias'), true);
});

test('explicit price mapping resolves the ambiguous price without changing price logic', async (t) => {
  const schema = await schemaFor(t, [['Код_товару', 'Назва_позиції', 'Ціна закупівлі', 'Ціна продажу', 'РРЦ'], ['1', 'Товар', 10, 20, 25]]);
  const result = mapTemplateSchema(schema, { columns: { price: 'Ціна продажу' } });
  assert.equal(result.status, 'SAFE');
  assert.deepEqual(result.mappings.find((item) => item.canonicalField === 'price'), {
    canonicalField: 'price', columnIndex: 3, columnLetter: 'D', originalHeader: 'Ціна продажу', confidence: 'explicit-user-mapping', status: 'mapped',
  });
});

test('explicit mapping overrides automatic mapping and validates bad keys/targets', async (t) => {
  const schema = await schemaFor(t, [['Код_товару', 'Назва_позиції', 'Ціна'], ['1', 'Товар', 20]]);
  assert.equal(mapTemplateSchema(schema, { columns: { price: 'C' } }).mappings.find((item) => item.canonicalField === 'price').confidence, 'explicit-user-mapping');
  assert.throws(() => mapTemplateSchema(schema, { columns: { unknownField: 'A' } }), /Unknown canonical mapping key/u);
  assert.throws(() => mapTemplateSchema(schema, { columns: { price: 'Z' } }), /Explicit column does not contain a header/u);
});

test('explicit mapping rejects incompatible duplicate physical-column assignment', async (t) => {
  const schema = await schemaFor(t, [['Назва_позиції', 'Ціна'], ['Товар', 20]]);
  assert.throws(() => mapTemplateSchema(schema, { columns: { titleRu: 'A', price: 'A' } }), /incompatible canonical fields/u);
});

test('explicit options and alias registry stay immutable and mapping is deterministic', async (t) => {
  const schema = await schemaFor(t, [['Код_товару', 'Назва_позиції', 'Ціна'], ['1', 'Товар', 20]]);
  const options = { columns: { price: 'C' } };
  const before = structuredClone(options);
  const aliasesBefore = structuredClone(ALIAS_REGISTRY);
  const first = mapTemplateSchema(schema, options);
  const second = mapTemplateSchema(schema, options);
  assert.deepEqual(first, second);
  assert.deepEqual(options, before);
  assert.deepEqual(ALIAS_REGISTRY, aliasesBefore);
  assert.deepEqual(Object.keys(ALIAS_REGISTRY).sort(), [...CANONICAL_FIELDS].sort());
});
