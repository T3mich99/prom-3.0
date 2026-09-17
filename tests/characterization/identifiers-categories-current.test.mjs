import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSource, evaluateExpression, extractArrowExpression, readProduction } from './support.mjs';

const strictFinalSource = await readProduction('excel-work/build-prom-v3-final.mjs');
const clean = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
const normCode = Function('clean', `return (${extractArrowExpression(strictFinalSource, 'normCode')});`)(clean);

test('strict final identifier normalization preserves U-wrapper stripping', () => {
  assert.equal(normCode('U123U'), '123');
  assert.equal(normCode('u00123u'), '00123');
  assert.equal(normCode('  U9000000149U  '), '9000000149');
  assert.equal(normCode('UU'), '');
});

test('strict final identifier construction preserves current output formats', () => {
  const supplierCode = normCode('U123U');
  const numericCode = Number(supplierCode);
  assert.equal(`U${supplierCode}U`, 'U123U');
  assert.equal(numericCode, 123);
  assert.equal(`U${numericCode}U`, 'U123U');
  assertSource(strictFinalSource, /row\[ix\['Код_товару'\]\] = `U\$\{supplierCode\}U`/u, 'strict product code format is protected');
  assertSource(strictFinalSource, /row\[ix\['Унікальний_ідентифікатор'\]\] = numericCode/u, 'strict numeric unique ID is protected');
  assertSource(strictFinalSource, /row\[ix\['Ідентифікатор_товару'\]\] = `U\$\{numericCode\}U`/u, 'strict product identifier format is protected');
});

test('strict final rejects malformed and non-positive numeric source codes', () => {
  for (const value of ['', 'abc', '0', '-1']) {
    const numericCode = Number(normCode(value));
    assert.equal(Number.isInteger(numericCode) && numericCode > 0, false, value);
  }
  assertSource(strictFinalSource, /if \(!Number\.isInteger\(numericCode\) \|\| numericCode <= 0\)/u, 'malformed identifiers remain a hard error');
});

const repairSource = await readProduction('excel-work/fix-prom-identifiers.mjs');

function currentRepairIdentity(value) {
  const code = String(value ?? '').trim().replace(/^U/iu, '').replace(/U$/iu, '');
  const codeNumber = Number(code);
  return { codeNumber, productId: `U${code}U` };
}

test('legacy identifier repair preserves its separate numeric-code behavior', () => {
  assert.deepEqual(currentRepairIdentity('U123U'), { codeNumber: 123, productId: 'U123U' });
  assertSource(repairSource, /row\[ix\['Код_товару'\]\] = codeNumber/u, 'legacy repair writes numeric product code');
  assertSource(repairSource, /row\[ix\['Унікальний_ідентифікатор'\]\] = codeNumber/u, 'legacy repair writes numeric unique ID');
  assertSource(repairSource, /row\[ix\['Ідентифікатор_товару'\]\] = `U\$\{code\}U`/u, 'legacy repair writes separate U-wrapped product ID');
});

test('legacy identifier duplicate detection remains exact-string based', () => {
  const values = ['U123U', '123', 'U124U'].map(currentRepairIdentity);
  const uniqueIds = new Set(values.map((x) => String(x.codeNumber)));
  const productIds = new Set(values.map((x) => x.productId));
  assert.equal(uniqueIds.size, 2);
  assert.equal(productIds.size, 2);
  assertSource(repairSource, /seenUnique\.has\(String\(codeNumber\)\)/u, 'legacy unique-ID duplicate check is protected');
  assertSource(repairSource, /seenProduct\.has\(`U\$\{code\}U`\)/u, 'legacy product-ID duplicate check is protected');
});

const categorySource = await readProduction('excel-work/fix-prom-categories.mjs');
const ruNamesMatch = categorySource.match(/const ruNames = (\{[\s\S]*?\n\};)/u);
assert.ok(ruNamesMatch, 'category label map must still exist in the repair script');
const ruNames = evaluateExpression(ruNamesMatch[1].slice(0, -1));

test('category repair preserves a known hardcoded category label', () => {
  assert.equal(ruNames['611'], 'Соковыжималки');
  assert.equal(ruNames['302306'], 'Охранные системы и сигнализации');
});

test('category repair preserves missing-label behavior', () => {
  assert.equal(ruNames['missing-category'], undefined);
  assertSource(categorySource, /if \(!ru\) throw new Error\(`Russian category name is missing/u, 'missing category label remains a hard error');
  assertSource(categorySource, /row\[ix\['Посилання_підрозділу'\]\] = null/u, 'category-link blanking remains current behavior');
});

test('strict final category QA preserves explicit-category predicate', () => {
  const explicit = (name, id) => Boolean(String(name ?? '').trim() && String(id ?? '').trim() && !/коренева група|root/iu.test(`${name} ${id}`));
  assert.equal(explicit('Соковижималки', '611'), true);
  assert.equal(explicit('Коренева група', '611'), false);
  assert.equal(explicit('', '611'), false);
  assertSource(strictFinalSource, /!\/коренева група\|root\/iu\.test/u, 'strict explicit-category predicate remains protected');
});
