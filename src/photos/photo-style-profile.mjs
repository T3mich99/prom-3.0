import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const configPath = path.join(root, 'config/photo-styles.json');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Read on every new plan: long-lived processes must see committed corrections too.
export function resolvePhotoStyle({ productKey, categoryKey = '', family = 'general' }, options = {}) {
  const bytes = readFileSync(options.configPath ?? configPath);
  const config = JSON.parse(bytes.toString('utf8'));
  const referenceRoot = options.referenceRoot ?? root;
  if (!Number.isSafeInteger(config.version) || config.version < 1 || !record(config.global)) throw new TypeError('Invalid photo style configuration');
  for (const key of ['families', 'categories', 'products']) if (!record(config[key])) throw new TypeError(`Photo style ${key} must be an object`);
  const instructions = [];
  const references = [];
  const scopes = [];
  for (const [scope, layer] of [
    ['global', config.global], [`family:${family}`, config.families[family]],
    [`category:${categoryKey}`, config.categories[categoryKey]], [`product:${productKey}`, config.products[productKey]],
  ]) {
    if (layer === undefined) continue;
    if (!record(layer) || !Array.isArray(layer.instructions) || !Array.isArray(layer.references)) throw new TypeError(`Invalid photo style layer: ${scope}`);
    if (layer.instructions.some((value) => typeof value !== 'string' || !value.trim())) throw new TypeError(`Invalid photo style instructions: ${scope}`);
    scopes.push(scope);
    instructions.push(...layer.instructions);
    for (const entry of layer.references) {
      if (!record(entry) || typeof entry.path !== 'string' || !entry.path.startsWith('references/photos/') || typeof entry.reason !== 'string' || !entry.reason.trim()) throw new TypeError('Style reference requires a repository-relative references/photos/ path and reason');
      const absolute = path.resolve(referenceRoot, entry.path);
      if (!absolute.startsWith(path.resolve(referenceRoot, 'references/photos') + path.sep)) throw new TypeError('Style reference escapes references/photos');
      references.push({ path: entry.path, reason: entry.reason, sha256: hash(readFileSync(absolute)), authority: 'STYLE_ONLY_NOT_PRODUCT_IDENTITY' });
    }
  }
  const snapshot = { version: config.version, configSha256: hash(bytes), productKey, categoryKey, family, scopes, instructions, references };
  return { ...snapshot, fingerprint: hash(JSON.stringify(snapshot)) };
}

export function assertPhotoStyleSnapshot(snapshot) {
  if (!record(snapshot)) throw new TypeError('Photo style snapshot required; rebuild the photo plan');
  const { fingerprint, ...payload } = snapshot;
  if (fingerprint !== hash(JSON.stringify(payload))) throw new TypeError('Photo style snapshot fingerprint mismatch');
  if (!Array.isArray(snapshot.instructions) || !Array.isArray(snapshot.references)) throw new TypeError('Invalid photo style snapshot');
}

export function assertCurrentPhotoStyle(snapshot, options = {}) {
  assertPhotoStyleSnapshot(snapshot);
  const current = resolvePhotoStyle(snapshot, options);
  if (current.fingerprint !== snapshot.fingerprint) throw new TypeError('PHOTO_STYLE_CHANGED: rebuild the plan and review photos against the current repository rules');
}
