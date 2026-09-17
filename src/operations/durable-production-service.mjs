import { runEndToEndProduction } from '../orchestration/end-to-end-production-runner.mjs';
import { DURABLE_TASK_STATES, ProductionStateStoreError } from '../state/production-state-store.mjs';

export const OPERATOR_ARTIFACT_TYPES = Object.freeze({
  MARKET_RESEARCH: 'marketEvidence',
  CONTENT_GENERATION: 'contentArtifact',
  CONTENT_REWORK: 'contentArtifact',
  PHOTO_GENERATION: 'photoArtifact',
  PHOTO_REWORK: 'photoArtifact',
  MEDIA_PUBLICATION: 'publishableMedia',
});

export class DurableProductionServiceError extends Error {
  constructor(message, code = 'DURABLE_PRODUCTION_SERVICE_ERROR', details = undefined) {
    super(message);
    this.name = 'DurableProductionServiceError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function artifactForTask(task, artifact) {
  if (!isRecord(artifact)) throw new DurableProductionServiceError('Operator artifact must be an object', 'OPERATOR_ARTIFACT_INVALID');
  if (artifact.productKey !== task.productKey) {
    throw new DurableProductionServiceError('Operator artifact productKey does not match the waiting task', 'OPERATOR_ARTIFACT_PRODUCT_MISMATCH');
  }
  const type = OPERATOR_ARTIFACT_TYPES[task.taskType];
  if (!type) throw new DurableProductionServiceError(`Unsupported durable operator task type: ${task.taskType}`, 'OPERATOR_TASK_TYPE_UNSUPPORTED');
  return { type, artifact: clone(artifact) };
}

function waitingSummary(tasks) {
  return Object.fromEntries(tasks.reduce((counts, task) => {
    counts.set(task.taskType, (counts.get(task.taskType) ?? 0) + 1);
    return counts;
  }, new Map()).entries());
}

function amountFromMinor(amountMinor) {
  const whole = Math.floor(amountMinor / 100);
  const fraction = String(amountMinor % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

function authoritativeRepricingRequest(request, requirements, completedTasks = []) {
  const prepared = clone(request);
  prepared.productInputs ??= {};
  for (const requirement of requirements) {
    const input = prepared.productInputs[requirement.productKey] ?? {};
    const existingSupplier = isRecord(input.pricingProduct?.supplier) ? input.pricingProduct.supplier : {};
    prepared.productInputs[requirement.productKey] = {
      ...input,
      pricingProduct: {
        productKey: requirement.productKey,
        supplier: {
          name: 'ug-opt',
          purchasePrice: { amount: amountFromMinor(requirement.supplierProduct.purchasePriceMinor), currency: 'UAH' },
          provenance: clone(requirement.supplierProduct.provenance),
          ...(typeof requirement.supplierProduct.supplierSku === 'string' ? { supplierSku: requirement.supplierProduct.supplierSku } : {}),
          ...(typeof requirement.supplierProduct.sourceUrl === 'string' ? { sourceUrl: requirement.supplierProduct.sourceUrl } : {}),
          ...(existingSupplier.otherConfiguredCosts === undefined ? {} : { otherConfiguredCosts: clone(existingSupplier.otherConfiguredCosts) }),
        },
        ...(isRecord(input.pricingProduct?.identity) ? { identity: clone(input.pricingProduct.identity) } : { identity: {} }),
      },
    };
    const hasFreshMarketEvidence = completedTasks.some((task) => task.taskType === 'MARKET_RESEARCH'
      && task.productKey === requirement.productKey
      && task.createdAt >= requirement.createdAt);
    if (!hasFreshMarketEvidence) delete prepared.productInputs[requirement.productKey].marketEvidence;
    delete prepared.productInputs[requirement.productKey].pricingDecision;
  }
  return prepared;
}

function resolvedPricingDecisions(result) {
  if (!Array.isArray(result?.pricing?.decisions)) return new Map();
  return new Map(result.pricing.decisions
    .filter((decision) => isRecord(decision) && typeof decision.productKey === 'string')
    .map((decision) => [decision.productKey, decision]));
}

/**
 * Operational wrapper around PR27. It never advances product business states
 * itself: persisted data is reconstructed and then passed to PR27 again.
 */
export function createDurableProductionService({ store, runner = runEndToEndProduction, runnerOptions = {} } = {}) {
  if (!store || typeof store.createRun !== 'function' || typeof store.persistRunResult !== 'function') {
    throw new TypeError('store must be a production state store');
  }
  if (typeof runner !== 'function') throw new TypeError('runner must be a function');
  assertRecord(runnerOptions, 'runnerOptions');

  async function createDurableProductionRun({ runId, request } = {}) {
    const run = store.createRun({ runId, request });
    return { run, created: run.status === 'CREATED' };
  }

  async function resumeDurableProductionRun({ runId, options = {} } = {}) {
    requiredString(runId, 'runId');
    assertRecord(options, 'options');
    const pendingRepricing = typeof store.listRepricingRequirements === 'function'
      ? store.listRepricingRequirements(runId)
      : [];
    const completedTasks = typeof store.listOperatorTasks === 'function'
      ? store.listOperatorTasks(runId, { state: DURABLE_TASK_STATES.COMPLETED })
      : [];
    const request = authoritativeRepricingRequest(store.reconstructRequest(runId), pendingRepricing, completedTasks);
    let result;
    try {
      result = await runner(request, { ...runnerOptions, ...options });
    } catch (error) {
      throw new DurableProductionServiceError(`PR27 execution failed: ${error.message}`, 'PR27_RUNNER_FAILED', { runId, causeCode: error?.code });
    }
    const persisted = store.persistRunResult(runId, result);
    if (typeof store.resolveRepricingRequirement === 'function') {
      const decisions = resolvedPricingDecisions(result);
      for (const requirement of pendingRepricing) {
        const decision = decisions.get(requirement.productKey);
        if (decision !== undefined) {
          store.saveArtifact(runId, requirement.productKey, 'pricingProduct', request.productInputs[requirement.productKey].pricingProduct, {
            source: 'authoritative-repricing',
            requirementHash: requirement.requirementHash,
          });
          store.resolveRepricingRequirement({
            runId,
            productKey: requirement.productKey,
            requirementHash: requirement.requirementHash,
            resolution: { pricingDecision: clone(decision) },
          });
        }
      }
    }
    const waitingTasks = store.listOperatorTasks(runId, { state: DURABLE_TASK_STATES.WAITING });
    const taskSummary = waitingSummary(waitingTasks);
    const summaryKey = Object.entries(taskSummary).sort(([left], [right]) => left.localeCompare(right)).map(([type, count]) => `${type}:${count}`).join('|');
    if (summaryKey) {
      store.createAlert({
        deduplicationKey: `operator-tasks:${runId}:${summaryKey}`,
        severity: 'WARNING',
        eventType: 'OPERATOR_TASKS_WAITING',
        runId,
        payload: { waitingTaskSummary: taskSummary },
      });
    }
    return {
      run: persisted.run,
      result: clone(result),
      waitingTasks,
      waitingTaskSummary: taskSummary,
      repricingPending: pendingRepricing.map((requirement) => requirement.productKey),
    };
  }

  function importDurableOperatorArtifacts({ runId, artifacts } = {}) {
    requiredString(runId, 'runId');
    if (!Array.isArray(artifacts) || artifacts.length === 0) throw new TypeError('artifacts must be a non-empty array');
    const imported = [];
    for (const entry of artifacts) {
      assertRecord(entry, 'artifact import entry');
      requiredString(entry.taskId, 'artifact import entry.taskId');
      const waitingOrCompleted = [...store.listOperatorTasks(runId, { state: DURABLE_TASK_STATES.WAITING }), ...store.listOperatorTasks(runId, { state: DURABLE_TASK_STATES.COMPLETED })]
        .find((task) => task.taskId === entry.taskId);
      if (!waitingOrCompleted) throw new DurableProductionServiceError('Operator task was not found for this run', 'OPERATOR_TASK_NOT_FOUND');
      if (entry.taskType !== undefined && entry.taskType !== waitingOrCompleted.taskType) {
        throw new DurableProductionServiceError('Operator task type does not match', 'OPERATOR_TASK_TYPE_MISMATCH');
      }
      const normalized = artifactForTask(waitingOrCompleted, entry.artifact);
      try {
        imported.push(store.completeOperatorTask({ runId, taskId: waitingOrCompleted.taskId, artifactType: normalized.type, artifact: normalized.artifact }));
      } catch (error) {
        if (error instanceof ProductionStateStoreError) throw new DurableProductionServiceError(error.message, error.code, error.details);
        throw error;
      }
    }
    return { runId, imported, waitingTasks: store.listOperatorTasks(runId, { state: DURABLE_TASK_STATES.WAITING }) };
  }

  function getDurableRunStatus(runId) {
    requiredString(runId, 'runId');
    const run = store.requireRun(runId);
    const waitingTasks = store.listOperatorTasks(runId, { state: DURABLE_TASK_STATES.WAITING });
    return {
      run,
      waitingTasks,
      waitingTaskSummary: waitingSummary(waitingTasks),
      alerts: store.listAlerts({ runId }),
    };
  }

  return Object.freeze({
    createDurableProductionRun,
    resumeDurableProductionRun,
    importDurableOperatorArtifacts,
    getDurableRunStatus,
  });
}

export function formatOperatorTaskSummary(tasks) {
  if (!Array.isArray(tasks)) throw new TypeError('tasks must be an array');
  const summary = waitingSummary(tasks);
  const lines = Object.entries(summary).sort(([left], [right]) => left.localeCompare(right)).map(([type, count]) => `${count} ${type} tasks waiting`);
  return lines.length ? lines.join('\n') : 'No operator tasks waiting';
}
