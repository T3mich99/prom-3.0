import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadRepositoryGoogleDriveMediaConfig } from '../media/google-drive-media-config.mjs';
import { cleanupPublishedLocalPhotoFiles, toPublishableMediaArtifact } from '../media/google-drive-media-publication.mjs';

export async function probePublicImage(url, { fetchImpl = fetch } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['drive.google.com', 'drive.usercontent.google.com', 'lh3.googleusercontent.com'].includes(parsed.hostname)) throw new Error('Expected a direct HTTPS image URL on Google Drive');
  const response = await fetchImpl(url, { redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(20_000) });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.toLowerCase().startsWith('image/')) {
    await response.body?.cancel();
    return { ok: false, contentType };
  }
  const hash = createHash('sha256');
  let size = 0;
  for await (const bytes of response.body) {
    size += bytes.length;
    if (size > 32 * 1024 * 1024) throw new Error('Public image exceeds 32 MiB');
    hash.update(bytes);
  }
  return { ok: size > 0, contentType, sha256: hash.digest('hex') };
}

export async function runMediaImportCli(argv, { fetchImpl = fetch } = {}) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--input', '--output'].includes(argv[i]) || !argv[i + 1] || args[argv[i]]) throw new Error('Usage: npm run category:media -- --input publication.json --output publishable-media.json');
    args[argv[i]] = argv[i + 1];
  }
  if (!args['--input'] || !args['--output']) throw new Error('Both --input and --output are required');
  const inputPath = path.resolve(args['--input']);
  const outputPath = path.resolve(args['--output']);
  if (outputPath === inputPath) throw new Error('Output must not overwrite publication input');
  if (await fs.access(outputPath).then(() => true).catch(() => false)) throw new Error('Output already exists; refusing to replace a publication result');
  const { publication, approvedMedia } = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  if (approvedMedia?.photos?.some((photo) => path.resolve(photo.assetRef) === outputPath)) throw new Error('Output must not overwrite an input');
  const config = await loadRepositoryGoogleDriveMediaConfig();
  if (publication?.folderId !== config.productImagesFolderId) throw new Error('Publication folder differs from the configured PRODUCT IMAGES destination');
  const publishableMedia = await toPublishableMediaArtifact(publication, { approvedMedia, probe: (url) => probePublicImage(url, { fetchImpl }) });
  const cleanup = await cleanupPublishedLocalPhotoFiles({
    publication,
    approvedMedia,
    publishableMedia,
    protectedPaths: [inputPath, outputPath],
  });
  const result = { ...publishableMedia, cleanup };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const stagingPath = `${outputPath}.staging`;
  try {
    await fs.writeFile(stagingPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(stagingPath, outputPath);
  } finally {
    await fs.rm(stagingPath, { force: true });
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMediaImportCli(process.argv.slice(2)).then(() => process.stdout.write('Five public images verified against approved local bytes.\n'))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
