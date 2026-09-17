import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runCategoryCli } from '../../src/cli/category.mjs';

test('category CLI bootstraps the real template and persists an honest waiting result', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'category-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'templates'));
  await fs.mkdir(path.join(root, 'config'));
  await fs.copyFile(new URL('../../templates/prom-reference.xlsx', import.meta.url), path.join(root, 'templates/prom-reference.xlsx'));
  await fs.copyFile(new URL('../../config/photo-styles.json', import.meta.url), path.join(root, 'config/photo-styles.json'));
  await fs.copyFile(new URL('../../config/google-drive-media.json', import.meta.url), path.join(root, 'config/google-drive-media.json'));
  const requestPath = path.join(root, 'request.json');
  const resultPath = path.join(root, 'outputs/result.json');
  await fs.writeFile(requestPath, JSON.stringify({ categoryUrl: 'https://ug-opt.in.ua/ua/g123-test', export: { outputPath: 'outputs/products.xlsx' } }));
  const result = await runCategoryCli(['--request', requestPath, '--result', resultPath], { root, runner: async (request, options) => {
    assert.equal(request.categoryUrl, 'https://ug-opt.in.ua/ua/g123-test');
    assert.equal(request.export.inputPath, path.join(root, 'runtime/prom/master-template.xlsx'));
    assert.ok(Object.keys(options.registry.byCode).length > 900);
    assert.equal(options.driveMedia.config.productImagesFolderId, '1quplTV97b3geOQu5dn_AJXFLYbEmcNpN');
    return { status: 'WAITING_FOR_OPERATOR', export: null, operatorTasks: [{ taskType: 'CONTENT_GENERATION' }] };
  } });
  assert.equal(result.status, 'WAITING_FOR_OPERATOR');
  assert.equal(JSON.parse(await fs.readFile(resultPath)).repository.entrypoint, 'npm run category');
  await assert.rejects(() => fs.access(path.join(root, 'outputs/products.xlsx')));
  await assert.rejects(() => fs.access(path.join(root, 'runtime/category-run.lock')));
});


test('category CLI reopens durable state instead of losing accepted product fields', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'category-resume-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'config'));
  await fs.copyFile(new URL('../../config/photo-styles.json', import.meta.url), path.join(root, 'config/photo-styles.json'));
  await fs.copyFile(new URL('../../config/google-drive-media.json', import.meta.url), path.join(root, 'config/google-drive-media.json'));
  const requestPath = path.join(root, 'request.json');
  const resultPath = path.join(root, 'result.json');
  const request = { categoryUrl: 'https://ug-opt.in.ua/ua/g123-test', productInputs: { 'ugopt:test': { sourceFacts: { type: 'Фен' } } } };
  await fs.writeFile(requestPath, JSON.stringify(request));
  const bootstrap = async () => ({ status: 'BOOTSTRAPPED', registry: { byCode: {} }, bootstrapId: 'test', masterTemplatePath: 'test.xlsx' });
  let runId;
  await runCategoryCli(['--request', requestPath, '--result', resultPath], { root, bootstrap, runner: async (_, options) => {
    runId = options.runId;
    options.stateStore.saveArtifact(runId, 'ugopt:test', 'contentArtifact', { productKey: 'ugopt:test', version: 1 }, { source: 'test' });
    return { status: 'WAITING_FOR_OPERATOR', products: [], operatorTasks: [], export: null };
  } });
  request.productInputs['ugopt:test'] = { resolvedMetadata: { unit: 'шт.' } };
  await fs.writeFile(requestPath, JSON.stringify(request));
  await runCategoryCli(['--request', requestPath, '--result', resultPath], { root, bootstrap, runner: async (_, options) => {
    assert.equal(options.runId, runId);
    const saved = options.stateStore.reconstructRequest(runId).productInputs['ugopt:test'];
    assert.equal(saved.sourceFacts.type, 'Фен');
    assert.equal(saved.contentArtifact.version, 1);
    assert.equal(saved.resolvedMetadata.unit, 'шт.');
    return { status: 'WAITING_FOR_OPERATOR', products: [], operatorTasks: [], export: null };
  } });
});


test('short requests remember the configured catalog, default the workbook path and preserve batch selection', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'category-short-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'config'));
  for (const file of ['photo-styles.json', 'google-drive-media.json', 'category-workflow.json']) {
    await fs.copyFile(new URL(`../../config/${file}`, import.meta.url), path.join(root, 'config', file));
  }
  const requestPath = path.join(root, 'request.json');
  const resultPath = path.join(root, 'outputs/batch-1.json');
  const sourcePaths = [];
  const bootstrap = async ({ sourcePath }) => {
    sourcePaths.push(sourcePath);
    return { status: 'BOOTSTRAPPED', registry: { byCode: {} }, bootstrapId: 'test', masterTemplatePath: 'master.xlsx' };
  };
  const selection = { targetCount: 100, selectedProductKeys: ['ugopt:1', 'ugopt:2'] };
  await fs.writeFile(requestPath, JSON.stringify({ categoryUrl: 'https://ug-opt.in.ua/ua/g123-test', targetCount: 100,
    export: { inputPath: 'catalog/current.xlsx' } }));
  await runCategoryCli(['--request', requestPath, '--result', resultPath], { root, bootstrap, runner: async (request) => {
    assert.equal(request.export.outputPath, path.join(root, 'outputs/batch-1.xlsx'));
    assert.equal(request.targetCount, 100);
    return { status: 'WAITING_FOR_OPERATOR', products: [], operatorTasks: [], export: null, selection };
  } });
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'config/category-workflow.json'))).catalogPath, 'catalog/current.xlsx');
  await fs.writeFile(requestPath, JSON.stringify({ categoryUrl: 'https://ug-opt.in.ua/ua/g123-test', targetCount: 100 }));
  await runCategoryCli(['--request', requestPath, '--result', resultPath], { root, bootstrap, runner: async (request) => {
    assert.deepEqual(request.selectedProductKeys, selection.selectedProductKeys);
    return { status: 'WAITING_FOR_OPERATOR', products: [], operatorTasks: [], export: null, selection };
  } });
  assert.deepEqual(sourcePaths, [path.join(root, 'catalog/current.xlsx'), path.join(root, 'catalog/current.xlsx')]);
  await fs.writeFile(requestPath, JSON.stringify({ categoryUrl: 'https://ug-opt.in.ua/ua/g123-test', targetCount: 50 }));
  await assert.rejects(() => runCategoryCli(['--request', requestPath, '--result', resultPath], { root, bootstrap }), /Changing targetCount/);
});
