import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMERCIAL_CONTENT_PROFILE,
  DEFAULT_COMMERCIAL_CONTENT_POLICY,
  validateCommercialContentArtifact,
  resolveCommercialContentPolicy,
} from '../../src/content/commercial-content-quality.mjs';
import {
  buildContentGenerationRequest,
  buildContentReworkRequest,
} from '../../src/content/content-generation-prompt.mjs';
import {
  generateContentArtifact,
  reworkContentArtifact,
  ContentGenerationError,
} from '../../src/content/content-generation-adapter.mjs';
import { buildContentExcelRow } from '../../src/excel/content-row-adapter.mjs';
import { buildPhotoProductionPlan } from '../../src/photos/photo-production-plan.mjs';

function description(length = 1400, prefix = 'Опис товару допомагає покупцеві зрозуміти практичне використання') {
  const sentences = Array.from({ length }, (_, index) => (
    `${prefix} та переваги виробу, абзац ${index + 1}.`
  )).join(' ');
  return sentences.slice(0, length);
}

function keywords(language = 'ua', count = 25, length = 850) {
  const terms = Array.from({ length: count }, (_, index) => language === 'ua'
    ? `фен для волосся пошук ${index + 1}`
    : `фен для волос пошук ${index + 1}`);
  const base = terms.join(', ');
  assert.ok(base.length <= length, `keyword fixture base is longer than ${length}`);
  return `${base}${'x'.repeat(length - base.length)}`;
}

function sourceFacts() {
  return {
    type: 'фен',
    brand: 'VGR',
    model: 'V-451',
    power: '2200 Вт',
    temperatureModes: 3,
    speedModes: 2,
    color: 'чорний',
    coldAir: true,
  };
}

function validArtifact(overrides = {}) {
  const base = {
    productKey: 'ugopt:commercial-1',
    version: 1,
    content: {
      title: {
        ua: 'Фен з холодним обдувом VGR 2200 Вт чорний',
        ru: 'Фен с холодным обдувом VGR 2200 Вт черный',
      },
      description: { ua: description(1400), ru: description(1400, 'Описание товара помогает покупателю понять практическое использование') },
      keywords: { ua: keywords('ua'), ru: keywords('ru') },
      characteristics: [{ name: 'Потужність', value: '2200 Вт' }],
    },
    sourceFacts: sourceFacts(),
  };
  return {
    ...base,
    ...overrides,
    content: { ...base.content, ...(overrides.content ?? {}) },
    sourceFacts: overrides.sourceFacts ?? base.sourceFacts,
  };
}

function sourceInput() {
  return { productKey: 'ugopt:commercial-1', sourceFacts: sourceFacts() };
}

function fakeGenerator(result, calls = []) {
  return async (request) => {
    calls.push(structuredClone(request));
    return typeof result === 'function' ? result(request) : structuredClone(result);
  };
}

async function generateInitial(content = validArtifact().content, options = {}) {
  return generateContentArtifact(sourceInput(), {
    generator: fakeGenerator({ content }),
    ...options,
  });
}

function hasCode(result, code) {
  return Object.values(result.fields).some((field) => field.issues.some((item) => item.code === code));
}

test('commercial policy defaults expose the Prom v2 boundaries', () => {
  assert.deepEqual(DEFAULT_COMMERCIAL_CONTENT_POLICY.keywords, {
    minimumPhrases: 25,
    maximumPhrases: 35,
    minimumCharacters: 800,
    maximumCharacters: 1000,
    maximumDuplicateRatio: 0,
    rejectLanguageMix: true,
  });
  assert.equal(resolveCommercialContentPolicy().keywords.maximumPhrases, 35);
});

test('invalid commercial policy is rejected deterministically', () => {
  assert.throws(() => resolveCommercialContentPolicy({ keywords: { minimumPhrases: 36, maximumPhrases: 35 } }), /minimumPhrases.*maximumPhrases/u);
  assert.throws(() => resolveCommercialContentPolicy({ keywords: { minimumCharacters: 1001, maximumCharacters: 1000 } }), /minimumCharacters.*maximumCharacters/u);
  assert.throws(() => resolveCommercialContentPolicy({ keywords: { maximumDuplicateRatio: '0' } }), /maximumDuplicateRatio/u);
  assert.throws(() => resolveCommercialContentPolicy({ description: { unknown: true } }), /Unsupported commercial policy/u);
});

test('accepted commercial Ukrainian title follows factual order', () => {
  const result = validateCommercialContentArtifact(validArtifact());
  assert.equal(result.fields.title.status, 'READY');
  assert.equal(result.status, 'READY');
});

test('accepted commercial Russian title is natural and factual', () => {
  const value = validArtifact();
  value.content.title = { ru: 'Фен с холодным обдувом VGR 2200 Вт черный', ua: value.content.title.ua };
  assert.equal(validateCommercialContentArtifact(value).fields.title.status, 'READY');
});

test('localized type and brand are required while model is omitted from RU and UA titles', () => {
  const value = validArtifact({
    sourceFacts: {
      ...sourceFacts(),
      type: { ru: 'Выпрямитель', ua: 'Випрямляч' },
      brand: { ru: 'Brand RU', ua: 'Бренд UA' },
      model: { ru: 'RU-1', ua: 'UA-1' },
    },
  });
  value.content.title = {
    ru: 'Выпрямитель Brand RU 2200 Вт черный',
    ua: 'Випрямляч Бренд UA 2200 Вт чорний',
  };
  const result = validateCommercialContentArtifact(value);
  assert.equal(result.fields.title.status, 'READY');
  assert.equal(result.fields.title.issues.length, 0);
});

test('keyword-stuffed title is reworked', () => {
  const value = validArtifact();
  value.content.title.ua = 'Фен фен фен VGR 2200 Вт';
  assert.equal(validateCommercialContentArtifact(value).fields.title.issues.some((item) => item.code === 'TITLE_KEYWORD_STUFFING'), true);
});

test('unsupported model in title is reworked when traceable', () => {
  const value = validArtifact();
  value.content.title.ua = 'Фен VGR V-999 2200 Вт чорний';
  const result = validateCommercialContentArtifact(value);
  assert.equal(result.fields.title.issues.some((item) => item.code === 'TITLE_UNSUPPORTED_MODEL'), true);
  assert.equal(result.fields.title.status, 'REWORK');
});

test('unsupported numeric characteristic in title is reworked when traceable', () => {
  const value = validArtifact();
  value.content.title.ua = 'Фен VGR 3000 Вт чорний';
  assert.equal(validateCommercialContentArtifact(value).fields.title.issues.some((item) => item.code === 'TITLE_UNSUPPORTED_NUMERIC_CHARACTERISTIC'), true);
});

test('verified model is forbidden in both title languages and does not contaminate other fields', () => {
  for (const language of ['ua', 'ru']) {
    for (const model of ['V-451', 'v451', 'V 451', 'V–451']) {
      const value = validArtifact();
      value.content.title[language] += ` ${model}`;
      const result = validateCommercialContentArtifact(value);
      assert.equal(result.fields.title.status, 'REWORK');
      assert.equal(hasCode(result, 'TITLE_MODEL_FORBIDDEN'), true);
      assert.equal(result.fields.description.status, 'READY');
      assert.equal(value.sourceFacts.model, 'V-451');
    }
  }
});

test('verified localized models are forbidden in HTML descriptions, including specifications', () => {
  for (const language of ['ua', 'ru']) {
    const value = validArtifact();
    value.sourceFacts.model = { ua: 'UA-1', ru: 'RU-1' };
    value.content.description[language] += '<h3>Характеристики</h3><p>Модель: UA-1</p>';
    const result = validateCommercialContentArtifact(value);
    assert.equal(hasCode(result, 'DESCRIPTION_MODEL_FORBIDDEN'), true);
    assert.equal(result.fields.title.status, 'READY');
    assert.deepEqual(result.reworkPlan.fields.map((item) => item.field), ['description']);
  }
});

test('model aliases are checked without treating a partial number match as a model', () => {
  const value = validArtifact();
  delete value.sourceFacts.model;
  value.sourceFacts.model_number = '220';
  assert.equal(validateCommercialContentArtifact(value).fields.title.status, 'READY');
  value.content.description.ua += '<p>Модель 220.</p>';
  assert.equal(hasCode(validateCommercialContentArtifact(value), 'DESCRIPTION_MODEL_FORBIDDEN'), true);
});

test('generation and rework prompts prohibit model names in public titles and descriptions', () => {
  const request = buildContentGenerationRequest(sourceInput());
  assert.match(request.system, /Never include model names or model numbers in titles or descriptions/u);
  assert.doesNotMatch(request.prompt, /brand \+ verified model/u);
  const rework = buildContentReworkRequest({ productKey: 'ugopt:commercial-1', sourceFacts: sourceFacts(), fields: [{ field: 'title', reasonCodes: ['TITLE_MODEL_FORBIDDEN'] }], previousValues: { title: { ua: 'Фен VGR V-451' } } });
  assert.match(rework.system, /Never include model names or model numbers in titles or descriptions/u);
});

test('verified color is allowed in the title', () => {
  const result = validateCommercialContentArtifact(validArtifact());
  assert.equal(result.fields.title.status, 'READY');
  assert.match(validArtifact().content.title.ua, /чорний$/u);
});

test('description at the 1000 visible-character minimum is accepted structurally', () => {
  const value = validArtifact();
  value.content.description = { ua: description(1020), ru: description(1020, 'Описание товара объясняет пользу') };
  const result = validateCommercialContentArtifact(value);
  assert.equal(result.fields.description.status, 'READY');
  assert.equal(result.fields.description.issues.length, 0);
});

test('description outside the preferred range remains advisory', () => {
  const value = validArtifact();
  value.content.description = { ua: description(1100), ru: description(1100, 'Описание товара объясняет пользу') };
  const result = validateCommercialContentArtifact(value);
  assert.equal(result.fields.description.status, 'READY');
  assert.equal(result.fields.description.issues.length, 0);
});

test('Ukrainian completeness section is forbidden', () => {
  const value = validArtifact();
  value.content.description.ua = `<h3>Комплектація</h3>\n${description(1400)}`;
  assert.equal(validateCommercialContentArtifact(value).fields.description.issues.some((item) => item.code === 'DESCRIPTION_COMPLETENESS_SECTION_FORBIDDEN'), true);
});

test('Russian completeness section is forbidden', () => {
  const value = validArtifact();
  value.content.description.ru = `<h3>Комплектация</h3>\n${description(1400, 'Описание товара объясняет пользу')}`;
  assert.equal(validateCommercialContentArtifact(value).fields.description.issues.some((item) => item.code === 'DESCRIPTION_COMPLETENESS_SECTION_FORBIDDEN'), true);
});

test('Комплект поставки heading is forbidden', () => {
  const value = validArtifact();
  value.content.description.ru = `Комплект поставки:\n${description(1400, 'Описание товара объясняет пользу')}`;
  assert.equal(validateCommercialContentArtifact(value).fields.description.issues.some((item) => item.code === 'DESCRIPTION_COMPLETENESS_SECTION_FORBIDDEN'), true);
});

test('ordinary legitimate word комплект does not automatically fail', () => {
  const value = validArtifact();
  value.content.description.ru = `Товар объединяет несколько функций в один комплект возможностей. ${description(1400, 'Описание товара объясняет пользу')}`;
  const result = validateCommercialContentArtifact(value);
  assert.equal(result.fields.description.issues.some((item) => item.code === 'DESCRIPTION_COMPLETENESS_SECTION_FORBIDDEN'), false);
});

test('25 keyword phrases pass the lower boundary', () => {
  const value = validArtifact();
  value.content.keywords = { ua: keywords('ua', 25, 800), ru: keywords('ru', 25, 800) };
  assert.equal(validateCommercialContentArtifact(value).fields.keywords.status, 'READY');
});

test('35 keyword phrases pass the upper boundary', () => {
  const value = validArtifact();
  value.content.keywords = { ua: keywords('ua', 35, 1000), ru: keywords('ru', 35, 1000) };
  assert.equal(validateCommercialContentArtifact(value).fields.keywords.status, 'READY');
});

test('24 keyword phrases fail the lower boundary', () => {
  const value = validArtifact();
  value.content.keywords = { ua: keywords('ua', 24, 800), ru: keywords('ru', 24, 800) };
  assert.equal(validateCommercialContentArtifact(value).fields.keywords.issues.some((item) => item.code === 'KEYWORDS_TOO_FEW_PHRASES'), true);
});

test('36 keyword phrases fail the upper boundary', () => {
  const value = validArtifact();
  value.content.keywords = { ua: keywords('ua', 36, 1000), ru: keywords('ru', 36, 1000) };
  assert.equal(validateCommercialContentArtifact(value).fields.keywords.issues.some((item) => item.code === 'KEYWORDS_TOO_MANY_PHRASES'), true);
});

test('800 keyword characters pass the lower boundary', () => {
  const value = validArtifact();
  value.content.keywords = { ua: keywords('ua', 25, 800), ru: keywords('ru', 25, 800) };
  assert.equal(validateCommercialContentArtifact(value).fields.keywords.status, 'READY');
});

test('1000 keyword characters pass the commercial upper boundary', () => {
  const value = validArtifact();
  value.content.keywords = { ua: keywords('ua', 25, 1000), ru: keywords('ru', 25, 1000) };
  assert.equal(validateCommercialContentArtifact(value).fields.keywords.status, 'READY');
});

test('more than 1000 commercial keyword characters fails commercial READY', () => {
  const value = validArtifact();
  value.content.keywords = { ua: keywords('ua', 25, 1001), ru: keywords('ru', 25, 1001) };
  assert.equal(validateCommercialContentArtifact(value).fields.keywords.issues.some((item) => item.code === 'KEYWORDS_TOO_LONG'), true);
});

test('duplicate keyword phrases fail commercial validation', () => {
  const value = validArtifact();
  const duplicate = keywords('ua');
  value.content.keywords.ua = `${duplicate}, фен для волосся пошук 1`;
  const result = validateCommercialContentArtifact(value);
  assert.equal(result.fields.keywords.issues.some((item) => item.code === 'KEYWORDS_DUPLICATE_PHRASES'), true);
});

test('UA and RU keywords remain separate without language mixing', () => {
  const value = validArtifact();
  const result = validateCommercialContentArtifact(value);
  assert.equal(result.fields.keywords.status, 'READY');
  assert.notEqual(value.content.keywords.ua, value.content.keywords.ru);
});

test('brand and feature natural variants are accepted', () => {
  const value = validArtifact();
  value.content.title.ua = 'Фен VGR з холодним обдувом 2200 Вт чорний';
  assert.equal(validateCommercialContentArtifact(value).fields.title.status, 'READY');
});

test('unsupported keyword characteristic fails when numerically traceable', () => {
  const value = validArtifact();
  value.content.keywords.ua = `${keywords('ua')}, фен 3000 Вт`;
  assert.equal(validateCommercialContentArtifact(value).fields.keywords.issues.some((item) => item.code === 'KEYWORDS_UNSUPPORTED_FACT'), true);
});

test('economic metadata is excluded from the generation prompt', () => {
  const request = buildContentGenerationRequest(sourceInput());
  assert.doesNotMatch(request.prompt, /purchasePrice|230/u);
  assert.match(request.system, /economic metadata/iu);
});

test('sourceText cannot become factual authority', () => {
  const value = validArtifact({ claims: [{ field: 'power', value: '3000 Вт', contentField: 'description' }] });
  const result = validateCommercialContentArtifact(value);
  assert.equal(hasCode(result, 'UNVERIFIED_CLAIM'), true);
});

test('sourceFacts remain factual authority for exact claims', () => {
  const value = validArtifact({ claims: [{ field: 'power', value: '2200 Вт', contentField: 'description' }] });
  assert.equal(hasCode(validateCommercialContentArtifact(value), 'UNVERIFIED_CLAIM'), false);
});

test('characteristics contract remains an array of exact name/value strings', () => {
  const value = validArtifact();
  const result = validateCommercialContentArtifact(value);
  assert.deepEqual(value.content.characteristics, [{ name: 'Потужність', value: '2200 Вт' }]);
  assert.equal(result.fields.characteristics.status, 'READY');
});

test('commercial prompt requires no completeness block', () => {
  const request = buildContentGenerationRequest(sourceInput());
  assert.match(request.system, /Never generate a Комплектація.*Комплектация/iu);
  assert.match(request.prompt, /must not contain a completeness\/package section/iu);
});

test('only failed title is reworked', async () => {
  const broken = validArtifact().content;
  broken.title = { ua: '', ru: '' };
  const initial = await generateInitial(broken);
  const calls = [];
  const result = await reworkContentArtifact({ artifact: initial.artifact, quality: initial.quality, sourceFacts: initial.artifact.sourceFacts }, {
    generator: fakeGenerator({ content: { title: validArtifact().content.title } }, calls),
  });
  assert.deepEqual(calls[0].metadata.fields, ['title']);
  assert.deepEqual(result.artifact.content.description, broken.description);
  assert.deepEqual(result.artifact.content.keywords, broken.keywords);
});

test('only failed description is reworked', async () => {
  const broken = validArtifact().content;
  broken.description = { ua: 'коротко', ru: 'коротко' };
  const initial = await generateInitial(broken);
  const calls = [];
  const result = await reworkContentArtifact({ artifact: initial.artifact, quality: initial.quality, sourceFacts: initial.artifact.sourceFacts }, {
    generator: fakeGenerator({ content: { description: { ua: description(), ru: description(1400, 'Описание товара объясняет пользу') } } }, calls),
  });
  assert.deepEqual(calls[0].metadata.fields, ['description']);
  assert.deepEqual(result.artifact.content.title, broken.title);
  assert.deepEqual(result.artifact.content.keywords, broken.keywords);
});

test('only failed keywords are reworked', async () => {
  const broken = validArtifact().content;
  broken.keywords = { ua: 'одна фраза', ru: 'одна фраза' };
  const initial = await generateInitial(broken);
  const calls = [];
  const result = await reworkContentArtifact({ artifact: initial.artifact, quality: initial.quality, sourceFacts: initial.artifact.sourceFacts }, {
    generator: fakeGenerator({ content: { keywords: { ua: keywords('ua'), ru: keywords('ru') } } }, calls),
  });
  assert.deepEqual(calls[0].metadata.fields, ['keywords']);
  assert.deepEqual(result.artifact.content.title, broken.title);
  assert.deepEqual(result.artifact.content.description, broken.description);
});

test('accepted fields are preserved exactly during commercial rework', async () => {
  const broken = validArtifact().content;
  broken.title = { ua: '', ru: '' };
  const initial = await generateInitial(broken);
  const result = await reworkContentArtifact({ artifact: initial.artifact, quality: initial.quality, sourceFacts: initial.artifact.sourceFacts }, {
    generator: fakeGenerator({ content: { title: validArtifact().content.title } }),
  });
  assert.deepEqual(result.artifact.content.description, initial.artifact.content.description);
  assert.deepEqual(result.artifact.content.keywords, initial.artifact.content.keywords);
  assert.deepEqual(result.artifact.content.characteristics, initial.artifact.content.characteristics);
});

test('commercial rework increments version once', async () => {
  const broken = validArtifact().content;
  broken.title = { ua: '', ru: '' };
  const initial = await generateInitial(broken);
  const result = await reworkContentArtifact({ artifact: initial.artifact, quality: initial.quality, sourceFacts: initial.artifact.sourceFacts }, {
    generator: fakeGenerator({ content: { title: validArtifact().content.title } }),
  });
  assert.equal(result.artifact.version, initial.artifact.version + 1);
});

test('stale or forged commercial quality is blocked', async () => {
  const broken = validArtifact().content;
  broken.title = { ua: '', ru: '' };
  const initial = await generateInitial(broken);
  const forged = structuredClone(initial.quality);
  forged.reworkPlan.fields = [{ field: 'description', reasonCodes: ['DESCRIPTION_TOO_SHORT'] }];
  await assert.rejects(
    () => reworkContentArtifact({ artifact: initial.artifact, quality: forged, sourceFacts: initial.artifact.sourceFacts }, { generator: fakeGenerator({ content: {} }) }),
    (error) => error instanceof ContentGenerationError && error.code === 'QUALITY_RESULT_MISMATCH',
  );
});

test('commercial validation is deterministic', () => {
  const first = validateCommercialContentArtifact(validArtifact());
  const second = validateCommercialContentArtifact(validArtifact());
  assert.deepEqual(first, second);
  assert.equal(Object.hasOwn(first, 'timestamp'), false);
});

test('commercial validation does not mutate artifact or policy', () => {
  const value = validArtifact();
  const policy = { keywords: { maximumPhrases: 35 } };
  const before = structuredClone(value);
  const policyBefore = structuredClone(policy);
  validateCommercialContentArtifact(value, { policy });
  assert.deepEqual(value, before);
  assert.deepEqual(policy, policyBefore);
});

test('commercial content passes through Excel row adapter with exact strings', async () => {
  const generated = await generateInitial();
  const row = buildContentExcelRow({
    selectedProduct: { selectionKey: generated.artifact.productKey, product: { supplierSku: 'F-001' } },
    contentArtifact: generated.artifact,
  });
  assert.equal(row.status, 'READY');
  assert.equal(row.row.titleUa, generated.artifact.content.title.ua);
  assert.equal(row.row.descriptionRu, generated.artifact.content.description.ru);
  assert.equal(row.row.keywordsUa, generated.artifact.content.keywords.ua);
});

test('commercial READY content remains compatible with the photo plan', async () => {
  const generated = await generateInitial();
  const plan = buildPhotoProductionPlan({
    selectedProduct: { selectionKey: generated.artifact.productKey, product: {} },
    contentArtifact: generated.artifact,
    sourceImages: [{ id: 'source-1', url: 'https://example.invalid/source.png' }],
    sourceFacts: generated.artifact.sourceFacts,
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.photos.length, 5);
});

test('full generation to commercial QA integration returns commercial READY', async () => {
  const generated = await generateInitial();
  assert.equal(generated.quality.profile, COMMERCIAL_CONTENT_PROFILE);
  assert.equal(generated.status, 'READY');
  assert.equal(generated.quality.baseQuality.status, 'READY');
});
