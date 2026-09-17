import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolvePhotoStyle, assertCurrentPhotoStyle } from '../../src/photos/photo-style-profile.mjs';

test('category and product corrections persist, stay scoped, and invalidate stale plans', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-style-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'styles.json');
  const config = { version: 1, global: { instructions: ['light background'], references: [] }, families: {}, categories: { dryers: { instructions: ['warm vanity'], references: [] } }, products: { 'ugopt:1': { instructions: ['large control closeup'], references: [] } } };
  await fs.writeFile(configPath, JSON.stringify(config));
  const options = { configPath, referenceRoot: root };
  const saved = resolvePhotoStyle({ productKey: 'ugopt:1', categoryKey: 'dryers' }, options);
  assert.deepEqual(saved.instructions, ['light background', 'warm vanity', 'large control closeup']);
  assert.deepEqual(resolvePhotoStyle({ productKey: 'ugopt:2', categoryKey: 'lamps' }, options).instructions, ['light background']);
  assert.deepEqual(saved, resolvePhotoStyle({ productKey: 'ugopt:1', categoryKey: 'dryers' }, options));
  config.version += 1;
  config.categories.dryers.instructions = ['approved cream vanity'];
  await fs.writeFile(configPath, JSON.stringify(config));
  assert.throws(() => assertCurrentPhotoStyle(saved, options), /PHOTO_STYLE_CHANGED/u);
  assert.ok(resolvePhotoStyle({ productKey: 'ugopt:1', categoryKey: 'dryers' }, options).instructions.includes('approved cream vanity'));
});
