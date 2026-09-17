import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { assertSource, evaluateFunction, extractArrowExpression, extractFunction, readProduction, repoPath } from '../characterization/support.mjs';

const fixture = JSON.parse(await fs.readFile(repoPath('tests', 'fixtures', 'golden', 'pricing-cases.json'), 'utf8'));

const rootSource = await readProduction('build-prom-products.mjs');
const commercialRound = evaluateFunction(extractFunction(rootSource, 'commercialRound'));
const rootPriceEngine = evaluateFunction(
  extractFunction(rootSource, 'priceEngine'),
  { name: 'config', value: { dropshipMarkup: 1.3, safetyMarginPercent: 5, commissionRateFallback: 0.125 } },
  { name: 'commercialRound', value: commercialRound },
);

const applySource = await readProduction('excel-work/apply-price-rule.mjs');
const applyPriceRule = evaluateFunction(extractFunction(applySource, 'priceRule'));
const strictSource = await readProduction('excel-work/build-prom-photo-price-fixed.mjs');
const rawPrice = evaluateFunction(extractArrowExpression(strictSource, 'rawPrice'));
const retailPrice = evaluateFunction(extractArrowExpression(strictSource, 'retailPrice'));

test('real pricing golden cases still match current named implementations', () => {
  const root = fixture.cases.find((item) => item.implementation === 'root-price-engine');
  assert.deepEqual(rootPriceEngine(root.purchase), {
    protectedCost: root.protectedCost,
    targetPrice: root.targetPrice,
    hardFloor: root.hardFloor,
    finalPrice: root.finalPrice,
    commissionRate: root.commissionRate,
  });
  assertSource(rootSource, /dropshipMarkup:\s*1\.3/u, 'root engine source remains the captured implementation');

  for (const expected of fixture.cases.filter((item) => item.implementation === 'apply-price-rule')) {
    const rule = applyPriceRule(expected.purchase);
    const commission = expected.commissionPct / 100;
    const actual = {
      rule,
      priceByMarkup: expected.purchase * (1 + rule.markup / 100),
      priceByMinProfit: (expected.purchase + rule.minProfit + expected.delivery) / (1 - commission),
    };
    actual.finalPrice = Math.ceil(Math.max(actual.priceByMarkup, actual.priceByMinProfit));
    actual.netExpected = actual.finalPrice - actual.finalPrice * commission - expected.purchase - expected.delivery;
    actual.netWorst = actual.finalPrice - actual.finalPrice * commission - expected.purchase - 120;
    assert.equal(actual.finalPrice, expected.finalPrice, expected.code);
    assert.ok(Math.abs(actual.priceByMarkup - expected.priceByMarkup) < 1e-9, expected.code);
    assert.ok(Math.abs(actual.priceByMinProfit - expected.priceByMinProfit) < 1e-9, expected.code);
    assert.ok(Math.abs(actual.netExpected - expected.netExpected) < 1e-9, expected.code);
    assert.ok(Math.abs(actual.netWorst - expected.netWorst) < 1e-9, expected.code);
  }

  for (const expected of fixture.cases.filter((item) => item.implementation === 'strict-photo-price')) {
    assert.equal(retailPrice(rawPrice(expected.purchase)), expected.finalPrice, expected.code);
    assert.equal(expected.photoCount, 5, expected.code);
  }
  assertSource(strictSource, /cost \* 1\.90 \/ 0\.80/u, 'strict price source remains the captured implementation');
});

test('real pricing golden matrix preserves both historical implementations', () => {
  const root = fixture.cases.filter((item) => item.implementation === 'root-price-engine');
  const tiered = fixture.cases.filter((item) => item.implementation === 'apply-price-rule');
  const strict = fixture.cases.filter((item) => item.implementation === 'strict-photo-price');
  assert.equal(root.length, 1);
  assert.equal(tiered.length, 4);
  assert.equal(strict.length, 3);
  assert.deepEqual(tiered.map((item) => [item.code, item.finalPrice]), [
    ['0149', 3514],
    ['34621', 575],
    ['34668', 153],
    ['34722', 175],
  ]);
  assert.deepEqual(strict.map((item) => [item.code, item.finalPrice]), [
    ['35214', 85],
    ['36122', 240],
    ['36106', 150],
  ]);
  assert.notEqual(tiered.find((item) => item.code === '34621').finalPrice, 546.25);
  assert.equal(strict.find((item) => item.code === '36122').commissionPct, 20);
  assert.equal(strict.find((item) => item.code === '36122').photoCount, 5);
});
