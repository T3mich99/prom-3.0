import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildFinalProductExcelRecord,
  FINAL_EXCEL_STATUSES,
} from './final-product-excel-bridge.mjs';
import {
  buildExistingPromCatalogRegistry,
  buildPromProductCode,
  checkPromCatalogCode,
  inspectPromCatalogTemplate,
} from './prom-catalog-registry.mjs';
import { loadPromBootstrap } from './prom-catalog-bootstrap.mjs';
import { loadXlsx, saveXlsx } from './xlsx-engine.mjs';

export const PROM_DELTA_STATUSES = Object.freeze({
  EXPORTED: 'EXPORTED',
  NEEDS_MEDIA_PUBLICATION: 'NEEDS_MEDIA_PUBLICATION',
  NEEDS_CATEGORY_MAPPING: 'NEEDS_CATEGORY_MAPPING',
  NEEDS_TEMPLATE_MAPPING: 'NEEDS_TEMPLATE_MAPPING',
  FAILED: 'FAILED',
});

export const PROM_COLUMN_CLASSES = Object.freeze({
  REQUIRED_FOR_NEW_PRODUCT: 'REQUIRED_FOR_NEW_PRODUCT',
  SOURCE_DERIVED: 'SOURCE_DERIVED',
  GENERATED: 'GENERATED',
  CATEGORY_DERIVED: 'CATEGORY_DERIVED',
  OPTIONAL_VERIFIED: 'OPTIONAL_VERIFIED',
  PROM_ASSIGNED_AFTER_IMPORT: 'PROM_ASSIGNED_AFTER_IMPORT',
  INTENTIONALLY_BLANK: 'INTENTIONALLY_BLANK',
});

// Prom metadata defaults are applied only at the physical Excel export boundary.
// Confirmed supplier values always take precedence; these values never become
// claims in titles, descriptions, photos, or sourceFacts.
export const PROM_SOURCE_METADATA_FALLBACKS = Object.freeze({
  manufacturer: 'AND',
  country: 'Китай',
});

const REQUIRED_HEADERS = new Set([
  'Код_товару',
  'Назва_позиції',
  'Назва_позиції_укр',
  'Пошукові_запити',
  'Пошукові_запити_укр',
  'Опис',
  'Опис_укр',
  'Тип_товару',
  'Ціна',
  'Валюта',
  'Одиниця_виміру',
  'Посилання_зображення',
  'Наявність',
  'Номер_групи',
  'Назва_групи',
  'Посилання_підрозділу',
]);

const PROM_ASSIGNED_HEADERS = new Set([
  'Унікальний_ідентифікатор',
  'Ідентифікатор_товару',
  'Ідентифікатор_підрозділу',
  'Продукт_на_сайті',
  'Товар_в_ProSale',
]);

const INTENTIONALLY_BLANK_HEADERS = new Set([
  'Мінімальний_обсяг_замовлення',
  'Оптова_ціна',
  'Мінімальне_замовлення_опт',
  'Кількість',
  'Можливість_поставки',
  'Термін_поставки',
  'Спосіб_пакування',
  'Спосіб_пакування_укр',
  'Знижка',
  'ID_групи_різновидів',
  'Чому_товар_не_в_ProSale',
  'Термін_дії_знижки_від',
  'Термін_дії_знижки_до',
  'Ціна_від',
  'Ярлик',
  'Вага,кг',
  'Ширина,см',
  'Висота,см',
  'Довжина,см',
  'Де_знаходиться_товар',
]);

const OPTIONAL_VERIFIED_HEADERS = new Set([
  'Виробник',
  'Країна_виробник',
  'Код_маркування_(GTIN)',
  'Номер_пристрою_(MPN)',
]);

const GENERATED_HEADERS = new Set([
  'Назва_позиції',
  'Назва_позиції_укр',
  'Пошукові_запити',
  'Пошукові_запити_укр',
  'Опис',
  'Опис_укр',
  'HTML_заголовок',
  'HTML_заголовок_укр',
  'HTML_опис',
  'HTML_опис_укр',
]);

const CATEGORY_DERIVED_HEADERS = new Set([
  'Тип_товару',
  'Номер_групи',
  'Назва_групи',
  'Посилання_підрозділу',
  'Ідентифікатор_групи',
]);

const PROTECTED_AUTHORITY_HEADERS = new Set([
  'Код_товару',
  'Ціна',
  'Посилання_зображення',
]);

const SOURCE_DERIVED_HEADERS = new Set([
  'Код_товару',
  'Валюта',
  'Одиниця_виміру',
  'Наявність',
  'Посилання_зображення',
  'Особисті_нотатки',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function nonEmpty(value) {
  return text(value).length > 0;
}

export function applyPromSourceMetadataFallbacks({ canonical = {}, physicalFields = {} } = {}) {
  const resolvedCanonical = isRecord(canonical) ? canonical : {};
  const resolvedPhysical = isRecord(physicalFields) ? physicalFields : {};
  return {
    manufacturer: nonEmpty(resolvedPhysical['Виробник'])
      ? text(resolvedPhysical['Виробник'])
      : nonEmpty(resolvedCanonical.manufacturer)
        ? text(resolvedCanonical.manufacturer)
        : PROM_SOURCE_METADATA_FALLBACKS.manufacturer,
    country: nonEmpty(resolvedPhysical['Країна_виробник'])
      ? text(resolvedPhysical['Країна_виробник'])
      : nonEmpty(resolvedCanonical.country)
        ? text(resolvedCanonical.country)
        : PROM_SOURCE_METADATA_FALLBACKS.country,
  };
}

function columnClass(header) {
  const value = String(header ?? '').trim();
  if (PROM_ASSIGNED_HEADERS.has(value)) return PROM_COLUMN_CLASSES.PROM_ASSIGNED_AFTER_IMPORT;
  if (value.startsWith('Назва_Характеристики') || value.startsWith('Одиниця_виміру_Характеристики') || value.startsWith('Значення_Характеристики')) {
    return PROM_COLUMN_CLASSES.OPTIONAL_VERIFIED;
  }
  if (SOURCE_DERIVED_HEADERS.has(value)) return PROM_COLUMN_CLASSES.SOURCE_DERIVED;
  if (GENERATED_HEADERS.has(value)) return PROM_COLUMN_CLASSES.GENERATED;
  if (CATEGORY_DERIVED_HEADERS.has(value)) return PROM_COLUMN_CLASSES.CATEGORY_DERIVED;
  if (REQUIRED_HEADERS.has(value)) return PROM_COLUMN_CLASSES.REQUIRED_FOR_NEW_PRODUCT;
  if (OPTIONAL_VERIFIED_HEADERS.has(value)) return PROM_COLUMN_CLASSES.OPTIONAL_VERIFIED;
  if (SOURCE_DERIVED_HEADERS.has(value)) return PROM_COLUMN_CLASSES.SOURCE_DERIVED;
  if (INTENTIONALLY_BLANK_HEADERS.has(value)) return PROM_COLUMN_CLASSES.INTENTIONALLY_BLANK;
  return PROM_COLUMN_CLASSES.INTENTIONALLY_BLANK;
}

export function classifyPromColumns(headers) {
  if (!Array.isArray(headers) || headers.length === 0) throw new TypeError('headers must be a non-empty array');
  return headers.map((header, index) => ({ index, header: String(header ?? ''), class: columnClass(header) }));
}

function headerIndex(headers, header) {
  return headers.indexOf(header);
}

function setHeaderValue(values, headers, header, value) {
  const index = headerIndex(headers, header);
  if (index >= 0 && value !== undefined) values[index] = value;
}

function canonicalFromFinalRecord(input) {
  if (!isRecord(input.productionArtifact)) return {};
  const final = buildFinalProductExcelRecord({
    productionArtifact: input.productionArtifact,
    publishableMedia: input.publishableMedia,
  });
  if (final.status === FINAL_EXCEL_STATUSES.WAITING_FOR_MEDIA_PUBLICATION) {
    const error = new Error('PR26 approved media is waiting for public publication');
    error.code = PROM_DELTA_STATUSES.NEEDS_MEDIA_PUBLICATION;
    throw error;
  }
  if (final.status !== FINAL_EXCEL_STATUSES.READY_FOR_EXCEL) {
    const error = new Error('PR26 final product bridge did not return a READY_FOR_EXCEL record');
    error.code = PROM_DELTA_STATUSES.NEEDS_CATEGORY_MAPPING;
    error.details = final.diagnostics;
    throw error;
  }
  return { ...final.row, characteristics: clone(input.productionArtifact.contentArtifact.content.characteristics) };
}

function mediaUrls(value) {
  const urls = Array.isArray(value) ? value : text(value).split(/\s*,\s*/u).filter(Boolean);
  return urls.map((url) => text(url));
}

function validatePublicPhotoUrls(value) {
  const urls = mediaUrls(value);
  if (urls.length !== 5) throw new Error('exactly five publishable public photo URLs are required');
  const parsed = urls.map((url) => {
    let item;
    try { item = new URL(url); } catch { throw new Error('photo URL must be an absolute HTTPS URL'); }
    if (item.protocol !== 'https:') throw new Error('photo URL must use HTTPS');
    if (!item.hostname || ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(item.hostname.toLocaleLowerCase('en-US'))) {
      throw new Error('photo URL must not point to a local host');
    }
    return url;
  });
  if (new Set(parsed).size !== parsed.length) throw new Error('photo URLs must be unique');
  return parsed;
}

function assertPromValue(value, header) {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  throw new TypeError(`Unsupported value for physical Prom column ${header}`);
}

function assertCategory(product, fields) {
  const categoryId = product.categoryId ?? fields.categoryId ?? fields['Ідентифікатор_групи'];
  const categoryName = product.categoryName ?? fields.categoryName ?? fields['Назва_групи'];
  if (!nonEmpty(categoryId) || !nonEmpty(categoryName)) {
    const error = new Error('verified Prom category mapping is required before delta export');
    error.code = PROM_DELTA_STATUSES.NEEDS_CATEGORY_MAPPING;
    throw error;
  }
}

export function buildPromDeltaRow(template, product) {
  if (!isRecord(template) || !isRecord(template.productSheet) || !Array.isArray(template.productSheet.headers)) {
    throw new TypeError('template must be an inspected Prom catalog template');
  }
  if (!isRecord(product)) throw new TypeError('product must be an object');
  const headers = template.productSheet.headers;
  const values = Array(headers.length).fill(null);
  const fields = isRecord(product.physicalFields) ? clone(product.physicalFields) : {};
  const canonical = canonicalFromFinalRecord(product);
  const metadata = applyPromSourceMetadataFallbacks({ canonical, physicalFields: fields });
  const resolved = { ...canonical, ...fields, ...metadata };
  const productCode = product.productCode ?? resolved.productCode ?? (product.productionArtifact?.selectedProduct?.product?.supplierSku ? buildPromProductCode(product.productionArtifact.selectedProduct.product.supplierSku) : undefined);
  if (product.productionArtifact && (product.sellingPrice !== undefined || product.price !== undefined || product.photoUrls !== undefined)) throw new TypeError("Production price and photos must come from the validated production artifact");
  if (!nonEmpty(productCode)) throw new TypeError('productCode is required');
  resolved.price = product.sellingPrice ?? product.price ?? resolved.price;
  const photoValue = product.photoUrls ?? resolved.photoUrls;
  const publicUrls = validatePublicPhotoUrls(photoValue);
  Object.assign(resolved, { productCode, photoUrls: publicUrls.join(', ') });
  assertCategory(product, resolved);

  const canonicalHeaders = {
    productCode: 'Код_товару', titleRu: 'Назва_позиції', titleUa: 'Назва_позиції_укр',
    keywordsRu: 'Пошукові_запити', keywordsUa: 'Пошукові_запити_укр', descriptionRu: 'Опис',
    descriptionUa: 'Опис_укр', type: 'Тип_товару', price: 'Ціна', currency: 'Валюта',
    unit: 'Одиниця_виміру', photoUrls: 'Посилання_зображення', availability: 'Наявність',
    categoryName: 'Назва_групи', groupNumber: 'Номер_групи', groupName: 'Назва_групи', groupLink: 'Посилання_підрозділу',
    categoryId: 'Ідентифікатор_групи', manufacturer: 'Виробник', country: 'Країна_виробник',
  };
  resolved.type ??= "r";
  resolved.currency ??= "UAH";
  for (const [field, header] of Object.entries(canonicalHeaders)) setHeaderValue(values, headers, header, resolved[field]);
  for (const [header, value] of Object.entries(fields)) {
    if (!headers.includes(header)) throw new TypeError(`physicalFields contains an unknown Prom header: ${header}`);
    if (PROM_ASSIGNED_HEADERS.has(header)) continue;
    if (product.productionArtifact && GENERATED_HEADERS.has(header) && !header.startsWith("HTML_")) throw new TypeError(`physicalFields cannot override validated content: ${header}`);
    if (PROTECTED_AUTHORITY_HEADERS.has(header)) throw new TypeError(`physicalFields cannot override authoritative Prom column: ${header}`);
    if ((header === 'Виробник' || header === 'Країна_виробник') && !nonEmpty(value)) continue;
    setHeaderValue(values, headers, header, value);
  }
  for (const header of PROM_ASSIGNED_HEADERS) setHeaderValue(values, headers, header, null);
  const characteristics = product.characteristics ?? resolved.characteristics ?? [];
  if (!Array.isArray(characteristics)) throw new TypeError('characteristics must be an array');
  const triplets = template.productSheet.characteristicColumns ?? [];
  if (characteristics.length > triplets.length) {
    const error = new Error('characteristic data exceeds the physical template capacity');
    error.code = 'CHARACTERISTIC_CAPACITY_EXCEEDED';
    throw error;
  }
  for (const [index, item] of characteristics.entries()) {
    if (!isRecord(item) || !nonEmpty(item.name) || !nonEmpty(item.value)) throw new TypeError(`characteristics[${index}] must have name and value`);
    const triplet = triplets[index];
    values[triplet.columns[0]] = item.name;
    values[triplet.columns[1]] = item.unit ?? null;
    values[triplet.columns[2]] = item.value;
  }
  for (const [index, value] of values.entries()) assertPromValue(value, headers[index]);
  for (const header of REQUIRED_HEADERS) {
    const index = headerIndex(headers, header);
    if (index >= 0 && !nonEmpty(values[index])) {
      const error = new Error(`Required Prom field is blank: ${header}`);
      error.code = CATEGORY_DERIVED_HEADERS.has(header) ? PROM_DELTA_STATUSES.NEEDS_CATEGORY_MAPPING : 'REQUIRED_PROM_FIELD_MISSING';
      throw error;
    }
  }
  const price = values[headerIndex(headers, 'Ціна')];
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) throw new TypeError('Prom selling price must be a positive number');
  if (!nonEmpty(values[headerIndex(headers, 'Код_товару')])) throw new TypeError('physical row code is blank');
  return values;
}

function sameValue(left, right) {
  if (left === null || left === undefined || left === '') return right === null || right === undefined || right === '';
  return Object.is(left, right) || String(left) === String(right);
}

function hashRows(rows) {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function validateDeltaOutput({ inputPath, outputPath, template, startRow, rowValues, sourceAudit }) {
  const outputWorkbook = await loadXlsx(outputPath);
  const outputProductSheet = outputWorkbook.getWorksheet(template.productSheet.name);
  const outputGroupSheet = outputWorkbook.getWorksheet(template.groupSheet.name);
  const outputProduct = outputProductSheet.getUsedRange();
  const sourceProductHeaders = template.productSheet.headers;
  const outputHeader = outputProduct?.values?.[0] ?? [];
  if (JSON.stringify(outputHeader) !== JSON.stringify(sourceProductHeaders)) throw new Error('product headers changed during delta export');
  const sourceGroup = sourceAudit.groupValues;
  const outputGroup = outputGroupSheet.getUsedRange()?.values ?? [];
  if (hashRows(outputGroup) !== hashRows(sourceGroup)) throw new Error('group sheet changed during delta export');
  const outputRows = outputProduct?.values ?? [];
  if (outputRows.length !== 1 + rowValues.length) throw new Error('delta product sheet must contain only the header and new rows');
  for (let index = 0; index < rowValues.length; index += 1) {
    const actual = outputRows[startRow - 1 + index] ?? [];
    if (actual.length < rowValues[index].length) throw new Error('delta row was truncated');
    for (let column = 0; column < rowValues[index].length; column += 1) {
      if (!sameValue(actual[column], rowValues[index][column])) throw new Error(`delta value mismatch at row ${startRow + index}, column ${column + 1}`);
    }
  }
  const inputHash = createHash('sha256').update(await fs.readFile(inputPath)).digest('hex');
  return { inputHash, outputPath, worksheetsPreserved: true, headersPreserved: true, groupsPreserved: true, existingRowsExcluded: true };
}

async function resolveTemplateInput(input) {
  if (input.inputPath !== undefined) return { sourcePath: path.resolve(String(input.inputPath)), bootstrap: null };
  const bootstrap = await loadPromBootstrap({ dbPath: input.bootstrapDbPath, bootstrapId: input.bootstrapId });
  return { sourcePath: path.resolve(bootstrap.masterTemplatePath), bootstrap };
}

export async function exportPromDeltaWorkbook(input) {
  if (!isRecord(input)) throw new TypeError('delta export input must be an object');
  for (const key of ['outputPath', 'products']) if (input[key] === undefined) throw new TypeError(`${key} is required`);
  if (input.inputPath === undefined && input.bootstrapDbPath === undefined) throw new TypeError('inputPath or bootstrapDbPath is required');
  if (!Array.isArray(input.products)) throw new TypeError('products must be an array');
  const { sourcePath, bootstrap } = await resolveTemplateInput(input);
  const outputPath = path.resolve(String(input.outputPath));
  if (sourcePath === outputPath) throw new Error('outputPath must differ from inputPath');
  const [sourceReal, outputReal] = await Promise.all([fs.realpath(sourcePath), fs.realpath(outputPath).catch(() => null)]);
  if (sourceReal === outputReal) throw new Error("outputPath must differ from inputPath");
  const sourceHash = createHash("sha256").update(await fs.readFile(sourcePath)).digest("hex");
  const template = await inspectPromCatalogTemplate(sourcePath, input.templateOptions ?? {});
  const registry = input.registry ?? bootstrap?.registry ?? await buildExistingPromCatalogRegistry(sourcePath, input.templateOptions ?? {});
  const sourceWorkbook = await loadXlsx(sourcePath);
  const sourceProductSheet = sourceWorkbook.getWorksheet(template.productSheet.name);
  const sourceGroupSheet = sourceWorkbook.getWorksheet(template.groupSheet.name);
  const sourceGroupValues = sourceGroupSheet.getUsedRange()?.values ?? [];
  const rows = [];
  const results = [];
  const batchCodes = new Set();
  if (input.products.length === 0) return { status: "NO_READY_PRODUCTS", outputPath: null, products: [], template, registrySummary: registry.summary };
  try {
    for (const product of input.products) {
      const row = buildPromDeltaRow(template, product);
      const code = row[headerIndex(template.productSheet.headers, 'Код_товару')];
      if (batchCodes.has(code)) throw new Error(`Duplicate product code in current batch: ${code}`);
      batchCodes.add(code);
      const check = checkPromCatalogCode(registry, code);
      if (check.status !== 'AVAILABLE') {
        const error = new Error(`product code ${code} is not available in the existing Prom registry`);
        error.code = check.status;
        throw error;
      }
      rows.push(row);
      results.push({ productKey: product.productKey ?? code, productCode: code, status: PROM_DELTA_STATUSES.EXPORTED });
    }
  } catch (error) {
    return {
      status: error.code === PROM_DELTA_STATUSES.NEEDS_MEDIA_PUBLICATION ? PROM_DELTA_STATUSES.NEEDS_MEDIA_PUBLICATION
        : error.code === PROM_DELTA_STATUSES.NEEDS_CATEGORY_MAPPING ? PROM_DELTA_STATUSES.NEEDS_CATEGORY_MAPPING
          : error.code === 'CHARACTERISTIC_CAPACITY_EXCEEDED' ? PROM_DELTA_STATUSES.NEEDS_TEMPLATE_MAPPING : PROM_DELTA_STATUSES.FAILED,
      outputPath: null,
      products: results.map((item) => ({ ...item, status: "NOT_EXPORTED" })),
      error: { code: error.code ?? 'PROM_DELTA_EXPORT_FAILED', message: error.message },
      template,
      registrySummary: registry.summary,
    };
  }
  const startRow = 2;
  for (const [index, row] of rows.entries()) {
    if (row.length !== template.productSheet.headers.length) throw new Error(`delta row ${index} does not match the exact physical template width`);
  }
  sourceProductSheet.replaceRowsFrom(startRow, rows);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const stagingPath = path.join(path.dirname(outputPath), `.prom-${randomUUID()}.xlsx`);
  let validation;
  try {
    await saveXlsx(sourceWorkbook, stagingPath);
    validation = await validateDeltaOutput({ inputPath: sourcePath, outputPath: stagingPath, template, startRow, rowValues: rows, sourceAudit: { groupValues: sourceGroupValues } });
    if (validation.inputHash !== sourceHash) throw new Error('Source template changed during export');
    await fs.rename(stagingPath, outputPath);
    validation.outputPath = outputPath;
    validation.inputHashUnchanged = true;
  } finally {
    await fs.rm(stagingPath, { force: true });
  }
  return { status: PROM_DELTA_STATUSES.EXPORTED, outputPath, products: results, template, registrySummary: registry.summary, validation };
}
