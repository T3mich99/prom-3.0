import {
  CONTENT_FIELDS,
  CONTENT_LANGUAGES,
} from './content-contract.mjs';
import {
  CONTENT_STATUSES,
  validateContentArtifact,
} from './content-quality.mjs';

export const COMMERCIAL_CONTENT_PROFILE = 'commercial-prom-v2';

const COMMERCIAL_POLICY_KEYS = new Set(['title', 'description', 'keywords']);
const TITLE_POLICY_KEYS = new Set(['maxRepeatedTokenCount', 'rejectEconomicMetadata']);
const DESCRIPTION_POLICY_KEYS = new Set(['forbidCompletenessSection']);
const KEYWORD_POLICY_KEYS = new Set([
  'minimumPhrases',
  'maximumPhrases',
  'minimumCharacters',
  'maximumCharacters',
  'maximumDuplicateRatio',
  'rejectLanguageMix',
]);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const DEFAULT_COMMERCIAL_CONTENT_POLICY = deepFreeze({
  title: {
    maxRepeatedTokenCount: 2,
    rejectEconomicMetadata: true,
  },
  description: {
    forbidCompletenessSection: true,
  },
  keywords: {
    minimumPhrases: 25,
    maximumPhrases: 35,
    minimumCharacters: 800,
    maximumCharacters: 1000,
    maximumDuplicateRatio: 0,
    rejectLanguageMix: true,
  },
});

const TITLE_STOP_WORDS = new Set([
  'для', 'та', 'и', 'с', 'со', 'з', 'із', 'у', 'в', 'на', 'по', 'до', 'от', 'из',
  'the', 'and', 'with', 'для',
]);
const ECONOMIC_METADATA_PATTERN = /(?:₴|\b(?:uah|грн|ціна|цена|коміс|комис|маржа|прибут|прибыль|купити|купить|дешево|акція|акция|знижка|скидка)\b)/iu;
const NUMBER_WITH_UNIT_PATTERN = /(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*(?:вт|w|°c|мм|см|мл|л|кг|г|в|ма·?г|мач|шт)(?![\p{L}\p{N}])/giu;
const MODEL_PATTERN = /(?<![\p{L}\p{N}])([A-Za-zА-Яа-яІіЇїЄєҐґ]{1,8}[-_/]?\d{2,6}[A-Za-zА-Яа-яІіЇїЄєҐґ]?)(?![\p{L}\p{N}])/gu;
const UA_MARKER_PATTERN = /[іїєґ]/iu;
const RU_MARKER_PATTERN = /[ыэъё]/iu;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function normalizeText(value) {
  return String(value)
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;|&#160;/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeToken(value) {
  return String(value)
    .toLocaleLowerCase('uk-UA')
    .replace(/[«»"'`.,:;!?()[\]{}]/gu, '')
    .trim();
}

function normalizedWords(value) {
  return normalizeText(value).split(/\s+/u).map(normalizeToken).filter(Boolean);
}

function normalizedFactKey(value) {
  return String(value).toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '');
}

function factValue(sourceFacts, aliases) {
  if (!isRecord(sourceFacts)) return undefined;
  const wanted = new Set(aliases.map(normalizedFactKey));
  const entry = Object.entries(sourceFacts).find(([key]) => wanted.has(normalizedFactKey(key)));
  return entry?.[1];
}

function localizedFactValue(value, language) {
  if (!isRecord(value)) return value;
  const preferred = language === 'ru' ? ['ru', 'ua', 'uk'] : ['ua', 'uk', 'ru'];
  for (const key of preferred) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  return value;
}

function scalarStrings(value) {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  if (typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(scalarStrings);
  if (isRecord(value)) return Object.values(value).flatMap(scalarStrings);
  return [];
}

function sourceNumbers(sourceFacts) {
  return new Set(scalarStrings(sourceFacts).flatMap((value) => (
    [...value.matchAll(/\d+(?:[.,]\d+)?/gu)].map((match) => match[0].replace(',', '.'))
  )));
}

function containsFactValue(text, value) {
  if (value === undefined || value === null) return false;
  const valueWords = normalizedWords(value);
  const textWords = normalizedWords(text);
  if (valueWords.length === 0) return false;
  for (let start = 0; start <= textWords.length - valueWords.length; start += 1) {
    if (valueWords.every((word, index) => textWords[start + index] === word)) return true;
  }
  return false;
}

function firstWordMatchesFact(text, value) {
  const textWord = normalizedWords(text)[0];
  const factWords = normalizedWords(value);
  const factWord = factWords.find((word) => !/^\d[\p{L}\d-]*$/u.test(word)) ?? factWords[0];
  return Boolean(textWord && factWord && textWord === factWord);
}

function extractModelTokens(text) {
  return [...String(text).matchAll(MODEL_PATTERN)].map((match) => normalizeToken(match[1]));
}

function forbiddenModelIssues(text, sourceFacts, field, language) {
  const aliases = new Set(['model', 'modelid', 'modelnumber', 'модель', 'номер моделі', 'номер модели'].map(normalizedFactKey));
  const values = Object.entries(sourceFacts)
    .filter(([key]) => aliases.has(normalizedFactKey(key)))
    .flatMap(([, value]) => scalarStrings(value));
  // Match known identifiers even when separators/case change, but not inside
  // longer words or numbers. Source facts remain intact for product identity.
  const visible = normalizeText(text).normalize('NFKC').toLocaleLowerCase('uk-UA');
  const found = values.some((value) => {
    const parts = value.normalize('NFKC').toLocaleLowerCase('uk-UA').match(/[\p{L}\p{N}]+/gu);
    if (!parts?.length) return false;
    const pattern = parts.join('[\\s\\p{Pd}_/]*');
    return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'u').test(visible);
  });
  return found ? [issue(`${field.toUpperCase()}_MODEL_FORBIDDEN`, 'rework', field,
    'Model identifiers must not appear in titles or descriptions, even when verified.', { language })] : [];
}

function extractNumberTokens(text) {
  return [...String(text).matchAll(NUMBER_WITH_UNIT_PATTERN)].map((match) => ({
    full: normalizeToken(match[0]),
    number: match[1].replace(',', '.'),
  }));
}

function issue(code, severity, field, message, details = undefined) {
  const result = { code, severity, field, message };
  if (details !== undefined) result.details = details;
  return result;
}

function fieldStatus(issues) {
  if (issues.some((item) => item.severity === 'rework')) return CONTENT_STATUSES.REWORK;
  if (issues.some((item) => item.severity === 'review')) return CONTENT_STATUSES.REVIEW;
  return CONTENT_STATUSES.READY;
}

function mergePolicyValues(base, override) {
  const merged = structuredClone(base);
  for (const [section, values] of Object.entries(override)) Object.assign(merged[section], values);
  return merged;
}

export function resolveCommercialContentPolicy(override = {}) {
  if (!isRecord(override)) throw new TypeError('commercial policy override must be an object');
  for (const [section, values] of Object.entries(override)) {
    if (!COMMERCIAL_POLICY_KEYS.has(section)) throw new TypeError(`Unsupported commercial policy section: ${section}`);
    if (!isRecord(values)) throw new TypeError(`commercial policy.${section} must be an object`);
    const allowed = section === 'title'
      ? TITLE_POLICY_KEYS
      : section === 'description' ? DESCRIPTION_POLICY_KEYS : KEYWORD_POLICY_KEYS;
    for (const key of Object.keys(values)) {
      if (!allowed.has(key)) throw new TypeError(`Unsupported commercial policy option: ${section}.${key}`);
    }
  }
  const merged = mergePolicyValues(DEFAULT_COMMERCIAL_CONTENT_POLICY, override);
  for (const [key, value] of Object.entries(merged.title)) {
    if (key === 'maxRepeatedTokenCount' && (!Number.isSafeInteger(value) || value < 1)) {
      throw new TypeError('commercial policy.title.maxRepeatedTokenCount must be a positive integer');
    }
    if (key === 'rejectEconomicMetadata' && typeof value !== 'boolean') {
      throw new TypeError('commercial policy.title.rejectEconomicMetadata must be boolean');
    }
  }
  if (typeof merged.description.forbidCompletenessSection !== 'boolean') {
    throw new TypeError('commercial policy.description.forbidCompletenessSection must be boolean');
  }
  const keywordIntegers = ['minimumPhrases', 'maximumPhrases', 'minimumCharacters', 'maximumCharacters'];
  for (const key of keywordIntegers) {
    if (!Number.isSafeInteger(merged.keywords[key]) || merged.keywords[key] < 0) {
      throw new TypeError(`commercial policy.keywords.${key} must be a non-negative integer`);
    }
  }
  if (merged.keywords.minimumPhrases > merged.keywords.maximumPhrases) {
    throw new TypeError('commercial keyword minimumPhrases cannot exceed maximumPhrases');
  }
  if (merged.keywords.minimumCharacters > merged.keywords.maximumCharacters) {
    throw new TypeError('commercial keyword minimumCharacters cannot exceed maximumCharacters');
  }
  if (typeof merged.keywords.maximumDuplicateRatio !== 'number' || !Number.isFinite(merged.keywords.maximumDuplicateRatio)) {
    throw new TypeError('commercial policy.keywords.maximumDuplicateRatio must be a finite number');
  }
  if (merged.keywords.maximumDuplicateRatio < 0 || merged.keywords.maximumDuplicateRatio > 1) {
    throw new TypeError('commercial policy.keywords.maximumDuplicateRatio must be between 0 and 1');
  }
  if (typeof merged.keywords.rejectLanguageMix !== 'boolean') {
    throw new TypeError('commercial policy.keywords.rejectLanguageMix must be boolean');
  }
  return deepFreeze(merged);
}

function titleIssues(title, sourceFacts, policy, language) {
  const issues = [];
  const type = localizedFactValue(factValue(sourceFacts, ['type', 'productType', 'product_type', 'тип', 'типтовару']), language);
  const brand = localizedFactValue(factValue(sourceFacts, ['brand', 'бренд', 'manufacturer', 'виробник']), language);
  const model = localizedFactValue(factValue(sourceFacts, ['model', 'модель']), language);

  if (type !== undefined && !firstWordMatchesFact(title, type)) {
    issues.push(issue('TITLE_COMMERCIAL_STRUCTURE_WEAK', 'rework', 'title', 'title does not begin with the verified product type', { expectedType: type }));
  }
  if (brand !== undefined && !containsFactValue(title, brand)) {
    issues.push(issue('TITLE_COMMERCIAL_STRUCTURE_WEAK', 'rework', 'title', 'verified brand is missing from the title', { brand }));
  }
  issues.push(...forbiddenModelIssues(title, sourceFacts, 'title', language));

  const knownModel = model === undefined ? null : normalizeToken(model);
  const modelTokens = extractModelTokens(title);
  const allowedModelTokens = new Set([knownModel, normalizeToken(brand)].filter(Boolean));
  for (const token of modelTokens) {
    if (!allowedModelTokens.has(token)) {
      issues.push(issue('TITLE_UNSUPPORTED_MODEL', 'rework', 'title', 'model-like title token is not verified by sourceFacts', { token }));
    }
  }

  const numbers = sourceNumbers(sourceFacts);
  for (const token of extractNumberTokens(title)) {
    if (!numbers.has(token.number)) {
      issues.push(issue('TITLE_UNSUPPORTED_NUMERIC_CHARACTERISTIC', 'rework', 'title', 'numeric title characteristic is not verified by sourceFacts', { value: token.full }));
    }
  }

  if (policy.rejectEconomicMetadata && ECONOMIC_METADATA_PATTERN.test(title)) {
    issues.push(issue('TITLE_FORBIDDEN_ECONOMIC_METADATA', 'rework', 'title', 'title contains price, promotion, or other economic metadata'));
  }

  const words = normalizedWords(title).filter((word) => word.length > 2 && !TITLE_STOP_WORDS.has(word));
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const repeated = [...counts.entries()].filter(([, count]) => count > policy.maxRepeatedTokenCount);
  if (repeated.length) {
    issues.push(issue('TITLE_KEYWORD_STUFFING', 'rework', 'title', 'title repeats meaningful tokens beyond the commercial limit', { tokens: repeated.map(([token, count]) => ({ token, count })) }));
  }
  return issues;
}

function sectionMarker(value) {
  return normalizeText(value)
    .replace(/^[#>*\-\s]+/u, '')
    .replace(/[：:]$/u, '')
    .trim()
    .toLocaleLowerCase('uk-UA');
}

function hasCompletenessSection(value) {
  const htmlHeadings = [...String(value).matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/giu)].map((match) => sectionMarker(match[1]));
  const lines = String(value)
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/(?:p|li|div|section)>/giu, '\n')
    .split(/\r?\n/u)
    .map(sectionMarker)
    .filter(Boolean);
  const markers = new Set([...htmlHeadings, ...lines]);
  return [...markers].some((line) => [
    'комплектація',
    'комплектация',
    'комплект поставки',
    'что входит в комплект',
    'що входить у комплект',
  ].includes(line));
}

function descriptionIssues(description, policy) {
  if (!policy.forbidCompletenessSection || typeof description !== 'string') return [];
  return hasCompletenessSection(description)
    ? [issue('DESCRIPTION_COMPLETENESS_SECTION_FORBIDDEN', 'rework', 'description', 'description contains a forbidden completeness section')]
    : [];
}

function keywordIssues(value, language, sourceFacts, policy) {
  const issues = [];
  if (typeof value !== 'string' || !value.trim()) return issues;
  if (value.length < policy.minimumCharacters) {
    issues.push(issue('KEYWORDS_TOO_SHORT', 'rework', 'keywords', 'commercial keywords are shorter than the minimum length', { language, characters: value.length, minimum: policy.minimumCharacters }));
  }
  if (value.length > policy.maximumCharacters) {
    issues.push(issue('KEYWORDS_TOO_LONG', 'rework', 'keywords', 'commercial keywords exceed the maximum length', { language, characters: value.length, maximum: policy.maximumCharacters }));
  }
  const rawTerms = value.split(',');
  const terms = rawTerms.map((term) => term.trim()).filter(Boolean);
  if (rawTerms.some((term) => !term.trim())) {
    issues.push(issue('KEYWORDS_EMPTY_TERM', 'rework', 'keywords', 'commercial keywords contain an empty phrase', { language }));
  }
  if (terms.length < policy.minimumPhrases) {
    issues.push(issue('KEYWORDS_TOO_FEW_PHRASES', 'rework', 'keywords', 'commercial keywords contain fewer phrases than required', { language, phrases: terms.length, minimum: policy.minimumPhrases }));
  }
  if (terms.length > policy.maximumPhrases) {
    issues.push(issue('KEYWORDS_TOO_MANY_PHRASES', 'rework', 'keywords', 'commercial keywords contain more phrases than allowed', { language, phrases: terms.length, maximum: policy.maximumPhrases }));
  }
  const normalized = terms.map((term) => normalizeText(term).toLocaleLowerCase('uk-UA'));
  const duplicateCount = normalized.length - new Set(normalized).size;
  const duplicateRatio = normalized.length ? duplicateCount / normalized.length : 0;
  if (duplicateRatio > policy.maximumDuplicateRatio) {
    issues.push(issue('KEYWORDS_DUPLICATE_PHRASES', 'rework', 'keywords', 'commercial keywords contain duplicate phrases', { language, duplicateRatio, maximum: policy.maximumDuplicateRatio }));
  }
  if (policy.rejectLanguageMix && ((language === 'ua' && RU_MARKER_PATTERN.test(value)) || (language === 'ru' && UA_MARKER_PATTERN.test(value)))) {
    issues.push(issue('KEYWORDS_LANGUAGE_MIX', 'rework', 'keywords', 'keyword field contains markers of the other language', { language }));
  }

  const numbers = sourceNumbers(sourceFacts);
  for (const token of extractNumberTokens(value)) {
    if (!numbers.has(token.number)) {
      issues.push(issue('KEYWORDS_UNSUPPORTED_FACT', 'rework', 'keywords', 'keyword phrase contains an unsupported numeric characteristic', { language, value: token.full }));
    }
  }
  const model = localizedFactValue(factValue(sourceFacts, ['model', 'модель']), language);
  const brand = localizedFactValue(factValue(sourceFacts, ['brand', 'бренд', 'manufacturer', 'виробник']), language);
  const allowedModelTokens = new Set([normalizeToken(model), normalizeToken(brand)].filter(Boolean));
  for (const token of extractModelTokens(value)) {
    if (!allowedModelTokens.has(token)) {
      issues.push(issue('KEYWORDS_UNSUPPORTED_FACT', 'rework', 'keywords', 'keyword phrase contains an unverified model-like token', { language, value: token }));
    }
  }
  if (ECONOMIC_METADATA_PATTERN.test(value)) {
    issues.push(issue('KEYWORDS_UNSUPPORTED_FACT', 'rework', 'keywords', 'keyword phrase contains price, promotion, or supplier metadata', { language }));
  }
  return issues;
}

function reworkPlanFor(fields) {
  return CONTENT_FIELDS
    .filter((field) => fields[field].status === CONTENT_STATUSES.REWORK)
    .map((field) => ({
      field,
      reasonCodes: [...new Set(fields[field].issues.filter((item) => item.severity === 'rework').map((item) => item.code))],
    }));
}

/**
 * Validate the existing Content Artifact v1 under the commercial Prom.ua
 * profile. Base Content Quality remains the structural authority; this layer
 * adds only deterministic commercial checks that can be defended from text or
 * verified sourceFacts.
 */
export function validateCommercialContentArtifact(artifact, options = {}) {
  if (!isRecord(options)) throw new TypeError('commercial validation options must be an object');
  const commercialPolicy = resolveCommercialContentPolicy(options.policy ?? {});
  const baseOptions = options.basePolicy === undefined ? {} : { policy: options.basePolicy };
  const baseQuality = validateContentArtifact(artifact, baseOptions);
  const fields = Object.fromEntries(CONTENT_FIELDS.map((field) => [field, {
    status: baseQuality.fields[field].status,
    issues: clone(baseQuality.fields[field].issues),
  }]));
  const sourceFacts = artifact.sourceFacts ?? {};

  for (const language of CONTENT_LANGUAGES) {
    const title = artifact.content.title?.[language];
    if (typeof title === 'string' && title.trim()) fields.title.issues.push(...titleIssues(title, sourceFacts, commercialPolicy.title, language));
    const description = artifact.content.description?.[language];
    if (typeof description === 'string' && description.trim()) {
      fields.description.issues.push(...descriptionIssues(description, commercialPolicy.description));
      fields.description.issues.push(...forbiddenModelIssues(description, sourceFacts, 'description', language));
    }
    const keywords = artifact.content.keywords?.[language];
    fields.keywords.issues.push(...keywordIssues(keywords, language, sourceFacts, commercialPolicy.keywords));
  }
  for (const field of CONTENT_FIELDS) fields[field].status = fieldStatus(fields[field].issues);

  const reworkPlan = reworkPlanFor(fields);
  const readyFieldCount = CONTENT_FIELDS.filter((field) => fields[field].status === CONTENT_STATUSES.READY).length;
  const reviewFieldCount = CONTENT_FIELDS.filter((field) => fields[field].status === CONTENT_STATUSES.REVIEW).length;
  const reworkFieldCount = reworkPlan.length;
  return {
    productKey: artifact.productKey,
    contentVersion: artifact.version,
    profile: COMMERCIAL_CONTENT_PROFILE,
    status: reworkFieldCount ? CONTENT_STATUSES.REWORK : reviewFieldCount ? CONTENT_STATUSES.REVIEW : CONTENT_STATUSES.READY,
    baseQuality,
    fields,
    reworkPlan: { fields: reworkPlan },
    summary: {
      readyFieldCount,
      reviewFieldCount,
      reworkFieldCount,
      issueCount: CONTENT_FIELDS.reduce((total, field) => total + fields[field].issues.length, 0),
    },
  };
}
