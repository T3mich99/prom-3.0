import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { probePublicImage } from '../../src/cli/category-media-import.mjs';
import { validatePublishableMedia } from '../../src/excel/final-product-excel-bridge.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildDriveMediaPublicationTask,
  expectedDriveFilename,
  publicPhotoUrlList,
  toPublishableMediaArtifact,
  validateDriveMediaPublicationArtifact,
} from '../../src/media/google-drive-media-publication.mjs';
import { loadGoogleDriveMediaConfig, saveGoogleDriveMediaConfig } from '../../src/media/google-drive-media-config.mjs';
import { cleanupTempDir, makeTempDir } from '../excel/support.mjs';

const driveConfig = {
  rootFolderId: 'root-pr29',
  productImagesFolderId: 'images-pr29',
  finalExcelFolderId: 'excel-pr29',
};

test('builds a deterministic operator task with five hashed role files', async (t) => {
  const root = await makeTempDir();
  t.after(() => cleanupTempDir(root));
  const files = [];
  for (let index = 1; index <= 5; index += 1) {
    const filePath = path.join(root, `generated-${index}.png`);
    await fs.writeFile(filePath, Buffer.from(`png-${index}`));
    files.push({ path: filePath });
  }
  const task = await buildDriveMediaPublicationTask({ productKey: 'ugopt:123', sourceCode: 'U123U', outputRoot: root, files, config: driveConfig });
  assert.equal(task.status, 'DRIVE_MEDIA_PUBLICATION');
  assert.equal(task.destination.productImagesFolderId, driveConfig.productImagesFolderId);
  assert.deepEqual(task.expectedNames, [1, 2, 3, 4, 5].map((index) => expectedDriveFilename('U123U', index, ['hero', 'usage', 'benefits', 'feature', 'final'][index - 1])));
  assert.equal(new Set(task.files.map((item) => item.sha256)).size, 5);
  assert.equal(task.files.every((item) => item.localPath.startsWith(path.resolve(root))), true);
});

test('loads persisted Drive destinations and allows an explicit override', async (t) => {
  const root = await makeTempDir();
  t.after(() => cleanupTempDir(root));
  const dbPath = path.join(root, 'config.sqlite');
  const saved = await saveGoogleDriveMediaConfig({ dbPath, config: driveConfig });
  const loaded = await loadGoogleDriveMediaConfig({ dbPath });
  assert.equal(loaded.productImagesFolderId, driveConfig.productImagesFolderId);
  assert.equal(loaded.finalExcelFolderUrl, 'https://drive.google.com/drive/folders/excel-pr29');
  assert.equal(saved.dbPath, path.resolve(dbPath));
  const filePath = path.join(root, 'one.png');
  await fs.writeFile(filePath, Buffer.from('png'));
  const files = Array.from({ length: 5 }, (_, index) => ({ path: index === 0 ? filePath : filePath, index: index + 1, role: ['hero', 'usage', 'benefits', 'feature', 'final'][index] }));
  const task = await buildDriveMediaPublicationTask({ productKey: 'p', sourceCode: 'U1U', outputRoot: root, files, configDbPath: dbPath });
  assert.equal(task.destination.productImagesFolderId, driveConfig.productImagesFolderId);
  const override = await buildDriveMediaPublicationTask({ productKey: 'p', sourceCode: 'U1U', outputRoot: root, files, config: { ...driveConfig, productImagesFolderId: 'override-images' } });
  assert.equal(override.destination.productImagesFolderId, 'override-images');
});

test('accepts only a complete verified Drive publication artifact and preserves local provenance into Prom', async (t) => {
  const root = await makeTempDir();
  t.after(() => cleanupTempDir(root));
  const items = Array.from({ length: 5 }, (_, index) => {
    const sha256 = crypto.createHash('sha256').update(`png-${index + 1}`).digest('hex');
    return {
      index: index + 1,
      role: ['hero', 'usage', 'benefits', 'feature', 'final'][index],
      filename: expectedDriveFilename('U123U', index + 1, ['hero', 'usage', 'benefits', 'feature', 'final'][index]),
      fileId: `drive-file-${index + 1}`,
      sha256,
      publicUrl: `https://lh3.googleusercontent.com/d/drive-file-${index + 1}=w1280`,
    };
  });
  const artifact = { productKey: 'ugopt:123', sourceCode: 'U123U', folderId: 'folder-1', access: { permissionType: 'anyone', role: 'reader', allowFileDiscovery: false }, items };
  const probe = async (url, item) => ({ ok: true, contentType: 'image/png', sha256: item.sha256, url });
  const verified = await validateDriveMediaPublicationArtifact(artifact, {
    probe,
  });
  const approvedMedia = { productKey: artifact.productKey, version: 1, photos: [] };
  for (const item of items) {
    const assetRef = path.join(root, item.filename);
    await fs.writeFile(assetRef, Buffer.from(`png-${item.index}`));
    approvedMedia.photos.push({ index: item.index, assetRef, width: 1280, height: 1280, format: 'png' });
  }
  const publishable = await toPublishableMediaArtifact(artifact, { probe, approvedMedia });
  assert.equal(validatePublishableMedia({ productKey: artifact.productKey, approvedMedia, publishableMedia: publishable }).items.length, 5);
  await assert.rejects(() => toPublishableMediaArtifact(artifact, { probe }), /approved local media/);
  await fs.writeFile(approvedMedia.photos[0].assetRef, Buffer.from('different-image'));
  await assert.rejects(() => toPublishableMediaArtifact(artifact, { probe, approvedMedia }), /do not match/);
  assert.equal(verified.status, 'READY');
  assert.equal(publishable.items.length, 5);
  assert.equal(publishable.items[2].approvedAssetRef, approvedMedia.photos[2].assetRef);
  assert.equal(publicPhotoUrlList(publishable), items.map((item) => item.publicUrl).join(', '));
  const invalid = structuredClone(artifact);
  invalid.items[4].publicUrl = invalid.items[0].publicUrl;
  await assert.rejects(() => validateDriveMediaPublicationArtifact(invalid, { probe }), /unique/u);
  await assert.rejects(() => validateDriveMediaPublicationArtifact(artifact), /probe/u);
  await assert.rejects(() => validateDriveMediaPublicationArtifact({ ...artifact, access: { permissionType: 'anyone', role: 'writer', allowFileDiscovery: false } }, { probe }), /writer access is forbidden/u);
});

test('publication task refuses files outside the injected output root', async (t) => {
  const root = await makeTempDir();
  t.after(() => cleanupTempDir(root));
  const outside = path.join(path.dirname(root), 'outside-pr29.png');
  await fs.writeFile(outside, Buffer.from('png'));
  const files = Array.from({ length: 5 }, (_, index) => ({ path: index === 0 ? outside : path.join(root, `missing-${index}.png`) }));
  await assert.rejects(() => buildDriveMediaPublicationTask({ productKey: 'p', sourceCode: 'U1U', outputRoot: root, files, config: driveConfig }), /outputRoot/u);
  await fs.rm(outside, { force: true });
});


test('public image probe rejects login HTML and reads image bytes without credentials', async () => {
  const url = 'https://drive.google.com/uc?export=download&id=test';
  const html = await probePublicImage(url, { fetchImpl: async (_, options) => {
    assert.equal(options.credentials, 'omit');
    return new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } });
  } });
  assert.equal(html.ok, false);
  const image = await probePublicImage(url, { fetchImpl: async () => new Response(Buffer.from('image-bytes'), { headers: { 'content-type': 'image/png' } }) });
  assert.equal(image.sha256, crypto.createHash('sha256').update('image-bytes').digest('hex'));
  await assert.rejects(() => probePublicImage('https://localhost/private'), /Google Drive/);
});
