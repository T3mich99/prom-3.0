import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceProductionProduct } from '../../src/orchestration/production-orchestrator.mjs';
import { runCategoryProduction } from '../../src/orchestration/category-production-runner.mjs';

function evidence(status) {
  return {
    productKey: 'ugopt:1', version: 1, status, sourceUrl: 'https://ug-opt.in.ua/ua/p1',
    sourceFacts: { type: { ru: 'Товар', ua: 'Товар' } },
    sourceText: { language: 'uk', title: 'Товар', description: '', characteristics: [] },
    sourceImages: [{ id: 'one', reference: 'https://images.prom.ua/one.jpg' }],
    diagnostics: status === 'READY' ? [] : [{ code: 'SOURCE_FACT_CONFLICT', message: 'conflict' }],
    provenance: { supplier: 'ug-opt', authority: 'official-product-page', parser: 'ugopt-product-detail-v1' },
  };
}

test('source conflicts stop before pricing and create one resumable Codex task', async () => {
  const result = await advanceProductionProduct({
    selectedProduct: { selectionKey: 'ugopt:1', product: { supplierSku: '1' } },
    sourceEvidence: evidence('REVIEW'), sourceFacts: evidence('REVIEW').sourceFacts,
    sourceText: evidence('REVIEW').sourceText, sourceImages: evidence('REVIEW').sourceImages,
  });
  assert.equal(result.workflowStatus, 'SOURCE_REVIEW');
  assert.equal(result.nextAction.task.taskType, 'SOURCE_REVIEW');
  assert.equal(result.pricingDecision, undefined);
});

test('READY source evidence advances to the existing pricing gate', async () => {
  const result = await advanceProductionProduct({
    selectedProduct: { selectionKey: 'ugopt:1', product: { supplierSku: '1' } },
    sourceEvidence: evidence('READY'), sourceFacts: evidence('READY').sourceFacts,
    sourceText: evidence('READY').sourceText, sourceImages: evidence('READY').sourceImages,
  });
  assert.notEqual(result.workflowStatus, 'SOURCE_REVIEW');
});

test('category runner enriches selected products before any expensive production stage', async () => {
  let calls = 0;
  const result = await runCategoryProduction({ categoryUrl: 'https://ug-opt.in.ua/ua/category', targetCount: 1 }, {
    collector: async () => ({ resolution: 'resolved', candidates: [{
      selectionKey: 'ugopt:1', product: { supplier: 'ug-opt', supplierSku: '1', title: 'Товар', price: 100, sourceUrl: 'https://ug-opt.in.ua/ua/p1', sourceImageUrl: 'https://images.prom.ua/one.jpg' },
    }] }),
    productDetailCollector: async () => { calls += 1; return evidence('REVIEW'); },
    registry: { byCode: {}, collisions: [] },
  });
  assert.equal(calls, 1);
  assert.equal(result.products[0].workflowStatus, 'SOURCE_REVIEW');
  assert.equal(result.operatorTasks[0].taskType, 'SOURCE_REVIEW');
});
