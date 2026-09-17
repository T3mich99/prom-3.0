import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UGOPT_AVAILABILITY_STATES,
  UGOPT_CHANGE_EVENTS,
  UGOPT_RISK_CODES,
  UgoptCatalogOperationalError,
  UgoptCatalogSnapshotError,
  advanceUgoptMonitorState,
  buildUgoptCatalogSnapshot,
  compareUgoptCatalogSnapshots,
  formatUgoptDailySummary,
  validateUgoptCatalogSnapshot,
} from '../../../src/suppliers/ugopt/daily-catalog-sync.mjs';

const SCOPE = {
  requestedCategoryKeys: ['home', 'tools'],
  completedCategoryKeys: ['home', 'tools'],
  failedCategoryKeys: [],
};

function product(productKey, overrides = {}) {
  return {
    productKey,
    supplier: 'ug-opt',
    supplierSku: productKey.toUpperCase(),
    sourceUrl: `https://ug-opt.in.ua/ua/p-${encodeURIComponent(productKey)}.html`,
    availability: 'SELLABLE',
    purchasePriceMinor: 10000,
    currency: 'UAH',
    categoryKey: 'home',
    provenance: { adapter: 'test-fixture' },
    ...overrides,
  };
}

function snapshot(products, overrides = {}) {
  return buildUgoptCatalogSnapshot({
    supplier: 'ug-opt',
    scope: SCOPE,
    complete: true,
    products,
    ...overrides,
  });
}

function partialSnapshot(products, failedCategoryKeys = ['tools']) {
  return buildUgoptCatalogSnapshot({
    supplier: 'ug-opt',
    scope: {
      requestedCategoryKeys: ['home', 'tools'],
      completedCategoryKeys: ['home'],
      failedCategoryKeys,
    },
    complete: false,
    products,
  });
}

function keys(list) {
  return list.map((item) => item.productKey);
}

test('valid full snapshot is normalized and sorted without mutating products', () => {
  const products = [product('b'), product('a')];
  const before = structuredClone(products);
  const result = snapshot(products);
  assert.equal(result.complete, true);
  assert.deepEqual(keys(result.products), ['a', 'b']);
  assert.deepEqual(products, before);
  assert.equal(result.products[0].provenance.adapter, 'test-fixture');
});

test('valid partial snapshot remains explicit and unsafe for removal', () => {
  const result = partialSnapshot([product('a')]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.scope.failedCategoryKeys, ['tools']);
});

test('invalid snapshot is rejected as a snapshot contract error', () => {
  assert.throws(() => validateUgoptCatalogSnapshot({}), (error) => error instanceof UgoptCatalogSnapshotError && error.code === 'UGOPT_SNAPSHOT_INVALID');
});

test('duplicate productKey is rejected', () => {
  assert.throws(() => snapshot([product('a'), product('a')]), /duplicate productKey/u);
});

test('negative minor price is rejected', () => {
  assert.throws(() => snapshot([product('a', { purchasePriceMinor: -1 })]), /non-negative/u);
});

test('invalid minor price type is rejected', () => {
  assert.throws(() => snapshot([product('a', { purchasePriceMinor: '10000' })]), /safe integer/u);
});

test('invalid supplier is rejected', () => {
  assert.throws(() => snapshot([product('a', { supplier: 'other' })]), /supplier must be ug-opt/u);
});

test('full trusted snapshot diff has no false removals', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a')]) });
  assert.equal(report.summary.removedCount, 0);
  assert.deepEqual(report.changes.removed, []);
});

test('identical trusted snapshots produce no meaningful delta', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a')]) });
  assert.equal(report.summary.newProductCount, 0);
  assert.equal(report.summary.priceChangedCount, 0);
  assert.equal(report.summary.backInStockCount, 0);
  assert.equal(report.summary.reappearedCount, 0);
  assert.equal(report.products[0].changeEvents[0], UGOPT_CHANGE_EVENTS.UNCHANGED);
});

test('product input order does not change semantic report', () => {
  const previous = snapshot([product('a'), product('b')]);
  const first = compareUgoptCatalogSnapshots({ previousSnapshot: previous, currentSnapshot: snapshot([product('b', { purchasePriceMinor: 11000 }), product('a')]) });
  const second = compareUgoptCatalogSnapshots({ previousSnapshot: previous, currentSnapshot: snapshot([product('a'), product('b', { purchasePriceMinor: 11000 })]) });
  assert.deepEqual(first, second);
});

test('first trusted scan creates a baseline without new alerts', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([product('a'), product('b')]) });
  assert.equal(report.baselineCreated, true);
  assert.equal(report.summary.newProductCount, 0);
  assert.deepEqual(report.changes.newProducts, []);
});

test('new product event is emitted only after a trusted previous snapshot', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a'), product('b')]) });
  assert.deepEqual(keys(report.changes.newProducts), ['b']);
  assert.equal(report.changes.newProducts[0].changeEvents.includes(UGOPT_CHANGE_EVENTS.NEW_SUPPLIER_PRODUCT), true);
});

test('new product exposes a pricing evaluation candidate', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a'), product('b')]) });
  assert.deepEqual(report.newProductCandidates, [{ productKey: 'b', requiresPricingEvaluation: true }]);
});

test('sellable product remains sellable', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a')]) });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.SELLABLE);
});

test('sellable to unavailable emits BECAME_UNAVAILABLE', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a', { availability: 'UNAVAILABLE', purchasePriceMinor: undefined })]) });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.UNAVAILABLE);
  assert.deepEqual(report.changes.unavailable.map((item) => item.changeEvents), [[UGOPT_CHANGE_EVENTS.BECAME_UNAVAILABLE]]);
});

test('unavailable to sellable emits BACK_IN_STOCK', () => {
  const previous = snapshot([product('a', { availability: 'UNAVAILABLE', purchasePriceMinor: undefined })]);
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: previous, currentSnapshot: snapshot([product('a')]) });
  assert.deepEqual(report.changes.backInStock.map((item) => item.productKey), ['a']);
  assert.equal(report.changes.backInStock[0].requiresRepricing, true);
});

test('trusted absence in the same scope emits REMOVED_FROM_SUPPLIER', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([]) });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.REMOVED);
  assert.deepEqual(report.changes.removed.map((item) => item.productKey), ['a']);
});

test('missing product in a partial scan is not removed', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: partialSnapshot([]) });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.AT_RISK);
  assert.deepEqual(report.changes.removed, []);
});

test('failed category product is at risk', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a', { categoryKey: 'tools' })]), currentSnapshot: partialSnapshot([]) });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.AT_RISK);
  assert.equal(report.products[0].diagnostics[0].code, 'INCOMPLETE_SCAN');
});

test('5000 to 1200 partial scan does not mass-remove 3800 products', () => {
  const previous = snapshot(Array.from({ length: 5000 }, (_, index) => product(`p-${String(index).padStart(4, '0')}`, { categoryKey: 'home' })));
  const current = partialSnapshot(Array.from({ length: 1200 }, (_, index) => product(`p-${String(index).padStart(4, '0')}`, { categoryKey: 'home' })));
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: previous, currentSnapshot: current });
  assert.equal(report.summary.removedCount, 0);
  assert.equal(report.summary.atRiskCount, 3800);
});

test('zero-product incomplete scan creates zero confirmed removals', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a'), product('b')]), currentSnapshot: partialSnapshot([]) });
  assert.equal(report.summary.removedCount, 0);
  assert.equal(report.summary.atRiskCount, 2);
});

test('contradictory complete metadata is rejected', () => {
  assert.throws(() => buildUgoptCatalogSnapshot({ scope: { requestedCategoryKeys: ['home'], completedCategoryKeys: [], failedCategoryKeys: [] }, complete: true, products: [] }), /contradicts/u);
});

test('product moved category with the same productKey is not removed', () => {
  const current = snapshot([product('a', { categoryKey: 'tools' })]);
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: current });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.SELLABLE);
  assert.deepEqual(report.changes.removed, []);
});

test('price increase is reported in integer minor units', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a', { purchasePriceMinor: 10000 })]), currentSnapshot: snapshot([product('a', { purchasePriceMinor: 12500 })]) });
  assert.equal(report.summary.priceChangedCount, 1);
  assert.equal(report.changes.priceChanged[0].absoluteDeltaMinor, 2500);
});

test('price decrease is reported with a negative delta', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a', { purchasePriceMinor: 12500 })]), currentSnapshot: snapshot([product('a', { purchasePriceMinor: 10000 })]) });
  assert.equal(report.changes.priceChanged[0].absoluteDeltaMinor, 2500);
  assert.equal(report.changes.priceChanged[0].deltaMinor, -2500);
});

test('unchanged price does not create PRICE_CHANGED', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a', { purchasePriceMinor: 10000 })]), currentSnapshot: snapshot([product('a', { purchasePriceMinor: 10000 })]) });
  assert.equal(report.summary.priceChangedCount, 0);
});

test('missing current price is not interpreted as zero', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a', { purchasePriceMinor: 10000 })]), currentSnapshot: snapshot([product('a', { purchasePriceMinor: undefined })]) });
  assert.equal(report.summary.priceChangedCount, 0);
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.AT_RISK);
  assert.equal(report.products[0].diagnostics[0].code, 'PURCHASE_PRICE_MISSING');
});

test('price change can coexist with becoming unavailable', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a', { purchasePriceMinor: 10000 })]), currentSnapshot: snapshot([product('a', { availability: 'UNAVAILABLE', purchasePriceMinor: 12000 })]) });
  assert.deepEqual(report.products[0].changeEvents, [UGOPT_CHANGE_EVENTS.BECAME_UNAVAILABLE, UGOPT_CHANGE_EVENTS.PRICE_CHANGED]);
});

test('price change requires repricing', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a', { purchasePriceMinor: 12000 })]) });
  assert.deepEqual(report.repricingCandidates.map((item) => item.productKey), ['a']);
});

test('reappearance from monitor state requires repricing', () => {
  const previous = snapshot([]);
  const monitorState = { supplier: 'ug-opt', products: [{ productKey: 'a', lastKnownSupplierState: 'REMOVED' }] };
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: previous, currentSnapshot: snapshot([product('a')]), monitorState });
  assert.deepEqual(report.changes.reappeared.map((item) => item.productKey), ['a']);
  assert.deepEqual(report.repricingCandidates.map((item) => item.productKey), ['a']);
});

test('active store plus sellable has no critical risk', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a')]), activeStoreProducts: [{ productKey: 'a', active: true }] });
  assert.deepEqual(report.storeRisks.critical, []);
});

test('active store plus unavailable has critical risk', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a', { availability: 'UNAVAILABLE', purchasePriceMinor: undefined })]), activeStoreProducts: [{ productKey: 'a', active: true }] });
  assert.equal(report.storeRisks.critical[0].riskCode, UGOPT_RISK_CODES.CRITICAL_SUPPLIER_FULFILLMENT_RISK);
});

test('active store plus removed has critical risk', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([]), activeStoreProducts: [{ productKey: 'a', active: true }] });
  assert.equal(report.storeRisks.critical[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.REMOVED);
});

test('active store plus at-risk has uncertain risk', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: partialSnapshot([]), activeStoreProducts: [{ productKey: 'a', active: true }] });
  assert.equal(report.storeRisks.uncertain[0].riskCode, UGOPT_RISK_CODES.SUPPLIER_STATE_UNCERTAIN);
});

test('inactive store product does not create a risk', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([]), activeStoreProducts: [{ productKey: 'a', active: false }] });
  assert.deepEqual(report.storeRisks, { critical: [], uncertain: [] });
});

test('duplicate active-store productKey is rejected', () => {
  assert.throws(() => compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([]), activeStoreProducts: [{ productKey: 'a', active: true }, { productKey: 'a', active: false }] }), /duplicate active store/u);
});

test('cross-product isolation keeps one price event attached to its key', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a'), product('b')]), currentSnapshot: snapshot([product('a'), product('b', { purchasePriceMinor: 11000 })]) });
  assert.deepEqual(report.changes.priceChanged.map((item) => item.productKey), ['b']);
  assert.equal(report.products.find((item) => item.productKey === 'a').requiresRepricing, false);
});

test('provider failure is at risk and never unavailable', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([product('a', { availability: 'UNKNOWN', observation: { status: 'PROVIDER_FAILURE', code: 'UGOPT_PRODUCT_FETCH_FAILURE', message: 'timeout' } })]) });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.AT_RISK);
  assert.equal(report.products[0].diagnostics[0].code, 'UGOPT_PRODUCT_FETCH_FAILURE');
});

test('provider failure can be surfaced as an operational builder error', () => {
  assert.throws(() => buildUgoptCatalogSnapshot({ providerError: 'catalog timeout' }), (error) => error instanceof UgoptCatalogOperationalError && error.code === 'UGOPT_PROVIDER_FAILURE');
});

test('comparison does not mutate snapshots, store input, or monitor state', () => {
  const previous = snapshot([product('a')]);
  const current = snapshot([product('a', { purchasePriceMinor: 12000 })]);
  const active = [{ productKey: 'a', active: true, provenance: { source: 'store' } }];
  const monitor = { supplier: 'ug-opt', products: [{ productKey: 'old', lastKnownSupplierState: 'REMOVED' }] };
  const before = structuredClone({ previous, current, active, monitor });
  compareUgoptCatalogSnapshots({ previousSnapshot: previous, currentSnapshot: current, activeStoreProducts: active, monitorState: monitor });
  assert.deepEqual({ previous, current, active, monitor }, before);
});

test('full report is deterministic for identical inputs', () => {
  const input = { previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('b'), product('a', { purchasePriceMinor: 11000 })]) };
  assert.deepEqual(compareUgoptCatalogSnapshots(input), compareUgoptCatalogSnapshots(structuredClone(input)));
});

test('report collections are sorted by productKey', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('z'), product('b'), product('a')]) });
  assert.deepEqual(keys(report.products), ['a', 'b', 'z']);
  assert.deepEqual(keys(report.changes.newProducts), ['b', 'z']);
});

test('summary counts expose all required counters', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a'), product('b')]), currentSnapshot: snapshot([product('a', { availability: 'UNAVAILABLE', purchasePriceMinor: undefined }), product('c', { purchasePriceMinor: 11000 })]), activeStoreProducts: [{ productKey: 'a', active: true }] });
  assert.deepEqual(Object.keys(report.summary), [
    'previousProductCount', 'currentProductCount', 'sellableCount', 'unavailableCount', 'atRiskCount', 'removedCount',
    'newProductCount', 'backInStockCount', 'reappearedCount', 'priceChangedCount', 'repricingRequiredCount',
    'criticalActiveStoreRiskCount', 'uncertainActiveStoreRiskCount',
  ]);
});

test('first scan can expose observed unavailable state without a transition alert', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([product('a', { availability: 'UNAVAILABLE', purchasePriceMinor: undefined })]) });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.UNAVAILABLE);
  assert.deepEqual(report.changes.unavailable, []);
});

test('explicit unavailable remains confirmed despite unrelated category failure', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: partialSnapshot([product('a', { availability: 'UNAVAILABLE', purchasePriceMinor: undefined })]) });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.UNAVAILABLE);
});

test('successful observed products are not poisoned by another failed category', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: partialSnapshot([product('a', { categoryKey: 'home' })]) });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.SELLABLE);
});

test('unknown availability is explicit and becomes at-risk', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([product('a', { availability: 'UNKNOWN' })]) });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.AT_RISK);
  assert.equal(report.products[0].diagnostics[0].code, 'AVAILABILITY_UNKNOWN');
});

test('unsupported currency is rejected rather than converted', () => {
  assert.throws(() => snapshot([product('a', { currency: 'USD' })]), /currency must be UAH/u);
});

test('scope mismatch blocks removals', () => {
  const current = snapshot([], { scope: { requestedCategoryKeys: ['home'], completedCategoryKeys: ['home'], failedCategoryKeys: [] } });
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: current });
  assert.equal(report.summary.removedCount, 0);
  assert.equal(report.summary.atRiskCount, 1);
  assert.equal(report.diagnostics.some((item) => item.code === 'SCOPE_MISMATCH'), true);
});

test('removed state is preserved in monitor state', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([]) });
  assert.equal(report.nextMonitorState.products[0].lastKnownSupplierState, UGOPT_AVAILABILITY_STATES.REMOVED);
});

test('monitor state can be advanced independently of comparison', () => {
  const result = advanceUgoptMonitorState({ currentSnapshot: snapshot([product('a')]) });
  assert.equal(result.products[0].lastKnownSupplierState, UGOPT_AVAILABILITY_STATES.SELLABLE);
});

test('historical removed state produces REAPPEARED rather than NEW', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([]), currentSnapshot: snapshot([product('a')]), monitorState: { supplier: 'ug-opt', products: [{ productKey: 'a', lastKnownSupplierState: 'REMOVED' }] } });
  assert.deepEqual(report.products[0].changeEvents, [UGOPT_CHANGE_EVENTS.REAPPEARED]);
  assert.deepEqual(report.changes.newProducts, []);
});

test('reappeared sellable product is included in repricing candidates', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([]), currentSnapshot: snapshot([product('a')]), monitorState: { supplier: 'ug-opt', products: [{ productKey: 'a', lastKnownSupplierState: 'REMOVED' }] } });
  assert.equal(report.repricingCandidates[0].requiresRepricing, true);
});

test('same productKey remains identity when title-like provenance changes', () => {
  const previous = snapshot([product('a', { provenance: { title: 'Old title' } })]);
  const current = snapshot([product('a', { provenance: { title: 'New title' } })]);
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: previous, currentSnapshot: current });
  assert.equal(report.summary.newProductCount, 0);
  assert.equal(report.summary.removedCount, 0);
});

test('same supplier SKU does not override a distinct productKey', () => {
  const current = snapshot([product('a', { supplierSku: 'shared' }), product('b', { supplierSku: 'shared' })]);
  assert.deepEqual(keys(current.products), ['a', 'b']);
});

test('complete flag requires every requested category to be covered', () => {
  const result = partialSnapshot([product('a')], []);
  assert.equal(result.complete, false);
  assert.deepEqual(result.scope.completedCategoryKeys, ['home']);
});

test('category keys outside scope are rejected', () => {
  assert.throws(() => snapshot([product('a', { categoryKey: 'missing' })]), /outside requested scope/u);
});

test('failed and completed category overlap is rejected', () => {
  assert.throws(() => buildUgoptCatalogSnapshot({ scope: { requestedCategoryKeys: ['home'], completedCategoryKeys: ['home'], failedCategoryKeys: ['home'] }, complete: false, products: [] }), /completed and failed/u);
});

test('empty requested scope cannot claim completeness', () => {
  assert.throws(() => buildUgoptCatalogSnapshot({ scope: { requestedCategoryKeys: [], completedCategoryKeys: [], failedCategoryKeys: [] }, complete: true, products: [] }), /contradicts/u);
});

test('product provenance is required', () => {
  const invalid = product('a');
  delete invalid.provenance;
  assert.throws(() => snapshot([invalid]), /provenance/u);
});

test('source URL is validated as UG-OPT provenance', () => {
  assert.throws(() => snapshot([product('a', { sourceUrl: 'https://example.invalid/a' })]), /UG-OPT/u);
});

test('unknown supplier availability does not create an unavailable event', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a', { availability: 'UNKNOWN' })]) });
  assert.equal(report.changes.unavailable.length, 0);
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.AT_RISK);
});

test('current provider conflict remains at risk', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([product('a', { availability: 'SELLABLE', observation: { status: 'CONFLICT', message: 'two signals' } })]) });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.AT_RISK);
});

test('unavailable product does not require a price to be classified unavailable', () => {
  const result = snapshot([product('a', { availability: 'UNAVAILABLE', purchasePriceMinor: undefined })]);
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: result });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.UNAVAILABLE);
});

test('new unavailable product is not a sellable pricing candidate', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([]), currentSnapshot: snapshot([product('a', { availability: 'UNAVAILABLE', purchasePriceMinor: undefined })]) });
  assert.deepEqual(report.newProductCandidates, [{ productKey: 'a', requiresPricingEvaluation: true }]);
});

test('active unknown store product is uncertain when not observed', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([]), activeStoreProducts: [{ productKey: 'unseen', active: true }] });
  assert.equal(report.storeRisks.uncertain[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.AT_RISK);
});

test('store risk lists are deterministic', () => {
  const active = [{ productKey: 'b', active: true }, { productKey: 'a', active: true }];
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a'), product('b')]), currentSnapshot: snapshot([]), activeStoreProducts: active });
  assert.deepEqual(keys(report.storeRisks.critical), ['a', 'b']);
});

test('formatter is deterministic and human-readable', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([product('a')]) });
  const text = formatUgoptDailySummary(report);
  assert.match(text, /Перевірено: 1/u);
  assert.equal(text, formatUgoptDailySummary(report));
});

test('100-product fixture follows the same validation rules', () => {
  const result = snapshot(Array.from({ length: 100 }, (_, index) => product(`p-${index}`, { categoryKey: index % 2 ? 'tools' : 'home' })));
  assert.equal(result.products.length, 100);
});

test('1000-product fixture follows the same validation rules', () => {
  const result = snapshot(Array.from({ length: 1000 }, (_, index) => product(`p-${index}`, { categoryKey: index % 2 ? 'tools' : 'home' })));
  assert.equal(result.products.length, 1000);
});

test('6000-product fixture follows the same validation rules', () => {
  const result = snapshot(Array.from({ length: 6000 }, (_, index) => product(`p-${index}`, { categoryKey: index % 2 ? 'tools' : 'home' })));
  assert.equal(result.products.length, 6000);
});

test('large comparison uses keyed lookup and preserves all keys', () => {
  const previous = snapshot(Array.from({ length: 100 }, (_, index) => product(`p-${index}`)));
  const current = snapshot(Array.from({ length: 100 }, (_, index) => product(`p-${index}`, { purchasePriceMinor: index === 50 ? 10100 : 10000 })));
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: previous, currentSnapshot: current });
  assert.equal(report.products.length, 100);
  assert.deepEqual(keys(report.changes.priceChanged), ['p-50']);
});

test('no pricing decision is generated by the monitor', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a', { purchasePriceMinor: 10100 })]) });
  assert.equal(Object.hasOwn(report, 'pricingDecision'), false);
  assert.equal(Object.hasOwn(report, 'sellingPrice'), false);
});

test('no automatic store mutation operation is generated', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([]), activeStoreProducts: [{ productKey: 'a', active: true }] });
  assert.equal(Object.hasOwn(report, 'mutations'), false);
  assert.equal(Object.hasOwn(report, 'promWrite'), false);
});

test('snapshot scanId is caller supplied and preserved', () => {
  const result = snapshot([product('a')], { scanId: 'daily-2026-09-12' });
  assert.equal(result.scanId, 'daily-2026-09-12');
});

test('snapshot builder does not create a scanId', () => {
  const result = snapshot([product('a')]);
  assert.equal(Object.hasOwn(result, 'scanId'), false);
});

test('monitor state input is not required for ordinary comparison', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a')]) });
  assert.equal(report.nextMonitorState.supplier, 'ug-opt');
});

test('current scope failure is visible in report diagnostics', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: partialSnapshot([]) });
  assert.equal(report.diagnostics.some((item) => item.code === 'INCOMPLETE_SCAN'), true);
});

test('previous untrusted snapshot blocks new-product alert flood', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: partialSnapshot([product('a')]), currentSnapshot: snapshot([product('a'), product('b')]) });
  assert.equal(report.summary.newProductCount, 0);
  assert.equal(report.diagnostics.some((item) => item.code === 'PREVIOUS_SNAPSHOT_UNTRUSTED'), true);
});

test('previous untrusted snapshot blocks removal even when current is complete', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: partialSnapshot([product('a')]), currentSnapshot: snapshot([]) });
  assert.equal(report.summary.removedCount, 0);
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.AT_RISK);
});

test('same product key isolates availability transitions from supplier SKU changes', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a', { supplierSku: 'old' })]), currentSnapshot: snapshot([product('a', { supplierSku: 'new' })]) });
  assert.equal(report.summary.newProductCount, 0);
  assert.equal(report.summary.removedCount, 0);
});

test('monitor state rejects duplicate keys', () => {
  assert.throws(() => compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([]), monitorState: { supplier: 'ug-opt', products: [{ productKey: 'a', lastKnownSupplierState: 'REMOVED' }, { productKey: 'a', lastKnownSupplierState: 'REMOVED' }] } }), /duplicate monitor/u);
});

test('monitor state rejects unsupported availability', () => {
  assert.throws(() => compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([]), monitorState: { supplier: 'ug-opt', products: [{ productKey: 'a', lastKnownSupplierState: 'UNKNOWN' }] } }), /invalid/u);
});

test('invalid active store record is rejected', () => {
  assert.throws(() => compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([]), activeStoreProducts: [{ productKey: 'a', active: 'yes' }] }), /active must be boolean/u);
});

test('valid source provenance can include a URL without changing identity', () => {
  const result = snapshot([product('a', { provenance: { sourceUrl: 'https://ug-opt.in.ua/ua/p-a.html' } })]);
  assert.equal(result.products[0].productKey, 'a');
});

test('report distinguishes unavailable state from removal event', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a')]), currentSnapshot: snapshot([product('a', { availability: 'UNAVAILABLE', purchasePriceMinor: undefined })]) });
  assert.equal(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.UNAVAILABLE);
  assert.equal(report.changes.removed.length, 0);
});

test('report distinguishes at-risk state from unavailable state', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([product('a', { availability: 'UNKNOWN' })]) });
  assert.notEqual(report.products[0].availabilityStatus, UGOPT_AVAILABILITY_STATES.UNAVAILABLE);
});

test('report includes explicit current scope for later consumers', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([product('a')]) });
  assert.deepEqual(report.currentSnapshot.scope, SCOPE);
});

test('report current product payload retains supplier provenance', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([product('a')]) });
  assert.equal(report.products[0].product.provenance.adapter, 'test-fixture');
});

test('unavailable event remains isolated to the affected product', () => {
  const report = compareUgoptCatalogSnapshots({ previousSnapshot: snapshot([product('a'), product('b')]), currentSnapshot: snapshot([product('a', { availability: 'UNAVAILABLE', purchasePriceMinor: undefined }), product('b')]) });
  assert.deepEqual(report.changes.unavailable.map((item) => item.productKey), ['a']);
  assert.equal(report.products.find((item) => item.productKey === 'b').availabilityStatus, UGOPT_AVAILABILITY_STATES.SELLABLE);
});

test('report has no timestamp or random fields', () => {
  const report = compareUgoptCatalogSnapshots({ currentSnapshot: snapshot([product('a')]) });
  assert.equal(Object.hasOwn(report, 'timestamp'), false);
  assert.equal(Object.hasOwn(report, 'createdAt'), false);
  assert.equal(Object.hasOwn(report, 'randomId'), false);
});

test('operational provider error is not represented as a removal', () => {
  assert.throws(() => buildUgoptCatalogSnapshot({ providerError: 'HTTP 503' }), (error) => error instanceof UgoptCatalogOperationalError);
});
