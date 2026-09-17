import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRunRequest } from '../../src/selection/run-request.mjs';

const validCategory = {
  requestKey: 'a',
  requestedName: 'Category A',
  resolvedCategory: { source: 'fixture', sourceCategoryKey: 'source-a' },
  candidates: [{ selectionKey: 'a-1', product: { id: 'a-1' } }],
};

test('accepts a resolved request and returns the same input without normalization', () => {
  const request = { categories: [validCategory], totalLimit: 1 };
  assert.equal(validateRunRequest(request), request);
  assert.equal(request.categories[0].requestKey, 'a');
});

test('accepts an explicitly unresolved category with no candidates', () => {
  const request = { categories: [{ requestKey: 'missing', requestedName: 'Missing', resolution: 'notFound', candidates: [] }] };
  assert.equal(validateRunRequest(request), request);
});

test('rejects a non-object request', () => {
  assert.throws(() => validateRunRequest(null), /request must be an object/u);
  assert.throws(() => validateRunRequest([]), /request must be an object/u);
});

test('rejects a request without a categories array', () => {
  assert.throws(() => validateRunRequest({}), /categories must be an array/u);
});

test('rejects a category without requestKey or requestedName', () => {
  assert.throws(() => validateRunRequest({ categories: [{ requestedName: 'A', resolvedCategory: {}, candidates: [] }] }), /requestKey/u);
  assert.throws(() => validateRunRequest({ categories: [{ requestKey: 'a', resolvedCategory: {}, candidates: [] }] }), /requestedName/u);
});

test('rejects a category without a resolved category object', () => {
  assert.throws(() => validateRunRequest({ categories: [{ requestKey: 'a', requestedName: 'A', candidates: [] }] }), /resolvedCategory/u);
});

test('rejects a category without a candidates array', () => {
  assert.throws(() => validateRunRequest({ categories: [{ requestKey: 'a', requestedName: 'A', resolvedCategory: {} }] }), /candidates must be an array/u);
});

test('rejects an unresolved category with a resolved category object', () => {
  assert.throws(() => validateRunRequest({ categories: [{ requestKey: 'a', requestedName: 'A', resolution: 'notFound', resolvedCategory: {}, candidates: [] }] }), /must not have resolvedCategory/u);
});

test('rejects an unsupported resolution status', () => {
  assert.throws(() => validateRunRequest({ categories: [{ requestKey: 'a', requestedName: 'A', resolution: 'fallback', resolvedCategory: {}, candidates: [] }] }), /Invalid resolution/u);
});

test('rejects a candidate without a product property', () => {
  assert.throws(() => validateRunRequest({ categories: [{ ...validCategory, candidates: [{ selectionKey: 'a-1' }] }] }), /Missing product/u);
});
