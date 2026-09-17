import assert from 'node:assert/strict';
import test from 'node:test';

import { collectCurrentUgoptCatalogSnapshot } from '../../../src/suppliers/ugopt/current-catalog-snapshot.mjs';

const catalog = [{ supplier: 'ug-opt', sourceCategoryName: 'Hair tools', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/hair' }];

function candidate({ price = 230.45 } = {}) {
  return {
    selectionKey: 'ugopt:SKU-1',
    product: {
      sourceProductId: '1',
      supplierSku: 'SKU-1',
      sourceUrl: 'https://ug-opt.in.ua/ua/p/1',
      title: 'Hair tool',
      price,
    },
  };
}

test('live snapshot provider composes existing catalog and adapter data without inventing availability', async () => {
  const snapshot = await collectCurrentUgoptCatalogSnapshot({
    productionRequest: { mode: 'EXPLICIT_CATEGORIES', categories: [{ requestKey: 'hair', requestedName: 'Hair tools' }] },
    catalogLoader: async () => catalog,
    adapterCollector: async ({ categories }) => ({
      categories: categories.map((category) => ({ ...category, resolution: 'resolved', candidates: [candidate()] })),
    }),
  });
  assert.deepEqual(snapshot.scope, { requestedCategoryKeys: ['hair'], completedCategoryKeys: ['hair'], failedCategoryKeys: [] });
  assert.equal(snapshot.complete, true);
  assert.deepEqual(snapshot.products[0], {
    productKey: 'ugopt:SKU-1', supplier: 'ug-opt', supplierSku: 'SKU-1', sourceUrl: 'https://ug-opt.in.ua/ua/p/1',
    availability: 'UNKNOWN', purchasePriceMinor: 23045, currency: 'UAH', categoryKey: 'hair',
    provenance: { source: 'ug-opt-category-adapter', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/hair', sourceCategoryName: 'Hair tools', sourceProductId: '1' },
  });
});

test('partial category collection remains explicitly untrusted and does not omit the failed scope', async () => {
  const snapshot = await collectCurrentUgoptCatalogSnapshot({
    productionRequest: { mode: 'EXPLICIT_CATEGORIES', categories: [{ requestKey: 'hair', requestedName: 'Hair tools' }] },
    catalogLoader: async () => catalog,
    adapterCollector: async ({ categories }) => ({
      categories: categories.map((category) => ({ ...category, resolution: 'notFound', candidates: [], failure: { kind: 'network' } })),
    }),
  });
  assert.deepEqual(snapshot.scope, { requestedCategoryKeys: ['hair'], completedCategoryKeys: [], failedCategoryKeys: ['hair'] });
  assert.equal(snapshot.complete, false);
  assert.deepEqual(snapshot.products, []);
});
