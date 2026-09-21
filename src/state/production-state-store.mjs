import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const PRODUCTION_STATE_SCHEMA_VERSION = 1;

export const DURABLE_TASK_STATES = Object.freeze({
  WAITING: 'WAITING',
  COMPLETED: 'COMPLETED',
  SUPERSEDED: 'SUPERSEDED',
});

export class ProductionStateStoreError extends Error {
  constructor(message, code = 'PRODUCTION_STATE_STORE_ERROR', details = undefined) {
    super(message);
    this.name = 'ProductionStateStoreError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function hash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new ProductionStateStoreError(`Persisted ${label} is invalid JSON`, 'STATE_DATA_CORRUPT');
  }
}

function systemClock() {
  return { now: () => new Date().toISOString() };
}

function validateClock(clock) {
  if (!isRecord(clock) || typeof clock.now !== 'function') throw new TypeError('clock.now must be a function');
  return clock;
}

function validateIdGenerator(generator) {
  if (typeof generator !== 'function') throw new TypeError('idGenerator must be a function');
  return generator;
}

function defaultIdGenerator(prefix, now) {
  return `${prefix}-${String(now).replace(/[^0-9A-Za-z]/gu, '')}-${crypto.randomUUID()}`;
}

function ensureDirectory(filePath) {
  if (filePath === ':memory:') return;
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      request_json TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_successful_at TEXT,
      summary_json TEXT,
      result_json TEXT
    );
    CREATE TABLE IF NOT EXISTS product_jobs (
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      product_key TEXT NOT NULL,
      workflow_status TEXT NOT NULL,
      selected INTEGER NOT NULL,
      diagnostics_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, product_key)
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      product_key TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      artifact_json TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, product_key, artifact_type)
    );
    CREATE TABLE IF NOT EXISTS operator_tasks (
      task_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      product_key TEXT NOT NULL,
      task_type TEXT NOT NULL,
      task_version TEXT NOT NULL,
      identity_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      response_json TEXT
    );
    CREATE TABLE IF NOT EXISTS supplier_snapshots (
      snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS supplier_monitor_state (
      supplier TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repricing_requirements (
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      product_key TEXT NOT NULL,
      supplier_product_json TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      requirement_hash TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      resolution_json TEXT,
      PRIMARY KEY (run_id, product_key)
    );
    CREATE TABLE IF NOT EXISTS alert_events (
      alert_id TEXT PRIMARY KEY,
      deduplication_key TEXT NOT NULL UNIQUE,
      severity TEXT NOT NULL,
      event_type TEXT NOT NULL,
      run_id TEXT,
      product_key TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      acknowledged_at TEXT
    );
    CREATE TABLE IF NOT EXISTS scheduler_state (
      schedule_id TEXT PRIMARY KEY,
      last_attempted_cycle TEXT,
      last_completed_cycle TEXT,
      next_planned_cycle TEXT,
      latest_result_json TEXT
    );
    CREATE TABLE IF NOT EXISTS scheduler_cycles (
      schedule_id TEXT NOT NULL,
      cycle_key TEXT NOT NULL,
      run_id TEXT,
      status TEXT NOT NULL,
      result_json TEXT,
      attempted_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (schedule_id, cycle_key)
    );
    CREATE TABLE IF NOT EXISTS leases (
      lease_key TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS product_jobs_run_status ON product_jobs(run_id, workflow_status);
    CREATE INDEX IF NOT EXISTS artifacts_run_product ON artifacts(run_id, product_key);
    CREATE INDEX IF NOT EXISTS operator_tasks_run_state ON operator_tasks(run_id, state, task_type);
    CREATE INDEX IF NOT EXISTS alerts_run_created ON alert_events(run_id, created_at);
    CREATE INDEX IF NOT EXISTS supplier_snapshots_supplier_scope ON supplier_snapshots(supplier, scope_key, snapshot_id DESC);
    CREATE INDEX IF NOT EXISTS repricing_requirements_run_state ON repricing_requirements(run_id, state, product_key);
  `);
  const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get('schemaVersion');
  if (!row) {
    db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('schemaVersion', String(PRODUCTION_STATE_SCHEMA_VERSION));
    return;
  }
  const version = Number(row.value);
  if (!Number.isSafeInteger(version) || version > PRODUCTION_STATE_SCHEMA_VERSION || version < 1) {
    throw new ProductionStateStoreError(`Unsupported production-state schema version: ${row.value}`, 'STATE_SCHEMA_UNSUPPORTED');
  }
  if (version !== PRODUCTION_STATE_SCHEMA_VERSION) {
    throw new ProductionStateStoreError(`Migration from production-state schema ${version} is not implemented`, 'STATE_SCHEMA_MIGRATION_REQUIRED');
  }
}

function legacyTaskIdentity(task) {
  return hash({ taskType: task.taskType, productKey: task.productKey, taskVersion: task.taskVersion, input: task.input });
}

function scopedTaskIdentity(runId, task) {
  return hash({ runId, taskType: task.taskType, productKey: task.productKey, taskVersion: task.taskVersion, input: task.input });
}

function taskFromRow(row) {
  return {
    taskId: row.task_id,
    runId: row.run_id,
    productKey: row.product_key,
    taskType: row.task_type,
    taskVersion: row.task_version,
    identityKey: row.identity_key,
    task: parseJson(row.payload_json, 'operator task'),
    state: row.state,
    createdAt: row.created_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    ...(row.response_json === null ? {} : { response: parseJson(row.response_json, 'operator task response') }),
  };
}

function runFromRow(row) {
  if (!row) return null;
  return {
    runId: row.run_id,
    request: parseJson(row.request_json, 'run request'),
    requestHash: row.request_hash,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_successful_at === null ? {} : { lastSuccessfulAt: row.last_successful_at }),
    ...(row.summary_json === null ? {} : { summary: parseJson(row.summary_json, 'run summary') }),
    ...(row.result_json === null ? {} : { result: parseJson(row.result_json, 'run result') }),
  };
}

/** A narrow, transactional SQLite boundary for operational state only. */
export function openProductionStateStore({ databasePath, clock = systemClock(), idGenerator = defaultIdGenerator } = {}) {
  requiredString(databasePath, 'databasePath');
  const activeClock = validateClock(clock);
  const makeId = validateIdGenerator(idGenerator);
  ensureDirectory(databasePath);
  const db = new DatabaseSync(databasePath);
  createSchema(db);

  const now = () => {
    const value = activeClock.now();
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new TypeError('clock.now() must return an ISO timestamp');
    return value;
  };
  const transaction = (work) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const getRunRow = db.prepare('SELECT * FROM runs WHERE run_id = ?');

  function createRun({ runId, request } = {}) {
    assertRecord(request, 'request');
    const canonicalRequest = clone(request);
    const requestHash = hash(canonicalRequest);
    const id = runId === undefined ? makeId('run', now()) : requiredString(runId, 'runId');
    return transaction(() => {
      const existing = getRunRow.get(id);
      if (existing) {
        if (existing.request_hash !== requestHash) throw new ProductionStateStoreError('runId already exists with a different request', 'RUN_ID_CONFLICT');
        return runFromRow(existing);
      }
      const timestamp = now();
      db.prepare('INSERT INTO runs (run_id, request_json, request_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, stableJson(canonicalRequest), requestHash, 'CREATED', timestamp, timestamp);
      return runFromRow(getRunRow.get(id));
    });
  }

  function getRun(runId) {
    requiredString(runId, 'runId');
    return runFromRow(getRunRow.get(runId));
  }

  function requireRun(runId) {
    const run = getRun(runId);
    if (!run) throw new ProductionStateStoreError(`Unknown run: ${runId}`, 'RUN_NOT_FOUND');
    return run;
  }

  function saveArtifact(runId, productKey, artifactType, artifact, provenance = {}) {
    requiredString(runId, 'runId');
    requiredString(productKey, 'productKey');
    requiredString(artifactType, 'artifactType');
    assertRecord(artifact, 'artifact');
    assertRecord(provenance, 'provenance');
    requireRun(runId);
    const timestamp = now();
    const serialized = stableJson(artifact);
    const contentHash = hash(artifact);
    db.prepare(`INSERT INTO artifacts (run_id, product_key, artifact_type, content_hash, artifact_json, provenance_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, product_key, artifact_type) DO UPDATE SET content_hash = excluded.content_hash, artifact_json = excluded.artifact_json, provenance_json = excluded.provenance_json, updated_at = excluded.updated_at`)
      .run(runId, productKey, artifactType, contentHash, serialized, stableJson(provenance), timestamp, timestamp);
    return { runId, productKey, artifactType, contentHash, artifact: clone(artifact), provenance: clone(provenance), updatedAt: timestamp };
  }

  function artifactsForRun(runId) {
    requireRun(runId);
    const rows = db.prepare('SELECT * FROM artifacts WHERE run_id = ? ORDER BY product_key, artifact_type').all(runId);
    return rows.map((row) => ({
      runId: row.run_id,
      productKey: row.product_key,
      artifactType: row.artifact_type,
      contentHash: row.content_hash,
      artifact: parseJson(row.artifact_json, 'artifact'),
      provenance: parseJson(row.provenance_json, 'artifact provenance'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  function reconstructRequest(runId) {
    const run = requireRun(runId);
    const request = clone(run.request);
    request.productInputs ??= {};
    for (const record of artifactsForRun(runId)) {
      request.productInputs[record.productKey] ??= {};
      request.productInputs[record.productKey][record.artifactType] = clone(record.artifact);
    }
    return request;
  }

  function validateRepricingSupplierProduct(productKey, supplierProduct) {
    assertRecord(supplierProduct, 'supplierProduct');
    if (supplierProduct.productKey !== productKey) throw new ProductionStateStoreError('Repricing supplier product key does not match', 'REPRICING_PRODUCT_MISMATCH');
    if (supplierProduct.supplier !== 'ug-opt') throw new ProductionStateStoreError('Repricing supplier product must be ug-opt', 'REPRICING_SUPPLIER_INVALID');
    if (!Number.isSafeInteger(supplierProduct.purchasePriceMinor) || supplierProduct.purchasePriceMinor <= 0) {
      throw new ProductionStateStoreError('Repricing supplier product requires a positive purchasePriceMinor', 'REPRICING_PRICE_INVALID');
    }
    if (supplierProduct.currency !== 'UAH') throw new ProductionStateStoreError('Repricing supplier product currency must be UAH', 'REPRICING_CURRENCY_INVALID');
    assertRecord(supplierProduct.provenance, 'supplierProduct.provenance');
    return clone(supplierProduct);
  }

  function repricingRequirementFromRow(row) {
    return {
      runId: row.run_id,
      productKey: row.product_key,
      supplierProduct: parseJson(row.supplier_product_json, 'repricing supplier product'),
      reasons: parseJson(row.reasons_json, 'repricing reasons'),
      requirementHash: row.requirement_hash,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
      ...(row.resolution_json === null ? {} : { resolution: parseJson(row.resolution_json, 'repricing resolution') }),
    };
  }

  function markRepricingRequired({ runId, productKey, supplierProduct, reasons = [] } = {}) {
    requiredString(runId, 'runId');
    requiredString(productKey, 'productKey');
    requireRun(runId);
    const normalizedProduct = validateRepricingSupplierProduct(productKey, supplierProduct);
    if (!Array.isArray(reasons) || reasons.some((reason) => typeof reason !== 'string' || !reason)) {
      throw new TypeError('reasons must be an array of non-empty strings');
    }
    const canonicalReasons = [...new Set(reasons)].sort();
    const requirementHash = hash({ productKey, supplierProduct: normalizedProduct, reasons: canonicalReasons });
    return transaction(() => {
      const existing = db.prepare('SELECT * FROM repricing_requirements WHERE run_id = ? AND product_key = ?').get(runId, productKey);
      if (existing && existing.requirement_hash === requirementHash && existing.state === 'PENDING') {
        return { created: false, requirement: repricingRequirementFromRow(existing) };
      }
      const timestamp = now();
      db.prepare(`INSERT INTO repricing_requirements (run_id, product_key, supplier_product_json, reasons_json, requirement_hash, state, created_at, updated_at, resolved_at, resolution_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        ON CONFLICT(run_id, product_key) DO UPDATE SET supplier_product_json = excluded.supplier_product_json, reasons_json = excluded.reasons_json,
          requirement_hash = excluded.requirement_hash, state = excluded.state, updated_at = excluded.updated_at, resolved_at = NULL, resolution_json = NULL`)
        .run(runId, productKey, stableJson(normalizedProduct), stableJson(canonicalReasons), requirementHash, 'PENDING', timestamp, timestamp);
      return { created: true, requirement: repricingRequirementFromRow(db.prepare('SELECT * FROM repricing_requirements WHERE run_id = ? AND product_key = ?').get(runId, productKey)) };
    });
  }

  function listRepricingRequirements(runId, { state = 'PENDING' } = {}) {
    requiredString(runId, 'runId');
    requireRun(runId);
    if (!['PENDING', 'RESOLVED'].includes(state)) throw new TypeError('repricing requirement state is invalid');
    return db.prepare('SELECT * FROM repricing_requirements WHERE run_id = ? AND state = ? ORDER BY product_key').all(runId, state).map(repricingRequirementFromRow);
  }

  function resolveRepricingRequirement({ runId, productKey, requirementHash, resolution } = {}) {
    requiredString(runId, 'runId');
    requiredString(productKey, 'productKey');
    requiredString(requirementHash, 'requirementHash');
    assertRecord(resolution, 'resolution');
    return transaction(() => {
      const row = db.prepare('SELECT * FROM repricing_requirements WHERE run_id = ? AND product_key = ?').get(runId, productKey);
      if (!row) throw new ProductionStateStoreError('Repricing requirement was not found', 'REPRICING_NOT_FOUND');
      if (row.requirement_hash !== requirementHash) throw new ProductionStateStoreError('Repricing requirement changed before resolution', 'REPRICING_REQUIREMENT_STALE');
      if (row.state === 'RESOLVED') return { resolved: false, requirement: repricingRequirementFromRow(row) };
      const timestamp = now();
      db.prepare('UPDATE repricing_requirements SET state = ?, updated_at = ?, resolved_at = ?, resolution_json = ? WHERE run_id = ? AND product_key = ?')
        .run('RESOLVED', timestamp, timestamp, stableJson(resolution), runId, productKey);
      return { resolved: true, requirement: repricingRequirementFromRow(db.prepare('SELECT * FROM repricing_requirements WHERE run_id = ? AND product_key = ?').get(runId, productKey)) };
    });
  }

  function upsertTasks(runId, tasks) {
    requireRun(runId);
    if (!Array.isArray(tasks)) throw new TypeError('tasks must be an array');
    const timestamp = now();
    const taskRows = [];
    for (const task of tasks) {
      assertRecord(task, 'operator task');
      requiredString(task.taskType, 'operator task.taskType');
      requiredString(task.productKey, 'operator task.productKey');
      requiredString(task.taskVersion, 'operator task.taskVersion');
      // Reuse identities written by schema v1 before task scoping. If another
      // run owns that legacy identity, derive a run-scoped key instead.
      let identityKey = legacyTaskIdentity(task);
      let existing = db.prepare('SELECT * FROM operator_tasks WHERE identity_key = ?').get(identityKey);
      if (existing && existing.run_id !== runId) {
        identityKey = scopedTaskIdentity(runId, task);
        existing = db.prepare('SELECT * FROM operator_tasks WHERE identity_key = ?').get(identityKey);
      }
      if (!existing) {
        const taskId = makeId('task', timestamp);
        db.prepare(`INSERT INTO operator_tasks (task_id, run_id, product_key, task_type, task_version, identity_key, payload_json, state, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(taskId, runId, task.productKey, task.taskType, task.taskVersion, identityKey, stableJson(task), DURABLE_TASK_STATES.WAITING, timestamp);
        existing = db.prepare('SELECT * FROM operator_tasks WHERE task_id = ?').get(taskId);
      }
      taskRows.push(taskFromRow(existing));
    }
    return taskRows;
  }

  function synthesizeMediaTasks(runId, products) {
    const media = products
      .filter((product) => product.workflowStatus === 'WAITING_FOR_MEDIA_PUBLICATION')
      .map((product) => ({
        taskType: 'MEDIA_PUBLICATION',
        productKey: product.productKey,
        taskVersion: 'publishable-media-v1',
        input: { productKey: product.productKey, approvedMedia: product.approvedMedia ?? product.photoArtifact?.approvedMediaArtifact ?? product.photoArtifact?.approvedMedia },
        instructions: { providePublicHttpsUrls: true, noPromPublishing: true },
        expectedResultSchema: { type: 'publishable-media-v1', required: ['productKey', 'items'] },
        validationAuthority: 'PR26 final-product-excel-bridge.mjs',
      }));
    return upsertTasks(runId, media);
  }

  function persistRunResult(runId, result) {
    assertRecord(result, 'result');
    requireRun(runId);
    if (!Array.isArray(result.products)) throw new TypeError('result.products must be an array');
    if (!Array.isArray(result.operatorTasks)) throw new TypeError('result.operatorTasks must be an array');
    return transaction(() => {
      const timestamp = now();
      const artifacts = [];
      for (const product of result.products) {
        if (!isRecord(product) || typeof product.productKey !== 'string' || !product.productKey) throw new TypeError('result.products entries require productKey');
        db.prepare(`INSERT INTO product_jobs (run_id, product_key, workflow_status, selected, diagnostics_json, result_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, product_key) DO UPDATE SET workflow_status = excluded.workflow_status, selected = excluded.selected, diagnostics_json = excluded.diagnostics_json, result_json = excluded.result_json, updated_at = excluded.updated_at`)
          .run(runId, product.productKey, String(product.workflowStatus ?? 'UNKNOWN'), product.workflowStatus?.startsWith('NOT_SELECTED') ? 0 : 1, stableJson(product.diagnostics ?? []), stableJson(product), timestamp);
        for (const field of ['marketEvidence', 'pricingDecision', 'contentArtifact', 'photoArtifact', 'approvedMedia']) {
          if (isRecord(product[field])) artifacts.push([product.productKey, field, product[field], { source: 'runner-result' }]);
        }
      }
      for (const [productKey, artifactType, artifact, provenance] of artifacts) saveArtifact(runId, productKey, artifactType, artifact, provenance);
      const taskRecords = upsertTasks(runId, result.operatorTasks);
      const mediaTaskRecords = synthesizeMediaTasks(runId, result.products);
      db.prepare('UPDATE runs SET status = ?, updated_at = ?, last_successful_at = ?, summary_json = ?, result_json = ? WHERE run_id = ?')
        .run(String(result.status ?? 'UNKNOWN'), timestamp, timestamp, stableJson(result.summary ?? {}), stableJson(result), runId);
      return { run: getRun(runId), tasks: [...taskRecords, ...mediaTaskRecords] };
    });
  }

  function listOperatorTasks(runId, { state = DURABLE_TASK_STATES.WAITING } = {}) {
    requireRun(runId);
    if (!Object.values(DURABLE_TASK_STATES).includes(state)) throw new TypeError('task state is invalid');
    return db.prepare('SELECT * FROM operator_tasks WHERE run_id = ? AND state = ? ORDER BY created_at, task_id').all(runId, state).map(taskFromRow);
  }

  function completeOperatorTask({ runId, taskId, artifact, artifactType }) {
    requiredString(runId, 'runId');
    requiredString(taskId, 'taskId');
    requiredString(artifactType, 'artifactType');
    assertRecord(artifact, 'artifact');
    return transaction(() => {
      requireRun(runId);
      const row = db.prepare('SELECT * FROM operator_tasks WHERE task_id = ? AND run_id = ?').get(taskId, runId);
      if (!row) throw new ProductionStateStoreError('Operator task was not found in this run', 'TASK_NOT_FOUND');
      const task = taskFromRow(row);
      if (artifact.productKey !== task.productKey) throw new ProductionStateStoreError('Operator artifact productKey does not match task productKey', 'TASK_PRODUCT_MISMATCH');
      const response = { artifactType, artifact: clone(artifact) };
      if (task.state === DURABLE_TASK_STATES.COMPLETED) {
        if (stableJson(task.response) !== stableJson(response)) throw new ProductionStateStoreError('Operator task is already completed with a different artifact', 'TASK_ALREADY_COMPLETED');
        return { task, idempotent: true };
      }
      if (task.state !== DURABLE_TASK_STATES.WAITING) throw new ProductionStateStoreError('Operator task is not waiting', 'TASK_NOT_WAITING');
      const timestamp = now();
      saveArtifact(runId, task.productKey, artifactType, artifact, { source: 'operator-import', taskId, taskType: task.taskType });
      db.prepare('UPDATE operator_tasks SET state = ?, completed_at = ?, response_json = ? WHERE task_id = ?')
        .run(DURABLE_TASK_STATES.COMPLETED, timestamp, stableJson(response), taskId);
      return { task: taskFromRow(db.prepare('SELECT * FROM operator_tasks WHERE task_id = ?').get(taskId)), idempotent: false };
    });
  }

  function putSupplierObservation({ snapshot, report }) {
    assertRecord(snapshot, 'snapshot');
    assertRecord(report, 'report');
    const supplier = requiredString(snapshot.supplier, 'snapshot.supplier');
    const scopeKey = hash(snapshot.scope);
    const timestamp = now();
    return transaction(() => {
      db.prepare('INSERT INTO supplier_snapshots (supplier, scope_key, snapshot_json, report_json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(supplier, scopeKey, stableJson(snapshot), stableJson(report), timestamp);
      if (report.nextMonitorState !== undefined) {
        db.prepare(`INSERT INTO supplier_monitor_state (supplier, state_json, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(supplier) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`)
          .run(supplier, stableJson(report.nextMonitorState), timestamp);
      }
      return { supplier, scopeKey, createdAt: timestamp };
    });
  }

  function latestSupplierObservation({ supplier, scope } = {}) {
    requiredString(supplier, 'supplier');
    const scopeKey = hash(scope);
    const row = db.prepare('SELECT * FROM supplier_snapshots WHERE supplier = ? AND scope_key = ? ORDER BY snapshot_id DESC LIMIT 1').get(supplier, scopeKey);
    if (!row) return null;
    return { snapshot: parseJson(row.snapshot_json, 'supplier snapshot'), report: parseJson(row.report_json, 'supplier report'), createdAt: row.created_at };
  }

  function supplierMonitorState(supplier) {
    requiredString(supplier, 'supplier');
    const row = db.prepare('SELECT * FROM supplier_monitor_state WHERE supplier = ?').get(supplier);
    return row ? parseJson(row.state_json, 'supplier monitor state') : undefined;
  }

  function createAlert({ deduplicationKey, severity, eventType, runId, productKey, payload = {} } = {}) {
    requiredString(deduplicationKey, 'deduplicationKey');
    requiredString(severity, 'severity');
    requiredString(eventType, 'eventType');
    assertRecord(payload, 'payload');
    const existing = db.prepare('SELECT * FROM alert_events WHERE deduplication_key = ?').get(deduplicationKey);
    if (existing) return { created: false, alert: alertFromRow(existing) };
    const timestamp = now();
    const alertId = makeId('alert', timestamp);
    db.prepare('INSERT INTO alert_events (alert_id, deduplication_key, severity, event_type, run_id, product_key, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(alertId, deduplicationKey, severity, eventType, runId ?? null, productKey ?? null, stableJson(payload), timestamp);
    return { created: true, alert: alertFromRow(db.prepare('SELECT * FROM alert_events WHERE alert_id = ?').get(alertId)) };
  }

  function alertFromRow(row) {
    return {
      alertId: row.alert_id,
      deduplicationKey: row.deduplication_key,
      severity: row.severity,
      eventType: row.event_type,
      ...(row.run_id === null ? {} : { runId: row.run_id }),
      ...(row.product_key === null ? {} : { productKey: row.product_key }),
      payload: parseJson(row.payload_json, 'alert payload'),
      createdAt: row.created_at,
      ...(row.acknowledged_at === null ? {} : { acknowledgedAt: row.acknowledged_at }),
    };
  }

  function listAlerts({ runId } = {}) {
    const rows = runId === undefined
      ? db.prepare('SELECT * FROM alert_events ORDER BY created_at, alert_id').all()
      : db.prepare('SELECT * FROM alert_events WHERE run_id = ? ORDER BY created_at, alert_id').all(runId);
    return rows.map(alertFromRow);
  }

  function acquireLease({ leaseKey, ownerId, leaseDurationMs }) {
    requiredString(leaseKey, 'leaseKey');
    requiredString(ownerId, 'ownerId');
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) throw new TypeError('leaseDurationMs must be a positive safe integer');
    const timestamp = now();
    const currentMs = Date.parse(timestamp);
    return transaction(() => {
      const existing = db.prepare('SELECT * FROM leases WHERE lease_key = ?').get(leaseKey);
      if (existing && existing.owner_id !== ownerId && existing.expires_at_ms > currentMs) return { acquired: false, ownerId: existing.owner_id, expiresAtMs: existing.expires_at_ms };
      const expiresAtMs = currentMs + leaseDurationMs;
      db.prepare(`INSERT INTO leases (lease_key, owner_id, expires_at_ms, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(lease_key) DO UPDATE SET owner_id = excluded.owner_id, expires_at_ms = excluded.expires_at_ms, updated_at = excluded.updated_at`)
        .run(leaseKey, ownerId, expiresAtMs, timestamp);
      return { acquired: true, ownerId, expiresAtMs };
    });
  }

  function releaseLease({ leaseKey, ownerId }) {
    requiredString(leaseKey, 'leaseKey');
    requiredString(ownerId, 'ownerId');
    const result = db.prepare('DELETE FROM leases WHERE lease_key = ? AND owner_id = ?').run(leaseKey, ownerId);
    return result.changes === 1;
  }

  function beginSchedulerCycle({ scheduleId, cycleKey, nextPlannedCycle }) {
    requiredString(scheduleId, 'scheduleId');
    requiredString(cycleKey, 'cycleKey');
    const timestamp = now();
    return transaction(() => {
      const existing = db.prepare('SELECT * FROM scheduler_cycles WHERE schedule_id = ? AND cycle_key = ?').get(scheduleId, cycleKey);
      if (existing) return { started: false, cycle: clone(existing) };
      db.prepare('INSERT INTO scheduler_cycles (schedule_id, cycle_key, status, attempted_at) VALUES (?, ?, ?, ?)').run(scheduleId, cycleKey, 'RUNNING', timestamp);
      db.prepare(`INSERT INTO scheduler_state (schedule_id, last_attempted_cycle, next_planned_cycle) VALUES (?, ?, ?)
        ON CONFLICT(schedule_id) DO UPDATE SET last_attempted_cycle = excluded.last_attempted_cycle, next_planned_cycle = excluded.next_planned_cycle`)
        .run(scheduleId, cycleKey, nextPlannedCycle ?? null);
      return { started: true, cycle: { schedule_id: scheduleId, cycle_key: cycleKey, status: 'RUNNING', attempted_at: timestamp } };
    });
  }

  function completeSchedulerCycle({ scheduleId, cycleKey, runId, status, result, nextPlannedCycle }) {
    requiredString(scheduleId, 'scheduleId');
    requiredString(cycleKey, 'cycleKey');
    requiredString(status, 'status');
    assertRecord(result, 'scheduler result');
    const timestamp = now();
    return transaction(() => {
      const changes = db.prepare('UPDATE scheduler_cycles SET run_id = ?, status = ?, result_json = ?, completed_at = ? WHERE schedule_id = ? AND cycle_key = ? AND status = ?')
        .run(runId ?? null, status, stableJson(result), timestamp, scheduleId, cycleKey, 'RUNNING').changes;
      if (changes !== 1) throw new ProductionStateStoreError('Scheduler cycle is not in RUNNING state', 'SCHEDULER_CYCLE_INVALID');
      db.prepare(`INSERT INTO scheduler_state (schedule_id, last_completed_cycle, next_planned_cycle, latest_result_json) VALUES (?, ?, ?, ?)
        ON CONFLICT(schedule_id) DO UPDATE SET last_completed_cycle = excluded.last_completed_cycle, next_planned_cycle = excluded.next_planned_cycle, latest_result_json = excluded.latest_result_json`)
        .run(scheduleId, cycleKey, nextPlannedCycle ?? null, stableJson(result));
      return { completedAt: timestamp };
    });
  }

  function status() {
    const runs = db.prepare('SELECT * FROM runs ORDER BY created_at, run_id').all().map(runFromRow);
    return {
      schemaVersion: PRODUCTION_STATE_SCHEMA_VERSION,
      runs,
      waitingTaskCount: db.prepare('SELECT COUNT(*) AS count FROM operator_tasks WHERE state = ?').get(DURABLE_TASK_STATES.WAITING).count,
      alertCount: db.prepare('SELECT COUNT(*) AS count FROM alert_events').get().count,
    };
  }

  return Object.freeze({
    databasePath: databasePath === ':memory:' ? ':memory:' : path.resolve(databasePath),
    schemaVersion: PRODUCTION_STATE_SCHEMA_VERSION,
    close: () => db.close(),
    createRun,
    getRun,
    requireRun,
    reconstructRequest,
    saveArtifact,
    artifactsForRun,
    persistRunResult,
    listOperatorTasks,
    completeOperatorTask,
    putSupplierObservation,
    latestSupplierObservation,
    supplierMonitorState,
    markRepricingRequired,
    listRepricingRequirements,
    resolveRepricingRequirement,
    createAlert,
    listAlerts,
    acquireLease,
    releaseLease,
    beginSchedulerCycle,
    completeSchedulerCycle,
    status,
  });
}
