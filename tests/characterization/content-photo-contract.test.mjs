import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { assertSource, countPhrases, directDriveUrl, evaluateExpression, extractArrowExpression, readProduction, repoPath, PHOTO_ROLES } from './support.mjs';

const fixture = JSON.parse(await fs.readFile(repoPath('tests', 'fixtures', 'product-fixture.json'), 'utf8'));
const photoFixture = JSON.parse(await fs.readFile(repoPath('tests', 'fixtures', 'photo-manifest-complete.json'), 'utf8'));
const incompletePhotoFixture = JSON.parse(await fs.readFile(repoPath('tests', 'fixtures', 'photo-manifest-incomplete.json'), 'utf8'));

const contentSource = await readProduction('excel-work/enrich-prom-sales-content.mjs');
const v3Source = await readProduction('excel-work/build-prom-v3-final.mjs');
const homeSource = await readProduction('excel-work/build-home-misc-next-100-prom-final.mjs');
const currentDriveSource = await readProduction('excel-work/build-final-with-current-drive-photos.mjs');
const photoSpec = await fs.readFile(repoPath('PHOTO-MASTER-SPEC.md'), 'utf8');

test('keyword fixtures preserve separate RU and UA lists with at least 25 phrases', () => {
  const ru = fixture.keywords.ru.join(', ');
  const ua = fixture.keywords.ua.join(', ');
  assert.equal(countPhrases(ru), 25);
  assert.equal(countPhrases(ua), 25);
  assert.ok(ru.length <= 1024);
  assert.ok(ua.length <= 1024);
  assert.match(ru, /кухни/u);
  assert.match(ua, /кухні/u);
  assertSource(contentSource, /const buy = ua \? 'купити' : 'купить'/u, 'language-specific keyword branches remain protected');
  assertSource(contentSource, /const delivery = ua \? 'з доставкою' : 'с доставкой'/u, 'language-specific keyword branches remain protected');
});

test('content contract preserves HTML limits used by strict export', () => {
  assert.ok(fixture.html.ru.length <= 250);
  assert.ok(fixture.html.ua.length <= 270);
  assertSource(v3Source, /htmlRuWithin250/u, 'Russian HTML limit check remains in strict export');
  assertSource(v3Source, /htmlUaWithin270/u, 'Ukrainian HTML limit check remains in strict export');
  assert.equal('<p>x</p>'.repeat(32).length > 250, true);
  assert.equal('<p>х</p>'.repeat(35).length > 270, true);
});

test('manufacturer fallback preserves unknown-to-AND and known-value behavior', () => {
  const clean = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const manufacturer = (existing, source) => clean(existing) || clean(source) || 'AND';
  assert.equal(manufacturer('', ''), 'AND');
  assert.equal(manufacturer('', 'VGR'), 'VGR');
  assert.equal(manufacturer('Sokany', 'VGR'), 'Sokany');
  assertSource(v3Source, /nonblank\(sourceManufacturer\) \? clean\(sourceManufacturer\) : 'AND'/u, 'strict manufacturer fallback remains protected');
});

test('retail-only contract preserves blank wholesale fields', () => {
  const row = { wholesalePrice: null, wholesaleMinimum: null };
  assert.equal(Boolean(row.wholesalePrice) || Boolean(row.wholesaleMinimum), false);
  assertSource(v3Source, /row\[ix\['Оптова_ціна'\]\] = null/u, 'retail-only wholesale price clearing remains protected');
  assertSource(v3Source, /row\[ix\['Мінімальне_замовлення_опт'\]\] = null/u, 'retail-only wholesale minimum clearing remains protected');
});

const driveUrlSource = extractArrowExpression(homeSource, 'drivePublicUrl');
const drivePublicUrl = evaluateExpression(driveUrlSource);

test('photo contract preserves exact five-role ordering and direct Drive URL shape', () => {
  assert.deepEqual(PHOTO_ROLES, ['01_main', '02_benefits', '03_features', '04_use', '05_details']);
  const links = PHOTO_ROLES.map((role) => directDriveUrl(photoFixture.assets[role].id));
  assert.equal(links.length, 5);
  assert.deepEqual(links.map((url) => url.split('/d/')[1].split('=')[0]), ['fixture-main', 'fixture-benefits', 'fixture-features', 'fixture-use', 'fixture-details']);
  assert.equal(drivePublicUrl({ id: 'fixture-main' }), 'https://lh3.googleusercontent.com/d/fixture-main=w1280');
  assert.equal(drivePublicUrl(null), '');
  assertSource(homeSource, /const roles = \['01_main', '02_benefits', '03_features', '04_use', '05_details'\]/u, 'five-role order remains protected');
  assertSource(homeSource, /lh3\.googleusercontent\.com\/d\/\$\{item\.id\}=w1280/u, 'direct Drive URL shape remains protected');
});

test('photo contract preserves strict incomplete-set exclusion', () => {
  const completeLinks = PHOTO_ROLES.map((role) => incompletePhotoFixture.assets[role]?.id).filter(Boolean);
  assert.equal(completeLinks.length, 3);
  assert.equal(completeLinks.length === 5, false);
  assertSource(v3Source, /if \(missingRoles\.length\)/u, 'strict builder still excludes incomplete photo sets');
  assertSource(v3Source, /No products with all five new Drive photos/u, 'strict builder still blocks an empty complete set');
});

test('photo metadata fixture preserves 1280 PNG and generated/current provenance checks', () => {
  for (const role of PHOTO_ROLES) {
    const asset = photoFixture.assets[role];
    assert.equal(asset.width, 1280);
    assert.equal(asset.height, 1280);
    assert.equal(asset.mime, 'image/png');
    assert.equal(asset.provenance, 'generated');
    assert.equal(asset.isCurrent, true);
  }
  assert.match(photoSpec, /docs\/PHOTO_PRODUCTION_CONTRACT\.md/u);
  assert.match(photoSpec, /config\/photo-styles\.json/u);
  assert.match(photoSpec, /preserve the genuine brand/u);
});

test('current-drive builder preserves fallback-to-source behavior as a documented conflict', () => {
  const ai = [directDriveUrl('ai-1'), '', directDriveUrl('ai-3')];
  const source = ['source-1.png', 'source-2.png', 'source-3.png'];
  const links = ai.map((url, index) => url || source[index]).filter(Boolean);
  assert.deepEqual(links, [directDriveUrl('ai-1'), 'source-2.png', directDriveUrl('ai-3')]);
  assertSource(currentDriveSource, /ai\.map\(\(url, index\) => url \|\| sourceLinks\[index\]\)\.filter\(Boolean\)/u, 'fallback behavior is intentionally characterized');
});

test('legacy final builder preserves old/supplier fallback and link padding behavior', async () => {
  const source = await readProduction('excel-work/build-prom-final-2026-09-01.mjs');
  assertSource(source, /const oldDriveMapPath = process\.argv\[5\]/u, 'old Drive map input remains characterized');
  assertSource(source, /const old = oldDrive\[name\]/u, 'old photo fallback remains characterized');
  assertSource(source, /const original = sourceImage\(p, i\)/u, 'supplier image fallback remains characterized');
  assertSource(source, /while \(links\.length < 5 && last\)/u, 'five-link padding remains characterized');
});
