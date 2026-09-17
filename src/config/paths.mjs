import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const REPOSITORY_ROOT = path.resolve(moduleDirectory, '..', '..');
export const WORKSPACE_ROOT = REPOSITORY_ROOT;

function nonBlank(value) {
  return value !== undefined && value !== null && String(value).trim() !== '' ? String(value).trim() : '';
}

export function resolveRepositoryPath(...segments) {
  return path.resolve(REPOSITORY_ROOT, ...segments);
}

export function resolveConfiguredPath({
  explicit,
  envName,
  defaultPath,
  defaultRelative,
  env = process.env,
} = {}) {
  const configured = nonBlank(explicit)
    || (envName ? nonBlank(env?.[envName]) : '')
    || nonBlank(defaultPath)
    || nonBlank(defaultRelative);
  if (!configured) throw new Error('A path requires an explicit value, environment override, or repository-relative default');
  return path.isAbsolute(configured) ? path.normalize(configured) : resolveRepositoryPath(configured);
}

export function resolveInputPath(explicit, options = {}) {
  return resolveConfiguredPath({ ...options, explicit });
}

export function resolveOutputPath(explicit, options = {}) {
  return resolveConfiguredPath({ ...options, explicit });
}

export function resolveTemporaryPath(explicit, options = {}) {
  return resolveConfiguredPath({ ...options, explicit });
}
