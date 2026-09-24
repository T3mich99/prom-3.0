import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { probePublicImage, runMediaImportCli } from '../../src/cli/category-media-import.mjs';
import { validatePublishableMedia } from '../../src/excel/final-product-excel-bridge.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildDriveMediaPublicationTask,
  cleanupPublishedLocalPhotoFiles,
  expectedDriveFilename,
  LOCAL_PHOTO_LIFECYCLE,
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
  const legacyUrlArtifact = structuredClone(artifact);
  legacyUrlArtifact.items[0].publicUrl = 'https://drive.google.com/uc?export=view&id=drive-file-1';
  const normalizedLegacy = await validateDriveMediaPublicationArtifact(legacyUrlArtifact, { probe });
  assert.equal(normalizedLegacy.items[0].publicUrl, 'https://lh3.googleusercontent.com/d/drive-file-1=w1280');
  const approvedMedia = { productKey: artifact.productKey, version: 1, photos: [] };
  for (const item of items) {
    const assetRef = path.join(root, item.filename);
    await fs.writeFile(assetRef, Buffer.from(`png-${item.index}`));
    approvedMedia.photos.push({ index: item.index, assetRef, width: 1280, height: 1280, format: 'png' });
  }
  const publishable = await toPublishableMediaArtifact(artifact, { probe, approvedMedia });
  assert.equal(validatePublishableMedia({ productKey: artifact.productKey, approvedMedia, publishableMedia: publishable }).items.length, 5);
  assert.deepEqual(publishable.verification, {
    status: 'PUBLIC_IMAGE_SHA256_VERIFIED',
    verifier: 'category:media',
    urlPolicy: 'lh3-googleusercontent-v1',
  });
  assert.equal(publishable.items[0].fileId, 'drive-file-1');
  assert.equal(publishable.items[0].publicUrl, 'https://lh3.googleusercontent.com/d/drive-file-1=w1280');
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

test('removes only the verified local files for the matching product after Drive publication', async (t) => {
  const root = await makeTempDir();
  t.after(() => cleanupTempDir(root));
  const items = Array.from({ length: 5 }, (_, index) => {
    const bytes = Buffer.from(`verified-${index + 1}`);
    const assetRef = path.join(root, `product-U123U-${index + 1}.png`);
    return {
      index: index + 1,
      role: ['hero', 'usage', 'benefits', 'feature', 'final'][index],
      filename: expectedDriveFilename('U123U', index + 1, ['hero', 'usage', 'benefits', 'feature', 'final'][index]),
      fileId: `cleanup-drive-file-${index + 1}`,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      publicUrl: `https://lh3.googleusercontent.com/d/cleanup-drive-file-${index + 1}=w1280`,
      bytes,
      assetRef,
    };
  });
  const publication = {
    productKey: 'ugopt:cleanup', sourceCode: 'U123U', folderId: 'images-pr29',
    access: { permissionType: 'anyone', role: 'reader', allowFileDiscovery: false },
    items: items.map(({ bytes, assetRef, ...item }) => item),
  };
  const approvedMedia = { productKey: publication.productKey, photos: [] };
  for (const item of items) {
    await fs.writeFile(item.assetRef, item.bytes);
    approvedMedia.photos.push({ index: item.index, role: item.role, assetRef: item.assetRef });
  }
  const probe = async (url, item) => ({ ok: true, contentType: 'image/png', sha256: item.sha256, url });
  const publishableMedia = await toPublishableMediaArtifact(publication, { probe, approvedMedia });
  const cleanup = await cleanupPublishedLocalPhotoFiles({ publication, approvedMedia, publishableMedia, protectedPaths: [path.join(root, 'request.json')] });
  const publishableAfterCleanup = { ...publishableMedia, cleanup };
  assert.equal(validatePublishableMedia({ productKey: publication.productKey, approvedMedia, publishableMedia: publishableAfterCleanup }).items.length, 5);
  assert.deepEqual(cleanup, {
    ...LOCAL_PHOTO_LIFECYCLE,
    status: 'LOCAL_FILES_REMOVED',
    productKey: publication.productKey,
    sourceCode: publication.sourceCode,
    items: items.map((item) => ({ index: item.index, role: item.role, sha256: item.sha256 })),
  });
  assert.equal((await Promise.all(items.map((item) => fs.access(item.assetRef).then(() => true).catch(() => false)))).some(Boolean), false);
});

test('refuses local cleanup when the five product paths are mixed or reused', async (t) => {
  const root = await makeTempDir();
  t.after(() => cleanupTempDir(root));
  const assetRef = path.join(root, 'same.png');
  await fs.writeFile(assetRef, Buffer.from('same'));
  const sha256 = crypto.createHash('sha256').update('same').digest('hex');
  const publication = { productKey: 'ugopt:mixed', sourceCode: 'U123U', folderId: 'images-pr29', access: { permissionType: 'anyone', role: 'reader', allowFileDiscovery: false }, items: [1, 2, 3, 4, 5].map((index) => ({ index, role: ['hero', 'usage', 'benefits', 'feature', 'final'][index - 1], filename: expectedDriveFilename('U123U', index, ['hero', 'usage', 'benefits', 'feature', 'final'][index - 1]), fileId: `mixed-${index}`, sha256, publicUrl: `https://lh3.googleusercontent.com/d/mixed-${index}=w1280` })) };
  const approvedMedia = { productKey: publication.productKey, photos: [1, 2, 3, 4, 5].map((index) => ({ index, assetRef })) };
  const publishableMedia = await toPublishableMediaArtifact(publication, { probe: async (url, item) => ({ ok: true, contentType: 'image/png', sha256: item.sha256, url }), approvedMedia });
  await assert.rejects(() => cleanupPublishedLocalPhotoFiles({ publication, approvedMedia, publishableMedia }), /unique per product/u);
  assert.equal(await fs.access(assetRef).then(() => true).catch(() => false), true);
});

test('category:media writes a cleanup proof and removes local bytes after all public probes', async (t) => {
  const root = await makeTempDir();
  t.after(() => cleanupTempDir(root));
  const files = [];
  const items = [];
  for (let index = 1; index <= 5; index += 1) {
    const bytes = Buffer.from(`cli-verified-${index}`);
    const assetRef = path.join(root, `cli-product-${index}.png`);
    await fs.writeFile(assetRef, bytes);
    const role = ['hero', 'usage', 'benefits', 'feature', 'final'][index - 1];
    const fileId = `cli-drive-file-${index}`;
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    files.push({ index, assetRef, bytes, role });
    items.push({ index, role, filename: expectedDriveFilename('U123U', index, role), fileId, sha256, publicUrl: `https://lh3.googleusercontent.com/d/${fileId}=w1280` });
  }
  const publication = {
    productKey: 'ugopt:cli-cleanup', sourceCode: 'U123U', folderId: '1quplTV97b3geOQu5dn_AJXFLYbEmcNpN',
    access: { permissionType: 'anyone', role: 'reader', allowFileDiscovery: false }, items,
  };
  const approvedMedia = { productKey: publication.productKey, photos: files.map(({ index, assetRef, role }) => ({ index, role, assetRef })) };
  const inputPath = path.join(root, 'publication.json');
  const outputPath = path.join(root, 'publishable-media.json');
  await fs.writeFile(inputPath, JSON.stringify({ publication, approvedMedia }));
  const result = await runMediaImportCli(['--input', inputPath, '--output', outputPath], {
    fetchImpl: async (url) => {
      const index = Number(url.match(/cli-drive-file-(\d+)/u)?.[1]);
      return new Response(Buffer.from(`cli-verified-${index}`), { headers: { 'content-type': 'image/png' } });
    },
  });
  assert.equal(result.cleanup.status, 'LOCAL_FILES_REMOVED');
  assert.equal((await Promise.all(files.map((file) => fs.access(file.assetRef).then(() => true).catch(() => false)))).some(Boolean), false);
  assert.deepEqual(JSON.parse(await fs.readFile(outputPath, 'utf8')).cleanup, result.cleanup);
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
