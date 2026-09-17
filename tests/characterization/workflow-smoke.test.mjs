import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { countPhrases, repoPath } from './support.mjs';

const fixture = JSON.parse(await fs.readFile(repoPath('tests', 'fixtures', 'product-fixture.json'), 'utf8'));

test('fixture selection smoke excludes an already-seen source code', () => {
  const candidates = [fixture.ordinaryProduct, fixture.missingFieldsProduct, fixture.unknownManufacturerProduct];
  const priorCodes = new Set(['1002']);
  const selected = candidates.filter((product) => !priorCodes.has(product.sourceCode));
  assert.deepEqual(selected.map((product) => product.sourceCode), ['1001', '1003']);
});

test('fixture preparation smoke blocks a product missing price and images', () => {
  const product = fixture.missingFieldsProduct;
  const ready = Number.isFinite(Number(product.purchasePrice)) && product.images.length > 0 && Boolean(product.title);
  assert.equal(ready, false);
});

test('fixture export smoke reconciles content, category, ID and keyword fields', () => {
  const product = fixture.ordinaryProduct;
  const category = fixture.categoryAssignment;
  const row = {
    code: `U${product.sourceCode}U`,
    uniqueId: Number(product.sourceCode),
    categoryId: Number(category.categoryId),
    titleRu: 'Органайзер для кухни',
    titleUa: 'Органайзер для кухні',
    ruKeywords: fixture.keywords.ru.join(', '),
    uaKeywords: fixture.keywords.ua.join(', '),
  };
  assert.match(row.code, /^U\d+U$/u);
  assert.equal(Number.isInteger(row.uniqueId), true);
  assert.equal(row.categoryId, 611);
  assert.equal(countPhrases(row.ruKeywords), 25);
  assert.equal(countPhrases(row.uaKeywords), 25);
  assert.notEqual(row.titleRu, row.titleUa);
});
