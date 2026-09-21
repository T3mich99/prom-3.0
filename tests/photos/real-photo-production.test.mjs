import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import { importCodexPhotoFiles } from '../../src/cli/category-photo-import.mjs';
import { buildPhotoProductionPlan } from '../../src/photos/photo-production-plan.mjs';
import { PHOTO_ROLE_ORDER, PHOTO_STATUSES } from '../../src/photos/photo-contract.mjs';
import { validatePhotoArtifacts } from '../../src/photos/photo-quality.mjs';
import {
  inspectPngBytes,
  produceRealPhotoFiles,
  reworkRealPhotoFiles,
  realPhotoFilename,
  realPhotoFolderName,
  RealPhotoProductionError,
} from '../../src/photos/real-photo-production.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(value) {
  let result = 0xffffffff;
  for (const byte of value) result = CRC_TABLE[(result ^ byte) & 0xff] ^ (result >>> 8);
  return (result ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const payload = Buffer.allocUnsafe(4 + data.length);
  payload.write(type, 0, 4, 'ascii');
  data.copy(payload, 4);
  const chunk = Buffer.allocUnsafe(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  payload.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(payload), 8 + data.length);
  return chunk;
}

const pngCache = new Map();
function png(width = 1280, height = 1280, seed = 1) {
  const key = `${width}x${height}:${seed}`;
  if (pngCache.has(key)) return pngCache.get(key);
  const rowBytes = width;
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    scanlines[row * (rowBytes + 1)] = 0;
    scanlines[row * (rowBytes + 1) + 1] = seed & 0xff;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const value = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  pngCache.set(key, value);
  return value;
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function longText(prefix) {
  return Array.from({ length: 60 }, (_, index) => `${prefix} пояснює користь товару та спосіб використання номер ${index + 1}.`).join(' ');
}

function keywords(prefix) {
  return Array.from({ length: 25 }, (_, index) => `${prefix} для волосся пошукова фраза ${index + 1}`).join(', ');
}

function contentArtifact(productKey) {
  return {
    productKey,
    version: 1,
    content: {
      title: { ru: 'Фен для волос', ua: 'Фен для волосся чорний' },
      description: { ru: longText('Описание'), ua: longText('Опис') },
      keywords: { ru: keywords('фен'), ua: keywords('фен') },
      characteristics: [{ name: 'Потужність', value: '2200 Вт' }],
    },
  };
}

function sourceFacts() {
  return { type: 'фен', brand: 'VGR', model: 'V-451', power: '2200 Вт', color: 'чорний', purchasePrice: 230, commission: '20%' };
}

function sourceImages(productKey) {
  return [
    { id: `${productKey}-front`, url: `https://example.invalid/source/${productKey}/front.png`, role: 'front', provenance: 'supplier' },
    { id: `${productKey}-side`, path: `C:\\references\\${productKey}\\side.png`, role: 'side', provenance: 'supplier' },
  ];
}

function planFor(productKey = 'product-A') {
  return buildPhotoProductionPlan({
    selectedProduct: { selectionKey: productKey },
    contentArtifact: contentArtifact(productKey),
    sourceImages: sourceImages(productKey),
    sourceFacts: sourceFacts(),
  });
}

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'real-photo-production-'));
}

async function withRoot(callback) {
  const root = await tempRoot();
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function providerFor({ bytesByIndex = new Map(), ids = true, calls = [], onCall = undefined } = {}) {
  return {
    async generateImage(request) {
      calls.push(structuredClone(request));
      if (onCall) await onCall(request);
      return {
        bytes: bytesByIndex.get(request.photoIndex) ?? png(1280, 1280, request.photoIndex),
        mimeType: 'image/png',
        ...(ids ? { providerArtifactId: `provider-${request.productKey}-${request.photoIndex}` } : {}),
      };
    },
  };
}

async function produceReady(root, productKey = 'product-A', provider = providerFor()) {
  const plan = planFor(productKey);
  const result = await produceRealPhotoFiles({ plan, sourceFacts: sourceFacts() }, { provider, outputRoot: root });
  return { plan, result };
}

async function readAll(result) {
  return Promise.all(result.files.map((file) => fs.readFile(file)));
}

async function makeReworkInput(root, failedIndex = 3) {
  const plan = planFor();
  const folder = path.join(root, realPhotoFolderName(plan.productKey));
  await fs.mkdir(folder, { recursive: true });
  const artifacts = [];
  for (const photo of plan.photos) {
    const bytes = png(1280, 1280, photo.index);
    const file = path.join(folder, realPhotoFilename(photo.role));
    await fs.writeFile(file, bytes);
    artifacts.push({
      productKey: plan.productKey,
      photoIndex: photo.index,
      role: photo.role,
      asset: { path: file, width: 1280, height: 1280, format: 'png' },
      claimsUsed: structuredClone(photo.verifiedClaims),
      sourceImageRefs: structuredClone(photo.sourceImageRefs),
      text: structuredClone(photo.text),
      hash: hash(bytes),
      providerArtifactId: `provider-${photo.index}`,
    });
  }
  artifacts[failedIndex - 1].providerArtifactId = artifacts[0].providerArtifactId;
  const quality = validatePhotoArtifacts({ plan, artifacts, sourceFacts: sourceFacts() });
  assert.equal(quality.status, PHOTO_STATUSES.REWORK);
  assert.deepEqual(quality.reworkPlan.photos.map((item) => item.photoIndex), [failedIndex]);
  return { plan, artifacts, quality, sourceFacts: sourceFacts() };
}

test('inspectPngBytes accepts a real 1280x1280 PNG byte payload', () => {
  const info = inspectPngBytes(png());
  assert.deepEqual({ width: info.width, height: info.height, format: info.format }, { width: 1280, height: 1280, format: 'png' });
  assert.equal(info.size, png().length);
  assert.equal(info.hash, hash(png()));
});

test('PNG inspection requires the canonical signature', () => {
  const broken = Buffer.from(png());
  broken[0] = 0;
  assert.throws(() => inspectPngBytes(broken), (error) => error.code === 'PHOTO_PNG_INVALID');
});

test('PNG inspection rejects empty bytes', () => {
  assert.throws(() => inspectPngBytes(Buffer.alloc(0)), (error) => error.code === 'PHOTO_PNG_INVALID');
});

test('PNG inspection rejects non-byte provider payloads', () => {
  assert.throws(() => inspectPngBytes('base64'), (error) => error.code === 'PHOTO_PNG_INVALID');
});

test('PNG inspection rejects truncated chunks', () => {
  assert.throws(() => inspectPngBytes(png().subarray(0, 40)), (error) => error.code === 'PHOTO_PNG_INVALID');
});

test('PNG inspection rejects a changed chunk CRC', () => {
  const broken = Buffer.from(png());
  broken[broken.length - 5] ^= 1;
  assert.throws(() => inspectPngBytes(broken), (error) => error.code === 'PHOTO_PNG_INVALID');
});

test('PNG inspection rejects corrupt compressed image data', () => {
  const broken = Buffer.from(png());
  const idat = broken.indexOf(Buffer.from('IDAT'));
  broken[idat + 8] ^= 0xff;
  assert.throws(() => inspectPngBytes(broken), (error) => error.code === 'PHOTO_PNG_INVALID');
});

test('PNG inspection reads actual wrong dimensions instead of trusting metadata', () => {
  const info = inspectPngBytes(png(1279, 1280, 4));
  assert.equal(info.width, 1279);
  assert.equal(info.height, 1280);
});

test('PNG inspection rejects unsupported interlacing', () => {
  const broken = Buffer.from(png());
  const ihdr = broken.indexOf(Buffer.from('IHDR'));
  broken[ihdr + 12] = 1;
  assert.throws(() => inspectPngBytes(broken), (error) => error.code === 'PHOTO_PNG_INVALID');
});

test('PNG inspection rejects unsupported bit depth', () => {
  const broken = Buffer.from(png());
  const ihdr = broken.indexOf(Buffer.from('IHDR'));
  broken[ihdr + 8] = 16;
  assert.throws(() => inspectPngBytes(broken), (error) => error.code === 'PHOTO_PNG_INVALID');
});

test('product folder names are deterministic and filesystem-safe', () => {
  const first = realPhotoFolderName('C:\\supplier/../unsafe product: 1');
  assert.equal(first, realPhotoFolderName('C:\\supplier/../unsafe product: 1'));
  assert.match(first, /^product-[a-f0-9]{64}$/u);
  assert.doesNotMatch(first, /[\\/:*?"<>|]/u);
});

for (const [role, expected] of Object.entries({ hero: '01-hero.png', usage: '02-usage.png', benefits: '03-benefits.png', feature: '04-feature.png', final: '05-final.png' })) {
  test(`canonical filename for ${role} is deterministic`, () => assert.equal(realPhotoFilename(role), expected));
}

test('unknown roles cannot escape the canonical filename map', () => {
  assert.throws(() => realPhotoFilename('../escape'), TypeError);
});

test('provider receives exact output requirements', async () => withRoot(async (root) => {
  const calls = [];
  await produceReady(root, 'requirements', providerFor({ calls }));
  assert.deepEqual(calls.map((request) => request.outputRequirements), Array.from({ length: 5 }, () => ({ width: 1280, height: 1280, format: 'png' })));
}));

test('provider receives output requirements at the provider boundary', async () => withRoot(async (root) => {
  const calls = [];
  const provider = providerFor({ onCall: async (request) => calls.push(request.outputRequirements) });
  await produceReady(root, 'requirements-2', provider);
  assert.deepEqual(calls, Array.from({ length: 5 }, () => ({ width: 1280, height: 1280, format: 'png' })));
}));

test('provider receives the PR20 generated prompt rather than an ad hoc prompt', async () => withRoot(async (root) => {
  const calls = [];
  await produceReady(root, 'prompt', providerFor({ onCall: async (request) => calls.push(request.prompt) }));
  assert.equal(calls.every((value) => typeof value === 'string' && value.includes('sole physical appearance authority')), true);
}));

test('provider receives source references in their planned order', async () => withRoot(async (root) => {
  const requests = [];
  await produceReady(root, 'refs', providerFor({ onCall: async (request) => requests.push(request) }));
  assert.deepEqual(requests[0].sourceImageRefs, planFor('refs').sourceImageRefs);
}));

test('provider receives preservation constraints and structural-only fidelity mode', async () => withRoot(async (root) => {
  let request;
  await produceReady(root, 'constraints', providerFor({ onCall: async (value) => { request = value; } }));
  assert.equal(request.fidelityVerification, 'STRUCTURAL_ONLY');
  assert.equal(request.preservationConstraints.some((item) => item.includes('do not add or remove')), true);
}));

test('provider request contains no economic source facts', async () => withRoot(async (root) => {
  const requests = [];
  await produceReady(root, 'economics', providerFor({ onCall: async (request) => requests.push(JSON.stringify(request)) }));
  assert.equal(requests.every((request) => !request.includes('purchasePrice') && !request.includes('commission') && !/:\s*230(?:[,}])/u.test(request)), true);
}));

test('provider boundary requires an object with generateImage', async () => withRoot(async (root) => {
  await assert.rejects(() => produceRealPhotoFiles({ plan: planFor(), sourceFacts: sourceFacts() }, { provider: () => {}, outputRoot: root }), TypeError);
}));

test('provider boundary requires explicit outputRoot', async () => {
  await assert.rejects(() => produceRealPhotoFiles({ plan: planFor(), sourceFacts: sourceFacts() }, { provider: providerFor() }), TypeError);
});

test('provider is called exactly once for each ordered photo', async () => withRoot(async (root) => {
  const calls = [];
  await produceReady(root, 'calls', providerFor({ calls }));
  assert.deepEqual(calls.map((request) => request.photoIndex), [1, 2, 3, 4, 5]);
}));

test('five actual files are finalized for a READY production', async () => withRoot(async (root) => {
  const { result } = await produceReady(root, 'files');
  assert.equal(result.status, PHOTO_STATUSES.READY);
  assert.equal(result.finalized, true);
  assert.equal(result.files.length, 5);
  assert.equal((await fs.readdir(path.dirname(result.files[0]))).length, 5);
}));

test('final files have exact 1280x1280 dimensions from their bytes', async () => withRoot(async (root) => {
  const { result } = await produceReady(root, 'dimensions');
  const infos = await Promise.all((await readAll(result)).map((bytes) => inspectPngBytes(bytes)));
  assert.equal(infos.every((info) => info.width === 1280 && info.height === 1280), true);
}));

test('provider 1254x1254 PNG bytes are accepted without dimension rework', async () => withRoot(async (root) => {
  const bytesByIndex = new Map([1, 2, 3, 4, 5].map((index) => [index, png(1254, 1254, index)]));
  const { result } = await produceReady(root, 'provider-1254', providerFor({ bytesByIndex }));
  assert.equal(result.status, PHOTO_STATUSES.READY);
  assert.equal(result.quality.reworkPlan.photos.length, 0);
  assert.equal(result.artifacts.every((artifact) => artifact.asset.width === 1254 && artifact.asset.height === 1254), true);
}));

test('final files have PNG signatures from their bytes', async () => withRoot(async (root) => {
  const { result } = await produceReady(root, 'signatures');
  const files = await readAll(result);
  assert.equal(files.every((bytes) => bytes.subarray(0, 8).equals(PNG_SIGNATURE)), true);
}));

test('artifact hashes match the SHA-256 of finalized bytes', async () => withRoot(async (root) => {
  const { result } = await produceReady(root, 'hashes');
  const files = await readAll(result);
  assert.deepEqual(result.artifacts.map((artifact) => artifact.hash), files.map(hash));
}));

test('artifact paths are deterministic and point to the safe product folder', async () => withRoot(async (root) => {
  const { plan, result } = await produceReady(root, 'paths');
  assert.deepEqual(result.artifacts.map((artifact) => artifact.asset.path), result.files);
  assert.equal(path.dirname(result.files[0]), path.join(root, realPhotoFolderName(plan.productKey)));
}));

test('READY production exposes the approved media artifact only after finalization', async () => withRoot(async (root) => {
  const { result } = await produceReady(root, 'approved');
  assert.equal(result.approvedMediaArtifact.photos.length, 5);
  assert.deepEqual(result.approvedMediaArtifact.photos.map((photo) => photo.assetRef), result.files);
}));

test('final photo roles and order remain canonical', async () => withRoot(async (root) => {
  const { result } = await produceReady(root, 'order');
  assert.deepEqual(result.artifacts.map((artifact) => artifact.role), PHOTO_ROLE_ORDER);
  assert.deepEqual(result.artifacts.map((artifact) => artifact.photoIndex), [1, 2, 3, 4, 5]);
}));

test('source references and Ukrainian structured text are preserved', async () => withRoot(async (root) => {
  const { plan, result } = await produceReady(root, 'text');
  assert.deepEqual(result.artifacts[0].sourceImageRefs, plan.sourceImageRefs);
  assert.deepEqual(result.artifacts[0].text, plan.photos[0].text);
  assert.equal(result.artifacts[0].text.every((item) => item.language === 'uk'), true);
}));

test('source files are never used as output files', async () => withRoot(async (root) => {
  const plan = planFor('source-isolation');
  const sourceFile = path.join(root, 'source.png');
  await fs.writeFile(sourceFile, png(1280, 1280, 99));
  const before = await fs.readFile(sourceFile);
  await produceRealPhotoFiles({ plan, sourceFacts: sourceFacts() }, { provider: providerFor(), outputRoot: root });
  assert.deepEqual(await fs.readFile(sourceFile), before);
}));

test('a second fresh production refuses to overwrite the product folder', async () => withRoot(async (root) => {
  const plan = planFor('overwrite');
  await produceRealPhotoFiles({ plan, sourceFacts: sourceFacts() }, { provider: providerFor(), outputRoot: root });
  await assert.rejects(() => produceRealPhotoFiles({ plan, sourceFacts: sourceFacts() }, { provider: providerFor(), outputRoot: root }), (error) => error.code === 'PHOTO_OUTPUT_EXISTS');
}));

test('provider failure is surfaced as an operational error', async () => withRoot(async (root) => {
  await assert.rejects(
    () => produceRealPhotoFiles({ plan: planFor('provider-failure'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => { throw new Error('offline'); } }, outputRoot: root }),
    (error) => error.code === 'PHOTO_PROVIDER_FAILURE' && error.cause?.message === 'offline',
  );
}));

test('a fatal provider failure stops subsequent provider calls', async () => withRoot(async (root) => {
  const calls = [];
  const provider = { generateImage: async (request) => { calls.push(request.photoIndex); if (request.photoIndex === 3) throw new Error('stop'); return { bytes: png(1280, 1280, request.photoIndex), mimeType: 'image/png' }; } };
  await assert.rejects(() => produceRealPhotoFiles({ plan: planFor('stop'), sourceFacts: sourceFacts() }, { provider, outputRoot: root }));
  assert.deepEqual(calls, [1, 2, 3]);
}));

test('provider response missing bytes is rejected at the provider boundary', async () => withRoot(async (root) => {
  await assert.rejects(() => produceRealPhotoFiles({ plan: planFor('missing-bytes'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => ({ mimeType: 'image/png' }) }, outputRoot: root }), (error) => error.code === 'PHOTO_PROVIDER_RESPONSE_INVALID');
}));

test('provider temporary URLs are downloaded and validated as actual PNG bytes', async () => withRoot(async (root) => {
  const bytes = png(1280, 1280, 12);
  const result = await produceRealPhotoFiles({ plan: planFor('temporary-url'), sourceFacts: sourceFacts() }, { provider: { generateImage: async (request) => ({ temporaryUrl: `data:image/png;base64,${png(1280, 1280, request.photoIndex + 12).toString('base64')}` }) }, outputRoot: root });
  assert.equal(result.status, PHOTO_STATUSES.READY);
  assert.deepEqual(await fs.readFile(result.files[0]), png(1280, 1280, 13));
  assert.notDeepEqual(await fs.readFile(result.files[0]), bytes);
}));

test('temporary URL download failures are not retried or published', async () => withRoot(async (root) => {
  let calls = 0;
  await assert.rejects(() => produceRealPhotoFiles({ plan: planFor('temporary-url-failure'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => { calls += 1; return { temporaryUrl: 'data:text/plain;base64,ZmFpbA==' }; } }, outputRoot: root }), (error) => error.code === 'PHOTO_FILE_DOWNLOAD_FAILED');
  assert.equal(calls, 1);
  assert.equal(await fs.access(path.join(root, realPhotoFolderName('temporary-url-failure'))).then(() => true, () => false), false);
}));

test('provider cannot return bytes and a temporary URL together', async () => withRoot(async (root) => {
  await assert.rejects(() => produceRealPhotoFiles({ plan: planFor('both-outputs'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => ({ bytes: png(), temporaryUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' }) }, outputRoot: root }), (error) => error.code === 'PHOTO_PROVIDER_RESPONSE_INVALID');
}));

test('provider response extra fields are rejected instead of trusted', async () => withRoot(async (root) => {
  await assert.rejects(() => produceRealPhotoFiles({ plan: planFor('extra-field'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => ({ bytes: png(), mimeType: 'image/png', hash: 'forged' }) }, outputRoot: root }), (error) => error.code === 'PHOTO_PROVIDER_RESPONSE_INVALID');
}));

test('provider response with empty bytes becomes REWORK with no final folder', async () => withRoot(async (root) => {
  const result = await produceRealPhotoFiles({ plan: planFor('empty'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => ({ bytes: Buffer.alloc(0), mimeType: 'image/png' }) }, outputRoot: root });
  assert.equal(result.status, PHOTO_STATUSES.REWORK);
  assert.equal(result.finalized, false);
  assert.equal(Object.hasOwn(result, 'approvedMediaArtifact'), false);
  assert.equal(await fs.access(path.join(root, realPhotoFolderName('empty'))).then(() => true, () => false), false);
}));

test('corrupt generated bytes become REWORK with no final folder', async () => withRoot(async (root) => {
  const result = await produceRealPhotoFiles({ plan: planFor('corrupt'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => ({ bytes: Buffer.from('not-an-image'), mimeType: 'image/png' }) }, outputRoot: root });
  assert.equal(result.status, PHOTO_STATUSES.REWORK);
  assert.equal(result.quality.reworkPlan.photos.length, 5);
  assert.equal(await fs.access(path.join(root, realPhotoFolderName('corrupt'))).then(() => true, () => false), false);
}));

test('wrong generated dimensions become REWORK from actual bytes', async () => withRoot(async (root) => {
  const result = await produceRealPhotoFiles({ plan: planFor('wrong-dimensions'), sourceFacts: sourceFacts() }, { provider: { generateImage: async (request) => ({ bytes: png(request.photoIndex === 2 ? 1279 : 1280, 1280, request.photoIndex), mimeType: 'image/png' }) }, outputRoot: root });
  assert.equal(result.status, PHOTO_STATUSES.REWORK);
  assert.deepEqual(result.reworkPlan.photos.map((item) => item.photoIndex), [2]);
  assert.equal(result.quality.photos[1].reasonCodes.includes('PHOTO_WIDTH_INVALID'), true);
}));

test('wrong provider MIME is rejected as a provider contract error', async () => withRoot(async (root) => {
  await assert.rejects(() => produceRealPhotoFiles({ plan: planFor('mime'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => ({ bytes: png(), mimeType: 'image/jpeg' }) }, outputRoot: root }), (error) => error.code === 'PHOTO_PROVIDER_RESPONSE_INVALID');
}));

test('exact duplicate generated byte hashes cause REWORK', async () => withRoot(async (root) => {
  const same = png(1280, 1280, 7);
  const result = await produceRealPhotoFiles({ plan: planFor('duplicates'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => ({ bytes: same, mimeType: 'image/png' }) }, outputRoot: root });
  assert.equal(result.status, PHOTO_STATUSES.REWORK);
  assert.equal(result.quality.photos[1].reasonCodes.includes('PHOTO_DUPLICATE_ASSET'), true);
}));

test('duplicate production never exposes an approved media artifact', async () => withRoot(async (root) => {
  const result = await produceRealPhotoFiles({ plan: planFor('duplicate-approved'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => ({ bytes: png(1280, 1280, 8), mimeType: 'image/png' }) }, outputRoot: root });
  assert.equal(Object.hasOwn(result, 'approvedMediaArtifact'), false);
  assert.equal(result.files.length, 0);
}));

test('fresh QA failure cleans all staging directories', async () => withRoot(async (root) => {
  await produceRealPhotoFiles({ plan: planFor('staging-clean'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => ({ bytes: png(1280, 1280, 9), mimeType: 'image/png' }) }, outputRoot: root });
  assert.deepEqual((await fs.readdir(root)).filter((name) => name.startsWith('.photo-')), []);
}));

test('Buffer subarrays are accepted as actual byte payloads', () => {
  const bytes = Buffer.concat([Buffer.from([1, 2]), png(), Buffer.from([3])]);
  assert.equal(inspectPngBytes(bytes.subarray(2, bytes.length - 1)).width, 1280);
});

test('real production does not trust a provider-supplied metadata hash', async () => withRoot(async (root) => {
  const result = await produceRealPhotoFiles({ plan: planFor('hash-authority'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => ({ bytes: png(1280, 1280, 11), mimeType: 'image/png' }) }, outputRoot: root });
  assert.equal(result.artifacts[0].hash, hash(png(1280, 1280, 11)));
}));

test('rework refuses a READY quality result', async () => withRoot(async (root) => {
  const { plan, result } = await produceReady(root, 'ready-rework');
  await assert.rejects(() => reworkRealPhotoFiles({ plan, artifacts: result.artifacts, quality: result.quality, sourceFacts: sourceFacts() }, { provider: providerFor(), outputRoot: root }), (error) => error.code === 'PHOTO_REWORK_NOT_ELIGIBLE');
}));

test('rework rejects forged quality before any provider call', async () => withRoot(async (root) => {
  const { plan, artifacts, quality } = await makeReworkInput(root, 3);
  const forged = structuredClone(quality);
  forged.status = PHOTO_STATUSES.READY;
  const calls = [];
  await assert.rejects(() => reworkRealPhotoFiles({ plan, artifacts, quality: forged, sourceFacts: sourceFacts() }, { provider: providerFor({ calls }), outputRoot: root }), (error) => error.code === 'PHOTO_QUALITY_RESULT_MISMATCH');
  assert.equal(calls.length, 0);
}));

test('rework regenerates only the current failed index', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 3);
  const calls = [];
  const result = await reworkRealPhotoFiles(input, { provider: providerFor({ calls, bytesByIndex: new Map([[3, png(1280, 1280, 33)]]) }), outputRoot: root });
  assert.deepEqual(calls.map((request) => request.photoIndex), [3]);
  assert.equal(result.status, PHOTO_STATUSES.READY);
}));

test('successful rework increments the plan version exactly once', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 4);
  const result = await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root });
  assert.equal(result.version, input.plan.version + 1);
  assert.equal(result.plan.version, input.plan.version + 1);
}));

test('rework preserves accepted file paths', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 2);
  const before = input.artifacts.filter((artifact) => artifact.photoIndex !== 2).map((artifact) => artifact.asset.path);
  const result = await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root });
  assert.deepEqual(result.artifacts.filter((artifact) => artifact.photoIndex !== 2).map((artifact) => artifact.asset.path), before);
}));

test('rework preserves accepted file bytes and hashes', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 2);
  const before = await Promise.all(input.artifacts.filter((artifact) => artifact.photoIndex !== 2).map((artifact) => fs.readFile(artifact.asset.path)));
  const result = await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root });
  const after = await Promise.all(result.artifacts.filter((artifact) => artifact.photoIndex !== 2).map((artifact) => fs.readFile(artifact.asset.path)));
  assert.deepEqual(after, before);
  assert.deepEqual(result.artifacts.filter((artifact) => artifact.photoIndex !== 2).map((artifact) => artifact.hash), before.map(hash));
}));

test('reworked target file is a new valid PNG', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 2);
  const bytes = png(1280, 1280, 44);
  const result = await reworkRealPhotoFiles(input, { provider: { generateImage: async () => ({ bytes, mimeType: 'image/png' }) }, outputRoot: root });
  assert.deepEqual(inspectPngBytes(await fs.readFile(result.files[1])), inspectPngBytes(bytes));
}));

test('successful selective rework returns an approved five-file artifact', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 5);
  const result = await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root });
  assert.equal(result.quality.status, PHOTO_STATUSES.READY);
  assert.equal(result.approvedMediaArtifact.photos.length, 5);
  assert.deepEqual(result.files, result.approvedMediaArtifact.photos.map((photo) => photo.assetRef));
}));

test('rework does not mutate plan, artifacts, or quality inputs', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 3);
  const before = structuredClone({ plan: input.plan, artifacts: input.artifacts, quality: input.quality });
  await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root });
  assert.deepEqual({ plan: input.plan, artifacts: input.artifacts, quality: input.quality }, before);
}));

test('failed selective rework leaves all original files unchanged', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 3);
  const before = await Promise.all(input.artifacts.map((artifact) => fs.readFile(artifact.asset.path)));
  const duplicate = await fs.readFile(input.artifacts[0].asset.path);
  await assert.rejects(
    () => reworkRealPhotoFiles(input, { provider: { generateImage: async () => ({ bytes: duplicate, mimeType: 'image/png' }) }, outputRoot: root }),
    (error) => error.code === 'PHOTO_REWORK_FAILED',
  );
  assert.deepEqual(await Promise.all(input.artifacts.map((artifact) => fs.readFile(artifact.asset.path))), before);
}));

test('failed selective rework does not expose an approved artifact', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 3);
  await assert.rejects(() => reworkRealPhotoFiles(input, { provider: { generateImage: async () => ({ bytes: png(1280, 1280, 1), mimeType: 'image/png' }) }, outputRoot: root }), (error) => error.code === 'PHOTO_REWORK_FAILED' && error.details?.quality?.approvedMediaArtifact === undefined);
}));

test('rework with a provider failure leaves originals unchanged and stops', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 3);
  const before = await fs.readFile(input.artifacts[2].asset.path);
  await assert.rejects(() => reworkRealPhotoFiles(input, { provider: { generateImage: async () => { throw new Error('rework offline'); } }, outputRoot: root }), (error) => error.code === 'PHOTO_PROVIDER_FAILURE');
  assert.deepEqual(await fs.readFile(input.artifacts[2].asset.path), before);
}));

test('rework rejects output paths outside the injected root', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 3);
  input.artifacts[0].asset.path = path.join(root, '..', 'escape.png');
  await assert.rejects(() => reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root }), (error) => error.code === 'PHOTO_QUALITY_RESULT_MISMATCH');
}));

test('rework rejects changed output bytes before provider calls', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 3);
  await fs.writeFile(input.artifacts[0].asset.path, png(1280, 1280, 100));
  const calls = [];
  await assert.rejects(() => reworkRealPhotoFiles(input, { provider: providerFor({ calls }), outputRoot: root }), (error) => error.code === 'PHOTO_QUALITY_RESULT_MISMATCH');
  assert.equal(calls.length, 0);
}));

test('rework output contains no staging or backup files after success', async () => withRoot(async (root) => {
  const input = await makeReworkInput(root, 3);
  await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root });
  assert.deepEqual((await fs.readdir(root)).filter((name) => name.startsWith('.photo-')), []);
  assert.deepEqual((await fs.readdir(path.dirname(input.artifacts[0].asset.path))).filter((name) => name.includes('backup')), []);
}));

test('real production errors preserve their stable error identity', () => {
  const error = new RealPhotoProductionError('example', 'EXAMPLE');
  assert.equal(error.name, 'RealPhotoProductionError');
  assert.equal(error.code, 'EXAMPLE');
});

const additionalContractChecks = [
  ['production plan remains READY before real generation', async () => assert.equal(planFor().status, PHOTO_STATUSES.READY)],
  ['production uses all five planned roles', async () => assert.deepEqual(planFor().photos.map((photo) => photo.role), PHOTO_ROLE_ORDER)],
  ['sourceFacts are required by fresh production', async () => withRoot((root) => assert.rejects(() => produceRealPhotoFiles({ plan: planFor() }, { provider: providerFor(), outputRoot: root }), TypeError))],
  ['unsupported fresh input fields are rejected', async () => withRoot((root) => assert.rejects(() => produceRealPhotoFiles({ plan: planFor(), sourceFacts: sourceFacts(), extra: true }, { provider: providerFor(), outputRoot: root }), TypeError))],
  ['unsupported rework input fields are rejected', async () => withRoot(async (root) => { const input = await makeReworkInput(root); input.extra = true; await assert.rejects(() => reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root }), TypeError); })],
  ['unsupported rework options are rejected', async () => withRoot(async (root) => { const input = await makeReworkInput(root); await assert.rejects(() => reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root, extra: true }), TypeError); })],
  ['fresh production preserves sourceFacts outside the returned artifact', async () => withRoot(async (root) => { const facts = sourceFacts(); const before = structuredClone(facts); await produceRealPhotoFiles({ plan: planFor(), sourceFacts: facts }, { provider: providerFor(), outputRoot: root }); assert.deepEqual(facts, before); })],
  ['fresh production preserves the plan version', async () => withRoot(async (root) => { const { result } = await produceReady(root, 'version'); assert.equal(result.version, 1); })],
  ['fresh production creates no approved media for technical REWORK', async () => withRoot(async (root) => { const result = await produceRealPhotoFiles({ plan: planFor('technical'), sourceFacts: sourceFacts() }, { provider: { generateImage: async () => ({ bytes: png(1279, 1280, 1), mimeType: 'image/png' }) }, outputRoot: root }); assert.equal(result.approvedMediaArtifact, undefined); })],
  ['fresh output root is respected without repository-relative fallback', async () => withRoot(async (root) => { const { result } = await produceReady(root, 'root'); assert.equal(result.files.every((file) => file.startsWith(root)), true); })],
  ['provider ids are preserved in artifact metadata', async () => withRoot(async (root) => { const { result } = await produceReady(root, 'provider-ids'); assert.equal(result.artifacts[0].providerArtifactId, 'provider-provider-ids-1'); })],
  ['all photo roles preserve their approved Ukrainian text', async () => withRoot(async (root) => { const { plan, result } = await produceReady(root, 'text-roles'); assert.deepEqual(result.artifacts.map((artifact) => artifact.text), plan.photos.map((photo) => photo.text)); assert.equal(result.artifacts.every((artifact) => artifact.text.every((item) => item.language === 'uk')), true); })],
  ['all generated assets are separate files', async () => withRoot(async (root) => { const { result } = await produceReady(root, 'separate'); assert.equal(new Set(result.files).size, 5); })],
  ['all generated asset hashes are distinct for distinct fixture bytes', async () => withRoot(async (root) => { const { result } = await produceReady(root, 'distinct'); assert.equal(new Set(result.artifacts.map((artifact) => artifact.hash)).size, 5); })],
  ['rework preserves product identity', async () => withRoot(async (root) => { const input = await makeReworkInput(root); const result = await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root }); assert.equal(result.productKey, input.plan.productKey); })],
  ['rework preserves canonical roles', async () => withRoot(async (root) => { const input = await makeReworkInput(root); const result = await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root }); assert.deepEqual(result.artifacts.map((artifact) => artifact.role), PHOTO_ROLE_ORDER); })],
  ['rework preserves Ukrainian text metadata', async () => withRoot(async (root) => { const input = await makeReworkInput(root); const result = await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root }); assert.equal(result.artifacts[0].text[0].language, 'uk'); })],
  ['rework quality remains structural-only', async () => withRoot(async (root) => { const input = await makeReworkInput(root); const result = await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root }); assert.equal(result.quality.fidelityVerification, 'STRUCTURAL_ONLY'); })],
  ['rework target receives output requirements', async () => withRoot(async (root) => { const input = await makeReworkInput(root); let requirements; await reworkRealPhotoFiles(input, { provider: providerFor({ onCall: async (request) => { requirements = request.outputRequirements; } }), outputRoot: root }); assert.deepEqual(requirements, { width: 1280, height: 1280, format: 'png' }); })],
  ['rework target receives original source refs', async () => withRoot(async (root) => { const input = await makeReworkInput(root); let refs; await reworkRealPhotoFiles(input, { provider: providerFor({ onCall: async (request) => { refs = request.sourceImageRefs; } }), outputRoot: root }); assert.deepEqual(refs, input.plan.sourceImageRefs); })],
  ['rework target receives no economic claim', async () => withRoot(async (root) => { const input = await makeReworkInput(root); let request; await reworkRealPhotoFiles(input, { provider: providerFor({ onCall: async (value) => { request = JSON.stringify(value); } }), outputRoot: root }); assert.doesNotMatch(request, /purchasePrice|commission|230/u); })],
  ['rework creates exactly five final files', async () => withRoot(async (root) => { const input = await makeReworkInput(root); const result = await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root }); assert.equal((await fs.readdir(path.dirname(result.files[0]))).length, 5); })],
  ['rework approved artifact uses exact final paths', async () => withRoot(async (root) => { const input = await makeReworkInput(root); const result = await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root }); assert.deepEqual(result.approvedMediaArtifact.photos.map((photo) => photo.assetRef), result.files); })],
  ['rework target hash changes to generated bytes', async () => withRoot(async (root) => { const input = await makeReworkInput(root); const bytes = png(1280, 1280, 88); const result = await reworkRealPhotoFiles(input, { provider: { generateImage: async () => ({ bytes, mimeType: 'image/png' }) }, outputRoot: root }); assert.equal(result.artifacts[2].hash, hash(bytes)); })],
  ['rework original quality remains unchanged after success', async () => withRoot(async (root) => { const input = await makeReworkInput(root); const before = structuredClone(input.quality); await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root }); assert.deepEqual(input.quality, before); })],
  ['safe folder names never contain traversal', async () => assert.doesNotMatch(realPhotoFolderName('../x'), /\.\./u)],
  ['safe folder names retain no source key as a path segment', async () => assert.doesNotMatch(realPhotoFolderName('product/one'), /product[\\/]one/u)],
  ['real output filenames carry PNG extension', async () => assert.equal(Object.values(PHOTO_ROLE_ORDER.reduce((map, role) => ({ ...map, [role]: realPhotoFilename(role) }), {})).every((name) => name.endsWith('.png')), true)],
  ['technical validator reports byte size', async () => assert.ok(inspectPngBytes(png()).size > 0)],
  ['technical validator reports deterministic hash', async () => assert.equal(inspectPngBytes(png()).hash, inspectPngBytes(png()).hash)],
  ['real provider does not get a filesystem output path to control', async () => withRoot(async (root) => { let request; await produceReady(root, 'no-provider-path', providerFor({ onCall: async (value) => { request = value; } })); assert.equal(Object.hasOwn(request, 'outputPath'), false); })],
  ['provider response cannot select another product key', async () => withRoot(async (root) => { const { result } = await produceReady(root, 'identity'); assert.equal(result.artifacts.every((artifact) => artifact.productKey === 'identity'), true); })],
  ['rework uses the same safe folder', async () => withRoot(async (root) => { const input = await makeReworkInput(root); const result = await reworkRealPhotoFiles(input, { provider: providerFor(), outputRoot: root }); assert.equal(path.dirname(result.files[0]), path.join(root, realPhotoFolderName(input.plan.productKey))); })],
];

for (const [name, callback] of additionalContractChecks) test(name, callback);


test('built-in photo importer checks reviewed bytes, requires visual QA, and makes no provider calls', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-photo-import-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const plan = planFor();
  const files = [];
  for (let i = 1; i <= 5; i++) {
    const bytes = png(1280, 1280, i);
    const filePath = path.join(root, `${i}.png`);
    await fs.writeFile(filePath, bytes);
    files.push({ photoIndex: i, path: filePath, sha256: hash(bytes) });
  }
  const input = { plan, files, sourceFacts: sourceFacts() };
  const unreviewed = await importCodexPhotoFiles(input);
  assert.equal(unreviewed.quality.status, 'REVIEW');
  assert.equal(unreviewed.quality.approvedMediaArtifact, undefined);
  // Simulated checklist for fixture bytes, never a production visual approval.
  const visualQa = { productKey: plan.productKey, version: plan.version, verification: 'OPERATOR_CHECKLIST', status: 'READY',
    photos: unreviewed.quality.visualQa.photos.map((p) => ({ ...p,
      observedText: input.plan.photos.find((photo) => photo.index === p.photoIndex).text.map((item) => item.value),
      checks: Object.fromEntries(Object.keys(p.checks).map((key) => [key, true])) })),
  };
  const reviewed = await importCodexPhotoFiles({ ...input, visualQa });
  assert.equal(reviewed.quality.status, 'READY');
  assert.equal(reviewed.quality.approvedMediaArtifact.photos.length, 5);
  const wrongTextQa = structuredClone(visualQa);
  wrongTextQa.photos[1].observedText = ['Вигаданий напис'];
  const wrongText = await importCodexPhotoFiles({ ...input, visualQa: wrongTextQa });
  assert.equal(wrongText.quality.status, 'REWORK');
  assert.equal(wrongText.quality.approvedMediaArtifact, undefined);
  await fs.writeFile(files[0].path, png(1280, 1280, 99));
  await assert.rejects(() => importCodexPhotoFiles({ ...input, visualQa }), /changed after review/);
});
