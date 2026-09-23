import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';

import {
  CATEGORY_PRODUCTION_NET_ROI_ANCHORS,
  evaluateProductPricing,
  resolveCategoryProductionNetRoiBps,
} from '../../src/pricing/market-pricing.mjs';
import { runCategoryProduction } from '../../src/orchestration/category-production-runner.mjs';

const commission = {
  rateBps: 2_000,
  source: 'test',
  provenance: { source: 'test' },
};

function marketEvidence(productKey, prices = [100, 110, 120]) {
  return {
    productKey,
    comparables: prices.map((price, index) => ({
      source: 'test-market',
      listingId: `${productKey}-${index}`,
      seller: `seller-${index}`,
      title: `Exact ${productKey}`,
      price: { amount: price, currency: 'UAH' },
      available: true,
      matchType: 'exact',
      matchConfidence: 'high',
      productIdentityEvidence: { productKey },
    })),
  };
}

function pricingPolicy() {
  return {
    marketEvidence: {
      minimumReadyConfidence: 'MEDIUM',
      confidence: {
        medium: { minimumComparableCount: 3, minimumExactComparableCount: 1, minimumSourceCount: 1 },
      },
    },
  };
}

function longText(prefix, language = 'ua') {
  const tail = language === 'ru'
    ? 'помогает понять пользу товара и способ использования'
    : 'пояснює користь товару та спосіб використання';
  return Array.from({ length: 45 }, (_, index) => `${prefix} ${tail}, абзац ${index + 1}.`).join(' ');
}

function keywords(language) {
  const terms = Array.from({ length: 25 }, (_, index) => language === 'ua'
    ? `фен для волосся пошукова фраза ${index + 1}`
    : `фен для волос поисковая фраза ${index + 1}`);
  const value = terms.join(', ');
  return `${value}${'x'.repeat(900 - value.length)}`;
}

function readyContentArtifact(productKey, sourceFacts) {
  const alternate = productKey.endsWith('b');
  return {
    productKey,
    version: 1,
    content: {
      title: { ru: 'Фен для волос', ua: 'Фен для волосся' },
      description: {
        ru: longText(alternate ? 'Фен удобно сушит волосы и помогает подготовить их к укладке' : 'Фен помогает быстро высушить волосы и удобно подготовить их к укладке', 'ru'),
        ua: longText(alternate ? 'Фен зручно сушить волосся та допомагає підготувати його до укладання' : 'Фен допомагає швидко висушити волосся та зручно підготувати його до укладання', 'ua'),
      },
      keywords: { ru: keywords('ru'), ua: keywords('ua') },
      characteristics: [{ name: 'Тип', value: 'Фен' }],
    },
    sourceFacts,
  };
}

test('PR30 dynamic ROI curve uses the exact anchors and linear interpolation', () => {
  assert.deepEqual(CATEGORY_PRODUCTION_NET_ROI_ANCHORS.map((item) => item.targetRoiBps), [13000, 11500, 8500, 7500, 6500, 5500, 4500, 3500, 2500]);
  for (const [purchasePriceMinor, targetRoiBps] of [
    [5_000, 13_000],
    [10_000, 11_500],
    [20_000, 10_000],
    [30_000, 8_500],
    [60_000, 7_500],
    [100_000, 6_500],
    [200_000, 5_500],
    [500_000, 4_500],
    [1_000_000, 3_500],
    [2_000_000, 2_500],
  ]) {
    assert.equal(resolveCategoryProductionNetRoiBps(purchasePriceMinor), targetRoiBps);
  }
  assert.equal(resolveCategoryProductionNetRoiBps(5_000_000), 2_500);
});

test('category pricing keeps a product eligible when the selling price is above market', async () => {
  const result = await evaluateProductPricing({
    productKey: 'ugopt:above-market',
    supplier: {
      name: 'ug-opt',
      purchasePrice: { amount: 100, currency: 'UAH' },
      provenance: { source: 'test' },
    },
  }, {
    commission,
    enforceCompetitiveCeiling: false,
    policy: {
      ...pricingPolicy(),
      profitability: { rules: [], dynamicNetRoiCurve: CATEGORY_PRODUCTION_NET_ROI_ANCHORS },
    },
    researcher: async () => marketEvidence('ugopt:above-market', [100, 100, 100]),
  });
  assert.equal(result.status, 'READY');
  assert.equal(result.profitability.roiBps >= 11_500, true);
  assert.equal(result.profitability.commissionAmount.amount, '53.75');
  assert.equal(result.profitability.netProfit.amount, '115.00');
  assert.equal(result.profitability.roiBps, 11_500);
  assert.equal(result.pricing.competitiveCeiling.amount, '100.00');
});

test('CATEGORY_PRODUCTION reaches PR22 pricing without market evidence or a researcher', async () => {
  const result = await runCategoryProduction({
    categoryUrl: 'https://ug-opt.in.ua/ua/category',
  }, {
    collector: async () => ({
      resolution: 'resolved',
      candidates: [{
        selectionKey: 'ugopt:no-market',
        product: {
          supplier: 'ug-opt',
          supplierSku: 'no-market',
          title: 'Товар без market evidence',
          price: 100,
          sourceUrl: 'https://ug-opt.in.ua/ua/p-no-market',
          sourceImageUrl: 'https://images.prom.ua/no-market.jpg',
        },
      }],
      pagesFetched: 1,
    }),
    registry: { byCode: {}, collisions: [] },
  });

  const product = result.products[0];
  assert.equal(product.pricingDecision.status, 'READY');
  assert.equal(product.pricingDecision.pricing.recommendedPrice.amount, '268.75');
  assert.equal(product.pricingDecision.market.status, 'NOT_RESEARCHED');
  assert.equal(product.pricingDecision.market.acceptedComparableCount, 0);
  assert.equal(product.workflowStatus, 'WAITING_FOR_CONTENT');
  assert.equal(result.operatorTasks[0].taskType, 'CONTENT_GENERATION');
});

test('CATEGORY_PRODUCTION normalizes structured supplier source text for content generation', async () => {
  const productKey = 'ugopt:structured-source-text';
  const result = await runCategoryProduction({
    categoryUrl: 'https://ug-opt.in.ua/ua/category',
  }, {
    collector: async () => ({
      resolution: 'resolved',
      candidates: [{
        selectionKey: productKey,
        product: {
          supplier: 'ug-opt',
          supplierSku: 'structured-source-text',
          title: 'Товар зі структурованими фактами',
          price: 100,
          sourceUrl: 'https://ug-opt.in.ua/ua/p-structured-source-text',
          sourceImageUrl: 'https://images.prom.ua/structured-source-text.jpg',
        },
      }],
      pagesFetched: 1,
    }),
    productDetailCollector: async () => ({
      productKey,
      version: 1,
      status: 'READY',
      sourceUrl: 'https://ug-opt.in.ua/ua/p-structured-source-text',
      sourceFacts: { type: { ru: 'Товар', ua: 'Товар' }, size: '10 см' },
      sourceText: {
        language: 'uk',
        title: 'Товар зі структурованими фактами',
        description: 'Опис постачальника',
        characteristics: [{ name: 'Розмір', value: '10 см' }],
      },
      sourceImages: [{ id: `${productKey}-source-1`, reference: 'https://images.prom.ua/structured-source-text.jpg' }],
      diagnostics: [],
      provenance: { supplier: 'ug-opt', authority: 'official-product-page' },
    }),
    registry: { byCode: {}, collisions: [] },
  });

  const task = result.operatorTasks.find((item) => item.taskType === 'CONTENT_GENERATION');
  assert.ok(task);
  assert.deepEqual(task.input.sourceText, {
    language: 'uk',
    title: 'Товар зі структурованими фактами',
    description: 'Опис постачальника',
    characteristics: 'Розмір: 10 см',
  });
});

test('CATEGORY_PRODUCTION ranking uses economic signals when market evidence is absent', async () => {
  const result = await runCategoryProduction({ categoryUrl: 'https://ug-opt.in.ua/ua/category' }, {
    collector: async () => ({
      resolution: 'resolved',
      candidates: [1, 2].map((sku) => ({
        selectionKey: `ugopt:no-market-${sku}`,
        product: {
          supplier: 'ug-opt',
          supplierSku: `no-market-${sku}`,
          title: `Товар без рынка ${sku}`,
          price: sku === 1 ? 100 : 10,
          sourceUrl: `https://ug-opt.in.ua/ua/p-no-market-${sku}`,
          sourceImageUrl: `https://images.prom.ua/no-market-${sku}.jpg`,
        },
      })),
      pagesFetched: 1,
    }),
    registry: { byCode: {}, collisions: [] },
  });

  assert.deepEqual(result.ranking.ranked.map((row) => row.status), ['READY', 'READY']);
  assert.equal(result.ranking.ranked.every((row) => row.scoreComponents.marketConfidenceRank === 0), true);
  assert.equal(result.summary.pricingReady, 2);
  assert.equal(result.operatorTasks.every((task) => task.taskType === 'CONTENT_GENERATION'), true);
});

test('CATEGORY_PRODUCTION keeps market evidence as analytics without using it to raise the supplier-derived price', async () => {
  const productKey = 'ugopt:market-analytics-only';
  const result = await runCategoryProduction({
    categoryUrl: 'https://ug-opt.in.ua/ua/category',
    productInputs: { [productKey]: { marketEvidence: marketEvidence(productKey, [1_000, 1_000, 1_000]) } },
  }, {
    collector: async () => ({
      resolution: 'resolved',
      candidates: [{
        selectionKey: productKey,
        product: {
          supplier: 'ug-opt',
          supplierSku: 'market-analytics-only',
          title: 'Товар з market analytics',
          price: 100,
          sourceUrl: 'https://ug-opt.in.ua/ua/p-market-analytics-only',
          sourceImageUrl: 'https://images.prom.ua/market-analytics-only.jpg',
        },
      }],
      pagesFetched: 1,
    }),
    registry: { byCode: {}, collisions: [] },
  });

  const decision = result.products[0].pricingDecision;
  assert.equal(decision.status, 'READY');
  assert.equal(decision.market.median.amount, '1000.00');
  assert.equal(decision.pricing.recommendedPrice.amount, '268.75');
  assert.equal(decision.pricing.marketTarget, null);
  assert.equal(result.products[0].workflowStatus, 'WAITING_FOR_CONTENT');
});

test('CATEGORY_PRODUCTION can reach the photo stage after pricing without market evidence', async () => {
  const productKey = 'ugopt:photo-without-market';
  const sourceFacts = { type: 'Фен' };
  const result = await runCategoryProduction({
    categoryUrl: 'https://ug-opt.in.ua/ua/category',
    productInputs: {
      [productKey]: {
        sourceFacts,
        contentArtifact: readyContentArtifact(productKey, sourceFacts),
      },
    },
  }, {
    collector: async () => ({
      resolution: 'resolved',
      candidates: [{
        selectionKey: productKey,
        product: {
          supplier: 'ug-opt',
          supplierSku: 'photo-without-market',
          title: 'Фен без market evidence',
          price: 100,
          sourceUrl: 'https://ug-opt.in.ua/ua/p-photo-without-market',
          sourceImageUrl: 'https://images.prom.ua/photo-without-market.jpg',
        },
      }],
      pagesFetched: 1,
    }),
    registry: { byCode: {}, collisions: [] },
  });

  assert.equal(result.products[0].pricingDecision.status, 'READY');
  assert.equal(result.products[0].workflowStatus, 'WAITING_FOR_PHOTOS');
  assert.equal(result.operatorTasks[0].taskType, 'PHOTO_ART_DIRECTION');
});

test('CATEGORY_PRODUCTION carries the non-blocking market ceiling policy through the orchestrator', async () => {
  const result = await runCategoryProduction({
    categoryUrl: 'https://ug-opt.in.ua/ua/category',
    productInputs: {
      'ugopt:100': { marketEvidence: marketEvidence('ugopt:100', [100, 100, 100]) },
    },
  }, {
    collector: async () => ({
      resolution: 'resolved',
      candidates: [{
        selectionKey: 'ugopt:100',
        product: {
          supplier: 'ug-opt',
          supplierSku: '100',
          title: 'Товар 100',
          price: 100,
          sourceUrl: 'https://ug-opt.in.ua/ua/p100',
          sourceImageUrl: 'https://images.prom.ua/100.jpg',
        },
      }],
      pagesFetched: 1,
    }),
    registry: { byCode: {}, collisions: [] },
    pricing: { policy: pricingPolicy() },
  });

  assert.equal(result.products[0].pricingDecision.status, 'READY');
  assert.equal(result.products[0].pricingDecision.pricing.recommendedPrice.amount, '268.75');
  assert.equal(result.products[0].workflowStatus, 'WAITING_FOR_CONTENT');
});

test('category mode resumes persisted product inputs through the PR28 state store', async () => {
  const persistedEvidence = marketEvidence('ugopt:resume', [100, 110, 120]);
  let requireRunCalls = 0;
  let reconstructCalls = 0;
  let persistCalls = 0;
  const result = await runCategoryProduction({ categoryUrl: 'https://ug-opt.in.ua/ua/category' }, {
    collector: async () => ({
      resolution: 'resolved',
      candidates: [{
        selectionKey: 'ugopt:resume',
        product: {
          supplier: 'ug-opt',
          supplierSku: 'resume',
          title: 'Товар для resume',
          price: 10,
          sourceUrl: 'https://ug-opt.in.ua/ua/p-resume',
          sourceImageUrl: 'https://images.prom.ua/resume.jpg',
        },
      }],
      pagesFetched: 1,
    }),
    registry: { byCode: {}, collisions: [] },
    pricing: { policy: pricingPolicy() },
    stateStore: {
      requireRun(runId) {
        requireRunCalls += 1;
        assert.equal(runId, 'run-resume');
      },
      reconstructRequest(runId) {
        reconstructCalls += 1;
        assert.equal(runId, 'run-resume');
        return { productInputs: { 'ugopt:resume': { marketEvidence: persistedEvidence } } };
      },
      persistRunResult(runId) {
        persistCalls += 1;
        assert.equal(runId, 'run-resume');
      },
    },
    runId: 'run-resume',
  });

  assert.equal(requireRunCalls, 1);
  assert.equal(reconstructCalls, 1);
  assert.equal(persistCalls, 2);
  assert.equal(result.products[0].pricingDecision.status, 'READY');
  assert.equal(result.products[0].pricingDecision.market.acceptedComparableCount, 3);
  assert.equal(result.products[0].workflowStatus, 'WAITING_FOR_CONTENT');
});

test('category mode scans every collected candidate and excludes registry products without a TOP limit', async () => {
  const candidates = [1, 2, 3, 4].map((sku) => ({
    selectionKey: `ugopt:${sku}`,
    product: {
      supplier: 'ug-opt',
      supplierSku: String(sku),
      title: `Товар ${sku}`,
      price: 10 + sku,
      sourceUrl: `https://ug-opt.in.ua/ua/p${sku}`,
      sourceImageUrl: `https://images.prom.ua/${sku}.jpg`,
    },
  }));
  const result = await runCategoryProduction({ categoryUrl: 'https://ug-opt.in.ua/ua/category' }, {
    collector: async () => ({
      resolution: 'resolved',
      candidates,
      pagesFetched: 6,
    }),
    registry: {
      byCode: {
        U2U: { code: 'U2U', status: 'EXISTING_IN_PROM' },
      },
      collisions: [{ code: 'U3U' }],
    },
    pricing: {
      commission,
      policy: pricingPolicy(),
      researcher: async (product) => marketEvidence(product.productKey, [100, 110, 120]),
    },
  });

  assert.equal(result.mode, 'CATEGORY_PRODUCTION');
  assert.equal(result.collected.candidateCount, 4);
  assert.deepEqual(result.filtered.candidates.map((item) => item.candidate.selectionKey), ['ugopt:1', 'ugopt:4']);
  assert.equal(result.filtered.registrySkipped, 2);
  assert.equal(result.summary.pricingReady, 2);
  assert.equal(result.products.length, 2);
  assert.equal(result.products.every((item) => item.workflowStatus === 'WAITING_FOR_CONTENT'), true);
});


test('category art-direction task resumes to five actual prompts and rejects reused SKU concepts', async () => {
  const brief = JSON.parse(await fs.readFile(new URL('../../examples/photo-creative-brief.example.json', import.meta.url), 'utf8'));
  const keys = ['ugopt:creative-a', 'ugopt:creative-b'];
  const sourceFacts = { type: 'Фен' };
  const candidates = keys.map((key) => ({ selectionKey: key, product: { supplier: 'ug-opt', supplierSku: key.split(':')[1], title: 'Фен', price: 100, sourceUrl: `https://ug-opt.in.ua/p-${key.split(':')[1]}`, sourceImageUrl: 'https://example.invalid/product.png' } }));
  const productInputs = Object.fromEntries(keys.map((key) => [key, { sourceFacts, contentArtifact: readyContentArtifact(key, sourceFacts), photoCreativeBrief: { ...structuredClone(brief), productKey: key } }]));
  let exportCalls = 0;
  const result = await runCategoryProduction({ categoryUrl: 'https://ug-opt.in.ua/ua/category', productInputs, export: { inputPath: 'test.xlsx', outputPath: 'output.xlsx' } }, {
    collector: async () => ({ resolution: 'resolved', candidates, pagesFetched: 1 }), registry: { byCode: {}, collisions: [] },
    excelExporter: async () => { exportCalls++; throw new Error('Unfinished category must not export'); },
  });
  assert.equal(result.operatorTasks[0].taskType, 'PHOTO_GENERATION');
  assert.equal(result.operatorTasks[0].input.photos.length, 5);
  assert.ok(result.operatorTasks[0].input.photos[0].prompt.includes(brief.photos[0].scene));
  assert.deepEqual(result.operatorTasks[0].input.photos[4].text, []);
  assert.equal(result.operatorTasks[1].taskType, 'PHOTO_ART_DIRECTION');
  assert.match(result.operatorTasks[1].instructions.issue, /reused concepts/);
  assert.equal(result.completion.finalWorkbookReady, false);
  assert.equal(exportCalls, 0);
});

test('invalid supplier candidates block a complete category result and final export', async () => {
  const result = await runCategoryProduction({ categoryUrl: 'https://ug-opt.in.ua/ua/category' }, {
    collector: async () => ({ resolution: 'resolved', candidates: [{ selectionKey: 'ugopt:bad', product: { supplierSku: 'bad', title: 'Товар', price: null } }] }),
    registry: { byCode: {}, collisions: [] },
  });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.completion.finalWorkbookReady, false);
  assert.equal(result.completion.skippedProducts.length, 1);
});


function batchCandidates(count) {
  return Array.from({ length: count }, (_, index) => {
    const sku = String(index + 1);
    return { selectionKey: `ugopt:${sku}`, product: { supplier: 'ug-opt', supplierSku: sku,
      title: `Товар ${sku}`, price: 100, sourceUrl: `https://ug-opt.in.ua/ua/p${sku}`,
      sourceImageUrl: `https://images.prom.ua/${sku}.jpg` } };
  });
}

test('100-product request counts only new valid SKUs after scanning the full category', async () => {
  const candidates = batchCandidates(130);
  const registry = { byCode: Object.fromEntries(Array.from({ length: 20 }, (_, i) =>
    [`U${i + 1}U`, { status: i < 10 ? 'EXISTING_IN_PROM' : 'RESERVED_FOR_IMPORT' }])), collisions: [] };
  candidates[20].product.sourceImageUrl = '';
  const result = await runCategoryProduction({ categoryUrl: 'https://ug-opt.in.ua/ua/category', targetCount: 100 }, {
    collector: async () => ({ resolution: 'resolved', candidates, pagesFetched: 13 }), registry,
  });
  assert.equal(result.collected.pagesFetched, 13);
  assert.equal(result.filtered.registrySkipped, 20);
  assert.equal(result.products.length, 100);
  assert.equal(result.products[0].productKey, 'ugopt:22');
  assert.equal(result.products.at(-1).productKey, 'ugopt:121');
  assert.equal(result.selection.availableNewCount, 109);
  assert.equal(result.selection.deferredProductKeys.length, 9);
  assert.equal(result.selection.shortfall, 0);
  assert.equal(result.completion.requestedCountMet, true);
  assert.equal(result.completion.finalWorkbookReady, false);
  assert.equal(result.operatorTasks.length, 100);
});

test('batch resume preserves selected identities across supplier order changes', async () => {
  const candidates = batchCandidates(5).reverse();
  const result = await runCategoryProduction({ categoryUrl: 'https://ug-opt.in.ua/ua/category', targetCount: 2,
    selectedProductKeys: ['ugopt:1', 'ugopt:2'] }, {
    collector: async () => ({ resolution: 'resolved', candidates }), registry: { byCode: {}, collisions: [] },
  });
  assert.deepEqual(result.products.map((p) => p.productKey), ['ugopt:1', 'ugopt:2']);
  assert.equal(result.selection.deferredProductKeys.length, 3);
});

test('a disappeared selected SKU is reported and cannot silently count toward the requested batch', async () => {
  const result = await runCategoryProduction({ categoryUrl: 'https://ug-opt.in.ua/ua/category', targetCount: 2,
    selectedProductKeys: ['ugopt:1', 'ugopt:2'] }, {
    collector: async () => ({ resolution: 'resolved', candidates: batchCandidates(1) }), registry: { byCode: {} },
  });
  assert.deepEqual(result.selection.missingSelectedProductKeys, ['ugopt:2']);
  assert.equal(result.selection.shortfall, 1);
  assert.equal(result.completion.requestedCountMet, false);
  assert.equal(result.completion.finalWorkbookReady, false);
});

test('a category exhausted by existing SKUs reports shortage without inventing products or an empty workbook', async () => {
  const result = await runCategoryProduction({ categoryUrl: 'https://ug-opt.in.ua/ua/category', targetCount: 100 }, {
    collector: async () => ({ resolution: 'resolved', candidates: batchCandidates(1) }),
    registry: { byCode: { U1U: { status: 'EXISTING_IN_PROM' } } },
  });
  assert.equal(result.status, 'INSUFFICIENT_NEW_PRODUCTS');
  assert.equal(result.selection.shortfall, 100);
  assert.equal(result.export, null);
  assert.equal(result.completion.finalWorkbookReady, false);
});

test('invalid requested counts are rejected before collecting a category', async () => {
  for (const targetCount of [0, -1, 1.5, '100', null]) {
    await assert.rejects(() => runCategoryProduction({ categoryUrl: 'https://ug-opt.in.ua/ua/category', targetCount }), /targetCount/);
  }
});
