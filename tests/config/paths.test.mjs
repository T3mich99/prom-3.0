import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  REPOSITORY_ROOT,
  WORKSPACE_ROOT,
  resolveConfiguredPath,
  resolveInputPath,
  resolveOutputPath,
  resolveRepositoryPath,
  resolveTemporaryPath,
} from '../../src/config/paths.mjs';

test('repository and workspace roots resolve from the module location', async () => {
  assert.equal(REPOSITORY_ROOT, WORKSPACE_ROOT);
  assert.equal(path.isAbsolute(REPOSITORY_ROOT), true);
  await fs.access(resolveRepositoryPath('ARCHITECTURE.md'));
});

test('relative paths resolve under the repository root, including spaces', () => {
  const relative = path.join('tests', 'fixtures', 'folder with spaces', 'input.xlsx');
  assert.equal(resolveRepositoryPath(relative), path.resolve(REPOSITORY_ROOT, relative));
  assert.equal(resolveInputPath(undefined, { defaultRelative: relative }), path.resolve(REPOSITORY_ROOT, relative));
});

test('explicit path has priority over environment and repository defaults', () => {
  const env = { PRODUCT_AUTOMATION_INPUT: 'env/input.xlsx' };
  assert.equal(
    resolveConfiguredPath({
      explicit: 'explicit/input.xlsx',
      envName: 'PRODUCT_AUTOMATION_INPUT',
      defaultRelative: 'default/input.xlsx',
      env,
    }),
    path.resolve(REPOSITORY_ROOT, 'explicit/input.xlsx'),
  );
});

test('environment path overrides the repository-relative default', () => {
  const env = { PRODUCT_AUTOMATION_OUTPUT: 'configured/output.xlsx' };
  assert.equal(
    resolveOutputPath(undefined, {
      envName: 'PRODUCT_AUTOMATION_OUTPUT',
      defaultRelative: 'default/output.xlsx',
      env,
    }),
    path.resolve(REPOSITORY_ROOT, 'configured/output.xlsx'),
  );
});

test('an absolute default preserves the caller working directory', () => {
  assert.equal(
    resolveOutputPath(undefined, {
      envName: 'PROM_INSPECT_OUTPUT_DIR',
      defaultPath: process.cwd(),
      defaultRelative: 'unused/output',
      env: {},
    }),
    path.resolve(process.cwd()),
  );
});

test('absolute paths and non-existing targets are resolved without filesystem side effects', () => {
  const absolute = path.resolve(REPOSITORY_ROOT, 'target does not exist.xlsx');
  assert.equal(resolveTemporaryPath(absolute, { defaultRelative: 'tmp/unused.xlsx' }), absolute);
  assert.equal(resolveConfiguredPath({ explicit: absolute }), absolute);
});

test('Windows-style absolute input is preserved on Windows', () => {
  const windowsPath = path.win32.join(REPOSITORY_ROOT, 'folder with spaces', 'input.xlsx');
  const resolved = resolveInputPath(windowsPath, { defaultRelative: 'default.xlsx' });
  if (process.platform === 'win32') assert.equal(resolved, path.normalize(windowsPath));
  else assert.equal(resolved, path.resolve(REPOSITORY_ROOT, windowsPath));
});

test('phase 2 batch utility roots stay repository-relative', async () => {
  const [downloadSource, finalizeSource] = await Promise.all([
    fs.readFile(path.resolve(REPOSITORY_ROOT, 'download-batch-10-sources.mjs'), 'utf8'),
    fs.readFile(path.resolve(REPOSITORY_ROOT, 'finalize-batch-10-photos.mjs'), 'utf8'),
  ]);
  assert.match(downloadSource, /resolveRepositoryPath\(\)/u);
  assert.match(finalizeSource, /resolveRepositoryPath\("outputs", "product-photos", "batch-10"\)/u);
  assert.match(finalizeSource, /import sharp from "sharp"/u);
  assert.doesNotMatch(finalizeSource, /codex-runtimes|pathToFileURL/u);
  assert.equal(
    resolveRepositoryPath('outputs', 'product-photos', 'batch-10'),
    path.resolve(REPOSITORY_ROOT, 'outputs', 'product-photos', 'batch-10'),
  );
});
