const UAH = 'UAH';
const MONEY_SCALE = 100;
const BASIS_POINTS = 10_000;
const HARD_MAX_PRODUCTS = 6000;
const MAX_SAFE_MONEY_MINOR = Number.MAX_SAFE_INTEGER;

export const PRICING_STATUSES = Object.freeze({
  READY: 'READY',
  PRICE_REVIEW: 'PRICE_REVIEW',
  SKIP: 'SKIP',
});

export const MARKET_CONFIDENCE = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INSUFFICIENT: 'INSUFFICIENT',
});

const STATUS_RANK = Object.freeze({
  [PRICING_STATUSES.READY]: 3,
  [PRICING_STATUSES.PRICE_REVIEW]: 2,
  [PRICING_STATUSES.SKIP]: 1,
});

const CONFIDENCE_RANK = Object.freeze({
  [MARKET_CONFIDENCE.HIGH]: 3,
  [MARKET_CONFIDENCE.MEDIUM]: 2,
  [MARKET_CONFIDENCE.LOW]: 1,
  [MARKET_CONFIDENCE.INSUFFICIENT]: 0,
});

const POLICY_SECTIONS = new Set(['marketEvidence', 'competition', 'profitability', 'ranking', 'selection']);
const MARKET_EVIDENCE_KEYS = new Set([
  'minimumComparableCount',
  'minimumExactComparableCount',
  'activeListingsOnly',
  'allowedSources',
  'outlierPolicy',
  'minimumReadyConfidence',
  'confidence',
]);
const COMPETITION_KEYS = new Set([
  'targetMarketPosition',
  'priceStepMinor',
  'undercutMinor',
  'maximumAboveMarketMedianBps',
  'maximumAboveMarketUpperBoundBps',
]);
const PROFITABILITY_KEYS = new Set(['rules', 'dynamicNetRoiCurve']);
const RANKING_KEYS = new Set(['order']);
const SELECTION_KEYS = new Set(['maxProducts']);
const PROFIT_RULE_KEYS = new Set([
  'id',
  'minPurchaseMinor',
  'maxPurchaseMinor',
  'minimumNetProfitMinor',
  'minimumRoiBps',
  'minimumNetMarginBps',
]);
const RANKING_FACTORS = new Set([
  'status',
  'netProfitMinor',
  'roiBps',
  'netMarginBps',
  'marketConfidenceRank',
  'productKey',
]);
const TARGET_POSITIONS = new Set(['lowerQuartile', 'median', 'upperQuartile']);
const MATCH_TYPES = new Set(['exact', 'ambiguous', 'wrong']);
const MATCH_CONFIDENCES = new Set(['high', 'medium', 'low']);
const UNCERTAINTY_REASON_CODES = new Set([
  'MARKET_EVIDENCE_INSUFFICIENT',
  'AMBIGUOUS_COMPARABLE',
  'MARKET_CONFIDENCE_LOW',
  'COMMISSION_UNKNOWN',
  'SUPPLIER_CURRENCY_UNSUPPORTED',
  'PROFIT_POLICY_UNCONFIGURED',
]);
const ECONOMIC_FAILURE_REASON_CODES = new Set([
  'REQUIRED_PRICE_ABOVE_MARKET',
  'PRICE_ABOVE_COMPETITIVE_CEILING',
  'PROFIT_REQUIREMENT_UNREACHABLE',
  'PROFIT_BELOW_POLICY',
  'NEGATIVE_NET_PROFIT',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new PricingContractError(`${label} must be a non-empty string`, 'INVALID_STRING');
  return value.trim();
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new PricingContractError(`${label} must be a non-negative safe integer`, 'INVALID_INTEGER');
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new PricingContractError(`${label} must be a positive safe integer`, 'INVALID_INTEGER');
  return value;
}

function parseMinorAmount(value, label) {
  let text = value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PricingContractError(`${label} must be finite`, 'INVALID_MONEY');
    text = String(value);
  }
  if (typeof text !== 'string' || !/^\d+(?:\.\d{1,2})?$/u.test(text.trim())) {
    throw new PricingContractError(`${label} must be a non-negative amount with at most two decimals`, 'INVALID_MONEY');
  }
  const [whole, fraction = ''] = text.trim().split('.');
  const minor = Number(whole) * MONEY_SCALE + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(minor)) throw new PricingContractError(`${label} is outside safe money range`, 'INVALID_MONEY');
  return minor;
}

function parseMoney(value, label, { positive = false } = {}) {
  if (!isRecord(value)) throw new PricingContractError(`${label} must be an object with amount and currency`, 'INVALID_MONEY');
  const amountMinor = parseMinorAmount(value.amount, `${label}.amount`);
  if (positive && amountMinor <= 0) throw new PricingContractError(`${label} must be greater than zero`, 'INVALID_MONEY');
  const currency = nonEmptyString(value.currency, `${label}.currency`).toUpperCase();
  return { amountMinor, currency };
}

function moneyOutput(amountMinor, currency = UAH) {
  const absolute = Math.abs(amountMinor);
  const whole = Math.floor(absolute / MONEY_SCALE);
  const fraction = String(absolute % MONEY_SCALE).padStart(2, '0');
  const amount = `${amountMinor < 0 ? '-' : ''}${whole}.${fraction}`;
  return { amount, amountMinor, currency };
}

function percentOutput(bps) {
  if (bps === null || bps === undefined) return null;
  const absolute = Math.abs(bps);
  return `${bps < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function ceilDiv(numerator, denominator) {
  return Math.floor((numerator + denominator - 1) / denominator);
}

function roundCommission(sellingPriceMinor, rateBps) {
  return Number((BigInt(sellingPriceMinor) * BigInt(rateBps) + BigInt(BASIS_POINTS / 2)) / BigInt(BASIS_POINTS));
}

function canonicalUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/u, '');
  } catch {
    return null;
  }
}

function normalizeIdentity(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('uk-UA');
}

function identityValue(identity, key) {
  if (!isRecord(identity) || identity[key] === undefined || identity[key] === null) return null;
  return nonEmptyString(String(identity[key]), `identity.${key}`);
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new PricingContractError(`Unsupported ${label} field: ${key}`, 'UNSUPPORTED_FIELD');
  }
}

function validateConfidenceThresholds(value, label) {
  if (!isRecord(value)) throw new PricingContractError(`${label} must be an object`, 'INVALID_POLICY');
  assertKnownKeys(value, new Set(['minimumComparableCount', 'minimumExactComparableCount', 'minimumSourceCount']), label);
  for (const key of ['minimumComparableCount', 'minimumExactComparableCount', 'minimumSourceCount']) {
    positiveInteger(value[key], `${label}.${key}`);
  }
  return clone(value);
}

const DEFAULT_POLICY_TEMPLATE = {
  marketEvidence: {
    minimumComparableCount: 3,
    minimumExactComparableCount: 1,
    activeListingsOnly: true,
    allowedSources: null,
    outlierPolicy: { method: 'none' },
    minimumReadyConfidence: MARKET_CONFIDENCE.HIGH,
    confidence: {
      high: { minimumComparableCount: 5, minimumExactComparableCount: 3, minimumSourceCount: 2 },
      medium: { minimumComparableCount: 3, minimumExactComparableCount: 1, minimumSourceCount: 1 },
    },
  },
  competition: {
    targetMarketPosition: 'median',
    priceStepMinor: 1,
    undercutMinor: 0,
    maximumAboveMarketMedianBps: 0,
    maximumAboveMarketUpperBoundBps: 0,
  },
  profitability: { rules: [] },
  ranking: {
    order: ['status', 'netProfitMinor', 'roiBps', 'netMarginBps', 'marketConfidenceRank', 'productKey'],
  },
  selection: { maxProducts: HARD_MAX_PRODUCTS },
};

export const DEFAULT_MARKET_PRICING_POLICY = deepFreeze(clone(DEFAULT_POLICY_TEMPLATE));

/** PR30 category-production ROI anchors, expressed in UAH minor units and bps. */
export const CATEGORY_PRODUCTION_NET_ROI_ANCHORS = Object.freeze([
  Object.freeze({ purchasePriceMinor: 5_000, targetRoiBps: 13_000 }),
  Object.freeze({ purchasePriceMinor: 10_000, targetRoiBps: 11_500 }),
  Object.freeze({ purchasePriceMinor: 30_000, targetRoiBps: 8_500 }),
  Object.freeze({ purchasePriceMinor: 60_000, targetRoiBps: 7_500 }),
  Object.freeze({ purchasePriceMinor: 100_000, targetRoiBps: 6_500 }),
  Object.freeze({ purchasePriceMinor: 200_000, targetRoiBps: 5_500 }),
  Object.freeze({ purchasePriceMinor: 500_000, targetRoiBps: 4_500 }),
  Object.freeze({ purchasePriceMinor: 1_000_000, targetRoiBps: 3_500 }),
  Object.freeze({ purchasePriceMinor: 2_000_000, targetRoiBps: 2_500 }),
]);

function mergePolicy(base, override) {
  const merged = clone(base);
  for (const [section, value] of Object.entries(override)) {
    if (section === 'marketEvidence') {
      const { confidence, outlierPolicy, ...scalarValues } = value;
      Object.assign(merged[section], scalarValues);
      if (confidence !== undefined) merged[section].confidence = { ...merged[section].confidence, ...confidence };
      if (outlierPolicy !== undefined) merged[section].outlierPolicy = { ...merged[section].outlierPolicy, ...outlierPolicy };
    } else if (section === 'competition') Object.assign(merged[section], value);
    else if (section === 'profitability' || section === 'ranking' || section === 'selection') Object.assign(merged[section], value);
  }
  return merged;
}

function validateDynamicNetRoiCurve(value, label = 'profitability.dynamicNetRoiCurve') {
  if (!Array.isArray(value) || value.length < 2) throw new PricingContractError(`${label} must contain at least two anchors`, 'INVALID_POLICY');
  let previousPurchasePriceMinor = -1;
  return value.map((anchor, index) => {
    if (!isRecord(anchor)) throw new PricingContractError(`${label}[${index}] must be an object`, 'INVALID_POLICY');
    assertKnownKeys(anchor, new Set(['purchasePriceMinor', 'targetRoiBps']), `${label}[${index}]`);
    if (!Number.isSafeInteger(anchor.purchasePriceMinor) || anchor.purchasePriceMinor < 0) {
      throw new PricingContractError(`${label}[${index}].purchasePriceMinor must be a non-negative safe integer`, 'INVALID_POLICY');
    }
    if (!Number.isSafeInteger(anchor.targetRoiBps) || anchor.targetRoiBps < 0) {
      throw new PricingContractError(`${label}[${index}].targetRoiBps must be a non-negative safe integer`, 'INVALID_POLICY');
    }
    if (anchor.purchasePriceMinor <= previousPurchasePriceMinor) {
      throw new PricingContractError(`${label} purchasePriceMinor values must be strictly increasing`, 'INVALID_POLICY');
    }
    previousPurchasePriceMinor = anchor.purchasePriceMinor;
    return { purchasePriceMinor: anchor.purchasePriceMinor, targetRoiBps: anchor.targetRoiBps };
  });
}

/** Resolve the deterministic piecewise-linear target net ROI for a purchase price. */
export function resolveCategoryProductionNetRoiBps(purchasePriceMinor, curve = CATEGORY_PRODUCTION_NET_ROI_ANCHORS) {
  if (!Number.isSafeInteger(purchasePriceMinor) || purchasePriceMinor < 0) {
    throw new PricingContractError('purchasePriceMinor must be a non-negative safe integer', 'INVALID_MONEY');
  }
  const anchors = validateDynamicNetRoiCurve(curve);
  if (purchasePriceMinor <= anchors[0].purchasePriceMinor) return anchors[0].targetRoiBps;
  for (let index = 1; index < anchors.length; index += 1) {
    const right = anchors[index];
    const left = anchors[index - 1];
    if (purchasePriceMinor <= right.purchasePriceMinor) {
      const span = right.purchasePriceMinor - left.purchasePriceMinor;
      const offset = purchasePriceMinor - left.purchasePriceMinor;
      return Math.round(left.targetRoiBps + ((right.targetRoiBps - left.targetRoiBps) * offset) / span);
    }
  }
  return anchors.at(-1).targetRoiBps;
}

function validateProfitRule(rule, index) {
  if (!isRecord(rule)) throw new PricingContractError(`profitability.rules[${index}] must be an object`, 'INVALID_POLICY');
  assertKnownKeys(rule, PROFIT_RULE_KEYS, `profitability.rules[${index}]`);
  const result = clone(rule);
  result.id = nonEmptyString(rule.id, `profitability.rules[${index}].id`);
  for (const key of ['minPurchaseMinor', 'maxPurchaseMinor', 'minimumNetProfitMinor', 'minimumRoiBps', 'minimumNetMarginBps']) {
    if (rule[key] !== undefined) result[key] = nonNegativeInteger(rule[key], `profitability.rules[${index}].${key}`);
  }
  if (result.minPurchaseMinor !== undefined && result.maxPurchaseMinor !== undefined && result.minPurchaseMinor > result.maxPurchaseMinor) {
    throw new PricingContractError(`profitability.rules[${index}] purchase range is inverted`, 'INVALID_POLICY');
  }
  if (result.minimumNetMarginBps !== undefined && result.minimumNetMarginBps >= BASIS_POINTS) {
    throw new PricingContractError(`profitability.rules[${index}].minimumNetMarginBps must be below 100%`, 'INVALID_POLICY');
  }
  if ([result.minimumNetProfitMinor, result.minimumRoiBps, result.minimumNetMarginBps].every((value) => value === undefined)) {
    throw new PricingContractError(`profitability.rules[${index}] must configure at least one profitability floor`, 'INVALID_POLICY');
  }
  return result;
}

function rangesOverlap(left, right) {
  const leftMin = left.minPurchaseMinor ?? 0;
  const leftMax = left.maxPurchaseMinor ?? Number.MAX_SAFE_INTEGER;
  const rightMin = right.minPurchaseMinor ?? 0;
  const rightMax = right.maxPurchaseMinor ?? Number.MAX_SAFE_INTEGER;
  return leftMin <= rightMax && rightMin <= leftMax;
}

export function resolvePricingPolicy(override = {}) {
  if (!isRecord(override)) throw new PricingContractError('pricing policy must be an object', 'INVALID_POLICY');
  assertKnownKeys(override, POLICY_SECTIONS, 'pricing policy');
  for (const [section, value] of Object.entries(override)) {
    if (!isRecord(value)) throw new PricingContractError(`pricing policy.${section} must be an object`, 'INVALID_POLICY');
    const allowed = section === 'marketEvidence'
      ? MARKET_EVIDENCE_KEYS
      : section === 'competition'
        ? COMPETITION_KEYS
        : section === 'profitability'
          ? PROFITABILITY_KEYS
          : section === 'ranking' ? RANKING_KEYS : SELECTION_KEYS;
    assertKnownKeys(value, allowed, `pricing policy.${section}`);
  }
  const policy = mergePolicy(DEFAULT_MARKET_PRICING_POLICY, override);
  const evidence = policy.marketEvidence;
  nonNegativeInteger(evidence.minimumComparableCount, 'marketEvidence.minimumComparableCount');
  nonNegativeInteger(evidence.minimumExactComparableCount, 'marketEvidence.minimumExactComparableCount');
  if (evidence.minimumComparableCount === 0 || evidence.minimumExactComparableCount === 0) {
    throw new PricingContractError('market evidence minimum counts must be positive', 'INVALID_POLICY');
  }
  if (typeof evidence.activeListingsOnly !== 'boolean') throw new PricingContractError('marketEvidence.activeListingsOnly must be boolean', 'INVALID_POLICY');
  if (evidence.allowedSources !== null) {
    if (!Array.isArray(evidence.allowedSources) || evidence.allowedSources.some((source) => typeof source !== 'string' || source.trim() === '')) {
      throw new PricingContractError('marketEvidence.allowedSources must be null or non-empty strings', 'INVALID_POLICY');
    }
    evidence.allowedSources = [...new Set(evidence.allowedSources.map((source) => source.trim()))];
  }
  if (!isRecord(evidence.outlierPolicy)) throw new PricingContractError('marketEvidence.outlierPolicy must be an object', 'INVALID_POLICY');
  assertKnownKeys(evidence.outlierPolicy, new Set(['method']), 'marketEvidence.outlierPolicy');
  if (evidence.outlierPolicy.method !== 'none') throw new PricingContractError('only outlierPolicy.method=none is supported in v1', 'INVALID_POLICY');
  if (!Object.values(MARKET_CONFIDENCE).includes(evidence.minimumReadyConfidence)) throw new PricingContractError('marketEvidence.minimumReadyConfidence is invalid', 'INVALID_POLICY');
  evidence.confidence = {
    high: validateConfidenceThresholds(evidence.confidence.high, 'marketEvidence.confidence.high'),
    medium: validateConfidenceThresholds(evidence.confidence.medium, 'marketEvidence.confidence.medium'),
  };
  for (const key of ['minimumComparableCount', 'minimumExactComparableCount']) {
    if (evidence.confidence.medium[key] < evidence[key]) throw new PricingContractError(`marketEvidence.confidence.medium.${key} cannot be below marketEvidence.${key}`, 'INVALID_POLICY');
  }
  if (evidence.confidence.high.minimumComparableCount < evidence.confidence.medium.minimumComparableCount
    || evidence.confidence.high.minimumExactComparableCount < evidence.confidence.medium.minimumExactComparableCount
    || evidence.confidence.high.minimumSourceCount < evidence.confidence.medium.minimumSourceCount) {
    throw new PricingContractError('high confidence thresholds cannot be below medium thresholds', 'INVALID_POLICY');
  }

  const competition = policy.competition;
  if (!TARGET_POSITIONS.has(competition.targetMarketPosition)) throw new PricingContractError('competition.targetMarketPosition is invalid', 'INVALID_POLICY');
  positiveInteger(competition.priceStepMinor, 'competition.priceStepMinor');
  nonNegativeInteger(competition.undercutMinor, 'competition.undercutMinor');
  for (const key of ['maximumAboveMarketMedianBps', 'maximumAboveMarketUpperBoundBps']) {
    nonNegativeInteger(competition[key], `competition.${key}`);
  }

  if (!isRecord(policy.profitability) || !Array.isArray(policy.profitability.rules)) throw new PricingContractError('profitability.rules must be an array', 'INVALID_POLICY');
  policy.profitability.rules = policy.profitability.rules.map(validateProfitRule);
  if (policy.profitability.dynamicNetRoiCurve !== undefined) {
    policy.profitability.dynamicNetRoiCurve = validateDynamicNetRoiCurve(policy.profitability.dynamicNetRoiCurve);
  }
  for (let left = 0; left < policy.profitability.rules.length; left += 1) {
    for (let right = left + 1; right < policy.profitability.rules.length; right += 1) {
      if (rangesOverlap(policy.profitability.rules[left], policy.profitability.rules[right])) {
        throw new PricingContractError('profitability rules have overlapping purchase ranges', 'AMBIGUOUS_PROFIT_POLICY');
      }
    }
  }

  if (!Array.isArray(policy.ranking.order) || policy.ranking.order.length !== RANKING_FACTORS.size
    || new Set(policy.ranking.order).size !== policy.ranking.order.length || policy.ranking.order.some((factor) => !RANKING_FACTORS.has(factor))) {
    throw new PricingContractError('ranking.order must contain each supported factor exactly once', 'INVALID_POLICY');
  }
  if (policy.ranking.order[0] !== 'status') throw new PricingContractError('ranking.order must keep status precedence first', 'INVALID_POLICY');
  nonNegativeInteger(policy.selection.maxProducts, 'selection.maxProducts');
  if (policy.selection.maxProducts > HARD_MAX_PRODUCTS) throw new PricingContractError(`selection.maxProducts cannot exceed ${HARD_MAX_PRODUCTS}`, 'INVALID_POLICY');
  return deepFreeze(policy);
}

function validateProduct(product) {
  if (!isRecord(product)) throw new PricingContractError('product must be an object', 'INVALID_PRODUCT');
  const productKey = nonEmptyString(product.productKey, 'product.productKey');
  if (!isRecord(product.supplier)) throw new PricingContractError('product.supplier must be an object', 'SUPPLIER_DATA_INVALID');
  assertKnownKeys(product.supplier, new Set(['name', 'purchasePrice', 'provenance', 'supplierSku', 'sourceUrl', 'otherConfiguredCosts']), 'product.supplier');
  const supplierName = nonEmptyString(product.supplier.name, 'product.supplier.name');
  if (supplierName !== 'ug-opt') throw new PricingContractError('product.supplier.name must be ug-opt', 'SUPPLIER_INVALID');
  if (product.supplier.purchasePrice === undefined) throw new PricingContractError('product.supplier.purchasePrice is required', 'SUPPLIER_PRICE_REQUIRED');
  const purchasePrice = parseMoney(product.supplier.purchasePrice, 'product.supplier.purchasePrice', { positive: true });
  if (!isRecord(product.supplier.provenance)) throw new PricingContractError('product.supplier.provenance must be an object', 'SUPPLIER_PROVENANCE_REQUIRED');
  const provenance = clone(product.supplier.provenance);
  if (product.supplier.supplierSku !== undefined) nonEmptyString(product.supplier.supplierSku, 'product.supplier.supplierSku');
  if (product.supplier.sourceUrl !== undefined) nonEmptyString(product.supplier.sourceUrl, 'product.supplier.sourceUrl');
  let otherConfiguredCosts;
  if (product.supplier.otherConfiguredCosts !== undefined) {
    otherConfiguredCosts = parseMoney(product.supplier.otherConfiguredCosts, 'product.supplier.otherConfiguredCosts');
  }
  const identity = isRecord(product.identity) ? clone(product.identity) : {};
  if (identity.brand !== undefined) identityValue(identity, 'brand');
  if (identity.model !== undefined) identityValue(identity, 'model');
  return {
    original: clone(product),
    productKey,
    supplier: {
      name: supplierName,
      purchasePrice,
      provenance,
      ...(product.supplier.supplierSku === undefined ? {} : { supplierSku: product.supplier.supplierSku }),
      ...(product.supplier.sourceUrl === undefined ? {} : { sourceUrl: product.supplier.sourceUrl }),
      ...(otherConfiguredCosts === undefined ? {} : { otherConfiguredCosts }),
    },
    identity,
  };
}

function validateCommission(value) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new PricingContractError('commission must be an object', 'COMMISSION_INVALID');
  assertKnownKeys(value, new Set(['rateBps', 'source', 'categoryId', 'provenance']), 'commission');
  if (!Number.isSafeInteger(value.rateBps) || value.rateBps < 0 || value.rateBps >= BASIS_POINTS) {
    throw new PricingContractError('commission.rateBps must be an integer from 0 through 9999', 'COMMISSION_INVALID');
  }
  const source = nonEmptyString(value.source, 'commission.source');
  if (!isRecord(value.provenance)) throw new PricingContractError('commission.provenance must be an object', 'COMMISSION_PROVENANCE_REQUIRED');
  return {
    rateBps: value.rateBps,
    source,
    ...(value.categoryId === undefined ? {} : { categoryId: value.categoryId }),
    provenance: clone(value.provenance),
  };
}

function validateComparableShape(item, index) {
  if (!isRecord(item)) return { reasonCode: 'MALFORMED_COMPARABLE', message: `comparable ${index} is not an object` };
  if (typeof item.source !== 'string' || item.source.trim() === '') return { reasonCode: 'COMPARABLE_SOURCE_MISSING', message: 'comparable source is required' };
  if (typeof item.title !== 'string' || item.title.trim() === '') return { reasonCode: 'COMPARABLE_TITLE_MISSING', message: 'comparable title is required' };
  if (typeof item.available !== 'boolean') return { reasonCode: 'COMPARABLE_AVAILABILITY_INVALID', message: 'comparable available must be boolean' };
  if (!MATCH_TYPES.has(item.matchType)) return { reasonCode: 'COMPARABLE_MATCH_TYPE_INVALID', message: 'comparable matchType is invalid' };
  if (item.matchConfidence !== undefined && !MATCH_CONFIDENCES.has(item.matchConfidence)) return { reasonCode: 'COMPARABLE_MATCH_CONFIDENCE_INVALID', message: 'comparable matchConfidence is invalid' };
  const listingKey = item.listingId !== undefined
    ? (typeof item.listingId === 'string' && item.listingId.trim() !== '' ? `listing:${item.source.trim()}:${item.listingId.trim()}` : null)
    : canonicalUrl(item.url) === null ? null : `url:${canonicalUrl(item.url)}`;
  if (!listingKey) return { reasonCode: 'COMPARABLE_TRACEABILITY_MISSING', message: 'comparable requires listingId or a valid URL' };
  let price;
  try {
    price = parseMoney(item.price, `comparables[${index}].price`, { positive: true });
  } catch (error) {
    return { reasonCode: error.code === 'INVALID_MONEY' ? 'COMPARABLE_PRICE_INVALID' : 'COMPARABLE_PRICE_INVALID', message: error.message };
  }
  if (item.productKey !== undefined && item.productKey !== null && typeof item.productKey !== 'string') return { reasonCode: 'COMPARABLE_PRODUCT_KEY_INVALID', message: 'comparable productKey must be a string' };
  return { item, price, listingKey };
}

function identityRejection(item, productIdentity, productKey) {
  const brand = identityValue(productIdentity, 'brand');
  const model = identityValue(productIdentity, 'model');
  if (item.productKey !== undefined && item.productKey !== null && item.productKey !== productKey) return 'COMPARABLE_PRODUCT_KEY_MISMATCH';
  if (item.matchType === 'ambiguous') return 'AMBIGUOUS_COMPARABLE';
  if (item.matchType === 'wrong') return 'WRONG_PRODUCT_MATCH';
  if (model !== null) {
    if (typeof item.model !== 'string' || normalizeIdentity(item.model) !== normalizeIdentity(model)) return 'WRONG_MODEL';
    if (brand !== null && (typeof item.brand !== 'string' || normalizeIdentity(item.brand) !== normalizeIdentity(brand))) return 'WRONG_BRAND';
    return null;
  }
  if (item.matchType !== 'exact' || item.matchConfidence !== 'high' || !isRecord(item.productIdentityEvidence)
    || Object.keys(item.productIdentityEvidence).length === 0) return 'COMPARABLE_IDENTITY_EVIDENCE_MISSING';
  if (item.productIdentityEvidence.productKey !== undefined && item.productIdentityEvidence.productKey !== productKey) return 'COMPARABLE_PRODUCT_KEY_MISMATCH';
  return null;
}

function confidenceFor(accepted, productPolicy, exactCount, sourceCount) {
  const { confidence } = productPolicy;
  if (accepted < productPolicy.minimumComparableCount || exactCount < productPolicy.minimumExactComparableCount) return MARKET_CONFIDENCE.INSUFFICIENT;
  if (accepted >= confidence.high.minimumComparableCount && exactCount >= confidence.high.minimumExactComparableCount && sourceCount >= confidence.high.minimumSourceCount) return MARKET_CONFIDENCE.HIGH;
  if (accepted >= confidence.medium.minimumComparableCount && exactCount >= confidence.medium.minimumExactComparableCount && sourceCount >= confidence.medium.minimumSourceCount) return MARKET_CONFIDENCE.MEDIUM;
  return MARKET_CONFIDENCE.LOW;
}

function medianMinor(values) {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle];
  return ceilDiv(values[middle - 1] + values[middle], 2);
}

function marketStatistics(accepted, rejected, policy, productIdentity) {
  const sortedPrices = accepted.map((item) => item.price.amountMinor).sort((left, right) => left - right);
  const exactCount = accepted.filter((item) => item.matchType === 'exact').length;
  const sourceCount = new Set(accepted.map((item) => item.source)).size;
  const lowerHalf = sortedPrices.slice(0, Math.floor(sortedPrices.length / 2));
  const upperHalf = sortedPrices.slice(Math.ceil(sortedPrices.length / 2));
  const reasonCounts = {};
  for (const item of rejected) reasonCounts[item.reasonCode] = (reasonCounts[item.reasonCode] ?? 0) + 1;
  const confidence = confidenceFor(sortedPrices.length, policy.marketEvidence, exactCount, sourceCount);
  return {
    acceptedComparableCount: accepted.length,
    rejectedComparableCount: rejected.length,
    exactComparableCount: exactCount,
    minimum: sortedPrices.length ? moneyOutput(sortedPrices[0]) : null,
    maximum: sortedPrices.length ? moneyOutput(sortedPrices[sortedPrices.length - 1]) : null,
    median: medianMinor(sortedPrices) === null ? null : moneyOutput(medianMinor(sortedPrices)),
    lowerQuartile: lowerHalf.length ? moneyOutput(medianMinor(lowerHalf)) : null,
    upperQuartile: upperHalf.length ? moneyOutput(medianMinor(upperHalf)) : null,
    confidence,
    evidenceSummary: {
      sourceCount,
      exactIdentityCount: exactCount,
      rejectedReasonCounts: reasonCounts,
      outlierPolicy: clone(policy.marketEvidence.outlierPolicy),
      outliersExcluded: [],
      sampleMeaning: 'statistics describe only the supplied accepted comparable sample',
    },
    acceptedComparables: clone(accepted),
    rejectedComparables: clone(rejected),
    productIdentity: clone(productIdentity),
  };
}

function marketWithoutEvidence(product, policy) {
  const market = marketStatistics([], [], policy, product.identity);
  return {
    ...market,
    status: 'NOT_RESEARCHED',
    evidenceSummary: {
      ...market.evidenceSummary,
      sampleMeaning: 'no market evidence was provided; market analytics are unavailable',
    },
  };
}

function filterMarketEvidence(product, response, policy) {
  if (!isRecord(response)) throw new MarketPricingError('market researcher must return an object', 'MARKET_EVIDENCE_INVALID');
  if (response.productKey !== product.productKey) throw new MarketPricingError('market evidence productKey does not match the requested product', 'MARKET_EVIDENCE_PRODUCT_KEY_MISMATCH');
  if (!Array.isArray(response.comparables)) throw new MarketPricingError('market evidence comparables must be an array', 'MARKET_EVIDENCE_INVALID');
  const accepted = [];
  const rejected = [];
  const seenListings = new Set();
  for (const [index, raw] of response.comparables.entries()) {
    const shaped = validateComparableShape(raw, index);
    if (shaped.reasonCode) {
      rejected.push({ index, reasonCode: shaped.reasonCode, message: shaped.message });
      continue;
    }
    const item = shaped.item;
    if (item.productKey !== undefined && item.productKey !== product.productKey) {
      rejected.push({ index, reasonCode: 'COMPARABLE_PRODUCT_KEY_MISMATCH', message: 'comparable productKey does not match requested product' });
      continue;
    }
    if (seenListings.has(shaped.listingKey)) {
      rejected.push({ index, reasonCode: 'DUPLICATE_LISTING', message: 'exact listing identity was already accepted or rejected' });
      continue;
    }
    seenListings.add(shaped.listingKey);
    if (policy.marketEvidence.allowedSources !== null && !policy.marketEvidence.allowedSources.includes(item.source.trim())) {
      rejected.push({ index, reasonCode: 'SOURCE_NOT_ALLOWED', message: 'comparable source is not allowed by policy' });
      continue;
    }
    if (policy.marketEvidence.activeListingsOnly && !item.available) {
      rejected.push({ index, reasonCode: 'COMPARABLE_UNAVAILABLE', message: 'unavailable comparable is excluded by policy' });
      continue;
    }
    if (shaped.price.currency !== UAH) {
      rejected.push({ index, reasonCode: 'COMPARABLE_UNSUPPORTED_CURRENCY', message: 'market evidence currency is not UAH and no FX conversion is allowed' });
      continue;
    }
    const identityReason = identityRejection(item, product.identity, product.productKey);
    if (identityReason) {
      rejected.push({ index, reasonCode: identityReason, message: 'comparable identity does not satisfy the exact-match rule' });
      continue;
    }
    accepted.push({
      source: item.source.trim(),
      ...(item.listingId === undefined ? {} : { listingId: item.listingId }),
      ...(item.url === undefined ? {} : { url: canonicalUrl(item.url) }),
      seller: item.seller,
      title: item.title.trim(),
      price: moneyOutput(shaped.price.amountMinor, shaped.price.currency),
      available: item.available,
      ...(item.brand === undefined ? {} : { brand: item.brand }),
      ...(item.model === undefined ? {} : { model: item.model }),
      ...(item.productIdentityEvidence === undefined ? {} : { productIdentityEvidence: clone(item.productIdentityEvidence) }),
      matchType: item.matchType,
      ...(item.matchConfidence === undefined ? {} : { matchConfidence: item.matchConfidence }),
      listingKey: shaped.listingKey,
    });
  }
  return marketStatistics(accepted, rejected, policy, product.identity);
}

function validateResearcher(researcher) {
  if (typeof researcher !== 'function') throw new PricingContractError('options.researcher must be a function', 'MARKET_RESEARCHER_REQUIRED');
}

export async function collectMarketEvidence(product, { researcher } = {}) {
  validateResearcher(researcher);
  const input = clone(product);
  let response;
  try {
    response = await researcher(input, { productKey: product.productKey });
  } catch (error) {
    throw new MarketPricingError('market researcher failed', 'MARKET_RESEARCH_FAILURE', error);
  }
  if (!isRecord(response) || !Array.isArray(response.comparables) || response.productKey !== product.productKey) {
    throw new MarketPricingError('market researcher returned a malformed response', 'MARKET_EVIDENCE_INVALID');
  }
  return clone(response);
}

function matchingProfitRule(purchaseMinor, rules, dynamicNetRoiCurve) {
  if (dynamicNetRoiCurve !== undefined) {
    return {
      id: 'category-production-dynamic-net-roi',
      minimumRoiBps: resolveCategoryProductionNetRoiBps(purchaseMinor, dynamicNetRoiCurve),
    };
  }
  const matches = rules.filter((rule) => (rule.minPurchaseMinor === undefined || purchaseMinor >= rule.minPurchaseMinor)
    && (rule.maxPurchaseMinor === undefined || purchaseMinor <= rule.maxPurchaseMinor));
  if (matches.length > 1) throw new PricingContractError('profitability policy matches more than one rule', 'AMBIGUOUS_PROFIT_POLICY');
  return matches[0] ?? null;
}

function profitabilityMetrics(sellingMinor, purchaseMinor, costsMinor, commission) {
  const commissionAmountMinor = roundCommission(sellingMinor, commission.rateBps);
  const netProfitMinor = sellingMinor - commissionAmountMinor - purchaseMinor - costsMinor;
  const roiBps = Math.floor((netProfitMinor * BASIS_POINTS) / purchaseMinor);
  const netMarginBps = sellingMinor === 0 ? null : Math.floor((netProfitMinor * BASIS_POINTS) / sellingMinor);
  return { commissionAmountMinor, netProfitMinor, roiBps, netMarginBps };
}

function floorDiv(numerator, denominator) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder !== 0n && ((remainder < 0n) !== (denominator < 0n)) ? quotient - 1n : quotient;
}

function exactProfitabilityAtPrice(sellingMinor, purchaseMinor, costsMinor, commission) {
  const selling = BigInt(sellingMinor);
  const purchase = BigInt(purchaseMinor);
  const costs = BigInt(costsMinor);
  const commissionMinor = (selling * BigInt(commission.rateBps) + BigInt(BASIS_POINTS / 2)) / BigInt(BASIS_POINTS);
  const netProfit = selling - commissionMinor - purchase - costs;
  return {
    commissionMinor,
    netProfit,
    roiBps: floorDiv(netProfit * BigInt(BASIS_POINTS), purchase),
    netMarginBps: selling === 0n ? null : floorDiv(netProfit * BigInt(BASIS_POINTS), selling),
  };
}

function meetsProfitPolicyAtPrice(sellingMinor, purchaseMinor, costsMinor, commission, rule) {
  const metrics = exactProfitabilityAtPrice(sellingMinor, purchaseMinor, costsMinor, commission);
  if (rule.minimumNetProfitMinor !== undefined && metrics.netProfit < BigInt(rule.minimumNetProfitMinor)) return false;
  if (rule.minimumRoiBps !== undefined && metrics.roiBps < BigInt(rule.minimumRoiBps)) return false;
  if (rule.minimumNetMarginBps !== undefined && (metrics.netMarginBps === null || metrics.netMarginBps < BigInt(rule.minimumNetMarginBps))) return false;
  return true;
}

function minimumSellingPriceRequired(purchaseMinor, costsMinor, commission, rule) {
  if (rule.minimumNetMarginBps !== undefined && rule.minimumNetMarginBps >= BASIS_POINTS - commission.rateBps) return null;
  let low = 0;
  let high = MAX_SAFE_MONEY_MINOR;
  if (!meetsProfitPolicyAtPrice(high, purchaseMinor, costsMinor, commission, rule)) return null;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (meetsProfitPolicyAtPrice(middle, purchaseMinor, costsMinor, commission, rule)) high = middle;
    else low = middle + 1;
  }
  return low;
}

function ceilingFor(market, competition) {
  const median = market.median?.amountMinor;
  const upper = market.upperQuartile?.amountMinor ?? market.maximum?.amountMinor;
  const ceilings = [];
  if (median !== undefined && median !== null) ceilings.push(ceilDiv(median * (BASIS_POINTS + competition.maximumAboveMarketMedianBps), BASIS_POINTS));
  if (upper !== undefined && upper !== null) ceilings.push(ceilDiv(upper * (BASIS_POINTS + competition.maximumAboveMarketUpperBoundBps), BASIS_POINTS));
  return ceilings.length ? Math.min(...ceilings) : null;
}

function targetFor(market, competition) {
  const selected = competition.targetMarketPosition === 'lowerQuartile'
    ? market.lowerQuartile
    : competition.targetMarketPosition === 'upperQuartile' ? market.upperQuartile : market.median;
  if (!selected) return null;
  return Math.max(1, selected.amountMinor - competition.undercutMinor);
}

function roundDownToStep(value, step) {
  return Math.max(step, Math.floor(value / step) * step);
}

function roundUpToStep(value, step) {
  return ceilDiv(value, step) * step;
}

function pricingOutput(market, competition, commission, purchaseMinor, costsMinor, rule, { enforceCompetitiveCeiling = true, allowMissingMarket = false, ignoreMarketTarget = false } = {}) {
  const marketTargetMinor = ignoreMarketTarget ? null : targetFor(market, competition);
  const competitiveCeilingMinor = ceilingFor(market, competition);
  if ((marketTargetMinor === null && !allowMissingMarket) || (enforceCompetitiveCeiling && competitiveCeilingMinor === null)) return null;
  const minimumRequiredMinor = minimumSellingPriceRequired(purchaseMinor, costsMinor, commission, rule);
  const targetMinor = marketTargetMinor === null ? null : roundDownToStep(marketTargetMinor, competition.priceStepMinor);
  const base = {
    strategy: competition.targetMarketPosition,
    marketTarget: targetMinor === null ? null : moneyOutput(targetMinor),
    minimumSellingPriceRequired: minimumRequiredMinor === null ? null : moneyOutput(minimumRequiredMinor),
    competitiveCeiling: competitiveCeilingMinor === null ? null : moneyOutput(competitiveCeilingMinor),
  };
  if (minimumRequiredMinor === null) return { ...base, recommendedPrice: null, profitability: null, pricingFailureReason: 'PROFIT_REQUIREMENT_UNREACHABLE' };
  const roundedRequiredMinor = roundUpToStep(minimumRequiredMinor, competition.priceStepMinor);
  const recommendedPriceMinor = targetMinor === null || roundedRequiredMinor > targetMinor ? roundedRequiredMinor : targetMinor;
  if (enforceCompetitiveCeiling && recommendedPriceMinor > competitiveCeilingMinor) {
    return {
      ...base,
      recommendedPrice: null,
      profitability: null,
      pricingFailureReason: minimumRequiredMinor > competitiveCeilingMinor
        ? 'REQUIRED_PRICE_ABOVE_MARKET'
        : 'PRICE_ABOVE_COMPETITIVE_CEILING',
    };
  }
  const metrics = profitabilityMetrics(recommendedPriceMinor, purchaseMinor, costsMinor, commission);
  const raised = targetMinor === null || recommendedPriceMinor !== targetMinor;
  return {
    ...base,
    strategy: targetMinor === null
      ? 'profit_floor_without_market'
      : raised ? `${competition.targetMarketPosition}_with_profit_floor` : competition.targetMarketPosition,
    recommendedPrice: moneyOutput(recommendedPriceMinor),
    profitability: metrics,
    pricingFailureReason: null,
  };
}

function supplierOutput(product) {
  return {
    name: product.supplier.name,
    purchasePrice: moneyOutput(product.supplier.purchasePrice.amountMinor, product.supplier.purchasePrice.currency),
    provenance: clone(product.supplier.provenance),
    ...(product.supplier.supplierSku === undefined ? {} : { supplierSku: product.supplier.supplierSku }),
    ...(product.supplier.sourceUrl === undefined ? {} : { sourceUrl: product.supplier.sourceUrl }),
    ...(product.supplier.otherConfiguredCosts === undefined ? {} : {
      otherConfiguredCosts: moneyOutput(product.supplier.otherConfiguredCosts.amountMinor, product.supplier.otherConfiguredCosts.currency),
    }),
  };
}

function decisionReason(status, reasonCodes) {
  return { status, reasonCodes: [...new Set(reasonCodes)] };
}

function prerequisiteReasonCodes({ market, policy, commission, supplierCurrencySupported, rule, marketEvidenceOptional = false }) {
  const reasons = [];
  const minimumReadyRank = CONFIDENCE_RANK[policy.marketEvidence.minimumReadyConfidence];
  if (!marketEvidenceOptional) {
    if (market.acceptedComparableCount < policy.marketEvidence.minimumComparableCount
      || market.exactComparableCount < policy.marketEvidence.minimumExactComparableCount) reasons.push('MARKET_EVIDENCE_INSUFFICIENT');
    if (market.rejectedComparables.some((item) => item.reasonCode === 'AMBIGUOUS_COMPARABLE')) reasons.push('AMBIGUOUS_COMPARABLE');
    if (CONFIDENCE_RANK[market.confidence] < minimumReadyRank) reasons.push('MARKET_CONFIDENCE_LOW');
  }
  if (commission === null) reasons.push('COMMISSION_UNKNOWN');
  if (!supplierCurrencySupported) reasons.push('SUPPLIER_CURRENCY_UNSUPPORTED');
  if (rule === null) reasons.push('PROFIT_POLICY_UNCONFIGURED');
  return reasons;
}

function readyEligibility({
  baseReasons,
  recommendedPriceMinor,
  competitiveCeilingMinor,
  profitability,
  purchaseMinor,
  costsMinor,
  commission,
  rule,
  pricingFailureReason,
  enforceCompetitiveCeiling = true,
}) {
  const reasonCodes = [...baseReasons];
  if (pricingFailureReason) reasonCodes.push(pricingFailureReason);
  if (recommendedPriceMinor === null) {
    if (!pricingFailureReason) reasonCodes.push('INVALID_RECOMMENDED_PRICE');
  } else if (!Number.isSafeInteger(recommendedPriceMinor) || recommendedPriceMinor <= 0) {
    reasonCodes.push('INVALID_RECOMMENDED_PRICE');
  } else if (enforceCompetitiveCeiling && (competitiveCeilingMinor === null || recommendedPriceMinor > competitiveCeilingMinor)) {
    reasonCodes.push('PRICE_ABOVE_COMPETITIVE_CEILING');
  }
  if (recommendedPriceMinor !== null && profitability !== null && commission !== null && rule !== null) {
    if (!meetsProfitPolicyAtPrice(recommendedPriceMinor, purchaseMinor, costsMinor, commission, rule)) reasonCodes.push('PROFIT_BELOW_POLICY');
    if (profitability.netProfitMinor < 0) reasonCodes.push('NEGATIVE_NET_PROFIT');
  }
  return { ready: reasonCodes.length === 0, reasonCodes };
}

async function evaluateWithPolicy(input, options, policy) {
  const product = validateProduct(input);
  const marketEvidenceOptional = options.marketEvidenceOptional === true;
  const market = marketEvidenceOptional && options.researcher === undefined
    ? marketWithoutEvidence(product, policy)
    : filterMarketEvidence(product, await collectMarketEvidence(product.original, { researcher: options.researcher }), policy);

  let commission;
  if (options.commissionResolver !== undefined) {
    if (typeof options.commissionResolver !== 'function') throw new PricingContractError('options.commissionResolver must be a function', 'COMMISSION_RESOLVER_INVALID');
    let resolved;
    try {
      resolved = await options.commissionResolver(clone(product.original));
    } catch (error) {
      throw new MarketPricingError('commission resolver failed', 'COMMISSION_RESOLUTION_FAILURE', error);
    }
    commission = validateCommission(resolved);
  } else {
    commission = validateCommission(options.commission);
  }

  const supplierCurrencySupported = product.supplier.purchasePrice.currency === UAH
    && (product.supplier.otherConfiguredCosts === undefined || product.supplier.otherConfiguredCosts.currency === UAH);
  const rule = supplierCurrencySupported
    ? matchingProfitRule(product.supplier.purchasePrice.amountMinor, policy.profitability.rules, policy.profitability.dynamicNetRoiCurve)
    : null;
  const enforceCompetitiveCeiling = options.enforceCompetitiveCeiling !== false;
  const reasons = prerequisiteReasonCodes({ market, policy, commission, supplierCurrencySupported, rule, marketEvidenceOptional });

  const output = {
    productKey: product.productKey,
    supplier: supplierOutput(product),
    market,
    commission: commission === null ? null : {
      rateBps: commission.rateBps,
      ratePct: percentOutput(commission.rateBps),
      source: commission.source,
      ...(commission.categoryId === undefined ? {} : { categoryId: commission.categoryId }),
      provenance: clone(commission.provenance),
    },
    pricing: null,
    profitability: null,
    status: PRICING_STATUSES.PRICE_REVIEW,
    reasonCodes: [],
    diagnostics: {
      matchedProfitRule: rule === null ? null : clone(rule),
      marketSampleOnly: true,
      currencyConversionApplied: false,
    },
  };

  const evidenceIsSufficient = marketEvidenceOptional
    || (market.acceptedComparableCount >= policy.marketEvidence.minimumComparableCount
      && market.exactComparableCount >= policy.marketEvidence.minimumExactComparableCount);
  if (commission !== null && supplierCurrencySupported && rule !== null && evidenceIsSufficient) {
    const costsMinor = product.supplier.otherConfiguredCosts?.amountMinor ?? 0;
    const calculated = pricingOutput(
      market,
      policy.competition,
      commission,
      product.supplier.purchasePrice.amountMinor,
      costsMinor,
      rule,
      {
        enforceCompetitiveCeiling,
        allowMissingMarket: marketEvidenceOptional,
        ignoreMarketTarget: marketEvidenceOptional,
      },
    );
    if (calculated !== null) {
      output.pricing = {
        strategy: calculated.strategy,
        marketTarget: calculated.marketTarget,
        minimumSellingPriceRequired: calculated.minimumSellingPriceRequired,
        competitiveCeiling: calculated.competitiveCeiling,
      };
      if (calculated.recommendedPrice !== null) {
        output.pricing.recommendedPrice = calculated.recommendedPrice;
        output.profitability = {
          purchasePrice: moneyOutput(product.supplier.purchasePrice.amountMinor),
          ...(product.supplier.otherConfiguredCosts === undefined ? {} : { otherConfiguredCosts: moneyOutput(costsMinor) }),
          sellingPrice: calculated.recommendedPrice,
          commissionAmount: moneyOutput(calculated.profitability.commissionAmountMinor),
          netProfit: moneyOutput(calculated.profitability.netProfitMinor),
          roiBps: calculated.profitability.roiBps,
          roiPct: percentOutput(calculated.profitability.roiBps),
          netMarginBps: calculated.profitability.netMarginBps,
          netMarginPct: percentOutput(calculated.profitability.netMarginBps),
        };
      }
      const eligibility = readyEligibility({
        baseReasons: reasons,
        recommendedPriceMinor: calculated.recommendedPrice?.amountMinor ?? null,
        competitiveCeilingMinor: calculated.competitiveCeiling?.amountMinor ?? null,
        profitability: calculated.profitability,
        purchaseMinor: product.supplier.purchasePrice.amountMinor,
        costsMinor,
        commission,
        rule,
        pricingFailureReason: calculated.pricingFailureReason,
        enforceCompetitiveCeiling,
      });
      reasons.length = 0;
      reasons.push(...eligibility.reasonCodes);
      const uncertain = reasons.some((reason) => UNCERTAINTY_REASON_CODES.has(reason));
      if (eligibility.ready) output.status = PRICING_STATUSES.READY;
      else if (!uncertain && reasons.some((reason) => ECONOMIC_FAILURE_REASON_CODES.has(reason))) output.status = PRICING_STATUSES.SKIP;
    } else {
      reasons.push('MARKET_PRICE_UNAVAILABLE');
    }
  }
  if (output.status === PRICING_STATUSES.PRICE_REVIEW && reasons.length === 0) reasons.push('PRICING_REVIEW_REQUIRED');
  const reasoned = decisionReason(output.status, reasons);
  output.status = reasoned.status;
  output.reasonCodes = reasoned.reasonCodes;
  return output;
}

export async function evaluateProductPricing(product, options = {}) {
  if (!isRecord(options)) throw new PricingContractError('options must be an object', 'INVALID_OPTIONS');
  const policy = resolvePricingPolicy(options.policy ?? {});
  if (options.researcher !== undefined || options.marketEvidenceOptional !== true) validateResearcher(options.researcher);
  return evaluateWithPolicy(product, options, policy);
}

export async function evaluatePricingBatch(products, options = {}) {
  if (!Array.isArray(products)) throw new PricingContractError('products must be an array', 'INVALID_PRODUCTS');
  if (!isRecord(options)) throw new PricingContractError('options must be an object', 'INVALID_OPTIONS');
  const policy = resolvePricingPolicy(options.policy ?? {});
  if (options.researcher !== undefined || options.marketEvidenceOptional !== true) validateResearcher(options.researcher);
  const decisions = [];
  for (const product of products) decisions.push(await evaluateWithPolicy(product, options, policy));
  return {
    candidateCount: decisions.length,
    decisions,
    summary: {
      candidateCount: decisions.length,
      readyCount: decisions.filter((decision) => decision.status === PRICING_STATUSES.READY).length,
      reviewCount: decisions.filter((decision) => decision.status === PRICING_STATUSES.PRICE_REVIEW).length,
      skipCount: decisions.filter((decision) => decision.status === PRICING_STATUSES.SKIP).length,
    },
  };
}

function rankingValue(row, factor) {
  const { decision } = row;
  if (factor === 'status') return STATUS_RANK[decision.status];
  if (factor === 'netProfitMinor') return decision.profitability?.netProfit.amountMinor ?? Number.NEGATIVE_INFINITY;
  if (factor === 'roiBps') return decision.profitability?.roiBps ?? Number.NEGATIVE_INFINITY;
  if (factor === 'netMarginBps') return decision.profitability?.netMarginBps ?? Number.NEGATIVE_INFINITY;
  if (factor === 'marketConfidenceRank') return CONFIDENCE_RANK[decision.market.confidence] ?? 0;
  return decision.productKey;
}

export function rankPricingDecisions(decisions, options = {}) {
  if (!Array.isArray(decisions)) throw new PricingContractError('decisions must be an array', 'INVALID_DECISIONS');
  if (!isRecord(options)) throw new PricingContractError('options must be an object', 'INVALID_OPTIONS');
  const policy = resolvePricingPolicy(options.policy ?? {});
  const seen = new Set();
  const rows = decisions.map((decision) => {
    if (!isRecord(decision) || typeof decision.productKey !== 'string' || !Object.values(PRICING_STATUSES).includes(decision.status)) throw new PricingContractError('decision is invalid for ranking', 'INVALID_DECISION');
    if (seen.has(decision.productKey)) throw new PricingContractError(`duplicate productKey: ${decision.productKey}`, 'DUPLICATE_PRODUCT_KEY');
    seen.add(decision.productKey);
    return { decision: clone(decision) };
  });
  rows.sort((left, right) => {
    for (const factor of policy.ranking.order) {
      const leftValue = rankingValue(left, factor);
      const rightValue = rankingValue(right, factor);
      if (leftValue === rightValue) continue;
      if (factor === 'productKey') return leftValue < rightValue ? -1 : 1;
      return leftValue > rightValue ? -1 : 1;
    }
    return 0;
  });
  return {
    candidateCount: rows.length,
    rankingPolicy: clone(policy.ranking),
    ranked: rows.map((row, index) => ({
      rank: index + 1,
      productKey: row.decision.productKey,
      status: row.decision.status,
      scoreComponents: {
        statusRank: STATUS_RANK[row.decision.status],
        netProfitMinor: row.decision.profitability?.netProfit.amountMinor ?? null,
        roiBps: row.decision.profitability?.roiBps ?? null,
        netMarginBps: row.decision.profitability?.netMarginBps ?? null,
        marketConfidenceRank: CONFIDENCE_RANK[row.decision.market.confidence] ?? 0,
      },
      decision: row.decision,
    })),
  };
}

export function selectTopProfitableProducts(decisions, options = {}) {
  if (!isRecord(options)) throw new PricingContractError('options must be an object', 'INVALID_OPTIONS');
  const policy = resolvePricingPolicy(options.policy ?? {});
  const source = Array.isArray(decisions)
    ? decisions
    : isRecord(decisions) && Array.isArray(decisions.ranked)
      ? decisions.ranked.map((row) => row.decision)
      : null;
  if (source === null) throw new PricingContractError('decisions must be an array or a ranking result', 'INVALID_DECISIONS');
  const ranking = rankPricingDecisions(source, { policy });
  const maxProducts = options.maxProducts ?? policy.selection.maxProducts;
  if (!Number.isSafeInteger(maxProducts) || maxProducts < 0 || maxProducts > HARD_MAX_PRODUCTS || maxProducts > policy.selection.maxProducts) {
    throw new PricingContractError(`maxProducts must be between 0 and ${policy.selection.maxProducts}`, 'INVALID_SELECTION_LIMIT');
  }
  const ready = ranking.ranked.filter((row) => row.status === PRICING_STATUSES.READY);
  const selected = ready.slice(0, maxProducts).map((row) => row.decision);
  const notSelectedReady = ready.slice(maxProducts).map((row) => row.decision);
  const review = ranking.ranked.filter((row) => row.status === PRICING_STATUSES.PRICE_REVIEW).map((row) => row.decision);
  const skip = ranking.ranked.filter((row) => row.status === PRICING_STATUSES.SKIP).map((row) => row.decision);
  return {
    candidateCount: ranking.candidateCount,
    readyCount: ready.length,
    reviewCount: review.length,
    skipCount: skip.length,
    selectedCount: selected.length,
    capacityRemaining: maxProducts - selected.length,
    maxProducts,
    selected,
    notSelectedReady,
    review,
    skip,
    ranking,
  };
}

export class PricingContractError extends Error {
  constructor(message, code = 'PRICING_CONTRACT_ERROR', details = undefined) {
    super(message);
    this.name = 'PricingContractError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class MarketPricingError extends Error {
  constructor(message, code = 'MARKET_PRICING_ERROR', cause = undefined) {
    super(message, cause === undefined ? {} : { cause });
    this.name = 'MarketPricingError';
    this.code = code;
  }
}
