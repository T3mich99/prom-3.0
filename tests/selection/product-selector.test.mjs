import assert from 'node:assert/strict';
import test from 'node:test';
import { selectProducts } from '../../src/selection/product-selector.mjs';

function category(requestKey, candidates, options = {}) {
  return {
    requestKey,
    requestedName: `Category ${requestKey.toUpperCase()}`,
    resolvedCategory: { source: 'fixture', sourceCategoryKey: `source-${requestKey}` },
    candidates,
    ...options,
  };
}

function candidate(selectionKey, id = selectionKey) {
  return { selectionKey, product: { id, title: `Product ${id}` } };
}

function unresolved(requestKey, options = {}) {
  return {
    requestKey,
    requestedName: `Category ${requestKey.toUpperCase()}`,
    resolution: 'notFound',
    candidates: [],
    ...options,
  };
}

test('selects one resolved category in candidate order', () => {
  const result = selectProducts({ categories: [category('a', [candidate('a-1'), candidate('a-2')])] });
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), ['a-1', 'a-2']);
  assert.equal(result.selectedProducts[0].requestedCategory, 'Category A');
  assert.equal(result.categories[0].resolutionStatus, 'resolved');
  assert.equal(result.categories[0].candidateCount, 2);
  assert.equal(result.categories[0].selectedCount, 2);
});

test('processes multiple categories in request order', () => {
  const result = selectProducts({ categories: [category('a', [candidate('a-1')]), category('b', [candidate('b-1')])] });
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), ['a-1', 'b-1']);
  assert.deepEqual(result.categories.map((item) => item.requestKey), ['a', 'b']);
});

test('applies different per-category limits', () => {
  const result = selectProducts({
    categories: [
      category('a', [candidate('a-1'), candidate('a-2'), candidate('a-3')], { limit: 2 }),
      category('b', [candidate('b-1'), candidate('b-2')], { limit: 1 }),
    ],
  });
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), ['a-1', 'a-2', 'b-1']);
  assert.equal(result.categories[0].shortfall, 0);
  assert.equal(result.categories[1].shortfall, 0);
});

test('applies a total limit', () => {
  const result = selectProducts({
    categories: [category('a', [candidate('a-1'), candidate('a-2')]), category('b', [candidate('b-1')])],
    totalLimit: 2,
  });
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), ['a-1', 'a-2']);
  assert.equal(result.summary.selectedCount, 2);
});

test('applies category and total limits together with request-order precedence', () => {
  const result = selectProducts({
    categories: [
      category('a', [candidate('a-1'), candidate('a-2')], { limit: 2 }),
      category('b', [candidate('b-1'), candidate('b-2')], { limit: 2 }),
    ],
    totalLimit: 3,
  });
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), ['a-1', 'a-2', 'b-1']);
  assert.equal(result.categories[1].shortfall, 1);
});

test('a candidate skipped by an earlier category limit does not reserve its key globally', () => {
  const result = selectProducts({
    categories: [
      category('a', [candidate('a-1'), candidate('shared')], { limit: 1 }),
      category('b', [candidate('shared', 'category-b-product')]),
    ],
  });
  assert.deepEqual(result.selectedProducts.map((item) => [item.requestKey, item.selectionKey]), [['a', 'a-1'], ['b', 'shared']]);
  assert.equal(result.selectedProducts[1].product.id, 'category-b-product');
  assert.equal(result.categories[1].duplicateCount, 0);
  assert.equal(result.categories[1].selectedCount, 1);
  assert.equal(result.summary.duplicateCount, 0);
});

test('zero category limit selects no candidates from that category', () => {
  const result = selectProducts({ categories: [category('a', [candidate('a-1')], { limit: 0 })] });
  assert.deepEqual(result.selectedProducts, []);
  assert.equal(result.categories[0].selectedCount, 0);
  assert.equal(result.categories[0].shortfall, 0);
});

test('zero total limit selects no products globally', () => {
  const result = selectProducts({ categories: [category('a', [candidate('a-1')]), category('b', [candidate('b-1')])], totalLimit: 0 });
  assert.deepEqual(result.selectedProducts, []);
  assert.equal(result.categories[0].selectedCount, 0);
  assert.equal(result.categories[1].selectedCount, 0);
});

test('missing limits select all unique candidates', () => {
  const result = selectProducts({ categories: [category('a', [candidate('a-1'), candidate('a-2')])] });
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), ['a-1', 'a-2']);
  assert.equal(result.categories[0].requestedLimit, null);
  assert.equal(result.summary.totalLimit, null);
});

test('short category reports a shortfall without duplicating candidates', () => {
  const result = selectProducts({ categories: [category('a', [candidate('a-1')], { limit: 3 })] });
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), ['a-1']);
  assert.equal(result.categories[0].candidateCount, 1);
  assert.equal(result.categories[0].selectedCount, 1);
  assert.equal(result.categories[0].shortfall, 2);
});

test('duplicate inside one category is rejected after the first occurrence', () => {
  const result = selectProducts({ categories: [category('a', [candidate('same', 'first'), candidate('same', 'second'), candidate('a-2')])] });
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), ['same', 'a-2']);
  assert.equal(result.selectedProducts[0].product.id, 'first');
  assert.equal(result.categories[0].duplicateCount, 1);
});

test('duplicates do not consume a category quota', () => {
  const result = selectProducts({
    categories: [category('a', [candidate('shared', 'first-product'), candidate('shared', 'duplicate-product'), candidate('a-2')], { limit: 2 })],
  });
  assert.deepEqual(result.selectedProducts.map((item) => item.product.id), ['first-product', 'a-2']);
  assert.equal(result.categories[0].selectedCount, 2);
  assert.equal(result.categories[0].duplicateCount, 1);
  assert.equal(result.categories[0].shortfall, 0);
});

test('duplicate across categories is rejected globally', () => {
  const result = selectProducts({ categories: [category('a', [candidate('same', 'first')]), category('b', [candidate('same', 'second'), candidate('b-1')])] });
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), ['same', 'b-1']);
  assert.equal(result.categories[1].duplicateCount, 1);
  assert.equal(result.summary.duplicateCount, 1);
});

test('first-wins deduplication preserves the first product and trace', () => {
  const first = candidate('shared', 'first-product');
  const second = candidate('shared', 'second-product');
  const result = selectProducts({ categories: [category('a', [first]), category('b', [second])] });
  assert.equal(result.selectedProducts[0].product, first.product);
  assert.equal(result.selectedProducts[0].requestKey, 'a');
  assert.equal(result.selectedProducts[0].resolvedCategory.sourceCategoryKey, 'source-a');
});

test('unresolved category selects zero products and remains in the report', () => {
  const result = selectProducts({ categories: [unresolved('missing', { limit: 3 })] });
  assert.deepEqual(result.selectedProducts, []);
  assert.equal(result.categories[0].resolutionStatus, 'notFound');
  assert.equal(result.categories[0].candidateCount, 0);
  assert.equal(result.categories[0].shortfall, 3);
});

test('resolved and unresolved categories remain separate', () => {
  const result = selectProducts({ categories: [category('a', [candidate('a-1')]), unresolved('missing')] });
  assert.deepEqual(result.selectedProducts.map((item) => item.requestKey), ['a']);
  assert.deepEqual(result.categories.map((item) => item.resolutionStatus), ['resolved', 'notFound']);
  assert.equal(result.summary.resolvedCategoryCount, 1);
  assert.equal(result.summary.unresolvedCategoryCount, 1);
});

test('empty category request returns an empty structured result', () => {
  const result = selectProducts({ categories: [] });
  assert.deepEqual(result.selectedProducts, []);
  assert.deepEqual(result.categories, []);
  assert.deepEqual(result.summary, { requestedCategoryCount: 0, resolvedCategoryCount: 0, unresolvedCategoryCount: 0, candidateCount: 0, selectedCount: 0, duplicateCount: 0, totalLimit: null });
});

test('resolved category with zero candidates reports no shortfall without a limit', () => {
  const result = selectProducts({ categories: [category('empty', [])] });
  assert.equal(result.categories[0].candidateCount, 0);
  assert.equal(result.categories[0].selectedCount, 0);
  assert.equal(result.categories[0].shortfall, 0);
});

test('selectionKey is treated as an opaque exact string', () => {
  const result = selectProducts({ categories: [category('a', [candidate(' key '), candidate('KEY')])] });
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), [' key ', 'KEY']);
});

test('category request order is preserved in traceability', () => {
  const result = selectProducts({ categories: [category('second', [candidate('s')]), category('first', [candidate('f')])] });
  assert.deepEqual(result.selectedProducts.map((item) => item.requestKey), ['second', 'first']);
  assert.deepEqual(result.categories.map((item) => item.requestKey), ['second', 'first']);
});

test('candidate input order is preserved within a category', () => {
  const result = selectProducts({ categories: [category('a', [candidate('third'), candidate('first'), candidate('second')])] });
  assert.deepEqual(result.selectedProducts.map((item) => item.product.id), ['third', 'first', 'second']);
});

test('selection does not mutate the request or product objects', () => {
  const request = { categories: [category('a', [candidate('a-1'), candidate('a-2')], { limit: 1 })], totalLimit: 1 };
  const before = structuredClone(request);
  selectProducts(request);
  assert.deepEqual(request, before);
});

test('summary counts candidates, selected products, duplicates, and categories', () => {
  const result = selectProducts({ categories: [category('a', [candidate('shared'), candidate('a-2')]), category('b', [candidate('shared')]), unresolved('missing')] });
  assert.deepEqual(result.summary, { requestedCategoryCount: 3, resolvedCategoryCount: 2, unresolvedCategoryCount: 1, candidateCount: 3, selectedCount: 2, duplicateCount: 1, totalLimit: null });
});

test('per-category report counts are independent', () => {
  const result = selectProducts({ categories: [category('a', [candidate('a-1'), candidate('a-2')], { limit: 1 }), category('b', [candidate('b-1')], { limit: 2 })] });
  assert.deepEqual(result.categories.map((item) => ({ candidateCount: item.candidateCount, requestedLimit: item.requestedLimit, selectedCount: item.selectedCount, duplicateCount: item.duplicateCount, shortfall: item.shortfall })), [
    { candidateCount: 2, requestedLimit: 1, selectedCount: 1, duplicateCount: 0, shortfall: 0 },
    { candidateCount: 1, requestedLimit: 2, selectedCount: 1, duplicateCount: 0, shortfall: 1 },
  ]);
});

test('total limit can stop in the middle of a category', () => {
  const result = selectProducts({ categories: [category('a', [candidate('a-1'), candidate('a-2'), candidate('a-3')])], totalLimit: 2 });
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), ['a-1', 'a-2']);
  assert.equal(result.categories[0].candidateCount, 3);
  assert.equal(result.categories[0].selectedCount, 2);
});

test('later categories receive zero after total limit is exhausted', () => {
  const result = selectProducts({ categories: [category('a', [candidate('a-1')]), category('b', [candidate('b-1')]), category('c', [candidate('c-1')])], totalLimit: 1 });
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), ['a-1']);
  assert.deepEqual(result.categories.map((item) => item.selectedCount), [1, 0, 0]);
});

test('rejects a negative category limit', () => {
  assert.throws(() => selectProducts({ categories: [category('a', [], { limit: -1 })] }), /Invalid category limit/u);
});

test('rejects a fractional category limit', () => {
  assert.throws(() => selectProducts({ categories: [category('a', [], { limit: 1.5 })] }), /Invalid category limit/u);
});

test('rejects a string category limit instead of coercing it', () => {
  assert.throws(() => selectProducts({ categories: [category('a', [], { limit: '1' })] }), /Invalid category limit/u);
});

test('rejects a negative total limit', () => {
  assert.throws(() => selectProducts({ categories: [], totalLimit: -1 }), /Invalid totalLimit/u);
});

test('rejects a fractional total limit', () => {
  assert.throws(() => selectProducts({ categories: [], totalLimit: 1.5 }), /Invalid totalLimit/u);
});

test('rejects a string total limit instead of coercing it', () => {
  assert.throws(() => selectProducts({ categories: [], totalLimit: '1' }), /Invalid totalLimit/u);
});

test('rejects a candidate without a selection key', () => {
  assert.throws(() => selectProducts({ categories: [category('a', [{ product: { id: 'a-1' } }])] }), /selectionKey/u);
});

test('rejects an unresolved category with usable candidates', () => {
  assert.throws(() => selectProducts({ categories: [unresolved('missing', { candidates: [candidate('a-1')] })] }), /must not contain candidates/u);
});
