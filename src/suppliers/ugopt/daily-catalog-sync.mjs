const UGOPT_SUPPLIER = 'ug-opt';
const UAH = 'UAH';

export const UGOPT_AVAILABILITY_STATES = Object.freeze({
  SELLABLE: 'SELLABLE',
  UNAVAILABLE: 'UNAVAILABLE',
  AT_RISK: 'AT_RISK',
  REMOVED: 'REMOVED',
});

export const UGOPT_OBSERVED_AVAILABILITIES = Object.freeze({
  SELLABLE: 'SELLABLE',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
});

export const UGOPT_CHANGE_EVENTS = Object.freeze({
  NEW_SUPPLIER_PRODUCT: 'NEW_SUPPLIER_PRODUCT',
  PRICE_CHANGED: 'PRICE_CHANGED',
  BECAME_UNAVAILABLE: 'BECAME_UNAVAILABLE',
  BACK_IN_STOCK: 'BACK_IN_STOCK',
  REMOVED_FROM_SUPPLIER: 'REMOVED_FROM_SUPPLIER',
  REAPPEARED: 'REAPPEARED',
  UNCHANGED: 'UNCHANGED',
});

export const UGOPT_RISK_CODES = Object.freeze({
  CRITICAL_SUPPLIER_FULFILLMENT_RISK: 'CRITICAL_SUPPLIER_FULFILLMENT_RISK',
  SUPPLIER_STATE_UNCERTAIN: 'SUPPLIER_STATE_UNCERTAIN',
});

export class UgoptCatalogSnapshotError extends TypeError {
  constructor(message, code = 'UGOPT_SNAPSHOT_INVALID') {
    super(message);
    this.name = 'UgoptCatalogSnapshotError';
    this.code = code;
  }
}

export class UgoptCatalogOperationalError extends Error {
  constructor(message, code = 'UGOPT_PROVIDER_FAILURE') {
    super(message);
    this.name = 'UgoptCatalogOperationalError';
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new UgoptCatalogSnapshotError(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value, label) {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

function stringList(value, label) {
  if (!Array.isArray(value)) throw new UgoptCatalogSnapshotError(`${label} must be an array`);
  const seen = new Set();
  return value.map((item, index) => {
    const result = requiredString(item, `${label}[${index}]`);
    if (seen.has(result)) throw new UgoptCatalogSnapshotError(`${label} contains a duplicate: ${result}`);
    seen.add(result);
    return result;
  });
}

function cloneRecord(value, label) {
  if (!isRecord(value)) throw new UgoptCatalogSnapshotError(`${label} must be an object`);
  return { ...value };
}

function validateMinor(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UgoptCatalogSnapshotError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function validateSourceUrl(value, label) {
  if (value === undefined) return undefined;
  const sourceUrl = requiredString(value, label);
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new UgoptCatalogSnapshotError(`${label} must be a valid URL`);
  }
  if (!/^https?:$/u.test(parsed.protocol) || parsed.hostname !== 'ug-opt.in.ua') {
    throw new UgoptCatalogSnapshotError(`${label} must use the UG-OPT HTTP(S) hostname`);
  }
  return parsed.toString();
}

function validateObservation(value, label) {
  if (value === undefined) return { status: 'OK' };
  const observation = cloneRecord(value, label);
  const allowed = new Set(['OK', 'PROVIDER_FAILURE', 'CONFLICT']);
  if (!allowed.has(observation.status)) {
    throw new UgoptCatalogSnapshotError(`${label}.status must be OK, PROVIDER_FAILURE, or CONFLICT`);
  }
  if (observation.code !== undefined) optionalString(observation.code, `${label}.code`);
  if (observation.message !== undefined) optionalString(observation.message, `${label}.message`);
  return observation;
}

function validateSnapshotProduct(product, index) {
  const label = `products[${index}]`;
  if (!isRecord(product)) throw new UgoptCatalogSnapshotError(`${label} must be an object`);
  if (product.supplier !== UGOPT_SUPPLIER) throw new UgoptCatalogSnapshotError(`${label}.supplier must be ${UGOPT_SUPPLIER}`);
  const productKey = requiredString(product.productKey, `${label}.productKey`);
  const supplierSku = optionalString(product.supplierSku, `${label}.supplierSku`);
  const sourceUrl = validateSourceUrl(product.sourceUrl, `${label}.sourceUrl`);
  if (!Object.values(UGOPT_OBSERVED_AVAILABILITIES).includes(product.availability)) {
    throw new UgoptCatalogSnapshotError(`${label}.availability must be SELLABLE, UNAVAILABLE, or UNKNOWN`);
  }
  const currency = product.currency ?? UAH;
  if (currency !== UAH) throw new UgoptCatalogSnapshotError(`${label}.currency must be ${UAH}`);
  const purchasePriceMinor = product.purchasePriceMinor === undefined
    ? undefined
    : validateMinor(product.purchasePriceMinor, `${label}.purchasePriceMinor`);
  const categoryKey = optionalString(product.categoryKey, `${label}.categoryKey`);
  const provenance = cloneRecord(product.provenance, `${label}.provenance`);
  const observation = validateObservation(product.observation, `${label}.observation`);
  if (observation.status === 'OK' && own(product, 'failure')) {
    throw new UgoptCatalogSnapshotError(`${label}.failure requires a non-OK observation`);
  }
  const normalized = {
    productKey,
    supplier: UGOPT_SUPPLIER,
    ...(supplierSku === undefined ? {} : { supplierSku }),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    availability: product.availability,
    ...(purchasePriceMinor === undefined ? {} : { purchasePriceMinor }),
    currency,
    ...(categoryKey === undefined ? {} : { categoryKey }),
    provenance,
    ...(observation.status === 'OK' ? {} : { observation }),
  };
  return normalized;
}

function validateScope(scope) {
  if (!isRecord(scope)) throw new UgoptCatalogSnapshotError('scope must be an object');
  const requestedCategoryKeys = stringList(scope.requestedCategoryKeys, 'scope.requestedCategoryKeys');
  const completedCategoryKeys = stringList(scope.completedCategoryKeys, 'scope.completedCategoryKeys');
  const failedCategoryKeys = stringList(scope.failedCategoryKeys, 'scope.failedCategoryKeys');
  const requested = new Set(requestedCategoryKeys);
  const completed = new Set(completedCategoryKeys);
  const failed = new Set(failedCategoryKeys);
  for (const key of completed) {
    if (!requested.has(key)) throw new UgoptCatalogSnapshotError(`completed category is outside requested scope: ${key}`);
  }
  for (const key of failed) {
    if (!requested.has(key)) throw new UgoptCatalogSnapshotError(`failed category is outside requested scope: ${key}`);
    if (completed.has(key)) throw new UgoptCatalogSnapshotError(`category cannot be completed and failed: ${key}`);
  }
  return {
    requestedCategoryKeys: [...requested].sort(),
    completedCategoryKeys: [...completed].sort(),
    failedCategoryKeys: [...failed].sort(),
  };
}

function normalizeSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new UgoptCatalogSnapshotError('snapshot must be an object');
  if (snapshot.supplier !== UGOPT_SUPPLIER) throw new UgoptCatalogSnapshotError(`snapshot.supplier must be ${UGOPT_SUPPLIER}`);
  const scope = validateScope(snapshot.scope);
  if (typeof snapshot.complete !== 'boolean') throw new UgoptCatalogSnapshotError('snapshot.complete must be boolean');
  const covered = new Set([...scope.completedCategoryKeys, ...scope.failedCategoryKeys]);
  const earnedComplete = scope.requestedCategoryKeys.length > 0
    && scope.failedCategoryKeys.length === 0
    && covered.size === scope.requestedCategoryKeys.length;
  if (snapshot.complete !== earnedComplete) {
    throw new UgoptCatalogSnapshotError('snapshot.complete contradicts category coverage');
  }
  if (!Array.isArray(snapshot.products)) throw new UgoptCatalogSnapshotError('snapshot.products must be an array');
  const seen = new Set();
  const products = snapshot.products.map((product, index) => {
    const normalized = validateSnapshotProduct(product, index);
    if (seen.has(normalized.productKey)) throw new UgoptCatalogSnapshotError(`duplicate productKey: ${normalized.productKey}`);
    seen.add(normalized.productKey);
    if (normalized.categoryKey !== undefined && !scope.requestedCategoryKeys.includes(normalized.categoryKey)) {
      throw new UgoptCatalogSnapshotError(`product category is outside requested scope: ${normalized.categoryKey}`);
    }
    return normalized;
  }).sort((left, right) => left.productKey.localeCompare(right.productKey));
  const scanId = optionalString(snapshot.scanId, 'snapshot.scanId');
  return {
    supplier: UGOPT_SUPPLIER,
    ...(scanId === undefined ? {} : { scanId }),
    scope,
    complete: snapshot.complete,
    products,
  };
}

export function validateUgoptCatalogSnapshot(snapshot) {
  return normalizeSnapshot(snapshot);
}

export function buildUgoptCatalogSnapshot(input = {}) {
  if (!isRecord(input)) throw new UgoptCatalogSnapshotError('snapshot input must be an object');
  if (input.providerError !== undefined) {
    throw new UgoptCatalogOperationalError(requiredString(input.providerError, 'providerError'));
  }
  return normalizeSnapshot({
    supplier: input.supplier ?? UGOPT_SUPPLIER,
    ...(input.scanId === undefined ? {} : { scanId: input.scanId }),
    scope: input.scope,
    complete: input.complete,
    products: input.products,
  });
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameScope(left, right) {
  return sameArray(left.requestedCategoryKeys, right.requestedCategoryKeys)
    && sameArray(left.completedCategoryKeys, right.completedCategoryKeys)
    && sameArray(left.failedCategoryKeys, right.failedCategoryKeys);
}

function trusted(snapshot) {
  return snapshot.complete === true
    && snapshot.scope.requestedCategoryKeys.length > 0
    && snapshot.scope.failedCategoryKeys.length === 0
    && sameArray(snapshot.scope.requestedCategoryKeys, snapshot.scope.completedCategoryKeys);
}

function normalizeMonitorState(state) {
  if (state === undefined) return { supplier: UGOPT_SUPPLIER, products: [] };
  if (!isRecord(state)) throw new UgoptCatalogSnapshotError('monitorState must be an object');
  if (state.supplier !== UGOPT_SUPPLIER) throw new UgoptCatalogSnapshotError(`monitorState.supplier must be ${UGOPT_SUPPLIER}`);
  if (!Array.isArray(state.products)) throw new UgoptCatalogSnapshotError('monitorState.products must be an array');
  const seen = new Set();
  const products = state.products.map((product, index) => {
    const label = `monitorState.products[${index}]`;
    if (!isRecord(product)) throw new UgoptCatalogSnapshotError(`${label} must be an object`);
    const productKey = requiredString(product.productKey, `${label}.productKey`);
    if (seen.has(productKey)) throw new UgoptCatalogSnapshotError(`duplicate monitor productKey: ${productKey}`);
    seen.add(productKey);
    if (!Object.values(UGOPT_AVAILABILITY_STATES).includes(product.lastKnownSupplierState)) {
      throw new UgoptCatalogSnapshotError(`${label}.lastKnownSupplierState is invalid`);
    }
    const lastKnownPriceMinor = product.lastKnownPriceMinor === undefined
      ? undefined
      : validateMinor(product.lastKnownPriceMinor, `${label}.lastKnownPriceMinor`);
    return {
      productKey,
      lastKnownSupplierState: product.lastKnownSupplierState,
      ...(lastKnownPriceMinor === undefined ? {} : { lastKnownPriceMinor }),
      ...(optionalString(product.supplierSku, `${label}.supplierSku`) === undefined ? {} : { supplierSku: product.supplierSku }),
      ...(optionalString(product.categoryKey, `${label}.categoryKey`) === undefined ? {} : { categoryKey: product.categoryKey }),
    };
  }).sort((left, right) => left.productKey.localeCompare(right.productKey));
  return { supplier: UGOPT_SUPPLIER, products };
}

function deriveCurrentState(product) {
  if (product.observation?.status && product.observation.status !== 'OK') return UGOPT_AVAILABILITY_STATES.AT_RISK;
  if (product.availability === UGOPT_OBSERVED_AVAILABILITIES.UNKNOWN) return UGOPT_AVAILABILITY_STATES.AT_RISK;
  if (product.availability === UGOPT_OBSERVED_AVAILABILITIES.UNAVAILABLE) return UGOPT_AVAILABILITY_STATES.UNAVAILABLE;
  if (product.purchasePriceMinor === undefined) return UGOPT_AVAILABILITY_STATES.AT_RISK;
  return UGOPT_AVAILABILITY_STATES.SELLABLE;
}

function diagnostic(code, message) {
  return { code, message };
}

function priceChange(previous, current) {
  if (previous?.purchasePriceMinor === undefined || current?.purchasePriceMinor === undefined) return null;
  if (previous.purchasePriceMinor === current.purchasePriceMinor) return null;
  const deltaMinor = current.purchasePriceMinor - previous.purchasePriceMinor;
  return {
    previousPurchasePriceMinor: previous.purchasePriceMinor,
    currentPurchasePriceMinor: current.purchasePriceMinor,
    absoluteDeltaMinor: Math.abs(deltaMinor),
    deltaMinor,
    requiresRepricing: true,
  };
}

function stableRecord(record) {
  return {
    productKey: record.productKey,
    ...(record.currentProduct === undefined ? {} : { product: record.currentProduct }),
    ...(record.previousProduct === undefined ? {} : { previousProduct: record.previousProduct }),
    availabilityStatus: record.availabilityStatus,
    ...(record.previousAvailabilityStatus === undefined ? {} : { previousAvailabilityStatus: record.previousAvailabilityStatus }),
    changeEvents: [...record.changeEvents],
    ...(record.diagnostics.length ? { diagnostics: [...record.diagnostics] } : {}),
    requiresRepricing: record.requiresRepricing,
    requiresPricingEvaluation: record.requiresPricingEvaluation,
    ...(record.priceChange ?? {}),
  };
}

function sortRecords(records) {
  return records.map(stableRecord).sort((left, right) => left.productKey.localeCompare(right.productKey));
}

function activeStoreProducts(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new UgoptCatalogSnapshotError('activeStoreProducts must be an array');
  const seen = new Set();
  return value.map((product, index) => {
    const label = `activeStoreProducts[${index}]`;
    if (!isRecord(product)) throw new UgoptCatalogSnapshotError(`${label} must be an object`);
    const productKey = requiredString(product.productKey, `${label}.productKey`);
    if (seen.has(productKey)) throw new UgoptCatalogSnapshotError(`duplicate active store productKey: ${productKey}`);
    seen.add(productKey);
    if (typeof product.active !== 'boolean') throw new UgoptCatalogSnapshotError(`${label}.active must be boolean`);
    const storeProductId = optionalString(product.storeProductId, `${label}.storeProductId`);
    const provenance = product.provenance === undefined ? undefined : cloneRecord(product.provenance, `${label}.provenance`);
    return {
      productKey,
      active: product.active,
      ...(storeProductId === undefined ? {} : { storeProductId }),
      ...(provenance === undefined ? {} : { provenance }),
    };
  }).sort((left, right) => left.productKey.localeCompare(right.productKey));
}

function monitorRecordFor(reportRecord) {
  const product = reportRecord.product;
  return {
    productKey: reportRecord.productKey,
    lastKnownSupplierState: reportRecord.availabilityStatus,
    ...(product?.purchasePriceMinor === undefined ? {} : { lastKnownPriceMinor: product.purchasePriceMinor }),
    ...(product?.supplierSku === undefined ? {} : { supplierSku: product.supplierSku }),
    ...(product?.categoryKey === undefined ? {} : { categoryKey: product.categoryKey }),
  };
}

export function advanceUgoptMonitorState({ previousState, currentSnapshot, report } = {}) {
  const normalizedState = normalizeMonitorState(previousState);
  const snapshot = normalizeSnapshot(currentSnapshot);
  const next = new Map(normalizedState.products.map((product) => [product.productKey, product]));
  if (report !== undefined) {
    if (!isRecord(report) || !Array.isArray(report.products)) throw new UgoptCatalogSnapshotError('report.products must be an array');
    for (const record of report.products) next.set(record.productKey, monitorRecordFor(record));
  } else {
    for (const product of snapshot.products) next.set(product.productKey, {
      productKey: product.productKey,
      lastKnownSupplierState: deriveCurrentState(product),
      ...(product.purchasePriceMinor === undefined ? {} : { lastKnownPriceMinor: product.purchasePriceMinor }),
      ...(product.supplierSku === undefined ? {} : { supplierSku: product.supplierSku }),
      ...(product.categoryKey === undefined ? {} : { categoryKey: product.categoryKey }),
    });
  }
  return {
    supplier: UGOPT_SUPPLIER,
    products: [...next.values()].sort((left, right) => left.productKey.localeCompare(right.productKey)),
  };
}

export function compareUgoptCatalogSnapshots(input = {}, options = {}) {
  if (!isRecord(input)) throw new UgoptCatalogSnapshotError('comparison input must be an object');
  if (!isRecord(options)) throw new UgoptCatalogSnapshotError('options must be an object');
  const currentSnapshot = normalizeSnapshot(input.currentSnapshot);
  const previousSnapshot = input.previousSnapshot === undefined ? null : normalizeSnapshot(input.previousSnapshot);
  const monitorState = normalizeMonitorState(input.monitorState ?? options.monitorState);
  const active = activeStoreProducts(input.activeStoreProducts);
  const previousTrusted = previousSnapshot !== null && trusted(previousSnapshot);
  const currentTrusted = trusted(currentSnapshot);
  const comparableScope = previousTrusted && currentTrusted && sameScope(previousSnapshot.scope, currentSnapshot.scope);
  const previousByKey = new Map((previousSnapshot?.products ?? []).map((product) => [product.productKey, product]));
  const monitorByKey = new Map(monitorState.products.map((product) => [product.productKey, product]));
  const currentByKey = new Map(currentSnapshot.products.map((product) => [product.productKey, product]));
  const records = [];

  for (const currentProduct of currentSnapshot.products) {
    const previousProduct = previousByKey.get(currentProduct.productKey);
    const monitored = monitorByKey.get(currentProduct.productKey);
    const currentState = deriveCurrentState(currentProduct);
    const previousState = previousProduct === undefined ? monitored?.lastKnownSupplierState : deriveCurrentState(previousProduct);
    const diagnostics = [];
    if (currentState === UGOPT_AVAILABILITY_STATES.AT_RISK) {
      if (currentProduct.observation?.status === 'PROVIDER_FAILURE') {
        diagnostics.push(diagnostic('UGOPT_PRODUCT_FETCH_FAILURE', currentProduct.observation.message ?? 'Product observation failed.'));
      } else if (currentProduct.observation?.status === 'CONFLICT') {
        diagnostics.push(diagnostic('CONFLICTING_AVAILABILITY_SIGNALS', currentProduct.observation.message ?? 'Availability signals conflict.'));
      } else if (currentProduct.availability === UGOPT_OBSERVED_AVAILABILITIES.UNKNOWN) {
        diagnostics.push(diagnostic('AVAILABILITY_UNKNOWN', 'Supplier availability was not explicit.'));
      } else if (currentProduct.purchasePriceMinor === undefined) {
        diagnostics.push(diagnostic('PURCHASE_PRICE_MISSING', 'Supplier purchase price is missing.'));
      }
    }
    const changeEvents = [];
    let requiresRepricing = false;
    let requiresPricingEvaluation = false;
    if (previousTrusted && currentTrusted && previousProduct === undefined && monitored?.lastKnownSupplierState === UGOPT_AVAILABILITY_STATES.REMOVED) {
      changeEvents.push(UGOPT_CHANGE_EVENTS.REAPPEARED);
      requiresRepricing = true;
    } else if (previousTrusted && currentTrusted && previousProduct === undefined) {
      changeEvents.push(UGOPT_CHANGE_EVENTS.NEW_SUPPLIER_PRODUCT);
      requiresPricingEvaluation = true;
      requiresRepricing = currentState === UGOPT_AVAILABILITY_STATES.SELLABLE;
    } else if (previousTrusted && previousState === UGOPT_AVAILABILITY_STATES.SELLABLE && currentState === UGOPT_AVAILABILITY_STATES.UNAVAILABLE) {
      changeEvents.push(UGOPT_CHANGE_EVENTS.BECAME_UNAVAILABLE);
    } else if (previousTrusted && previousState === UGOPT_AVAILABILITY_STATES.UNAVAILABLE && currentState === UGOPT_AVAILABILITY_STATES.SELLABLE) {
      changeEvents.push(UGOPT_CHANGE_EVENTS.BACK_IN_STOCK);
      requiresRepricing = true;
    } else if (previousTrusted && previousProduct !== undefined && previousState === currentState && currentState !== UGOPT_AVAILABILITY_STATES.AT_RISK) {
      changeEvents.push(UGOPT_CHANGE_EVENTS.UNCHANGED);
    }
    const changedPrice = previousTrusted && currentTrusted ? priceChange(previousProduct, currentProduct) : null;
    if (changedPrice !== null) {
      changeEvents.push(UGOPT_CHANGE_EVENTS.PRICE_CHANGED);
      requiresRepricing = true;
    }
    records.push({
      productKey: currentProduct.productKey,
      currentProduct,
      previousProduct,
      availabilityStatus: currentState,
      previousAvailabilityStatus: previousState,
      changeEvents,
      diagnostics,
      requiresRepricing,
      requiresPricingEvaluation,
      priceChange: changedPrice,
    });
  }

  for (const previousProduct of previousSnapshot?.products ?? []) {
    if (currentByKey.has(previousProduct.productKey)) continue;
    const previousState = deriveCurrentState(previousProduct);
    const missingIsRemoved = comparableScope;
    const availabilityStatus = missingIsRemoved ? UGOPT_AVAILABILITY_STATES.REMOVED : UGOPT_AVAILABILITY_STATES.AT_RISK;
    records.push({
      productKey: previousProduct.productKey,
      previousProduct,
      availabilityStatus,
      previousAvailabilityStatus: previousState,
      changeEvents: missingIsRemoved ? [UGOPT_CHANGE_EVENTS.REMOVED_FROM_SUPPLIER] : [],
      diagnostics: missingIsRemoved ? [] : [diagnostic('INCOMPLETE_SCAN', 'The product was absent from a scan that is not trusted for removal decisions.')],
      requiresRepricing: false,
      requiresPricingEvaluation: false,
    });
  }

  const sortedRecords = sortRecords(records);
  const changes = {
    newProducts: sortedRecords.filter((record) => record.changeEvents.includes(UGOPT_CHANGE_EVENTS.NEW_SUPPLIER_PRODUCT)),
    unavailable: sortedRecords.filter((record) => record.changeEvents.includes(UGOPT_CHANGE_EVENTS.BECAME_UNAVAILABLE)),
    removed: sortedRecords.filter((record) => record.changeEvents.includes(UGOPT_CHANGE_EVENTS.REMOVED_FROM_SUPPLIER)),
    backInStock: sortedRecords.filter((record) => record.changeEvents.includes(UGOPT_CHANGE_EVENTS.BACK_IN_STOCK)),
    reappeared: sortedRecords.filter((record) => record.changeEvents.includes(UGOPT_CHANGE_EVENTS.REAPPEARED)),
    priceChanged: sortedRecords.filter((record) => record.changeEvents.includes(UGOPT_CHANGE_EVENTS.PRICE_CHANGED)).map((record) => ({
      ...record,
      ...record.priceChange,
    })),
    atRisk: sortedRecords.filter((record) => record.availabilityStatus === UGOPT_AVAILABILITY_STATES.AT_RISK),
  };
  const repricingCandidates = sortedRecords.filter((record) => record.requiresRepricing).map((record) => ({
    productKey: record.productKey,
    reasons: record.changeEvents.filter((event) => [UGOPT_CHANGE_EVENTS.PRICE_CHANGED, UGOPT_CHANGE_EVENTS.NEW_SUPPLIER_PRODUCT, UGOPT_CHANGE_EVENTS.BACK_IN_STOCK, UGOPT_CHANGE_EVENTS.REAPPEARED].includes(event)),
    requiresRepricing: true,
  }));
  const newProductCandidates = sortedRecords.filter((record) => record.requiresPricingEvaluation).map((record) => ({
    productKey: record.productKey,
    requiresPricingEvaluation: true,
  }));
  const recordByKey = new Map(sortedRecords.map((record) => [record.productKey, record]));
  const critical = [];
  const uncertain = [];
  for (const storeProduct of active) {
    if (!storeProduct.active) continue;
    const record = recordByKey.get(storeProduct.productKey);
    const status = record?.availabilityStatus;
    if (status === UGOPT_AVAILABILITY_STATES.UNAVAILABLE || status === UGOPT_AVAILABILITY_STATES.REMOVED) {
      critical.push({
        ...storeProduct,
        availabilityStatus: status,
        riskCode: UGOPT_RISK_CODES.CRITICAL_SUPPLIER_FULFILLMENT_RISK,
      });
    } else if (status === UGOPT_AVAILABILITY_STATES.AT_RISK || record === undefined) {
      uncertain.push({
        ...storeProduct,
        availabilityStatus: UGOPT_AVAILABILITY_STATES.AT_RISK,
        riskCode: UGOPT_RISK_CODES.SUPPLIER_STATE_UNCERTAIN,
      });
    }
  }
  const baselineCreated = previousSnapshot === null && currentTrusted;
  const report = {
    supplier: UGOPT_SUPPLIER,
    baselineCreated,
    currentSnapshot: {
      complete: currentSnapshot.complete,
      scope: currentSnapshot.scope,
    },
    summary: {
      previousProductCount: previousSnapshot?.products.length ?? 0,
      currentProductCount: currentSnapshot.products.length,
      sellableCount: sortedRecords.filter((record) => record.availabilityStatus === UGOPT_AVAILABILITY_STATES.SELLABLE).length,
      unavailableCount: sortedRecords.filter((record) => record.availabilityStatus === UGOPT_AVAILABILITY_STATES.UNAVAILABLE).length,
      atRiskCount: sortedRecords.filter((record) => record.availabilityStatus === UGOPT_AVAILABILITY_STATES.AT_RISK).length,
      removedCount: sortedRecords.filter((record) => record.availabilityStatus === UGOPT_AVAILABILITY_STATES.REMOVED).length,
      newProductCount: changes.newProducts.length,
      backInStockCount: changes.backInStock.length,
      reappearedCount: changes.reappeared.length,
      priceChangedCount: changes.priceChanged.length,
      repricingRequiredCount: repricingCandidates.length,
      criticalActiveStoreRiskCount: critical.length,
      uncertainActiveStoreRiskCount: uncertain.length,
    },
    products: sortedRecords,
    changes,
    storeRisks: { critical, uncertain },
    repricingCandidates,
    newProductCandidates,
    diagnostics: [
      ...(!currentTrusted ? [diagnostic('INCOMPLETE_SCAN', 'The current snapshot is not trusted for disappearance/removal decisions.')] : []),
      ...(previousSnapshot !== null && !previousTrusted ? [diagnostic('PREVIOUS_SNAPSHOT_UNTRUSTED', 'The previous snapshot cannot support trusted transitions.')] : []),
      ...(previousTrusted && currentTrusted && !sameScope(previousSnapshot.scope, currentSnapshot.scope)
        ? [diagnostic('SCOPE_MISMATCH', 'Snapshots do not cover the same category scope; removals are blocked.')]
        : []),
    ],
  };
  if (options.includeNextMonitorState !== false) report.nextMonitorState = advanceUgoptMonitorState({ previousState: monitorState, currentSnapshot, report });
  return report;
}

export function formatUgoptDailySummary(report) {
  if (!isRecord(report) || !isRecord(report.summary)) throw new TypeError('report.summary must be an object');
  const count = (key) => new Intl.NumberFormat('uk-UA').format(report.summary[key] ?? 0);
  return [
    `Перевірено: ${count('currentProductCount')} товари`,
    `Доступні: ${count('sellableCount')}`,
    `Нові: ${count('newProductCount')}`,
    `Недоступні: ${count('unavailableCount')}`,
    `Зникли: ${count('removedCount')}`,
    `Повернулися: ${count('backInStockCount') + report.summary.reappearedCount}`,
    `Змінили закупівельну ціну: ${count('priceChangedCount')}`,
    `Потребують перерахунку ціни: ${count('repricingRequiredCount')}`,
    `Активні у магазині з критичним ризиком: ${count('criticalActiveStoreRiskCount')}`,
    `Активні у магазині з невизначеним supplier-state: ${count('uncertainActiveStoreRiskCount')}`,
  ].join('\n');
}
