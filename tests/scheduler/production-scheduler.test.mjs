import assert from 'node:assert/strict';
import test from 'node:test';

import { createDurableProductionService } from '../../src/operations/durable-production-service.mjs';
import { runEndToEndProduction } from '../../src/orchestration/end-to-end-production-runner.mjs';
import { nextDailyLocalRun, normalizeSchedulerConfig, runScheduledProductionCycle } from '../../src/scheduler/production-scheduler.mjs';
import { openProductionStateStore } from '../../src/state/production-state-store.mjs';

function snapshot({ price = 100, availability = 'SELLABLE' } = {}) {
  return {
    supplier: 'ug-opt',
    scope: { requestedCategoryKeys: ['hair'], completedCategoryKeys: ['hair'], failedCategoryKeys: [] },
    complete: true,
    products: [{ productKey: 'product', supplier: 'ug-opt', availability, purchasePriceMinor: price, currency: 'UAH', categoryKey: 'hair', provenance: { source: 'test' } }],
  };
}

function config() {
  return { scheduleId: 'daily', databasePath: ':memory:', productionRequestPath: 'request.json', dailyLocalTime: '10:30', runId: 'daily-run', leaseDurationMs: 1000 };
}

test('next daily local schedule uses exact local time and rolls to tomorrow after it passes', () => {
  assert.equal(nextDailyLocalRun('2026-09-13T09:00:00.000Z', '10:30').getHours(), 10);
  assert.equal(nextDailyLocalRun('2026-09-13T11:00:00.000Z', '10:30').getDate(), new Date('2026-09-14T11:00:00.000Z').getDate());
  assert.throws(() => normalizeSchedulerConfig({ ...config(), dailyLocalTime: undefined }), /exactly one/u);
});

test('first supplier baseline persists without a NEW alert; price transition produces one deduplicated warning', async () => {
  let now = '2026-09-13T10:00:00.000Z';
  let id = 0;
  const store = openProductionStateStore({ databasePath: ':memory:', clock: { now: () => now }, idGenerator: (prefix) => `${prefix}-${++id}` });
  const service = createDurableProductionService({ store, runner: async () => ({ status: 'COMPLETED', summary: {}, products: [], operatorTasks: [] }) });
  const request = { mode: 'EXPLICIT_CATEGORIES', categories: [] };
  const first = await runScheduledProductionCycle({ config: config(), store, service, productionRequest: request, snapshotProvider: async () => snapshot(), clock: { now: () => now }, ownerId: 'one' });
  assert.equal(first.alertsCreated, 0);
  assert.equal(store.listRepricingRequirements('daily-run').length, 0);
  now = '2026-09-14T10:00:00.000Z';
  const second = await runScheduledProductionCycle({ config: config(), store, service, productionRequest: request, snapshotProvider: async () => snapshot({ price: 150 }), clock: { now: () => now }, ownerId: 'one' });
  assert.equal(second.alertsCreated, 1);
  assert.equal(store.listAlerts().length, 1);
  store.close();
});

test('same logical scheduler cycle is not executed twice', async () => {
  const now = '2026-09-13T10:00:00.000Z';
  const store = openProductionStateStore({ databasePath: ':memory:', clock: { now: () => now }, idGenerator: (prefix) => `${prefix}-id` });
  const service = createDurableProductionService({ store, runner: async () => ({ status: 'COMPLETED', summary: {}, products: [], operatorTasks: [] }) });
  const input = { config: config(), store, service, productionRequest: { mode: 'EXPLICIT_CATEGORIES', categories: [] }, snapshotProvider: async () => snapshot(), clock: { now: () => now }, ownerId: 'one' };
  assert.equal((await runScheduledProductionCycle(input)).status, 'COMPLETED');
  assert.equal((await runScheduledProductionCycle(input)).status, 'ALREADY_PROCESSED');
  store.close();
});

test('confirmed unavailable active store product creates a critical alert without any store mutation', async () => {
  let now = '2026-09-13T10:00:00.000Z';
  let id = 0;
  const store = openProductionStateStore({ databasePath: ':memory:', clock: { now: () => now }, idGenerator: (prefix) => `${prefix}-${++id}` });
  const service = createDurableProductionService({ store, runner: async () => ({ status: 'COMPLETED', summary: {}, products: [], operatorTasks: [] }) });
  const activeConfig = { ...config(), activeStoreProducts: [{ productKey: 'product', active: true }] };
  await runScheduledProductionCycle({ config: activeConfig, store, service, productionRequest: { mode: 'EXPLICIT_CATEGORIES', categories: [] }, snapshotProvider: async () => snapshot(), clock: { now: () => now }, ownerId: 'one' });
  now = '2026-09-14T10:00:00.000Z';
  await runScheduledProductionCycle({ config: activeConfig, store, service, productionRequest: { mode: 'EXPLICIT_CATEGORIES', categories: [] }, snapshotProvider: async () => snapshot({ availability: 'UNAVAILABLE' }), clock: { now: () => now }, ownerId: 'one' });
  assert.equal(store.listAlerts().some((alert) => alert.severity === 'CRITICAL' && alert.eventType === 'ACTIVE_STORE_SUPPLIER_RISK'), true);
  store.close();
});

const repriceCatalog = [{ supplier: 'ug-opt', sourceCategoryName: 'Hair tools', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/hair' }];
const repriceKey = 'ugopt:SKU-1';
const repriceCandidate = {
  selectionKey: repriceKey,
  product: { sourceProductId: '1', supplierSku: 'SKU-1', sourceUrl: 'https://ug-opt.in.ua/ua/p/1', title: 'Hair tool', price: 100 },
};
const repricePolicy = {
  marketEvidence: {
    minimumComparableCount: 3, minimumExactComparableCount: 1, activeListingsOnly: true, allowedSources: null,
    outlierPolicy: { method: 'none' }, minimumReadyConfidence: 'HIGH',
    confidence: { high: { minimumComparableCount: 5, minimumExactComparableCount: 3, minimumSourceCount: 2 }, medium: { minimumComparableCount: 3, minimumExactComparableCount: 1, minimumSourceCount: 1 } },
  },
  competition: { targetMarketPosition: 'median', priceStepMinor: 1, undercutMinor: 0, maximumAboveMarketMedianBps: 0, maximumAboveMarketUpperBoundBps: 0 },
  profitability: { rules: [{ id: 'fixture', minimumNetProfitMinor: 1000, minimumRoiBps: 2000, minimumNetMarginBps: 1000 }] },
  ranking: { order: ['status', 'netProfitMinor', 'roiBps', 'netMarginBps', 'marketConfidenceRank', 'productKey'] },
  selection: { maxProducts: 6000 },
};

function repriceEvidence() {
  return {
    productKey: repriceKey,
    comparables: [220, 225, 230, 235, 240].map((amount, index) => ({
      source: index < 3 ? 'market-a' : 'market-b', listingId: `listing-${index}`, seller: 'seller', title: 'Hair tool',
      price: { amount: String(amount), currency: 'UAH' }, available: true, brand: 'VGR', model: 'V-1',
      productIdentityEvidence: { productKey: repriceKey }, matchType: 'exact', matchConfidence: 'high',
    })),
  };
}

function repriceSnapshot(price) {
  return {
    supplier: 'ug-opt', scope: { requestedCategoryKeys: ['hair'], completedCategoryKeys: ['hair'], failedCategoryKeys: [] }, complete: true,
    products: [{ productKey: repriceKey, supplier: 'ug-opt', supplierSku: 'SKU-1', sourceUrl: 'https://ug-opt.in.ua/ua/p/1', availability: 'SELLABLE', purchasePriceMinor: price, currency: 'UAH', categoryKey: 'hair', provenance: { source: 'fixture' } }],
  };
}

test('a trusted PR23 price change injects the current price into PR27, invalidates stale economics, and resolves only after fresh PR22 evaluation', async () => {
  let now = '2026-09-13T10:00:00.000Z';
  let id = 0;
  const store = openProductionStateStore({ databasePath: ':memory:', clock: { now: () => now }, idGenerator: (prefix) => `${prefix}-${++id}` });
  const seen = [];
  const runner = async (request, options) => {
    seen.push(structuredClone(request));
    return runEndToEndProduction(request, options);
  };
  const service = createDurableProductionService({
    store,
    runner,
    runnerOptions: {
      catalogLoader: async () => repriceCatalog,
      adapterCollector: async ({ categories }) => ({ categories: categories.map((category) => ({ ...category, resolution: 'resolved', resolvedCategory: repriceCatalog[0], candidates: [repriceCandidate] })) }),
      pricing: { policy: repricePolicy, commission: { rateBps: 2000, source: 'fixture', categoryId: 'hair', provenance: { source: 'fixture' } } },
    },
  });
  const request = {
    mode: 'EXPLICIT_CATEGORIES', categories: [{ requestKey: 'hair', requestedName: 'Hair tools' }],
    productInputs: {
      [repriceKey]: {
        pricingProduct: { productKey: repriceKey, supplier: { name: 'ug-opt', purchasePrice: { amount: '100.00', currency: 'UAH' }, provenance: { source: 'stale' } }, identity: { brand: 'VGR', model: 'V-1' } },
        sourceFacts: { type: 'Фен', brand: 'VGR', model: 'V-1' }, marketEvidence: repriceEvidence(),
      },
    },
  };
  await runScheduledProductionCycle({ config: config(), store, service, productionRequest: request, snapshotProvider: async () => repriceSnapshot(10000), clock: { now: () => now }, ownerId: 'one' });
  now = '2026-09-14T10:00:00.000Z';
  const changed = await runScheduledProductionCycle({ config: config(), store, service, productionRequest: request, snapshotProvider: async () => repriceSnapshot(15000), clock: { now: () => now }, ownerId: 'one' });
  assert.equal(changed.status, 'WAITING_FOR_OPERATOR', JSON.stringify(changed));
  assert.equal(changed.waitingTaskSummary.MARKET_RESEARCH, 1);
  assert.equal(seen[1].productInputs[repriceKey].pricingProduct.supplier.purchasePrice.amount, '150.00');
  assert.equal(Object.hasOwn(seen[1].productInputs[repriceKey], 'marketEvidence'), false);
  assert.equal(Object.hasOwn(seen[1].productInputs[repriceKey], 'pricingDecision'), false);
  assert.equal(store.listRepricingRequirements('daily-run').length, 1);

  const marketTask = store.listOperatorTasks('daily-run').find((task) => task.taskType === 'MARKET_RESEARCH');
  service.importDurableOperatorArtifacts({ runId: 'daily-run', artifacts: [{ taskId: marketTask.taskId, taskType: 'MARKET_RESEARCH', artifact: repriceEvidence() }] });
  const refreshed = await service.resumeDurableProductionRun({ runId: 'daily-run' });
  assert.equal(store.listRepricingRequirements('daily-run').length, 0, JSON.stringify(refreshed.result.pricing));
  assert.equal(store.listRepricingRequirements('daily-run', { state: 'RESOLVED' }).length, 1);
  assert.equal(store.reconstructRequest('daily-run').productInputs[repriceKey].pricingProduct.supplier.purchasePrice.amount, '150.00');
  await service.resumeDurableProductionRun({ runId: 'daily-run' });
  assert.equal(seen.at(-1).productInputs[repriceKey].pricingProduct.supplier.purchasePrice.amount, '150.00');
  assert.equal(store.listRepricingRequirements('daily-run').length, 0);
  assert.equal(store.listOperatorTasks('daily-run').filter((task) => task.taskType === 'MARKET_RESEARCH').length, 0);
  store.close();
});
