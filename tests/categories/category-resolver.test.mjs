import assert from 'node:assert/strict';
import test from 'node:test';
import { CategoryCatalogError, resolveCategoryRequests } from '../../src/categories/category-resolver.mjs';

const catalog = [
  {
    supplier: 'ug-opt',
    sourceCategoryName: 'Фени',
    sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-feny',
    parentNames: ['Усе для укладання Волосся'],
  },
  {
    supplier: 'ug-opt',
    sourceCategoryName: 'Плойки та щипці для завивки волосся',
    sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-curlers',
  },
  {
    supplier: 'ug-opt',
    sourceCategoryName: 'Дитячі іграшки',
    sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-toys',
  },
];

test('resolves one exact category with adapter-compatible source metadata', () => {
  const result = resolveCategoryRequests({ categories: [{ requestKey: 'hair-dryers', requestedName: 'Фени', limit: 20 }], totalLimit: 20 }, catalog);
  assert.deepEqual(result.categories[0], {
    requestKey: 'hair-dryers',
    requestedName: 'Фени',
    limit: 20,
    resolution: 'resolved',
    resolvedCategory: catalog[0],
    match: { kind: 'exactName' },
  });
  assert.deepEqual(result.summary, { requestedCount: 1, resolvedCount: 1, notFoundCount: 0, ambiguousCount: 0 });
});

test('resolves multiple categories in request order and preserves limits and totalLimit', () => {
  const request = {
    categories: [
      { requestKey: 'toys', requestedName: 'Дитячі іграшки', limit: 30 },
      { requestKey: 'curlers', requestedName: 'Плойки та щипці для завивки волосся', limit: 15 },
    ],
    totalLimit: 45,
  };
  const result = resolveCategoryRequests(request, catalog);
  assert.deepEqual(result.categories.map((category) => category.requestKey), ['toys', 'curlers']);
  assert.deepEqual(result.categories.map((category) => category.limit), [30, 15]);
  assert.equal(result.totalLimit, 45);
});

test('normalizes only comparison case and whitespace while preserving returned supplier values', () => {
  const sourceCategory = {
    sourceCategoryName: '  Фени   для волосся  ',
    sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-hair-dryers?view=all',
    parentNames: ['  Батьківська категорія  '],
  };
  const result = resolveCategoryRequests({ categories: [{ requestKey: 'hair', requestedName: ' фени для   волосся ' }] }, [sourceCategory]);
  assert.equal(result.categories[0].resolution, 'resolved');
  assert.deepEqual(result.categories[0].resolvedCategory, { supplier: 'ug-opt', ...sourceCategory });
});

test('resolves a unique conservative token-containment match', () => {
  const result = resolveCategoryRequests(
    { categories: [{ requestKey: 'travel', requestedName: 'Фени дорожні' }] },
    [{ sourceCategoryName: 'Фени дорожні для подорожей', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-travel-dryers' }],
  );
  assert.equal(result.categories[0].resolution, 'resolved');
  assert.equal(result.categories[0].match.kind, 'uniqueTokenContainment');
});

test('returns notFound for zero matches and preserves an empty valid catalog distinction', () => {
  const result = resolveCategoryRequests({ categories: [{ requestKey: 'unknown', requestedName: 'Невідома категорія' }] }, []);
  assert.deepEqual(result.categories[0], { requestKey: 'unknown', requestedName: 'Невідома категорія', resolution: 'notFound' });
  assert.deepEqual(result.summary, { requestedCount: 1, resolvedCount: 0, notFoundCount: 1, ambiguousCount: 0 });
});

test('returns ambiguous alternatives in catalog order instead of choosing the first', () => {
  const alternatives = [
    { sourceCategoryName: 'Фени дорожні', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-travel' },
    { sourceCategoryName: 'Професійні фени', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-professional' },
  ];
  const result = resolveCategoryRequests({ categories: [{ requestKey: 'dryers', requestedName: 'Фени' }] }, alternatives);
  assert.equal(result.categories[0].resolution, 'ambiguous');
  assert.deepEqual(result.categories[0].alternatives, alternatives.map((entry) => ({ supplier: 'ug-opt', ...entry })));
  assert.deepEqual(result.categories[0].alternatives.map((entry) => entry.sourceCategoryUrl), [alternatives[0].sourceCategoryUrl, alternatives[1].sourceCategoryUrl]);
});

test('exact match wins over broader containment candidates', () => {
  const result = resolveCategoryRequests(
    { categories: [{ requestKey: 'exact', requestedName: 'Фени' }] },
    [
      { sourceCategoryName: 'Фени дорожні', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-travel' },
      { sourceCategoryName: 'Фени', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-exact' },
    ],
  );
  assert.equal(result.categories[0].resolvedCategory.sourceCategoryUrl, 'https://ug-opt.in.ua/ua/g-exact');
  assert.equal(result.categories[0].match.kind, 'exactName');
});

test('deduplicates repeated navigation URLs by retaining the first entry only', () => {
  const result = resolveCategoryRequests(
    { categories: [{ requestKey: 'dryer', requestedName: 'Фени' }] },
    [
      { sourceCategoryName: 'Фени', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-feny' },
      { sourceCategoryName: 'Фени інша назва', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-feny' },
    ],
  );
  assert.equal(result.categories[0].resolution, 'resolved');
  assert.equal(result.categories[0].resolvedCategory.sourceCategoryName, 'Фени');
});

test('same name with different URLs remains ambiguous', () => {
  const result = resolveCategoryRequests(
    { categories: [{ requestKey: 'dryer', requestedName: 'Фени' }] },
    [
      { sourceCategoryName: 'Фени', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-feny-a' },
      { sourceCategoryName: 'Фени', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-feny-b' },
    ],
  );
  assert.equal(result.categories[0].resolution, 'ambiguous');
  assert.equal(result.categories[0].alternatives.length, 2);
});

test('does not mutate request or catalog and preserves exact source fields', () => {
  const request = { categories: [{ requestKey: 'dryer', requestedName: ' Фени ', limit: 20 }], totalLimit: 20 };
  const source = { sourceCategoryName: 'Фени', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-feny?sort=asc' };
  const requestBefore = structuredClone(request);
  const sourceBefore = structuredClone(source);
  const result = resolveCategoryRequests(request, [source]);
  assert.deepEqual(request, requestBefore);
  assert.deepEqual(source, sourceBefore);
  assert.equal(result.categories[0].resolvedCategory.sourceCategoryUrl, source.sourceCategoryUrl);
});

test('rejects malformed runtime requests', () => {
  assert.throws(() => resolveCategoryRequests({ categories: 'no' }, catalog), /categories must be an array/u);
  assert.throws(() => resolveCategoryRequests({ categories: [{ requestedName: 'Фени' }] }, catalog), /requestKey/u);
  assert.throws(() => resolveCategoryRequests({ categories: [{ requestKey: 'empty', requestedName: '   ' }] }, catalog), /requestedName/u);
});

test('rejects malformed or unsafe catalog entries as catalog failures, not category notFound results', () => {
  for (const entry of [
    { sourceCategoryName: 'External', sourceCategoryUrl: 'https://example.com/category' },
    { sourceCategoryName: 'Local', sourceCategoryUrl: 'http://localhost/category' },
    { sourceCategoryName: 'Script', sourceCategoryUrl: 'javascript:alert(1)' },
    { sourceCategoryName: 'Missing URL' },
    'not-an-entry',
  ]) {
    assert.throws(
      () => resolveCategoryRequests({ categories: [{ requestKey: 'category', requestedName: 'Фени' }] }, [entry]),
      CategoryCatalogError,
    );
  }
});

test('rejects a non-array catalog explicitly', () => {
  assert.throws(
    () => resolveCategoryRequests({ categories: [{ requestKey: 'category', requestedName: 'Фени' }] }, null),
    CategoryCatalogError,
  );
});
