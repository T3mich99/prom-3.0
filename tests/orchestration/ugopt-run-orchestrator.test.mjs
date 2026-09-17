import assert from 'node:assert/strict';
import test from 'node:test';
import { UgoptCategoryCatalogError } from '../../src/suppliers/ugopt/category-catalog.mjs';
import { collectUgoptCategories } from '../../src/suppliers/ugopt/category-adapter.mjs';
import { UgoptRunOrchestrationError, runUgoptProductSelection } from '../../src/orchestration/ugopt-run-orchestrator.mjs';

const FENY_URL = 'https://ug-opt.in.ua/ua/g38298691-feny';
const CURLERS_URL = 'https://ug-opt.in.ua/ua/g107153153-plojki-utyuzhki-gofre';
const CHILDREN_A_URL = 'https://ug-opt.in.ua/ua/g116006932-detskie-tovary';
const CHILDREN_B_URL = 'https://ug-opt.in.ua/ua/g107153154-detskie-tovary';

const catalog = [
  {
    supplier: 'ug-opt',
    sourceCategoryName: 'Фени',
    sourceCategoryUrl: FENY_URL,
    parentNames: ['Усе для укладання Волосся'],
  },
  {
    supplier: 'ug-opt',
    sourceCategoryName: 'Плойки, праски, гофре',
    sourceCategoryUrl: CURLERS_URL,
    parentNames: ['Усе для укладання Волосся'],
  },
  { supplier: 'ug-opt', sourceCategoryName: 'Дитячі товари', sourceCategoryUrl: CHILDREN_A_URL },
  { supplier: 'ug-opt', sourceCategoryName: 'Дитячі товари', sourceCategoryUrl: CHILDREN_B_URL, parentNames: ['Дитячі товари'] },
];

function card({ id, sku, title = sku }) {
  return `<li data-product-id="${id}"><a data-product-url="/ua/p${id}-item.html" data-product-name="${title}">
    <span class="cs-product-list__sku"><span title="${sku}">${sku}</span></span>
    <span data-product-price="230 грн"></span><img data-product-big-picture="/images/${id}.jpg">
  </a></li>`;
}

function page(cards) {
  return `<div data-pagination-pages-count="1"></div><ul>${cards.join('')}</ul>`;
}

function fakeFetch(routes, calls = []) {
  return async (url) => {
    calls.push(url);
    const route = routes.get(new URL(url).pathname);
    if (!route) throw new Error(`unexpected URL ${url}`);
    if (route instanceof Error) throw route;
    if (route.status !== undefined) return { ok: false, status: route.status };
    return { ok: true, status: 200, text: async () => route.body };
  };
}

function loaderFor(sourceCatalog, calls = []) {
  return async () => {
    calls.push('catalog');
    return sourceCatalog;
  };
}

function wrappedAdapter(calls = []) {
  return async (request, options) => {
    calls.push(structuredClone(request));
    return collectUgoptCategories(request, options);
  };
}

function routesFor({ feny = [], curlers = [] } = {}) {
  return new Map([
    ['/ua/g38298691-feny', { body: page(feny) }],
    ['/ua/g107153153-plojki-utyuzhki-gofre', { body: page(curlers) }],
  ]);
}

test('runs one resolved request end-to-end and preserves resolver metadata at the boundary', async () => {
  const catalogCalls = [];
  const adapterCalls = [];
  const fetchCalls = [];
  const result = await runUgoptProductSelection(
    { categories: [{ requestKey: 'hair-dryers', requestedName: 'Фени', limit: 2 }], totalLimit: 2 },
    {
      catalogLoader: loaderFor(catalog, catalogCalls),
      adapterCollector: wrappedAdapter(adapterCalls),
      fetchImpl: fakeFetch(routesFor({ feny: [card({ id: 1, sku: 'F-001' })] }), fetchCalls),
    },
  );

  assert.equal(result.runStatus, 'completed');
  assert.deepEqual(catalogCalls, ['catalog']);
  assert.equal(adapterCalls.length, 1);
  assert.deepEqual(adapterCalls[0].categories[0], {
    requestKey: 'hair-dryers',
    requestedName: 'Фени',
    sourceCategoryUrl: FENY_URL,
    sourceCategoryName: 'Фени',
    limit: 2,
  });
  assert.equal(fetchCalls[0].startsWith(`${FENY_URL}?`), true);
  assert.deepEqual(result.resolution.categories[0].resolvedCategory.parentNames, ['Усе для укладання Волосся']);
  assert.deepEqual(result.selectedProducts.map((item) => item.product.supplierSku), ['F-001']);
  assert.equal(result.summary.selectedProductCount, 1);
  assert.deepEqual(result.catalogSummary, { source: 'ug-opt', categoryCount: 4 });
});

test('preserves resolved request order, per-category limits, totalLimit, and selector deduplication', async () => {
  const adapterCalls = [];
  const fetchCalls = [];
  const result = await runUgoptProductSelection(
    {
      categories: [
        { requestKey: 'curlers', requestedName: 'Плойки, праски, гофре', limit: 4 },
        { requestKey: 'hair-dryers', requestedName: 'Фени', limit: 4 },
      ],
      totalLimit: 6,
    },
    {
      catalogLoader: loaderFor(catalog),
      adapterCollector: wrappedAdapter(adapterCalls),
      fetchImpl: fakeFetch(routesFor({
        curlers: [card({ id: 11, sku: 'shared' }), card({ id: 12, sku: 'C-002' }), card({ id: 13, sku: 'C-003' }), card({ id: 14, sku: 'C-004' })],
        feny: [card({ id: 21, sku: 'shared' }), card({ id: 22, sku: 'F-002' }), card({ id: 23, sku: 'F-003' }), card({ id: 24, sku: 'F-004' })],
      }), fetchCalls),
    },
  );

  assert.deepEqual(adapterCalls[0].categories.map((category) => category.requestKey), ['curlers', 'hair-dryers']);
  assert.deepEqual(fetchCalls.map((url) => new URL(url).pathname), [
    '/ua/g107153153-plojki-utyuzhki-gofre',
    '/ua/g38298691-feny',
  ]);
  assert.deepEqual(result.selectedProducts.map((item) => item.selectionKey), [
    'ugopt:shared', 'ugopt:C-002', 'ugopt:C-003', 'ugopt:C-004', 'ugopt:F-002', 'ugopt:F-003',
  ]);
  assert.equal(result.selection.summary.selectedCount, 6);
  assert.equal(result.selection.summary.duplicateCount, 1);
  assert.deepEqual(result.selection.categories.map((category) => category.requestKey), ['curlers', 'hair-dryers']);
  assert.equal(result.selection.categories[0].requestedLimit, 4);
  assert.equal(result.selection.categories[1].requestedLimit, 4);
  assert.equal(result.selection.summary.totalLimit, 6);
});

test('mixed resolved, notFound, and ambiguous requests remain ordered and only resolved reaches the adapter', async () => {
  const adapterCalls = [];
  const fetchCalls = [];
  const result = await runUgoptProductSelection(
    {
      categories: [
        { requestKey: 'hair-dryers', requestedName: 'Фени', limit: 1 },
        { requestKey: 'missing', requestedName: 'Definitely Missing Category', limit: 1 },
        { requestKey: 'children', requestedName: 'Дитячі товари', limit: 1 },
      ],
      totalLimit: 2,
    },
    {
      catalogLoader: loaderFor(catalog),
      adapterCollector: wrappedAdapter(adapterCalls),
      fetchImpl: fakeFetch(routesFor({ feny: [card({ id: 31, sku: 'F-031' })] }), fetchCalls),
    },
  );

  assert.equal(result.runStatus, 'partial');
  assert.deepEqual(result.resolution.categories.map((category) => [category.requestKey, category.resolution]), [
    ['hair-dryers', 'resolved'],
    ['missing', 'notFound'],
    ['children', 'ambiguous'],
  ]);
  assert.deepEqual(adapterCalls[0].categories.map((category) => category.requestKey), ['hair-dryers']);
  assert.deepEqual(fetchCalls.map((url) => new URL(url).pathname), ['/ua/g38298691-feny']);
  assert.deepEqual(result.selectedProducts.map((item) => item.product.supplierSku), ['F-031']);
  assert.deepEqual(result.summary, {
    requestedCategoryCount: 3,
    resolvedCategoryCount: 1,
    notFoundCategoryCount: 1,
    ambiguousCategoryCount: 1,
    selectedProductCount: 1,
    selectedCount: 1,
  });
});

test('blocks a run with no resolved categories without calling the adapter', async () => {
  let adapterCalls = 0;
  const result = await runUgoptProductSelection(
    { categories: [{ requestKey: 'missing', requestedName: 'No such category' }, { requestKey: 'children', requestedName: 'Дитячі товари' }] },
    {
      catalogLoader: loaderFor(catalog),
      adapterCollector: async () => {
        adapterCalls += 1;
        throw new Error('adapter must not be called');
      },
    },
  );

  assert.equal(adapterCalls, 0);
  assert.equal(result.runStatus, 'blocked');
  assert.deepEqual(result.selectedProducts, []);
  assert.equal(result.selection.summary.requestedCategoryCount, 0);
  assert.deepEqual(result.resolution.categories.map((category) => category.requestKey), ['missing', 'children']);
});

test('propagates catalog failures without converting them into category results', async () => {
  const failure = new UgoptCategoryCatalogError('catalog unavailable', { kind: 'http', status: 503 });
  await assert.rejects(
    () => runUgoptProductSelection({ categories: [{ requestKey: 'feny', requestedName: 'Фени' }] }, { catalogLoader: async () => { throw failure; } }),
    (error) => error === failure && error.kind === 'http' && error.status === 503,
  );
});

test('propagates adapter HTTP, network, and parse failures explicitly', async (t) => {
  const failures = [
    ['http', new Map([['/ua/g38298691-feny', { status: 502 }]])],
    ['network', new Map([['/ua/g38298691-feny', new Error('offline')]])],
    ['parse', new Map([['/ua/g38298691-feny', { body: '<html>unexpected supplier page</html>' }]])],
  ];
  for (const [kind, routes] of failures) {
    await t.test(kind, async () => {
      await assert.rejects(
        () => runUgoptProductSelection(
          { categories: [{ requestKey: 'feny', requestedName: 'Фени' }] },
          { catalogLoader: loaderFor(catalog), fetchImpl: fakeFetch(routes) },
        ),
        (error) => error instanceof UgoptRunOrchestrationError && error.kind === 'adapter' && error.failure.kind === kind,
      );
    });
  }
});

test('does not mutate inputs and is deterministic for identical injected inputs', async () => {
  const request = { categories: [{ requestKey: 'feny', requestedName: 'Фени', limit: 1 }], totalLimit: 1 };
  const requestBefore = structuredClone(request);
  const catalogBefore = structuredClone(catalog);
  const options = {
    catalogLoader: loaderFor(catalog),
    fetchImpl: fakeFetch(routesFor({ feny: [card({ id: 81, sku: 'F-081' })] })),
  };
  const first = await runUgoptProductSelection(request, options);
  const second = await runUgoptProductSelection(request, {
    catalogLoader: loaderFor(catalog),
    fetchImpl: fakeFetch(routesFor({ feny: [card({ id: 81, sku: 'F-081' })] })),
  });

  assert.deepEqual(request, requestBefore);
  assert.deepEqual(catalog, catalogBefore);
  assert.deepEqual(first, second);
});
