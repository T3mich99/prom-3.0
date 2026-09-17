import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MARKET_PRICING_POLICY,
  MARKET_CONFIDENCE,
  PRICING_STATUSES,
  MarketPricingError,
  PricingContractError,
  collectMarketEvidence,
  evaluatePricingBatch,
  evaluateProductPricing,
  rankPricingDecisions,
  resolvePricingPolicy,
  selectTopProfitableProducts,
} from '../../src/pricing/market-pricing.mjs';

const product = ({ key = 'p-1', purchase = '90.00', brand = 'VGR', model = 'V-451', currency = 'UAH', costs } = {}) => ({
  productKey: key,
  identity: { brand, model },
  supplier: {
    name: 'ug-opt',
    purchasePrice: { amount: purchase, currency },
    provenance: { sourceUrl: `https://ug-opt.in.ua/ua/p/${key}`, supplierSku: key },
    ...(costs === undefined ? {} : { otherConfiguredCosts: { amount: costs, currency: 'UAH' } }),
    supplierSku: key,
  },
});

const comparable = (key, price, overrides = {}) => ({
  source: overrides.source ?? 'market-a',
  listingId: overrides.listingId ?? `${key}-${price}`,
  url: overrides.url,
  seller: 'seller',
  title: 'Фен VGR V-451',
  price: { amount: String(price), currency: overrides.currency ?? 'UAH' },
  available: overrides.available ?? true,
  brand: overrides.brand ?? 'VGR',
  model: overrides.model ?? 'V-451',
  productIdentityEvidence: { productKey: key },
  matchType: overrides.matchType ?? 'exact',
  matchConfidence: overrides.matchConfidence ?? 'high',
});

const comparablesFor = (key, prices = ['220.00', '225.00', '230.00', '240.00', '250.00']) => prices.map((price, index) => comparable(key, price, {
  source: index < 3 ? 'market-a' : 'market-b',
  listingId: `${key}-listing-${index + 1}`,
}));

const policy = (overrides = {}) => resolvePricingPolicy({
  marketEvidence: {
    minimumComparableCount: 3,
    minimumExactComparableCount: 1,
    activeListingsOnly: true,
    allowedSources: null,
    outlierPolicy: { method: 'none' },
    minimumReadyConfidence: MARKET_CONFIDENCE.HIGH,
    confidence: {
      high: { minimumComparableCount: 5, minimumExactComparableCount: 3, minimumSourceCount: 2 },
      medium: { minimumComparableCount: 3, minimumExactComparableCount: 1, minimumSourceCount: 1 },
    },
    ...(overrides.marketEvidence ?? {}),
  },
  competition: {
    targetMarketPosition: 'median',
    priceStepMinor: 1,
    undercutMinor: 0,
    maximumAboveMarketMedianBps: 0,
    maximumAboveMarketUpperBoundBps: 0,
    ...(overrides.competition ?? {}),
  },
  profitability: {
    rules: [{ id: 'fixture-default', minimumNetProfitMinor: 1000, minimumRoiBps: 2000, minimumNetMarginBps: 1000 }],
    ...(overrides.profitability ?? {}),
  },
  ranking: {
    order: ['status', 'netProfitMinor', 'roiBps', 'netMarginBps', 'marketConfidenceRank', 'productKey'],
    ...(overrides.ranking ?? {}),
  },
  selection: {
    maxProducts: 6000,
    ...(overrides.selection ?? {}),
  },
});

const commission = (rateBps = 2000) => ({
  rateBps,
  source: 'prom-category-config',
  categoryId: 'cat-1',
  provenance: { source: 'fixture', category: 'cat-1' },
});

const researcherFor = (factory) => async (candidate) => ({
  productKey: candidate.productKey,
  comparables: factory(candidate),
});

const evaluate = (candidate = product(), options = {}) => evaluateProductPricing(candidate, {
  policy: policy(),
  commission: commission(),
  researcher: researcherFor((item) => comparablesFor(item.productKey)),
  ...options,
});

function rankingDecision(productKey, status, profit, roi = 1000, margin = 1000, confidence = MARKET_CONFIDENCE.HIGH) {
  return {
    productKey,
    status,
    market: { confidence },
    profitability: {
      netProfit: { amountMinor: profit, currency: 'UAH' },
      roiBps: roi,
      netMarginBps: margin,
    },
  };
}

test('valid pricing policy is explicit and has no hidden profitability defaults', () => {
  const resolved = policy();
  assert.equal(resolved.selection.maxProducts, 6000);
  assert.equal(resolved.competition.targetMarketPosition, 'median');
  assert.deepEqual(DEFAULT_MARKET_PRICING_POLICY.profitability.rules, []);
  assert.deepEqual(resolved.marketEvidence.outlierPolicy, { method: 'none' });
});

test('invalid pricing policy is rejected as configuration error', () => {
  assert.throws(() => resolvePricingPolicy({ selection: { maxProducts: 6001 } }), (error) => error instanceof PricingContractError);
  assert.throws(() => resolvePricingPolicy({ competition: { targetMarketPosition: 'mean' } }), /targetMarketPosition/u);
  assert.throws(() => resolvePricingPolicy({ marketEvidence: { outlierPolicy: { method: 'iqr' } } }), /outlierPolicy/u);
});

test('overlapping profitability tiers are rejected', () => {
  assert.throws(() => resolvePricingPolicy({ profitability: { rules: [
    { id: 'low', maxPurchaseMinor: 10_000, minimumNetProfitMinor: 100 },
    { id: 'overlap', minPurchaseMinor: 10_000, minimumNetProfitMinor: 200 },
  ] } }), (error) => error.code === 'AMBIGUOUS_PROFIT_POLICY');
});

test('supplier purchase price is required', async () => {
  const candidate = product();
  delete candidate.supplier.purchasePrice;
  await assert.rejects(() => evaluate(candidate), (error) => error instanceof PricingContractError && error.code === 'SUPPLIER_PRICE_REQUIRED');
});

test('only UG-OPT supplier authority is accepted', async () => {
  const candidate = product();
  candidate.supplier.name = 'other-supplier';
  await assert.rejects(() => evaluate(candidate), (error) => error instanceof PricingContractError && error.code === 'SUPPLIER_INVALID');
});

test('zero and negative purchase prices are rejected', async () => {
  await assert.rejects(() => evaluate(product({ purchase: '0.00' })), (error) => error.code === 'INVALID_MONEY');
  await assert.rejects(() => evaluate(product({ purchase: '-1.00' })), (error) => error.code === 'INVALID_MONEY');
});

test('UAH supplier purchase price is accepted and provenance is preserved', async () => {
  const result = await evaluate();
  assert.equal(result.supplier.purchasePrice.currency, 'UAH');
  assert.equal(result.supplier.purchasePrice.amountMinor, 9000);
  assert.equal(result.supplier.provenance.supplierSku, 'p-1');
});

test('unsupported supplier currency is review without FX conversion', async () => {
  const result = await evaluate(product({ currency: 'EUR' }));
  assert.equal(result.status, PRICING_STATUSES.PRICE_REVIEW);
  assert.ok(result.reasonCodes.includes('SUPPLIER_CURRENCY_UNSUPPORTED'));
  assert.equal(result.diagnostics.currencyConversionApplied, false);
});

test('exact brand and model comparable is accepted', async () => {
  const result = await evaluate();
  assert.equal(result.market.acceptedComparableCount, 5);
  assert.equal(result.market.exactComparableCount, 5);
});

test('wrong verified model is rejected conservatively', async () => {
  const result = await evaluate(product(), {
    researcher: researcherFor((item) => comparablesFor(item.productKey).map((entry) => ({ ...entry, model: 'V-999' }))),
  });
  assert.equal(result.status, PRICING_STATUSES.PRICE_REVIEW);
  assert.ok(result.reasonCodes.includes('MARKET_EVIDENCE_INSUFFICIENT'));
  assert.equal(result.market.rejectedComparables.every((entry) => entry.reasonCode === 'WRONG_MODEL'), true);
});

test('wrong verified brand is rejected conservatively', async () => {
  const result = await evaluate(product(), {
    researcher: researcherFor((item) => comparablesFor(item.productKey).map((entry) => ({ ...entry, brand: 'Other' }))),
  });
  assert.equal(result.market.acceptedComparableCount, 0);
  assert.equal(result.market.rejectedComparables[0].reasonCode, 'WRONG_BRAND');
});

test('ambiguous comparable causes PRICE_REVIEW rather than SKIP', async () => {
  const result = await evaluate(product(), {
    researcher: researcherFor((item) => [
      ...comparablesFor(item.productKey),
      comparable(item.productKey, '260.00', { matchType: 'ambiguous', matchConfidence: 'medium', listingId: `${item.productKey}-ambiguous` }),
    ]),
  });
  assert.equal(result.status, PRICING_STATUSES.PRICE_REVIEW);
  assert.ok(result.reasonCodes.includes('AMBIGUOUS_COMPARABLE'));
});

test('unavailable comparables are excluded and diagnosed', async () => {
  const result = await evaluate(product(), {
    researcher: researcherFor((item) => [comparable(item.productKey, '100.00', { available: false }), ...comparablesFor(item.productKey).slice(1)]),
  });
  assert.equal(result.market.rejectedComparables[0].reasonCode, 'COMPARABLE_UNAVAILABLE');
  assert.equal(result.market.acceptedComparableCount, 4);
});

test('zero, negative, malformed, and unsupported market prices are rejected', async () => {
  const result = await evaluate(product(), {
    researcher: researcherFor((item) => [
      comparable(item.productKey, '0.00'),
      comparable(item.productKey, '-1.00', { listingId: `${item.productKey}-negative` }),
      { ...comparable(item.productKey, '100.00', { listingId: `${item.productKey}-bad` }), price: { amount: 'not-money', currency: 'UAH' } },
      comparable(item.productKey, '100.00', { listingId: `${item.productKey}-eur`, currency: 'EUR' }),
      ...comparablesFor(item.productKey),
    ]),
  });
  const codes = new Set(result.market.rejectedComparables.map((entry) => entry.reasonCode));
  assert.ok(codes.has('COMPARABLE_PRICE_INVALID'));
  assert.ok(codes.has('COMPARABLE_UNSUPPORTED_CURRENCY'));
});

test('exact duplicate market listing is counted once', async () => {
  const result = await evaluate(product(), {
    researcher: researcherFor((item) => [
      ...comparablesFor(item.productKey),
      { ...comparable(item.productKey, '230.00', { listingId: `${item.productKey}-listing-1` }), title: 'same listing duplicate' },
    ]),
  });
  assert.equal(result.market.acceptedComparableCount, 5);
  assert.ok(result.market.rejectedComparables.some((entry) => entry.reasonCode === 'DUPLICATE_LISTING'));
});

test('canonical duplicate URLs are counted once', async () => {
  const result = await evaluate(product(), {
    researcher: researcherFor((item) => [
      { ...comparable(item.productKey, '220.00', { url: 'https://market.example/item/1#first', listingId: undefined }), listingId: undefined },
      { ...comparable(item.productKey, '220.00', { url: 'https://market.example/item/1#second', listingId: undefined }), listingId: undefined },
      ...comparablesFor(item.productKey).slice(1),
    ]),
  });
  assert.ok(result.market.rejectedComparables.some((entry) => entry.reasonCode === 'DUPLICATE_LISTING'));
});

test('median and quartiles are deterministic for odd and even samples', async () => {
  const odd = await evaluate(product(), { researcher: researcherFor((item) => comparablesFor(item.productKey, ['100.00', '200.00', '300.00', '400.00', '500.00'])) });
  assert.equal(odd.market.median.amountMinor, 30_000);
  assert.equal(odd.market.lowerQuartile.amountMinor, 15_000);
  assert.equal(odd.market.upperQuartile.amountMinor, 45_000);

  const even = await evaluate(product(), { researcher: researcherFor((item) => comparablesFor(item.productKey, ['100.00', '200.00', '300.00', '400.00'])) });
  assert.equal(even.market.median.amountMinor, 25_000);
  assert.equal(even.market.lowerQuartile.amountMinor, 15_000);
  assert.equal(even.market.upperQuartile.amountMinor, 35_000);
});

test('market minimum and maximum are exposed', async () => {
  const result = await evaluate();
  assert.equal(result.market.minimum.amountMinor, 22_000);
  assert.equal(result.market.maximum.amountMinor, 25_000);
});

test('insufficient evidence returns PRICE_REVIEW without a fake price', async () => {
  const result = await evaluate(product(), { researcher: researcherFor((item) => comparablesFor(item.productKey).slice(0, 2)) });
  assert.equal(result.status, PRICING_STATUSES.PRICE_REVIEW);
  assert.equal(result.pricing, null);
  assert.ok(result.reasonCodes.includes('MARKET_EVIDENCE_INSUFFICIENT'));
});

test('high-confidence evidence can produce READY', async () => {
  const result = await evaluate();
  assert.equal(result.market.confidence, MARKET_CONFIDENCE.HIGH);
  assert.equal(result.status, PRICING_STATUSES.READY);
});

test('medium confidence remains review when policy requires HIGH', async () => {
  const result = await evaluate(product(), { researcher: researcherFor((item) => comparablesFor(item.productKey).slice(0, 3)) });
  assert.equal(result.market.confidence, MARKET_CONFIDENCE.MEDIUM);
  assert.equal(result.status, PRICING_STATUSES.PRICE_REVIEW);
  assert.ok(result.reasonCodes.includes('MARKET_CONFIDENCE_LOW'));
});

test('missing commission returns PRICE_REVIEW and no universal fallback', async () => {
  const result = await evaluate(product(), { commission: undefined });
  assert.equal(result.status, PRICING_STATUSES.PRICE_REVIEW);
  assert.equal(result.commission, null);
  assert.ok(result.reasonCodes.includes('COMMISSION_UNKNOWN'));
  assert.notEqual(result.reasonCodes.includes('DEFAULT_15_PERCENT'), true);
});

test('commission 10000 bps is rejected as invalid configuration', async () => {
  await assert.rejects(() => evaluate(product(), { commission: commission(10_000) }), (error) => error instanceof PricingContractError
    && error.code === 'COMMISSION_INVALID');
});

test('explicit zero commission is allowed and is not inferred', async () => {
  const result = await evaluate(product({ purchase: '50.00' }), {
    commission: commission(0),
    policy: policy({ profitability: { rules: [{ id: 'zero-commission', minimumNetProfitMinor: 0 }] } }),
    researcher: researcherFor((item) => comparablesFor(item.productKey, ['100.00', '100.00', '100.00', '100.00', '100.00'])),
  });
  assert.equal(result.status, PRICING_STATUSES.READY);
  assert.equal(result.commission.rateBps, 0);
  assert.equal(result.profitability.commissionAmount.amountMinor, 0);
});

test('commission minor-unit rounding is half-up and provenance is retained', async () => {
  const result = await evaluate(product({ purchase: '10.00' }), {
    commission: commission(333),
    policy: policy({ profitability: { rules: [{ id: 'zero', minimumNetProfitMinor: 0 }] } }),
    researcher: researcherFor((item) => comparablesFor(item.productKey, ['100.00', '100.00', '100.00', '100.00', '100.00'])),
  });
  assert.equal(result.commission.rateBps, 333);
  assert.equal(result.commission.provenance.source, 'fixture');
  assert.equal(result.profitability.commissionAmount.amountMinor, 333);
});

test('net profit uses purchase price, commission, and only explicit costs', async () => {
  const withoutCost = await evaluate(product({ purchase: '50.00' }), {
    policy: policy({ profitability: { rules: [{ id: 'zero', minimumNetProfitMinor: 0 }] } }),
    researcher: researcherFor((item) => comparablesFor(item.productKey, ['100.00', '100.00', '100.00', '100.00', '100.00'])),
  });
  const withCost = await evaluate(product({ purchase: '50.00', costs: '10.00' }), {
    policy: policy({ profitability: { rules: [{ id: 'zero', minimumNetProfitMinor: 0 }] } }),
    researcher: researcherFor((item) => comparablesFor(item.productKey, ['100.00', '100.00', '100.00', '100.00', '100.00'])),
  });
  assert.equal(withoutCost.profitability.netProfit.amountMinor - withCost.profitability.netProfit.amountMinor, 1000);
  assert.equal(withoutCost.profitability.otherConfiguredCosts, undefined);
  assert.equal(withCost.profitability.otherConfiguredCosts.amountMinor, 1000);
});

test('ROI and net margin are exposed with explicit names', async () => {
  const result = await evaluate(product({ purchase: '50.00' }), {
    policy: policy({ profitability: { rules: [{ id: 'zero', minimumNetProfitMinor: 0 }] } }),
    researcher: researcherFor((item) => comparablesFor(item.productKey, ['100.00', '100.00', '100.00', '100.00', '100.00'])),
  });
  assert.equal(result.profitability.roiBps, 6000);
  assert.equal(result.profitability.netMarginBps, 3000);
});

test('minimum selling price required is calculated from configured floors', async () => {
  const result = await evaluate(product({ purchase: '100.00' }), {
    policy: policy({ profitability: { rules: [{ id: 'floor', minimumNetProfitMinor: 5000 }] } }),
  });
  assert.ok(result.pricing.minimumSellingPriceRequired.amountMinor > 12_500);
});

test('minimum-price search satisfies the complete profitability constraint matrix', async () => {
  const cases = [
    { name: 'A minimumNetProfit only', rule: { minimumNetProfitMinor: 1_000 } },
    { name: 'B minimumRoi only', rule: { minimumRoiBps: 2_000 } },
    { name: 'C minimumNetMargin only', rule: { minimumNetMarginBps: 1_000 } },
    { name: 'D fixed costs plus minimumNetProfit', costs: '10.00', rule: { minimumNetProfitMinor: 1_000 } },
    { name: 'E fixed costs plus ROI', costs: '10.00', rule: { minimumRoiBps: 2_000 } },
    { name: 'F fixed costs plus margin', costs: '10.00', rule: { minimumNetMarginBps: 1_000 } },
    { name: 'G minimumNetProfit plus ROI', rule: { minimumNetProfitMinor: 1_000, minimumRoiBps: 2_000 } },
    { name: 'H minimumNetProfit plus margin', rule: { minimumNetProfitMinor: 1_000, minimumNetMarginBps: 1_000 } },
    { name: 'I ROI plus margin', rule: { minimumRoiBps: 2_000, minimumNetMarginBps: 1_000 } },
    { name: 'J minimumNetProfit plus ROI plus margin', rule: { minimumNetProfitMinor: 1_000, minimumRoiBps: 2_000, minimumNetMarginBps: 1_000 } },
    { name: 'K all floors plus fixed costs and commission', costs: '10.00', commissionBps: 3_333, rule: { minimumNetProfitMinor: 1_000, minimumRoiBps: 2_000, minimumNetMarginBps: 1_000 } },
    { name: 'L explicit zero commission', commissionBps: 0, rule: { minimumNetProfitMinor: 1_000 } },
    { name: 'M high valid commission', commissionBps: 9_999, rule: { minimumNetProfitMinor: 1_000 } },
  ];
  const satisfies = (sellingMinor, purchaseMinor, costsMinor, rateBps, rule) => {
    const commissionMinor = Math.floor((sellingMinor * rateBps + 5_000) / 10_000);
    const netProfitMinor = sellingMinor - commissionMinor - purchaseMinor - costsMinor;
    const roiBps = Math.floor((netProfitMinor * 10_000) / purchaseMinor);
    const netMarginBps = Math.floor((netProfitMinor * 10_000) / sellingMinor);
    return (rule.minimumNetProfitMinor === undefined || netProfitMinor >= rule.minimumNetProfitMinor)
      && (rule.minimumRoiBps === undefined || roiBps >= rule.minimumRoiBps)
      && (rule.minimumNetMarginBps === undefined || netMarginBps >= rule.minimumNetMarginBps);
  };
  for (const entry of cases) {
    const purchaseMinor = 5_000;
    const costsMinor = entry.costs === undefined ? 0 : 1_000;
    const result = await evaluate(product({ key: `matrix-${entry.name}`, purchase: '50.00', ...(entry.costs === undefined ? {} : { costs: entry.costs }) }), {
      commission: commission(entry.commissionBps ?? 2_000),
      policy: policy({ profitability: { rules: [{ id: 'matrix', ...entry.rule }] } }),
      researcher: researcherFor((item) => comparablesFor(item.productKey, ['1000.00', '1000.00', '1000.00', '1000.00', '1000.00'])),
    });
    const requiredMinor = result.pricing.minimumSellingPriceRequired.amountMinor;
    assert.ok(satisfies(requiredMinor, purchaseMinor, costsMinor, entry.commissionBps ?? 2_000, entry.rule), entry.name);
    assert.equal(satisfies(requiredMinor - 1, purchaseMinor, costsMinor, entry.commissionBps ?? 2_000, entry.rule), false, entry.name);
  }
});

test('minimumNetMarginBps at 10000 is rejected before pricing math', () => {
  assert.throws(() => policy({ profitability: { rules: [{ id: 'impossible-margin', minimumNetMarginBps: 10_000 }] } }), (error) => error instanceof PricingContractError
    && error.code === 'INVALID_POLICY');
});

test('minimum-price search terminates for valid high ROI and high commission boundaries', async () => {
  const highRoi = await evaluate(product({ key: 'boundary-roi', purchase: '50.00' }), {
    policy: policy({ profitability: { rules: [{ id: 'high-roi', minimumRoiBps: Number.MAX_SAFE_INTEGER }] } }),
  });
  assert.ok(highRoi.pricing.minimumSellingPriceRequired !== null);
  assert.equal(highRoi.status, PRICING_STATUSES.SKIP);

  const highCommission = await evaluate(product({ key: 'boundary-commission', purchase: '50.00' }), {
    commission: commission(9_999),
    policy: policy({ profitability: { rules: [{ id: 'high-commission', minimumNetProfitMinor: 1_000 }] } }),
  });
  assert.ok(highCommission.pricing.minimumSellingPriceRequired !== null);
  assert.equal(highCommission.status, PRICING_STATUSES.SKIP);
});

test('upperQuartile cannot return READY above the competitive ceiling', async () => {
  const result = await evaluate(product({ key: 'upper-ceiling', purchase: '50.00' }), {
    policy: policy({
      competition: { targetMarketPosition: 'upperQuartile' },
      profitability: { rules: [{ id: 'zero', minimumNetProfitMinor: 0 }] },
    }),
    researcher: researcherFor((item) => comparablesFor(item.productKey, ['100.00', '200.00', '300.00', '400.00', '500.00'])),
  });
  assert.equal(result.status, PRICING_STATUSES.SKIP);
  assert.equal(result.pricing.recommendedPrice, undefined);
  assert.equal(result.pricing.competitiveCeiling.amountMinor, 30_000);
  assert.ok(result.reasonCodes.includes('PRICE_ABOVE_COMPETITIVE_CEILING'));
});

test('price-step rounding cannot push a READY price above the competitive ceiling', async () => {
  const result = await evaluate(product({ key: 'step-ceiling', purchase: '239.00' }), {
    policy: policy({
      competition: { priceStepMinor: 10_000 },
      profitability: { rules: [{ id: 'zero', minimumNetProfitMinor: 0 }] },
    }),
    researcher: researcherFor((item) => comparablesFor(item.productKey, ['200.00', '250.00', '299.00', '350.00', '350.00'])),
  });
  assert.equal(result.status, PRICING_STATUSES.SKIP);
  assert.equal(result.pricing.recommendedPrice, undefined);
  assert.equal(result.pricing.minimumSellingPriceRequired.amountMinor, 29_875);
  assert.equal(result.pricing.competitiveCeiling.amountMinor, 29_900);
  assert.ok(result.reasonCodes.includes('PRICE_ABOVE_COMPETITIVE_CEILING'));
});

test('required price exactly at the ceiling can produce READY', async () => {
  const result = await evaluate(product({ key: 'exact-ceiling', purchase: '80.00' }), {
    policy: policy({ profitability: { rules: [{ id: 'zero', minimumNetProfitMinor: 0 }] } }),
    researcher: researcherFor((item) => comparablesFor(item.productKey, ['100.00', '100.00', '100.00', '100.00', '100.00'])),
  });
  assert.equal(result.pricing.minimumSellingPriceRequired.amountMinor, 10_000);
  assert.equal(result.pricing.competitiveCeiling.amountMinor, 10_000);
  assert.equal(result.pricing.recommendedPrice.amountMinor, 10_000);
  assert.equal(result.status, PRICING_STATUSES.READY);
});

test('required price one minor unit above the ceiling produces SKIP', async () => {
  const result = await evaluate(product({ key: 'above-ceiling', purchase: '80.00' }), {
    policy: policy({ profitability: { rules: [{ id: 'one-minor-above', minimumNetProfitMinor: 1 }] } }),
    researcher: researcherFor((item) => comparablesFor(item.productKey, ['100.00', '100.00', '100.00', '100.00', '100.00'])),
  });
  assert.equal(result.pricing.minimumSellingPriceRequired.amountMinor, 10_001);
  assert.equal(result.pricing.competitiveCeiling.amountMinor, 10_000);
  assert.equal(result.status, PRICING_STATUSES.SKIP);
  assert.ok(result.reasonCodes.includes('REQUIRED_PRICE_ABOVE_MARKET'));
});

test('competitive price inside the ceiling with satisfied profit is READY', async () => {
  const result = await evaluate();
  assert.equal(result.status, PRICING_STATUSES.READY);
  assert.equal(result.pricing.strategy, 'median');
  assert.ok(result.pricing.recommendedPrice.amountMinor <= result.pricing.competitiveCeiling.amountMinor);
});

test('required profitable price above the market ceiling is SKIP', async () => {
  const result = await evaluate(product({ purchase: '200.00' }), {
    policy: policy({ profitability: { rules: [{ id: 'high-floor', minimumNetProfitMinor: 15_000 }] }, marketEvidence: { minimumReadyConfidence: MARKET_CONFIDENCE.HIGH } }),
    researcher: researcherFor((item) => comparablesFor(item.productKey, ['220.00', '220.00', '220.00', '220.00', '220.00'])),
  });
  assert.equal(result.status, PRICING_STATUSES.SKIP);
  assert.ok(result.reasonCodes.includes('REQUIRED_PRICE_ABOVE_MARKET'));
  assert.ok(result.pricing.minimumSellingPriceRequired.amountMinor > result.pricing.competitiveCeiling.amountMinor);
});

test('negative competitive economics are SKIP only with reliable evidence', async () => {
  const result = await evaluate(product({ purchase: '300.00' }), {
    policy: policy({ profitability: { rules: [{ id: 'zero', minimumNetProfitMinor: 0 }] } }),
    researcher: researcherFor((item) => comparablesFor(item.productKey, ['100.00', '100.00', '100.00', '100.00', '100.00'])),
  });
  assert.equal(result.status, PRICING_STATUSES.SKIP);
  assert.ok(result.reasonCodes.includes('REQUIRED_PRICE_ABOVE_MARKET'));
});

test('no universal 90 percent rule is used by the default policy', async () => {
  assert.deepEqual(DEFAULT_MARKET_PRICING_POLICY.profitability.rules, []);
  const result = await evaluate(product({ purchase: '100.00' }), { policy: policy({ profitability: { rules: [{ id: 'zero', minimumNetProfitMinor: 0 }] } }) });
  assert.equal(result.diagnostics.matchedProfitRule.id, 'zero');
});

test('target strategy is visible and configurable', async () => {
  const result = await evaluate(product(), { policy: policy({ competition: { targetMarketPosition: 'lowerQuartile', undercutMinor: 100 } }) });
  assert.equal(result.pricing.strategy, 'lowerQuartile');
  assert.equal(result.pricing.marketTarget.amountMinor, 22_150);
});

test('researcher operational failure remains an operational error', async () => {
  await assert.rejects(() => evaluate(product(), { researcher: async () => { throw new Error('network down'); } }), (error) => error instanceof MarketPricingError && error.code === 'MARKET_RESEARCH_FAILURE');
});

test('malformed researcher response is an explicit contract error', async () => {
  await assert.rejects(() => evaluate(product(), { researcher: async () => ({ productKey: 'other', comparables: [] }) }), (error) => error instanceof MarketPricingError && error.code === 'MARKET_EVIDENCE_INVALID');
  await assert.rejects(() => evaluate(product(), { researcher: async () => ({ productKey: 'p-1', comparables: 'not-array' }) }), (error) => error.code === 'MARKET_EVIDENCE_INVALID');
});

test('researcher boundary passes a cloned product and returns cloned evidence', async () => {
  const candidate = product();
  let observed;
  const response = await collectMarketEvidence(candidate, {
    researcher: async (input) => {
      observed = input;
      input.supplier.purchasePrice.amount = '0.00';
      return { productKey: input.productKey, comparables: comparablesFor(input.productKey) };
    },
  });
  assert.equal(observed.productKey, candidate.productKey);
  assert.equal(candidate.supplier.purchasePrice.amount, '90.00');
  response.comparables[0].price.amount = '1.00';
  assert.equal(response.comparables[0].price.amount, '1.00');
});

test('pricing decision contains traceable evidence and supplier provenance', async () => {
  const result = await evaluate();
  assert.equal(result.market.acceptedComparables.length, 5);
  assert.equal(result.market.acceptedComparables[0].listingId, 'p-1-listing-1');
  assert.equal(result.supplier.provenance.sourceUrl, 'https://ug-opt.in.ua/ua/p/p-1');
});

test('batch evaluates one product independently', async () => {
  const result = await evaluatePricingBatch([product()], {
    policy: policy(),
    commission: commission(),
    researcher: researcherFor((item) => comparablesFor(item.productKey)),
  });
  assert.equal(result.candidateCount, 1);
  assert.equal(result.summary.readyCount, 1);
});

test('batch evaluates 100 products without a quality shortcut', async () => {
  const products = Array.from({ length: 100 }, (_, index) => product({ key: `p-${index + 1}`, purchase: '90.00' }));
  const result = await evaluatePricingBatch(products, { policy: policy(), commission: commission(), researcher: researcherFor((item) => comparablesFor(item.productKey)) });
  assert.equal(result.candidateCount, 100);
  assert.equal(result.summary.readyCount, 100);
});

test('batch evaluates 1000 products deterministically', async () => {
  const products = Array.from({ length: 1000 }, (_, index) => product({ key: `p-${String(index + 1).padStart(4, '0')}`, purchase: '90.00' }));
  const options = { policy: policy(), commission: commission(), researcher: researcherFor((item) => comparablesFor(item.productKey)) };
  const first = await evaluatePricingBatch(products, options);
  const second = await evaluatePricingBatch(products, options);
  assert.deepEqual(first, second);
});

test('market evidence is isolated by productKey', async () => {
  const candidates = [product({ key: 'a', purchase: '50.00' }), product({ key: 'b', purchase: '250.00' })];
  const result = await evaluatePricingBatch(candidates, {
    policy: policy({ profitability: { rules: [{ id: 'zero', minimumNetProfitMinor: 0 }] } }),
    commission: commission(),
    researcher: researcherFor((item) => item.productKey === 'a'
      ? comparablesFor(item.productKey, ['200.00', '200.00', '200.00', '200.00', '200.00'])
      : comparablesFor(item.productKey, ['300.00', '300.00', '300.00', '300.00', '300.00'])),
  });
  assert.equal(result.decisions[0].market.median.amountMinor, 20_000);
  assert.equal(result.decisions[1].market.median.amountMinor, 30_000);
  assert.equal(result.decisions[0].pricing.recommendedPrice.amountMinor, 20_000);
  assert.equal(result.decisions[1].status, PRICING_STATUSES.SKIP);
  assert.ok(result.decisions[1].pricing.minimumSellingPriceRequired.amountMinor > result.decisions[1].pricing.competitiveCeiling.amountMinor);
});

test('batch does not mutate products, evidence, policy, or commission', async () => {
  const candidates = [product()];
  const configuredPolicy = policy();
  const configuredCommission = commission();
  const before = structuredClone({ candidates, configuredPolicy, configuredCommission });
  await evaluatePricingBatch(candidates, { policy: configuredPolicy, commission: configuredCommission, researcher: researcherFor((item) => comparablesFor(item.productKey)) });
  assert.deepEqual({ candidates, configuredPolicy, configuredCommission }, before);
});

test('ranking puts READY above REVIEW and SKIP', () => {
  const result = rankPricingDecisions([
    rankingDecision('skip', PRICING_STATUSES.SKIP, 99_999),
    rankingDecision('review', PRICING_STATUSES.PRICE_REVIEW, 99_999),
    rankingDecision('ready', PRICING_STATUSES.READY, 1),
  ], { policy: policy() });
  assert.deepEqual(result.ranked.map((row) => row.productKey), ['ready', 'review', 'skip']);
});

test('custom economic ranking cannot change READY, REVIEW, SKIP precedence', () => {
  const configured = policy({ ranking: { order: ['status', 'productKey', 'netProfitMinor', 'roiBps', 'netMarginBps', 'marketConfidenceRank'] } });
  const result = rankPricingDecisions([
    rankingDecision('review-high-profit', PRICING_STATUSES.PRICE_REVIEW, 99_999),
    rankingDecision('ready-low-profit', PRICING_STATUSES.READY, 1),
    rankingDecision('skip-high-profit', PRICING_STATUSES.SKIP, 999_999),
  ], { policy: configured });
  assert.deepEqual(result.ranked.map((row) => row.status), [PRICING_STATUSES.READY, PRICING_STATUSES.PRICE_REVIEW, PRICING_STATUSES.SKIP]);
  assert.throws(() => policy({ ranking: { order: ['netProfitMinor', 'status', 'roiBps', 'netMarginBps', 'marketConfidenceRank', 'productKey'] } }), /status precedence/u);
});

test('ranking uses explicit economics factors and exposes components', () => {
  const result = rankPricingDecisions([
    rankingDecision('low-profit', PRICING_STATUSES.READY, 1000, 5000, 5000),
    rankingDecision('high-profit', PRICING_STATUSES.READY, 2000, 1000, 1000),
  ], { policy: policy() });
  assert.deepEqual(result.ranked.map((row) => row.productKey), ['high-profit', 'low-profit']);
  assert.equal(result.ranked[0].scoreComponents.netProfitMinor, 2000);
});

test('ranking tie-break is productKey and rejects duplicate keys', () => {
  const tie = rankPricingDecisions([
    rankingDecision('z-key', PRICING_STATUSES.READY, 1000),
    rankingDecision('a-key', PRICING_STATUSES.READY, 1000),
  ], { policy: policy() });
  assert.deepEqual(tie.ranked.map((row) => row.productKey), ['a-key', 'z-key']);
  assert.throws(() => rankPricingDecisions([rankingDecision('same', PRICING_STATUSES.READY, 1), rankingDecision('same', PRICING_STATUSES.READY, 2)], { policy: policy() }), /duplicate productKey/u);
});

test('ranking output is independent of candidate input order', () => {
  const rows = [
    rankingDecision('c', PRICING_STATUSES.READY, 100),
    rankingDecision('a', PRICING_STATUSES.READY, 300),
    rankingDecision('b', PRICING_STATUSES.PRICE_REVIEW, 999),
  ];
  const first = rankPricingDecisions(rows, { policy: policy() });
  const second = rankPricingDecisions([...rows].reverse(), { policy: policy() });
  assert.deepEqual(first, second);
});

test('fewer than 6000 READY products are not padded', () => {
  const rows = Array.from({ length: 3 }, (_, index) => rankingDecision(`p-${index}`, PRICING_STATUSES.READY, 1000 - index));
  const result = selectTopProfitableProducts(rows, { policy: policy() });
  assert.equal(result.selectedCount, 3);
  assert.equal(result.capacityRemaining, 5997);
  assert.equal(result.notSelectedReady.length, 0);
});

test('more than 6000 READY products are capped exactly at 6000', () => {
  const rows = Array.from({ length: 6001 }, (_, index) => rankingDecision(`p-${String(index).padStart(5, '0')}`, PRICING_STATUSES.READY, 1000 + index));
  const result = selectTopProfitableProducts(rows, { policy: policy(), maxProducts: 6000 });
  assert.equal(result.selectedCount, 6000);
  assert.equal(result.notSelectedReady.length, 1);
  assert.equal(result.capacityRemaining, 0);
});

test('selection rejects a caller limit above the hard maximum', () => {
  assert.throws(() => selectTopProfitableProducts([], { policy: policy(), maxProducts: 6001 }), /maxProducts/u);
});

test('PRICE_REVIEW and SKIP never enter automatic TOP-6000 selection', () => {
  const result = selectTopProfitableProducts([
    rankingDecision('ready', PRICING_STATUSES.READY, 1),
    rankingDecision('review', PRICING_STATUSES.PRICE_REVIEW, 99999),
    rankingDecision('skip', PRICING_STATUSES.SKIP, 99999),
  ], { policy: policy(), maxProducts: 6000 });
  assert.deepEqual(result.selected.map((entry) => entry.productKey), ['ready']);
  assert.equal(result.review.length, 1);
  assert.equal(result.skip.length, 1);
});

test('stronger candidate displaces weaker candidate after full ranking', () => {
  const first = selectTopProfitableProducts([
    rankingDecision('weak', PRICING_STATUSES.READY, 100),
    rankingDecision('other', PRICING_STATUSES.READY, 200),
  ], { policy: policy({ selection: { maxProducts: 1 } }), maxProducts: 1 });
  const refreshed = selectTopProfitableProducts([
    rankingDecision('weak', PRICING_STATUSES.READY, 100),
    rankingDecision('other', PRICING_STATUSES.READY, 200),
    rankingDecision('stronger-new', PRICING_STATUSES.READY, 300),
  ], { policy: policy({ selection: { maxProducts: 1 } }), maxProducts: 1 });
  assert.deepEqual(first.selected.map((entry) => entry.productKey), ['other']);
  assert.deepEqual(refreshed.selected.map((entry) => entry.productKey), ['stronger-new']);
});

test('selection returns complete summary counts', () => {
  const result = selectTopProfitableProducts([
    rankingDecision('ready-1', PRICING_STATUSES.READY, 2),
    rankingDecision('ready-2', PRICING_STATUSES.READY, 1),
    rankingDecision('review', PRICING_STATUSES.PRICE_REVIEW, 4),
    rankingDecision('skip', PRICING_STATUSES.SKIP, 5),
  ], { policy: policy({ selection: { maxProducts: 1 } }), maxProducts: 1 });
  assert.deepEqual({
    candidateCount: result.candidateCount,
    readyCount: result.readyCount,
    reviewCount: result.reviewCount,
    skipCount: result.skipCount,
    selectedCount: result.selectedCount,
    capacityRemaining: result.capacityRemaining,
  }, { candidateCount: 4, readyCount: 2, reviewCount: 1, skipCount: 1, selectedCount: 1, capacityRemaining: 0 });
});

test('supplier price is never copied into selling price automatically', async () => {
  const result = await evaluate(product({ purchase: '90.00' }));
  assert.notEqual(result.pricing.recommendedPrice.amountMinor, result.supplier.purchasePrice.amountMinor);
  assert.equal(result.supplier.purchasePrice.amountMinor, 9000);
});
