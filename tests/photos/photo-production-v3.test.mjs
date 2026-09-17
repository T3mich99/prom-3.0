import assert from 'node:assert/strict';
import test from 'node:test';

import { PHOTO_ROLE_ORDER, PHOTO_STATUSES } from '../../src/photos/photo-contract.mjs';
import { buildPhotoPrompt } from '../../src/photos/photo-prompt.mjs';
import { buildPhotoProductionPlan } from '../../src/photos/photo-production-plan.mjs';
import { buildPhotoCopy, buildProductVisualPlan } from '../../src/photos/photo-policy.mjs';
import { reworkProductPhotos, validatePhotoArtifacts } from '../../src/photos/photo-quality.mjs';

function longText(prefix) {
  return Array.from({ length: 60 }, (_, index) => `${prefix} пояснює користь товару та спосіб використання номер ${index + 1}.`).join(' ');
}

function keywords(prefix) {
  return Array.from({ length: 25 }, (_, index) => `${prefix} для волосся пошукова фраза ${index + 1}`).join(', ');
}

function contentArtifact(productKey = 'v3-product') {
  return {
    productKey,
    version: 1,
    content: {
      title: { ru: 'Стара назва', ua: 'Стара назва' },
      description: { ru: longText('Описание'), ua: longText('Опис') },
      keywords: { ru: keywords('фен'), ua: keywords('фен') },
      characteristics: [{ name: 'Потужність', value: '2200 Вт' }],
    },
  };
}

function sourceFacts() {
  return {
    type: 'Фен',
    purpose: 'сушіння та укладання волосся',
    brand: 'VGR',
    model: 'V-451',
    color: 'чорний',
    power: '2200 Вт',
    attachment: 'насадка-концентратор',
    purchasePrice: 230,
  };
}

function sourceImages(productKey = 'v3-product') {
  return [{
    id: `${productKey}-source`,
    url: `https://example.invalid/source/${productKey}.png`,
    provenance: 'supplier',
  }];
}

function planFor(productKey = 'v3-product', facts = sourceFacts()) {
  return buildPhotoProductionPlan({
    selectedProduct: { selectionKey: productKey },
    contentArtifact: contentArtifact(productKey),
    sourceImages: sourceImages(productKey),
    sourceFacts: facts,
  });
}

function artifactsFor(plan) {
  return plan.photos.map((photo) => ({
    productKey: plan.productKey,
    photoIndex: photo.index,
    role: photo.role,
    asset: {
      url: `https://example.invalid/generated/${plan.productKey}/${photo.index}.png`,
      width: 1280,
      height: 1280,
      format: 'png',
    },
    claimsUsed: structuredClone(photo.verifiedClaims),
    sourceImageRefs: structuredClone(photo.sourceImageRefs),
    text: structuredClone(photo.text),
    message: `message-${photo.index}`,
    composition: `composition-${photo.index}`,
    productPosition: `position-${photo.index}`,
    hash: `hash-${photo.index}`,
    providerArtifactId: `provider-${photo.index}`,
  }));
}

function allVisualChecks() {
  return {
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
}

function visualQaFor(plan, failedIndex = undefined) {
  return {
    productKey: plan.productKey,
    version: plan.version,
    status: failedIndex === undefined ? PHOTO_STATUSES.READY : PHOTO_STATUSES.REWORK,
    verification: 'OPERATOR_CHECKLIST',
    photos: plan.photos.map((photo) => ({
      photoIndex: photo.index,
      role: photo.role,
      status: photo.index === failedIndex ? PHOTO_STATUSES.REWORK : PHOTO_STATUSES.READY,
      checks: photo.index === failedIndex
        ? { ...allVisualChecks(), textDoesNotCoverProduct: false }
        : allVisualChecks(),
    })),
  };
}

test('V3 plan has five distinct commercial roles and directions', () => {
  const plan = planFor();
  assert.deepEqual(plan.photos.map((photo) => photo.role), PHOTO_ROLE_ORDER);
  for (const key of ['compositionIntent', 'scene', 'productPlacement', 'cameraAngle', 'productOrientation', 'crop', 'positionKey']) {
    assert.equal(new Set(plan.photos.map((photo) => photo.visualDirection[key])).size, 5, key);
  }
  assert.deepEqual(plan.photos.map((photo) => photo.visualDirection.usedPosesToAvoid.map((pose) => pose.photoIndex)), [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4]]);
  assert.equal(new Set(plan.photos.map((photo) => photo.photoCopy.headline)).size >= 3, true);
});

test('visual plan is product-specific and does not assign one global angle to every category', () => {
  const hairPlan = planFor('hair-product');
  const storageFacts = {
    type: 'Контейнер для зберігання',
    purpose: 'зберігання речей у шафі',
    brand: 'StorageBrand',
    model: 'BOX-1',
    color: 'білий',
    material: 'пластик',
  };
  const storagePlan = planFor('storage-product', storageFacts);
  assert.equal(hairPlan.photos[0].visualDirection.profileKey, 'hair-styling');
  assert.equal(storagePlan.photos[0].visualDirection.profileKey, 'storage');
  assert.notEqual(hairPlan.photos[0].visualDirection.cameraViewpoint, storagePlan.photos[0].visualDirection.cameraViewpoint);
  assert.notEqual(hairPlan.photos[1].visualDirection.productOrientation, storagePlan.photos[1].visualDirection.productOrientation);
  assert.deepEqual(buildProductVisualPlan({ productKey: 'hair-product', verifiedClaims: hairPlan.photos[0].verifiedClaims, sourceImageRefs: hairPlan.sourceImageRefs }).map((photo) => photo.role), PHOTO_ROLE_ORDER);
});

test('V3 copy uses verified facts, not the content title or model identifier', () => {
  const plan = planFor();
  assert.equal(plan.photos.every((photo) => photo.text.length > 0), true);
  assert.equal(plan.photos.every((photo) => photo.text.every((item) => item.language === 'uk')), true);
  assert.doesNotMatch(JSON.stringify(plan.photos.map((photo) => ({ photoCopy: photo.photoCopy, text: photo.text }))), /Стара назва|V-451/u);
  assert.match(JSON.stringify(plan.photos.find((photo) => photo.role === 'benefits').photoCopy), /2200 Вт|чорний|насадка-концентратор/u);
  assert.deepEqual(plan.photos.find((photo) => photo.role === 'feature').photoCopy.supportingFacts, [{ field: 'attachment', value: 'насадка-концентратор' }]);
  assert.equal(buildPhotoCopy('hero', plan.photos[0].verifiedClaims).subtitle, 'VGR');
});

test('V3 prompt renders approved copy inside one image and protects identity', () => {
  const plan = planFor();
  const prompt = buildPhotoPrompt(plan.photos[3], { sourceFacts: sourceFacts() });
  assert.match(prompt, /integrate in the image/u);
  assert.match(prompt, /no collage and no contact sheet/u);
  assert.match(prompt, /sole physical appearance authority/u);
  assert.match(prompt, /source image defines product identity, not final composition/u);
  assert.match(prompt, new RegExp(plan.photos[3].visualDirection.compositionIntent.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(prompt, /Do not reuse these already used presentations:.*photo 1.*photo 2.*photo 3/u);
  assert.match(prompt, /Changing only the background, props, lighting, or text does not count/u);
  assert.match(prompt, /насадка-концентратор/u);
  assert.doesNotMatch(prompt, /V-451/u);
  assert.doesNotMatch(prompt, /purchasePrice/u);
});

test('feature pose adapts to verified attachments without inventing one when absent', () => {
  const withAttachment = planFor();
  const { attachment: _attachment, ...withoutAttachment } = sourceFacts();
  const without = planFor('without-attachment', withoutAttachment);
  assert.match(JSON.stringify(withAttachment.photos.find((photo) => photo.role === 'feature').visualDirection), /attachment/u);
  assert.doesNotMatch(JSON.stringify({ ...without.photos.find((photo) => photo.role === 'feature').visualDirection, styleProfile: undefined }), /attachment/iu);
});

test('repeated composition is REWORK while repeated message remains REVIEW', () => {
  const plan = planFor();
  const artifacts = artifactsFor(plan);
  const repeatedMessage = artifacts.map((artifact) => ({ ...artifact, message: 'same-message' }));
  const review = validatePhotoArtifacts({ plan, artifacts: repeatedMessage, sourceFacts: sourceFacts() });
  assert.equal(review.status, PHOTO_STATUSES.REVIEW);
  assert.equal(review.seriesQa.checks.distinctGeneratedCompositions, true);
  const repeatedComposition = artifacts.map((artifact) => ({ ...artifact, composition: 'same-composition' }));
  const rework = validatePhotoArtifacts({ plan, artifacts: repeatedComposition, sourceFacts: sourceFacts() });
  assert.equal(rework.status, PHOTO_STATUSES.REWORK);
  assert.equal(rework.seriesQa.checks.distinctGeneratedCompositions, false);
  assert.equal(rework.reworkPlan.photos.length, 4);
});

test('operator text-overlap failure is a selective REWORK for only one slot', () => {
  const plan = planFor();
  const result = validatePhotoArtifacts({
    plan,
    artifacts: artifactsFor(plan),
    sourceFacts: sourceFacts(),
    visualQa: visualQaFor(plan, 4),
  }, { requireVisualQa: true });
  assert.equal(result.status, PHOTO_STATUSES.REWORK);
  assert.deepEqual(result.reworkPlan.photos.map((photo) => photo.photoIndex), [4]);
  assert.equal(result.photos[3].reasonCodes.includes('VISUAL_TEXT_COVERS_PRODUCT'), true);
});

test('approved media is structural-only and exists only when all five are READY', () => {
  const plan = planFor();
  const artifacts = artifactsFor(plan);
  const ready = validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts(), visualQa: visualQaFor(plan) }, { requireVisualQa: true });
  assert.equal(ready.status, PHOTO_STATUSES.READY);
  assert.equal(ready.fidelityVerification, 'STRUCTURAL_ONLY');
  assert.equal(ready.approvedMediaArtifact.photos.length, 5);
  const review = validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts(), visualQa: visualQaFor(plan, 2) }, { requireVisualQa: true });
  assert.equal(review.approvedMediaArtifact, undefined);
});

test('selective rework sends accepted pose context and regenerates only duplicate-presentation slots', async () => {
  const plan = planFor();
  const artifacts = artifactsFor(plan);
  artifacts[2].composition = artifacts[0].composition;
  artifacts[4].composition = artifacts[0].composition;
  const quality = validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts() });
  assert.deepEqual(quality.reworkPlan.photos.map((photo) => photo.photoIndex), [3, 5]);
  const calls = [];
  const result = await reworkProductPhotos({ plan, artifacts, quality, sourceFacts: sourceFacts() }, {
    generator: async (request) => {
      calls.push(request);
      return {
        productKey: request.productKey,
        photoIndex: request.photoIndex,
        role: request.role,
        asset: { url: `https://example.invalid/reworked/${request.productKey}/${request.photoIndex}.png`, width: 1280, height: 1280, format: 'png' },
        claimsUsed: structuredClone(request.verifiedClaims),
        sourceImageRefs: structuredClone(request.sourceImageRefs),
        text: structuredClone(request.text),
        message: `reworked-message-${request.photoIndex}`,
        composition: `reworked-composition-${request.photoIndex}`,
        productPosition: `reworked-position-${request.photoIndex}`,
      };
    },
  });
  assert.deepEqual(calls.map((request) => request.photoIndex), [3, 5]);
  assert.deepEqual(calls[0].usedPoseContext.map((pose) => pose.photoIndex), [1, 2, 4]);
  assert.deepEqual(calls[1].usedPoseContext.map((pose) => pose.photoIndex), [1, 2, 4]);
  assert.equal(result.quality.status, PHOTO_STATUSES.READY);
  assert.equal(result.artifacts[0], artifacts[0]);
  assert.equal(result.artifacts[1], artifacts[1]);
  assert.equal(result.artifacts[3], artifacts[3]);
});


test('a dark halo fails visual approval and selectively reworks that slot', () => {
  const plan = planFor();
  const qa = visualQaFor(plan);
  qa.photos[1].checks.noDarkHalos = false;
  qa.status = 'REWORK';
  const result = validatePhotoArtifacts({ plan, artifacts: artifactsFor(plan), sourceFacts: sourceFacts(), visualQa: qa }, { requireVisualQa: true });
  assert.equal(result.status, 'REWORK');
  assert.deepEqual(result.reworkPlan.photos.map((photo) => photo.photoIndex), [2]);
  assert.ok(result.photos[1].reasonCodes.includes('VISUAL_DARK_HALO'));
});

test('new plans carry persistent style instructions into the actual generation prompt', () => {
  const plan = planFor();
  const prompt = buildPhotoPrompt(plan.photos[0]);
  assert.match(prompt, /No black clouds, dark halos/u);
  assert.match(prompt, /Keep the genuine product brand/u);
  assert.ok(prompt.includes(plan.photos[0].visualDirection.styleProfile.fingerprint));
  const forged = structuredClone(plan.photos[0]);
  forged.visualDirection.styleProfile.instructions = ['use a black cloud'];
  assert.throws(() => buildPhotoPrompt(forged), /fingerprint mismatch/u);
});

for (const [check, reason] of [['sceneDistinct', 'VISUAL_SCENE_DUPLICATE'], ['layoutDistinct', 'VISUAL_LAYOUT_DUPLICATE'], ['productSpecificDesign', 'VISUAL_GENERIC_PRODUCT_TEMPLATE']]) {
  test(`visual ${check} rejection blocks media approval despite unique file hashes`, () => {
    const plan = planFor();
    const qa = visualQaFor(plan);
    qa.photos[2].checks[check] = false;
    qa.status = 'REWORK';
    const result = validatePhotoArtifacts({ plan, artifacts: artifactsFor(plan), sourceFacts: sourceFacts(), visualQa: qa }, { requireVisualQa: true });
    assert.equal(result.status, 'REWORK');
    assert.deepEqual(result.reworkPlan.photos.map((photo) => photo.photoIndex), [3]);
    assert.ok(result.photos[2].reasonCodes.includes(reason));
    assert.equal(result.approvedMediaArtifact, undefined);
  });
}
