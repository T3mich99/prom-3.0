import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContentExcelRow } from '../../src/excel/content-row-adapter.mjs';
import { CONTENT_STATUSES, validateContentArtifact } from '../../src/content/content-quality.mjs';
import {
  ContentGenerationError,
  generateContentArtifact,
  reworkContentArtifact,
} from '../../src/content/content-generation-adapter.mjs';

function keywordsAtLength(length) {
  const terms = Array.from({ length: 25 }, (_, index) => `пошукова фраза товару ${index + 1}`);
  const base = terms.join(', ');
  assert.ok(base.length <= length);
  return `${base}${'x'.repeat(length - base.length)}`;
}

function longText(prefix) {
  const language = arguments[1] ?? 'ua';
  const tail = language === 'ru'
    ? 'помогает понять пользу и способ использования'
    : 'пояснює користь і спосіб використання';
  const fact = language === 'ru' ? 'мощность 2200 Вт, цвет черный' : 'потужність 2200 Вт, колір чорний';
  return Array.from({ length: 45 }, (_, index) => `${prefix}, ${fact} ${tail}, абзац ${index + 1}.`).join(' ');
}

const sourceInput = () => ({
  productKey: 'ugopt:F-001',
  sourceFacts: { color: 'чорний', power: '2200 Вт', type: 'фен' },
  sourceText: { title: 'Фен для волосся', supplierDescription: 'Перевірений текст товару' },
  categoryContext: { source: 'ug-opt', name: 'Фени' },
});

function validContent(overrides = {}) {
  return {
    title: { ru: 'Фен для волос', ua: 'Фен для волосся' },
    description: {
      ru: longText('Фен помогает быстро высушить волосы и удобно подготовить их к укладке', 'ru'),
      ua: longText('Фен допомагає швидко висушити волосся та зручно підготувати його до укладання', 'ua'),
    },
    keywords: { ru: keywordsAtLength(800), ua: keywordsAtLength(800) },
    characteristics: [{ name: 'Мощность', value: '2200 Вт' }],
    ...overrides,
  };
}

function response(content = validContent(), extra = {}) {
  return { content, ...extra };
}

function fakeGenerator(result, calls = []) {
  return async (request) => {
    calls.push(structuredClone(request));
    return typeof result === 'function' ? result(request) : structuredClone(result);
  };
}

async function generateWith(content, options = {}) {
  return generateContentArtifact(sourceInput(), {
    generator: fakeGenerator(response(content)),
    ...options,
  });
}

test('generates the current Content Artifact v1 and runs Content Quality once', async () => {
  const calls = [];
  const source = sourceInput();
  const generator = fakeGenerator(response(validContent(), {
    claims: [{ field: 'power', value: '2200 Вт', contentField: 'description' }],
  }), calls);
  const result = await generateContentArtifact(source, { generator });

  assert.equal(calls.length, 1);
  assert.equal(result.status, CONTENT_STATUSES.READY);
  assert.equal(result.artifact.productKey, source.productKey);
  assert.equal(result.artifact.version, 1);
  assert.equal(result.artifact.content.title.ru, 'Фен для волос');
  assert.equal(result.artifact.content.title.ua, 'Фен для волосся');
  assert.equal(result.artifact.content.description.ru, validContent().description.ru);
  assert.equal(result.artifact.content.description.ua, validContent().description.ua);
  assert.equal(result.artifact.content.keywords.ru, validContent().keywords.ru);
  assert.equal(result.artifact.content.keywords.ua, validContent().keywords.ua);
  assert.deepEqual(result.artifact.content.characteristics, [{ name: 'Мощность', value: '2200 Вт' }]);
  assert.deepEqual(result.artifact.sourceFacts, source.sourceFacts);
  assert.deepEqual(result.artifact.claims, [{ field: 'power', value: '2200 Вт', contentField: 'description' }]);
  assert.deepEqual(result.generation, { operation: 'initial', fields: ['title', 'description', 'keywords', 'characteristics'] });
});

test('generator output may be strict JSON text, but markdown and commentary are rejected', async () => {
  const content = validContent();
  const json = JSON.stringify(response(content));
  const result = await generateContentArtifact(sourceInput(), { generator: fakeGenerator(json) });
  assert.equal(result.status, CONTENT_STATUSES.READY);
  for (const raw of [`\`\`\`json\n${json}\n\`\`\``, `commentary\n${json}`, `${json}\ncommentary`]) {
    await assert.rejects(
      () => generateContentArtifact(sourceInput(), { generator: fakeGenerator(raw) }),
      (error) => error instanceof ContentGenerationError && error.code === 'GENERATOR_RESPONSE_INVALID',
    );
  }
});

test('missing title remains a valid artifact classified as REWORK by the existing quality validator', async () => {
  const content = validContent();
  delete content.title;
  const result = await generateWith(content);
  assert.equal(result.status, CONTENT_STATUSES.REWORK);
  assert.equal(result.quality.fields.title.status, CONTENT_STATUSES.REWORK);
  assert.deepEqual(result.quality.reworkPlan.fields, [{ field: 'title', reasonCodes: ['TITLE_MISSING'] }]);
});

test('missing characteristics produces REVIEW rather than being fabricated', async () => {
  const content = validContent();
  delete content.characteristics;
  const result = await generateWith(content);
  assert.equal(result.status, CONTENT_STATUSES.REVIEW);
  assert.equal(result.artifact.content.characteristics, undefined);
});

test('provider failures are explicit and are not converted into quality statuses', async () => {
  const cause = new Error('provider offline');
  const calls = [];
  await assert.rejects(
    () => generateContentArtifact(sourceInput(), { generator: async (request) => { calls.push(request); throw cause; } }),
    (error) => error instanceof ContentGenerationError && error.code === 'GENERATOR_FAILURE' && error.cause === cause,
  );
  assert.equal(calls.length, 1);
});

test('malformed and unsafe provider responses are rejected explicitly', async () => {
  const cases = [
    ['malformed JSON', '{', 'GENERATOR_RESPONSE_INVALID'],
    ['empty response', {}, 'GENERATOR_RESPONSE_INVALID'],
    ['wrong localized type', response({ ...validContent(), title: { ru: 123, ua: 'Фен' } }), 'GENERATOR_RESPONSE_INVALID'],
    ['unknown output field', { content: validContent(), price: 230 }, 'GENERATOR_RESPONSE_INVALID'],
    ['identity override', { productKey: 'ugopt:OTHER', content: validContent() }, 'GENERATOR_RESPONSE_INVALID'],
    ['business field inside content', { content: { ...validContent(), price: 230 } }, 'GENERATOR_RESPONSE_INVALID'],
    ['malformed characteristics', { content: { ...validContent(), characteristics: 'not-array' } }, 'GENERATOR_RESPONSE_INVALID'],
  ];
  for (const [label, raw, code] of cases) {
    await assert.rejects(
      () => generateContentArtifact(sourceInput(), { generator: fakeGenerator(raw) }),
      (error) => error instanceof ContentGenerationError && error.code === code,
      label,
    );
  }
});

test('forbidden purchasePrice source facts are rejected before generator invocation', async () => {
  const source = sourceInput();
  source.sourceFacts.purchasePrice = 230;
  let calls = 0;
  await assert.rejects(
    () => generateContentArtifact(source, {
      generator: async () => {
        calls += 1;
        return response(validContent());
      },
    }),
    (error) => error instanceof TypeError && /forbidden business metadata/u.test(error.message),
  );
  assert.equal(calls, 0);
});

test('generated output and quality policy are not mutated', async () => {
  const source = sourceInput();
  const responseObject = response(validContent());
  const policy = { description: { minimumVisibleCharacters: 1000 } };
  const beforeSource = structuredClone(source);
  const beforeResponse = structuredClone(responseObject);
  const beforePolicy = structuredClone(policy);
  const result = await generateContentArtifact(source, {
    generator: fakeGenerator(responseObject),
    policy,
  });
  assert.deepEqual(source, beforeSource);
  assert.deepEqual(responseObject, beforeResponse);
  assert.deepEqual(policy, beforePolicy);
  assert.equal(result.artifact.sourceFacts !== source.sourceFacts, true);
});

test('generation is deterministic with the same deterministic fake provider', async () => {
  const first = await generateWith(validContent());
  const second = await generateWith(validContent());
  assert.deepEqual(first, second);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'timestamp'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first.generation, 'rawResponse'), false);
});

test('title-only rework uses only title and preserves unrelated fields', async () => {
  const broken = validContent({ title: { ru: '', ua: '' } });
  const initial = await generateWith(broken);
  const before = structuredClone(initial.artifact);
  const calls = [];
  const result = await reworkContentArtifact({
    artifact: initial.artifact,
    quality: initial.quality,
    sourceFacts: initial.artifact.sourceFacts,
  }, { generator: fakeGenerator({ content: { title: { ru: 'Фен для волос', ua: 'Фен для волосся' } } }, calls) });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].metadata.fields, ['title']);
  assert.deepEqual(calls[0].metadata.reasonCodes, [{ field: 'title', reasonCodes: ['TITLE_MISSING'] }]);
  assert.equal(result.status, CONTENT_STATUSES.READY);
  assert.equal(result.artifact.version, 2);
  assert.deepEqual(result.artifact.content.description, before.content.description);
  assert.deepEqual(result.artifact.content.keywords, before.content.keywords);
  assert.deepEqual(result.artifact.content.characteristics, before.content.characteristics);
});

test('rework rejects a forged same-version quality result before generator invocation', async () => {
  const initial = await generateWith(validContent({ description: { ru: 'short', ua: 'short' } }));
  const forgedQuality = structuredClone(initial.quality);
  forgedQuality.reworkPlan.fields = [{ field: 'title', reasonCodes: ['TITLE_MISSING'] }];
  let calls = 0;
  await assert.rejects(
    () => reworkContentArtifact({ artifact: initial.artifact, quality: forgedQuality, sourceFacts: initial.artifact.sourceFacts }, {
      generator: async () => {
        calls += 1;
        return { content: { title: { ru: 'Фен', ua: 'Фен' } } };
      },
    }),
    (error) => error instanceof ContentGenerationError && error.code === 'QUALITY_RESULT_MISMATCH',
  );
  assert.equal(calls, 0);
});

test('rework rejects quality from a previous artifact version before generator invocation', async () => {
  const initial = await generateWith(validContent({ description: { ru: 'short', ua: 'short' } }));
  const nextArtifact = structuredClone(initial.artifact);
  nextArtifact.version = 2;
  let calls = 0;
  await assert.rejects(
    () => reworkContentArtifact({ artifact: nextArtifact, quality: initial.quality, sourceFacts: nextArtifact.sourceFacts }, {
      generator: async () => {
        calls += 1;
        return { content: { description: { ru: longText('Фен помогает быстро высушить волосы и удобно подготовить их к укладке', 'ru'), ua: longText('Фен допомагає швидко висушити волосся та зручно підготувати його до укладання', 'ua') } } };
      },
    }),
    (error) => error instanceof ContentGenerationError && error.code === 'QUALITY_RESULT_MISMATCH',
  );
  assert.equal(calls, 0);
});

test('rework rejects an artifact changed without updating its quality result', async () => {
  const initial = await generateWith(validContent());
  const changedArtifact = structuredClone(initial.artifact);
  changedArtifact.content.description = { ru: 'manual change', ua: 'ручна зміна' };
  let calls = 0;
  await assert.rejects(
    () => reworkContentArtifact({ artifact: changedArtifact, quality: initial.quality, sourceFacts: changedArtifact.sourceFacts }, {
      generator: async () => {
        calls += 1;
        return { content: { description: { ru: longText('Фен помогает быстро высушить волосы и удобно подготовить их к укладке', 'ru'), ua: longText('Фен допомагає швидко висушити волосся та зручно підготувати його до укладання', 'ua') } } };
      },
    }),
    (error) => error instanceof ContentGenerationError && error.code === 'QUALITY_RESULT_MISMATCH',
  );
  assert.equal(calls, 0);
});

test('rework rejects quality computed under a different policy before generator invocation', async () => {
  const initial = await generateWith(validContent({ description: { ru: 'short', ua: 'short' } }));
  const policy = { description: { minimumVisibleCharacters: 1 } };
  let calls = 0;
  await assert.rejects(
    () => reworkContentArtifact({ artifact: initial.artifact, quality: initial.quality, sourceFacts: initial.artifact.sourceFacts }, {
      policy,
      generator: async () => {
        calls += 1;
        return { content: { description: { ru: longText('Фен помогает быстро высушить волосы и удобно подготовить их к укладке', 'ru'), ua: longText('Фен допомагає швидко висушити волосся та зручно підготувати його до укладання', 'ua') } } };
      },
    }),
    (error) => error instanceof ContentGenerationError && error.code === 'QUALITY_RESULT_MISMATCH',
  );
  assert.equal(calls, 0);
});

test('description-only rework fixes description and leaves other fields unchanged', async () => {
  const broken = validContent({ description: { ru: 'коротко', ua: 'коротко' } });
  const initial = await generateWith(broken);
  const before = structuredClone(initial.artifact);
  const result = await reworkContentArtifact({
    artifact: initial.artifact,
    quality: initial.quality,
    sourceFacts: initial.artifact.sourceFacts,
  }, { generator: fakeGenerator({ content: { description: { ru: longText('Фен помогает быстро высушить волосы и удобно подготовить их к укладке', 'ru'), ua: longText('Фен допомагає швидко висушити волосся та зручно підготувати його до укладання', 'ua') } } }) });
  assert.equal(result.status, CONTENT_STATUSES.READY);
  assert.equal(result.artifact.version, before.version + 1);
  assert.deepEqual(result.artifact.content.title, before.content.title);
  assert.deepEqual(result.artifact.content.keywords, before.content.keywords);
  assert.deepEqual(result.artifact.content.characteristics, before.content.characteristics);
});

test('keywords-only rework fixes keywords and uses the existing reason code', async () => {
  const broken = validContent({ keywords: { ru: 'одна фраза', ua: 'одна фраза' } });
  const initial = await generateWith(broken);
  assert.equal(initial.quality.reworkPlan.fields[0].field, 'keywords');
  const result = await reworkContentArtifact({
    artifact: initial.artifact,
    quality: initial.quality,
    sourceFacts: initial.artifact.sourceFacts,
  }, { generator: fakeGenerator({ content: { keywords: { ru: keywordsAtLength(800), ua: keywordsAtLength(800) } } }) });
  assert.equal(result.status, CONTENT_STATUSES.READY);
  assert.equal(result.artifact.version, 2);
});

test('characteristics-only rework fixes characteristics without inventing other fields', async () => {
  const broken = validContent({ characteristics: [
    { name: 'Мощность', value: '2200 Вт' },
    { name: 'Мощность', value: '2200 Вт' },
  ] });
  const initial = await generateWith(broken);
  assert.deepEqual(initial.quality.reworkPlan.fields, [{ field: 'characteristics', reasonCodes: ['DUPLICATE_CHARACTERISTIC'] }]);
  const before = structuredClone(initial.artifact);
  const result = await reworkContentArtifact({
    artifact: initial.artifact,
    quality: initial.quality,
    sourceFacts: initial.artifact.sourceFacts,
  }, { generator: fakeGenerator({ content: { characteristics: [{ name: 'Мощность', value: '2200 Вт' }] } }) });
  assert.equal(result.status, CONTENT_STATUSES.READY);
  assert.equal(result.artifact.version, 2);
  assert.deepEqual(result.artifact.content.title, before.content.title);
  assert.deepEqual(result.artifact.content.description, before.content.description);
  assert.deepEqual(result.artifact.content.keywords, before.content.keywords);
});

test('REVIEW is not automatically reworked and the generator is not called', async () => {
  const content = validContent();
  delete content.characteristics;
  const initial = await generateWith(content);
  let calls = 0;
  await assert.rejects(
    () => reworkContentArtifact({ artifact: initial.artifact, quality: initial.quality, sourceFacts: initial.artifact.sourceFacts }, {
      generator: async () => { calls += 1; return { content: {} }; },
    }),
    (error) => error instanceof ContentGenerationError && error.code === 'REWORK_NOT_ELIGIBLE',
  );
  assert.equal(calls, 0);
});

test('failed rework response or provider call leaves the original artifact and version unchanged', async () => {
  const initial = await generateWith(validContent({ description: { ru: 'short', ua: 'short' } }));
  const before = structuredClone(initial.artifact);
  await assert.rejects(
    () => reworkContentArtifact({ artifact: initial.artifact, quality: initial.quality, sourceFacts: initial.artifact.sourceFacts }, {
      generator: fakeGenerator('{bad json'),
    }),
    (error) => error instanceof ContentGenerationError && error.code === 'GENERATOR_RESPONSE_INVALID',
  );
  assert.deepEqual(initial.artifact, before);
  assert.equal(initial.artifact.version, 1);
  await assert.rejects(
    () => reworkContentArtifact({ artifact: initial.artifact, quality: initial.quality, sourceFacts: initial.artifact.sourceFacts }, {
      generator: async () => { throw new Error('offline'); },
    }),
    (error) => error instanceof ContentGenerationError && error.code === 'GENERATOR_FAILURE',
  );
  assert.deepEqual(initial.artifact, before);
});

test('rework rejects unrequested fields and mismatched source facts', async () => {
  const initial = await generateWith(validContent({ description: { ru: 'short', ua: 'short' } }));
  await assert.rejects(
    () => reworkContentArtifact({ artifact: initial.artifact, quality: initial.quality, sourceFacts: initial.artifact.sourceFacts }, {
      generator: fakeGenerator({ content: {
        description: { ru: longText('Фен помогает быстро высушить волосы и удобно подготовить их к укладке', 'ru'), ua: longText('Фен допомагає швидко висушити волосся та зручно підготувати його до укладання', 'ua') },
        title: { ru: 'Лишнее', ua: 'Зайве' },
      } }),
    }),
    (error) => error instanceof ContentGenerationError && error.code === 'GENERATOR_RESPONSE_INVALID',
  );
  await assert.rejects(
    () => reworkContentArtifact({ artifact: initial.artifact, quality: initial.quality, sourceFacts: { power: '9999 Вт' } }, {
      generator: fakeGenerator({ content: { description: { ru: longText('Фен помогает быстро высушить волосы и удобно подготовить их к укладке', 'ru'), ua: longText('Фен допомагає швидко висушити волосся та зручно підготувати його до укладання', 'ua') } } }),
    }),
    (error) => error instanceof ContentGenerationError && error.code === 'SOURCE_FACTS_MISMATCH',
  );
});

test('generation and rework cross the Content Row Adapter without price, photos or inferred category', async () => {
  const initial = await generateWith(validContent());
  const rowResult = buildContentExcelRow({
    selectedProduct: { selectionKey: 'ugopt:F-001', product: { supplierSku: 'F-001', price: 230, sourceImageUrl: 'https://example.invalid/source.png' } },
    contentArtifact: initial.artifact,
    resolvedMetadata: { productCode: '0000123' },
  });
  assert.equal(rowResult.status, CONTENT_STATUSES.READY);
  assert.equal(rowResult.row.productCode, '0000123');
  assert.equal(rowResult.row.titleRu, initial.artifact.content.title.ru);
  assert.equal(rowResult.row.titleUa, initial.artifact.content.title.ua);
  assert.equal(rowResult.row.price, undefined);
  assert.equal(rowResult.row.photoUrls, undefined);
  assert.equal(rowResult.row.categoryName, undefined);
  assert.deepEqual(rowResult.deferredFields, [{ field: 'characteristics', reason: 'NO_CANONICAL_EXCEL_TARGET' }]);

  const broken = await generateWith(validContent({ title: { ru: '', ua: '' } }));
  const reworked = await reworkContentArtifact({ artifact: broken.artifact, quality: broken.quality, sourceFacts: broken.artifact.sourceFacts }, {
    generator: fakeGenerator({ content: { title: { ru: 'Фен для волос', ua: 'Фен для волосся' } } }),
  });
  const reworkedRow = buildContentExcelRow({
    selectedProduct: { selectionKey: 'ugopt:F-001', product: { supplierSku: 'F-001' } },
    contentArtifact: reworked.artifact,
  });
  assert.equal(reworked.status, CONTENT_STATUSES.READY);
  assert.equal(reworkedRow.status, CONTENT_STATUSES.READY);
  assert.equal(reworkedRow.row.titleUa, 'Фен для волосся');
});

test('rework uses the current Content Quality result rather than duplicating quality rules', async () => {
  const artifact = {
    productKey: 'ugopt:F-001',
    version: 1,
    content: validContent({ description: { ru: 'short', ua: 'short' } }),
    sourceFacts: { power: '2200 Вт' },
  };
  const quality = validateContentArtifact(artifact);
  assert.equal(quality.status, CONTENT_STATUSES.REWORK);
  const result = await reworkContentArtifact({ artifact, quality, sourceFacts: artifact.sourceFacts }, {
    profile: 'base-v1',
    generator: fakeGenerator({ content: { description: { ru: longText('Фен помогает быстро высушить волосы и удобно подготовить их к укладке', 'ru'), ua: longText('Фен допомагає швидко висушити волосся та зручно підготувати його до укладання', 'ua') } } }),
  });
  assert.equal(result.status, CONTENT_STATUSES.READY);
});
