import assert from 'node:assert/strict';
import test from 'node:test';
import { applyContentFieldRework, validateContentArtifactStructure } from '../../src/content/content-contract.mjs';

const baseArtifact = () => ({
  productKey: 'ugopt:12345',
  version: 1,
  content: {
    title: { ru: 'Фен для волос', ua: 'Фен для волосся' },
    description: { ru: 'Описание', ua: 'Опис' },
    keywords: { ru: 'фен для волос', ua: 'фен для волосся' },
    characteristics: [{ name: 'Мощность', value: '2200 Вт' }],
  },
  sourceFacts: { power: '2200 Вт' },
});

test('structural contract accepts opaque product keys and preserves exact values', () => {
  const artifact = baseArtifact();
  artifact.productKey = '  opaque:key/with spaces  ';
  assert.equal(validateContentArtifactStructure(artifact), true);
  assert.equal(artifact.productKey, '  opaque:key/with spaces  ');
});

test('structural contract rejects invalid identity, version, content, and unsupported fields', () => {
  assert.throws(() => validateContentArtifactStructure({ ...baseArtifact(), productKey: 123 }), /productKey/u);
  assert.throws(() => validateContentArtifactStructure({ ...baseArtifact(), version: '1' }), /version/u);
  assert.throws(() => validateContentArtifactStructure({ ...baseArtifact(), content: [] }), /content/u);
  assert.throws(() => validateContentArtifactStructure({ ...baseArtifact(), content: { ...baseArtifact().content, html: {} } }), /Unsupported content field/u);
});

test('field rework replaces only requested fields and increments version once', () => {
  const original = baseArtifact();
  const result = applyContentFieldRework(original, {
    title: { ru: 'Новый фен', ua: 'Новий фен' },
    description: { ru: 'Новое описание', ua: 'Новий опис' },
  });
  assert.equal(result.version, 2);
  assert.deepEqual(result.content.title, { ru: 'Новый фен', ua: 'Новий фен' });
  assert.deepEqual(result.content.description, { ru: 'Новое описание', ua: 'Новий опис' });
  assert.deepEqual(result.content.keywords, original.content.keywords);
  assert.equal(result.productKey, original.productKey);
  assert.deepEqual(result.sourceFacts, original.sourceFacts);
  assert.deepEqual(original.content.title, { ru: 'Фен для волос', ua: 'Фен для волосся' });
});

test('empty rework is a pure no-op and unknown replacement fields are rejected', () => {
  const original = baseArtifact();
  const result = applyContentFieldRework(original, {});
  assert.notEqual(result, original);
  assert.equal(result.version, original.version);
  assert.deepEqual(result, original);
  assert.throws(() => applyContentFieldRework(original, { html: '<p>x</p>' }), /Unsupported replacement field/u);
});

test('undefined replacement is rejected without mutating the original artifact', () => {
  const original = baseArtifact();
  const before = structuredClone(original);
  assert.throws(() => applyContentFieldRework(original, { description: undefined }), /content\.description/u);
  assert.deepEqual(original, before);
  assert.equal(original.version, 1);
});

test('replacement validation does not mutate source facts', () => {
  const original = baseArtifact();
  const sourceFacts = original.sourceFacts;
  const result = applyContentFieldRework(original, { characteristics: [{ name: 'Колір', value: 'Чорний' }] });
  assert.notEqual(result.sourceFacts, sourceFacts);
  assert.deepEqual(sourceFacts, { power: '2200 Вт' });
});
