import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

import { loadXlsx } from './xlsx-engine.mjs';
import { stripOuterU } from '../contracts/product-identifiers.mjs';

export const PROM_CATALOG_SHEET_NAMES = Object.freeze({
  products: 'Export Products Sheet',
  groups: 'Export Groups Sheet',
});

export const PROM_REGISTRY_STATUSES = Object.freeze({
  READY: 'READY',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  EXISTING_CODE_COLLISION: 'EXISTING_CODE_COLLISION',
  NEEDS_TEMPLATE_MAPPING: 'NEEDS_TEMPLATE_MAPPING',
});

const PRODUCT_FIELDS = Object.freeze({
  code: 'Код_товару',
  titleRu: 'Назва_позиції',
  titleUa: 'Назва_позиції_укр',
  photoUrls: 'Посилання_зображення',
  groupNumber: 'Номер_групи',
  groupName: 'Назва_групи',
  groupLink: 'Посилання_підрозділу',
  uniqueId: 'Унікальний_ідентифікатор',
  productId: 'Ідентифікатор_товару',
  categoryId: 'Ідентифікатор_групи',
  sourceUrl: 'Продукт_на_сайті',
});

const GROUP_FIELDS = Object.freeze({
  number: 'Номер_групи',
  nameRu: 'Назва_групи',
  nameUa: 'Назва_групи_укр',
  id: 'Ідентифікатор_групи',
  parentNumber: 'Номер_батьківської_групи',
  parentId: 'Ідентифікатор_батьківської_групи',
});

const CHARACTERISTIC_HEADER_RE = /^(назва|одиниця виміру|значення) характеристики(?: (\d+))?$/iu;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalized(value) {
  return text(value).normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('uk-UA');
}

function nonBlank(value) {
  return value !== null && value !== undefined && value !== '';
}

function hashValue(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function headerIndexes(headers) {
  return new Map(headers.map((header, index) => [String(header ?? ''), index]));
}

function getByHeader(row, indexes, header) {
  const index = indexes.get(header);
  return index === undefined ? null : row[index] ?? null;
}

function splitImageUrls(value) {
  return text(value).split(/\s*,\s*/u).map((item) => item.trim()).filter(Boolean);
}

function rowHasContent(row) {
  return row.some(nonBlank);
}

function assertWorkbookShape(productsSheet, groupsSheet) {
  if (!productsSheet || !groupsSheet) {
    const error = new TypeError('Prom export must contain Export Products Sheet and Export Groups Sheet');
    error.code = PROM_REGISTRY_STATUSES.NEEDS_TEMPLATE_MAPPING;
    throw error;
  }
  const productHeaders = productsSheet.getUsedRange()?.values?.[0] ?? [];
  const groupHeaders = groupsSheet.getUsedRange()?.values?.[0] ?? [];
  for (const required of [PRODUCT_FIELDS.code, PRODUCT_FIELDS.titleRu, PRODUCT_FIELDS.titleUa]) {
    if (!productHeaders.some((header) => String(header ?? '').trim() === required)) {
      const error = new TypeError(`Prom product header is missing: ${required}`);
      error.code = PROM_REGISTRY_STATUSES.NEEDS_TEMPLATE_MAPPING;
      throw error;
    }
  }
  for (const required of [GROUP_FIELDS.number, GROUP_FIELDS.nameRu]) {
    if (!groupHeaders.some((header) => String(header ?? '').trim() === required)) {
      const error = new TypeError(`Prom group header is missing: ${required}`);
      error.code = PROM_REGISTRY_STATUSES.NEEDS_TEMPLATE_MAPPING;
      throw error;
    }
  }
  return { productHeaders, groupHeaders };
}

function characteristicTriplets(headers) {
  const result = [];
  for (let index = 0; index + 2 < headers.length; index += 1) {
    const names = [headers[index], headers[index + 1], headers[index + 2]].map((value) => String(value ?? '').trim());
    const matches = names.map((value) => value.replace(/_/gu, ' ').match(CHARACTERISTIC_HEADER_RE));
    if (matches[0]?.[1]?.toLocaleLowerCase('uk-UA') === 'назва'
      && matches[1]?.[1]?.toLocaleLowerCase('uk-UA') === 'одиниця виміру'
      && matches[2]?.[1]?.toLocaleLowerCase('uk-UA') === 'значення') {
      result.push({
        index: result.length,
        columns: [index, index + 1, index + 2],
        headers: names,
      });
      index += 2;
    }
  }
  return result;
}

function rowIdentity(row, indexes) {
  return {
    code: text(getByHeader(row, indexes, PRODUCT_FIELDS.code)),
    uniqueId: text(getByHeader(row, indexes, PRODUCT_FIELDS.uniqueId)),
    productId: text(getByHeader(row, indexes, PRODUCT_FIELDS.productId)),
    sourceUrl: text(getByHeader(row, indexes, PRODUCT_FIELDS.sourceUrl)),
    titleRu: text(getByHeader(row, indexes, PRODUCT_FIELDS.titleRu)),
    titleUa: text(getByHeader(row, indexes, PRODUCT_FIELDS.titleUa)),
    groupNumber: text(getByHeader(row, indexes, PRODUCT_FIELDS.groupNumber)),
    groupName: text(getByHeader(row, indexes, PRODUCT_FIELDS.groupName)),
    categoryId: text(getByHeader(row, indexes, PRODUCT_FIELDS.categoryId)),
    groupLink: text(getByHeader(row, indexes, PRODUCT_FIELDS.groupLink)),
    imageUrls: splitImageUrls(getByHeader(row, indexes, PRODUCT_FIELDS.photoUrls)),
  };
}

function collisionKind(entries) {
  const signatures = new Set(entries.map((entry) => hashValue({
    titleRu: normalized(entry.titleRu),
    titleUa: normalized(entry.titleUa),
    groupNumber: normalized(entry.groupNumber),
    groupName: normalized(entry.groupName),
    categoryId: normalized(entry.categoryId),
    sourceUrl: normalized(entry.sourceUrl),
    productId: normalized(entry.productId),
  })));
  return signatures.size === 1 ? 'IDENTICAL' : 'CONFLICTING';
}

function registryEntry(identity, rowNumber) {
  return {
    code: identity.code,
    normalizedIdentifier: stripOuterU(identity.code).trim().toLocaleUpperCase('en-US'),
    rowNumber,
    uniqueId: identity.uniqueId || null,
    productId: identity.productId || null,
    supplier: identity.sourceUrl ? { name: 'ug-opt', sourceUrl: identity.sourceUrl } : null,
    sourceUrl: identity.sourceUrl || null,
    titles: { ru: identity.titleRu || null, ua: identity.titleUa || null },
    group: {
      number: identity.groupNumber || null,
      name: identity.groupName || null,
      id: identity.categoryId || null,
      subdivisionUrl: identity.groupLink || null,
    },
    imageUrls: identity.imageUrls,
  };
}

function collisionReport(code, entries) {
  return {
    code,
    rows: entries.map((entry) => entry.rowNumber),
    titles: entries.map((entry) => ({ ru: entry.titles.ru, ua: entry.titles.ua })),
    productIds: entries.map((entry) => entry.productId),
    urls: entries.map((entry) => entry.sourceUrl),
    categories: entries.map((entry) => clone(entry.group)),
    kind: collisionKind(entries),
    identical: collisionKind(entries) === 'IDENTICAL',
    conflicting: collisionKind(entries) === 'CONFLICTING',
  };
}

function readSheetData(sheet) {
  const used = sheet.getUsedRange();
  if (!used || !Array.isArray(used.values) || used.values.length === 0) {
    const error = new TypeError(`Worksheet ${sheet.name} is empty`);
    error.code = PROM_REGISTRY_STATUSES.NEEDS_TEMPLATE_MAPPING;
    throw error;
  }
  return { used, headers: used.values[0].map((value) => String(value ?? '')), rows: used.values.slice(1) };
}

export async function inspectPromCatalogTemplate(inputPath, options = {}) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) throw new TypeError('inputPath must be a non-empty string');
  if (!isRecord(options)) throw new TypeError('options must be an object');
  const productSheetName = options.productSheetName ?? PROM_CATALOG_SHEET_NAMES.products;
  const groupSheetName = options.groupSheetName ?? PROM_CATALOG_SHEET_NAMES.groups;
  const workbook = await loadXlsx(inputPath);
  const productSheet = workbook.getWorksheet(productSheetName);
  const groupSheet = workbook.getWorksheet(groupSheetName);
  assertWorkbookShape(productSheet, groupSheet);
  const productData = readSheetData(productSheet);
  const groupData = readSheetData(groupSheet);
  const characteristicColumns = characteristicTriplets(productData.headers);
  const template = {
    inputPath,
    sheets: workbook.worksheets.map((sheet) => ({ name: sheet.name, index: sheet.index, hidden: sheet.hidden })),
    productSheet: {
      name: productSheetName,
      headerRow: 1,
      headers: [...productData.headers],
      columnCount: productData.headers.length,
      rowCount: productData.rows.length,
      address: productData.used.address,
      characteristicColumns,
    },
    groupSheet: {
      name: groupSheetName,
      headerRow: 1,
      headers: [...groupData.headers],
      columnCount: groupData.headers.length,
      rowCount: groupData.rows.length,
      address: groupData.used.address,
    },
  };
  return clone(template);
}

export async function buildExistingPromCatalogRegistry(inputPath, options = {}) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) throw new TypeError('inputPath must be a non-empty string');
  const productSheetName = options.productSheetName ?? PROM_CATALOG_SHEET_NAMES.products;
  const groupSheetName = options.groupSheetName ?? PROM_CATALOG_SHEET_NAMES.groups;
  const workbook = await loadXlsx(inputPath);
  const productSheet = workbook.getWorksheet(productSheetName);
  const groupSheet = workbook.getWorksheet(groupSheetName);
  assertWorkbookShape(productSheet, groupSheet);
  const productData = readSheetData(productSheet);
  const groupData = readSheetData(groupSheet);
  const productIndexes = headerIndexes(productData.headers);
  const groupIndexes = headerIndexes(groupData.headers);
  const entriesByCode = new Map();
  const rows = [];
  for (const [offset, row] of productData.rows.entries()) {
    if (!rowHasContent(row)) continue;
    const rowNumber = offset + 2;
    const identity = rowIdentity(row, productIndexes);
    const entry = registryEntry(identity, rowNumber);
    rows.push(entry);
    if (!identity.code) continue;
    const entries = entriesByCode.get(identity.code) ?? [];
    entries.push(entry);
    entriesByCode.set(identity.code, entries);
  }
  const collisions = [...entriesByCode.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([code, entries]) => collisionReport(code, entries));
  const groups = groupData.rows
    .flatMap((row, offset) => rowHasContent(row) ? [{
      rowNumber: offset + 2,
      number: text(getByHeader(row, groupIndexes, GROUP_FIELDS.number)),
      names: {
        ru: text(getByHeader(row, groupIndexes, GROUP_FIELDS.nameRu)),
        ua: text(getByHeader(row, groupIndexes, GROUP_FIELDS.nameUa)),
      },
      id: text(getByHeader(row, groupIndexes, GROUP_FIELDS.id)) || null,
      parentNumber: text(getByHeader(row, groupIndexes, GROUP_FIELDS.parentNumber)) || null,
      parentId: text(getByHeader(row, groupIndexes, GROUP_FIELDS.parentId)) || null,
    }] : []);
  const byCode = Object.fromEntries([...entriesByCode.entries()].map(([code, entries]) => [code, entries.length === 1 ? entries[0] : entries]));
  const codeRows = rows.filter((entry) => entry.code);
  const registry = {
    status: PROM_REGISTRY_STATUSES.READY,
    source: {
      inputPath,
      productSheetName,
      groupSheetName,
      productHeaderCount: productData.headers.length,
      groupHeaderCount: groupData.headers.length,
      characteristicCapacity: characteristicTriplets(productData.headers).length,
    },
    columns: {
      productHeaders: [...productData.headers],
      groupHeaders: [...groupData.headers],
    },
    rows,
    groups,
    byCode,
    collisions,
    summary: {
      physicalProductRows: rows.length,
      rowsWithCode: codeRows.length,
      rowsWithoutCode: rows.length - codeRows.length,
      uniqueCodes: entriesByCode.size,
      collisionCodes: collisions.length,
      collisionRows: collisions.reduce((total, item) => total + item.rows.length, 0),
      eligibleRegistrySize: entriesByCode.size - collisions.length,
    },
    provenance: { source: 'Prom export workbook', readOnly: true },
  };
  return clone(registry);
}

export function buildPromProductCode(sourceIdentifier) {
  const source = text(sourceIdentifier);
  const inner = /^U.+U$/iu.test(source) ? source.slice(1, -1) : source;
  if (!inner || /\s/gu.test(inner)) {
    throw new TypeError('sourceIdentifier must be a non-empty supplier identifier without whitespace or an outer U wrapper');
  }
  return `U${inner}U`;
}

export function checkPromCatalogCode(registry, code) {
  if (!isRecord(registry) || !isRecord(registry.byCode)) throw new TypeError('registry must be an existing Prom catalog registry');
  const normalizedCode = text(code);
  if (!normalizedCode) throw new TypeError('code must be a non-empty string');
  const match = registry.byCode[normalizedCode];
  if (Array.isArray(match)) {
    return { status: PROM_REGISTRY_STATUSES.EXISTING_CODE_COLLISION, code: normalizedCode, entries: clone(match) };
  }
  if (match !== undefined) {
    return { status: PROM_REGISTRY_STATUSES.ALREADY_EXISTS, code: normalizedCode, entry: clone(match) };
  }
  const collision = registry.collisions?.find((item) => item.code === normalizedCode);
  if (collision) return { status: PROM_REGISTRY_STATUSES.EXISTING_CODE_COLLISION, code: normalizedCode, collision: clone(collision) };
  return { status: 'AVAILABLE', code: normalizedCode };
}

export function summarizeCandidateRegistry(candidates, registry) {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
  const summary = { candidateCount: candidates.length, newCandidateCount: 0, skippedExistingCount: 0, collisionCount: 0, skipped: [] };
  const seen = new Set();
  for (const candidate of candidates) {
    if (!isRecord(candidate)) throw new TypeError('candidate must be an object');
    const code = candidate.productCode ?? buildPromProductCode(candidate.supplierSku ?? candidate.sourceProductId);
    const check = checkPromCatalogCode(registry, code);
    if (seen.has(code)) {
      summary.collisionCount += 1;
      summary.skipped.push({ code, status: PROM_REGISTRY_STATUSES.EXISTING_CODE_COLLISION, reason: 'duplicate in candidate pool' });
    } else if (check.status === PROM_REGISTRY_STATUSES.ALREADY_EXISTS) {
      summary.skippedExistingCount += 1;
      summary.skipped.push({ code, status: check.status });
    } else if (check.status === PROM_REGISTRY_STATUSES.EXISTING_CODE_COLLISION) {
      summary.collisionCount += 1;
      summary.skipped.push({ code, status: check.status });
    } else {
      summary.newCandidateCount += 1;
      seen.add(code);
    }
  }
  return summary;
}

export async function hashPromCatalogSource(inputPath) {
  return createHash('sha256').update(await fs.readFile(inputPath)).digest('hex');
}
