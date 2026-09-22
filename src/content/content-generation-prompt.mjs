import { CONTENT_FIELDS, CONTENT_LANGUAGES } from './content-contract.mjs';

const GENERATION_INPUT_KEYS = new Set(['productKey', 'sourceFacts', 'sourceText', 'categoryContext']);
const CONTENT_RESPONSE_FIELDS = new Set(CONTENT_FIELDS);
const RESPONSE_FORMAT = Object.freeze({ type: 'json_object' });
const FORBIDDEN_SOURCE_FACT_KEYS = new Set([
  'rrp',
  'productid',
  'productkey',
  'productcode',
  'uniqueid',
  'categoryid',
  'categoryname',
  'exportid',
  'exportcode',
  'supplierid',
  'suppliersku',
  'sourceproductid',
  'sourceurl',
  'sourceimageurl',
]);
const FORBIDDEN_SOURCE_FACT_TOKENS = Object.freeze(['price', 'cost', 'commission', 'margin', 'currency']);

export const CONTENT_GENERATION_RESPONSE_FORMAT = RESPONSE_FORMAT;

const SYSTEM_PROMPT = [
  'You generate truthful marketplace content from verified product data.',
  'The target profile is commercial Prom.ua content v2: sales-oriented, concrete, natural, and factual.',
  'Use sourceFacts as the sole authority for factual values and specifications.',
  'Treat sourceText only as contextual source wording; a numeric or specification claim from sourceText may be used only when the same fact is supported by sourceFacts.',
  'Never reproduce prices, costs, commissions, margins, currency amounts, or other business or economic metadata from sourceText.',
  'Omit unknown specifications; never make reasonable assumptions.',
  'Return one strict JSON object only. Do not use Markdown, commentary, or code fences.',
  'Generate Russian and Ukrainian fields independently; do not translate or copy one language into the other.',
  'Never include model names or model numbers in titles or descriptions, including description headings and specification sections, even when verified. Keep the genuine brand; keep model data only in source facts for identity.',
  'Title order: product type, main feature, brand, useful verified characteristics, and verified color near the end.',
  'Titles must state the product purpose clearly when it is verified. Never leave a dangling purpose phrase such as "для:" or "для"; name what the product is for instead of inserting a generic slogan after the preposition.',
  'Descriptions open with a concrete buyer outcome or use scenario, then use the sections Переваги/Преимущества, Особливості/Особенности, Підходить для/Подходит для, and Характеристики.',
  'Never generate a Комплектація, Комплектация, Комплект поставки, Что входит в комплект, or Що входить у комплект section.',
  'Keywords are 25–35 natural comma-separated search phrases per language, targeted to 800–1000 characters, with no duplicates, language mixing, price phrases, or unsupported facts.',
  'Do not output price, photo URLs, category IDs or names, product identifiers, currency, availability, manufacturer, or model unless those are not requested as content fields; business metadata is forbidden.',
  'Do not treat price as a product-quality claim.',
].join(' ');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function assertJsonValue(value, label) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${label}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) assertJsonValue(child, `${label}.${key}`);
    return;
  }
  throw new TypeError(`${label} must contain only JSON-compatible values`);
}

function normalizeSourceFactKey(key) {
  return key.toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '');
}

function isForbiddenSourceFactKey(key) {
  const normalized = normalizeSourceFactKey(key);
  return FORBIDDEN_SOURCE_FACT_KEYS.has(normalized)
    || FORBIDDEN_SOURCE_FACT_TOKENS.some((token) => normalized.includes(token));
}

function assertNoForbiddenSourceFactKeys(value, label) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenSourceFactKeys(item, `${label}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenSourceFactKey(key)) throw new TypeError(`${label}.${key} is forbidden business metadata`);
    assertNoForbiddenSourceFactKeys(child, `${label}.${key}`);
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort((a, b) => a.localeCompare(b, 'en')).map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function validateContentGenerationInput(input) {
  assertRecord(input, 'generation input');
  for (const key of Object.keys(input)) {
    if (!GENERATION_INPUT_KEYS.has(key)) throw new TypeError(`Unsupported generation input field: ${key}`);
  }
  if (typeof input.productKey !== 'string' || input.productKey.length === 0) {
    throw new TypeError('generation input.productKey must be a non-empty string');
  }
  assertRecord(input.sourceFacts, 'generation input.sourceFacts');
  assertJsonValue(input.sourceFacts, 'generation input.sourceFacts');
  assertNoForbiddenSourceFactKeys(input.sourceFacts, 'generation input.sourceFacts');
  if (input.sourceText !== undefined) {
    assertRecord(input.sourceText, 'generation input.sourceText');
    for (const [key, value] of Object.entries(input.sourceText)) {
      if (typeof value !== 'string') throw new TypeError(`generation input.sourceText.${key} must be a string`);
    }
  }
  if (input.categoryContext !== undefined) {
    assertRecord(input.categoryContext, 'generation input.categoryContext');
    assertJsonValue(input.categoryContext, 'generation input.categoryContext');
  }
  return input;
}

function sourceSection(input) {
  const sections = [
    `PRODUCT KEY (identity only; do not return it): ${JSON.stringify(input.productKey)}`,
    `VERIFIED SOURCE FACTS (the only factual authority):\n${stableJson(input.sourceFacts)}`,
  ];
  if (input.sourceText !== undefined) sections.push(`SOURCE TEXT (contextual wording only; not authoritative for factual values):\n${stableJson(input.sourceText)}`);
  if (input.categoryContext !== undefined) sections.push(`VERIFIED CATEGORY CONTEXT (not a Prom category assignment):\n${stableJson(input.categoryContext)}`);
  return sections.join('\n\n');
}

function outputContract() {
  return [
    'Return exactly this response shape and no other top-level keys:',
    '{"content":{"title":{"ru":"...","ua":"..."},"description":{"ru":"...","ua":"..."},"keywords":{"ru":"...","ua":"..."},"characteristics":[{"name":"...","value":"..."}]},"claims":[{"field":"...","value":"...","contentField":"description"}]}',
    'The claims array is optional. All content facts must be supported by the supplied verified source data.',
    'Do not add price, photoUrls, categoryId, categoryName, productCode, productId, uniqueId, currency, availability, manufacturer, or model fields.',
  ].join('\n');
}

export function buildContentGenerationRequest(input) {
  validateContentGenerationInput(input);
  return {
    system: SYSTEM_PROMPT,
    prompt: [
      'Create a complete Content Artifact v1 content payload for the requested product.',
      'Write separate natural Russian and Ukrainian commercial marketplace content. Use buyer-benefit openings and category-specific scenarios, not generic boilerplate.',
      'Titles must use the order type + main feature + brand + important verified characteristics + color when known; omit unknown elements without placeholders.',
      'Descriptions may be detailed when verified facts support it, must be at least 1000 visible characters, and must not contain a completeness/package section.',
      'Keywords must contain 25–35 real search phrases in each language and target 800–1000 characters; do not duplicate one list into the other, mix languages, or use cosmetic spam.',
      'Characteristics must contain only supported name/value pairs. Omit unknown characteristics.',
      'Treat sourceFacts as the sole authority for factual values and specifications. A numeric or specification claim from sourceText may be used only when the same fact is supported by sourceFacts; never reproduce prices or costs from sourceText.',
      sourceSection(input),
      outputContract(),
    ].join('\n\n'),
    responseFormat: { ...RESPONSE_FORMAT },
    metadata: {
      operation: 'initial-generation',
      productKey: input.productKey,
      outputContract: 'content-artifact-v1',
      languages: [...CONTENT_LANGUAGES],
      contentFields: [...CONTENT_FIELDS],
    },
  };
}

export function buildContentReworkRequest({ productKey, sourceFacts, fields, previousValues }) {
  if (typeof productKey !== 'string' || productKey.length === 0) throw new TypeError('rework productKey must be a non-empty string');
  assertRecord(sourceFacts, 'rework sourceFacts');
  assertJsonValue(sourceFacts, 'rework sourceFacts');
  assertNoForbiddenSourceFactKeys(sourceFacts, 'rework sourceFacts');
  if (!Array.isArray(fields) || fields.length === 0) throw new TypeError('rework fields must be a non-empty array');
  if (!isRecord(previousValues)) throw new TypeError('rework previousValues must be an object');
  const targetFields = fields.map((item) => {
    if (!isRecord(item) || !CONTENT_RESPONSE_FIELDS.has(item.field) || !Array.isArray(item.reasonCodes)) {
      throw new TypeError('rework fields must contain content field and reasonCodes');
    }
    return { field: item.field, reasonCodes: [...item.reasonCodes] };
  });
  const targetNames = targetFields.map((item) => item.field);
  return {
    system: [
      'You perform explicit field-level correction of truthful marketplace content.',
      'Use sourceFacts as the sole authority for factual values and specifications. Never reproduce prices, costs, commissions, margins, currency amounts, or other business or economic metadata.',
      'Return strict JSON only, without Markdown or commentary.',
      'Rewrite only the requested content fields. Do not return unrelated content fields or business metadata.',
      'Never include model names or model numbers in titles or descriptions, including description headings and specification sections, even when verified. Keep the genuine brand; keep model data only in source facts for identity.',
      'Apply the commercial Prom.ua v2 rules to every requested field: factual title order, concrete buyer-benefit description, no completeness section, and 25–35 separate natural-language keyword phrases.',
    ].join(' '),
    prompt: [
      'Repair only the requested fields from the existing Content Quality rework plan.',
      `PRODUCT KEY (identity only; do not return it): ${JSON.stringify(productKey)}`,
      `VERIFIED SOURCE FACTS:\n${stableJson(sourceFacts)}`,
      `REQUESTED FIELDS AND EXACT QUALITY REASONS:\n${stableJson(targetFields)}`,
      `PREVIOUS VALUES FOR REQUESTED FIELDS ONLY:\n${stableJson(previousValues)}`,
      `Return exactly {"content":{${targetNames.map((field) => `"${field}": ...`).join(',')}}}. Do not return claims or any other top-level key.`,
      'Preserve verified facts, use separate RU and UA values, and omit unsupported details.',
    ].join('\n\n'),
    responseFormat: { ...RESPONSE_FORMAT },
    metadata: {
      operation: 'field-rework',
      productKey,
      fields: targetFields.map((item) => item.field),
      reasonCodes: targetFields.map((item) => ({ field: item.field, reasonCodes: [...item.reasonCodes] })),
    },
  };
}
