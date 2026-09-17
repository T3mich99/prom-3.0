import { compareUgoptCatalogSnapshots, formatUgoptDailySummary } from '../suppliers/ugopt/daily-catalog-sync.mjs';
import { collectCurrentUgoptCatalogSnapshot } from '../suppliers/ugopt/current-catalog-snapshot.mjs';

export const ALERT_SEVERITIES = Object.freeze({
  CRITICAL: 'CRITICAL',
  WARNING: 'WARNING',
  INFO: 'INFO',
});

export class ProductionSchedulerError extends Error {
  constructor(message, code = 'PRODUCTION_SCHEDULER_ERROR', details = undefined) {
    super(message);
    this.name = 'ProductionSchedulerError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function validLocalTime(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) throw new TypeError('dailyLocalTime must use HH:MM local time');
  return value;
}

function clockDate(clock) {
  const value = clock.now();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('clock.now() must return a valid Date or timestamp');
  return date;
}

function iso(clock) {
  return clockDate(clock).toISOString();
}

function cycleKeyFor(date) {
  return date.toISOString();
}

/** Return the next occurrence of a daily local-clock HH:MM schedule. */
export function nextDailyLocalRun(now, dailyLocalTime) {
  const [hours, minutes] = validLocalTime(dailyLocalTime).split(':').map(Number);
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) throw new TypeError('now must be a valid Date or timestamp');
  const next = new Date(current.getTime());
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= current.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

export function normalizeSchedulerConfig(config) {
  if (!isRecord(config)) throw new TypeError('scheduler config must be an object');
  const allowed = new Set(['scheduleId', 'databasePath', 'productionRequestPath', 'runId', 'dailyLocalTime', 'intervalMs', 'leaseDurationMs', 'alertOutputPath', 'supplierSnapshotPath', 'activeStoreProducts']);
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new TypeError(`Unsupported scheduler config field: ${key}`);
  const scheduleId = requiredString(config.scheduleId, 'scheduleId');
  const databasePath = requiredString(config.databasePath, 'databasePath');
  const productionRequestPath = requiredString(config.productionRequestPath, 'productionRequestPath');
  const interval = config.intervalMs;
  const daily = config.dailyLocalTime;
  if ((interval === undefined) === (daily === undefined)) throw new TypeError('Specify exactly one of intervalMs or dailyLocalTime');
  if (interval !== undefined && (!Number.isSafeInteger(interval) || interval <= 0)) throw new TypeError('intervalMs must be a positive safe integer');
  if (daily !== undefined) validLocalTime(daily);
  const leaseDurationMs = config.leaseDurationMs ?? 10 * 60 * 1000;
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) throw new TypeError('leaseDurationMs must be a positive safe integer');
  if (config.runId !== undefined) requiredString(config.runId, 'runId');
  if (config.alertOutputPath !== undefined) requiredString(config.alertOutputPath, 'alertOutputPath');
  if (config.supplierSnapshotPath !== undefined) requiredString(config.supplierSnapshotPath, 'supplierSnapshotPath');
  if (config.activeStoreProducts !== undefined && !Array.isArray(config.activeStoreProducts)) throw new TypeError('activeStoreProducts must be an array');
  return structuredClone({ ...config, scheduleId, databasePath, productionRequestPath, leaseDurationMs });
}

export function nextScheduledRun(config, now) {
  const value = normalizeSchedulerConfig(config);
  if (value.dailyLocalTime) return nextDailyLocalRun(now, value.dailyLocalTime);
  return new Date(new Date(now).getTime() + value.intervalMs);
}

function supplierAlerts(report, runId) {
  const alerts = [];
  const add = (severity, eventType, productKey, suffix, payload) => alerts.push({
    severity,
    eventType,
    productKey,
    runId,
    deduplicationKey: `ugopt:${eventType}:${productKey ?? 'scope'}:${suffix}`,
    payload,
  });
  for (const record of report.changes.unavailable) add(ALERT_SEVERITIES.WARNING, 'SUPPLIER_BECAME_UNAVAILABLE', record.productKey, 'state', { availabilityStatus: record.availabilityStatus });
  for (const record of report.changes.removed) add(ALERT_SEVERITIES.WARNING, 'SUPPLIER_REMOVED', record.productKey, 'state', { availabilityStatus: record.availabilityStatus });
  for (const risk of report.storeRisks.critical) add(ALERT_SEVERITIES.CRITICAL, 'ACTIVE_STORE_SUPPLIER_RISK', risk.productKey, risk.availabilityStatus, { availabilityStatus: risk.availabilityStatus, riskCode: risk.riskCode });
  for (const record of report.changes.backInStock) add(ALERT_SEVERITIES.INFO, 'SUPPLIER_BACK_IN_STOCK', record.productKey, 'state', { availabilityStatus: record.availabilityStatus });
  for (const record of report.changes.priceChanged) add(ALERT_SEVERITIES.WARNING, 'SUPPLIER_PRICE_CHANGED', record.productKey, String(record.currentPurchasePriceMinor), { priceChange: record.priceChange ?? record });
  for (const record of report.changes.atRisk) add(ALERT_SEVERITIES.WARNING, 'SUPPLIER_AT_RISK', record.productKey, 'state', { diagnostics: record.diagnostics ?? [] });
  if (report.diagnostics.some((item) => item.code === 'INCOMPLETE_SCAN')) add(ALERT_SEVERITIES.WARNING, 'SUPPLIER_PARTIAL_SCAN', null, report.currentSnapshot.scope.requestedCategoryKeys.join(','), { diagnostics: report.diagnostics });
  return alerts;
}

export function formatAlertEvent(alert) {
  if (!isRecord(alert)) throw new TypeError('alert must be an object');
  return `[${alert.severity}] ${alert.eventType}${alert.productKey ? ` ${alert.productKey}` : ''}`;
}

/**
 * Execute one idempotent, leased operational cycle. The default provider uses
 * the existing live UG-OPT catalog boundary; an injected provider is reserved
 * for tests and an explicit diagnostic snapshot-file override.
 */
export async function runScheduledProductionCycle({
  config,
  store,
  service,
  productionRequest,
  snapshotProvider,
  clock = { now: () => new Date() },
  ownerId = 'scheduler',
} = {}) {
  const normalized = normalizeSchedulerConfig(config);
  if (!store || typeof store.acquireLease !== 'function') throw new TypeError('store must be a production state store');
  if (!service || typeof service.createDurableProductionRun !== 'function') throw new TypeError('service must be a durable production service');
  if (!isRecord(productionRequest)) throw new TypeError('productionRequest must be an object');
  if (snapshotProvider !== undefined && typeof snapshotProvider !== 'function') throw new TypeError('snapshotProvider must be a function');
  requiredString(ownerId, 'ownerId');

  const leaseKey = `scheduler:${normalized.scheduleId}`;
  const lease = store.acquireLease({ leaseKey, ownerId, leaseDurationMs: normalized.leaseDurationMs });
  if (!lease.acquired) return { status: 'LEASE_HELD', ownerId: lease.ownerId, expiresAtMs: lease.expiresAtMs };
  const startedAt = iso(clock);
  const cycleKey = cycleKeyFor(clockDate(clock));
  const nextPlannedCycle = nextScheduledRun(normalized, clockDate(clock)).toISOString();
  const begun = store.beginSchedulerCycle({ scheduleId: normalized.scheduleId, cycleKey, nextPlannedCycle });
  if (!begun.started) {
    store.releaseLease({ leaseKey, ownerId });
    return { status: 'ALREADY_PROCESSED', cycleKey };
  }
  try {
    const requestedRunId = normalized.runId ?? `scheduled-${normalized.scheduleId}-${cycleKey.replace(/[^0-9A-Za-z]/gu, '')}`;
    service.createDurableProductionRun({ runId: requestedRunId, request: productionRequest });
    let monitoring = null;
    let alertEvents = [];
    {
      const snapshot = await (snapshotProvider ?? (() => collectCurrentUgoptCatalogSnapshot({ productionRequest })))();
      const previous = store.latestSupplierObservation({ supplier: snapshot.supplier, scope: snapshot.scope });
      const report = compareUgoptCatalogSnapshots({
        currentSnapshot: snapshot,
        ...(previous === null ? {} : { previousSnapshot: previous.snapshot }),
        monitorState: store.supplierMonitorState(snapshot.supplier),
        activeStoreProducts: normalized.activeStoreProducts ?? [],
      });
      store.putSupplierObservation({ snapshot, report });
      monitoring = { report, summary: formatUgoptDailySummary(report) };
      if (!report.baselineCreated) alertEvents = supplierAlerts(report, requestedRunId);
      for (const alert of alertEvents) store.createAlert(alert);
      if (typeof store.markRepricingRequired === 'function') {
        const productByKey = new Map(report.products.map((product) => [product.productKey, product.product]));
        for (const candidate of report.repricingCandidates) {
          const supplierProduct = productByKey.get(candidate.productKey);
          if (supplierProduct?.purchasePriceMinor === undefined) continue;
          store.markRepricingRequired({
            runId: requestedRunId,
            productKey: candidate.productKey,
            supplierProduct,
            reasons: candidate.reasons,
          });
        }
      }
    }
    const advancement = await service.resumeDurableProductionRun({ runId: requestedRunId });
    const result = {
      status: advancement.result.status,
      runId: requestedRunId,
      startedAt,
      monitoring,
      alertsCreated: alertEvents.length,
      waitingTaskSummary: advancement.waitingTaskSummary,
    };
    store.completeSchedulerCycle({ scheduleId: normalized.scheduleId, cycleKey, runId: requestedRunId, status: 'COMPLETED', result, nextPlannedCycle });
    return result;
  } catch (error) {
    const result = { status: 'FAILED', startedAt, error: { code: error?.code ?? 'SCHEDULER_CYCLE_FAILED', message: error instanceof Error ? error.message : String(error) } };
    store.createAlert({ deduplicationKey: `scheduler:failure:${normalized.scheduleId}:${result.error.code}`, severity: ALERT_SEVERITIES.CRITICAL, eventType: 'SCHEDULER_FAILURE', payload: result.error });
    store.completeSchedulerCycle({ scheduleId: normalized.scheduleId, cycleKey, status: 'FAILED', result, nextPlannedCycle });
    return result;
  } finally {
    store.releaseLease({ leaseKey, ownerId });
  }
}

/** Minimal signal-aware loop; waiting operator work is a normal completed cycle. */
export function startProductionScheduler({ runCycle, config, clock = { now: () => new Date() }, setTimer = setTimeout, clearTimer = clearTimeout, onResult = () => {} } = {}) {
  if (typeof runCycle !== 'function') throw new TypeError('runCycle must be a function');
  const normalized = normalizeSchedulerConfig(config);
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function' || typeof onResult !== 'function') throw new TypeError('scheduler timer and result callbacks must be functions');
  let stopped = false;
  let timer = null;
  const scheduleNext = () => {
    if (stopped) return;
    const delay = Math.max(0, nextScheduledRun(normalized, clockDate(clock)).getTime() - clockDate(clock).getTime());
    timer = setTimer(async () => {
      if (stopped) return;
      onResult(await runCycle());
      scheduleNext();
    }, delay);
  };
  scheduleNext();
  return Object.freeze({ stop: () => { stopped = true; if (timer !== null) clearTimer(timer); } });
}
