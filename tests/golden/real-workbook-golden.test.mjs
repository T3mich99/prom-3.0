import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { FileBlob, SpreadsheetFile } from '../support/xlsx-compat.mjs';
import { fileURLToPath } from 'node:url';
import { canonicalGroups, canonicalProducts } from './canonical.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixturesDir = path.join(repoRoot, 'tests', 'fixtures', 'golden');
const entries = (await fs.readdir(fixturesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => name !== 'pricing');

assert.ok(entries.length > 0, 'real golden fixtures must exist');

const snapshots = Object.fromEntries(await Promise.all(entries.map(async (fixtureId) => [
  fixtureId,
  JSON.parse(await fs.readFile(path.join(fixturesDir, fixtureId, 'snapshot.json'), 'utf8')),
])));

for (const fixtureId of entries) {
  test(`real workbook golden remains stable: ${fixtureId}`, async () => {
    const fixturePath = path.join(fixturesDir, fixtureId);
    const expected = JSON.parse(await fs.readFile(path.join(fixturePath, 'snapshot.json'), 'utf8'));
    const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(fixturePath, 'workbook.xlsx')));
    const actualSheetNames = [];
    for (const name of ['Export Products Sheet', 'Export Groups Sheet']) {
      try {
        workbook.worksheets.getItem(name);
        actualSheetNames.push(name);
      } catch {
        // Optional group sheet is represented by the golden snapshot.
      }
    }
    assert.deepEqual(actualSheetNames, expected.sheetNames);

    const products = workbook.worksheets.getItem('Export Products Sheet');
    const actualProduct = canonicalProducts(products.getUsedRange().values);
    assert.deepEqual(actualProduct, expected.products);

    if (expected.groups) {
      const groups = workbook.worksheets.getItem('Export Groups Sheet');
      assert.deepEqual(canonicalGroups(groups.getUsedRange().values, actualProduct), expected.groups);
    }
  });
}

test('golden set preserves representative cross-workflow conflicts and photo provenance', () => {
  const standard = snapshots['standard-prom'].products.important;
  assert.equal(standard.price, 349);
  assert.equal(standard.wholesalePrice, 349);
  assert.equal(standard.photoCount, 3);
  assert.equal(standard.photoUrlPolicy, 'supplier-prom');
  assert.equal(standard.groupName, null);

  const tiered = snapshots['tiered-price-rule'].products.important;
  assert.equal(tiered.price, 3514);
  assert.equal(tiered.photoCount, 5);
  assert.equal(tiered.photoUrlPolicy, 'drive-uc-view');
  assert.equal(tiered.wholesalePrice, null);

  const legacy = snapshots['legacy-photo-fallback'].products.important;
  assert.equal(legacy.photoCount, 5);
  assert.match(legacy.photoLinks[0], /^https:\/\/images\.prom\.ua\//u);
  assert.match(legacy.photoLinks[1], /export=download/u);
  assert.deepEqual(legacy.photoLinks.slice(-3), [legacy.photoLinks[2], legacy.photoLinks[2], legacy.photoLinks[2]]);

  const strictReady = snapshots['strict-ready'].products.important;
  assert.equal(strictReady.code, 'U34722U');
  assert.equal(strictReady.uniqueId, 34722);
  assert.equal(strictReady.productId, 'U34722U');
  assert.equal(strictReady.categoryLink, null);

  const home = snapshots['home-misc-current'].products.important;
  assert.equal(home.manufacturer, 'AND');
  assert.equal(home.photoUrlPolicy, 'direct-lh3');
  assert.match(String(home.notes), /фото лише з цільової папки Google Drive/u);

  const pets = snapshots['pets-current'].products.important;
  assert.equal(pets.manufacturer, 'AND');
  assert.equal(typeof pets.productId, 'number');

  const hair = snapshots['bigdrop-hair'].products.important;
  assert.equal(hair.mpn, 'V-415');
  assert.equal(hair.photoCount, 5);
  assert.match(String(hair.titleRu), /Фен для волос/u);
  assert.match(String(hair.titleUa), /Фен для волосся/u);
});
