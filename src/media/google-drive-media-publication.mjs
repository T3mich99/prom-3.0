import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PHOTO_ROLE_ORDER } from '../photos/photo-contract.mjs';
import { loadGoogleDriveMediaConfig } from './google-drive-media-config.mjs';

export const DEFAULT_GOOGLE_DRIVE_MEDIA_CONFIG = Object.freeze({});

export const DRIVE_MEDIA_PUBLICATION_STATUSES = Object.freeze({
  TASK_READY: 'DRIVE_MEDIA_PUBLICATION',
  READY: 'READY',
  INVALID: 'INVALID',
  NEEDS_OPERATOR: 'NEEDS_OPERATOR',
});

const ROLE_FILE_SUFFIX = Object.freeze({
  hero: '01_main.png',
  usage: '02_usage.png',
  benefits: '03_benefits.png',
  feature: '04_feature.png',
  final: '05_final.png',
});

const ITEM_KEYS = new Set(['index', 'role', 'filename', 'fileId', 'sha256', 'publicUrl', 'localPath']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function nonEmpty(value) {
  return text(value).length > 0;
}

function resolvedConfig(override = {}, persisted = null) {
  if (!isRecord(override)) throw new TypeError('Drive media config must be an object');
  const result = { ...DEFAULT_GOOGLE_DRIVE_MEDIA_CONFIG, ...(persisted ?? {}), ...clone(override) };
  for (const key of ['rootFolderId', 'productImagesFolderId', 'finalExcelFolderId']) {
    if (!nonEmpty(result[key])) throw new TypeError(`Drive media config.${key} must be non-empty`);
  }
  return result;
}

function sourceFilename(sourceCode, index, role) {
  const code = text(sourceCode);
  if (!code || /[\\/:*?"<>|\s]/u.test(code)) throw new TypeError('sourceCode must be a filename-safe non-empty string');
  if (!Number.isSafeInteger(index) || index < 1 || index > PHOTO_ROLE_ORDER.length || PHOTO_ROLE_ORDER[index - 1] !== role) {
    throw new TypeError('photo index and role must match the canonical photo contract');
  }
  return `${code}_${ROLE_FILE_SUFFIX[role]}`;
}

function ensureWithinRoot(root, target) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new TypeError('media file must live under outputRoot');
  return targetPath;
}

async function fileSha256(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

export function expectedDriveFilename(sourceCode, index, role) {
  return sourceFilename(sourceCode, index, role);
}

export async function buildDriveMediaPublicationTask(input) {
  if (!isRecord(input)) throw new TypeError('Drive publication input must be an object');
  if (!nonEmpty(input.productKey) || !nonEmpty(input.sourceCode)) throw new TypeError('productKey and sourceCode are required');
  if (!nonEmpty(input.outputRoot)) throw new TypeError('outputRoot is required');
  if (!Array.isArray(input.files) || input.files.length !== PHOTO_ROLE_ORDER.length) throw new TypeError('exactly five local photo files are required');
  const persistedConfig = input.config ? null : await loadGoogleDriveMediaConfig({ dbPath: input.configDbPath });
  const config = resolvedConfig(input.config ?? {}, persistedConfig);
  const seen = new Set();
  const files = [];
  for (const [position, item] of input.files.entries()) {
    if (!isRecord(item) || !nonEmpty(item.path)) throw new TypeError(`files[${position}].path is required`);
    const index = item.index ?? position + 1;
    const role = item.role ?? PHOTO_ROLE_ORDER[position];
    const filePath = ensureWithinRoot(input.outputRoot, item.path);
    const filename = sourceFilename(input.sourceCode, index, role);
    if (seen.has(filename)) throw new TypeError('publication filenames must be unique');
    seen.add(filename);
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size === 0) throw new TypeError(`photo file is empty or not a file: ${filePath}`);
    files.push({ index, role, filename, localPath: filePath, sha256: await fileSha256(filePath), byteLength: stat.size });
  }
  return {
    status: DRIVE_MEDIA_PUBLICATION_STATUSES.TASK_READY,
    taskType: DRIVE_MEDIA_PUBLICATION_STATUSES.TASK_READY,
    taskVersion: 'drive-media-publication-v1',
    version: 1,
    productKey: input.productKey,
    sourceCode: input.sourceCode,
    destination: {
      rootFolderId: config.rootFolderId,
      productImagesFolderId: config.productImagesFolderId,
      productImagesFolderUrl: config.productImagesFolderUrl,
      permissions: 'operator must set public read only; no write permission changes are requested',
    },
    expectedNames: files.map((item) => item.filename),
    files,
    instructions: 'Upload these exact files to the configured product-images folder, preserve filenames, set public read access, then import file IDs, hashes, roles, and verified public HTTPS URLs.',
  };
}

function publicHttpsUrl(value) {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function expectedItems(sourceCode) {
  return PHOTO_ROLE_ORDER.map((role, index) => ({ index: index + 1, role, filename: sourceFilename(sourceCode, index + 1, role) }));
}

export async function validateDriveMediaPublicationArtifact(artifact, options = {}) {
  if (!isRecord(artifact)) throw new TypeError('publication artifact must be an object');
  for (const key of Object.keys(artifact)) {
    if (!['productKey', 'sourceCode', 'folderId', 'items'].includes(key)) throw new TypeError(`Unsupported publication artifact field: ${key}`);
  }
  if (!nonEmpty(artifact.productKey) || !nonEmpty(artifact.sourceCode) || !nonEmpty(artifact.folderId)) throw new TypeError('publication artifact identity is incomplete');
  if (!Array.isArray(artifact.items) || artifact.items.length !== PHOTO_ROLE_ORDER.length) throw new TypeError('publication artifact must contain exactly five items');
  const expected = expectedItems(artifact.sourceCode);
  const seenIds = new Set();
  const seenUrls = new Set();
  const items = [];
  for (const [position, item] of artifact.items.entries()) {
    if (!isRecord(item)) throw new TypeError(`publication artifact.items[${position}] must be an object`);
    for (const key of Object.keys(item)) if (!ITEM_KEYS.has(key)) throw new TypeError(`Unsupported publication item field: ${key}`);
    const expectedItem = expected[position];
    if (item.index !== expectedItem.index || item.role !== expectedItem.role || item.filename !== expectedItem.filename) throw new TypeError(`publication item ${position} does not match the canonical role/name mapping`);
    if (!nonEmpty(item.fileId) || seenIds.has(item.fileId)) throw new TypeError('published Drive file IDs must be unique and non-empty');
    if (!/^[a-f0-9]{64}$/u.test(text(item.sha256))) throw new TypeError('published item sha256 must be a lowercase hexadecimal SHA-256');
    if (!publicHttpsUrl(item.publicUrl) || seenUrls.has(item.publicUrl)) throw new TypeError('published publicUrl values must be unique absolute HTTPS URLs');
    if (typeof options.probe !== 'function') throw new TypeError('a public image probe is required to verify Drive URLs');
    const probe = await options.probe(item.publicUrl, clone(item));
    if (!isRecord(probe) || probe.ok !== true || !String(probe.contentType ?? '').toLocaleLowerCase('en-US').startsWith('image/')) throw new TypeError(`publicUrl was not verified as a public image: ${item.publicUrl}`);
    if (probe.sha256 !== undefined && probe.sha256 !== item.sha256) throw new TypeError(`publicUrl bytes do not match the published SHA-256: ${item.publicUrl}`);
    seenIds.add(item.fileId);
    seenUrls.add(item.publicUrl);
    items.push({ index: item.index, role: item.role, filename: item.filename, fileId: item.fileId, sha256: item.sha256, publicUrl: item.publicUrl });
  }
  return { status: DRIVE_MEDIA_PUBLICATION_STATUSES.READY, productKey: artifact.productKey, sourceCode: artifact.sourceCode, folderId: artifact.folderId, items };
}

export async function toPublishableMediaArtifact(artifact, options = {}) {
  const verified = await validateDriveMediaPublicationArtifact(artifact, options);
  const approved = options.approvedMedia;
  if (!isRecord(approved) || approved.productKey !== verified.productKey || !Array.isArray(approved.photos) || approved.photos.length !== 5
    || new Set(approved.photos.map((photo) => photo.index)).size !== 5) throw new TypeError('Matching approved local media with five unique indexes is required');
  const items = [];
  for (const item of verified.items) {
    const local = approved.photos.find((photo) => photo.index === item.index);
    if (!local || typeof local.assetRef !== 'string' || !path.isAbsolute(local.assetRef)) throw new TypeError('Approved media requires the absolute local image path');
    if (await fileSha256(local.assetRef) !== item.sha256) throw new TypeError('Published bytes do not match the approved local photo');
    items.push({ index: item.index, role: item.role, approvedAssetRef: local.assetRef, sha256: item.sha256, publicUrl: item.publicUrl });
  }
  return {
    productKey: verified.productKey,
    version: 1,
    items,
  };
}

export function publicPhotoUrlList(publishableMedia) {
  if (!isRecord(publishableMedia) || !Array.isArray(publishableMedia.items) || publishableMedia.items.length !== 5) throw new TypeError('publishable media must contain exactly five items');
  const urls = publishableMedia.items.map((item) => item.publicUrl);
  if (urls.some((url) => !publicHttpsUrl(url)) || new Set(urls).size !== urls.length) throw new TypeError('publishable media contains invalid or duplicate public URLs');
  return urls.join(', ');
}
