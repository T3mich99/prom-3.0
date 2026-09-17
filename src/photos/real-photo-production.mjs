import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import { PHOTO_STATUSES, assetReference, isAcceptedPhotoDimensions, isRecordValue, resolvePhotoQualityPolicy, sameJson } from './photo-contract.mjs';
import { generatePlannedPhotoArtifacts, PhotoGenerationError } from './photo-generation-adapter.mjs';
import { validatePhotoProductionPlan } from './photo-production-plan.mjs';
import { validatePhotoArtifacts } from './photo-quality.mjs';

const OPTIONS = new Set(['provider', 'outputRoot', 'policy']);
const REWORK_INPUT_KEYS = new Set(['plan', 'artifacts', 'quality', 'sourceFacts', 'visualQa']);
const REWORK_OPTIONS = new Set(['provider', 'outputRoot', 'policy']);
const PROVIDER_RESPONSE_KEYS = new Set(['bytes', 'temporaryUrl', 'mimeType', 'providerArtifactId']);
const PHOTO_FILENAMES = Object.freeze({
  hero: '01-hero.png',
  usage: '02-usage.png',
  benefits: '03-benefits.png',
  feature: '04-feature.png',
  final: '05-final.png',
});

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function assertRecord(value, label) {
  if (!isRecordValue(value)) throw new TypeError(`${label} must be an object`);
}

function clone(value) {
  return structuredClone(value);
}

function assertOptions(options, allowed, label) {
  assertRecord(options, label);
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new TypeError(`Unsupported ${label} option: ${key}`);
  if (!isRecordValue(options.provider) || typeof options.provider.generateImage !== 'function') {
    throw new TypeError(`${label}.provider.generateImage must be a function`);
  }
  if (typeof options.outputRoot !== 'string' || !options.outputRoot.trim()) throw new TypeError(`${label}.outputRoot must be a non-empty string`);
  return resolvePhotoQualityPolicy(options.policy ?? {});
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Text(value) {
  return sha256(Buffer.from(value, 'utf8'));
}

function toBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return null;
}

function crc32(value) {
  let result = 0xffffffff;
  for (const byte of value) result = CRC_TABLE[(result ^ byte) & 0xff] ^ (result >>> 8);
  return (result ^ 0xffffffff) >>> 0;
}

function chunkCrc(type, data) {
  const payload = Buffer.allocUnsafe(4 + data.length);
  payload.write(type, 0, 4, 'ascii');
  data.copy(payload, 4);
  return crc32(payload);
}

function pngError(message, details = undefined, cause = undefined) {
  const error = new RealPhotoProductionError(message, 'PHOTO_PNG_INVALID', details, cause);
  return error;
}

/**
 * Validate a PNG byte payload using its signature, chunk CRCs, IHDR, and
 * decompressed scanline structure. This is technical byte validation only;
 * it is deliberately not OCR or pixel-level product-fidelity inspection.
 */
export function inspectPngBytes(value) {
  const bytes = toBytes(value);
  if (!bytes || bytes.length === 0) throw pngError('Generated image bytes are missing or empty');
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < signature.length || !bytes.subarray(0, 8).equals(signature)) throw pngError('Generated image is not a PNG');

  let offset = 8;
  let width;
  let height;
  let colorType;
  let bitDepth;
  let interlace;
  let hasIdat = false;
  let hasIend = false;
  let hasPalette = false;
  const idat = [];

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw pngError('PNG chunk is truncated');
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (dataEnd > bytes.length || crcEnd > bytes.length) throw pngError('PNG chunk exceeds the byte payload');
    const data = bytes.subarray(dataStart, dataEnd);
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    if (chunkCrc(type, data) !== expectedCrc) throw pngError(`PNG ${type} chunk CRC is invalid`);
    if (offset === 8 && type !== 'IHDR') throw pngError('PNG must begin with IHDR');

    if (type === 'IHDR') {
      if (width !== undefined || length !== 13) throw pngError('PNG IHDR chunk is invalid');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (width === 0 || height === 0) throw pngError('PNG dimensions must be positive');
      if (data[10] !== 0 || data[11] !== 0) throw pngError('PNG uses unsupported compression or filter method');
      interlace = data[12];
      if (interlace !== 0) throw pngError('Interlaced PNGs are not supported by the byte validator');
      if (bitDepth !== 8 || ![0, 2, 3, 4, 6].includes(colorType)) throw pngError('PNG bit depth or color type is unsupported');
    } else if (type === 'PLTE') {
      hasPalette = true;
    } else if (type === 'IDAT') {
      hasIdat = true;
      idat.push(data);
    } else if (type === 'IEND') {
      if (length !== 0 || !hasIdat) throw pngError('PNG IEND or IDAT structure is invalid');
      hasIend = true;
      offset = crcEnd;
      break;
    }
    offset = crcEnd;
  }

  if (!hasIend || offset !== bytes.length || width === undefined || !hasIdat) throw pngError('PNG is missing a complete image structure');
  if (colorType === 3 && !hasPalette) throw pngError('Palette PNG is missing PLTE');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const rowBytes = width * channels;
  const expectedInflatedBytes = (rowBytes + 1) * height;
  if (!Number.isSafeInteger(rowBytes) || !Number.isSafeInteger(expectedInflatedBytes)) throw pngError('PNG dimensions exceed safe validation limits');
  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(idat));
  } catch (error) {
    throw pngError('PNG image data cannot be decompressed', undefined, error);
  }
  if (inflated.length !== expectedInflatedBytes) throw pngError('PNG scanline data length is invalid');
  for (let row = 0; row < height; row += 1) {
    if (inflated[row * (rowBytes + 1)] > 4) throw pngError('PNG scanline filter is invalid');
  }
  return {
    width,
    height,
    format: 'png',
    size: bytes.length,
    hash: sha256(bytes),
  };
}

async function inspectPngFile(filePath) {
  try {
    const bytes = await fs.readFile(filePath);
    return { ...inspectPngBytes(bytes), path: filePath };
  } catch (error) {
    if (error instanceof RealPhotoProductionError) return { path: filePath, error };
    if (error?.code === 'ENOENT') return { path: filePath, error: new RealPhotoProductionError('Generated image file does not exist', 'PHOTO_FILE_MISSING') };
    return { path: filePath, error: new RealPhotoProductionError('Generated image file cannot be read', 'PHOTO_FILE_UNREADABLE', undefined, error) };
  }
}

function safeFolderName(productKey) {
  return `product-${sha256Text(productKey)}`;
}

function productFolder(outputRoot, productKey) {
  return path.join(path.resolve(outputRoot), safeFolderName(productKey));
}

function photoPath(folder, photo) {
  const filename = PHOTO_FILENAMES[photo.role];
  if (!filename) throw new TypeError(`Unknown photo role: ${photo.role}`);
  return path.join(folder, filename);
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function normalizeProviderResponse(raw) {
  assertRecord(raw, 'photo provider response');
  for (const key of Object.keys(raw)) if (!PROVIDER_RESPONSE_KEYS.has(key)) throw new RealPhotoProductionError(`Unsupported photo provider response field: ${key}`, 'PHOTO_PROVIDER_RESPONSE_INVALID');
  const hasBytes = Object.prototype.hasOwnProperty.call(raw, 'bytes');
  const hasTemporaryUrl = Object.prototype.hasOwnProperty.call(raw, 'temporaryUrl');
  if (Number(hasBytes) + Number(hasTemporaryUrl) !== 1) throw new RealPhotoProductionError('Photo provider must return exactly one of bytes or temporaryUrl', 'PHOTO_PROVIDER_RESPONSE_INVALID');
  let bytes;
  if (hasBytes) {
    bytes = toBytes(raw.bytes);
    if (!bytes) throw new RealPhotoProductionError('Photo provider bytes must be a Buffer or Uint8Array', 'PHOTO_PROVIDER_RESPONSE_INVALID');
    if (raw.mimeType !== 'image/png') throw new RealPhotoProductionError('Photo provider must return image/png bytes', 'PHOTO_PROVIDER_RESPONSE_INVALID');
  } else {
    if (typeof raw.temporaryUrl !== 'string' || !raw.temporaryUrl.trim()) throw new RealPhotoProductionError('temporaryUrl must be a non-empty string', 'PHOTO_PROVIDER_RESPONSE_INVALID');
    let url;
    try {
      url = new URL(raw.temporaryUrl);
    } catch (error) {
      throw new RealPhotoProductionError('temporaryUrl must be a valid URL', 'PHOTO_PROVIDER_RESPONSE_INVALID', undefined, error);
    }
    if (!['data:', 'http:', 'https:'].includes(url.protocol)) throw new RealPhotoProductionError('temporaryUrl must use data, http, or https', 'PHOTO_PROVIDER_RESPONSE_INVALID');
    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new RealPhotoProductionError('temporaryUrl could not be downloaded', 'PHOTO_FILE_DOWNLOAD_FAILED', undefined, error);
    }
    if (!response.ok) throw new RealPhotoProductionError(`temporaryUrl returned HTTP ${response.status}`, 'PHOTO_FILE_DOWNLOAD_FAILED');
    const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
    if (raw.mimeType !== undefined && raw.mimeType !== 'image/png') throw new RealPhotoProductionError('Photo provider temporaryUrl mimeType must be image/png', 'PHOTO_PROVIDER_RESPONSE_INVALID');
    if (contentType && contentType !== 'image/png') throw new RealPhotoProductionError('temporaryUrl must return image/png', 'PHOTO_FILE_DOWNLOAD_FAILED');
    try {
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      throw new RealPhotoProductionError('temporaryUrl response could not be read', 'PHOTO_FILE_DOWNLOAD_FAILED', undefined, error);
    }
  }
  if (raw.providerArtifactId !== undefined && (typeof raw.providerArtifactId !== 'string' || !raw.providerArtifactId.trim())) {
    throw new RealPhotoProductionError('providerArtifactId must be a non-empty string', 'PHOTO_PROVIDER_RESPONSE_INVALID');
  }
  return { bytes, providerArtifactId: raw.providerArtifactId };
}

function technicalIssue(photoIndex, code) {
  return { photoIndex, code };
}

function applyTechnicalIssues(quality, issues) {
  if (issues.length === 0) return quality;
  const result = clone(quality);
  for (const item of issues) {
    const report = result.photos.find((candidate) => candidate.photoIndex === item.photoIndex);
    if (!report) continue;
    if (!report.reasonCodes.includes(item.code)) report.reasonCodes.push(item.code);
    report.status = PHOTO_STATUSES.REWORK;
  }
  result.status = PHOTO_STATUSES.REWORK;
  result.reworkPlan = {
    photos: result.photos
      .filter((report) => report.status !== PHOTO_STATUSES.READY)
      .map((report) => ({ photoIndex: report.photoIndex, reasonCodes: [...report.reasonCodes] })),
  };
  result.summary = {
    ...result.summary,
    readyPhotoCount: result.photos.filter((report) => report.status === PHOTO_STATUSES.READY).length,
    reviewPhotoCount: result.photos.filter((report) => report.status === PHOTO_STATUSES.REVIEW).length,
    reworkPhotoCount: result.photos.filter((report) => report.status === PHOTO_STATUSES.REWORK).length,
  };
  delete result.approvedMediaArtifact;
  return result;
}

function artifactWithFile(plan, photo, file, providerArtifactId = undefined) {
  const artifact = {
    productKey: plan.productKey,
    photoIndex: photo.index,
    role: photo.role,
    asset: {
      path: file.path,
      width: file.width ?? 0,
      height: file.height ?? 0,
      format: 'png',
    },
    claimsUsed: clone(photo.verifiedClaims),
    sourceImageRefs: clone(photo.sourceImageRefs),
    text: clone(photo.text),
  };
  if (file.hash) artifact.hash = file.hash;
  if (providerArtifactId !== undefined) artifact.providerArtifactId = providerArtifactId;
  return artifact;
}

async function writeStagedPhoto(plan, photo, provider, stageDir, policy, sourceFacts, usedPoseContext = undefined) {
  const issues = [];
  try {
    const [artifact] = await generatePlannedPhotoArtifacts(plan, [photo], {
      policy,
      sourceFacts,
      ...(usedPoseContext === undefined ? {} : { usedPoseContext }),
      generator: async (request) => {
        let providerResponse;
        try {
          providerResponse = await provider.generateImage({
            ...request,
            outputRequirements: { width: 1280, height: 1280, format: 'png' },
          });
        } catch (error) {
          throw new RealPhotoProductionError('Real photo provider failed', 'PHOTO_PROVIDER_FAILURE', { photoIndex: photo.index }, error);
        }
        let normalized;
        try {
          normalized = await normalizeProviderResponse(providerResponse);
        } catch (error) {
          if (error instanceof RealPhotoProductionError) throw error;
          throw new RealPhotoProductionError(error.message, 'PHOTO_PROVIDER_RESPONSE_INVALID', undefined, error);
        }

        const filename = PHOTO_FILENAMES[photo.role];
        const finalStagePath = path.join(stageDir, filename);
        const partPath = path.join(stageDir, `.${filename}.part`);
        try {
          await fs.writeFile(partPath, normalized.bytes, { flag: 'wx' });
          await fs.rename(partPath, finalStagePath);
        } catch (error) {
          await fs.rm(partPath, { force: true });
          throw new RealPhotoProductionError('Staged image could not be atomically finalized', 'PHOTO_FILE_WRITE_FAILED', { photoIndex: photo.index }, error);
        }
        const inspected = await inspectPngFile(finalStagePath);
        if (inspected.error) issues.push(technicalIssue(photo.index, inspected.error.code));
        if (!inspected.error && !isAcceptedPhotoDimensions(inspected.width, inspected.height)) issues.push(technicalIssue(photo.index, 'PHOTO_DIMENSIONS_INVALID_FROM_BYTES'));
        return artifactWithFile(plan, photo, inspected, normalized.providerArtifactId);
      },
    });
    return { artifact, issues };
  } catch (error) {
    if (error instanceof PhotoGenerationError && error.cause instanceof RealPhotoProductionError) throw error.cause;
    throw error;
  }
}

async function generateStagedArtifacts(plan, photos, provider, stageDir, policy, sourceFacts, usedPoseContext = undefined) {
  const artifacts = [];
  const technicalIssues = [];
  for (const photo of photos) {
    const result = await writeStagedPhoto(plan, photo, provider, stageDir, policy, sourceFacts, usedPoseContext);
    artifacts.push(result.artifact);
    technicalIssues.push(...result.issues);
  }
  return { artifacts, technicalIssues };
}

function replaceFolderPaths(artifacts, fromFolder, toFolder) {
  return artifacts.map((artifact) => {
    const next = clone(artifact);
    if (typeof next.asset?.path === 'string' && next.asset.path.startsWith(`${fromFolder}${path.sep}`)) {
      next.asset.path = path.join(toFolder, path.relative(fromFolder, next.asset.path));
    }
    return next;
  });
}

function resultFor(plan, artifacts, quality, finalized, files = []) {
  const result = {
    status: quality.status,
    productKey: plan.productKey,
    version: plan.version,
    plan: clone(plan),
    artifacts,
    quality,
    reworkPlan: quality.reworkPlan,
    finalized,
    files,
  };
  if (quality.approvedMediaArtifact !== undefined && finalized) result.approvedMediaArtifact = quality.approvedMediaArtifact;
  return result;
}

function assertProductionInput(input) {
  assertRecord(input, 'real photo production input');
  for (const key of Object.keys(input)) if (!['plan', 'sourceFacts'].includes(key)) throw new TypeError(`Unsupported real photo production input field: ${key}`);
  assertRecord(input.sourceFacts, 'real photo production input.sourceFacts');
}

/** Produce and atomically finalize five real PNG files through an injected provider. */
export async function produceRealPhotoFiles(input, options = {}) {
  const policy = assertOptions(options, OPTIONS, 'real photo production');
  assertProductionInput(input);
  const { plan, sourceFacts } = input;
  validatePhotoProductionPlan(plan, { policy });
  if (plan.status !== PHOTO_STATUSES.READY) throw new RealPhotoProductionError('Real photo production requires a READY plan', 'PHOTO_PLAN_NOT_READY');
  const outputRoot = path.resolve(options.outputRoot);
  const finalFolder = productFolder(outputRoot, plan.productKey);
  if (await pathExists(finalFolder)) throw new RealPhotoProductionError('Product output already exists; refusing silent overwrite', 'PHOTO_OUTPUT_EXISTS', { outputPath: finalFolder });
  await fs.mkdir(outputRoot, { recursive: true });
  const stagingRoot = await fs.mkdtemp(path.join(outputRoot, '.photo-production-'));
  const stagingFolder = path.join(stagingRoot, safeFolderName(plan.productKey));
  await fs.mkdir(stagingFolder, { recursive: true });
  try {
    const generated = await generateStagedArtifacts(plan, plan.photos, options.provider, stagingFolder, policy, sourceFacts);
    const stagedQuality = applyTechnicalIssues(
      validatePhotoArtifacts({ plan, artifacts: generated.artifacts, sourceFacts }, { policy }),
      generated.technicalIssues,
    );
    const projectedArtifacts = replaceFolderPaths(generated.artifacts, stagingFolder, finalFolder);
    const projectedQuality = applyTechnicalIssues(
      validatePhotoArtifacts({ plan, artifacts: projectedArtifacts, sourceFacts }, { policy }),
      generated.technicalIssues,
    );
    if (stagedQuality.status !== PHOTO_STATUSES.READY) return resultFor(plan, projectedArtifacts, projectedQuality, false);
    if (await pathExists(finalFolder)) throw new RealPhotoProductionError('Product output appeared during production; refusing overwrite', 'PHOTO_OUTPUT_EXISTS', { outputPath: finalFolder });
    await fs.rename(stagingFolder, finalFolder);
    const finalArtifacts = projectedArtifacts;
    const finalQuality = validatePhotoArtifacts({ plan, artifacts: finalArtifacts, sourceFacts }, { policy });
    const files = plan.photos.map((photo) => photoPath(finalFolder, photo));
    return resultFor(plan, finalArtifacts, finalQuality, true, files);
  } catch (error) {
    if (error instanceof RealPhotoProductionError || error instanceof PhotoGenerationError) throw error;
    throw new RealPhotoProductionError('Real photo production failed', 'PHOTO_FILE_WRITE_FAILED', undefined, error);
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

function assertReworkInput(input) {
  assertRecord(input, 'real photo rework input');
  for (const key of Object.keys(input)) if (!REWORK_INPUT_KEYS.has(key)) throw new TypeError(`Unsupported real photo rework input field: ${key}`);
  if (!Array.isArray(input.artifacts)) throw new TypeError('real photo rework input.artifacts must be an array');
  assertRecord(input.quality, 'real photo rework input.quality');
  assertRecord(input.sourceFacts, 'real photo rework input.sourceFacts');
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function approvedPoseContext(plan, quality) {
  const readyIndexes = new Set(quality.photos
    .filter((photo) => photo.status === PHOTO_STATUSES.READY)
    .map((photo) => photo.photoIndex));
  return plan.photos
    .filter((photo) => readyIndexes.has(photo.index))
    .map((photo) => ({
      photoIndex: photo.index,
      role: photo.role,
      compositionIntent: photo.visualDirection.compositionIntent,
      productOrientation: photo.visualDirection.productOrientation,
      cameraViewpoint: photo.visualDirection.cameraViewpoint,
      positionKey: photo.visualDirection.positionKey,
    }));
}

async function normalizeExistingArtifacts(plan, artifacts, outputRoot) {
  const finalFolder = productFolder(outputRoot, plan.productKey);
  const normalized = [];
  const issues = [];
  for (const photo of plan.photos) {
    const artifact = artifacts[photo.index - 1];
    const expectedPath = photoPath(finalFolder, photo);
    if (!isWithin(outputRoot, expectedPath) || !isRecordValue(artifact) || artifact.asset?.path !== expectedPath) {
      issues.push(technicalIssue(photo.index, 'PHOTO_OUTPUT_PATH_INVALID'));
      normalized.push(artifact);
      continue;
    }
    const inspected = await inspectPngFile(expectedPath);
    const next = clone(artifact);
    next.asset = { ...(next.asset ?? {}), path: expectedPath, width: inspected.width ?? 0, height: inspected.height ?? 0, format: 'png' };
    if (inspected.hash) {
      if (artifact.hash !== undefined && artifact.hash !== inspected.hash) issues.push(technicalIssue(photo.index, 'PHOTO_HASH_MISMATCH_FROM_BYTES'));
      next.hash = inspected.hash;
    }
    if (inspected.error) issues.push(technicalIssue(photo.index, inspected.error.code));
    normalized.push(next);
  }
  return { normalized, technicalIssues: issues };
}

async function replaceFilesAtomically(replacements) {
  const moved = [];
  try {
    for (const replacement of replacements) {
      const backup = `${replacement.target}.photo-rework-backup`;
      await fs.rename(replacement.target, backup);
      try {
        await fs.rename(replacement.staged, replacement.target);
      } catch (error) {
        await fs.rename(backup, replacement.target);
        throw error;
      }
      moved.push({ ...replacement, backup });
    }
  } catch (error) {
    for (const replacement of moved.reverse()) {
      await fs.rm(replacement.target, { force: true });
      await fs.rename(replacement.backup, replacement.target);
    }
    throw new RealPhotoProductionError('Selective photo replacement failed; original files were restored', 'PHOTO_FILE_WRITE_FAILED', undefined, error);
  }
  for (const replacement of moved) await fs.rm(replacement.backup, { force: true });
}

/** Rework only the current non-READY photo indexes and atomically replace those files. */
export async function reworkRealPhotoFiles(input, options = {}) {
  const policy = assertOptions(options, REWORK_OPTIONS, 'real photo rework');
  assertReworkInput(input);
  validatePhotoProductionPlan(input.plan, { policy });
  if (input.plan.status !== PHOTO_STATUSES.READY) throw new RealPhotoProductionError('Real photo rework requires a READY plan', 'PHOTO_PLAN_NOT_READY');
  const outputRoot = path.resolve(options.outputRoot);
  const existing = await normalizeExistingArtifacts(input.plan, input.artifacts, outputRoot);
  const current = applyTechnicalIssues(
    validatePhotoArtifacts({ plan: input.plan, artifacts: existing.normalized, sourceFacts: input.sourceFacts, ...(input.visualQa === undefined ? {} : { visualQa: input.visualQa }) }, { policy }),
    existing.technicalIssues,
  );
  if (!sameJson(input.quality, current)) throw new RealPhotoProductionError('Supplied Photo QA result does not match current file bytes', 'PHOTO_QUALITY_RESULT_MISMATCH');
  if (current.status === PHOTO_STATUSES.READY || current.reworkPlan.photos.length === 0) throw new RealPhotoProductionError('Only a non-READY Photo QA result can start rework', 'PHOTO_REWORK_NOT_ELIGIBLE');

  const targetIndexes = new Set(current.reworkPlan.photos.map((entry) => entry.photoIndex));
  const targetPhotos = input.plan.photos.filter((photo) => targetIndexes.has(photo.index));
  const nextPlan = { ...clone(input.plan), version: input.plan.version + 1 };
  const stagingRoot = await fs.mkdtemp(path.join(outputRoot, '.photo-rework-'));
  const stagingFolder = path.join(stagingRoot, safeFolderName(nextPlan.productKey));
  await fs.mkdir(stagingFolder, { recursive: true });
  try {
    const regenerated = await generateStagedArtifacts(nextPlan, targetPhotos, options.provider, stagingFolder, policy, input.sourceFacts, approvedPoseContext(input.plan, current));
    const byIndex = new Map(regenerated.artifacts.map((artifact) => [artifact.photoIndex, artifact]));
    const candidateArtifacts = input.plan.photos.map((photo, index) => targetIndexes.has(photo.index) ? byIndex.get(photo.index) : existing.normalized[index]);
    const candidateQuality = applyTechnicalIssues(
      validatePhotoArtifacts({ plan: nextPlan, artifacts: candidateArtifacts, sourceFacts: input.sourceFacts }, { policy }),
      regenerated.technicalIssues,
    );
    if (candidateQuality.status !== PHOTO_STATUSES.READY) {
      throw new RealPhotoProductionError('Selective photo rework did not produce a READY set; original files remain unchanged', 'PHOTO_REWORK_FAILED', { quality: candidateQuality });
    }
    const replacements = targetPhotos.map((photo) => ({
      staged: photoPath(stagingFolder, photo),
      target: photoPath(productFolder(outputRoot, nextPlan.productKey), photo),
    }));
    for (const replacement of replacements) {
      const currentFile = await inspectPngFile(replacement.target);
      const original = existing.normalized.find((artifact) => artifact.asset.path === replacement.target);
      if (currentFile.error || currentFile.hash !== original?.hash) throw new RealPhotoProductionError('A source output changed during selective rework', 'PHOTO_OUTPUT_CHANGED');
    }
    await replaceFilesAtomically(replacements);
    const finalArtifacts = candidateArtifacts.map((artifact) => {
      const next = clone(artifact);
      if (targetIndexes.has(next.photoIndex)) next.asset.path = photoPath(productFolder(outputRoot, nextPlan.productKey), nextPlan.photos[next.photoIndex - 1]);
      return next;
    });
    const finalQuality = validatePhotoArtifacts({ plan: nextPlan, artifacts: finalArtifacts, sourceFacts: input.sourceFacts }, { policy });
    const files = nextPlan.photos.map((photo) => photoPath(productFolder(outputRoot, nextPlan.productKey), photo));
    return resultFor(nextPlan, finalArtifacts, finalQuality, true, files);
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

export function realPhotoFolderName(productKey) {
  if (typeof productKey !== 'string' || !productKey.trim()) throw new TypeError('productKey must be a non-empty string');
  return safeFolderName(productKey);
}

export function realPhotoFilename(role) {
  if (!PHOTO_FILENAMES[role]) throw new TypeError(`Unknown photo role: ${role}`);
  return PHOTO_FILENAMES[role];
}

export class RealPhotoProductionError extends Error {
  constructor(message, code = 'REAL_PHOTO_PRODUCTION_ERROR', details = undefined, cause = undefined) {
    super(message, cause === undefined ? {} : { cause });
    this.name = 'RealPhotoProductionError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
