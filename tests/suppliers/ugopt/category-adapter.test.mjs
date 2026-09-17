import assert from 'node:assert/strict';
import test from 'node:test';
import { collectAndSelectUgoptCategories, collectUgoptCategories } from '../../../src/suppliers/ugopt/category-adapter.mjs';

const page = ({ cards = '', pageCount = 1 } = {}) => `
<div data-pagination-pages-count="${pageCount}"></div><ul>${cards}</ul>`;

const card = ({ id, sku, title, url = `/ua/p${id}-item.html` }) => `
<li data-product-id="${id}"><a data-product-url="${url}" data-product-name="${title}">
<span class="cs-product-list__sku"><span title="${sku}">${sku}</span></span>
<span data-product-price="100 грн"></span><img data-product-big-picture="/images/${id}.jpg">
</a></li>`;

function fakeFetch(routes, calls = []) {
  const fetchImpl = async (url) => {
    calls.push(url);
    const route = routes.get(url);
    if (!route) throw new Error(`unexpected URL ${url}`);
    if (route instanceof Error) throw route;
    return { ok: route.status === undefined, status: route.status, text: async () => route.body };
  };
  return { fetchImpl, calls };
}

function category(requestKey, requestedName, sourceCategoryUrl, limit) {
  return { requestKey, requestedName, sourceCategoryUrl, ...(limit === undefined ? {} : { limit }) };
}

function route(url, pageNumber, body) {
  const pageUrl = new URL(url);
  pageUrl.searchParams.set('product_items_per_page', '48');
  pageUrl.searchParams.set('page', String(pageNumber));
  return pageUrl.toString();
}

test('collects one category across pages, preserves order, and deduplicates repeated source cards locally', async () => {
  const sourceUrl = 'https://ug-opt.in.ua/ua/g-category';
  const routes = new Map([
    [route(sourceUrl, 1), { body: page({ pageCount: 2, cards: card({ id: 1, sku: '001', title: 'Перший' }) }) }],
    [route(sourceUrl, 2), { body: page({ pageCount: 2, cards: `${card({ id: 1, sku: '001', title: 'Перший' })}${card({ id: 2, sku: '002', title: 'Другий' })}` }) }],
  ]);
  const { fetchImpl, calls } = fakeFetch(routes);
  const result = await collectUgoptCategories({ categories: [category('cat-a', 'Категорія A', sourceUrl)] }, { fetchImpl });

  assert.equal(result.categories[0].resolution, 'resolved');
  assert.deepEqual(result.categories[0].candidates.map((item) => item.selectionKey), ['ugopt:001', 'ugopt:002']);
  assert.equal(result.categories[0].resolvedCategory.source, 'ug-opt');
  assert.equal(result.categories[0].resolvedCategory.sourceCategoryUrl, sourceUrl);
  assert.equal(result.categories[0].pagesFetched, 2);
  assert.deepEqual(calls, [route(sourceUrl, 1), route(sourceUrl, 2)]);
});

test('accepts dynamic one-or-many category URLs without a hardcoded category list', async () => {
  const first = 'https://ug-opt.in.ua/ua/g-first';
  const second = 'https://ug-opt.in.ua/ua/g-second';
  const routes = new Map([
    [route(first, 1), { body: page({ cards: card({ id: 11, sku: '11', title: 'Перший' }) }) }],
    [route(second, 1), { body: page({ cards: card({ id: 22, sku: '22', title: 'Другий' }) }) }],
  ]);
  const { fetchImpl } = fakeFetch(routes);
  const result = await collectUgoptCategories({ categories: [category('one', 'Один', first), category('two', 'Два', second)] }, { fetchImpl });
  assert.deepEqual(result.categories.map((item) => item.requestKey), ['one', 'two']);
  assert.deepEqual(result.categories.flatMap((item) => item.candidates.map((candidate) => candidate.product.supplierSku)), ['11', '22']);
});

test('one-page category fetches only page 1 and reports one completed page', async () => {
  const sourceUrl = 'https://ug-opt.in.ua/ua/g-one-page';
  const routes = new Map([[route(sourceUrl, 1), { body: page({ pageCount: 1, cards: card({ id: 12, sku: '12', title: 'Один товар' }) }) }]]);
  const { fetchImpl, calls } = fakeFetch(routes);

  const result = await collectUgoptCategories({ categories: [category('one-page', 'Одна сторінка', sourceUrl)] }, { fetchImpl });
  assert.deepEqual(calls, [route(sourceUrl, 1)]);
  assert.equal(result.categories[0].pagesFetched, 1);
  assert.deepEqual(result.categories[0].candidates.map((item) => item.product.supplierSku), ['12']);
});

test('four-page category fetches pages 1 through 4 exactly once in order', async () => {
  const sourceUrl = 'https://ug-opt.in.ua/ua/g-four-pages';
  const routes = new Map([
    [route(sourceUrl, 1), { body: page({ pageCount: 4, cards: card({ id: 21, sku: '21', title: 'Сторінка 1' }) }) }],
    [route(sourceUrl, 2), { body: page({ pageCount: 4, cards: card({ id: 22, sku: '22', title: 'Сторінка 2' }) }) }],
    [route(sourceUrl, 3), { body: page({ pageCount: 4, cards: card({ id: 23, sku: '23', title: 'Сторінка 3' }) }) }],
    [route(sourceUrl, 4), { body: page({ pageCount: 4, cards: card({ id: 24, sku: '24', title: 'Сторінка 4' }) }) }],
  ]);
  const { fetchImpl, calls } = fakeFetch(routes);

  const result = await collectUgoptCategories({ categories: [category('four-pages', 'Чотири сторінки', sourceUrl)] }, { fetchImpl });
  assert.deepEqual(calls, [1, 2, 3, 4].map((pageNumber) => route(sourceUrl, pageNumber)));
  assert.equal(result.categories[0].pagesFetched, 4);
  assert.deepEqual(result.categories[0].candidates.map((item) => item.product.supplierSku), ['21', '22', '23', '24']);
});

test('does not mutate the runtime request or its category objects', async () => {
  const sourceUrl = 'https://ug-opt.in.ua/ua/g-immutable';
  const request = { categories: [category('immutable', 'Незмінна', sourceUrl, 1)], totalLimit: 1 };
  const before = structuredClone(request);
  const routes = new Map([[route(sourceUrl, 1), { body: page({ cards: card({ id: 31, sku: '31', title: 'Товар' }) }) }]]);
  const { fetchImpl } = fakeFetch(routes);

  await collectUgoptCategories(request, { fetchImpl });
  assert.deepEqual(request, before);
});

test('returns a resolved empty category rather than treating zero products as failure', async () => {
  const sourceUrl = 'https://ug-opt.in.ua/ua/g-empty';
  const routes = new Map([[route(sourceUrl, 1), { body: page() }]]);
  const { fetchImpl } = fakeFetch(routes);
  const result = await collectUgoptCategories({ categories: [category('empty', 'Порожня', sourceUrl)] }, { fetchImpl });
  assert.equal(result.categories[0].resolvedCategory.source, 'ug-opt');
  assert.deepEqual(result.categories[0].candidates, []);
  assert.equal(result.categories[0].failure, undefined);
});

test('maps HTTP 404, HTTP 500, and network errors to explicit notFound failures', async (t) => {
  const cases = [
    ['404', { status: 404 }, 'http', 404],
    ['500', { status: 500 }, 'http', 500],
    ['network', new Error('offline'), 'network', null],
  ];
  for (const [label, routeValue, kind, status] of cases) {
    await t.test(label, async () => {
      const sourceUrl = `https://ug-opt.in.ua/ua/g-${label}`;
      const routes = new Map([[route(sourceUrl, 1), routeValue]]);
      const { fetchImpl } = fakeFetch(routes);
      const result = await collectUgoptCategories({ categories: [category(label, label, sourceUrl)] }, { fetchImpl });
      const failed = result.categories[0];
      assert.equal(failed.resolution, 'notFound');
      assert.deepEqual(failed.candidates, []);
      assert.equal(failed.failure.kind, kind);
      assert.equal(failed.failure.status ?? null, status);
    });
  }
});

test('maps unexpected category HTML to an explicit parse failure', async () => {
  const sourceUrl = 'https://ug-opt.in.ua/ua/g-unexpected';
  const routes = new Map([[route(sourceUrl, 1), { body: '<html><body>unexpected page</body></html>' }]]);
  const { fetchImpl } = fakeFetch(routes);
  const result = await collectUgoptCategories({ categories: [category('unexpected', 'Несподівана', sourceUrl)] }, { fetchImpl });

  assert.equal(result.categories[0].resolution, 'notFound');
  assert.deepEqual(result.categories[0].candidates, []);
  assert.equal(result.categories[0].pagesFetched, 0);
  assert.equal(result.categories[0].failure.kind, 'parse');
});

test('does not return partial candidates when a required later page fails', async () => {
  const sourceUrl = 'https://ug-opt.in.ua/ua/g-later-failure';
  const routes = new Map([
    [route(sourceUrl, 1), { body: page({ pageCount: 3, cards: card({ id: 41, sku: '41', title: 'Перша сторінка' }) }) }],
    [route(sourceUrl, 2), { status: 500 }],
  ]);
  const { fetchImpl, calls } = fakeFetch(routes);

  const result = await collectUgoptCategories({ categories: [category('later-failure', 'Пізній збій', sourceUrl)] }, { fetchImpl });
  assert.deepEqual(calls, [route(sourceUrl, 1), route(sourceUrl, 2)]);
  assert.equal(result.categories[0].resolution, 'notFound');
  assert.deepEqual(result.categories[0].candidates, []);
  assert.equal(result.categories[0].pagesFetched, 1);
  assert.equal(result.categories[0].failure.kind, 'http');
  assert.equal(result.categories[0].failure.status, 500);
});

test('rejects non-UG-OPT hosts before calling fetch', async (t) => {
  const invalidUrls = [
    'https://example.com/category',
    'http://localhost/category',
    'http://127.0.0.1/category',
  ];
  for (const sourceCategoryUrl of invalidUrls) {
    await t.test(sourceCategoryUrl, async () => {
      let calls = 0;
      const fetchImpl = async () => {
        calls += 1;
        throw new Error('fetch must not be called');
      };
      await assert.rejects(
        () => collectUgoptCategories({ categories: [category('invalid-host', 'Недійсна', sourceCategoryUrl)] }, { fetchImpl }),
        /allowed UG-OPT hostname/u,
      );
      assert.equal(calls, 0);
    });
  }
});

test('passes candidates through Product Selector with category and total limits', async () => {
  const first = 'https://ug-opt.in.ua/ua/g-first';
  const second = 'https://ug-opt.in.ua/ua/g-second';
  const routes = new Map([
    [route(first, 1), { body: page({ cards: `${card({ id: 1, sku: 'shared', title: 'Спільний перший' })}${card({ id: 2, sku: 'a-2', title: 'A2' })}` }) }],
    [route(second, 1), { body: page({ cards: `${card({ id: 3, sku: 'shared', title: 'Спільний другий' })}${card({ id: 4, sku: 'b-2', title: 'B2' })}` }) }],
  ]);
  const { fetchImpl } = fakeFetch(routes);
  const result = await collectAndSelectUgoptCategories({
    categories: [category('a', 'A', first, 1), category('b', 'B', second, 2)],
    totalLimit: 2,
  }, { fetchImpl });
  assert.deepEqual(result.selection.selectedProducts.map((item) => item.product.supplierSku), ['shared', 'b-2']);
  assert.equal(result.selection.categories[0].selectedCount, 1);
  assert.equal(result.selection.categories[1].selectedCount, 1);
  assert.equal(result.selection.summary.duplicateCount, 1);
  assert.equal(result.collectedRequest.categories[0].limit, 1);
});

test('rejects malformed runtime category input before fetching', async () => {
  await assert.rejects(() => collectUgoptCategories({ categories: [{ requestKey: 'bad', requestedName: 'Bad' }] }, { fetchImpl: async () => ({}) }), /sourceCategoryUrl/u);
  await assert.rejects(() => collectUgoptCategories({ categories: 'not-an-array' }), /categories must be an array/u);
});
