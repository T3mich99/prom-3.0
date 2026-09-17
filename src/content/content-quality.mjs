import {
  CONTENT_FIELDS,
  CONTENT_LANGUAGES,
  validateContentArtifactStructure,
} from './content-contract.mjs';

export const CONTENT_STATUSES = Object.freeze({
  READY: 'READY',
  REVIEW: 'REVIEW',
  REWORK: 'REWORK',
});

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const DEFAULT_CONTENT_QUALITY_POLICY = deepFreeze({
  title: {
    checkControlCharacters: true,
    checkWhitespace: true,
  },
  description: {
    minimumVisibleCharacters: 1000,
    preferredMinimumCharacters: 1300,
    preferredMaximumCharacters: 2000,
    detectRepeatedSentences: true,
  },
  keywords: {
    minimumCharacters: 800,
    maximumCharacters: 1024,
    minimumPhrases: 25,
    maximumDuplicateRatio: 0.5,
  },
  characteristics: {
    allowExactDuplicates: false,
  },
  claims: {
    unverifiedSeverity: 'review',
  },
});

const POLICY_KEYS = new Set(Object.keys(DEFAULT_CONTENT_QUALITY_POLICY));

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPolicyOverride(override) {
  if (!isRecord(override)) throw new TypeError('policy override must be an object');
  for (const [section, values] of Object.entries(override)) {
    if (!POLICY_KEYS.has(section)) throw new TypeError(`Unsupported policy section: ${section}`);
    if (!isRecord(values)) throw new TypeError(`policy.${section} must be an object`);
    for (const key of Object.keys(values)) {
      if (!(key in DEFAULT_CONTENT_QUALITY_POLICY[section])) {
        throw new TypeError(`Unsupported policy option: ${section}.${key}`);
      }
    }
  }
  const merged = mergePolicyValues(DEFAULT_CONTENT_QUALITY_POLICY, override);
  const integers = [
    ['description', 'minimumVisibleCharacters'],
    ['description', 'preferredMinimumCharacters'],
    ['description', 'preferredMaximumCharacters'],
    ['keywords', 'minimumCharacters'],
    ['keywords', 'maximumCharacters'],
    ['keywords', 'minimumPhrases'],
  ];
  for (const [section, key] of integers) {
    if (!Number.isSafeInteger(merged[section][key]) || merged[section][key] < 0) {
      throw new TypeError(`policy.${section}.${key} must be a non-negative integer`);
    }
  }
  if (typeof merged.keywords.maximumDuplicateRatio !== 'number' || !Number.isFinite(merged.keywords.maximumDuplicateRatio)) {
    throw new TypeError('policy.keywords.maximumDuplicateRatio must be a finite number');
  }
  if (merged.keywords.maximumDuplicateRatio < 0 || merged.keywords.maximumDuplicateRatio > 1) {
    throw new TypeError('policy.keywords.maximumDuplicateRatio must be between 0 and 1');
  }
  if (merged.keywords.minimumCharacters > merged.keywords.maximumCharacters) {
    throw new TypeError('keywords minimumCharacters cannot exceed maximumCharacters');
  }
  if (!['review', 'rework'].includes(merged.claims.unverifiedSeverity)) {
    throw new TypeError('policy.claims.unverifiedSeverity must be review or rework');
  }
  for (const key of ['checkControlCharacters', 'checkWhitespace']) {
    if (typeof merged.title[key] !== 'boolean') throw new TypeError(`policy.title.${key} must be boolean`);
  }
  if (typeof merged.description.detectRepeatedSentences !== 'boolean') {
    throw new TypeError('policy.description.detectRepeatedSentences must be boolean');
  }
  if (typeof merged.characteristics.allowExactDuplicates !== 'boolean') {
    throw new TypeError('policy.characteristics.allowExactDuplicates must be boolean');
  }
  if (merged.description.preferredMinimumCharacters > merged.description.preferredMaximumCharacters) {
    throw new TypeError('description preferred minimum cannot exceed preferred maximum');
  }
  return deepFreeze(merged);
}

function mergePolicyValues(base, override) {
  const merged = structuredClone(base);
  for (const [section, values] of Object.entries(override)) Object.assign(merged[section], values);
  return merged;
}

export function resolveContentQualityPolicy(override = {}) {
  return assertPolicyOverride(override);
}

function visibleText(value) {
  return String(value)
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;|&#160;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/\s+/gu, ' ')
    .trim();
}

function issue(code, severity, field, message, details = undefined) {
  const result = { code, severity, field, message };
  if (details !== undefined) result.details = details;
  return result;
}

function addIssue(target, value) {
  target.push(value);
}

function hasExcessWhitespace(value) {
  return value !== value.trim() || /\s{2,}/u.test(value);
}

function evaluateLocalizedText(field, value, policy) {
  const issues = [];
  if (!value) {
    for (const language of CONTENT_LANGUAGES) {
      addIssue(issues, issue(`${field.toUpperCase()}_MISSING`, 'rework', field, `${field} is missing`, { language }));
    }
    return issues;
  }
  for (const language of CONTENT_LANGUAGES) {
    const text = value[language];
    if (typeof text !== 'string' || !text.trim()) {
      addIssue(issues, issue(`${field.toUpperCase()}_MISSING`, 'rework', field, `${field} is missing`, { language }));
      continue;
    }
    if ((field === 'title' ? policy.title.checkControlCharacters : true) && CONTROL_CHARS.test(text)) {
      addIssue(issues, issue(`${field.toUpperCase()}_CONTROL_CHARACTERS`, 'rework', field, `${field} contains control characters`, { language }));
    }
    if (field === 'title' && policy.title.checkWhitespace && hasExcessWhitespace(text)) {
      addIssue(issues, issue('TITLE_EXCESSIVE_WHITESPACE', 'rework', field, 'title contains leading, trailing, or repeated whitespace', { language }));
    }
    if (field === 'description') {
      const textLength = visibleText(text).length;
      if (textLength < policy.description.minimumVisibleCharacters) {
        addIssue(issues, issue('DESCRIPTION_TOO_SHORT', 'rework', field, 'description is shorter than the minimum visible length', { language, visibleCharacters: textLength, minimum: policy.description.minimumVisibleCharacters }));
      }
      if (policy.description.detectRepeatedSentences) {
        const sentences = visibleText(text).split(/[.!?]+/u).map((part) => part.trim()).filter(Boolean);
        const seen = new Set();
        const repeated = new Set();
        for (const sentence of sentences) {
          if (seen.has(sentence)) repeated.add(sentence);
          seen.add(sentence);
        }
        if (repeated.size) {
          addIssue(issues, issue('DESCRIPTION_REPEATED_BLOCK', 'rework', field, 'description repeats an identical sentence or block', { language, repeatedCount: repeated.size }));
        }
      }
    }
  }
  return issues;
}

function evaluateKeywords(value, policy) {
  const issues = [];
  if (!value) {
    for (const language of CONTENT_LANGUAGES) {
      addIssue(issues, issue('KEYWORDS_MISSING', 'rework', 'keywords', 'keywords are missing', { language }));
    }
    return issues;
  }
  for (const language of CONTENT_LANGUAGES) {
    const text = value[language];
    if (typeof text !== 'string' || !text.trim()) {
      addIssue(issues, issue('KEYWORDS_MISSING', 'rework', 'keywords', 'keywords are missing', { language }));
      continue;
    }
    if (CONTROL_CHARS.test(text)) {
      addIssue(issues, issue('KEYWORDS_CONTROL_CHARACTERS', 'rework', 'keywords', 'keywords contain control characters', { language }));
    }
    if (text.length < policy.keywords.minimumCharacters) {
      addIssue(issues, issue('KEYWORDS_TOO_SHORT', 'rework', 'keywords', 'keywords are shorter than the minimum field length', { language, characters: text.length, minimum: policy.keywords.minimumCharacters }));
    }
    if (text.length > policy.keywords.maximumCharacters) {
      addIssue(issues, issue('KEYWORDS_TOO_LONG', 'rework', 'keywords', 'keywords exceed the maximum field length', { language, characters: text.length, maximum: policy.keywords.maximumCharacters }));
    }
    const rawTerms = text.split(',');
    const terms = rawTerms.map((term) => term.trim()).filter(Boolean);
    if (rawTerms.some((term) => !term.trim())) {
      addIssue(issues, issue('KEYWORDS_EMPTY_TERM', 'rework', 'keywords', 'keywords contain an empty term', { language }));
    }
    if (terms.length < policy.keywords.minimumPhrases) {
      addIssue(issues, issue('KEYWORDS_TOO_FEW_PHRASES', 'rework', 'keywords', 'keywords contain fewer phrases than required', { language, phrases: terms.length, minimum: policy.keywords.minimumPhrases }));
    }
    const normalized = terms.map((term) => term.replace(/\s+/gu, ' ').toLocaleLowerCase('uk-UA'));
    const duplicateCount = normalized.length - new Set(normalized).size;
    const duplicateRatio = normalized.length ? duplicateCount / normalized.length : 0;
    if (duplicateRatio > policy.keywords.maximumDuplicateRatio) {
      addIssue(issues, issue('KEYWORDS_DUPLICATE_SPAM', 'rework', 'keywords', 'keywords contain too many exact duplicate phrases', { language, duplicateRatio, maximum: policy.keywords.maximumDuplicateRatio }));
    }
  }
  return issues;
}

function evaluateCharacteristics(value, policy) {
  if (value === undefined || value.length === 0) {
    return [issue('CHARACTERISTICS_REVIEW_REQUIRED', 'review', 'characteristics', 'characteristics are absent and need review')];
  }
  const issues = [];
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const itemValue = typeof item.value === 'string' ? item.value.trim() : '';
    if (!name) addIssue(issues, issue('CHARACTERISTIC_NAME_MISSING', 'rework', 'characteristics', 'characteristic name is missing', { index }));
    if (!itemValue) addIssue(issues, issue('CHARACTERISTIC_VALUE_MISSING', 'rework', 'characteristics', 'characteristic value is missing', { index }));
    const key = `${name}\u0000${itemValue}`;
    if (name && itemValue && seen.has(key) && !policy.characteristics.allowExactDuplicates) {
      addIssue(issues, issue('DUPLICATE_CHARACTERISTIC', 'rework', 'characteristics', 'an exact characteristic name/value pair is duplicated', { index, name, value: itemValue }));
    }
    seen.add(key);
  }
  return issues;
}

function evaluateClaims(artifact, policy) {
  const issues = [];
  for (const claim of artifact.claims ?? []) {
    const field = claim.contentField ?? 'description';
    const hasFact = isRecord(artifact.sourceFacts) && Object.prototype.hasOwnProperty.call(artifact.sourceFacts, claim.field);
    const actual = hasFact ? artifact.sourceFacts[claim.field] : undefined;
    const matches = hasFact && String(actual).trim() === claim.value.trim();
    if (!matches) {
      issues.push({
        claim,
        issue: issue('UNVERIFIED_CLAIM', policy.claims.unverifiedSeverity, field, 'structured claim does not exactly match sourceFacts', {
          fact: claim.field,
          expected: hasFact ? actual : undefined,
          actual: claim.value,
        }),
      });
    }
  }
  return issues;
}

function fieldStatus(issues) {
  if (issues.some((item) => item.severity === 'rework')) return CONTENT_STATUSES.REWORK;
  if (issues.some((item) => item.severity === 'review')) return CONTENT_STATUSES.REVIEW;
  return CONTENT_STATUSES.READY;
}

export function validateContentArtifact(artifact, options = {}) {
  validateContentArtifactStructure(artifact);
  const policy = resolveContentQualityPolicy(options.policy ?? {});
  const fields = {};
  for (const field of CONTENT_FIELDS) {
    const issues = field === 'title'
      ? evaluateLocalizedText(field, artifact.content.title, policy)
      : field === 'description'
        ? evaluateLocalizedText(field, artifact.content.description, policy)
        : field === 'keywords'
          ? evaluateKeywords(artifact.content.keywords, policy)
          : evaluateCharacteristics(artifact.content.characteristics, policy);
    fields[field] = { status: fieldStatus(issues), issues };
  }
  for (const { issue: claimIssue } of evaluateClaims(artifact, policy)) fields[claimIssue.field].issues.push(claimIssue);
  for (const field of CONTENT_FIELDS) fields[field].status = fieldStatus(fields[field].issues);

  const reworkFields = CONTENT_FIELDS
    .filter((field) => fields[field].status === CONTENT_STATUSES.REWORK)
    .map((field) => ({
      field,
      reasonCodes: [...new Set(fields[field].issues.filter((item) => item.severity === 'rework').map((item) => item.code))],
    }));
  const issueCount = CONTENT_FIELDS.reduce((total, field) => total + fields[field].issues.length, 0);
  const readyFieldCount = CONTENT_FIELDS.filter((field) => fields[field].status === CONTENT_STATUSES.READY).length;
  const reviewFieldCount = CONTENT_FIELDS.filter((field) => fields[field].status === CONTENT_STATUSES.REVIEW).length;
  const reworkFieldCount = reworkFields.length;
  const status = reworkFieldCount ? CONTENT_STATUSES.REWORK : reviewFieldCount ? CONTENT_STATUSES.REVIEW : CONTENT_STATUSES.READY;

  return {
    productKey: artifact.productKey,
    contentVersion: artifact.version,
    status,
    fields,
    reworkPlan: { fields: reworkFields },
    summary: { readyFieldCount, reviewFieldCount, reworkFieldCount, issueCount },
  };
}
