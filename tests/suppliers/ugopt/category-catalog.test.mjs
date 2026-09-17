import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { resolveCategoryRequests } from '../../../src/categories/category-resolver.mjs';
import { loadUgoptCategoryCatalog, UgoptCategoryCatalogError, UGOPT_CATEGORY_CATALOG_URL } from '../../../src/suppliers/ugopt/category-catalog.mjs';
import { parseUgoptCategoryCatalogHtml, UgoptCategoryCatalogParseError } from '../../../src/suppliers/ugopt/category-catalog-parser.mjs';

const fixture = fs.readFileSync(new URL('../../fixtures/ugopt-category-catalog.html', import.meta.url), 'utf8');

test('parses the full supplier group catalog in source order with proven hierarchy', () => {
  const catalog = parseUgoptCategoryCatalogHtml(fixture);
  assert.equal(catalog.length, 20);
  assert.deepEqual(catalog.slice(0, 6).map((entry) => entry.sourceCategoryName), [
    'Побутова техніка',
    'Настільні плити/Електропліти',
    'Пилососи',
    'Праски',
    'Усе для укладання Волосся',
    'Фени',
  ]);
  assert.equal(catalog[0].parentNames, undefined);
  assert.deepEqual(catalog[5].parentNames, ['Усе для укладання Волосся']);
  assert.equal(catalog[5].sourceCategoryUrl, 'https://ug-opt.in.ua/ua/g38298691-feny');
  const hidden = catalog.find((entry) => entry.sourceCategoryName === 'Тестери, мультиметри');
  assert.deepEqual(hidden, {
    supplier: 'ug-opt',
    sourceCategoryName: 'Тестери, мультиметри',
    sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g38298672-testery-multimetry',
    parentNames: ['1000 Мелочів для дому'],
  });
});

test('includes real child categories from multiple branches and resolves literal Фени', () => {
  const catalog = parseUgoptCategoryCatalogHtml(fixture);
  const names = new Set(catalog.map((entry) => entry.sourceCategoryName));
  assert.equal(names.has('Фени'), true);
  assert.equal(names.has('Настільні плити/Електропліти'), true);
  assert.equal(names.has('Іграшки'), true);
  assert.equal(names.has('Тестери, мультиметри'), true);

  const resolved = resolveCategoryRequests({ categories: [{ requestKey: 'dryers', requestedName: 'Фени' }] }, catalog);
  assert.equal(resolved.categories[0].resolution, 'resolved');
  assert.equal(resolved.categories[0].resolvedCategory.sourceCategoryUrl, 'https://ug-opt.in.ua/ua/g38298691-feny');
});

test('deduplicates exact URLs first-seen while retaining same-name different URLs', () => {
  const catalog = parseUgoptCategoryCatalogHtml(fixture);
  assert.equal(catalog.filter((entry) => entry.sourceCategoryUrl.endsWith('/g41339869-bytovaya-tehnika')).length, 1);
  const sameName = catalog.filter((entry) => entry.sourceCategoryName === 'Дитячі товари');
  assert.deepEqual(sameName.map((entry) => entry.sourceCategoryUrl), [
    'https://ug-opt.in.ua/ua/g116006932-detskie-tovary',
    'https://ug-opt.in.ua/ua/g107153154-detskie-tovary',
  ]);
  const resolved = resolveCategoryRequests({ categories: [{ requestKey: 'children', requestedName: 'Дитячі товари' }] }, catalog);
  assert.equal(resolved.categories[0].resolution, 'ambiguous');
});

test('excludes unrelated and product links because they are outside proven category anchors', () => {
  const catalog = parseUgoptCategoryCatalogHtml(fixture);
  const urls = catalog.map((entry) => entry.sourceCategoryUrl);
  assert.equal(urls.some((url) => url.includes('/p123-product')), false);
  assert.equal(urls.some((url) => url.includes('/cart')), false);
  assert.equal(urls.some((url) => url.includes('example.com')), false);
});

test('recognized outer catalog with changed category markup fails instead of becoming empty', () => {
  const changed = `
    <ul class="cs-product-groups-list">
      <li class="cs-product-groups-list__item"><a class="changed-category-link" href="/ua/g38298691-feny">Фени</a></li>
    </ul>`;
  assert.throws(() => parseUgoptCategoryCatalogHtml(changed), UgoptCategoryCatalogParseError);
  assert.throws(() => parseUgoptCategoryCatalogHtml('<html><body>error page</body></html>'), UgoptCategoryCatalogParseError);
  assert.throws(() => parseUgoptCategoryCatalogHtml(null), UgoptCategoryCatalogParseError);
});

test('ignores an HTML comment before the full product-groups catalog', () => {
  const withComment = `<!-- catalog comment -->${fixture}`;
  assert.deepEqual(parseUgoptCategoryCatalogHtml(withComment), parseUgoptCategoryCatalogHtml(fixture));
});

test('ignores HTML comments inside groups and subgroups while preserving order', () => {
  const withComments = fixture
    .replace('<li class="cs-product-groups-list__item cs-online-edit">', '<!-- before group --><li class="cs-product-groups-list__item cs-online-edit">')
    .replace('<ul class="cs-product-groups-list__sublist cs-product-subgroups">', '<ul class="cs-product-groups-list__sublist cs-product-subgroups"><!-- inside subgroup list -->')
    .replace('<li class="cs-product-subgroups__item"><a class="cs-product-subgroups__title" href="/ua/g38298691-feny">', '<!-- before child --><li class="cs-product-subgroups__item"><a class="cs-product-subgroups__title" href="/ua/g38298691-feny">');
  const baseline = parseUgoptCategoryCatalogHtml(fixture);
  const parsed = parseUgoptCategoryCatalogHtml(withComments);
  assert.deepEqual(parsed, baseline);
  assert.deepEqual(parsed.slice(0, 6).map((entry) => entry.sourceCategoryName), baseline.slice(0, 6).map((entry) => entry.sourceCategoryName));
});

test('does not turn HTML comments into category entries', () => {
  const withComment = fixture.replace('</ul>\n  </body>', '<!-- Фени https://ug-opt.in.ua/ua/g999-comment-only -->\n    </ul>\n  </body>');
  const catalog = parseUgoptCategoryCatalogHtml(withComment);
  assert.equal(catalog.length, parseUgoptCategoryCatalogHtml(fixture).length);
  assert.equal(catalog.some((entry) => entry.sourceCategoryName.includes('comment-only')), false);
});

test('loads the catalog through injected fetch and feeds the existing resolver offline', async () => {
  const calls = [];
  const catalog = await loadUgoptCategoryCatalog({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, text: async () => fixture };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, UGOPT_CATEGORY_CATALOG_URL);
  const resolved = resolveCategoryRequests({ categories: [{ requestKey: 'dryers', requestedName: 'Фени' }] }, catalog);
  assert.equal(resolved.categories[0].resolution, 'resolved');
  assert.equal(resolved.categories[0].resolvedCategory.sourceCategoryUrl, 'https://ug-opt.in.ua/ua/g38298691-feny');
});

test('reports HTTP, network, response-read, and parse failures explicitly without retries', async (t) => {
  const cases = [
    ['http', async () => ({ ok: false, status: 503 }), 'http'],
    ['network', async () => { throw new Error('offline'); }, 'network'],
    ['read', async () => ({ ok: true, text: async () => { throw new Error('broken body'); } }), 'network'],
    ['parse', async () => ({ ok: true, text: async () => '<html>not the menu</html>' }), 'parse'],
  ];
  for (const [label, fetchImpl, kind] of cases) {
    await t.test(label, async () => {
      let calls = 0;
      const wrappedFetch = async (...args) => {
        calls += 1;
        return fetchImpl(...args);
      };
      await assert.rejects(
        () => loadUgoptCategoryCatalog({ sourceUrl: 'https://ug-opt.in.ua/ua/test-catalog', fetchImpl: wrappedFetch }),
        (error) => error instanceof UgoptCategoryCatalogError && error.kind === kind,
      );
      assert.equal(calls, 1);
    });
  }
});

test('rejects non-UG-OPT catalog sources before making a request', async (t) => {
  for (const sourceUrl of ['https://example.com/ua/', 'http://localhost/ua/', 'http://127.0.0.1/ua/', 'https://ug-opt.in.ua/ru/']) {
    await t.test(sourceUrl, async () => {
      let calls = 0;
      await assert.rejects(
        () => loadUgoptCategoryCatalog({ sourceUrl, fetchImpl: async () => { calls += 1; } }),
        /UG-OPT hostname|Ukrainian catalog/u,
      );
      assert.equal(calls, 0);
    });
  }
});
