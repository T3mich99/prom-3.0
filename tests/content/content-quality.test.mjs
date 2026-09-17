import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_STATUSES, DEFAULT_CONTENT_QUALITY_POLICY, validateContentArtifact } from '../../src/content/content-quality.mjs';

function keywordsAtLength(length) {
  const terms = Array.from({ length: 25 }, (_, index) => `пошукова фраза товару ${index + 1}`);
  const base = terms.join(', ');
  assert.ok(base.length <= length);
  return `${base}${'x'.repeat(length - base.length)}`;
}

function longText(prefix) {
  return Array.from({ length: 45 }, (_, index) => `${prefix} пояснює перевагу та спосіб використання номер ${index + 1}`).join(' ');
}

function artifact(overrides = {}) {
  return {
    productKey: 'ugopt:quality-1',
    version: 1,
    content: {
      title: { ru: 'Фен для волос', ua: 'Фен для волосся' },
      description: { ru: longText('Текст товара'), ua: longText('Опис товару') },
      keywords: { ru: keywordsAtLength(800), ua: keywordsAtLength(800) },
      characteristics: [{ name: 'Мощность', value: '2200 Вт' }, { name: 'Цвет', value: 'Черный' }],
    },
    sourceFacts: { power: '2200 Вт' },
    ...overrides,
  };
}

test('valid bilingual content is READY with deterministic field order', () => {
  const result = validateContentArtifact(artifact());
  assert.equal(result.status, CONTENT_STATUSES.READY);
  assert.deepEqual(Object.keys(result.fields), ['title', 'description', 'keywords', 'characteristics']);
  assert.deepEqual(result.summary, { readyFieldCount: 4, reviewFieldCount: 0, reworkFieldCount: 0, issueCount: 0 });
  assert.deepEqual(result.reworkPlan, { fields: [] });
});

test('missing title is REWORK and produces a field-level plan', () => {
  const value = artifact();
  delete value.content.title;
  const result = validateContentArtifact(value);
  assert.equal(result.fields.title.status, CONTENT_STATUSES.REWORK);
  assert.deepEqual(result.reworkPlan.fields, [{ field: 'title', reasonCodes: ['TITLE_MISSING'] }]);
});

test('description measures visible HTML text and enforces the 1000-character minimum', () => {
  const value = artifact();
  value.content.description = { ru: '<p>коротко</p>', ua: '<p>коротко</p>' };
  const result = validateContentArtifact(value);
  assert.equal(result.fields.description.status, CONTENT_STATUSES.REWORK);
  assert.equal(result.fields.description.issues.every((item) => item.code === 'DESCRIPTION_TOO_SHORT'), true);
});

test('description repeated sentence is a deterministic REWORK issue', () => {
  const value = artifact();
  const repeated = `${'Одна и та же фраза. '.repeat(2)} ${longText('Дополнительный текст')}`;
  value.content.description = { ru: repeated, ua: repeated };
  const result = validateContentArtifact(value);
  assert.equal(result.fields.description.issues.some((item) => item.code === 'DESCRIPTION_REPEATED_BLOCK'), true);
});

test('description threshold can be explicitly overridden without changing defaults', () => {
  const value = artifact();
  value.content.description = { ru: 'x'.repeat(1100), ua: 'x'.repeat(1100) };
  const result = validateContentArtifact(value, { policy: { description: { minimumVisibleCharacters: 1200 } } });
  assert.equal(result.fields.description.status, CONTENT_STATUSES.REWORK);
  assert.equal(DEFAULT_CONTENT_QUALITY_POLICY.description.minimumVisibleCharacters, 1000);
});

test('description inside the hard minimum but outside the preferred range stays READY', () => {
  const value = artifact();
  value.content.description = { ru: 'x'.repeat(1100), ua: 'x'.repeat(1100) };
  const result = validateContentArtifact(value);
  assert.equal(result.fields.description.status, CONTENT_STATUSES.READY);
  assert.equal(result.fields.description.issues.length, 0);
  assert.ok(1100 >= DEFAULT_CONTENT_QUALITY_POLICY.description.minimumVisibleCharacters);
  assert.ok(1100 < DEFAULT_CONTENT_QUALITY_POLICY.description.preferredMinimumCharacters);
});

test('keyword boundaries are inclusive at 800 and 1024 characters', () => {
  const value = artifact();
  value.content.keywords = { ru: keywordsAtLength(1024), ua: keywordsAtLength(1024) };
  assert.equal(validateContentArtifact(value).fields.keywords.status, CONTENT_STATUSES.READY);
  value.content.keywords = { ru: keywordsAtLength(1025), ua: keywordsAtLength(1025) };
  assert.equal(validateContentArtifact(value).fields.keywords.issues.some((item) => item.code === 'KEYWORDS_TOO_LONG'), true);
  value.content.keywords = { ru: keywordsAtLength(799), ua: keywordsAtLength(799) };
  assert.equal(validateContentArtifact(value).fields.keywords.issues.some((item) => item.code === 'KEYWORDS_TOO_SHORT'), true);
});

test('keywords detect empty terms, too few phrases, and duplicate spam without mutating text', () => {
  const value = artifact();
  const original = value.content.keywords.ru;
  value.content.keywords = { ru: 'одна фраза, , одна фраза, одна фраза, одна фраза, другая фраза', ua: 'одна фраза, , одна фраза, одна фраза, одна фраза, другая фраза' };
  const result = validateContentArtifact(value);
  const codes = result.fields.keywords.issues.map((item) => item.code);
  assert.ok(codes.includes('KEYWORDS_EMPTY_TERM'));
  assert.ok(codes.includes('KEYWORDS_TOO_FEW_PHRASES'));
  assert.ok(codes.includes('KEYWORDS_DUPLICATE_SPAM'));
  assert.equal(value.content.keywords.ru, 'одна фраза, , одна фраза, одна фраза, одна фраза, другая фраза');
  assert.equal(original.length, 800);
});

test('maximumDuplicateRatio requires a finite number and accepts inclusive numeric bounds', () => {
  for (const invalid of ['0.5', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => validateContentArtifact(artifact(), { policy: { keywords: { maximumDuplicateRatio: invalid } } }),
      /maximumDuplicateRatio/u,
    );
  }
  assert.equal(validateContentArtifact(artifact(), { policy: { keywords: { maximumDuplicateRatio: 0 } } }).status, CONTENT_STATUSES.READY);
  assert.equal(validateContentArtifact(artifact(), { policy: { keywords: { maximumDuplicateRatio: 1 } } }).status, CONTENT_STATUSES.READY);
});

test('keyword minimum and maximum character thresholds cannot be inverted', () => {
  assert.throws(
    () => validateContentArtifact(artifact(), { policy: { keywords: { minimumCharacters: 1200, maximumCharacters: 1000 } } }),
    /minimumCharacters.*maximumCharacters/u,
  );
});

test('characteristics flag missing values and exact duplicates', () => {
  const value = artifact();
  value.content.characteristics = [
    { name: 'Материал', value: 'Пластик' },
    { name: 'Материал', value: 'Пластик' },
    { name: '', value: 'Черный' },
  ];
  const result = validateContentArtifact(value);
  const codes = result.fields.characteristics.issues.map((item) => item.code);
  assert.deepEqual(codes, ['DUPLICATE_CHARACTERISTIC', 'CHARACTERISTIC_NAME_MISSING']);
});

test('absent characteristics are REVIEW, not automatic REWORK', () => {
  const value = artifact();
  delete value.content.characteristics;
  const result = validateContentArtifact(value);
  assert.equal(result.status, CONTENT_STATUSES.REVIEW);
  assert.equal(result.fields.characteristics.status, CONTENT_STATUSES.REVIEW);
  assert.deepEqual(result.reworkPlan, { fields: [] });
});

test('product status precedence is REWORK over REVIEW over READY', () => {
  const value = artifact();
  delete value.content.characteristics;
  value.content.title = { ru: '', ua: '' };
  const result = validateContentArtifact(value);
  assert.equal(result.status, CONTENT_STATUSES.REWORK);
  assert.equal(result.summary.readyFieldCount, 2);
  assert.equal(result.summary.reviewFieldCount, 1);
  assert.equal(result.summary.reworkFieldCount, 1);
});

test('default unverified claims produce REVIEW while verified exact claims stay READY', () => {
  const value = artifact({ claims: [{ field: 'power', value: '2200 Вт' }] });
  assert.equal(validateContentArtifact(value).status, CONTENT_STATUSES.READY);
  value.claims = [{ field: 'power', value: '3000 Вт', contentField: 'description' }];
  const result = validateContentArtifact(value);
  assert.equal(result.status, CONTENT_STATUSES.REVIEW);
  assert.deepEqual(result.fields.description.issues[0], {
    code: 'UNVERIFIED_CLAIM',
    severity: 'review',
    field: 'description',
    message: 'structured claim does not exactly match sourceFacts',
    details: { fact: 'power', expected: '2200 Вт', actual: '3000 Вт' },
  });
  for (const unverifiedSeverity of ['review', 'rework']) {
    assert.equal(
      validateContentArtifact(artifact({ claims: [{ field: 'power', value: '2200 Вт' }] }), {
        policy: { claims: { unverifiedSeverity } },
      }).status,
      CONTENT_STATUSES.READY,
    );
  }
});

test('unverified claim severity override produces REWORK and adds the field to reworkPlan', () => {
  const result = validateContentArtifact(artifact({ claims: [{ field: 'power', value: '3000 Вт', contentField: 'description' }] }), {
    policy: { claims: { unverifiedSeverity: 'rework' } },
  });
  assert.equal(result.status, CONTENT_STATUSES.REWORK);
  assert.equal(result.fields.description.status, CONTENT_STATUSES.REWORK);
  assert.equal(result.fields.description.issues[0].severity, 'rework');
  assert.deepEqual(result.reworkPlan.fields, [{ field: 'description', reasonCodes: ['UNVERIFIED_CLAIM'] }]);
});

test('quality output is deterministic and has no runtime metadata', () => {
  const first = validateContentArtifact(artifact());
  const second = validateContentArtifact(artifact());
  assert.deepEqual(first, second);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'timestamp'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'random'), false);
});
