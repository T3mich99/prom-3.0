import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import {
  advanceProductionBatch,
  advanceProductionProduct,
  collectOperatorTasks,
  formatProductionSummary,
  PRODUCTION_MODES,
  PRODUCTION_STATUSES,
  ProductionOrchestrationError,
} from '../../src/orchestration/production-orchestrator.mjs';
import { buildPhotoProductionPlan } from '../../src/photos/photo-production-plan.mjs';
import { produceRealPhotoFiles } from '../../src/photos/real-photo-production.mjs';
import { PHOTO_STATUSES } from '../../src/photos/photo-contract.mjs';
import { validatePhotoArtifacts } from '../../src/photos/photo-quality.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(value) {
  let result = 0xffffffff;
  for (const byte of value) result = CRC_TABLE[(result ^ byte) & 0xff] ^ (result >>> 8);
  return (result ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const payload = Buffer.allocUnsafe(4 + data.length);
  payload.write(type, 0, 4, 'ascii');
  data.copy(payload, 4);
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  payload.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(payload), 8 + data.length);
  return chunk;
}

const pngCache = new Map();
function png(seed = 1) {
  if (pngCache.has(seed)) return pngCache.get(seed);
  const width = 1280;
  const height = 1280;
  const scanlines = Buffer.alloc((width + 1) * height);
  for (let row = 0; row < height; row += 1) {
    scanlines[row * (width + 1)] = 0;
    scanlines[row * (width + 1) + 1] = seed & 0xff;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  const value = Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(scanlines)), pngChunk('IEND', Buffer.alloc(0))]);
  pngCache.set(seed, value);
  return value;
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function longText(prefix, language = 'ua') {
  const tail = language === 'ru'
    ? 'помогает понять пользу товара и способ использования'
    : 'пояснює користь товару та спосіб використання';
  return Array.from({ length: 45 }, (_, index) => `${prefix} ${tail}, абзац ${index + 1}.`).join(' ');
}

function keywordsAtLength(length = 900, language = 'uk') {
  const terms = Array.from({ length: 25 }, (_, index) => language === 'uk'
    ? `фен для волосся пошукова фраза ${index + 1}`
    : `фен для волос поисковая фраза ${index + 1}`);
  const base = terms.join(', ');
  assert.ok(base.length <= length);
  return `${base}${'x'.repeat(length - base.length)}`;
}

function sourceFacts(overrides = {}) {
  return {
    type: 'Фен',
    brand: 'VGR',
    model: 'V-451',
    color: 'чорний',
    power: '2200 Вт',
    ...overrides,
  };
}

function contentArtifact(productKey, overrides = {}) {
  const facts = overrides.sourceFacts ?? sourceFacts();
  return {
    productKey,
    version: overrides.version ?? 1,
    content: {
      title: { ru: 'Фен для волос VGR черный', ua: 'Фен для волосся VGR чорний' },
      description: {
        ru: longText('Фен помогает быстро высушить волосы и удобно подготовить их к укладке', 'ru'),
        ua: longText('Фен допомагає швидко висушити волосся та зручно підготувати його до укладання', 'ua'),
      },
      keywords: { ru: keywordsAtLength(900, 'ru'), ua: keywordsAtLength(900, 'uk') },
      characteristics: [{ name: 'Потужність', value: '2200 Вт' }],
      ...(overrides.content ?? {}),
    },
    sourceFacts: facts,
    ...(overrides.claims === undefined ? {} : { claims: overrides.claims }),
  };
}

function selectedProduct(productKey = 'ugopt:P-001', overrides = {}) {
  return {
    selectionKey: productKey,
    requestKey: 'hair',
    requestedCategory: 'Фени',
    resolvedCategory: { source: 'ug-opt', sourceCategoryName: 'Фени', sourceCategoryUrl: 'https://ug-opt.in.ua/ua/g-hair' },
    product: {
      supplier: 'ug-opt',
      supplierSku: productKey.split(':').at(-1),
      sourceUrl: `https://ug-opt.in.ua/ua/p/${productKey.split(':').at(-1)}`,
      title: 'Фен VGR V-451',
      price: 90,
      ...overrides.product,
    },
    ...overrides,
  };
}

function pricingProduct(productKey, overrides = {}) {
  return {
    productKey,
    identity: { brand: 'VGR', model: 'V-451' },
    supplier: {
      name: 'ug-opt',
      purchasePrice: { amount: overrides.purchase ?? '90.00', currency: overrides.currency ?? 'UAH' },
      provenance: { sourceUrl: `https://ug-opt.in.ua/ua/p/${productKey}`, supplierSku: productKey },
      supplierSku: productKey,
      sourceUrl: `https://ug-opt.in.ua/ua/p/${productKey}`,
    },
  };
}

function comparable(productKey, price, index, overrides = {}) {
  return {
    source: overrides.source ?? (index < 3 ? 'market-a' : 'market-b'),
    listingId: `${productKey}-listing-${index + 1}`,
    seller: 'seller',
    title: 'Фен VGR V-451',
    price: { amount: String(price), currency: 'UAH' },
    available: true,
    brand: 'VGR',
    model: 'V-451',
    productIdentityEvidence: { productKey },
    matchType: overrides.matchType ?? 'exact',
    matchConfidence: 'high',
  };
}

function marketEvidence(productKey, prices = ['220', '225', '230', '240', '250']) {
  return {
    productKey,
    comparables: prices.map((price, index) => comparable(productKey, price, index)),
  };
}

function pricingOptions(overrides = {}) {
  return {
    commission: {
      rateBps: 2000,
      source: 'prom-category-config',
      categoryId: 'cat-1',
      provenance: { source: 'fixture', category: 'cat-1' },
    },
    policy: {
      marketEvidence: { minimumReadyConfidence: 'HIGH' },
      profitability: { rules: [{ id: 'fixture', minimumNetProfitMinor: 1000, minimumRoiBps: 2000, minimumNetMarginBps: 1000 }] },
    },
    ...overrides,
  };
}

function sourceImages(productKey) {
  return [
    { id: `${productKey}-front`, url: `https://example.invalid/source/${productKey}/front.png`, role: 'front', provenance: 'supplier' },
    { id: `${productKey}-side`, url: `https://example.invalid/source/${productKey}/side.png`, role: 'side', provenance: 'supplier' },
  ];
}

function baseJob(productKey = 'ugopt:P-001', overrides = {}) {
  return {
    selectedProduct: selectedProduct(productKey),
    pricingProduct: pricingProduct(productKey, overrides.pricingProduct),
    sourceFacts: sourceFacts(overrides.sourceFacts),
    sourceText: { title: 'Фен VGR V-451', supplierDescription: 'Опис постачальника' },
    categoryContext: { source: 'ug-opt', name: 'Фени' },
    sourceImages: sourceImages(productKey),
    ...overrides,
  };
}

function readyMarketJob(productKey = 'ugopt:P-001', overrides = {}) {
  return baseJob(productKey, { marketEvidence: marketEvidence(productKey), ...overrides });
}

function readyContentJob(productKey = 'ugopt:P-001', overrides = {}) {
  return readyMarketJob(productKey, { contentArtifact: contentArtifact(productKey, { sourceFacts: overrides.sourceFacts ?? sourceFacts(), ...(overrides.content ?? {}) }), ...overrides });
}

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'production-orchestrator-'));
}

function imageProvider({ seed = 1, calls = [] } = {}) {
  return {
    async generateImage(request) {
      calls.push(structuredClone(request));
      return { bytes: png(seed + request.photoIndex), mimeType: 'image/png', providerArtifactId: `provider-${request.productKey}-${request.photoIndex}` };
    },
  };
}

async function makePhotoArtifact(job, root) {
  const plan = buildPhotoProductionPlan({ selectedProduct: job.selectedProduct, contentArtifact: job.contentArtifact, sourceImages: job.sourceImages, sourceFacts: job.sourceFacts });
  const produced = await produceRealPhotoFiles({ plan, sourceFacts: job.sourceFacts }, { outputRoot: root, provider: imageProvider() });
  const visualQa = {
    productKey: plan.productKey,
    version: plan.version,
    status: PHOTO_STATUSES.READY,
    verification: 'OPERATOR_CHECKLIST',
    photos: plan.photos.map((photo) => ({
      photoIndex: photo.index,
      role: photo.role,
      status: PHOTO_STATUSES.READY,
      checks: {
        productIdentityPreserved: true,
        noModelTransformation: true,
        brandPreserved: true,
        noVisibleModelText: true,
        noFabricatedClaims: true,
        noFabricatedSpecifications: true,
        noUnsupportedAccessories: true,
        compositionMatchesRole: true,
        premiumCommercialQuality: true,
        noDarkHalos: true,
        noCheapMarketplaceAesthetic: true,
        noObviousAiVisualDefects: true,
        slotDistinct: true,
    sceneDistinct: true,
    layoutDistinct: true,
    productSpecificDesign: true,
        productPositionDistinct: true,
        textDoesNotCoverProduct: true,
        textReadable: true,
      },
    })),
  };
  const quality = validatePhotoArtifacts({ plan, artifacts: produced.artifacts, sourceFacts: job.sourceFacts, visualQa }, { requireVisualQa: true });
  return { ...produced, visualQa, quality, approvedMediaArtifact: quality.approvedMediaArtifact };
}

async function plusOptions(overrides = {}) {
  return {
    pricing: pricingOptions(),
    ...overrides,
  };
}

test('valid selected product enters the explicit market waiting state', async () => {
  const result = await advanceProductionProduct(baseJob(), await plusOptions());
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_MARKET_RESEARCH);
  assert.equal(result.productKey, 'ugopt:P-001');
  assert.equal(result.nextAction.type, 'OPERATOR_TASK');
});

test('default mode is PLUS_FIRST and never requires an API key', async () => {
  const result = await advanceProductionProduct(baseJob(), { pricing: pricingOptions() });
  assert.equal(result.mode, PRODUCTION_MODES.PLUS_FIRST);
  assert.equal(result.nextAction.task.taskType, 'MARKET_RESEARCH');
});

test('operator task is deterministic and JSON serializable', async () => {
  const job = baseJob();
  const first = await advanceProductionProduct(job, { pricing: pricingOptions() });
  const second = await advanceProductionProduct(job, { pricing: pricingOptions() });
  assert.deepEqual(first, second);
  assert.doesNotThrow(() => JSON.stringify(first.nextAction.task));
  assert.equal(Object.hasOwn(first.nextAction.task, 'timestamp'), false);
  assert.equal(Object.hasOwn(first.nextAction.task, 'randomId'), false);
});

test('market task carries exact identity facts and excludes economics and secrets', async () => {
  const result = await advanceProductionProduct(baseJob(), { pricing: pricingOptions() });
  const task = result.nextAction.task;
  assert.equal(task.input.productKey, 'ugopt:P-001');
  assert.equal(task.input.verifiedBrand, 'VGR');
  assert.equal(task.input.verifiedModel, 'V-451');
  assert.equal(JSON.stringify(task).includes('purchasePrice'), false);
  assert.equal(JSON.stringify(task).includes('commission'), false);
});

test('market task asks for evidence and not a pricing decision', async () => {
  const result = await advanceProductionProduct(baseJob(), { pricing: pricingOptions() });
  assert.equal(result.nextAction.task.instructions.returnEvidenceOnly, true);
  assert.equal(result.nextAction.task.instructions.doNotReturnPricingDecision, true);
  assert.equal(result.nextAction.task.validationAuthority, 'PR22 market-pricing.mjs');
});

test('no supplier state is an explicit optional path that reaches pricing', async () => {
  const result = await advanceProductionProduct(baseJob(), { pricing: pricingOptions() });
  assert.equal(result.supplierState, undefined);
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_MARKET_RESEARCH);
});

test('SELLABLE supplier state proceeds', async () => {
  const result = await advanceProductionProduct(readyMarketJob('sellable'), { pricing: pricingOptions() });
  const withState = await advanceProductionProduct({ ...readyMarketJob('sellable'), supplierState: { productKey: 'sellable', availabilityStatus: 'SELLABLE' } }, { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_CONTENT);
  assert.equal(withState.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_CONTENT);
});

test('UNAVAILABLE supplier blocks all later work', async () => {
  const result = await advanceProductionProduct({ ...baseJob(), supplierState: { productKey: 'ugopt:P-001', availabilityStatus: 'UNAVAILABLE' } }, { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.BLOCKED_SUPPLIER);
  assert.equal(result.nextAction, null);
});

test('REMOVED supplier blocks all later work', async () => {
  const result = await advanceProductionProduct({ ...baseJob(), supplierState: { productKey: 'ugopt:P-001', availabilityStatus: 'REMOVED' } }, { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.BLOCKED_SUPPLIER);
});

test('AT_RISK supplier is review and does not trigger costly tasks', async () => {
  const result = await advanceProductionProduct({ ...baseJob(), supplierState: { productKey: 'ugopt:P-001', availabilityStatus: 'AT_RISK' } }, { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.SUPPLIER_REVIEW);
  assert.equal(result.nextAction.type, 'MANUAL_REVIEW');
});

test('supplier identity mismatch is a hard product identity error', async () => {
  await assert.rejects(
    () => advanceProductionProduct({ ...baseJob(), supplierState: { productKey: 'other', availabilityStatus: 'SELLABLE' } }, { pricing: pricingOptions() }),
    (error) => error instanceof ProductionOrchestrationError && error.code === 'PRODUCT_IDENTITY_MISMATCH',
  );
});

test('valid market evidence is recomputed through the PR22 validator', async () => {
  const result = await advanceProductionProduct(readyMarketJob(), { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_CONTENT);
  assert.equal(result.pricingDecision.status, 'READY');
  assert.ok(result.pricingDecision.pricing.recommendedPrice.amountMinor > 0);
});

test('malformed market evidence does not bypass pricing validation', async () => {
  const result = await advanceProductionProduct(baseJob('bad-market', { marketEvidence: { productKey: 'bad-market', comparables: [{ nope: true }] } }), { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PRICING_REVIEW);
  assert.equal(result.nextAction.type, 'MANUAL_REVIEW');
  assert.equal(JSON.stringify(result).includes('CONTENT_GENERATION'), false);
});

test('PRICE_REVIEW becomes PRICING_REVIEW', async () => {
  const result = await advanceProductionProduct(readyMarketJob('price-review', { pricingProduct: pricingProduct('price-review', { currency: 'EUR' }) }), { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PRICING_REVIEW);
  assert.equal(result.nextAction.type, 'MANUAL_REVIEW');
});

test('SKIP becomes SKIPPED and creates no content or photo task', async () => {
  const result = await advanceProductionProduct(readyMarketJob('skip', { pricingProduct: pricingProduct('skip', { purchase: '300.00' }), marketEvidence: marketEvidence('skip', ['100', '100', '100', '100', '100']) }), { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.SKIPPED);
  assert.equal(result.nextAction, null);
  assert.equal(JSON.stringify(result).includes('CONTENT_GENERATION'), false);
  assert.equal(JSON.stringify(result).includes('PHOTO_GENERATION'), false);
});

test('pricing decision cannot be trusted without evidence or researcher', async () => {
  const productKey = 'decision-without-evidence';
  const result = await advanceProductionProduct({ ...baseJob(productKey), pricingDecision: { productKey, status: 'READY' } }, { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_MARKET_RESEARCH);
});

test('forged pricing decision is rejected after recomputation', async () => {
  const productKey = 'forged-price';
  const job = readyMarketJob(productKey, { pricingDecision: { productKey, status: 'SKIP', reasonCodes: ['forged'] } });
  await assert.rejects(
    () => advanceProductionProduct(job, { pricing: pricingOptions() }),
    (error) => error instanceof ProductionOrchestrationError && error.code === 'PRICING_DECISION_MISMATCH',
  );
});

test('content is not requested before pricing is READY', async () => {
  const calls = [];
  const result = await advanceProductionProduct(baseJob(), { pricing: pricingOptions(), content: { generator: async () => { calls.push(true); return {}; } } });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_MARKET_RESEARCH);
  assert.equal(calls.length, 0);
});

test('missing content and no generator produces a content operator task', async () => {
  const result = await advanceProductionProduct(readyMarketJob(), { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_CONTENT);
  assert.equal(result.nextAction.task.taskType, 'CONTENT_GENERATION');
  assert.equal(result.nextAction.task.input.pricingStatus, 'READY');
});

test('content task contains no purchase price, commission, or ROI', async () => {
  const result = await advanceProductionProduct(readyMarketJob(), { pricing: pricingOptions() });
  const serialized = JSON.stringify(result.nextAction.task);
  assert.equal(serialized.includes('purchasePrice'), false);
  assert.equal(serialized.includes('commission'), false);
  assert.equal(serialized.includes('ROI'), false);
  assert.equal(serialized.includes('recommendedPrice'), false);
});

test('content task includes commercial constraints and exact expected fields', async () => {
  const result = await advanceProductionProduct(readyMarketJob(), { pricing: pricingOptions() });
  const task = result.nextAction.task;
  assert.deepEqual(task.expectedResultSchema.requiredFields, ['title', 'description', 'keywords', 'characteristics']);
  assert.equal(task.instructions.noCompletenessSection, true);
  assert.deepEqual(task.validationAuthority, ['Content Contract v1', 'Commercial Content Quality v2']);
});

test('content task is the only next action', async () => {
  const result = await advanceProductionProduct(readyMarketJob(), { pricing: pricingOptions() });
  assert.deepEqual(Object.keys(result.nextAction), ['type', 'task']);
});

test('commercial-invalid content becomes CONTENT_REWORK and never CONTENT_READY', async () => {
  const artifact = contentArtifact('commercial-invalid', { content: { description: { ru: `${longText('Описание')}\n\n### Комплектация\nТовар`, ua: `${longText('Опис')}\n\n### Комплектація\nТовар` } } });
  const job = readyContentJob('commercial-invalid', { contentArtifact: artifact });
  const result = await advanceProductionProduct(job, { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.CONTENT_REWORK);
  assert.equal(result.nextAction.task.taskType, 'CONTENT_REWORK');
});

test('REVIEW content becomes CONTENT_REVIEW and creates no photo task', async () => {
  const artifact = contentArtifact('content-review');
  delete artifact.content.characteristics;
  const result = await advanceProductionProduct(readyMarketJob('content-review', { contentArtifact: artifact }), { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.CONTENT_REVIEW);
  assert.equal(result.nextAction.type, 'MANUAL_REVIEW');
  assert.equal(JSON.stringify(result).includes('PHOTO_GENERATION'), false);
});

test('content REWORK task contains only failed fields', async () => {
  const artifact = contentArtifact('content-rework', { content: { description: { ru: 'short', ua: 'коротко' } } });
  const result = await advanceProductionProduct(readyMarketJob('content-rework', { contentArtifact: artifact }), { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.CONTENT_REWORK);
  assert.deepEqual(result.nextAction.task.input.fields.map((field) => field.field), ['description']);
});

test('content generator uses the existing commercial validator', async () => {
  const result = await advanceProductionProduct(readyMarketJob('generated-content'), {
    pricing: pricingOptions(),
    content: {
      generator: async () => ({ content: contentArtifact('generated-content').content }),
    },
  });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_PHOTOS);
  assert.equal(result.contentArtifact.productKey, 'generated-content');
});

test('content generator failure is FAILED and not a fabricated READY result', async () => {
  const result = await advanceProductionProduct(readyMarketJob('content-provider-failure'), {
    pricing: pricingOptions(),
    content: { generator: async () => { throw new Error('provider offline'); } },
  });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.FAILED);
  assert.equal(result.error.stage, 'content');
});

test('content field rework uses only the existing rework plan', async () => {
  const artifact = contentArtifact('content-rework-provider', { content: { description: { ru: 'short', ua: 'коротко' } } });
  const result = await advanceProductionProduct(readyMarketJob('content-rework-provider', { contentArtifact: artifact }), {
    pricing: pricingOptions(),
    content: { generator: async (request) => ({ content: { description: {
      ru: longText('Фен помогает быстро высушить волосы и удобно подготовить их к укладке', 'ru'),
      ua: longText('Фен допомагає швидко висушити волосся та зручно підготувати його до укладання', 'ua'),
    } } }) },
  });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_PHOTOS);
  assert.equal(result.contentArtifact.version, 2);
  assert.equal(result.contentArtifact.content.title.ua, artifact.content.title.ua);
});

test('source facts mismatch in content is rejected', async () => {
  const artifact = contentArtifact('content-facts-mismatch', { sourceFacts: sourceFacts({ color: 'білий' }) });
  await assert.rejects(
    () => advanceProductionProduct(readyMarketJob('content-facts-mismatch', { contentArtifact: artifact }), { pricing: pricingOptions() }),
    (error) => error instanceof ProductionOrchestrationError && error.code === 'SOURCE_FACTS_MISMATCH',
  );
});

test('photos are not requested before commercial content READY', async () => {
  const artifact = contentArtifact('photo-gate', { content: { description: { ru: 'short', ua: 'коротко' } } });
  const result = await advanceProductionProduct(readyMarketJob('photo-gate', { contentArtifact: artifact }), { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.CONTENT_REWORK);
  assert.equal(result.nextAction.task.taskType, 'CONTENT_REWORK');
  assert.equal(JSON.stringify(result).includes('PHOTO_GENERATION'), false);
});

test('missing photos and no provider produces one product task with five independent outputs', async () => {
  const result = await advanceProductionProduct(readyContentJob('photo-wait'), { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_PHOTOS);
  const task = result.nextAction.task;
  assert.equal(task.taskType, 'PHOTO_GENERATION');
  assert.deepEqual(task.input.photos.map((photo) => photo.photoIndex), [1, 2, 3, 4, 5]);
  assert.equal(task.expectedResultSchema.separateOutputCount, 5);
  assert.equal(task.instructions.noCollage, true);
  assert.equal(task.expectedResultSchema.width, 1280);
  assert.equal(task.expectedResultSchema.height, 1280);
});

test('photo task excludes economic data and preserves planned Ukrainian text', async () => {
  const result = await advanceProductionProduct(readyContentJob('photo-task-safe'), { pricing: pricingOptions() });
  const task = result.nextAction.task;
  assert.equal(JSON.stringify(task).includes('purchasePrice'), false);
  assert.equal(JSON.stringify(task).includes('commission'), false);
  assert.equal(task.input.photos[0].text[0].language, 'uk');
});

test('photo provider path uses the real PR24 production boundary', async () => {
  const root = await tempRoot();
  try {
    const calls = [];
    const result = await advanceProductionProduct(readyContentJob('photo-provider'), { pricing: pricingOptions(), photos: { provider: imageProvider({ calls }), outputRoot: root } });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PHOTO_REVIEW);
    assert.equal(calls.length, 5);
    assert.equal(result.approvedMedia, undefined);
    assert.equal(result.photoArtifact.quality.visualQa.status, PHOTO_STATUSES.REVIEW);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('photo provider output is never accepted without actual approved media', async () => {
  const root = await tempRoot();
  try {
    const result = await advanceProductionProduct(readyContentJob('photo-approved'), { pricing: pricingOptions(), photos: { provider: imageProvider(), outputRoot: root } });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PHOTO_REVIEW);
    assert.equal(result.approvedMedia, undefined);
    assert.equal(result.photoArtifact.quality.visualQa.status, PHOTO_STATUSES.REVIEW);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('operator photo artifact is revalidated from actual bytes', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('photo-import');
    const photoArtifact = await makePhotoArtifact(job, root);
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.READY_FOR_EXPORT);
    assert.equal(result.approvedMedia.photos.length, 5);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('invalid operator PNG bytes cannot be marked READY', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('photo-invalid-bytes');
    const photoArtifact = await makePhotoArtifact(job, root);
    await fs.writeFile(photoArtifact.artifacts[0].asset.path, Buffer.from('not a png'));
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PHOTO_REVIEW);
    assert.equal(result.approvedMedia, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('photo product identity mismatch is rejected', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('photo-identity');
    const photoArtifact = await makePhotoArtifact(job, root);
    photoArtifact.productKey = 'other-product';
    await assert.rejects(
      () => advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() }),
      (error) => error instanceof ProductionOrchestrationError && error.code === 'PRODUCT_IDENTITY_MISMATCH',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('one bad photo produces a selective PHOTO_REWORK task only for that index', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('photo-selective');
    const photoArtifact = await makePhotoArtifact(job, root);
    delete photoArtifact.quality;
    delete photoArtifact.approvedMediaArtifact;
    photoArtifact.artifacts[2].providerArtifactId = photoArtifact.artifacts[0].providerArtifactId;
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PHOTO_REWORK);
    assert.equal(result.nextAction.task.taskType, 'PHOTO_REWORK');
    assert.deepEqual(result.nextAction.task.input.photos.map((photo) => photo.photoIndex), [3]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('selective photo rework preserves accepted files and requires visual QA for the regenerated slot', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('photo-selective-provider');
    const photoArtifact = await makePhotoArtifact(job, root);
    delete photoArtifact.quality;
    delete photoArtifact.approvedMediaArtifact;
    photoArtifact.artifacts[2].providerArtifactId = photoArtifact.artifacts[0].providerArtifactId;
    const before = await Promise.all(photoArtifact.artifacts.map((artifact) => fs.readFile(artifact.asset.path)));
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions(), photos: { provider: imageProvider({ seed: 100 }), outputRoot: root } });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PHOTO_REWORK);
    const after = await Promise.all(result.photoArtifact.artifacts.map((artifact) => fs.readFile(artifact.asset.path)));
    for (const index of [0, 1, 3, 4]) assert.deepEqual(after[index], before[index]);
    assert.notDeepEqual(after[2], before[2]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('approvedMedia without a validated photoArtifact is rejected', async () => {
  const job = readyContentJob('approved-without-artifact');
  const result = await advanceProductionProduct({ ...job, approvedMedia: { productKey: 'approved-without-artifact', photos: [] } }, { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.FAILED);
  assert.equal(result.error.code, 'PHOTO_ARTIFACT_REQUIRED');
});

test('approved media product identity mismatch is rejected', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('approved-identity');
    const photoArtifact = await makePhotoArtifact(job, root);
    photoArtifact.approvedMediaArtifact.productKey = 'other';
    await assert.rejects(
      () => advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() }),
      (error) => error instanceof ProductionOrchestrationError && error.code === 'PRODUCT_IDENTITY_MISMATCH',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('READY_FOR_EXPORT requires pricing, commercial content, and five approved photos', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('ready-requirements');
    const photoArtifact = await makePhotoArtifact(job, root);
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.READY_FOR_EXPORT);
    assert.equal(result.pricingDecision.status, 'READY');
    assert.equal(result.contentArtifact.productKey, 'ready-requirements');
    assert.equal(result.approvedMedia.photos.length, 5);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('READY_FOR_EXPORT is not READY_FOR_PROM and local media is not public', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('not-prom-ready');
    const photoArtifact = await makePhotoArtifact(job, root);
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.READY_FOR_EXPORT);
    assert.equal(Object.hasOwn(result, 'READY_FOR_PROM'), false);
    assert.equal(result.productionArtifact.approvedMedia.publication.status, 'LOCAL_ONLY');
    assert.equal(result.productionArtifact.approvedMedia.publication.publicUrlsAvailable, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('final artifact preserves pricing as the final selling-price authority', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('price-authority');
    const photoArtifact = await makePhotoArtifact(job, root);
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.deepEqual(result.productionArtifact.pricingDecision, result.pricingDecision);
    assert.ok(result.productionArtifact.pricingDecision.pricing.recommendedPrice);
    assert.equal(result.productionArtifact.pricingDecision.supplier.purchasePrice.amountMinor > 0, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('resolved metadata is preserved and no Prom category is inferred', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('metadata-boundary', { resolvedMetadata: { categoryId: 'caller-category', categoryName: 'Фени' } });
    const photoArtifact = await makePhotoArtifact(job, root);
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.deepEqual(result.productionArtifact.resolvedMetadata, job.resolvedMetadata);
    assert.equal(result.diagnostics.some((item) => item.code === 'CATEGORY_DEFERRED_TO_EXPORT'), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('missing category metadata is explicit and does not block the non-Prom export artifact', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('category-deferred');
    const photoArtifact = await makePhotoArtifact(job, root);
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.READY_FOR_EXPORT);
    assert.ok(result.diagnostics.some((item) => item.code === 'CATEGORY_DEFERRED_TO_EXPORT'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('characteristic plan is preserved when a SAFE mapping is supplied', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('characteristics', { characteristicMapping: { status: 'SAFE', dynamicCharacteristicColumns: [
      { columnIndex: 0, originalHeader: 'Назва_Характеристики' },
      { columnIndex: 1, originalHeader: 'Одиниця_виміру_Характеристики' },
      { columnIndex: 2, originalHeader: 'Значення_Характеристики' },
    ] } });
    const photoArtifact = await makePhotoArtifact(job, root);
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.READY_FOR_EXPORT);
    assert.equal(result.characteristicPlan.status, 'SAFE');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('characteristic mapping is deferred when no Excel template mapping exists', async () => {
  const result = await advanceProductionProduct(readyContentJob('characteristics-deferred'), { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_PHOTOS);
  assert.equal(result.characteristicPlan, undefined);
});

test('all artifact identity mismatches use the same canonical product key', async () => {
  const productKey = 'identity-all';
  await assert.rejects(() => advanceProductionProduct({ ...readyMarketJob(productKey), pricingProduct: pricingProduct('other') }, { pricing: pricingOptions() }), /productKey/u);
  await assert.rejects(() => advanceProductionProduct({ ...readyMarketJob(productKey), contentArtifact: contentArtifact('other') }, { pricing: pricingOptions() }), /productKey/u);
});

test('identifier logic is preserved, not regenerated', async () => {
  const result = await advanceProductionProduct(baseJob('ugopt:0007'), { pricing: pricingOptions() });
  assert.equal(result.productKey, 'ugopt:0007');
  assert.equal(result.selectedProduct.selectionKey, 'ugopt:0007');
});

test('same single-product path is used by batch orchestration', async () => {
  const job = baseJob('batch-same-path');
  const options = { pricing: pricingOptions() };
  const single = await advanceProductionProduct(job, options);
  const batch = await advanceProductionBatch([job], options);
  assert.deepEqual(batch.results[0], single);
});

test('batch preserves input order and isolates one product failure', async () => {
  const good = baseJob('batch-good');
  const bad = { ...baseJob('batch-bad'), pricingProduct: pricingProduct('other') };
  const result = await advanceProductionBatch([good, bad], { pricing: pricingOptions() });
  assert.deepEqual(result.results.map((item) => item.productKey), ['batch-good', 'batch-bad']);
  assert.equal(result.results[0].workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_MARKET_RESEARCH);
  assert.equal(result.results[1].workflowStatus, PRODUCTION_STATUSES.FAILED);
});

test('batch summary exposes deterministic workflow counters', async () => {
  const result = await advanceProductionBatch([
    baseJob('summary-market'),
    { ...baseJob('summary-blocked'), supplierState: { productKey: 'summary-blocked', availabilityStatus: 'UNAVAILABLE' } },
    readyMarketJob('summary-content'),
  ], { pricing: pricingOptions() });
  assert.deepEqual(result.summary, {
    total: 3,
    readyForExport: 0,
    sourceReview: 0,
    waitingMarketResearch: 1,
    pricingReview: 0,
    waitingContent: 1,
    contentReview: 0,
    contentRework: 0,
    waitingPhotos: 0,
    photoReview: 0,
    photoRework: 0,
    blockedSupplier: 1,
    supplierReview: 0,
    skipped: 0,
    failed: 0,
    priced: 0,
  });
});

test('operator task collection returns only current tasks without duplicates', async () => {
  const jobs = [baseJob('tasks-1'), baseJob('tasks-1'), baseJob('tasks-2')];
  const batch = await advanceProductionBatch(jobs, { pricing: pricingOptions() });
  const tasks = collectOperatorTasks(batch);
  assert.deepEqual(tasks.map((task) => task.productKey), ['tasks-1', 'tasks-2']);
  assert.equal(new Set(tasks.map((task) => JSON.stringify(task))).size, tasks.length);
});

test('operator summary formatting is deterministic and has no timestamps', async () => {
  const batch = await advanceProductionBatch([baseJob('format')], { pricing: pricingOptions() });
  const summary = formatProductionSummary(batch);
  assert.match(summary, /Усього товарів: 1/u);
  assert.equal(/\d{4}-\d{2}-\d{2}/u.test(summary), false);
});

test('pure Plus-first resume: market evidence moves the same job to content waiting', async () => {
  const first = await advanceProductionProduct(baseJob('resume-market'), { pricing: pricingOptions() });
  const second = await advanceProductionProduct({ ...baseJob('resume-market'), marketEvidence: marketEvidence('resume-market') }, { pricing: pricingOptions() });
  assert.equal(first.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_MARKET_RESEARCH);
  assert.equal(second.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_CONTENT);
  assert.equal(second.productKey, first.productKey);
});

test('resume content moves the same job to photo waiting', async () => {
  const job = readyContentJob('resume-content');
  const result = await advanceProductionProduct(job, { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_PHOTOS);
  assert.equal(result.contentArtifact.productKey, 'resume-content');
});

test('resume photos reaches READY_FOR_EXPORT only after validated media', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('resume-photos');
    const waiting = await advanceProductionProduct(job, { pricing: pricingOptions() });
    const photoArtifact = await makePhotoArtifact(job, root);
    const ready = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.equal(waiting.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_PHOTOS);
    assert.equal(ready.workflowStatus, PRODUCTION_STATUSES.READY_FOR_EXPORT);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('injected researcher uses the same pricing validator as operator evidence', async () => {
  const productKey = 'researcher-path';
  const result = await advanceProductionProduct(baseJob(productKey), {
    pricing: {
      ...pricingOptions(),
      researcher: async () => marketEvidence(productKey),
    },
  });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_CONTENT);
  assert.equal(result.pricingDecision.status, 'READY');
});

test('injected researcher malformed output remains in pricing review', async () => {
  const result = await advanceProductionProduct(baseJob('researcher-invalid'), { pricing: { ...pricingOptions(), researcher: async () => ({ productKey: 'researcher-invalid', comparables: [] }) } });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PRICING_REVIEW);
  assert.equal(result.nextAction.type, 'MANUAL_REVIEW');
});

test('injected photo provider and operator photo artifacts share the same validator path', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('same-photo-validator');
    const photoArtifact = await makePhotoArtifact(job, root);
    const imported = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.equal(imported.workflowStatus, PRODUCTION_STATUSES.READY_FOR_EXPORT);
    assert.equal(imported.approvedMedia.photos.length, 5);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('inputs and options remain immutable', async () => {
  const job = readyContentJob('immutable');
  const options = { pricing: pricingOptions() };
  const beforeJob = structuredClone(job);
  const beforeOptions = structuredClone(options);
  await advanceProductionProduct(job, options);
  assert.deepEqual(job, beforeJob);
  assert.deepEqual(options, beforeOptions);
});

test('no database, scheduler, retries, or provider credentials are required', async () => {
  const result = await advanceProductionProduct(baseJob('no-infrastructure'), { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_MARKET_RESEARCH);
  assert.equal(Object.hasOwn(result, 'database'), false);
  assert.equal(Object.hasOwn(result, 'scheduler'), false);
  assert.equal(Object.hasOwn(result, 'retryCount'), false);
});

test('operator tasks do not include ChatGPT UI or credential automation', async () => {
  const result = await advanceProductionProduct(baseJob('no-ui'), { pricing: pricingOptions() });
  const taskText = JSON.stringify(result.nextAction.task);
  assert.equal(taskText.includes('cookie'), false);
  assert.equal(taskText.includes('browser'), false);
  assert.equal(taskText.includes('apiKey'), false);
  assert.equal(taskText.includes('token'), false);
});

test('100-product gate creates no photo tasks before pricing/content gates', async () => {
  const jobs = [];
  for (let index = 0; index < 100; index += 1) {
    const productKey = `bulk-${index + 1}`;
    jobs.push(index < 20
      ? readyMarketJob(productKey)
      : index < 60
        ? readyMarketJob(productKey, { pricingProduct: pricingProduct(productKey, { purchase: '300.00' }), marketEvidence: marketEvidence(productKey, ['100', '100', '100', '100', '100']) })
        : baseJob(productKey));
  }
  const batch = await advanceProductionBatch(jobs, { pricing: pricingOptions() });
  assert.equal(batch.summary.waitingContent, 20);
  assert.equal(batch.summary.skipped, 40);
  assert.equal(batch.summary.waitingMarketResearch, 40);
  assert.equal(collectOperatorTasks(batch).some((task) => task.taskType.startsWith('PHOTO')), false);
});

test('6000 compact jobs remain independent and do not create a giant shared task', async () => {
  const jobs = Array.from({ length: 6000 }, (_, index) => baseJob(`compact-${index + 1}`));
  const batch = await advanceProductionBatch(jobs, { pricing: pricingOptions() });
  assert.equal(batch.summary.total, 6000);
  assert.equal(batch.summary.waitingMarketResearch, 6000);
  const tasks = collectOperatorTasks(batch);
  assert.equal(tasks.length, 6000);
  assert.ok(JSON.stringify(tasks[0]).length < 5000);
});

test('partial operator completion keeps completed and waiting products independent', async () => {
  const root = await tempRoot();
  try {
    const completedJob = readyContentJob('partial-complete');
    const photoArtifact = await makePhotoArtifact(completedJob, root);
    const batch = await advanceProductionBatch([
      { ...completedJob, photoArtifact },
      readyContentJob('partial-waiting'),
    ], { pricing: pricingOptions() });
    assert.deepEqual(batch.results.map((result) => result.workflowStatus), [PRODUCTION_STATUSES.READY_FOR_EXPORT, PRODUCTION_STATUSES.WAITING_FOR_PHOTOS]);
    assert.deepEqual(collectOperatorTasks(batch).map((task) => task.productKey), ['partial-waiting']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('PLUS_FIRST does not encode or promise an assumed quota', async () => {
  const result = await advanceProductionProduct(baseJob('batch-size-neutral'), { pricing: pricingOptions() });
  const serialized = JSON.stringify(result);
  assert.equal(/1000|unlimited|quota/iu.test(serialized), false);
});

test('AUTOMATED_PROVIDER without a researcher is explicit failure rather than fake Plus access', async () => {
  const result = await advanceProductionProduct(baseJob('automated-no-researcher'), { mode: PRODUCTION_MODES.AUTOMATED_PROVIDER, pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.FAILED);
  assert.equal(result.error.code, 'MARKET_RESEARCHER_REQUIRED');
});

test('production result keeps exact canonical identity after each resume stage', async () => {
  const productKey = 'identity-resume';
  const first = await advanceProductionProduct(baseJob(productKey), { pricing: pricingOptions() });
  const second = await advanceProductionProduct(readyMarketJob(productKey), { pricing: pricingOptions() });
  const third = await advanceProductionProduct(readyContentJob(productKey), { pricing: pricingOptions() });
  assert.deepEqual([first.productKey, second.productKey, third.productKey], [productKey, productKey, productKey]);
  assert.deepEqual([first.selectedProduct.selectionKey, second.selectedProduct.selectionKey, third.selectedProduct.selectionKey], [productKey, productKey, productKey]);
});

test('photo task contains five fixed role names in canonical order', async () => {
  const result = await advanceProductionProduct(readyContentJob('role-order'), { pricing: pricingOptions() });
  assert.deepEqual(result.nextAction.task.input.photos.map((photo) => photo.role), ['hero', 'usage', 'benefits', 'feature', 'final']);
});

test('photo rework task retains only the failed index and not a collage instruction', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('photo-rework-contract');
    const photoArtifact = await makePhotoArtifact(job, root);
    delete photoArtifact.quality;
    delete photoArtifact.approvedMediaArtifact;
    photoArtifact.artifacts[1].providerArtifactId = photoArtifact.artifacts[0].providerArtifactId;
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PHOTO_REWORK);
    assert.deepEqual(result.nextAction.task.input.photos.map((photo) => photo.photoIndex), [2]);
    assert.equal(result.nextAction.task.instructions.separateFilesOnly, true);
    assert.equal(result.nextAction.task.instructions.noCollage, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('selected product input can provide a PR22-compatible pricing product directly', async () => {
  const productKey = 'nested-pricing';
  const job = { ...baseJob(productKey), pricingProduct: undefined, selectedProduct: selectedProduct(productKey, { product: { pricingProduct: pricingProduct(productKey) } }) };
  const result = await advanceProductionProduct({ ...job, marketEvidence: marketEvidence(productKey) }, { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_CONTENT);
});

test('selected product price adapter preserves supplier provenance without changing pricing rules', async () => {
  const productKey = 'selected-price';
  const job = { ...baseJob(productKey), pricingProduct: undefined, selectedProduct: selectedProduct(productKey, { product: { price: 90 } }), marketEvidence: marketEvidence(productKey) };
  const result = await advanceProductionProduct(job, { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.WAITING_FOR_CONTENT);
  assert.equal(result.pricingDecision.supplier.provenance.source, 'selected-product');
});

test('photo artifact stale quality is not trusted', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('stale-photo-quality');
    const photoArtifact = await makePhotoArtifact(job, root);
    photoArtifact.quality.status = PHOTO_STATUSES.REVIEW;
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PHOTO_REVIEW);
    assert.equal(result.approvedMedia, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('approved photos are not replaced during operator-only rework handoff', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('preserve-approved');
    const photoArtifact = await makePhotoArtifact(job, root);
    delete photoArtifact.quality;
    delete photoArtifact.approvedMediaArtifact;
    photoArtifact.artifacts[3].providerArtifactId = photoArtifact.artifacts[0].providerArtifactId;
    const before = await Promise.all(photoArtifact.artifacts.map((artifact) => fs.readFile(artifact.asset.path)));
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    const after = await Promise.all(photoArtifact.artifacts.map((artifact) => fs.readFile(artifact.asset.path)));
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PHOTO_REWORK);
    assert.deepEqual(after, before);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('wrong approved media identity is rejected at the supplied artifact boundary', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('media-boundary');
    const photoArtifact = await makePhotoArtifact(job, root);
    photoArtifact.approvedMediaArtifact.photos[0].assetRef = 'other-product-file.png';
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PHOTO_REVIEW);
    assert.equal(result.approvedMedia, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('content and photo tasks are not created for a blocked supplier', async () => {
  const result = await advanceProductionProduct({ ...readyContentJob('blocked-no-work'), supplierState: { productKey: 'blocked-no-work', availabilityStatus: 'REMOVED' } }, { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.BLOCKED_SUPPLIER);
  assert.equal(result.nextAction, null);
  assert.equal(JSON.stringify(result).includes('MARKET_RESEARCH'), false);
});

test('content and photo tasks are not created for PRICE_REVIEW', async () => {
  const result = await advanceProductionProduct(readyMarketJob('review-no-work', { pricingProduct: pricingProduct('review-no-work', { currency: 'EUR' }) }), { pricing: pricingOptions() });
  assert.equal(result.workflowStatus, PRODUCTION_STATUSES.PRICING_REVIEW);
  assert.equal(JSON.stringify(result).includes('PHOTO_GENERATION'), false);
});

test('operator task collection has stable original product order', async () => {
  const batch = await advanceProductionBatch([baseJob('order-b'), baseJob('order-a')], { pricing: pricingOptions() });
  assert.deepEqual(collectOperatorTasks(batch).map((task) => task.productKey), ['order-b', 'order-a']);
});

test('batch options are not mutated while each product is evaluated independently', async () => {
  const options = { pricing: pricingOptions() };
  const before = structuredClone(options);
  await advanceProductionBatch([baseJob('immutable-a'), baseJob('immutable-b')], options);
  assert.deepEqual(options, before);
});

test('real photo output file hashes remain authoritative after import', async () => {
  const root = await tempRoot();
  try {
    const job = readyContentJob('hash-authority-orchestrator');
    const photoArtifact = await makePhotoArtifact(job, root);
    const expected = await Promise.all(photoArtifact.artifacts.map(async (artifact) => hash(await fs.readFile(artifact.asset.path))));
    const result = await advanceProductionProduct({ ...job, photoArtifact }, { pricing: pricingOptions() });
    assert.deepEqual(result.photoArtifact.artifacts.map((artifact) => artifact.hash), expected);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
