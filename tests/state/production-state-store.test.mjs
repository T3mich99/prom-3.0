import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDurableProductionService } from '../../src/operations/durable-production-service.mjs';
import { DURABLE_TASK_STATES, openProductionStateStore, PRODUCTION_STATE_SCHEMA_VERSION } from '../../src/state/production-state-store.mjs';

function harness() {
  let tick = 0;
  return {
    clock: { now: () => `2026-09-13T10:00:${String(tick++).padStart(2, '0')}.000Z` },
    idGenerator: (() => { let id = 0; return (prefix) => `${prefix}-${++id}`; })(),
  };
}

function request() {
  return { mode: 'EXPLICIT_CATEGORIES', categories: [], productInputs: { product: { sourceFacts: { productKey: 'product' } } } };
}

function marketTask() {
  return { taskType: 'MARKET_RESEARCH', productKey: 'product', taskVersion: 'market-research-v1', input: { productKey: 'product' }, instructions: {}, expectedResultSchema: {}, validationAuthority: 'PR22' };
}

function waitingResult(task = marketTask()) {
  return {
    status: 'WAITING_FOR_OPERATOR',
    summary: { waitingMarketResearch: 1 },
    products: [{ productKey: 'product', workflowStatus: 'WAITING_FOR_MARKET_RESEARCH', diagnostics: [], nextAction: { type: 'OPERATOR_TASK', task } }],
    operatorTasks: [task],
  };
}

test('state store creates schema v1, persists a run, and keeps durable task state', () => {
  const { clock, idGenerator } = harness();
  const store = openProductionStateStore({ databasePath: ':memory:', clock, idGenerator });
  const run = store.createRun({ runId: 'run-1', request: request() });
  assert.equal(store.schemaVersion, PRODUCTION_STATE_SCHEMA_VERSION);
  assert.equal(run.runId, 'run-1');
  store.persistRunResult('run-1', waitingResult());
  const task = store.listOperatorTasks('run-1')[0];
  assert.equal(task.state, DURABLE_TASK_STATES.WAITING);
  assert.equal(task.taskType, 'MARKET_RESEARCH');
  store.close();
});

test('committed task state survives a database reopen and a failed transition rolls back', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'production-state-'));
  const databasePath = path.join(root, 'state.sqlite');
  const { clock, idGenerator } = harness();
  let store = openProductionStateStore({ databasePath, clock, idGenerator });
  store.createRun({ runId: 'reopen', request: request() });
  store.persistRunResult('reopen', waitingResult());
  assert.throws(() => store.persistRunResult('reopen', { status: 'FAILED', summary: {}, products: [{ productKey: 'valid', workflowStatus: 'FAILED', diagnostics: [] }, { workflowStatus: 'FAILED', diagnostics: [] }], operatorTasks: [] }), /require productKey/u);
  store.close();
  store = openProductionStateStore({ databasePath, clock, idGenerator });
  assert.equal(store.listOperatorTasks('reopen').length, 1);
  assert.equal(store.getRun('reopen').result.status, 'WAITING_FOR_OPERATOR');
  store.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('same task result is idempotent while a different result cannot overwrite completed work', () => {
  const { clock, idGenerator } = harness();
  const store = openProductionStateStore({ databasePath: ':memory:', clock, idGenerator });
  store.createRun({ runId: 'run-2', request: request() });
  store.persistRunResult('run-2', waitingResult());
  const task = store.listOperatorTasks('run-2')[0];
  const artifact = { productKey: 'product', comparables: [] };
  assert.equal(store.completeOperatorTask({ runId: 'run-2', taskId: task.taskId, artifactType: 'marketEvidence', artifact }).idempotent, false);
  assert.equal(store.completeOperatorTask({ runId: 'run-2', taskId: task.taskId, artifactType: 'marketEvidence', artifact }).idempotent, true);
  assert.throws(() => store.completeOperatorTask({ runId: 'run-2', taskId: task.taskId, artifactType: 'marketEvidence', artifact: { productKey: 'product', comparables: [{ source: 'changed' }] } }), /already completed/u);
  store.close();
});

test('wrong-product import is rejected and leaves the original task waiting', () => {
  const { clock, idGenerator } = harness();
  const store = openProductionStateStore({ databasePath: ':memory:', clock, idGenerator });
  store.createRun({ runId: 'run-3', request: request() });
  store.persistRunResult('run-3', waitingResult());
  const task = store.listOperatorTasks('run-3')[0];
  assert.throws(() => store.completeOperatorTask({ runId: 'run-3', taskId: task.taskId, artifactType: 'marketEvidence', artifact: { productKey: 'wrong', comparables: [] } }), /does not match/u);
  assert.equal(store.listOperatorTasks('run-3').length, 1);
  store.close();
});

test('durable service imports market evidence and routes reconstructed input through its runner', async () => {
  const { clock, idGenerator } = harness();
  const store = openProductionStateStore({ databasePath: ':memory:', clock, idGenerator });
  const seen = [];
  const service = createDurableProductionService({ store, runner: async (input) => { seen.push(input); return waitingResult(); } });
  await service.createDurableProductionRun({ runId: 'run-4', request: request() });
  await service.resumeDurableProductionRun({ runId: 'run-4' });
  assert.equal(store.listAlerts({ runId: 'run-4' }).length, 1);
  const task = store.listOperatorTasks('run-4')[0];
  service.importDurableOperatorArtifacts({ runId: 'run-4', artifacts: [{ taskId: task.taskId, taskType: 'MARKET_RESEARCH', artifact: { productKey: 'product', comparables: [] } }] });
  await service.resumeDurableProductionRun({ runId: 'run-4' });
  assert.deepEqual(seen[1].productInputs.product.marketEvidence, { productKey: 'product', comparables: [] });
  store.close();
});

test('market, content, photo, media, and export stages survive close/reopen without duplicate waiting tasks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'production-resume-'));
  const databasePath = path.join(root, 'state.sqlite');
  const { clock, idGenerator } = harness();
  const runner = async (input) => {
    const values = input.productInputs.product ?? {};
    const next = (taskType, taskVersion) => ({
      status: 'WAITING_FOR_OPERATOR', summary: {}, products: [{ productKey: 'product', workflowStatus: taskType === 'MEDIA_PUBLICATION' ? 'WAITING_FOR_MEDIA_PUBLICATION' : `WAITING_FOR_${taskType}`, diagnostics: [], approvedMedia: values.photoArtifact?.approvedMedia, photoArtifact: values.photoArtifact }],
      operatorTasks: taskType === 'MEDIA_PUBLICATION' ? [] : [{ taskType, productKey: 'product', taskVersion, input: { productKey: 'product' }, instructions: {}, expectedResultSchema: {}, validationAuthority: 'test' }],
    });
    if (!values.marketEvidence) return next('MARKET_RESEARCH', 'market-research-v1');
    if (!values.contentArtifact) return next('CONTENT_GENERATION', 'content-generation-v1');
    if (!values.photoArtifact) return next('PHOTO_GENERATION', 'photo-generation-v1');
    if (!values.publishableMedia) return next('MEDIA_PUBLICATION', 'publishable-media-v1');
    return { status: 'COMPLETED', summary: { exported: 1 }, products: [{ productKey: 'product', workflowStatus: 'EXPORTED', diagnostics: [] }], operatorTasks: [] };
  };
  let store = openProductionStateStore({ databasePath, clock, idGenerator });
  let service = createDurableProductionService({ store, runner });
  await service.createDurableProductionRun({ runId: 'sequence', request: request() });
  const importAndResume = async (artifact) => {
    await service.resumeDurableProductionRun({ runId: 'sequence' });
    const task = store.listOperatorTasks('sequence')[0];
    service.importDurableOperatorArtifacts({ runId: 'sequence', artifacts: [{ taskId: task.taskId, taskType: task.taskType, artifact }] });
  };
  await importAndResume({ productKey: 'product', comparables: [] });
  store.close();
  store = openProductionStateStore({ databasePath, clock, idGenerator });
  service = createDurableProductionService({ store, runner });
  await importAndResume({ productKey: 'product', version: 1, title: {}, description: {}, keywords: {}, characteristics: [] });
  await importAndResume({ productKey: 'product', approvedMedia: { productKey: 'product', photos: [] } });
  await importAndResume({ productKey: 'product', items: [] });
  const final = await service.resumeDurableProductionRun({ runId: 'sequence' });
  assert.equal(final.result.status, 'COMPLETED');
  assert.equal(final.waitingTasks.length, 0);
  store.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('lease rejects a second active owner and permits recovery after expiry', () => {
  const { idGenerator } = harness();
  let current = '2026-09-13T10:00:00.000Z';
  const store = openProductionStateStore({ databasePath: ':memory:', clock: { now: () => current }, idGenerator });
  assert.equal(store.acquireLease({ leaseKey: 'scheduler', ownerId: 'a', leaseDurationMs: 1000 }).acquired, true);
  assert.equal(store.acquireLease({ leaseKey: 'scheduler', ownerId: 'b', leaseDurationMs: 1000 }).acquired, false);
  current = '2026-09-13T10:00:02.000Z';
  assert.equal(store.acquireLease({ leaseKey: 'scheduler', ownerId: 'b', leaseDurationMs: 1000 }).acquired, true);
  store.close();
});

test('persists 100, 1000, and 6000 independent operator tasks', () => {
  for (const count of [100, 1000, 6000]) {
    const { clock, idGenerator } = harness();
    const store = openProductionStateStore({ databasePath: ':memory:', clock, idGenerator });
    store.createRun({ runId: `run-${count}`, request: request() });
    const tasks = Array.from({ length: count }, (_, index) => ({ taskType: 'MARKET_RESEARCH', productKey: `product-${index}`, taskVersion: 'market-research-v1', input: { productKey: `product-${index}` }, instructions: {}, expectedResultSchema: {}, validationAuthority: 'PR22' }));
    const products = tasks.map((task) => ({ productKey: task.productKey, workflowStatus: 'WAITING_FOR_MARKET_RESEARCH', diagnostics: [] }));
    store.persistRunResult(`run-${count}`, { status: 'WAITING_FOR_OPERATOR', summary: {}, products, operatorTasks: tasks });
    assert.equal(store.listOperatorTasks(`run-${count}`).length, count);
    store.close();
  }
});
