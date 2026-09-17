import assert from 'node:assert/strict';
import test from 'node:test';

import { END_TO_END_RUN_STATUSES, runEndToEndProduction } from '../../src/orchestration/end-to-end-production-runner.mjs';

const category = { supplier: 'ug-opt', sourceCategoryName: 'Hair tools', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-hair', parentNames: ['Beauty'] };

function candidate(index, { price = 90 } = {}) {
  const productKey = `ugopt:${String(index).padStart(5, '0')}`;
  return {
    selectionKey: productKey,
    product: {
      sourceProductId: String(index),
      supplierSku: `SKU-${index}`,
      sourceUrl: `https://ug-opt.in.ua/ua/p/${index}`,
      title: `Hair tool ${index}`,
      price,
    },
  };
}

function sourceFacts(index) {
  return { type: 'Фен', brand: 'VGR', model: `V-${index}`, color: 'чорний' };
}

function evidence(productKey, index, base = 220) {
  return {
    productKey,
    comparables: [base, base + 5, base + 10, base + 15, base + 20].map((price, item) => ({
      source: item < 3 ? 'market-a' : 'market-b',
      listingId: `${productKey}-${item + 1}`,
      seller: 'seller',
      title: `Фен VGR V-${index}`,
      price: { amount: String(price), currency: 'UAH' },
      available: true,
      brand: 'VGR',
      model: `V-${index}`,
      productIdentityEvidence: { productKey },
      matchType: 'exact',
      matchConfidence: 'high',
    })),
  };
}

const pricingPolicy = {
  marketEvidence: {
    minimumComparableCount: 3,
    minimumExactComparableCount: 1,
    activeListingsOnly: true,
    allowedSources: null,
    outlierPolicy: { method: 'none' },
    minimumReadyConfidence: 'HIGH',
    confidence: {
      high: { minimumComparableCount: 5, minimumExactComparableCount: 3, minimumSourceCount: 2 },
      medium: { minimumComparableCount: 3, minimumExactComparableCount: 1, minimumSourceCount: 1 },
    },
  },
  competition: {
    targetMarketPosition: 'median', priceStepMinor: 1, undercutMinor: 0,
    maximumAboveMarketMedianBps: 0, maximumAboveMarketUpperBoundBps: 0,
  },
  profitability: { rules: [{ id: 'fixture', minimumNetProfitMinor: 1000, minimumRoiBps: 2000, minimumNetMarginBps: 1000 }] },
  ranking: { order: ['status', 'netProfitMinor', 'roiBps', 'netMarginBps', 'marketConfidenceRank', 'productKey'] },
  selection: { maxProducts: 6000 },
};

const commission = { rateBps: 2000, source: 'fixture', categoryId: 'cat', provenance: { source: 'fixture' } };

function collector(candidates, { fail = false } = {}) {
  return async ({ categories }) => ({
    categories: categories.map((item) => (fail ? {
      ...item, resolution: 'notFound', candidates: [], failure: { kind: 'network', message: 'offline fixture' },
    } : {
      ...item, resolution: 'resolved', resolvedCategory: category, candidates,
    })),
  });
}

function options(candidates, extra = {}) {
  return {
    catalogLoader: async () => [category],
    adapterCollector: collector(candidates, extra),
    pricing: { policy: pricingPolicy, commission },
  };
}

function explicitRequest(candidates, { evidenceForAll = false } = {}) {
  const productInputs = Object.fromEntries(candidates.map((item, index) => [item.selectionKey, {
    sourceFacts: sourceFacts(index + 1),
    ...(evidenceForAll ? { marketEvidence: evidence(item.selectionKey, index + 1) } : {}),
  }]));
  return {
    mode: 'EXPLICIT_CATEGORIES',
    categories: [{ requestKey: 'hair', requestedName: 'Hair tools' }],
    productInputs,
  };
}

function quotaOptions(groups) {
  const categories = Object.keys(groups).map((requestKey) => ({
    supplier: 'ug-opt',
    sourceCategoryName: requestKey,
    sourceCategoryUrl: `https://ug-opt.in.ua/ua/${requestKey}`,
  }));
  return {
    catalogLoader: async () => categories,
    adapterCollector: async ({ categories: requested }) => ({
      categories: requested.map((item) => ({
        ...item,
        resolution: 'resolved',
        resolvedCategory: categories.find((entry) => entry.sourceCategoryName === item.requestedName),
        candidates: groups[item.requestKey],
      })),
    }),
    pricing: { policy: pricingPolicy, commission },
  };
}

function quotaRequest(groups, limits, { bases = {}, includeFacts = true } = {}) {
  const productInputs = {};
  for (const entries of Object.values(groups)) {
    for (const item of entries) {
      const index = Number(item.product.sourceProductId);
      productInputs[item.selectionKey] = {
        ...(includeFacts ? { sourceFacts: sourceFacts(index) } : {}),
        marketEvidence: evidence(item.selectionKey, index, bases[item.selectionKey] ?? 220),
      };
    }
  }
  return {
    mode: 'EXPLICIT_CATEGORIES',
    categories: Object.keys(groups).map((requestKey) => ({
      requestKey,
      requestedName: requestKey,
      ...(limits[requestKey] === undefined ? {} : { limit: limits[requestKey] }),
    })),
    productInputs,
  };
}

test('missing market evidence yields one independent MARKET_RESEARCH task per candidate and no content/photo task', async () => {
  const products = [candidate(1), candidate(2)];
  const result = await runEndToEndProduction(explicitRequest(products), options(products));
  assert.equal(result.status, END_TO_END_RUN_STATUSES.WAITING_FOR_OPERATOR);
  assert.deepEqual(result.operatorTasks.map((task) => [task.productKey, task.taskType]), [
    ['ugopt:00001', 'MARKET_RESEARCH'], ['ugopt:00002', 'MARKET_RESEARCH'],
  ]);
  assert.equal(result.summary.waitingContent, 0);
  assert.equal(result.summary.waitingPhotos, 0);
});

test('ranking is performed before PR25 content work and only selected products receive content tasks', async () => {
  const products = [candidate(1), candidate(2), candidate(3)];
  const request = { ...explicitRequest(products, { evidenceForAll: true }), maxProducts: 2 };
  const result = await runEndToEndProduction(request, options(products));
  assert.equal(result.selected.selectedCount, 2);
  assert.equal(result.summary.waitingContent, 2);
  assert.equal(result.operatorTasks.filter((task) => task.taskType === 'CONTENT_GENERATION').length, 2);
  assert.equal(result.products.filter((item) => item.workflowStatus === 'NOT_SELECTED_BY_PR22_RANKING').length, 1);
  assert.equal(result.operatorTasks.some((task) => task.taskType.startsWith('PHOTO_')), false);
});

test('PRICE_REVIEW is excluded from PR25 work while another product independently waits for market research', async () => {
  const reviewed = candidate(1);
  const waiting = candidate(2);
  const request = explicitRequest([reviewed, waiting]);
  request.productInputs[reviewed.selectionKey].marketEvidence = {
    ...evidence(reviewed.selectionKey, 1),
    comparables: evidence(reviewed.selectionKey, 1).comparables.slice(0, 2),
  };
  const result = await runEndToEndProduction(request, options([reviewed, waiting]));
  assert.equal(result.summary.pricingReview, 1);
  assert.equal(result.summary.waitingMarketResearch, 1);
  assert.deepEqual(result.operatorTasks.map((task) => task.taskType), ['MARKET_RESEARCH']);
  assert.equal(result.operatorTasks.some((task) => task.productKey === reviewed.selectionKey), false);
});

test('mixed candidates preserve independent current operator states', async () => {
  const content = candidate(1);
  const market = candidate(2);
  const request = explicitRequest([content, market]);
  request.productInputs[content.selectionKey].marketEvidence = evidence(content.selectionKey, 1);
  const result = await runEndToEndProduction(request, options([content, market]));
  assert.deepEqual(result.operatorTasks.map((task) => [task.productKey, task.taskType]), [
    [market.selectionKey, 'MARKET_RESEARCH'],
    [content.selectionKey, 'CONTENT_GENERATION'],
  ]);
});

test('full-catalog mode consumes dynamic catalog entries and preserves a supplier category failure', async () => {
  const products = [candidate(1)];
  const result = await runEndToEndProduction({ mode: 'FULL_CATALOG' }, options(products, { fail: true }));
  assert.equal(result.catalog.mode, 'FULL_CATALOG');
  assert.equal(result.summary.categoriesFailed, 1);
  assert.ok(result.diagnostics.some((item) => item.code === 'SUPPLIER_CATEGORY_FAILED'));
  assert.notEqual(JSON.stringify(result), JSON.stringify({ availability: 'UNAVAILABLE' }));
});

test('category limit selects the strongest three only after all ten category candidates are priced', async () => {
  const products = Array.from({ length: 10 }, (_, index) => candidate(index + 1));
  const groups = { A: products };
  const bases = Object.fromEntries(products.map((item, index) => [item.selectionKey, 220 + index * 20]));
  const result = await runEndToEndProduction(quotaRequest(groups, { A: 3 }, { bases }), quotaOptions(groups));
  assert.equal(result.pricing.decisions.length, 10);
  assert.deepEqual(result.selected.selected.map((item) => item.productKey), [
    products[9].selectionKey, products[8].selectionKey, products[7].selectionKey,
  ]);
  assert.equal(result.selected.categorySelectedCounts.A, 3);
});

test('multiple category quotas are applied after all category candidates are economically evaluated', async () => {
  const groups = {
    A: [candidate(1), candidate(2), candidate(3), candidate(4)],
    B: [candidate(5), candidate(6), candidate(7), candidate(8)],
  };
  const result = await runEndToEndProduction(quotaRequest(groups, { A: 2, B: 3 }), quotaOptions(groups));
  assert.equal(result.pricing.decisions.length, 8);
  assert.deepEqual(result.selected.categorySelectedCounts, { A: 2, B: 3 });
  assert.equal(result.selected.selectedCount, 5);
});

test('a short category never pads its final quota', async () => {
  const groups = { A: Array.from({ length: 17 }, (_, index) => candidate(index + 1)) };
  const result = await runEndToEndProduction(quotaRequest(groups, { A: 100 }), quotaOptions(groups));
  assert.equal(result.selected.readyCount, 17);
  assert.equal(result.selected.selectedCount, 17);
  assert.equal(result.selected.categorySelectedCounts.A, 17);
});

test('late stronger supplier candidates displace weak early candidates within the same category quota', async () => {
  const products = [candidate(1), candidate(2), candidate(3), candidate(4)];
  const groups = { A: products };
  const bases = {
    [products[0].selectionKey]: 220,
    [products[1].selectionKey]: 225,
    [products[2].selectionKey]: 450,
    [products[3].selectionKey]: 500,
  };
  const result = await runEndToEndProduction(quotaRequest(groups, { A: 2 }, { bases }), quotaOptions(groups));
  assert.deepEqual(result.selected.selected.map((item) => item.productKey), [products[3].selectionKey, products[2].selectionKey]);
});

test('global maxProducts remains enforced while two category quotas allow more than 6000 candidates', async () => {
  const groups = {
    A: Array.from({ length: 4000 }, (_, index) => candidate(index + 1)),
    B: Array.from({ length: 4000 }, (_, index) => candidate(index + 4001)),
  };
  const result = await runEndToEndProduction(quotaRequest(groups, { A: 4000, B: 4000 }, { includeFacts: false }), quotaOptions(groups));
  assert.equal(result.pricing.decisions.length, 8000);
  assert.equal(result.selected.selectedCount, 6000);
  assert.ok(result.selected.categorySelectedCounts.A <= 4000);
  assert.ok(result.selected.categorySelectedCounts.B <= 4000);
});

test('PRICE_REVIEW and SKIP decisions never consume a category final quota', async () => {
  const review = candidate(1);
  const skip = candidate(2, { price: 300 });
  const ready = candidate(3);
  const groups = { A: [review, skip, ready] };
  const request = quotaRequest(groups, { A: 1 }, { bases: { [skip.selectionKey]: 100 } });
  request.productInputs[review.selectionKey].marketEvidence.comparables = request.productInputs[review.selectionKey].marketEvidence.comparables.slice(0, 2);
  const result = await runEndToEndProduction(request, quotaOptions(groups));
  assert.equal(result.selected.selectedCount, 1);
  assert.equal(result.selected.selected[0].productKey, ready.selectionKey);
  assert.equal(result.selected.reviewCount, 1);
  assert.equal(result.selected.skipCount, 1);
  assert.equal(result.selected.categorySelectedCounts.A, 1);
});

for (const size of [100, 1000]) {
  test(`${size} candidates keep independent Plus-first market tasks`, async () => {
    const products = Array.from({ length: size }, (_, index) => candidate(index + 1));
    const result = await runEndToEndProduction(explicitRequest(products), options(products));
    assert.equal(result.summary.candidateProducts, size);
    assert.equal(result.operatorTasks.length, size);
    assert.equal(result.operatorTasks.every((task) => task.taskType === 'MARKET_RESEARCH'), true);
  });
}

test('more than 6000 economically READY candidates are ranked globally and capped only after pricing', async () => {
  const size = 6001;
  const products = Array.from({ length: size }, (_, index) => candidate(index + 1));
  const result = await runEndToEndProduction(explicitRequest(products, { evidenceForAll: true }), options(products));
  assert.equal(result.pricing.decisions.length, size);
  assert.equal(result.selected.readyCount, size);
  assert.equal(result.selected.selectedCount, 6000);
  assert.equal(result.selected.notSelectedReady.length, 1);
  assert.equal(result.summary.selectedProducts, 6000);
});

test('input/output remain deterministic and caller-owned', async () => {
  const products = [candidate(1)];
  const request = explicitRequest(products);
  const config = options(products);
  const beforeRequest = structuredClone(request);
  const result = await runEndToEndProduction(request, config);
  assert.deepEqual(request, beforeRequest);
  assert.equal(result.status, END_TO_END_RUN_STATUSES.WAITING_FOR_OPERATOR);
});

test('explicit Excel request delegates to the PR26 exporter without constructing a second writer', async () => {
  const calls = [];
  const request = {
    mode: 'EXPLICIT_CATEGORIES',
    categories: [],
    export: { inputPath: 'source.xlsx', outputPath: 'result.xlsx', mappingOptions: { sheet: 'Products' } },
  };
  const result = await runEndToEndProduction(request, {
    ...options([]),
    excelExporter: async (input) => {
      calls.push(input);
      return { status: 'READY_FOR_EXCEL', products: [] };
    },
  });
  assert.deepEqual(calls, [{ inputPath: 'source.xlsx', outputPath: 'result.xlsx', products: [], mappingOptions: { sheet: 'Products' } }]);
  assert.deepEqual(result.export, { status: 'READY_FOR_EXCEL', products: [] });
});
