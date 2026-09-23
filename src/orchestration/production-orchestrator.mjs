import { buildPhotoPrompt } from '../photos/photo-prompt.mjs';
import { CREATIVE_FIELDS, validatePhotoCreativeBrief, findCreativeReuse } from '../photos/photo-creative-brief.mjs';
import { resolvePhotoStyle } from '../photos/photo-style-profile.mjs';
import { assertCurrentPhotoStyle } from '../photos/photo-style-profile.mjs';
import fs from 'node:fs/promises';

import {
  evaluateProductPricing,
  PRICING_STATUSES,
} from '../pricing/market-pricing.mjs';
import {
  COMMERCIAL_CONTENT_PROFILE,
  validateCommercialContentArtifact,
} from '../content/commercial-content-quality.mjs';
import {
  generateContentArtifact,
  reworkContentArtifact,
} from '../content/content-generation-adapter.mjs';
import { validateContentGenerationInput } from '../content/content-generation-prompt.mjs';
import { CONTENT_STATUSES } from '../content/content-quality.mjs';
import { buildCharacteristicColumnPlan } from '../excel/characteristic-column-adapter.mjs';
import {
  UGOPT_AVAILABILITY_STATES,
} from '../suppliers/ugopt/daily-catalog-sync.mjs';
import {
  buildPhotoProductionPlan,
} from '../photos/photo-production-plan.mjs';
import {
  PHOTO_STATUSES,
  isEconomicFactKey,
} from '../photos/photo-contract.mjs';
import {
  inspectPngBytes,
  produceRealPhotoFiles,
  reworkRealPhotoFiles,
} from '../photos/real-photo-production.mjs';
import { validatePhotoArtifacts } from '../photos/photo-quality.mjs';

export const PRODUCTION_MODES = Object.freeze({
  PLUS_FIRST: 'PLUS_FIRST',
  AUTOMATED_PROVIDER: 'AUTOMATED_PROVIDER',
  CATEGORY_PRODUCTION: 'CATEGORY_PRODUCTION',
});

export const PRODUCTION_STATUSES = Object.freeze({
  SELECTED: 'SELECTED',
  SOURCE_REVIEW: 'SOURCE_REVIEW',
  BLOCKED_SUPPLIER: 'BLOCKED_SUPPLIER',
  SUPPLIER_REVIEW: 'SUPPLIER_REVIEW',
  WAITING_FOR_MARKET_RESEARCH: 'WAITING_FOR_MARKET_RESEARCH',
  PRICING_REVIEW: 'PRICING_REVIEW',
  PRICED: 'PRICED',
  WAITING_FOR_CONTENT: 'WAITING_FOR_CONTENT',
  CONTENT_REVIEW: 'CONTENT_REVIEW',
  CONTENT_REWORK: 'CONTENT_REWORK',
  CONTENT_READY: 'CONTENT_READY',
  WAITING_FOR_PHOTOS: 'WAITING_FOR_PHOTOS',
  PHOTO_REVIEW: 'PHOTO_REVIEW',
  PHOTO_REWORK: 'PHOTO_REWORK',
  PHOTO_READY: 'PHOTO_READY',
  READY_FOR_EXPORT: 'READY_FOR_EXPORT',
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
});

const JOB_KEYS = new Set([
  'selectedProduct',
  'sourceEvidence',
  'supplierState',
  'pricingProduct',
  'sourceFacts',
  'sourceText',
  'categoryContext',
  'sourceImages',
  'marketEvidence',
  'pricingDecision',
  'contentArtifact',
  'photoArtifact',
  'photoCreativeBrief',
  'approvedMedia',
  'resolvedMetadata',
  'characteristicMapping',
  'operatorArtifacts',
]);
const OPTION_KEYS = new Set(['mode', 'pricing', 'content', 'photos', 'characteristics']);
const PRICING_OPTION_KEYS = new Set(['researcher', 'commission', 'commissionResolver', 'policy', 'enforceCompetitiveCeiling']);
const CONTENT_OPTION_KEYS = new Set(['generator', 'policy', 'commercialPolicy', 'editorialHistory']);
const PHOTO_OPTION_KEYS = new Set(['provider', 'outputRoot', 'policy', 'usedCreativeBriefs']);
const CHARACTERISTIC_OPTION_KEYS = new Set(['mapping', 'policy']);
const OPERATOR_ARTIFACT_KEYS = new Set(['marketEvidence', 'pricingDecision', 'contentArtifact', 'photoArtifact', 'approvedMedia']);
const SOURCE_REVIEW_TASK_VERSION = 'source-review-v1';
const MARKET_TASK_VERSION = 'market-research-v1';
const CONTENT_TASK_VERSION = 'content-generation-v1';
const CONTENT_REWORK_TASK_VERSION = 'content-rework-v1';
const PHOTO_TASK_VERSION = 'photo-generation-v1';
const PHOTO_REWORK_TASK_VERSION = 'photo-rework-v1';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function clone(value) {
  return structuredClone(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort((left, right) => left.localeCompare(right, 'en')).map((key) => [key, stableValue(value[key])]));
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`Unsupported ${label} field: ${key}`);
}

function optionalClone(value) {
  return value === undefined ? undefined : clone(value);
}

function resultWith(result, values) {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) result[key] = clone(value);
  }
  return result;
}

function productKeyOf(selectedProduct) {
  assertRecord(selectedProduct, 'job.selectedProduct');
  return requiredString(selectedProduct.selectionKey, 'job.selectedProduct.selectionKey');
}

function taskBase(taskType, productKey, taskVersion) {
  return { taskType, productKey, taskVersion };
}

function manualReviewAction(productKey, stage, status, reasonCodes = []) {
  return {
    type: 'MANUAL_REVIEW',
    productKey,
    stage,
    status,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

function operatorAction(task) {
  return { type: 'OPERATOR_TASK', task };
}

function safeErrorCode(error, fallback) {
  return typeof error?.code === 'string' && error.code.trim() ? error.code : fallback;
}

function errorResult(ctx, stage, error, diagnostics = []) {
  return baseResult(ctx, PRODUCTION_STATUSES.FAILED, {
    diagnostics: [
      ...diagnostics,
      {
        code: safeErrorCode(error, 'PRODUCTION_OPERATION_FAILED'),
        stage,
        message: `${stage} step failed; inspect the reported validation or provider result.`,
      },
    ],
    error: {
      stage,
      code: safeErrorCode(error, 'PRODUCTION_OPERATION_FAILED'),
      message: `${stage} step failed; inspect the reported validation or provider result.`,
    },
  });
}

function baseResult(ctx, workflowStatus, {
  nextAction = null,
  diagnostics = [],
  pricingDecision,
  contentArtifact,
  contentQuality,
  characteristicPlan,
  photoArtifact,
  approvedMedia,
  supplierState,
  error,
} = {}) {
  const result = {
    productKey: ctx.productKey,
    workflowStatus,
    mode: ctx.mode,
    selectedProduct: clone(ctx.selectedProduct),
    nextAction: nextAction === null ? null : clone(nextAction),
    diagnostics: clone(diagnostics),
  };
  return resultWith(result, {
    supplierState,
    pricingDecision,
    contentArtifact,
    contentQuality,
    characteristicPlan,
    photoArtifact,
    approvedMedia,
    error,
  });
}

function normalizedOptions(options = {}) {
  assertRecord(options, 'options');
  assertKnownKeys(options, OPTION_KEYS, 'options');
  const mode = options.mode ?? PRODUCTION_MODES.PLUS_FIRST;
  if (!Object.values(PRODUCTION_MODES).includes(mode)) throw new TypeError('options.mode is invalid');

  const sections = {
    pricing: options.pricing ?? {},
    content: options.content ?? {},
    photos: options.photos ?? {},
    characteristics: options.characteristics ?? {},
  };
  for (const [name, value] of Object.entries(sections)) assertRecord(value, `options.${name}`);
  assertKnownKeys(sections.pricing, PRICING_OPTION_KEYS, 'options.pricing');
  if (sections.pricing.enforceCompetitiveCeiling !== undefined && typeof sections.pricing.enforceCompetitiveCeiling !== 'boolean') {
    throw new TypeError('options.pricing.enforceCompetitiveCeiling must be boolean');
  }
  assertKnownKeys(sections.content, CONTENT_OPTION_KEYS, 'options.content');
  assertKnownKeys(sections.photos, PHOTO_OPTION_KEYS, 'options.photos');
  assertKnownKeys(sections.characteristics, CHARACTERISTIC_OPTION_KEYS, 'options.characteristics');
  return { mode, ...sections };
}

function validateJob(job) {
  assertRecord(job, 'job');
  assertKnownKeys(job, JOB_KEYS, 'job');
  productKeyOf(job.selectedProduct);
  if (job.supplierState !== undefined) assertRecord(job.supplierState, 'job.supplierState');
  if (job.pricingProduct !== undefined) assertRecord(job.pricingProduct, 'job.pricingProduct');
  if (job.sourceEvidence !== undefined) assertRecord(job.sourceEvidence, 'job.sourceEvidence');
  if (job.sourceFacts !== undefined) assertRecord(job.sourceFacts, 'job.sourceFacts');
  if (job.sourceText !== undefined) assertRecord(job.sourceText, 'job.sourceText');
  if (job.categoryContext !== undefined) assertRecord(job.categoryContext, 'job.categoryContext');
  if (job.sourceImages !== undefined && !Array.isArray(job.sourceImages)) throw new TypeError('job.sourceImages must be an array');
  for (const key of ['marketEvidence', 'pricingDecision', 'contentArtifact', 'photoArtifact', 'approvedMedia', 'resolvedMetadata']) {
    if (job[key] !== undefined) assertRecord(job[key], `job.${key}`);
  }
  if (job.characteristicMapping !== undefined) assertRecord(job.characteristicMapping, 'job.characteristicMapping');
  if (job.operatorArtifacts !== undefined) {
    assertRecord(job.operatorArtifacts, 'job.operatorArtifacts');
    assertKnownKeys(job.operatorArtifacts, OPERATOR_ARTIFACT_KEYS, 'job.operatorArtifacts');
  }
  return true;
}

function sourceReviewTask(ctx, job) {
  return {
    ...taskBase('SOURCE_REVIEW', ctx.productKey, SOURCE_REVIEW_TASK_VERSION),
    input: {
      productKey: ctx.productKey,
      sourceUrl: job.sourceEvidence.sourceUrl,
      evidence: clone(job.sourceEvidence),
    },
    instructions: {
      inspectOfficialProductPageAndImages: true,
      resolveEveryDiagnostic: true,
      selectOneExactVariant: true,
      returnOnlyVerifiedFacts: true,
      returnStatusReadyOnlyWhenUnambiguous: true,
    },
    expectedResultSchema: {
      type: 'source-evidence-v1',
      required: ['productKey', 'version', 'status', 'sourceUrl', 'sourceFacts', 'sourceText', 'sourceImages', 'diagnostics', 'provenance'],
      status: 'READY',
    },
    validationAuthority: 'ugopt-product-detail-v1',
  };
}

function sourceGate(ctx, job) {
  if (job.sourceEvidence === undefined) return null;
  const evidence = job.sourceEvidence;
  if (evidence.productKey !== ctx.productKey) {
    throw new ProductionOrchestrationError('Source evidence productKey does not match selected product', 'SOURCE_EVIDENCE_PRODUCT_MISMATCH', { productKey: ctx.productKey, stage: 'source' });
  }
  if (!['READY', 'REVIEW'].includes(evidence.status)) {
    throw new ProductionOrchestrationError('Source evidence status must be READY or REVIEW', 'SOURCE_EVIDENCE_STATUS_INVALID', { productKey: ctx.productKey, stage: 'source' });
  }
  if (!isRecord(evidence.sourceFacts) || !isRecord(evidence.sourceText) || !Array.isArray(evidence.sourceImages)) {
    throw new ProductionOrchestrationError('Source evidence is incomplete', 'SOURCE_EVIDENCE_INVALID', { productKey: ctx.productKey, stage: 'source' });
  }
  if (evidence.status === 'REVIEW' || evidence.sourceImages.length === 0) {
    const task = sourceReviewTask(ctx, job);
    return baseResult(ctx, PRODUCTION_STATUSES.SOURCE_REVIEW, {
      sourceEvidence: clone(evidence),
      nextAction: operatorAction(task),
      diagnostics: (Array.isArray(evidence.diagnostics) ? evidence.diagnostics : []).map((item) => ({
        code: typeof item?.code === 'string' ? item.code : 'SOURCE_REVIEW_REQUIRED',
        stage: 'source',
        message: typeof item?.message === 'string' ? item.message : 'Official source evidence requires review.',
      })),
    });
  }
  return null;
}

function artifactFromJob(job, field) {
  const direct = job[field];
  const nested = job.operatorArtifacts?.[field];
  if (direct !== undefined && nested !== undefined && stableJson(direct) !== stableJson(nested)) {
    throw new ProductionOrchestrationError(`${field} was supplied twice with different values`, 'DUPLICATE_ARTIFACT_INPUT', { productKey: productKeyOf(job.selectedProduct), stage: field });
  }
  return direct === undefined ? optionalClone(nested) : clone(direct);
}

function assertArtifactIdentity(value, productKey, label) {
  if (value === undefined) return;
  assertRecord(value, label);
  if (value.productKey !== productKey) {
    throw new ProductionOrchestrationError(`${label}.productKey does not match selectedProduct.selectionKey`, 'PRODUCT_IDENTITY_MISMATCH', { productKey, artifact: label });
  }
}

function supplierStateFor(job, productKey) {
  if (job.supplierState === undefined) return undefined;
  const state = job.supplierState;
  if (state.productKey !== undefined && state.productKey !== productKey) {
    throw new ProductionOrchestrationError('supplierState.productKey does not match selectedProduct.selectionKey', 'PRODUCT_IDENTITY_MISMATCH', { productKey, artifact: 'supplierState' });
  }
  const value = state.availabilityStatus ?? state.lastKnownSupplierState;
  if (!Object.values(UGOPT_AVAILABILITY_STATES).includes(value)) {
    throw new TypeError('supplierState.availabilityStatus must be a UG-OPT availability state');
  }
  return { ...clone(state), availabilityStatus: value };
}

function rejectSensitiveKey(key) {
  return /(secret|token|password|credential|api|private)/iu.test(key);
}

function safeFactEntries(sourceFacts, { excludeEconomic = false } = {}) {
  if (!isRecord(sourceFacts)) return {};
  return Object.fromEntries(Object.entries(sourceFacts).filter(([key]) => !rejectSensitiveKey(key)
    && (!excludeEconomic || !isEconomicFactKey(key))));
}

function productSource(selectedProduct) {
  return isRecord(selectedProduct.product) ? selectedProduct.product : {};
}

function pricingProductFor(job, productKey) {
  if (job.pricingProduct !== undefined) {
    if (job.pricingProduct.productKey !== productKey) {
      throw new ProductionOrchestrationError('pricingProduct.productKey does not match selectedProduct.selectionKey', 'PRODUCT_IDENTITY_MISMATCH', { productKey, artifact: 'pricingProduct' });
    }
    return clone(job.pricingProduct);
  }
  const selected = productSource(job.selectedProduct);
  if (isRecord(selected.pricingProduct)) {
    if (selected.pricingProduct.productKey !== productKey) {
      throw new ProductionOrchestrationError('selectedProduct.product.pricingProduct.productKey does not match selectedProduct.selectionKey', 'PRODUCT_IDENTITY_MISMATCH', { productKey, artifact: 'pricingProduct' });
    }
    return clone(selected.pricingProduct);
  }
  if (selected.price === undefined) return null;
  const identity = {};
  const facts = job.sourceFacts ?? {};
  for (const key of ['brand', 'model']) {
    if (typeof facts[key] === 'string') identity[key] = facts[key];
    else if (typeof selected[key] === 'string') identity[key] = selected[key];
  }
  const supplier = {
    name: 'ug-opt',
    purchasePrice: isRecord(selected.price)
      ? clone(selected.price)
      : { amount: selected.price, currency: 'UAH' },
    provenance: { source: 'selected-product', productKey },
    ...(typeof selected.supplierSku === 'string' ? { supplierSku: selected.supplierSku } : {}),
    ...(typeof selected.sourceUrl === 'string' ? { sourceUrl: selected.sourceUrl } : {}),
  };
  return { productKey, supplier, identity };
}

function marketTask(ctx, job, pricingProduct) {
  const selected = productSource(ctx.selectedProduct);
  const sourceFacts = safeFactEntries(job.sourceFacts, { excludeEconomic: true });
  const identity = {
    productKey: ctx.productKey,
    ...(typeof selected.title === 'string' ? { sourceTitle: selected.title } : {}),
    ...(typeof selected.name === 'string' ? { sourceName: selected.name } : {}),
    ...(typeof sourceFacts.brand === 'string' ? { verifiedBrand: sourceFacts.brand } : {}),
    ...(typeof sourceFacts.model === 'string' ? { verifiedModel: sourceFacts.model } : {}),
    ...(typeof pricingProduct?.supplier?.sourceUrl === 'string' ? { supplierUrl: pricingProduct.supplier.sourceUrl } : {}),
    verifiedSourceFacts: sourceFacts,
  };
  return {
    ...taskBase('MARKET_RESEARCH', ctx.productKey, MARKET_TASK_VERSION),
    input: identity,
    instructions: {
      purpose: 'Collect exact comparable market listings for this same product identity.',
      matchOnlyVerifiedIdentity: true,
      returnEvidenceOnly: true,
      doNotReturnPricingDecision: true,
    },
    expectedResultSchema: {
      type: 'market-evidence-v1',
      required: ['productKey', 'comparables'],
      comparableFields: ['source', 'listingId or url', 'seller', 'title', 'price', 'currency', 'available', 'matchType'],
    },
    validationAuthority: 'PR22 market-pricing.mjs',
  };
}

function contentInput(ctx, job) {
  if (!isRecord(job.sourceFacts)) return null;
  const input = {
    productKey: ctx.productKey,
    sourceFacts: clone(job.sourceFacts),
    ...(job.sourceText === undefined ? {} : { sourceText: clone(job.sourceText) }),
    ...(job.categoryContext === undefined ? {} : { categoryContext: clone(job.categoryContext) }),
  };
  validateContentGenerationInput(input);
  return input;
}

function contentTask(ctx, job) {
  const input = contentInput(ctx, job);
  return {
    ...taskBase('CONTENT_GENERATION', ctx.productKey, CONTENT_TASK_VERSION),
    input: {
      productKey: ctx.productKey,
      verifiedSourceFacts: clone(input.sourceFacts),
      ...(input.sourceText === undefined ? {} : { sourceText: clone(input.sourceText) }),
      ...(input.categoryContext === undefined ? {} : { categoryContext: clone(input.categoryContext) }),
      pricingStatus: PRICING_STATUSES.READY,
    },
    instructions: {
      produceCommercialContent: true,
      separateRussianAndUkrainian: true,
      noCompletenessSection: true,
      doNotIncludeEconomicMetadata: true,
    },
    expectedResultSchema: {
      type: 'content-artifact-v1',
      requiredFields: ['title', 'description', 'keywords', 'characteristics'],
      profile: COMMERCIAL_CONTENT_PROFILE,
    },
    validationAuthority: ['Content Contract v1', 'Commercial Content Quality v2'],
  };
}

function contentReworkTask(ctx, job, quality) {
  const input = contentInput(ctx, job);
  const fields = quality.reworkPlan.fields.map((entry) => ({ field: entry.field, reasonCodes: [...entry.reasonCodes] }));
  return {
    ...taskBase('CONTENT_REWORK', ctx.productKey, CONTENT_REWORK_TASK_VERSION),
    input: {
      productKey: ctx.productKey,
      verifiedSourceFacts: clone(input.sourceFacts),
      fields,
      pricingStatus: PRICING_STATUSES.READY,
    },
    instructions: {
      rewriteOnlyRequestedFields: true,
      preserveAcceptedFields: true,
      noCompletenessSection: true,
      doNotIncludeEconomicMetadata: true,
    },
    expectedResultSchema: {
      type: 'content-field-rework-v1',
      fields: fields.map((entry) => entry.field),
      profile: COMMERCIAL_CONTENT_PROFILE,
    },
    validationAuthority: ['Content Contract v1', 'Commercial Content Quality v2'],
  };
}

function plannedPhotoTask(ctx, plan, type, indexes, taskVersion) {
  const targets = plan.photos.filter((photo) => indexes.includes(photo.index));
  return {
    ...taskBase(type, ctx.productKey, taskVersion),
    input: {
      productKey: ctx.productKey,
      photos: targets.map((photo) => ({
        photoIndex: photo.index,
        role: photo.role,
        objective: photo.objective,
        prompt: buildPhotoPrompt(photo),
        verifiedClaims: clone(photo.verifiedClaims),
        sourceImageRefs: clone(photo.sourceImageRefs),
        text: clone(photo.text),
        visualDirection: clone(photo.visualDirection),
      })),
    },
    instructions: {
      separateFilesOnly: true,
      noCollage: true,
      preserveExactProduct: true,
      UkrainianTextOnly: true,
      noEconomicMetadata: true,
    },
    expectedResultSchema: {
      type: type === 'PHOTO_REWORK' ? 'real-photo-rework-v1' : 'real-photo-production-v1',
      format: 'png',
      width: 1280,
      height: 1280,
      separateOutputCount: targets.length,
      finalGalleryCount: 5,
      filenames: ['01-hero.png', '02-usage.png', '03-benefits.png', '04-feature.png', '05-final.png'],
    },
    validationAuthority: ['PR20 Photo QA', 'PR24 Real Photo Production byte validator'],
  };
}

function requiredExternal(ctx, task, waitingStatus, failureCode) {
  if (ctx.mode === PRODUCTION_MODES.PLUS_FIRST || ctx.mode === PRODUCTION_MODES.CATEGORY_PRODUCTION) {
    return baseResult(ctx, waitingStatus, { nextAction: operatorAction(task) });
  }
  return baseResult(ctx, PRODUCTION_STATUSES.FAILED, {
    error: { stage: task.taskType, code: failureCode, message: `${task.taskType} requires an injected provider in AUTOMATED_PROVIDER mode.` },
    diagnostics: [{ code: failureCode, stage: task.taskType, message: `${task.taskType} provider is not configured.` }],
  });
}

function pricingFailure(ctx, error) {
  return errorResult(ctx, 'pricing', error, [{ code: safeErrorCode(error, 'PRICING_VALIDATION_FAILED'), stage: 'pricing', message: 'Pricing was rejected by the PR22 authority.' }]);
}

function contentFailure(ctx, error) {
  return errorResult(ctx, 'content', error, [{ code: safeErrorCode(error, 'CONTENT_VALIDATION_FAILED'), stage: 'content', message: 'Content was rejected by the Content Contract or commercial validator.' }]);
}

function photoFailure(ctx, error) {
  return errorResult(ctx, 'photos', error, [{ code: safeErrorCode(error, 'PHOTO_VALIDATION_FAILED'), stage: 'photos', message: 'Photo artifact was rejected by the PR20/PR24 validators.' }]);
}

async function runPricing(ctx, job, options) {
  const suppliedDecision = artifactFromJob(job, 'pricingDecision');
  assertArtifactIdentity(suppliedDecision, ctx.productKey, 'pricingDecision');
  const pricingProduct = pricingProductFor(job, ctx.productKey);
  if (pricingProduct === null) {
    return baseResult(ctx, PRODUCTION_STATUSES.FAILED, {
      error: { stage: 'pricing', code: 'PRICING_PRODUCT_REQUIRED', message: 'A PR22-compatible pricing product is required before production can continue.' },
      diagnostics: [{ code: 'PRICING_PRODUCT_REQUIRED', stage: 'pricing', message: 'Provide an explicit purchase price and UG-OPT provenance.' }],
    });
  }

  const marketEvidence = artifactFromJob(job, 'marketEvidence');
  if (marketEvidence !== undefined && marketEvidence.productKey !== ctx.productKey) {
    throw new ProductionOrchestrationError('marketEvidence.productKey does not match selectedProduct.selectionKey', 'PRODUCT_IDENTITY_MISMATCH', { productKey: ctx.productKey, artifact: 'marketEvidence' });
  }
  const marketEvidenceOptional = ctx.mode === PRODUCTION_MODES.CATEGORY_PRODUCTION;
  const researcher = marketEvidence === undefined ? options.pricing.researcher : async () => clone(marketEvidence);
  if (!marketEvidenceOptional && typeof researcher !== 'function') return requiredExternal(ctx, marketTask(ctx, job, pricingProduct), PRODUCTION_STATUSES.WAITING_FOR_MARKET_RESEARCH, 'MARKET_RESEARCHER_REQUIRED');

  let decision;
  try {
    decision = await evaluateProductPricing(pricingProduct, {
      policy: options.pricing.policy,
      commission: options.pricing.commission,
      commissionResolver: options.pricing.commissionResolver,
      enforceCompetitiveCeiling: options.pricing.enforceCompetitiveCeiling,
      ...(typeof researcher === 'function' ? { researcher } : {}),
      marketEvidenceOptional,
    });
  } catch (error) {
    return pricingFailure(ctx, error);
  }
  if (suppliedDecision !== undefined && stableJson(suppliedDecision) !== stableJson(decision)) {
    throw new ProductionOrchestrationError('Supplied pricingDecision does not match the PR22 decision recomputed from validated evidence', 'PRICING_DECISION_MISMATCH', { productKey: ctx.productKey, stage: 'pricing' });
  }
  if (decision.status === PRICING_STATUSES.PRICE_REVIEW) {
    return baseResult(ctx, PRODUCTION_STATUSES.PRICING_REVIEW, {
      pricingDecision: decision,
      nextAction: manualReviewAction(ctx.productKey, 'pricing', PRODUCTION_STATUSES.PRICING_REVIEW, decision.reasonCodes),
    });
  }
  if (decision.status === PRICING_STATUSES.SKIP) {
    return baseResult(ctx, PRODUCTION_STATUSES.SKIPPED, {
      pricingDecision: decision,
      diagnostics: decision.reasonCodes.map((code) => ({ code, stage: 'pricing', message: 'Pricing authority marked the product SKIP.' })),
    });
  }
  return { decision };
}

function contentQuality(artifact, options) {
  return validateCommercialContentArtifact(artifact, {
    ...(options.content.policy === undefined ? {} : { basePolicy: options.content.policy }),
    ...(options.content.commercialPolicy === undefined ? {} : { policy: options.content.commercialPolicy }),
    ...(options.content.editorialHistory === undefined ? {} : { editorialHistory: options.content.editorialHistory }),
  });
}

function assertContentFacts(artifact, job, productKey) {
  assertArtifactIdentity(artifact, productKey, 'contentArtifact');
  if (!isRecord(job.sourceFacts)) throw new ProductionOrchestrationError('sourceFacts are required for production content', 'SOURCE_FACTS_REQUIRED', { productKey, stage: 'content' });
  if (!isRecord(artifact.sourceFacts) || stableJson(artifact.sourceFacts) !== stableJson(job.sourceFacts)) {
    throw new ProductionOrchestrationError('contentArtifact.sourceFacts must exactly match job.sourceFacts', 'SOURCE_FACTS_MISMATCH', { productKey, stage: 'content' });
  }
}

async function runContent(ctx, job, options, pricingDecision) {
  const suppliedArtifact = artifactFromJob(job, 'contentArtifact');
  const contentOptions = {
    ...(options.content.policy === undefined ? {} : { policy: options.content.policy }),
    ...(options.content.commercialPolicy === undefined ? {} : { commercialPolicy: options.content.commercialPolicy }),
    ...(options.content.editorialHistory === undefined ? {} : { editorialHistory: options.content.editorialHistory }),
    profile: COMMERCIAL_CONTENT_PROFILE,
  };
  if (suppliedArtifact !== undefined) {
    assertContentFacts(suppliedArtifact, job, ctx.productKey);
    let quality;
    try {
      quality = contentQuality(suppliedArtifact, options);
    } catch (error) {
      const task = contentTask(ctx, job);
      if (ctx.mode === PRODUCTION_MODES.PLUS_FIRST || ctx.mode === PRODUCTION_MODES.CATEGORY_PRODUCTION) {
        return baseResult(ctx, PRODUCTION_STATUSES.CONTENT_REWORK, {
          pricingDecision,
          contentArtifact: suppliedArtifact,
          nextAction: operatorAction({ ...task, taskType: 'CONTENT_REWORK', taskVersion: CONTENT_REWORK_TASK_VERSION, input: { ...task.input, fields: ['title', 'description', 'keywords', 'characteristics'] } }),
          diagnostics: [{ code: safeErrorCode(error, 'CONTENT_ARTIFACT_INVALID'), stage: 'content', message: 'Supplied content requires field-level correction.' }],
        });
      }
      return contentFailure(ctx, error);
    }
    if (quality.status === CONTENT_STATUSES.READY) return { artifact: suppliedArtifact, quality, pricingDecision };
    if (quality.status === CONTENT_STATUSES.REVIEW) {
      return baseResult(ctx, PRODUCTION_STATUSES.CONTENT_REVIEW, {
        pricingDecision,
        contentArtifact: suppliedArtifact,
        contentQuality: quality,
        nextAction: manualReviewAction(ctx.productKey, 'content', PRODUCTION_STATUSES.CONTENT_REVIEW, quality.fields ? Object.values(quality.fields).flatMap((field) => field.issues.map((item) => item.code)) : []),
      });
    }
    if (typeof options.content.generator !== 'function') {
      return requiredExternal(ctx, contentReworkTask(ctx, job, quality), PRODUCTION_STATUSES.CONTENT_REWORK, 'CONTENT_GENERATOR_REQUIRED');
    }
    try {
      const reworked = await reworkContentArtifact({ artifact: suppliedArtifact, quality, sourceFacts: job.sourceFacts }, { ...contentOptions, generator: options.content.generator });
      if (reworked.quality.status === CONTENT_STATUSES.READY) return { artifact: reworked.artifact, quality: reworked.quality, pricingDecision };
      if (reworked.quality.status === CONTENT_STATUSES.REVIEW) {
        return baseResult(ctx, PRODUCTION_STATUSES.CONTENT_REVIEW, {
          pricingDecision,
          contentArtifact: reworked.artifact,
          contentQuality: reworked.quality,
          nextAction: manualReviewAction(ctx.productKey, 'content', PRODUCTION_STATUSES.CONTENT_REVIEW),
        });
      }
      return baseResult(ctx, PRODUCTION_STATUSES.CONTENT_REWORK, {
        pricingDecision,
        contentArtifact: reworked.artifact,
        contentQuality: reworked.quality,
        nextAction: operatorAction(contentReworkTask(ctx, job, reworked.quality)),
      });
    } catch (error) {
      return contentFailure(ctx, error);
    }
  }

  if (!isRecord(job.sourceFacts)) {
    return contentFailure(ctx, new ProductionOrchestrationError('sourceFacts are required before content generation', 'SOURCE_FACTS_REQUIRED', { productKey: ctx.productKey, stage: 'content' }));
  }
  if (typeof options.content.generator !== 'function') {
    return requiredExternal(ctx, contentTask(ctx, job), PRODUCTION_STATUSES.WAITING_FOR_CONTENT, 'CONTENT_GENERATOR_REQUIRED');
  }
  let input;
  try {
    input = contentInput(ctx, job);
  } catch (error) {
    return contentFailure(ctx, error);
  }
  try {
    const generated = await generateContentArtifact(input, { ...contentOptions, generator: options.content.generator });
    if (generated.quality.status === CONTENT_STATUSES.READY) return { artifact: generated.artifact, quality: generated.quality, pricingDecision };
    if (generated.quality.status === CONTENT_STATUSES.REVIEW) {
      return baseResult(ctx, PRODUCTION_STATUSES.CONTENT_REVIEW, {
        pricingDecision,
        contentArtifact: generated.artifact,
        contentQuality: generated.quality,
        nextAction: manualReviewAction(ctx.productKey, 'content', PRODUCTION_STATUSES.CONTENT_REVIEW),
      });
    }
    return baseResult(ctx, PRODUCTION_STATUSES.CONTENT_REWORK, {
      pricingDecision,
      contentArtifact: generated.artifact,
      contentQuality: generated.quality,
      nextAction: operatorAction(contentReworkTask(ctx, job, generated.quality)),
    });
  } catch (error) {
    return contentFailure(ctx, error);
  }
}

function validatePhotoResultIdentity(photoArtifact, productKey) {
  assertArtifactIdentity(photoArtifact, productKey, 'photoArtifact');
  if (photoArtifact.plan !== undefined) assertArtifactIdentity(photoArtifact.plan, productKey, 'photoArtifact.plan');
  if (photoArtifact.approvedMediaArtifact !== undefined) assertArtifactIdentity(photoArtifact.approvedMediaArtifact, productKey, 'photoArtifact.approvedMediaArtifact');
}

async function importPhotoArtifact(photoArtifact, plan, sourceFacts, options, suppliedApprovedMedia) {
  validatePhotoResultIdentity(photoArtifact, plan.productKey);
  if (!isRecord(photoArtifact.plan) || stableJson(photoArtifact.plan) !== stableJson(plan)) {
    throw new ProductionOrchestrationError('photoArtifact.plan does not match the current content and source-image plan', 'PHOTO_PLAN_MISMATCH', { productKey: plan.productKey, stage: 'photos' });
  }
  if (!Array.isArray(photoArtifact.artifacts) || photoArtifact.artifacts.length !== 5) {
    throw new ProductionOrchestrationError('photoArtifact.artifacts must contain the five planned photos', 'PHOTO_ARTIFACT_INVALID', { productKey: plan.productKey, stage: 'photos' });
  }
  const artifacts = [];
  for (const photo of plan.photos) {
    const artifact = photoArtifact.artifacts.find((item) => item?.photoIndex === photo.index);
    if (!isRecord(artifact) || !isRecord(artifact.asset) || typeof artifact.asset.path !== 'string') {
      throw new ProductionOrchestrationError(`photo ${photo.index} does not contain a local file path`, 'PHOTO_FILE_MISSING', { productKey: plan.productKey, stage: 'photos', photoIndex: photo.index });
    }
    const bytes = await fs.readFile(artifact.asset.path);
    const inspected = inspectPngBytes(bytes);
    artifacts.push({
      ...clone(artifact),
      asset: { ...clone(artifact.asset), path: artifact.asset.path, width: inspected.width, height: inspected.height, format: 'png' },
      hash: inspected.hash,
    });
  }
  for (const photo of plan.photos) assertCurrentPhotoStyle(photo.visualDirection.styleProfile);
  const quality = validatePhotoArtifacts({ plan, artifacts, sourceFacts, ...(photoArtifact.visualQa === undefined ? {} : { visualQa: photoArtifact.visualQa }) }, {
    ...(options.photos.policy === undefined ? {} : { policy: options.photos.policy }),
    requireVisualQa: true,
  });
  if (photoArtifact.quality !== undefined && photoArtifact.visualQa !== undefined && stableJson(photoArtifact.quality) !== stableJson(quality)) {
    throw new ProductionOrchestrationError('photoArtifact.quality does not match current bytes and QA', 'PHOTO_QUALITY_RESULT_MISMATCH', { productKey: plan.productKey, stage: 'photos' });
  }
  if (suppliedApprovedMedia !== undefined && quality.status === PHOTO_STATUSES.READY && stableJson(suppliedApprovedMedia) !== stableJson(quality.approvedMediaArtifact)) {
    throw new ProductionOrchestrationError('approvedMedia does not match current Photo QA output', 'APPROVED_MEDIA_MISMATCH', { productKey: plan.productKey, stage: 'photos' });
  }
  if (quality.status === PHOTO_STATUSES.READY && photoArtifact.approvedMediaArtifact !== undefined
    && stableJson(photoArtifact.approvedMediaArtifact) !== stableJson(quality.approvedMediaArtifact)) {
    throw new ProductionOrchestrationError('photoArtifact.approvedMediaArtifact does not match current Photo QA output', 'APPROVED_MEDIA_MISMATCH', { productKey: plan.productKey, stage: 'photos' });
  }
  return { ...clone(photoArtifact), artifacts, quality, approvedMedia: clone(quality.approvedMediaArtifact) };
}

function enforceVisualQa(photoArtifact, plan, sourceFacts, options) {
  const quality = validatePhotoArtifacts({
    plan,
    artifacts: photoArtifact.artifacts,
    sourceFacts,
    ...(photoArtifact.visualQa === undefined ? {} : { visualQa: photoArtifact.visualQa }),
  }, {
    ...(options.photos.policy === undefined ? {} : { policy: options.photos.policy }),
    requireVisualQa: true,
  });
  return {
    ...clone(photoArtifact),
    quality,
    ...(quality.approvedMediaArtifact === undefined ? {} : { approvedMediaArtifact: clone(quality.approvedMediaArtifact) }),
  };
}

function visualQaAfterSelectiveRework(visualQa, plan, targetIndexes) {
  if (!isRecord(visualQa)) return undefined;
  const failedChecks = {
    productIdentityPreserved: false,
    noModelTransformation: false,
    brandPreserved: false,
    noVisibleModelText: false,
    noFabricatedClaims: false,
    noFabricatedSpecifications: false,
    noUnsupportedAccessories: false,
    compositionMatchesRole: false,
    premiumCommercialQuality: false,
    noDarkHalos: false,
    noCheapMarketplaceAesthetic: false,
    noObviousAiVisualDefects: false,
    slotDistinct: false,
    sceneDistinct: false,
    layoutDistinct: false,
    productSpecificDesign: false,
    productPositionDistinct: false,
    textDoesNotCoverProduct: false,
    textReadable: false,
  };
  return {
    ...clone(visualQa),
    version: plan.version,
    status: PHOTO_STATUSES.REWORK,
    photos: visualQa.photos.map((photo) => ({
      ...clone(photo),
      status: targetIndexes.has(photo.photoIndex) ? PHOTO_STATUSES.REWORK : PHOTO_STATUSES.READY,
      checks: targetIndexes.has(photo.photoIndex) ? failedChecks : clone(photo.checks),
      reasonCodes: targetIndexes.has(photo.photoIndex) ? ['VISUAL_QA_REQUIRED'] : [],
    })),
  };
}

function photoTaskFor(plan, quality, type = 'PHOTO_GENERATION') {
  const indexes = type === 'PHOTO_REWORK'
    ? (quality?.reworkPlan?.photos ?? []).map((entry) => entry.photoIndex)
    : plan.photos.map((photo) => photo.index);
  return plannedPhotoTask(
    { productKey: plan.productKey, selectedProduct: { selectionKey: plan.productKey }, mode: PRODUCTION_MODES.PLUS_FIRST },
    plan,
    type,
    indexes.length ? indexes : plan.photos.map((photo) => photo.index),
    type === 'PHOTO_REWORK' ? PHOTO_REWORK_TASK_VERSION : PHOTO_TASK_VERSION,
  );
}

async function runPhotos(ctx, job, options, contentArtifact, pricingDecision) {
  if (!Array.isArray(job.sourceImages)) {
    return photoFailure(ctx, new ProductionOrchestrationError('sourceImages are required before photo planning', 'SOURCE_IMAGES_REQUIRED', { productKey: ctx.productKey, stage: 'photos' }));
  }
  let plan;
  try {
    if (ctx.mode === PRODUCTION_MODES.CATEGORY_PRODUCTION || job.photoCreativeBrief !== undefined) {
      let problem = 'Create five individual concepts before generating any images.';
      let valid = false;
      try {
        validatePhotoCreativeBrief(job.photoCreativeBrief, ctx.productKey);
        const reused = findCreativeReuse(job.photoCreativeBrief, options.photos.usedCreativeBriefs ?? []);
        if (reused.length) problem = `Revise reused concepts: ${JSON.stringify(reused)}`;
        else valid = true;
      } catch (error) { problem = error.message; }
      if (!valid) return baseResult(ctx, PRODUCTION_STATUSES.WAITING_FOR_PHOTOS, {
        pricingDecision, contentArtifact,
        nextAction: operatorAction({
          ...taskBase('PHOTO_ART_DIRECTION', ctx.productKey, 'photo-creative-brief-v1'),
          input: { sourceFacts: clone(job.sourceFacts), sourceImages: clone(job.sourceImages),
            styleProfile: resolvePhotoStyle({ productKey: ctx.productKey, categoryKey: ctx.selectedProduct.requestedCategory ?? '' }),
            recentCreativeBriefs: clone((options.photos.usedCreativeBriefs ?? []).slice(-12)),
            fullCreativeHistoryPath: 'runtime/photo-creative-history.json' },
          instructions: { issue: problem, executor: 'CODEX', scope: 'Each product AND each of its five images must be unique in scene, composition, layout and message. Changing only copy or background is insufficient. Preserve the exact supplier product. Final image is object-only. Use built-in image generation; no paid API fallback without explicit authorization.' },
          expectedResultSchema: { type: 'photo-creative-brief-v1', destination: 'productInputs[productKey].photoCreativeBrief',
            required: ['productKey', 'version', 'rationale', 'photos'], version: 1,
            roles: ['hero', 'usage', 'benefits', 'feature', 'final'],
            photoFields: ['role', ...CREATIVE_FIELDS, 'photoCopy'],
            photoCopy: 'headline and optional subtitle in Ukrainian; supportingFacts [{field,value}] must match sourceFacts exactly. Final: {supportingFacts:[]}.' },
        }),
      });
    }
    plan = buildPhotoProductionPlan({
      selectedProduct: ctx.selectedProduct,
      contentArtifact,
      sourceImages: job.sourceImages,
      sourceFacts: job.sourceFacts,
      ...(job.photoCreativeBrief === undefined ? {} : { photoCreativeBrief: job.photoCreativeBrief }),
    }, options.photos.policy === undefined ? {} : { policy: options.photos.policy });
  } catch (error) {
    return photoFailure(ctx, error);
  }
  if (plan.status !== PHOTO_STATUSES.READY) {
    return baseResult(ctx, PRODUCTION_STATUSES.PHOTO_REVIEW, {
      pricingDecision,
      contentArtifact,
      photoArtifact: { productKey: ctx.productKey, plan },
      nextAction: manualReviewAction(ctx.productKey, 'photos', PRODUCTION_STATUSES.PHOTO_REVIEW, plan.diagnostics.map((item) => item.code)),
      diagnostics: plan.diagnostics.map((item) => ({ code: item.code, stage: 'photos', message: item.message })),
    });
  }

  const suppliedPhotoArtifact = artifactFromJob(job, 'photoArtifact');
  const suppliedApprovedMedia = artifactFromJob(job, 'approvedMedia');
  if (suppliedPhotoArtifact !== undefined) {
    let imported;
    try {
      imported = await importPhotoArtifact(suppliedPhotoArtifact, plan, job.sourceFacts, options, suppliedApprovedMedia);
    } catch (error) {
      if (error instanceof ProductionOrchestrationError
        && ['PRODUCT_IDENTITY_MISMATCH', 'PHOTO_PLAN_MISMATCH'].includes(error.code)) {
        throw error;
      }
      return baseResult(ctx, PRODUCTION_STATUSES.PHOTO_REVIEW, {
        pricingDecision,
        contentArtifact,
        photoArtifact: suppliedPhotoArtifact,
        nextAction: manualReviewAction(ctx.productKey, 'photos', PRODUCTION_STATUSES.PHOTO_REVIEW, [safeErrorCode(error, 'PHOTO_ARTIFACT_INVALID')]),
        diagnostics: [{ code: safeErrorCode(error, 'PHOTO_ARTIFACT_INVALID'), stage: 'photos', message: 'Supplied photo files must pass the PR24 byte and PR20 QA boundary.' }],
      });
    }
    if (imported.quality.status === PHOTO_STATUSES.READY) {
      return finishReady(ctx, job, options, pricingDecision, contentArtifact, imported, plan);
    }
    if (imported.quality.status === PHOTO_STATUSES.REVIEW) {
      return baseResult(ctx, PRODUCTION_STATUSES.PHOTO_REVIEW, {
        pricingDecision,
        contentArtifact,
        photoArtifact: imported,
        nextAction: manualReviewAction(ctx.productKey, 'photos', PRODUCTION_STATUSES.PHOTO_REVIEW),
      });
    }
    if (typeof options.photos.provider !== 'object' || options.photos.provider === null) {
      const task = photoTaskFor(plan, imported.quality, 'PHOTO_REWORK');
      const waiting = requiredExternal(ctx, task, PRODUCTION_STATUSES.PHOTO_REWORK, 'PHOTO_PROVIDER_REQUIRED');
      return resultWith(waiting, { pricingDecision, contentArtifact, photoArtifact: imported });
    }
    if (typeof options.photos.outputRoot !== 'string' || !options.photos.outputRoot.trim()) {
      return photoFailure(ctx, new ProductionOrchestrationError('photos.outputRoot is required for selective real-photo rework', 'PHOTO_OUTPUT_ROOT_REQUIRED', { productKey: ctx.productKey, stage: 'photos' }));
    }
    try {
      const reworked = await reworkRealPhotoFiles({
        plan: imported.plan,
        artifacts: imported.artifacts,
        quality: imported.quality,
        sourceFacts: job.sourceFacts,
        ...(imported.visualQa === undefined ? {} : {
          visualQa: imported.visualQa,
        }),
      }, { provider: options.photos.provider, outputRoot: options.photos.outputRoot, ...(options.photos.policy === undefined ? {} : { policy: options.photos.policy }) });
      const targetIndexes = new Set(imported.quality.reworkPlan.photos.map((entry) => entry.photoIndex));
      const gatedRework = enforceVisualQa({
        ...reworked,
        ...(imported.visualQa === undefined ? {} : { visualQa: visualQaAfterSelectiveRework(imported.visualQa, reworked.plan, targetIndexes) }),
      }, reworked.plan, job.sourceFacts, options);
      if (gatedRework.quality.status === PHOTO_STATUSES.READY) return finishReady(ctx, job, options, pricingDecision, contentArtifact, gatedRework, plan);
      return baseResult(ctx, PRODUCTION_STATUSES.PHOTO_REWORK, {
        pricingDecision,
        contentArtifact,
        photoArtifact: gatedRework,
        nextAction: operatorAction(photoTaskFor(plan, gatedRework.quality, 'PHOTO_REWORK')),
      });
    } catch (error) {
      return photoFailure(ctx, error);
    }
  }
  if (suppliedApprovedMedia !== undefined) {
    return photoFailure(ctx, new ProductionOrchestrationError('approvedMedia cannot be accepted without the validated photoArtifact and files', 'PHOTO_ARTIFACT_REQUIRED', { productKey: ctx.productKey, stage: 'photos' }));
  }

  if (options.photos.provider === undefined) {
    const task = photoTaskFor(plan, null, 'PHOTO_GENERATION');
    const waiting = requiredExternal(ctx, task, PRODUCTION_STATUSES.WAITING_FOR_PHOTOS, 'PHOTO_PROVIDER_REQUIRED');
    return resultWith(waiting, { pricingDecision, contentArtifact, photoArtifact: { productKey: ctx.productKey, plan } });
  }
  if (!isRecord(options.photos.provider) || typeof options.photos.provider.generateImage !== 'function') {
    return photoFailure(ctx, new TypeError('options.photos.provider must expose generateImage'));
  }
  if (typeof options.photos.outputRoot !== 'string' || !options.photos.outputRoot.trim()) {
    return photoFailure(ctx, new ProductionOrchestrationError('photos.outputRoot is required for real-photo production', 'PHOTO_OUTPUT_ROOT_REQUIRED', { productKey: ctx.productKey, stage: 'photos' }));
  }
  try {
    const produced = await produceRealPhotoFiles({ plan, sourceFacts: job.sourceFacts }, { provider: options.photos.provider, outputRoot: options.photos.outputRoot, ...(options.photos.policy === undefined ? {} : { policy: options.photos.policy }) });
    const gatedProduced = enforceVisualQa(produced, plan, job.sourceFacts, options);
    if (gatedProduced.quality.status === PHOTO_STATUSES.READY) return finishReady(ctx, job, options, pricingDecision, contentArtifact, gatedProduced, plan);
    if (gatedProduced.quality.status === PHOTO_STATUSES.REVIEW) {
      return baseResult(ctx, PRODUCTION_STATUSES.PHOTO_REVIEW, { pricingDecision, contentArtifact, photoArtifact: gatedProduced, nextAction: manualReviewAction(ctx.productKey, 'photos', PRODUCTION_STATUSES.PHOTO_REVIEW) });
    }
    return baseResult(ctx, PRODUCTION_STATUSES.PHOTO_REWORK, {
      pricingDecision,
      contentArtifact,
      photoArtifact: gatedProduced,
      nextAction: operatorAction(photoTaskFor(plan, gatedProduced.quality, 'PHOTO_REWORK')),
    });
  } catch (error) {
    return photoFailure(ctx, error);
  }
}

function finishReady(ctx, job, options, pricingDecision, contentArtifact, photoArtifact, plan) {
  const mapping = options.characteristics.mapping ?? job.characteristicMapping;
  let characteristicPlan;
  if (mapping !== undefined) {
    try {
      characteristicPlan = buildCharacteristicColumnPlan({ contentArtifact, mapping }, options.characteristics.policy === undefined ? {} : { policy: options.characteristics.policy });
    } catch (error) {
      return errorResult(ctx, 'characteristics', error, [{ code: 'CHARACTERISTIC_PLAN_FAILED', stage: 'characteristics', message: 'The supplied characteristic mapping could not be validated.' }]);
    }
    if (characteristicPlan.status !== 'SAFE') {
      return baseResult(ctx, PRODUCTION_STATUSES.FAILED, {
        pricingDecision,
        contentArtifact,
        contentQuality: photoArtifact.quality?.baseQuality,
        photoArtifact,
        approvedMedia: photoArtifact.approvedMediaArtifact ?? photoArtifact.approvedMedia,
        characteristicPlan,
        error: { stage: 'characteristics', code: 'CHARACTERISTIC_PLAN_NOT_SAFE', message: 'Characteristic mapping is not SAFE for the future export bridge.' },
        diagnostics: [{ code: 'CHARACTERISTIC_PLAN_NOT_SAFE', stage: 'characteristics', message: 'Provide a SAFE template mapping before writing characteristic columns.' }],
      });
    }
  }
  if (photoArtifact.quality?.visualQa?.status !== PHOTO_STATUSES.READY) {
    return baseResult(ctx, PRODUCTION_STATUSES.PHOTO_REVIEW, {
      pricingDecision,
      contentArtifact,
      photoArtifact,
      nextAction: manualReviewAction(ctx.productKey, 'photos', PRODUCTION_STATUSES.PHOTO_REVIEW, ['VISUAL_QA_REQUIRED']),
      diagnostics: [{ code: 'VISUAL_QA_REQUIRED', stage: 'photos', message: 'Operator visual QA must approve all five photos before export.' }],
    });
  }
  const approvedMedia = photoArtifact.approvedMediaArtifact ?? photoArtifact.approvedMedia;
  if (!isRecord(approvedMedia) || approvedMedia.productKey !== ctx.productKey || !Array.isArray(approvedMedia.photos) || approvedMedia.photos.length !== 5) {
    return photoFailure(ctx, new ProductionOrchestrationError('Approved Media is required and must contain five validated photos', 'APPROVED_MEDIA_REQUIRED', { productKey: ctx.productKey, stage: 'photos' }));
  }
  const diagnostics = [];
  if (job.resolvedMetadata === undefined) diagnostics.push({ code: 'CATEGORY_DEFERRED_TO_EXPORT', stage: 'publication', message: 'No Prom category metadata was supplied; no category was inferred.' });
  const result = baseResult(ctx, PRODUCTION_STATUSES.READY_FOR_EXPORT, {
    pricingDecision,
    contentArtifact,
    contentQuality: photoArtifact.quality?.baseQuality,
    characteristicPlan,
    photoArtifact,
    approvedMedia: {
      ...clone(approvedMedia),
      publication: { status: 'LOCAL_ONLY', publicUrlsAvailable: false },
    },
    diagnostics,
  });
  result.productionArtifact = {
    productKey: ctx.productKey,
    workflowStatus: PRODUCTION_STATUSES.READY_FOR_EXPORT,
    selectedProduct: clone(ctx.selectedProduct),
    pricingDecision: clone(pricingDecision),
    contentArtifact: clone(contentArtifact),
    ...(characteristicPlan === undefined ? {} : { characteristicPlan: clone(characteristicPlan) }),
    approvedMedia: { ...clone(approvedMedia), publication: { status: 'LOCAL_ONLY', publicUrlsAvailable: false } },
    ...(job.resolvedMetadata === undefined ? {} : { resolvedMetadata: clone(job.resolvedMetadata) }),
    provenance: {
      supplier: 'ug-opt',
      pricing: 'PR22 market-pricing.mjs',
      content: COMMERCIAL_CONTENT_PROFILE,
      photos: 'PR24 real-photo-production.mjs',
      publication: 'local-media-only; Prom/Excel bridge deferred',
    },
    diagnostics,
  };
  return result;
}

async function advanceValidatedJob(job, options) {
  const productKey = productKeyOf(job.selectedProduct);
  const ctx = { productKey, selectedProduct: clone(job.selectedProduct), mode: options.mode };
  const sourceReview = sourceGate(ctx, job);
  if (sourceReview !== null) return sourceReview;
  const supplierState = supplierStateFor(job, productKey);
  if (supplierState?.availabilityStatus === UGOPT_AVAILABILITY_STATES.UNAVAILABLE
    || supplierState?.availabilityStatus === UGOPT_AVAILABILITY_STATES.REMOVED) {
    return baseResult(ctx, PRODUCTION_STATUSES.BLOCKED_SUPPLIER, {
      supplierState,
      diagnostics: [{ code: 'SUPPLIER_NOT_SELLABLE', stage: 'supplier', message: 'Supplier state blocks costly production work.' }],
    });
  }
  if (supplierState?.availabilityStatus === UGOPT_AVAILABILITY_STATES.AT_RISK) {
    return baseResult(ctx, PRODUCTION_STATUSES.SUPPLIER_REVIEW, {
      supplierState,
      nextAction: manualReviewAction(productKey, 'supplier', PRODUCTION_STATUSES.SUPPLIER_REVIEW, ['SUPPLIER_STATE_UNCERTAIN']),
    });
  }

  const pricing = await runPricing(ctx, job, options);
  if (pricing.workflowStatus !== undefined) return resultWith(pricing, { supplierState });
  const content = await runContent(ctx, job, options, pricing.decision);
  if (content.workflowStatus !== undefined) return resultWith(content, { supplierState, pricingDecision: pricing.decision });
  const photos = await runPhotos(ctx, job, options, content.artifact, pricing.decision);
  if (photos.workflowStatus !== undefined) return resultWith(photos, { supplierState, pricingDecision: pricing.decision, contentArtifact: content.artifact, contentQuality: content.quality });
  return photos;
}

/** Advance one explicit product job through the Plus-first production gates. */
export async function advanceProductionProduct(job, options = {}) {
  validateJob(job);
  const resolvedOptions = normalizedOptions(options);
  return advanceValidatedJob(clone(job), resolvedOptions);
}

function productKeyHint(job) {
  return isRecord(job?.selectedProduct) && typeof job.selectedProduct.selectionKey === 'string' && job.selectedProduct.selectionKey.trim()
    ? job.selectedProduct.selectionKey
    : 'unknown';
}

function failedBatchResult(job, options, error) {
  const productKey = productKeyHint(job);
  const selectedProduct = isRecord(job?.selectedProduct) ? clone(job.selectedProduct) : { selectionKey: productKey };
  const ctx = { productKey, selectedProduct, mode: options.mode };
  return errorResult(ctx, 'orchestration', error, [{ code: safeErrorCode(error, 'PRODUCTION_CONTRACT_ERROR'), stage: 'orchestration', message: 'This product job could not be advanced; other batch jobs remain isolated.' }]);
}

function batchSummary(results) {
  const keys = [
    'readyForExport', 'sourceReview', 'waitingMarketResearch', 'pricingReview', 'waitingContent', 'contentReview', 'contentRework',
    'waitingPhotos', 'photoReview', 'photoRework', 'blockedSupplier', 'supplierReview', 'skipped', 'failed', 'priced',
  ];
  const summary = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const result of results) {
    const key = {
      [PRODUCTION_STATUSES.READY_FOR_EXPORT]: 'readyForExport',
      [PRODUCTION_STATUSES.SOURCE_REVIEW]: 'sourceReview',
      [PRODUCTION_STATUSES.WAITING_FOR_MARKET_RESEARCH]: 'waitingMarketResearch',
      [PRODUCTION_STATUSES.PRICING_REVIEW]: 'pricingReview',
      [PRODUCTION_STATUSES.PRICED]: 'priced',
      [PRODUCTION_STATUSES.WAITING_FOR_CONTENT]: 'waitingContent',
      [PRODUCTION_STATUSES.CONTENT_REVIEW]: 'contentReview',
      [PRODUCTION_STATUSES.CONTENT_REWORK]: 'contentRework',
      [PRODUCTION_STATUSES.WAITING_FOR_PHOTOS]: 'waitingPhotos',
      [PRODUCTION_STATUSES.PHOTO_REVIEW]: 'photoReview',
      [PRODUCTION_STATUSES.PHOTO_REWORK]: 'photoRework',
      [PRODUCTION_STATUSES.BLOCKED_SUPPLIER]: 'blockedSupplier',
      [PRODUCTION_STATUSES.SUPPLIER_REVIEW]: 'supplierReview',
      [PRODUCTION_STATUSES.SKIPPED]: 'skipped',
      [PRODUCTION_STATUSES.FAILED]: 'failed',
    }[result.workflowStatus];
    if (key) summary[key] += 1;
  }
  return { total: results.length, ...summary };
}

/** Batch orchestration is a thin ordered call to the canonical single-product API. */
export async function advanceProductionBatch(jobs, options = {}) {
  if (!Array.isArray(jobs)) throw new TypeError('jobs must be an array');
  const resolvedOptions = normalizedOptions(options);
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await advanceProductionProduct(job, resolvedOptions));
    } catch (error) {
      results.push(failedBatchResult(job, resolvedOptions, error));
    }
  }
  return { results, summary: batchSummary(results) };
}

/** Collect only immediate, current operator tasks in stable product order. */
export function collectOperatorTasks(batchResult) {
  assertRecord(batchResult, 'batchResult');
  if (!Array.isArray(batchResult.results)) throw new TypeError('batchResult.results must be an array');
  const tasks = [];
  const seen = new Set();
  for (const result of batchResult.results) {
    const task = result?.nextAction?.type === 'OPERATOR_TASK' ? result.nextAction.task : null;
    if (!task) continue;
    const key = stableJson(task);
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push(clone(task));
  }
  return tasks;
}

export function formatProductionSummary(batchResult) {
  assertRecord(batchResult, 'batchResult');
  const summary = batchResult.summary;
  assertRecord(summary, 'batchResult.summary');
  return [
    `Усього товарів: ${summary.total ?? 0}`,
    `Готові до експорту: ${summary.readyForExport ?? 0}`,
    `Очікують дослідження ринку: ${summary.waitingMarketResearch ?? 0}`,
    `Перевірка ціни: ${summary.pricingReview ?? 0}`,
    `Очікують контент: ${summary.waitingContent ?? 0}`,
    `Перевірка контенту: ${summary.contentReview ?? 0}`,
    `Очікують фото: ${summary.waitingPhotos ?? 0}`,
    `Перевірка фото: ${(summary.photoReview ?? 0) + (summary.photoRework ?? 0)}`,
    `Заблоковані постачальником: ${summary.blockedSupplier ?? 0}`,
    `Пропущені: ${summary.skipped ?? 0}`,
    `Помилки: ${summary.failed ?? 0}`,
  ].join('\n');
}

export class ProductionOrchestrationError extends Error {
  constructor(message, code = 'PRODUCTION_ORCHESTRATION_ERROR', details = undefined, cause = undefined) {
    super(message, cause === undefined ? {} : { cause });
    this.name = 'ProductionOrchestrationError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
