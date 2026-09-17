import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { REPOSITORY_ROOT } from '../config/paths.mjs';
import { runCategoryProduction, normalizeCategoryProductionRequest } from '../orchestration/category-production-runner.mjs';
import { bootstrapPromCatalog, reservePromProductCode } from '../excel/prom-catalog-bootstrap.mjs';
import { openProductionStateStore } from '../state/production-state-store.mjs';
import { validatePhotoCreativeBrief } from '../photos/photo-creative-brief.mjs';
import { loadRepositoryGoogleDriveMediaConfig, saveGoogleDriveMediaConfig } from '../media/google-drive-media-config.mjs';

function argumentsFrom(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--request', '--result'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Usage: npm run category -- --request request.json --result outputs/result.json');
    if (args[key]) throw new Error(`Duplicate argument: ${key}`);
    args[key] = argv[i + 1];
  }
  if (!args['--request'] || !args['--result']) throw new Error('Usage: npm run category -- --request request.json --result outputs/result.json');
  return args;
}

export async function runCategoryCli(argv, { runner = runCategoryProduction, bootstrap = bootstrapPromCatalog, reserve = reservePromProductCode, root = REPOSITORY_ROOT } = {}) {
  const args = argumentsFrom(argv);
  const requestPath = path.resolve(args['--request']);
  const resultPath = path.resolve(args['--result']);
  if (requestPath === resultPath) throw new Error('Result must not overwrite the request');
  const request = JSON.parse(await fs.readFile(requestPath, 'utf8'));
  // The user supplies a category URL. The CLI never picks a different category.
  if (!request.categoryUrl || request.categoryId !== undefined) throw new Error('Provide categoryUrl from UG-OPT in the request');
  const categoryUrl = new URL(request.categoryUrl);
  if (categoryUrl.protocol !== 'https:' || !['ug-opt.in.ua', 'www.ug-opt.in.ua'].includes(categoryUrl.hostname)) throw new Error('categoryUrl must be an HTTPS UG-OPT URL');
  const workflowPath = path.join(root, 'config/category-workflow.json');
  const workflow = await fs.readFile(workflowPath, 'utf8').then(JSON.parse).catch((error) => {
    if (error.code === 'ENOENT') return { version: 1, catalogPath: 'templates/prom-reference.xlsx' };
    throw error;
  });
  if (workflow.version !== 1 || typeof workflow.catalogPath !== 'string' || !workflow.catalogPath.trim()) throw new Error('Invalid saved category workflow');
  const templatePath = path.resolve(root, request.export?.inputPath ?? workflow.catalogPath);
  // Short user requests still produce an XLSX. The agent supplies only category
  // and count; the source catalog and output destination have durable defaults.
  request.export = { ...request.export, inputPath: templatePath,
    outputPath: request.export?.outputPath ?? resultPath.replace(/\.json$/iu, '') + '.xlsx' };
  if ([templatePath, path.resolve(root, request.export?.outputPath ?? 'outputs/category.xlsx')].includes(resultPath)) throw new Error('Result JSON must not overwrite a workbook');
  const runtime = path.join(root, 'runtime');
  await fs.mkdir(runtime, { recursive: true });
  const lockPath = path.join(runtime, 'category-run.lock');
  const lock = await fs.open(lockPath, 'wx').catch((error) => {
    if (error.code === 'EEXIST') throw new Error('A category run is active or a previous run was interrupted. Inspect runtime/category-run.lock before removing a stale lock.');
    throw error;
  });
  let stateStore;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, requestPath, resultPath }));
    const dbPath = path.join(runtime, 'prom-category.sqlite');
    const boot = await bootstrap({ sourcePath: templatePath, dbPath, masterTemplatePath: path.join(runtime, 'prom/master-template.xlsx') });
    if (boot.status !== 'BOOTSTRAPPED') throw new Error(`Prom template needs reconciliation: ${boot.status}`);
    if (path.resolve(root, workflow.catalogPath) !== templatePath) {
      // Remember only a successfully validated catalog; never silently reset
      // an existing registry when a newer export requires reconciliation.
      await fs.mkdir(path.dirname(workflowPath), { recursive: true });
      await fs.writeFile(workflowPath + '.tmp', JSON.stringify({ ...workflow,
        catalogPath: path.relative(root, templatePath) }, null, 2) + '\n');
      await fs.rename(workflowPath + '.tmp', workflowPath);
    }
    if (request.export) request.export = { ...request.export, inputPath: boot.masterTemplatePath, outputPath: path.resolve(root, request.export.outputPath) };
    normalizeCategoryProductionRequest(request);
    const driveConfig = await loadRepositoryGoogleDriveMediaConfig({ filePath: path.join(root, 'config/google-drive-media.json') });
    await saveGoogleDriveMediaConfig({ dbPath, config: driveConfig });
    const previousResult = await fs.readFile(resultPath, 'utf8').then(JSON.parse).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (previousResult?.export?.status === 'EXPORTED') {
      throw new Error('This result already records an exported workbook. Reconcile pending reservations if needed; keep this checkpoint and use a new result path for a new batch.');
    }
    if (previousResult?.selection) {
      if ((request.targetCount ?? null) !== previousResult.selection.targetCount) {
        throw new Error('Changing targetCount requires a new batch/result path');
      }
      if (request.targetCount !== undefined && previousResult.selection.selectedProductKeys.length > 0) {
        request.selectedProductKeys = previousResult.selection.selectedProductKeys;
      }
    }
    stateStore = openProductionStateStore({ databasePath: path.join(runtime, 'category-state.sqlite') });
    const runId = 'category-' + createHash('sha256').update(JSON.stringify([request.categoryUrl, requestPath, resultPath])).digest('hex').slice(0, 24);
    if (!stateStore.getRun(runId)) stateStore.createRun({ runId, request });
    // Keep accepted object artifacts even when only one field is supplied on resume.
    // The request file remains the durable source for sourceText/sourceImages and partial image progress.
    for (const [productKey, input] of Object.entries(request.productInputs ?? {})) {
      for (const [field, value] of Object.entries(input)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) stateStore.saveArtifact(runId, productKey, field, value, { source: 'category-request' });
      }
    }
    const historyPath = path.join(runtime, 'photo-creative-history.json');
    const creativeHistory = await fs.readFile(historyPath, 'utf8').then(JSON.parse).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    if (!Array.isArray(creativeHistory)) throw new Error('Invalid creative history');
    for (const brief of creativeHistory) validatePhotoCreativeBrief(brief, brief.productKey);
    const result = await runner(request, { registry: boot.registry, stateStore, runId,
      photos: { usedCreativeBriefs: creativeHistory }, driveMedia: { config: driveConfig, outputRoot: root } });
    const resumed = stateStore.reconstructRequest(runId);
    const historyByProduct = new Map(creativeHistory.map((brief) => [brief.productKey, brief]));
    for (const product of result.products ?? []) {
      const brief = resumed.productInputs?.[product.productKey]?.photoCreativeBrief;
      if (brief && product.photoArtifact?.plan?.status === 'READY') {
        validatePhotoCreativeBrief(brief, product.productKey);
        historyByProduct.set(product.productKey, brief);
      }
    }
    result.repository = {
      entrypoint: 'npm run category', templateSha256: boot.masterBinarySha256,
      photoRulesSha256: createHash('sha256').update(await fs.readFile(path.join(root, 'config/photo-styles.json'))).digest('hex'),
      bootstrapId: boot.bootstrapId,
      catalogSourcePath: templatePath,
      runId,
      executionMode: 'CODEX_BUILT_IN_TOOLS_NO_API_FALLBACK',
      productImagesFolderId: driveConfig.productImagesFolderId,
    };
    // Persist the result before reservations as an explicit recovery checkpoint.
    await fs.mkdir(path.dirname(resultPath), { recursive: true });
    const saveResult = async () => {
      const staged = `${resultPath}.tmp`;
      await fs.writeFile(staged, JSON.stringify(result, null, 2) + '\n');
      await fs.rename(staged, resultPath);
    };
    if (result.export?.status === 'EXPORTED') result.reservationStatus = 'PENDING';
    await saveResult();
    await fs.writeFile(historyPath + '.tmp', JSON.stringify([...historyByProduct.values()], null, 2) + '\n');
    await fs.rename(historyPath + '.tmp', historyPath);
    if (result.export?.status === 'EXPORTED') {
      result.reservations = [];
      for (const product of result.export.products) {
        result.reservations.push(await reserve({ dbPath, bootstrapId: boot.bootstrapId, productCode: product.productCode, productKey: product.productKey, batchId: resultPath }));
      }
      result.reservationStatus = result.reservations.every((item) => item.status === 'RESERVED_FOR_IMPORT') ? 'COMPLETE' : 'REVIEW_REQUIRED';
      if (result.reservationStatus !== 'COMPLETE') result.status = 'REVIEW_REQUIRED';
      await saveResult();
    }
    return result;
  } finally {
    stateStore?.close();
    await lock.close();
    await fs.rm(lockPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCategoryCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${result.status}: ${result.operatorTasks?.length ?? 0} operator tasks; export ${result.export?.status ?? 'not ready'}\n`);
    process.exitCode = ['FAILED', 'REVIEW_REQUIRED'].includes(result.status) ? 1 : 0;
  }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
