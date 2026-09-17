import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSource, evaluateFunction, evaluateExpression, extractArrowExpression, extractFunction, readProduction } from './support.mjs';

const rootPricingSource = await readProduction('build-prom-products.mjs');
const commercialRound = evaluateFunction(extractFunction(rootPricingSource, 'commercialRound'));
const rootPriceEngine = evaluateFunction(
  extractFunction(rootPricingSource, 'priceEngine'),
  { name: 'config', value: { dropshipMarkup: 1.3, safetyMarginPercent: 5, commissionRateFallback: 0.125 } },
  { name: 'commercialRound', value: commercialRound },
);

test('root price engine preserves low-price tier and hard floor', () => {
  assert.deepEqual(rootPriceEngine(10), {
    protectedCost: 13.65,
    targetPrice: 99,
    hardFloor: 133,
    finalPrice: 133,
    commissionRate: 0.125,
  });
});

test('root price engine preserves normal-price tier', () => {
  assert.deepEqual(rootPriceEngine(100), {
    protectedCost: 136.5,
    targetPrice: 399,
    hardFloor: 364,
    finalPrice: 399,
    commissionRate: 0.125,
  });
});

test('root price engine preserves fractional and high-price rounding', () => {
  assert.deepEqual(rootPriceEngine(249.5), {
    protectedCost: 340.57,
    targetPrice: 849,
    hardFloor: 739,
    finalPrice: 849,
    commissionRate: 0.125,
  });
  assert.equal(rootPriceEngine(1000).finalPrice, 2999);
});

test('root price engine preserves zero and invalid-price behavior', () => {
  assert.equal(rootPriceEngine(0).finalPrice, 114);
  assert.equal(Number.isNaN(rootPriceEngine(Number.NaN).finalPrice), true);
});

test('root price engine preserves an explicit commission edge case', () => {
  const result = rootPriceEngine(100, 0);
  assert.equal(result.commissionRate, 0);
  assert.equal(result.finalPrice, 349);
});

test('root pricing source still contains its current rates and tier mechanism', () => {
  assertSource(rootPricingSource, /dropshipMarkup:\s*1\.3/u, 'dropship markup is a protected current behavior');
  assertSource(rootPricingSource, /safetyMarginPercent:\s*5/u, 'safety margin is a protected current behavior');
  assertSource(rootPricingSource, /commissionRateFallback:\s*0\.125/u, 'fallback commission is a protected current behavior');
  assertSource(rootPricingSource, /const totalRate = commissionRate \+ 0\.07 \+ 0\.05 \+ 0\.03 \+ 0\.02/u, 'additional rate components are a protected current behavior');
});

const applyPricingSource = await readProduction('excel-work/apply-price-rule.mjs');
const applyPriceRule = evaluateFunction(extractFunction(applyPricingSource, 'priceRule'));
const applyCurrent = (purchase, commissionPct) => {
  const rule = applyPriceRule(purchase);
  const commission = commissionPct / 100;
  const priceByMarkup = purchase * (1 + rule.markup / 100);
  const priceByMinProfit = (purchase + rule.minProfit + 105) / (1 - commission);
  const rawPrice = Math.max(priceByMarkup, priceByMinProfit);
  const finalPrice = Math.ceil(rawPrice);
  return {
    rule,
    priceByMarkup,
    priceByMinProfit,
    finalPrice,
    netExpected: finalPrice - finalPrice * commission - purchase - 105,
    netWorst: finalPrice - finalPrice * commission - purchase - 120,
  };
};

test('apply-price-rule preserves low, normal, and high purchase behavior', () => {
  assert.equal(applyCurrent(40, 20).finalPrice, 182);
  assert.equal(applyCurrent(230, 20).finalPrice, 575);
  assert.equal(applyCurrent(1200, 20).finalPrice, 2257);
  assert.equal(applyCurrent(5200, 20).finalPrice, 8132);
});

test('apply-price-rule preserves fractional boundary and delivery assumptions', () => {
  const result = applyCurrent(99.5, 20);
  assert.equal(result.finalPrice, 299);
  assert.ok(Math.abs(result.netExpected - 34.7) < 1e-9);
  assert.ok(Math.abs(result.netWorst - 19.7) < 1e-9);
  assertSource(applyPricingSource, /const delivery = 105/u, 'expected delivery is a protected current behavior');
  assertSource(applyPricingSource, /updated\[6\] = 120/u, 'worst-case delivery is a protected current behavior');
  assertSource(applyPricingSource, /\(purchase \+ rule\.minProfit \+ delivery\) \/ \(1 - commission\)/u, 'minimum-profit formula is a protected current behavior');
});

test('apply-price-rule preserves invalid input fall-through', () => {
  const result = applyPriceRule(Number.NaN);
  assert.equal(result.markup, 25);
  assert.equal(Number.isNaN(result.minProfit), true);
});

const strictPricingSource = await readProduction('excel-work/build-prom-photo-price-fixed.mjs');
const rawPrice = evaluateFunction(extractArrowExpression(strictPricingSource, 'rawPrice'));
const retailPrice = evaluateFunction(extractArrowExpression(strictPricingSource, 'retailPrice'));

test('strict price builder preserves 20-percent commission orientation and retail rounding', () => {
  assertSource(strictPricingSource, /const commissionPct = 20/u, 'strict commission is a protected current behavior');
  assertSource(strictPricingSource, /cost \* 1\.90 \/ 0\.80/u, 'strict profitability formula is a protected current behavior');
  assert.equal(rawPrice(40), 95);
  assert.equal(retailPrice(rawPrice(40)), 95);
  assert.equal(rawPrice(230), 546.25);
  assert.equal(retailPrice(rawPrice(230)), 550);
  assert.equal(rawPrice(1000), 2375);
  assert.equal(retailPrice(rawPrice(1000)), 2380);
});

test('strict price builder preserves fractional and invalid-price behavior', () => {
  assert.equal(retailPrice(rawPrice(99.5)), 240);
  assert.equal(retailPrice(rawPrice(1250)), 2970);
  assert.equal(Number.isNaN(rawPrice(Number.NaN)), true);
  assert.equal(Number.isNaN(retailPrice(Number.NaN)), true);
});
