export const CANONICAL_FIELDS = Object.freeze([
  'productCode',
  'titleRu',
  'titleUa',
  'descriptionRu',
  'descriptionUa',
  'keywordsRu',
  'keywordsUa',
  'price',
  'manufacturer',
  'unit',
  'photoUrls',
  'categoryId',
  'categoryName',
  'uniqueId',
  'productId',
  'currency',
  'availability',
]);

export const REQUIRED_CANONICAL_FIELDS = Object.freeze(['titleRu']);
export const OPTIONAL_CANONICAL_FIELDS = Object.freeze(
  CANONICAL_FIELDS.filter((field) => !REQUIRED_CANONICAL_FIELDS.includes(field)),
);

const ALIASES = {
  productCode: ['Код_товару', 'Код_товара'],
  titleRu: ['Назва_позиції', 'Название_позиции', 'Назва позиції', 'Название позиции'],
  titleUa: ['Назва_позиції_укр', 'Название_позиции_укр', 'Назва позиції укр', 'Название позиции укр'],
  descriptionRu: ['Опис', 'Описание'],
  descriptionUa: ['Опис_укр', 'Описание_укр', 'Опис укр', 'Описание укр'],
  keywordsRu: ['Пошукові_запити', 'Поисковые_запросы', 'Пошукові запити', 'Поисковые запросы'],
  keywordsUa: ['Пошукові_запити_укр', 'Поисковые_запросы_укр', 'Пошукові запити укр', 'Поисковые запросы укр'],
  price: ['Ціна', 'Цена'],
  manufacturer: ['Виробник', 'Производитель'],
  unit: ['Одиниця_виміру', 'Единица_измерения', 'Одиниця виміру', 'Единица измерения'],
  photoUrls: ['Посилання_зображення', 'Ссылка_изображения', 'Посилання зображення', 'Ссылка изображения'],
  categoryId: ['Ідентифікатор_групи', 'Идентификатор_группы', 'Ідентифікатор групи', 'Идентификатор группы'],
  categoryName: ['Назва_групи', 'Название_группы', 'Назва групи', 'Название группы'],
  uniqueId: ['Унікальний_ідентифікатор', 'Уникальный_идентификатор', 'Унікальний ідентифікатор', 'Уникальный идентификатор'],
  productId: ['Ідентифікатор_товару', 'Идентификатор_товара', 'Ідентифікатор товару', 'Идентификатор товара'],
  currency: ['Валюта'],
  availability: ['Наявність', 'Наличие'],
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const ALIAS_REGISTRY = deepFreeze(
  Object.fromEntries(Object.entries(ALIASES).map(([field, aliases]) => [field, Object.freeze([...aliases])])),
);

const aliasIndex = new Map();
for (const [field, aliases] of Object.entries(ALIAS_REGISTRY)) {
  for (const alias of aliases) {
    const normalized = normalizeHeader(alias);
    const fields = aliasIndex.get(normalized) ?? [];
    if (!fields.includes(field)) fields.push(field);
    aliasIndex.set(normalized, fields);
  }
}

const DYNAMIC_CHARACTERISTIC_RE = /^(?:назва|название|одиниця виміру|единица измерения|значення|значение) характеристики(?: \d+)?$/iu;
const PRICE_LIKE_RE = /(?:^|\s)(?:ціна|цена|ррц|price)(?:$|\s)/iu;

export function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/[\s_]+/gu, ' ')
    .replace(/\s*[-–—]\s*/gu, '-')
    .toLocaleLowerCase('uk-UA');
}

export function columnLetter(index) {
  if (!Number.isInteger(index) || index < 0) throw new TypeError('column index must be a non-negative integer');
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function canonicalCandidatesForHeader(header) {
  return [...(aliasIndex.get(normalizeHeader(header)) ?? [])];
}

export function isDynamicCharacteristicHeader(header) {
  return DYNAMIC_CHARACTERISTIC_RE.test(normalizeHeader(header));
}

export function isPriceLikeHeader(header) {
  return PRICE_LIKE_RE.test(normalizeHeader(header));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mappingError(message, details = undefined) {
  const error = new TypeError(message);
  error.code = 'INVALID_EXPLICIT_MAPPING';
  if (details !== undefined) error.details = details;
  return error;
}

function columnInfoForHeader(sheet, headerRow) {
  return sheet.headerCandidates.find((candidate) => candidate.rowNumber === headerRow)?.columns ?? null;
}

function selectSheet(schema, explicitName) {
  if (explicitName !== undefined) {
    const sheet = schema.sheets.find((item) => item.name === explicitName);
    if (!sheet) throw mappingError(`Unknown worksheet: ${explicitName}`);
    return { sheet, explicit: true };
  }
  if (schema.candidateProductSheets.length === 0) return { sheet: null, explicit: false };
  if (schema.candidateProductSheets.length > 1) {
    const top = schema.candidateProductSheets[0];
    const tied = schema.candidateProductSheets.filter((item) => item.score === top.score);
    if (tied.length > 1) return { sheet: null, explicit: false, ambiguous: tied };
  }
  const selected = schema.candidateProductSheets[0];
  return { sheet: schema.sheets.find((item) => item.index === selected.index) ?? null, explicit: false };
}

function selectHeaderRow(sheet, options) {
  if (options.headerRow !== undefined) {
    if (!Number.isSafeInteger(options.headerRow) || options.headerRow < 1) {
      throw mappingError('headerRow must be a positive one-based integer');
    }
    const columns = columnInfoForHeader(sheet, options.headerRow);
    if (!columns) throw mappingError(`Header row ${options.headerRow} was not found in worksheet ${sheet.name}`);
    return { rowNumber: options.headerRow, columns, explicit: true };
  }
  const candidates = sheet.headerCandidates.filter((candidate) => candidate.recognizedCount > 0);
  if (!candidates.length) return { rowNumber: null, columns: null, ambiguous: false };
  const top = candidates[0];
  const tied = candidates.filter((candidate) => candidate.score === top.score);
  if (tied.length > 1) return { rowNumber: null, columns: null, ambiguous: true, candidates: tied };
  return { rowNumber: top.rowNumber, columns: top.columns, explicit: false };
}

function resolveExplicitColumn(value, columns, field) {
  let index;
  if (Number.isSafeInteger(value) && value >= 0) index = value;
  else if (typeof value === 'string' && /^[A-Z]+$/iu.test(value.trim())) {
    const letters = value.trim().toUpperCase();
    index = 0;
    for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
    index -= 1;
  } else if (typeof value === 'string') {
    const matches = columns.filter((column) => column.originalHeader === value);
    if (matches.length !== 1) throw mappingError(`Explicit header is not unique for ${field}: ${value}`);
    index = matches[0].columnIndex;
  } else throw mappingError(`Explicit mapping for ${field} must be a zero-based column index, column letter, or exact header`);
  const column = columns.find((item) => item.columnIndex === index);
  if (!column || !String(column.originalHeader).trim()) throw mappingError(`Explicit column does not contain a header for ${field}`);
  return column;
}

function mappedEntry(field, column, confidence) {
  return {
    canonicalField: field,
    columnIndex: column.columnIndex,
    columnLetter: column.columnLetter,
    originalHeader: column.originalHeader,
    confidence,
    status: 'mapped',
  };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

export function mapTemplateSchema(schema, options = {}) {
  if (!isRecord(schema) || !Array.isArray(schema.sheets) || !Array.isArray(schema.candidateProductSheets)) {
    throw new TypeError('schema must be an inspector result');
  }
  if (!isRecord(options)) throw new TypeError('mapping options must be an object');
  const columnsOverride = options.columns ?? {};
  if (!isRecord(columnsOverride)) throw mappingError('columns mapping must be an object');
  for (const field of Object.keys(columnsOverride)) {
    if (!CANONICAL_FIELDS.includes(field)) throw mappingError(`Unknown canonical mapping key: ${field}`);
  }

  const selected = selectSheet(schema, options.sheetName);
  const base = {
    status: 'UNSUPPORTED',
    sheet: selected.sheet ? { name: selected.sheet.name, index: selected.sheet.index, hidden: selected.sheet.hidden, serviceLike: selected.sheet.serviceLike } : null,
    headerRow: null,
    mappings: [],
    unmappedRequiredFields: [...REQUIRED_CANONICAL_FIELDS],
    ambiguousMappings: [],
    unmappedOptionalFields: [...OPTIONAL_CANONICAL_FIELDS],
    dynamicCharacteristicColumns: [],
    diagnostics: [],
  };
  if (selected.ambiguous) {
    return { ...base, status: 'NEEDS_MAPPING', diagnostics: [{ code: 'AMBIGUOUS_PRODUCT_SHEET', message: 'Multiple product worksheets have equal evidence', sheets: selected.ambiguous.map((item) => item.name) }] };
  }
  if (!selected.sheet) {
    return { ...base, status: 'UNSUPPORTED', diagnostics: [{ code: 'NO_PRODUCT_SHEET', message: 'No supported product worksheet was identified' }] };
  }
  if (selected.sheet.hidden || selected.sheet.serviceLike) {
    if (options.sheetName === undefined) {
      return { ...base, status: 'NEEDS_MAPPING', diagnostics: [{ code: 'SERVICE_SHEET_SELECTED', message: 'The selected worksheet is hidden or service-like and requires explicit selection' }] };
    }
  }
  const header = selectHeaderRow(selected.sheet, options);
  if (header.ambiguous) {
    return { ...base, status: 'NEEDS_MAPPING', diagnostics: [{ code: 'AMBIGUOUS_HEADER_ROW', message: 'Multiple header rows have equal evidence', rows: header.candidates.map((item) => item.rowNumber) }] };
  }
  if (!header.columns) {
    return { ...base, status: options.sheetName ? 'NEEDS_MAPPING' : 'UNSUPPORTED', diagnostics: [{ code: 'NO_HEADER_ROW', message: 'No plausible header row was identified' }] };
  }

  const mappings = [];
  const ambiguousMappings = [];
  const explicitFields = Object.keys(columnsOverride);
  for (const field of explicitFields) {
    const column = resolveExplicitColumn(columnsOverride[field], header.columns, field);
    mappings.push(mappedEntry(field, column, 'explicit-user-mapping'));
  }
  const assigned = new Map(mappings.map((item) => [item.canonicalField, item]));
  const usedPhysicalColumns = new Map();
  for (const item of mappings) {
    const existing = usedPhysicalColumns.get(item.columnIndex);
    if (existing && existing.canonicalField !== item.canonicalField) {
      throw mappingError(`Physical column ${item.columnLetter} is assigned to incompatible canonical fields`, { fields: [existing.canonicalField, item.canonicalField] });
    }
    usedPhysicalColumns.set(item.columnIndex, item);
  }
  for (const field of CANONICAL_FIELDS) {
    if (assigned.has(field)) continue;
    const candidates = header.columns.filter((column) => column.canonicalCandidates.includes(field));
    if (candidates.length > 1) {
      ambiguousMappings.push({ canonicalField: field, columnIndexes: candidates.map((item) => item.columnIndex), reason: 'multiple physical columns match one canonical field' });
      continue;
    }
    if (candidates.length === 1) {
      const column = candidates[0];
      const competing = column.canonicalCandidates.filter((candidate) => candidate !== field);
      if (competing.length) {
        ambiguousMappings.push({ canonicalField: field, columnIndexes: [column.columnIndex], conflictingFields: competing, reason: 'one physical column has incompatible canonical meanings' });
        continue;
      }
      const existing = usedPhysicalColumns.get(column.columnIndex);
      if (existing && existing.canonicalField !== field) {
        ambiguousMappings.push({ canonicalField: field, columnIndexes: [column.columnIndex], conflictingFields: [existing.canonicalField], reason: 'physical column already assigned' });
        continue;
      }
      const item = mappedEntry(field, column, 'exact-alias');
      mappings.push(item);
      assigned.set(field, item);
      usedPhysicalColumns.set(column.columnIndex, item);
    }
  }

  const priceLikeColumns = header.columns.filter((column) => isPriceLikeHeader(column.originalHeader));
  if (!assigned.has('price') && !explicitFields.includes('price') && priceLikeColumns.length) {
    ambiguousMappings.push({ canonicalField: 'price', columnIndexes: uniqueSorted(priceLikeColumns.map((item) => item.columnIndex)), reason: 'price-like headers require an exact selling-price alias or explicit mapping' });
  }

  const mappedFields = new Set(mappings.map((item) => item.canonicalField));
  const dynamicCharacteristicColumns = header.columns.filter((column) => column.kind === 'dynamicCharacteristic');
  const result = {
    status: 'SAFE',
    sheet: { name: selected.sheet.name, index: selected.sheet.index, hidden: selected.sheet.hidden, serviceLike: selected.sheet.serviceLike },
    headerRow: header.rowNumber,
    mappings: CANONICAL_FIELDS.filter((field) => mappedFields.has(field)).map((field) => mappings.find((item) => item.canonicalField === field)),
    unmappedRequiredFields: REQUIRED_CANONICAL_FIELDS.filter((field) => !mappedFields.has(field)),
    ambiguousMappings: ambiguousMappings.sort((a, b) => a.canonicalField.localeCompare(b.canonicalField, 'en')),
    unmappedOptionalFields: OPTIONAL_CANONICAL_FIELDS.filter((field) => !mappedFields.has(field) && !ambiguousMappings.some((item) => item.canonicalField === field)),
    dynamicCharacteristicColumns,
    diagnostics: [],
  };
  if (result.unmappedRequiredFields.length) result.diagnostics.push({ code: 'REQUIRED_FIELD_UNMAPPED', fields: result.unmappedRequiredFields });
  if (result.ambiguousMappings.length) result.diagnostics.push({ code: 'AMBIGUOUS_MAPPING', fields: result.ambiguousMappings.map((item) => item.canonicalField) });
  if (result.ambiguousMappings.length || result.unmappedRequiredFields.length) result.status = 'NEEDS_MAPPING';
  return result;
}
