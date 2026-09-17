import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePhotoCreativeBrief, findCreativeReuse } from '../../src/photos/photo-creative-brief.mjs';
import { buildPhotoProductionPlan } from '../../src/photos/photo-production-plan.mjs';
import { buildPhotoPrompt } from '../../src/photos/photo-prompt.mjs';

function input() {
  const productKey = 'ugopt:creative-test';
  const description = Array.from({ length: 45 }, (_, i) => `Описуємо щоденне сушіння волосся і способи догляду, приклад ${i + 1}.`).join(' ');
  const keywords = Array.from({ length: 25 }, (_, i) => `фен для волосся пошукова фраза ${i}`).join(', ');
  return { selectedProduct: { selectionKey: productKey }, sourceFacts: { type: 'Фен', attachment: 'Концентратор', brand: 'VGR', model: 'V-123' },
    sourceImages: [{ id: 'supplier-front', url: 'https://example.invalid/source.png' }],
    contentArtifact: { productKey, version: 1, content: {
      title: { ua: 'Фен для волосся', ru: 'Фен для волос' }, description: { ua: description, ru: description },
      keywords: { ua: keywords, ru: keywords }, characteristics: [{ name: 'Тип', value: 'Фен' }],
    } },
  };
}

function briefFor(source) {
  const plan = buildPhotoProductionPlan(source);
  assert.equal(plan.status, 'READY', JSON.stringify(plan.diagnostics));
  const headings = ['Твоя укладка вдома', 'Сушіння у твоєму ритмі', 'Деталі для щоденного догляду', 'Насадка для укладання'];
  return { productKey: plan.productKey, version: 1, rationale: 'Beauty product: demonstrate real styling, tactile controls and the verified concentrator.',
    photos: plan.photos.map((p, i) => ({ role: p.role, message: p.objective,
      scene: p.visualDirection.sceneIntent, composition: p.visualDirection.compositionIntent,
      camera: p.visualDirection.cameraViewpoint, placement: p.visualDirection.productPlacement,
      orientation: p.visualDirection.productOrientation, crop: p.visualDirection.cropIntent,
      layout: ['Headline left and icons below', 'Open copy over lifestyle wall', 'Vertical feature callouts', 'Single detail label below macro', 'No typography, centred product'][i],
      lighting: ['Window daylight', 'Soft side daylight', 'Diffused studio key', 'Raking detail light', 'Bright studio sweep'][i],
      photoCopy: i === 4 ? { supportingFacts: [] } : { ...p.photoCopy, headline: headings[i] },
    })),
  };
}

test('individual brief actually changes provider prompt and final photo has no visible copy', () => {
  const source = input();
  const brief = briefFor(source);
  const before = structuredClone(brief);
  const plan = buildPhotoProductionPlan({ ...source, photoCreativeBrief: brief });
  assert.deepEqual(brief, before);
  assert.deepEqual(plan.photos[4].text, []);
  const prompt = buildPhotoPrompt(plan.photos[0]);
  assert.ok(prompt.includes(brief.photos[0].layout));
  assert.ok(prompt.includes('Твоя укладка вдома'));
  assert.ok(buildPhotoPrompt(plan.photos[4]).includes('no text, no icons, no panels'));
  assert.ok(plan.photos[0].visualDirection.styleProfile.references.length > 0);
});

test('changing only copy cannot disguise repeated scenes or layouts', () => {
  for (const field of ['scene', 'composition', 'message', 'layout']) {
    const brief = briefFor(input());
    brief.photos[1][field] = '  ' + brief.photos[0][field].toUpperCase() + '!!';
    assert.throws(() => validatePhotoCreativeBrief(brief, brief.productKey), /repeats/);
  }
});

test('changing SKU and headlines cannot disguise another product gallery', () => {
  const first = briefFor(input());
  const copy = structuredClone(first);
  copy.productKey = 'ugopt:another-product';
  copy.photos[0].photoCopy.headline = 'Інший заголовок';
  assert.equal(findCreativeReuse(copy, [first]).length, 5);
  assert.equal(findCreativeReuse(first, [first]).length, 0);
});

test('creative text cannot introduce an unsupported specification or visible model', () => {
  const source = input();
  const brief = briefFor(source);
  brief.photos[3].photoCopy.supportingFacts = [{ field: 'power', value: '2200 Вт' }];
  assert.throws(() => buildPhotoProductionPlan({ ...source, photoCreativeBrief: brief }), /unverified supporting fact/);
  brief.photos[3].photoCopy.supportingFacts = [];
  brief.photos[0].photoCopy.headline = 'Фен V-123';
  assert.throws(() => buildPhotoProductionPlan({ ...source, photoCreativeBrief: brief }), /model identifiers/);
});

test('final image cannot repeat infographic text', () => {
  const brief = briefFor(input());
  brief.photos[4].photoCopy.headline = 'Фен';
  assert.throws(() => validatePhotoCreativeBrief(brief, brief.productKey), /object-only/);
});
