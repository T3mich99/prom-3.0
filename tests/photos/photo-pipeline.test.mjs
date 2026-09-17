import assert from 'node:assert/strict';
import test from 'node:test';
import { generateContentArtifact } from '../../src/content/content-generation-adapter.mjs';
import { CONTENT_STATUSES } from '../../src/content/content-quality.mjs';
import {
  PHOTO_ROLE_ORDER,
  PHOTO_STATUSES,
  DEFAULT_PHOTO_QUALITY_POLICY,
  resolvePhotoQualityPolicy,
} from '../../src/photos/photo-contract.mjs';
import { buildPhotoPrompt } from '../../src/photos/photo-prompt.mjs';
import { buildPhotoProductionPlan, validatePhotoProductionPlan } from '../../src/photos/photo-production-plan.mjs';
import {
  PhotoGenerationError,
  generateProductPhotos,
} from '../../src/photos/photo-generation-adapter.mjs';
import {
  PhotoReworkError,
  reworkProductPhotos,
  validatePhotoArtifacts,
} from '../../src/photos/photo-quality.mjs';

function longText(prefix) {
  return Array.from({ length: 60 }, (_, index) => `${prefix} пояснює користь товару та спосіб використання номер ${index + 1}.`).join(' ');
}

function keywords(prefix) {
  return Array.from({ length: 25 }, (_, index) => `${prefix} для волосся пошукова фраза ${index + 1}`).join(', ');
}

function contentArtifact(productKey = 'product-A') {
  return {
    productKey,
    version: 1,
    content: {
      title: { ru: 'Фен для волос', ua: 'Фен для волосся чорний' },
      description: { ru: longText('Описание'), ua: longText('Опис') },
      keywords: { ru: keywords('фен'), ua: keywords('фен') },
      characteristics: [{ name: 'Потужність', value: '2200 Вт' }],
    },
  };
}

function sourceFacts() {
  return {
    type: 'фен',
    power: '2200 Вт',
    color: 'чорний',
    brand: 'VGR',
    model: 'V-451',
    purchasePrice: 230,
    commission: '20%',
  };
}

function sourceImages(productKey = 'product-A') {
  return [
    { id: `${productKey}-front`, url: `https://example.invalid/source/${productKey}/front.png`, role: 'front', provenance: 'supplier' },
    { id: `${productKey}-side`, path: `C:\\references\\${productKey}\\side.png`, role: 'side', provenance: 'supplier' },
  ];
}

function planFor(productKey = 'product-A') {
  return buildPhotoProductionPlan({
    selectedProduct: { selectionKey: productKey, product: { supplierSku: productKey } },
    contentArtifact: contentArtifact(productKey),
    sourceImages: sourceImages(productKey),
    sourceFacts: sourceFacts(),
  });
}

function visualQaFor(plan, failedIndexes = []) {
  const checks = {
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
  };
  return {
    productKey: plan.productKey,
    version: plan.version,
    status: failedIndexes.length ? PHOTO_STATUSES.REWORK : PHOTO_STATUSES.READY,
    verification: 'OPERATOR_CHECKLIST',
    photos: plan.photos.map((photo) => ({
      photoIndex: photo.index,
      role: photo.role,
      status: failedIndexes.includes(photo.index) ? PHOTO_STATUSES.REWORK : PHOTO_STATUSES.READY,
      checks: failedIndexes.includes(photo.index) ? { ...checks, premiumCommercialQuality: false } : { ...checks },
    })),
  };
}

function imageGenerator(overrides = () => ({}), calls = []) {
  return async (request) => {
    calls.push(structuredClone(request));
    const extra = typeof overrides === 'function' ? overrides(request) ?? {} : overrides;
    return {
      productKey: request.productKey,
      photoIndex: request.photoIndex,
      role: request.role,
      ...extra,
      asset: {
        url: `https://example.invalid/product/${request.productKey}/${request.photoIndex}.png`,
        width: 1280,
        height: 1280,
        format: 'png',
        ...(extra.asset ?? {}),
      },
      claimsUsed: extra.claimsUsed ?? request.verifiedClaims.slice(0, 1),
      sourceImageRefs: extra.sourceImageRefs ?? request.sourceImageRefs,
      text: extra.text ?? request.text,
    };
  };
}

async function generatedFor(productKey = 'product-A', overrides = () => ({}), calls = []) {
  const plan = planFor(productKey);
  const result = await generateProductPhotos(plan, { generator: imageGenerator(overrides, calls) });
  return { plan, artifacts: result.artifacts };
}

test('photo plan is exactly five ordered photos with five distinct purposes', () => {
  const plan = planFor();
  assert.equal(plan.status, PHOTO_STATUSES.READY);
  assert.equal(plan.photos.length, 5);
  assert.deepEqual(plan.photos.map((photo) => photo.index), [1, 2, 3, 4, 5]);
  assert.deepEqual(plan.photos.map((photo) => photo.role), PHOTO_ROLE_ORDER);
  assert.equal(new Set(plan.photos.map((photo) => photo.visualDirection.compositionKey)).size, 5);
  assert.equal(new Set(plan.photos.map((photo) => photo.objective)).size, 5);
});

test('photo policy accepts the fixed v1 contract and rejects invalid dimensions, counts, formats, and order', () => {
  const resolved = resolvePhotoQualityPolicy({ text: { maxCharactersPerElement: 120 } });
  assert.equal(resolved.requiredPhotoCount, 5);
  assert.equal(resolved.width, 1280);
  assert.equal(resolved.text.maxCharactersPerElement, 120);
  for (const invalid of [
    { width: '1280' },
    { height: 1279 },
    { requiredPhotoCount: 4 },
    { allowedFormats: ['gif'] },
    { roleOrder: ['hero', 'usage', 'benefits', 'feature'] },
  ]) assert.throws(() => resolvePhotoQualityPolicy(invalid), TypeError);
});

test('source image identity, order, provenance, and preservation constraints are retained', () => {
  const plan = planFor();
  assert.deepEqual(plan.sourceImageRefs, [
    { id: 'product-A-front', reference: 'https://example.invalid/source/product-A/front.png', role: 'front', provenance: 'supplier' },
    { id: 'product-A-side', reference: 'C:\\references\\product-A\\side.png', role: 'side', provenance: 'supplier' },
  ]);
  assert.equal(plan.photos.every((photo) => photo.sourceImageRefs.length === 2), true);
  assert.equal(plan.fidelityVerification, 'STRUCTURAL_ONLY');
  assert.equal(plan.preservationConstraints.some((item) => item.includes('old')), true);
});

test('empty source media blocks planning and never fabricates a photo set', () => {
  const plan = buildPhotoProductionPlan({
    selectedProduct: { selectionKey: 'product-A' },
    contentArtifact: contentArtifact(),
    sourceImages: [],
    sourceFacts: sourceFacts(),
  });
  assert.equal(plan.status, PHOTO_STATUSES.REWORK);
  assert.deepEqual(plan.photos, []);
  assert.deepEqual(plan.diagnostics.map((item) => item.code), ['SOURCE_IMAGES_REQUIRED']);
});

test('malformed source media is an explicit contract error', () => {
  assert.throws(() => buildPhotoProductionPlan({
    selectedProduct: { selectionKey: 'product-A' },
    contentArtifact: contentArtifact(),
    sourceImages: [{ id: 'missing-reference' }],
    sourceFacts: sourceFacts(),
  }), /url, path, or reference/u);
});

test('content quality is a dependency and non-READY content blocks the photo plan', () => {
  const broken = contentArtifact();
  broken.content.title = { ru: '', ua: '' };
  const plan = buildPhotoProductionPlan({
    selectedProduct: { selectionKey: 'product-A' },
    contentArtifact: broken,
    sourceImages: sourceImages(),
    sourceFacts: sourceFacts(),
  });
  assert.equal(plan.status, PHOTO_STATUSES.REWORK);
  assert.deepEqual(plan.diagnostics.map((item) => item.code), ['CONTENT_NOT_READY']);
});

test('source facts are the only structured claim authority and economic metadata is excluded', async () => {
  const calls = [];
  const { plan } = await generatedFor('product-A', () => ({}), calls);
  assert.deepEqual(plan.photos[0].verifiedClaims.find((claim) => claim.field === 'power'), { field: 'power', value: '2200 Вт' });
  assert.equal(plan.photos.flatMap((photo) => photo.verifiedClaims).some((claim) => /price|commission/iu.test(claim.field)), false);
  assert.equal(calls.every((request) => !JSON.stringify(request).includes('purchasePrice') && !JSON.stringify(request).includes('commission') && !JSON.stringify(request).includes('230')), true);
});

test('planned selling copy is role-specific Ukrainian and the hero remains minimal', () => {
  const plan = planFor();
  assert.equal(plan.photos.every((photo) => photo.text.length > 0), true);
  assert.equal(plan.photos.every((photo) => photo.text.every((item) => item.language === 'uk')), true);
  assert.equal(plan.photos.every((photo) => photo.text.length <= DEFAULT_PHOTO_QUALITY_POLICY.text.maxElementsByRole[photo.role]), true);
  assert.doesNotMatch(JSON.stringify(plan.photos.flatMap((photo) => photo.text)), /V-451/u);
  assert.equal(new Set(plan.photos.map((photo) => photo.text.map((item) => item.value).join('|'))).size, 5);
});

test('provider-neutral prompt states the photo safety and fidelity contract', () => {
  const prompt = buildPhotoPrompt(planFor().photos[0]);
  for (const phrase of ['1280x1280', 'sole physical appearance authority', 'All selling text must be Ukrainian', 'modern e-commerce', 'premium visual contract', 'no collage', 'no watermark']) assert.match(prompt, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(prompt, /VGR/u);
  assert.doesNotMatch(prompt, /V-451/u);
  assert.doesNotMatch(prompt, /purchasePrice|commission|230/u);
});

test('central premium visual policy is present for every role and keeps role contracts distinct', () => {
  const plan = planFor();
  const prompts = plan.photos.map((photo) => buildPhotoPrompt(photo));
  assert.equal(prompts.every((prompt) => prompt.includes('high-end commercial product photography')), true);
  assert.equal(prompts.every((prompt) => prompt.includes('no cheap marketplace banner aesthetic')), true);
  assert.equal(new Set(plan.photos.map((photo) => photo.objective)).size, 5);
  assert.equal(new Set(plan.photos.map((photo) => photo.visualDirection.scene)).size, 5);
});

test('unverified claims and model text are rejected before the image generator is called', async () => {
  const plan = planFor();
  const invalidClaimPlan = structuredClone(plan);
  invalidClaimPlan.photos[2].verifiedClaims.push({ field: 'inventedFeature', value: 'непідтверджено' });
  let calls = 0;
  await assert.rejects(
    () => generateProductPhotos(invalidClaimPlan, {
      sourceFacts: sourceFacts(),
      generator: async () => { calls += 1; return {}; },
    }),
    (error) => error instanceof PhotoGenerationError && error.code === 'PHOTO_PROMPT_POLICY_INVALID',
  );
  assert.equal(calls, 0);
  const invalidModelTextPlan = structuredClone(plan);
  invalidModelTextPlan.photos[0].text = [{ kind: 'headline', language: 'uk', value: 'V-451' }];
  await assert.rejects(
    () => generateProductPhotos(invalidModelTextPlan, { generator: imageGenerator() }),
    (error) => error instanceof TypeError && /visible text/u.test(error.message),
  );
});

test('technical QA alone is not PHOTO_READY when operator visual QA is required', async () => {
  const { plan, artifacts } = await generatedFor();
  const technicalOnly = validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts() }, { requireVisualQa: true });
  assert.equal(technicalOnly.status, PHOTO_STATUSES.REVIEW);
  assert.equal(technicalOnly.visualQa.status, PHOTO_STATUSES.REVIEW);
  assert.equal(Object.hasOwn(technicalOnly, 'approvedMediaArtifact'), false);
  const approved = validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts(), visualQa: visualQaFor(plan) }, { requireVisualQa: true });
  assert.equal(approved.status, PHOTO_STATUSES.READY);
  assert.equal(approved.visualQa.status, PHOTO_STATUSES.READY);
  assert.equal(approved.approvedMediaArtifact.photos.length, 5);
});

test('visual QA failure marks only the affected slot for selective rework', async () => {
  const { plan, artifacts } = await generatedFor();
  const originalArtifacts = structuredClone(artifacts);
  const visualQa = visualQaFor(plan, [3]);
  const quality = validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts(), visualQa }, { requireVisualQa: true });
  assert.equal(quality.status, PHOTO_STATUSES.REWORK);
  assert.deepEqual(quality.reworkPlan.photos.map((item) => item.photoIndex), [3]);
  const calls = [];
  const result = await reworkProductPhotos({ plan, artifacts, quality, sourceFacts: sourceFacts(), visualQa }, {
    generator: imageGenerator((request) => ({ asset: { url: `https://example.invalid/reworked/${request.productKey}/${request.photoIndex}.png` } }), calls),
  });
  assert.deepEqual(calls.map((request) => request.photoIndex), [3]);
  assert.deepEqual(result.artifacts.slice(0, 2), originalArtifacts.slice(0, 2));
  assert.deepEqual(result.artifacts.slice(3), originalArtifacts.slice(3));
  assert.equal(result.artifacts[2].asset.url, 'https://example.invalid/reworked/product-A/3.png');
  assert.equal(result.status, PHOTO_STATUSES.REWORK);
});

test('five generated artifacts preserve exact order, claims, source refs, units, and supported PNG format', async () => {
  const { plan, artifacts } = await generatedFor();
  assert.equal(artifacts.length, 5);
  assert.deepEqual(artifacts.map((artifact) => artifact.photoIndex), [1, 2, 3, 4, 5]);
  assert.equal(artifacts.every((artifact) => artifact.productKey === plan.productKey), true);
  assert.equal(artifacts.every((artifact) => artifact.asset.width === 1280 && artifact.asset.height === 1280 && artifact.asset.format === 'png'), true);
  assert.deepEqual(artifacts[0].claimsUsed, [{ field: 'type', value: 'фен' }]);
  assert.deepEqual(artifacts[0].sourceImageRefs, plan.sourceImageRefs);
  const claim = plan.photos[0].verifiedClaims.find((item) => item.field === 'power');
  assert.equal(claim.value, '2200 Вт');
});

test('generator calls are exactly one per planned photo and failures remain operational errors', async () => {
  const calls = [];
  const plan = planFor();
  await generateProductPhotos(plan, { generator: imageGenerator(() => ({}), calls) });
  assert.deepEqual(calls.map((request) => request.photoIndex), [1, 2, 3, 4, 5]);
  await assert.rejects(
    () => generateProductPhotos(plan, { generator: async () => { throw new Error('offline'); } }),
    (error) => error instanceof PhotoGenerationError && error.code === 'PHOTO_GENERATOR_FAILURE' && error.cause?.message === 'offline',
  );
});

test('malformed generator response is rejected with the response contract error', async () => {
  const plan = planFor();
  await assert.rejects(
    () => generateProductPhotos(plan, { generator: async () => ({ productKey: plan.productKey, photoIndex: 1, role: 'hero', claimsUsed: [], sourceImageRefs: plan.sourceImageRefs }) }),
    (error) => error instanceof PhotoGenerationError && error.code === 'PHOTO_GENERATOR_RESPONSE_INVALID' && /asset/u.test(error.message),
  );
  await assert.rejects(
    () => generateProductPhotos(plan, { generator: imageGenerator((request) => ({ photoIndex: request.photoIndex + 1 })) }),
    (error) => error instanceof PhotoGenerationError && error.code === 'PHOTO_GENERATOR_RESPONSE_INVALID' && /photoIndex/u.test(error.message),
  );
});

test('1280x1280 and 1254x1254 pass while wrong dimensions require rework', async () => {
  const { plan, artifacts } = await generatedFor();
  assert.equal(validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts() }).status, PHOTO_STATUSES.READY);
  const providerSized = await generatedFor('provider-1254', () => ({ asset: { width: 1254, height: 1254 } }));
  assert.equal(validatePhotoArtifacts({ plan: providerSized.plan, artifacts: providerSized.artifacts, sourceFacts: sourceFacts() }).status, PHOTO_STATUSES.READY);
  for (const [field, value, code] of [['width', 1279, 'PHOTO_WIDTH_INVALID'], ['height', 1279, 'PHOTO_HEIGHT_INVALID']]) {
    const broken = structuredClone(artifacts);
    broken[0].asset[field] = value;
    const quality = validatePhotoArtifacts({ plan, artifacts: broken, sourceFacts: sourceFacts() });
    assert.equal(quality.status, PHOTO_STATUSES.REWORK);
    assert.equal(quality.photos[0].reasonCodes.includes(code), true);
  }
});

test('fewer than five and more than five artifacts are rework and extras are not truncated', async () => {
  const { plan, artifacts } = await generatedFor();
  const fewer = validatePhotoArtifacts({ plan, artifacts: artifacts.slice(0, 4), sourceFacts: sourceFacts() });
  assert.equal(fewer.status, PHOTO_STATUSES.REWORK);
  assert.equal(fewer.summary.artifactCount, 4);
  const more = validatePhotoArtifacts({ plan, artifacts: [...artifacts, { ...structuredClone(artifacts[4]), photoIndex: 6, role: 'extra', asset: { ...artifacts[4].asset, url: 'https://example.invalid/extra.png' } }], sourceFacts: sourceFacts() });
  assert.equal(more.status, PHOTO_STATUSES.REWORK);
  assert.equal(more.summary.artifactCount, 6);
  assert.equal(more.photos.length, 5);
  assert.equal(more.photos.every((photo) => photo.reasonCodes.includes('PHOTO_COUNT_INVALID')), true);
});

test('order, duplicate index, role, product identity, and source references are never silently repaired', async () => {
  const { plan, artifacts } = await generatedFor();
  const wrongOrder = structuredClone(artifacts);
  [wrongOrder[0], wrongOrder[1]] = [wrongOrder[1], wrongOrder[0]];
  const wrongOrderQuality = validatePhotoArtifacts({ plan, artifacts: wrongOrder, sourceFacts: sourceFacts() });
  assert.equal(wrongOrderQuality.status, PHOTO_STATUSES.REWORK);
  assert.equal(wrongOrderQuality.photos[0].reasonCodes.includes('PHOTO_INDEX_MISMATCH'), true);
  const wrongRole = structuredClone(artifacts);
  wrongRole[0].role = 'usage';
  assert.equal(validatePhotoArtifacts({ plan, artifacts: wrongRole, sourceFacts: sourceFacts() }).photos[0].reasonCodes.includes('PHOTO_ROLE_MISMATCH'), true);
  const wrongProduct = structuredClone(artifacts);
  wrongProduct[0].productKey = 'product-B';
  assert.equal(validatePhotoArtifacts({ plan, artifacts: wrongProduct, sourceFacts: sourceFacts() }).photos[0].reasonCodes.includes('PRODUCT_KEY_MISMATCH'), true);
  const wrongRefs = structuredClone(artifacts);
  wrongRefs[0].sourceImageRefs = sourceImages('product-B').map((image) => ({ id: image.id, reference: image.url ?? image.path }));
  assert.equal(validatePhotoArtifacts({ plan, artifacts: wrongRefs, sourceFacts: sourceFacts() }).photos[0].reasonCodes.includes('SOURCE_IMAGE_REFS_MISMATCH'), true);
  await assert.rejects(
    () => generateProductPhotos(plan, { generator: imageGenerator((request) => ({ photoIndex: request.photoIndex === 1 ? 2 : request.photoIndex })) }),
    (error) => error.code === 'PHOTO_GENERATOR_RESPONSE_INVALID',
  );
});

test('exact duplicate asset reference, hash, and provider artifact ID are hard failures', async () => {
  const { plan, artifacts } = await generatedFor();
  const duplicateReference = structuredClone(artifacts);
  duplicateReference[1].asset.url = duplicateReference[0].asset.url;
  assert.equal(validatePhotoArtifacts({ plan, artifacts: duplicateReference, sourceFacts: sourceFacts() }).photos[1].reasonCodes.includes('PHOTO_DUPLICATE_ASSET'), true);
  const duplicateHash = structuredClone(artifacts).map((artifact) => ({ ...artifact, hash: 'same-hash' }));
  assert.equal(validatePhotoArtifacts({ plan, artifacts: duplicateHash, sourceFacts: sourceFacts() }).photos[1].reasonCodes.includes('PHOTO_DUPLICATE_ASSET'), true);
  const duplicateProviderId = structuredClone(artifacts).map((artifact) => ({ ...artifact, providerArtifactId: 'same-provider-id' }));
  assert.equal(validatePhotoArtifacts({ plan, artifacts: duplicateProviderId, sourceFacts: sourceFacts() }).photos[1].reasonCodes.includes('PHOTO_DUPLICATE_ASSET'), true);
});

test('repeated message is REVIEW while repeated composition is REWORK', async () => {
  const { plan, artifacts } = await generatedFor();
  const repeatedMessage = artifacts.map((artifact) => ({ ...artifact, message: 'same message' }));
  const review = validatePhotoArtifacts({ plan, artifacts: repeatedMessage, sourceFacts: sourceFacts() });
  assert.equal(review.status, PHOTO_STATUSES.REVIEW);
  assert.equal(review.photos[1].reasonCodes.includes('PHOTO_REPEATED_METADATA'), true);
  const repeatedComposition = artifacts.map((artifact) => ({ ...artifact, composition: 'same composition' }));
  const rework = validatePhotoArtifacts({ plan, artifacts: repeatedComposition, sourceFacts: sourceFacts() });
  assert.equal(rework.status, PHOTO_STATUSES.REWORK);
  assert.equal(rework.photos[1].reasonCodes.includes('PHOTO_DUPLICATE_COMPOSITION'), true);
  const configurable = validatePhotoArtifacts({ plan, artifacts: repeatedMessage, sourceFacts: sourceFacts() }, { policy: { duplicate: { repeatedMetadataSeverity: 'rework' } } });
  assert.equal(configurable.status, PHOTO_STATUSES.REWORK);
});

test('unsupported claim, unsupported format, missing asset, and missing source refs are rework', async () => {
  const { plan, artifacts } = await generatedFor();
  const cases = [
    ['claim', (broken) => { broken[0].claimsUsed = [{ field: 'power', value: '9999 Вт' }]; }, 'UNSUPPORTED_CLAIM'],
    ['format', (broken) => { broken[0].asset.format = 'gif'; }, 'PHOTO_FORMAT_UNSUPPORTED'],
    ['asset', (broken) => { broken[0].asset = undefined; }, 'PHOTO_ASSET_MISSING'],
    ['refs', (broken) => { broken[0].sourceImageRefs = []; }, 'SOURCE_IMAGE_REFS_REQUIRED'],
  ];
  for (const [, mutate, reason] of cases) {
    const broken = structuredClone(artifacts);
    mutate(broken);
    const quality = validatePhotoArtifacts({ plan, artifacts: broken, sourceFacts: sourceFacts() });
    assert.equal(quality.status, PHOTO_STATUSES.REWORK);
    assert.equal(quality.photos[0].reasonCodes.includes(reason), true);
  }
});

test('returned non-Ukrainian or changed structured selling text is rework', async () => {
  const { plan, artifacts } = await generatedFor();
  const russian = structuredClone(artifacts);
  russian[0].text = [{ kind: 'headline', language: 'ru', value: 'Фен для волос' }];
  const russianQuality = validatePhotoArtifacts({ plan, artifacts: russian, sourceFacts: sourceFacts() });
  assert.equal(russianQuality.status, PHOTO_STATUSES.REWORK);
  assert.equal(russianQuality.photos[0].reasonCodes.includes('NON_UKRAINIAN_TEXT'), true);
  const changed = structuredClone(artifacts);
  changed[0].text = [{ kind: 'headline', language: 'uk', value: 'Інший товар' }];
  assert.equal(validatePhotoArtifacts({ plan, artifacts: changed, sourceFacts: sourceFacts() }).photos[0].reasonCodes.includes('TEXT_NOT_APPROVED'), true);
});

test('text-density limits protect hero and benefits without inventing marketing phrases', () => {
  const plan = planFor();
  const tooManyHero = structuredClone(plan);
  tooManyHero.photos[0].text = [
    { kind: 'headline', language: 'uk', value: 'Один' },
    { kind: 'support', language: 'uk', value: 'Два' },
    { kind: 'support', language: 'uk', value: 'Три' },
  ];
  assert.throws(() => validatePhotoProductionPlan(tooManyHero), /text density/iu);
  const tooManyBenefits = structuredClone(plan);
  tooManyBenefits.photos[2].text = Array.from({ length: 5 }, (_, index) => ({ kind: 'support', language: 'uk', value: `Факт ${index + 1}` }));
  assert.throws(() => validatePhotoProductionPlan(tooManyBenefits), /text density/iu);
});

test('fidelity metadata changes are rejected while QA states structural-only verification', async () => {
  const { plan, artifacts } = await generatedFor();
  const broken = structuredClone(artifacts);
  broken[0].fidelity = { brandChanged: true };
  const quality = validatePhotoArtifacts({ plan, artifacts: broken, sourceFacts: sourceFacts() });
  assert.equal(quality.status, PHOTO_STATUSES.REWORK);
  assert.equal(quality.photos[0].reasonCodes.includes('PRODUCT_FIDELITY_CHANGED'), true);
  assert.equal(quality.fidelityVerification, 'STRUCTURAL_ONLY');
});

test('aggregate status precedence is REWORK over REVIEW over READY', async () => {
  const { plan, artifacts } = await generatedFor();
  const reviewOnly = artifacts.map((artifact) => ({ ...artifact, message: 'same' }));
  assert.equal(validatePhotoArtifacts({ plan, artifacts: reviewOnly, sourceFacts: sourceFacts() }).status, PHOTO_STATUSES.REVIEW);
  const reworkAndReview = structuredClone(reviewOnly);
  reworkAndReview[0].asset.width = 1279;
  assert.equal(validatePhotoArtifacts({ plan, artifacts: reworkAndReview, sourceFacts: sourceFacts() }).status, PHOTO_STATUSES.REWORK);
  assert.equal(validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts() }).status, PHOTO_STATUSES.READY);
});

test('approved media artifact exists only for aggregate READY and contains five ordered asset references', async () => {
  const { plan, artifacts } = await generatedFor();
  const ready = validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts() });
  assert.deepEqual(ready.approvedMediaArtifact, {
    productKey: 'product-A',
    version: 1,
    photos: [1, 2, 3, 4, 5].map((index) => ({ index, assetRef: `https://example.invalid/product/product-A/${index}.png`, width: 1280, height: 1280, format: 'png' })),
  });
  const broken = structuredClone(artifacts);
  broken[0].asset.width = 1279;
  assert.equal(Object.hasOwn(validatePhotoArtifacts({ plan, artifacts: broken, sourceFacts: sourceFacts() }), 'approvedMediaArtifact'), false);
});

test('selective photo rework regenerates only failed photo, preserves accepted four, and increments once', async () => {
  const { plan, artifacts } = await generatedFor();
  const originalArtifacts = structuredClone(artifacts);
  artifacts[2].asset.width = 1279;
  const quality = validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts() });
  assert.deepEqual(quality.reworkPlan.photos.map((item) => item.photoIndex), [3]);
  const calls = [];
  const result = await reworkProductPhotos({ plan, artifacts, quality, sourceFacts: sourceFacts() }, {
    generator: imageGenerator((request) => ({ asset: { url: `https://example.invalid/reworked/${request.productKey}/${request.photoIndex}.png` } }), calls),
  });
  assert.deepEqual(calls.map((request) => request.photoIndex), [3]);
  assert.equal(result.status, PHOTO_STATUSES.READY);
  assert.equal(result.version, 2);
  assert.equal(result.plan.version, 2);
  assert.deepEqual(result.artifacts.slice(0, 2), originalArtifacts.slice(0, 2));
  assert.deepEqual(result.artifacts.slice(3), originalArtifacts.slice(3));
  assert.equal(result.artifacts[2].asset.url, 'https://example.invalid/reworked/product-A/3.png');
  assert.deepEqual(result.approvedMediaArtifact.photos.map((photo) => photo.index), [1, 2, 3, 4, 5]);
  assert.equal(plan.version, 1);
});

test('forged or stale quality results are rejected before photo regeneration', async () => {
  const { plan, artifacts } = await generatedFor();
  artifacts[0].asset.width = 1279;
  const quality = validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts() });
  const forged = structuredClone(quality);
  forged.status = PHOTO_STATUSES.READY;
  let calls = 0;
  await assert.rejects(
    () => reworkProductPhotos({ plan, artifacts, quality: forged, sourceFacts: sourceFacts() }, { generator: async () => { calls += 1; return {}; } }),
    (error) => error instanceof PhotoReworkError && error.code === 'PHOTO_QUALITY_RESULT_MISMATCH',
  );
  const stalePlan = { ...structuredClone(plan), version: 2 };
  await assert.rejects(
    () => reworkProductPhotos({ plan: stalePlan, artifacts, quality, sourceFacts: sourceFacts() }, { generator: imageGenerator() }),
    (error) => error instanceof PhotoReworkError && error.code === 'PHOTO_QUALITY_RESULT_MISMATCH',
  );
  assert.equal(calls, 0);
});

test('photo rework preserves original inputs when generation fails', async () => {
  const { plan, artifacts } = await generatedFor();
  artifacts[0].asset.height = 1279;
  const beforePlan = structuredClone(plan);
  const beforeArtifacts = structuredClone(artifacts);
  const quality = validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts() });
  await assert.rejects(
    () => reworkProductPhotos({ plan, artifacts, quality, sourceFacts: sourceFacts() }, { generator: async () => { throw new Error('provider failed'); } }),
    (error) => error.code === 'PHOTO_GENERATOR_FAILURE',
  );
  assert.deepEqual(plan, beforePlan);
  assert.deepEqual(artifacts, beforeArtifacts);
});

test('rework is not eligible for READY quality', async () => {
  const { plan, artifacts } = await generatedFor();
  const quality = validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts() });
  await assert.rejects(
    () => reworkProductPhotos({ plan, artifacts, quality, sourceFacts: sourceFacts() }, { generator: imageGenerator() }),
    (error) => error instanceof PhotoReworkError && error.code === 'PHOTO_REWORK_NOT_ELIGIBLE',
  );
});

test('two product keys cannot share photo artifacts or source references', async () => {
  const productA = await generatedFor('product-A');
  const productB = planFor('product-B');
  const quality = validatePhotoArtifacts({ plan: productB, artifacts: productA.artifacts, sourceFacts: sourceFacts() });
  assert.equal(quality.status, PHOTO_STATUSES.REWORK);
  assert.equal(quality.photos.every((photo) => photo.reasonCodes.includes('PRODUCT_KEY_MISMATCH') || photo.reasonCodes.includes('SOURCE_IMAGE_REFS_MISMATCH')), true);
});

test('plan and QA are deterministic and do not mutate inputs or policy', async () => {
  const selectedProduct = { selectionKey: 'product-A', product: { source: 'fixture' } };
  const content = contentArtifact();
  const images = sourceImages();
  const facts = sourceFacts();
  const policy = { duplicate: { repeatedMetadataSeverity: 'review' } };
  const before = structuredClone({ selectedProduct, content, images, facts, policy });
  const firstPlan = buildPhotoProductionPlan({ selectedProduct, contentArtifact: content, sourceImages: images, sourceFacts: facts }, { policy });
  const secondPlan = buildPhotoProductionPlan({ selectedProduct, contentArtifact: content, sourceImages: images, sourceFacts: facts }, { policy });
  assert.deepEqual(firstPlan, secondPlan);
  const first = await generateProductPhotos(firstPlan, { generator: imageGenerator() });
  const second = await generateProductPhotos(secondPlan, { generator: imageGenerator() });
  const firstQuality = validatePhotoArtifacts({ plan: firstPlan, artifacts: first.artifacts, sourceFacts: facts });
  const secondQuality = validatePhotoArtifacts({ plan: secondPlan, artifacts: second.artifacts, sourceFacts: facts });
  assert.deepEqual(firstQuality, secondQuality);
  assert.deepEqual({ selectedProduct, content, images, facts, policy }, before);
});

test('content generation composes with the photo plan, generator, QA, and approved media artifact', async () => {
  const source = {
    productKey: 'product-integration',
    sourceFacts: { type: 'фен', power: '2200 Вт', color: 'чорний' },
  };
  const generatedContent = await generateContentArtifact(source, {
    generator: async () => ({ content: contentArtifact('product-integration').content, claims: [{ field: 'power', value: '2200 Вт', contentField: 'description' }] }),
  });
  assert.equal(generatedContent.status, CONTENT_STATUSES.READY);
  const plan = buildPhotoProductionPlan({
    selectedProduct: { selectionKey: source.productKey },
    contentArtifact: generatedContent.artifact,
    sourceImages: sourceImages(source.productKey),
    sourceFacts: source.sourceFacts,
  });
  const generated = await generateProductPhotos(plan, { generator: imageGenerator() });
  const quality = validatePhotoArtifacts({ plan, artifacts: generated.artifacts, sourceFacts: source.sourceFacts });
  assert.equal(quality.status, PHOTO_STATUSES.READY);
  assert.equal(quality.approvedMediaArtifact.photos.length, 5);
});
