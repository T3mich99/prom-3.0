import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildExistingPromCatalogRegistry,
  inspectPromCatalogTemplate,
  PROM_CATALOG_SHEET_NAMES,
} from './prom-catalog-registry.mjs';
import { stripOuterU } from '../contracts/product-identifiers.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(MODULE_DIR, '../..');

export const DEFAULT_PROM_BOOTSTRAP_CONFIG = Object.freeze({
  dbPath: 'runtime/ugopt-top10-full-catalog.sqlite',
  masterTemplatePath: 'runtime/prom/master-template.xlsx',
});

export const PROM_BOOTSTRAP_STATUSES = Object.freeze({
  BOOTSTRAPPED: 'BOOTSTRAPPED',
  SCHEMA_CHANGED: 'SCHEMA_CHANGED',
  TEMPLATE_SCHEMA_CHANGED: 'TEMPLATE_SCHEMA_CHANGED',
  SOURCE_CHANGED_REQUIRES_RECONCILIATION: 'SOURCE_CHANGED_REQUIRES_RECONCILIATION',
});

export const PROM_RECONCILIATION_STATUSES = Object.freeze({
  READY: 'READY',
  SCHEMA_CHANGED: 'SCHEMA_CHANGED',
  TEMPLATE_SCHEMA_CHANGED: 'TEMPLATE_SCHEMA_CHANGED',
  EXTERNAL_PRODUCTS_FOUND: 'EXTERNAL_PRODUCTS_FOUND',
  MISSING_PRODUCTS_FOUND: 'MISSING_PRODUCTS_FOUND',
  COLLISIONS_FOUND: 'COLLISIONS_FOUND',
  REVIEW: 'REVIEW',
});

export const PROM_REGISTRY_STATES = Object.freeze({
  EXISTING_IN_PROM: 'EXISTING_IN_PROM',
  RESERVED_FOR_IMPORT: 'RESERVED_FOR_IMPORT',
  CONFIRMED_IN_PROM: 'CONFIRMED_IN_PROM',
  IMPORT_FAILED: 'IMPORT_FAILED',
  IMPORT_REVIEW: 'IMPORT_REVIEW',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  EXISTING_CODE_COLLISION: 'EXISTING_CODE_COLLISION',
  ALREADY_RESERVED: 'ALREADY_RESERVED',
});

const PERSISTED_STATES = new Set([
  PROM_REGISTRY_STATES.EXISTING_IN_PROM,
  PROM_REGISTRY_STATES.RESERVED_FOR_IMPORT,
  PROM_REGISTRY_STATES.CONFIRMED_IN_PROM,
  PROM_REGISTRY_STATES.IMPORT_FAILED,
  PROM_REGISTRY_STATES.IMPORT_REVIEW,
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

function resolveProjectPath(value) {
  const candidate = text(value);
  if (!candidate) throw new TypeError('path must be a non-empty string');
  return path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(REPOSITORY_ROOT, candidate);
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashValue(value) {
  return hashBytes(Buffer.from(JSON.stringify(value)));
}

function now() {
  return new Date().toISOString();
}

function json(value, fallback) {
  return JSON.stringify(value === undefined ? fallback : value);
}

function parseJson(value, fallback) {
  try {
    return value === null || value === undefined ? fallback : JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function ensureSourcePath(sourcePath, masterTemplatePath) {
  if (sourcePath === masterTemplatePath) throw new Error('sourcePath and masterTemplatePath must differ');
}

function templateFingerprint(template) {
  const { inputPath: _inputPath, ...portableTemplate } = template;
  return hashValue(portableTemplate);
}

function templateStructureFingerprint(template) {
  const structure = {
    sheets: template.sheets?.map(({ name, index, hidden }) => ({ name, index, hidden })) ?? [],
    productSheet: {
      name: template.productSheet?.name,
      headerRow: template.productSheet?.headerRow,
      headers: template.productSheet?.headers ?? [],
      columnCount: template.productSheet?.columnCount,
      characteristicColumns: template.productSheet?.characteristicColumns ?? [],
    },
    groupSheet: {
      name: template.groupSheet?.name,
      headerRow: template.groupSheet?.headerRow,
      headers: template.groupSheet?.headers ?? [],
      columnCount: template.groupSheet?.columnCount,
    },
  };
  return hashValue(structure);
}

export function getPromTemplateFingerprint(template) {
  if (!isRecord(template)) throw new TypeError('template must be an inspected Prom catalog template');
  return templateFingerprint(template);
}

export function getPromStructuralSchemaFingerprint(template) {
  if (!isRecord(template)) throw new TypeError('template must be an inspected Prom catalog template');
  return templateStructureFingerprint(template);
}

function characteristicMapping(template) {
  return {
    sheetName: template.productSheet.name,
    capacity: template.productSheet.characteristicColumns.length,
    slots: template.productSheet.characteristicColumns.map((slot) => ({
      index: slot.index,
      columns: [...slot.columns],
      headers: [...slot.headers],
    })),
  };
}

function groupMapping(template, registry) {
  return {
    sheetName: template.groupSheet.name,
    headers: [...template.groupSheet.headers],
    rows: registry.groups.map((group) => clone(group)),
  };
}

function schemaDiff(expected, actual) {
  const expectedProduct = expected?.productSheet ?? {};
  const actualProduct = actual?.productSheet ?? {};
  const expectedGroup = expected?.groupSheet ?? {};
  const actualGroup = actual?.groupSheet ?? {};
  const expectedProductHeaders = expectedProduct.headers ?? [];
  const actualProductHeaders = actualProduct.headers ?? [];
  const expectedGroupHeaders = expectedGroup.headers ?? [];
  const actualGroupHeaders = actualGroup.headers ?? [];
  const addedColumns = actualProductHeaders.filter((header) => !expectedProductHeaders.includes(header));
  const removedColumns = expectedProductHeaders.filter((header) => !actualProductHeaders.includes(header));
  const renamedColumns = expectedProductHeaders.length === actualProductHeaders.length
    ? expectedProductHeaders.flatMap((header, index) => header !== actualProductHeaders[index]
      && !actualProductHeaders.includes(header)
      && !expectedProductHeaders.includes(actualProductHeaders[index])
      ? [{ index, from: header, to: actualProductHeaders[index] }] : [])
    : [];
  const productHeaderSetEqual = expectedProductHeaders.length === actualProductHeaders.length
    && expectedProductHeaders.every((header) => actualProductHeaders.includes(header));
  const groupHeaderSetEqual = expectedGroupHeaders.length === actualGroupHeaders.length
    && expectedGroupHeaders.every((header) => actualGroupHeaders.includes(header));
  return {
    addedColumns,
    removedColumns,
    renamedColumns,
    reorderedColumns: productHeaderSetEqual && JSON.stringify(expectedProductHeaders) !== JSON.stringify(actualProductHeaders),
    characteristicCapacityChanged: (expectedProduct.characteristicColumns?.length ?? 0)
      !== (actualProduct.characteristicColumns?.length ?? 0),
    productSheetChanged: expectedProduct.name !== actualProduct.name
      || expectedProduct.headerRow !== actualProduct.headerRow
      || expectedProduct.columnCount !== actualProduct.columnCount,
    groupSheetChanged: expectedGroup.name !== actualGroup.name
      || expectedGroup.headerRow !== actualGroup.headerRow
      || expectedGroup.columnCount !== actualGroup.columnCount
      || !groupHeaderSetEqual
      || (groupHeaderSetEqual && JSON.stringify(expectedGroupHeaders) !== JSON.stringify(actualGroupHeaders)),
    expectedProductHeaders,
    actualProductHeaders,
    expectedGroupHeaders,
    actualGroupHeaders,
  };
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prom_bootstrap_catalog (
      bootstrap_id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      master_template_path TEXT NOT NULL,
      binary_sha256 TEXT NOT NULL,
      master_binary_sha256 TEXT NOT NULL,
      schema_fingerprint TEXT NOT NULL,
      structural_schema_fingerprint TEXT NOT NULL,
      template_json TEXT NOT NULL,
      column_policy_json TEXT NOT NULL,
      characteristic_mapping_json TEXT NOT NULL,
      group_mapping_json TEXT NOT NULL,
      collision_report_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prom_product_registry (
      registry_id INTEGER PRIMARY KEY AUTOINCREMENT,
      bootstrap_id TEXT NOT NULL,
      product_code TEXT,
      row_number INTEGER,
      unique_id TEXT,
      product_id TEXT,
      source_url TEXT,
      title_ru TEXT,
      title_ua TEXT,
      group_json TEXT NOT NULL,
      image_urls_json TEXT NOT NULL,
      status TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (bootstrap_id) REFERENCES prom_bootstrap_catalog(bootstrap_id)
    );

    CREATE INDEX IF NOT EXISTS prom_product_registry_bootstrap_code
      ON prom_product_registry (bootstrap_id, product_code);

    CREATE UNIQUE INDEX IF NOT EXISTS prom_product_registry_reserved_code
      ON prom_product_registry (bootstrap_id, product_code)
      WHERE product_code IS NOT NULL AND status = 'RESERVED_FOR_IMPORT';
  `);
  migrateBootstrapSchema(db);
}

function tableColumns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
}

function addColumnIfMissing(db, columns, name, definition) {
  if (columns.has(name)) return;
  db.exec(`ALTER TABLE prom_bootstrap_catalog ADD COLUMN ${name} ${definition}`);
  columns.add(name);
}

function migrateBootstrapSchema(db) {
  const columns = tableColumns(db, 'prom_bootstrap_catalog');
  db.exec('BEGIN IMMEDIATE');
  try {
    addColumnIfMissing(db, columns, 'binary_sha256', 'TEXT');
    addColumnIfMissing(db, columns, 'master_binary_sha256', 'TEXT');
    addColumnIfMissing(db, columns, 'schema_fingerprint', 'TEXT');
    addColumnIfMissing(db, columns, 'structural_schema_fingerprint', 'TEXT');
    if (columns.has('source_sha256')) {
      db.exec('UPDATE prom_bootstrap_catalog SET binary_sha256 = source_sha256 WHERE binary_sha256 IS NULL');
    }
    if (columns.has('master_template_sha256')) {
      db.exec('UPDATE prom_bootstrap_catalog SET master_binary_sha256 = master_template_sha256 WHERE master_binary_sha256 IS NULL');
    }
    if (columns.has('template_fingerprint')) {
      db.exec('UPDATE prom_bootstrap_catalog SET schema_fingerprint = template_fingerprint WHERE schema_fingerprint IS NULL');
    }
    const rows = db.prepare('SELECT bootstrap_id, template_json, structural_schema_fingerprint FROM prom_bootstrap_catalog').all();
    const update = db.prepare('UPDATE prom_bootstrap_catalog SET structural_schema_fingerprint = ? WHERE bootstrap_id = ?');
    for (const row of rows) {
      if (!row.structural_schema_fingerprint) {
        const template = parseJson(row.template_json, null);
        if (!template) throw new Error(`Cannot migrate bootstrap ${row.bootstrap_id} without persisted template metadata`);
        update.run(templateStructureFingerprint(template), row.bootstrap_id);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function latestBootstrapRow(db) {
  return db.prepare(`
    SELECT * FROM prom_bootstrap_catalog
    WHERE status = 'BOOTSTRAPPED'
    ORDER BY updated_at DESC
    LIMIT 1
  `).get() ?? null;
}

function bootstrapRow(db, bootstrapId) {
  return db.prepare('SELECT * FROM prom_bootstrap_catalog WHERE bootstrap_id = ?').get(bootstrapId) ?? null;
}

function resolveBootstrapId(db, bootstrapId) {
  const row = bootstrapId ? bootstrapRow(db, bootstrapId) : latestBootstrapRow(db);
  if (!row) throw new Error(bootstrapId ? `Unknown Prom bootstrap: ${bootstrapId}` : 'No bootstrapped Prom catalog is available');
  return row;
}

function storedRegistryRows(db, bootstrapId) {
  return db.prepare(`
    SELECT registry_id, bootstrap_id, product_code, row_number, unique_id, product_id,
      source_url, title_ru, title_ua, group_json, image_urls_json, status,
      provenance_json, created_at, updated_at
    FROM prom_product_registry
    WHERE bootstrap_id = ?
    ORDER BY CASE WHEN row_number IS NULL THEN 1 ELSE 0 END, row_number, registry_id
  `).all(bootstrapId);
}

function rowToRegistryEntry(row) {
  const group = parseJson(row.group_json, {});
  return {
    registryId: row.registry_id,
    code: row.product_code,
    normalizedIdentifier: row.product_code ? stripOuterU(row.product_code).trim().toLocaleUpperCase('en-US') : '',
    rowNumber: row.row_number,
    uniqueId: row.unique_id,
    productId: row.product_id,
    supplier: row.source_url ? { name: 'ug-opt', sourceUrl: row.source_url } : null,
    sourceUrl: row.source_url,
    titles: { ru: row.title_ru, ua: row.title_ua },
    group,
    imageUrls: parseJson(row.image_urls_json, []),
    status: row.status,
    provenance: parseJson(row.provenance_json, {}),
  };
}

function registryFromRows(rowValues, bootstrapRowValue) {
  const rows = rowValues.map(rowToRegistryEntry);
  const entriesByCode = new Map();
  for (const entry of rows) {
    if (!entry.code) continue;
    const entries = entriesByCode.get(entry.code) ?? [];
    entries.push(entry);
    entriesByCode.set(entry.code, entries);
  }
  const detectedCollisions = [...entriesByCode.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([code, entries]) => ({
      code,
      rows: entries.map((entry) => entry.rowNumber),
      titles: entries.map((entry) => ({ ru: entry.titles.ru, ua: entry.titles.ua })),
      productIds: entries.map((entry) => entry.productId),
      urls: entries.map((entry) => entry.sourceUrl),
      categories: entries.map((entry) => clone(entry.group)),
      kind: 'CONFLICTING',
      identical: false,
      conflicting: true,
    }));
  const persistedCollisions = parseJson(bootstrapRowValue.collision_report_json, null);
  const collisions = Array.isArray(persistedCollisions) ? persistedCollisions : detectedCollisions;
  const byCode = Object.fromEntries([...entriesByCode.entries()].map(([code, entries]) => [code, entries.length === 1 ? entries[0] : entries]));
  const codeRows = rows.filter((entry) => entry.code);
  return {
    status: 'READY',
    source: {
      inputPath: bootstrapRowValue.source_path,
      productSheetName: PROM_CATALOG_SHEET_NAMES.products,
      groupSheetName: PROM_CATALOG_SHEET_NAMES.groups,
      productHeaderCount: parseJson(bootstrapRowValue.template_json, {}).productSheet?.columnCount ?? 0,
      groupHeaderCount: parseJson(bootstrapRowValue.template_json, {}).groupSheet?.columnCount ?? 0,
      characteristicCapacity: parseJson(bootstrapRowValue.characteristic_mapping_json, {}).capacity ?? 0,
    },
    columns: {
      productHeaders: parseJson(bootstrapRowValue.template_json, {}).productSheet?.headers ?? [],
      groupHeaders: parseJson(bootstrapRowValue.template_json, {}).groupSheet?.headers ?? [],
    },
    rows,
    groups: parseJson(bootstrapRowValue.group_mapping_json, {}).rows ?? [],
    byCode,
    collisions,
    summary: {
      physicalProductRows: rows.filter((entry) => entry.rowNumber !== null).length,
      rowsWithCode: codeRows.length,
      rowsWithoutCode: rows.filter((entry) => !entry.code).length,
      uniqueCodes: entriesByCode.size,
      collisionCodes: collisions.length,
      collisionRows: collisions.reduce((total, item) => total + item.rows.length, 0),
      eligibleRegistrySize: entriesByCode.size - collisions.length,
    },
    provenance: { source: 'Persisted Prom bootstrap registry', readOnly: true },
  };
}

function persistedBootstrap(row, registry) {
  return {
    status: row.status,
    bootstrapId: row.bootstrap_id,
    sourcePath: row.source_path,
    masterTemplatePath: row.master_template_path,
    binarySha256: row.binary_sha256,
    masterBinarySha256: row.master_binary_sha256,
    legacySchemaFingerprint: row.schema_fingerprint,
    schemaFingerprintV1: row.schema_fingerprint,
    structuralSchemaFingerprint: row.structural_schema_fingerprint,
    schemaFingerprintV2: row.structural_schema_fingerprint,
    schemaFingerprint: row.schema_fingerprint,
    templateFingerprint: row.schema_fingerprint,
    template: parseJson(row.template_json, null),
    columnPolicy: parseJson(row.column_policy_json, []),
    characteristicMapping: parseJson(row.characteristic_mapping_json, null),
    groupMapping: parseJson(row.group_mapping_json, null),
    collisionReports: parseJson(row.collision_report_json, []),
    registry,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function openDatabase(dbPath) {
  const absolutePath = resolveProjectPath(dbPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const db = new DatabaseSync(absolutePath);
  createSchema(db);
  return { db, absolutePath };
}

export function resolvePromBootstrapPaths(options = {}) {
  if (!isRecord(options)) throw new TypeError('options must be an object');
  return {
    dbPath: resolveProjectPath(options.dbPath ?? DEFAULT_PROM_BOOTSTRAP_CONFIG.dbPath),
    masterTemplatePath: resolveProjectPath(options.masterTemplatePath ?? DEFAULT_PROM_BOOTSTRAP_CONFIG.masterTemplatePath),
  };
}

export async function bootstrapPromCatalog(input) {
  if (!isRecord(input)) throw new TypeError('bootstrap input must be an object');
  const sourceInput = input.sourcePath ?? (input.fromApprovedMaster ? input.masterTemplatePath : null);
  if (!text(sourceInput)) throw new TypeError('sourcePath is required');
  const sourcePath = resolveProjectPath(sourceInput);
  const { dbPath, masterTemplatePath } = resolvePromBootstrapPaths(input);
  if (!input.fromApprovedMaster) ensureSourcePath(sourcePath, masterTemplatePath);
  const sourceBytes = await fs.readFile(sourcePath);
  const binarySha256 = hashBytes(sourceBytes);
  const template = await inspectPromCatalogTemplate(sourcePath, input.templateOptions ?? {});
  const registry = await buildExistingPromCatalogRegistry(sourcePath, input.templateOptions ?? {});
  const legacySchemaFingerprint = templateFingerprint(template);
  const structuralSchemaFingerprint = templateStructureFingerprint(template);
  const { classifyPromColumns } = await import('./prom-delta-export.mjs');
  const columnPolicy = classifyPromColumns(template.productSheet.headers);
  const characteristicMappingValue = characteristicMapping(template);
  const groupMappingValue = groupMapping(template, registry);
  const { db } = await openDatabase(dbPath);
  try {
    const existingApproved = latestBootstrapRow(db);
    const approvedTemplate = existingApproved ? parseJson(existingApproved.template_json, {}) : null;
    const approvedStructuralFingerprint = existingApproved?.structural_schema_fingerprint
      ?? (approvedTemplate ? templateStructureFingerprint(approvedTemplate) : null);
    if (existingApproved && approvedStructuralFingerprint !== structuralSchemaFingerprint) {
      return clone({
        status: PROM_BOOTSTRAP_STATUSES.TEMPLATE_SCHEMA_CHANGED,
        bootstrapId: existingApproved.bootstrap_id,
        expectedSchemaFingerprint: existingApproved.schema_fingerprint,
        actualSchemaFingerprint: legacySchemaFingerprint,
        expectedStructuralSchemaFingerprint: approvedStructuralFingerprint,
        actualStructuralSchemaFingerprint: structuralSchemaFingerprint,
        structuralDiff: schemaDiff(approvedTemplate, template),
        expectedBinarySha256: existingApproved.binary_sha256,
        actualBinarySha256: binarySha256,
        masterTemplatePath: existingApproved.master_template_path,
        masterReplaced: false,
      });
    }
    if (existingApproved && existingApproved.binary_sha256 !== binarySha256) {
      return clone({
        status: PROM_BOOTSTRAP_STATUSES.SOURCE_CHANGED_REQUIRES_RECONCILIATION,
        bootstrapId: existingApproved.bootstrap_id,
        expectedSchemaFingerprint: existingApproved.schema_fingerprint,
        actualSchemaFingerprint: legacySchemaFingerprint,
        expectedStructuralSchemaFingerprint: approvedStructuralFingerprint,
        actualStructuralSchemaFingerprint: structuralSchemaFingerprint,
        expectedBinarySha256: existingApproved.binary_sha256,
        actualBinarySha256: binarySha256,
        masterTemplatePath: existingApproved.master_template_path,
        masterReplaced: false,
      });
    }
    const existing = db.prepare('SELECT * FROM prom_bootstrap_catalog WHERE binary_sha256 = ? AND schema_fingerprint = ? AND structural_schema_fingerprint = ?').get(binarySha256, legacySchemaFingerprint, structuralSchemaFingerprint);
    if (existing) {
      try {
        const masterBytes = await fs.readFile(masterTemplatePath);
        if (hashBytes(masterBytes) !== existing.master_binary_sha256) throw new Error('persisted Prom master template hash does not match the bootstrap');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (!input.fromApprovedMaster) {
          await fs.mkdir(path.dirname(masterTemplatePath), { recursive: true });
          await fs.copyFile(sourcePath, masterTemplatePath);
        }
      }
      const persisted = persistedBootstrap(existing, registryFromRows(storedRegistryRows(db, existing.bootstrap_id), existing));
      return clone({ ...persisted, reused: true });
    }

    if (!input.fromApprovedMaster) {
      await fs.mkdir(path.dirname(masterTemplatePath), { recursive: true });
      await fs.copyFile(sourcePath, masterTemplatePath);
    }
    const masterBinarySha256 = hashBytes(await fs.readFile(masterTemplatePath));
    const bootstrapId = `prom-bootstrap-${binarySha256.slice(0, 24)}`;
    const timestamp = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        INSERT INTO prom_bootstrap_catalog (
          bootstrap_id, source_path, master_template_path, binary_sha256,
          master_binary_sha256, schema_fingerprint, structural_schema_fingerprint, template_json,
          column_policy_json, characteristic_mapping_json, group_mapping_json,
          collision_report_json,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BOOTSTRAPPED', ?, ?)
      `).run(
        bootstrapId,
        sourcePath,
        masterTemplatePath,
        binarySha256,
        masterBinarySha256,
        legacySchemaFingerprint,
        structuralSchemaFingerprint,
        json(template),
        json(columnPolicy),
        json(characteristicMappingValue),
        json(groupMappingValue),
        json(registry.collisions, []),
        timestamp,
        timestamp,
      );
      const insert = db.prepare(`
        INSERT INTO prom_product_registry (
          bootstrap_id, product_code, row_number, unique_id, product_id,
          source_url, title_ru, title_ua, group_json, image_urls_json,
          status, provenance_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const entry of registry.rows) {
        insert.run(
          bootstrapId,
          entry.code,
          entry.rowNumber,
          entry.uniqueId,
          entry.productId,
          entry.sourceUrl,
          entry.titles.ru,
          entry.titles.ua,
          json(entry.group, {}),
          json(entry.imageUrls, []),
          PROM_REGISTRY_STATES.EXISTING_IN_PROM,
          json({ source: 'Prom export workbook', sourcePath, sourceRow: entry.rowNumber }),
          timestamp,
          timestamp,
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const stored = db.prepare('SELECT * FROM prom_bootstrap_catalog WHERE bootstrap_id = ?').get(bootstrapId);
    const persisted = persistedBootstrap(stored, registryFromRows(storedRegistryRows(db, bootstrapId), stored));
    return clone({
      ...persisted,
      reused: false,
      registrySummary: registry.summary,
    });
  } finally {
    db.close();
  }
}

export async function bootstrapPromCatalogFromMaster(input = {}) {
  if (!isRecord(input)) throw new TypeError('master bootstrap input must be an object');
  const masterTemplatePath = input.masterTemplatePath ?? DEFAULT_PROM_BOOTSTRAP_CONFIG.masterTemplatePath;
  return bootstrapPromCatalog({
    ...input,
    sourcePath: masterTemplatePath,
    masterTemplatePath,
    fromApprovedMaster: true,
  });
}

export async function loadPromBootstrap(options = {}) {
  const { db, absolutePath } = await openDatabase(options.dbPath ?? DEFAULT_PROM_BOOTSTRAP_CONFIG.dbPath);
  try {
    const row = resolveBootstrapId(db, options.bootstrapId);
    const registry = registryFromRows(storedRegistryRows(db, row.bootstrap_id), row);
    return clone({ ...persistedBootstrap(row, registry), dbPath: absolutePath });
  } finally {
    db.close();
  }
}

export async function getPromProductRegistry(options = {}) {
  const { db } = await openDatabase(options.dbPath ?? DEFAULT_PROM_BOOTSTRAP_CONFIG.dbPath);
  try {
    const row = resolveBootstrapId(db, options.bootstrapId);
    return clone(registryFromRows(storedRegistryRows(db, row.bootstrap_id), row));
  } finally {
    db.close();
  }
}

export async function reconcilePromCatalog(input) {
  if (!isRecord(input)) throw new TypeError('reconciliation input must be an object');
  const sourceInput = input.sourcePath ?? input.freshSourcePath;
  if (!text(sourceInput)) throw new TypeError('sourcePath is required');
  const sourcePath = resolveProjectPath(sourceInput);
  const [freshTemplate, freshRegistry, sourceBytes] = await Promise.all([
    inspectPromCatalogTemplate(sourcePath, input.templateOptions ?? {}),
    buildExistingPromCatalogRegistry(sourcePath, input.templateOptions ?? {}),
    fs.readFile(sourcePath),
  ]);
  const actualSchemaFingerprint = templateFingerprint(freshTemplate);
  const actualStructuralSchemaFingerprint = templateStructureFingerprint(freshTemplate);
  const actualBinarySha256 = hashBytes(sourceBytes);
  const { db } = await openDatabase(input.dbPath ?? DEFAULT_PROM_BOOTSTRAP_CONFIG.dbPath);
  try {
    const stored = resolveBootstrapId(db, input.bootstrapId);
    const persistentRows = storedRegistryRows(db, stored.bootstrap_id).map(rowToRegistryEntry);
    const persistentCodes = new Set(persistentRows.map((row) => row.code).filter(Boolean));
    const freshCodes = new Set(freshRegistry.rows.map((row) => row.code).filter(Boolean));
    const externalProducts = freshRegistry.rows
      .filter((row) => row.code && !persistentCodes.has(row.code))
      .map((row) => ({ code: row.code, rowNumber: row.rowNumber, title: clone(row.titles), sourceUrl: row.sourceUrl }));
    const missingProducts = persistentRows
      .filter((row) => row.code && !freshCodes.has(row.code))
      .map((row) => ({ code: row.code, registryId: row.registryId, status: row.status, rowNumber: row.rowNumber }));
    const storedTemplate = parseJson(stored.template_json, {});
    const expectedStructuralSchemaFingerprint = stored.structural_schema_fingerprint
      ?? templateStructureFingerprint(storedTemplate);
    const schemaChanged = expectedStructuralSchemaFingerprint !== actualStructuralSchemaFingerprint;
    const collisions = clone(freshRegistry.collisions);
    const status = schemaChanged
      ? PROM_RECONCILIATION_STATUSES.TEMPLATE_SCHEMA_CHANGED
      : collisions.length > 0
        ? PROM_RECONCILIATION_STATUSES.COLLISIONS_FOUND
        : externalProducts.length > 0
          ? PROM_RECONCILIATION_STATUSES.EXTERNAL_PRODUCTS_FOUND
          : missingProducts.length > 0
            ? PROM_RECONCILIATION_STATUSES.MISSING_PRODUCTS_FOUND
            : PROM_RECONCILIATION_STATUSES.READY;
    return clone({
      status,
      bootstrapId: stored.bootstrap_id,
      sourcePath,
      schema: {
        legacyExpectedFingerprint: stored.schema_fingerprint,
        legacyActualFingerprint: actualSchemaFingerprint,
        expectedFingerprint: expectedStructuralSchemaFingerprint,
        actualFingerprint: actualStructuralSchemaFingerprint,
        structuralSchemaFingerprint: actualStructuralSchemaFingerprint,
        changed: schemaChanged,
        diff: schemaChanged ? schemaDiff(storedTemplate, freshTemplate) : null,
      },
      binaries: {
        expectedSha256: stored.binary_sha256,
        actualSha256: actualBinarySha256,
        changed: stored.binary_sha256 !== actualBinarySha256,
      },
      externalProducts,
      missingProducts,
      collisions,
      destructiveChangesApplied: false,
      registryUpdated: false,
      sourceReadOnly: true,
    });
  } finally {
    db.close();
  }
}

function assertRegistryState(status) {
  if (!PERSISTED_STATES.has(status)) throw new TypeError(`Unsupported Prom registry state: ${status}`);
}

function payloadValue(payload, key, fallback) {
  return payload[key] === undefined ? fallback : payload[key];
}

export async function reservePromProductCode(input) {
  if (!isRecord(input)) throw new TypeError('reservation input must be an object');
  const productCode = text(input.productCode);
  if (!productCode) throw new TypeError('productCode is required');
  const { db, absolutePath } = await openDatabase(input.dbPath ?? DEFAULT_PROM_BOOTSTRAP_CONFIG.dbPath);
  try {
    const bootstrap = resolveBootstrapId(db, input.bootstrapId);
    db.exec('BEGIN IMMEDIATE');
    try {
    const existing = db.prepare('SELECT * FROM prom_product_registry WHERE bootstrap_id = ? AND product_code = ? ORDER BY registry_id').all(bootstrap.bootstrap_id, productCode);
    if (existing.length > 1) {
      db.exec('COMMIT');
      return { status: PROM_REGISTRY_STATES.EXISTING_CODE_COLLISION, code: productCode, registryIds: existing.map((row) => row.registry_id), dbPath: absolutePath };
    }
    if (existing.length === 1) {
      const status = existing[0].status === PROM_REGISTRY_STATES.RESERVED_FOR_IMPORT
        ? PROM_REGISTRY_STATES.ALREADY_RESERVED
        : existing[0].status === PROM_REGISTRY_STATES.EXISTING_IN_PROM
          ? PROM_REGISTRY_STATES.ALREADY_EXISTS
          : PROM_REGISTRY_STATES.ALREADY_RESERVED;
      db.exec('COMMIT');
      return { status, code: productCode, registryId: existing[0].registry_id, dbPath: absolutePath };
    }
    const timestamp = now();
    const payload = isRecord(input.payload) ? clone(input.payload) : {};
    db.prepare(`
      INSERT INTO prom_product_registry (
        bootstrap_id, product_code, row_number, unique_id, product_id,
        source_url, title_ru, title_ua, group_json, image_urls_json,
        status, provenance_json, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bootstrap.bootstrap_id,
      productCode,
      text(payload.uniqueId) || null,
      text(payload.productId) || null,
      text(payload.sourceUrl) || null,
      text(payload.titleRu) || null,
      text(payload.titleUa) || null,
      json(payload.group, {}),
      json(payload.imageUrls, []),
      PROM_REGISTRY_STATES.RESERVED_FOR_IMPORT,
      json({ productKey: text(input.productKey) || null, batchId: text(input.batchId) || null, payload }),
      timestamp,
      timestamp,
    );
    const inserted = db.prepare('SELECT registry_id FROM prom_product_registry WHERE bootstrap_id = ? AND product_code = ? AND status = ?').get(bootstrap.bootstrap_id, productCode, PROM_REGISTRY_STATES.RESERVED_FOR_IMPORT);
    db.exec('COMMIT');
    return { status: PROM_REGISTRY_STATES.RESERVED_FOR_IMPORT, code: productCode, registryId: inserted.registry_id, bootstrapId: bootstrap.bootstrap_id, dbPath: absolutePath };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

function selectedRegistryRows(db, bootstrapId, input) {
  const registryIds = Array.isArray(input.registryIds) ? input.registryIds : [];
  const productCodes = Array.isArray(input.productCodes) ? input.productCodes.map(text).filter(Boolean) : [];
  const batchId = text(input.batchId);
  if (registryIds.length === 0 && productCodes.length === 0 && !batchId) {
    throw new TypeError('registryIds, productCodes, or batchId is required');
  }
  const rows = db.prepare('SELECT * FROM prom_product_registry WHERE bootstrap_id = ? ORDER BY registry_id').all(bootstrapId);
  const idSet = new Set(registryIds);
  const codeSet = new Set(productCodes);
  const matches = rows.filter((row) => {
    const provenance = parseJson(row.provenance_json, {});
    return (idSet.size > 0 && idSet.has(row.registry_id))
      || (codeSet.size > 0 && codeSet.has(row.product_code))
      || (batchId && provenance.batchId === batchId);
  });
  if (matches.length === 0) throw new Error('no registry rows matched confirmation selection');
  if ([...idSet].some((registryId) => !matches.some((row) => row.registry_id === registryId))) {
    throw new Error('confirmation selection contains an unknown registry row');
  }
  if ([...codeSet].some((code) => !matches.some((row) => row.product_code === code))) {
    throw new Error('confirmation selection contains an unknown product code');
  }
  if (codeSet.size > 0 && matches.some((row) => codeSet.has(row.product_code)
    && rows.filter((candidate) => candidate.product_code === row.product_code).length > 1)) {
    throw new Error('confirmation requires registryIds for a colliding product code');
  }
  return matches;
}

async function confirmPromImportedSelection(input, selection) {
  if (!isRecord(input)) throw new TypeError('confirmation input must be an object');
  const { db, absolutePath } = await openDatabase(input.dbPath ?? DEFAULT_PROM_BOOTSTRAP_CONFIG.dbPath);
  try {
    const bootstrap = resolveBootstrapId(db, input.bootstrapId);
    db.exec('BEGIN IMMEDIATE');
    try {
      const rows = selectedRegistryRows(db, bootstrap.bootstrap_id, selection);
      const notReserved = rows.filter((row) => row.status !== PROM_REGISTRY_STATES.RESERVED_FOR_IMPORT);
      if (notReserved.length > 0) {
        throw new Error(`only RESERVED_FOR_IMPORT rows can be confirmed: ${notReserved.map((row) => row.product_code).join(', ')}`);
      }
      const timestamp = now();
      const update = db.prepare(`
        UPDATE prom_product_registry
        SET status = ?, updated_at = ?
        WHERE bootstrap_id = ? AND registry_id = ?
      `);
      for (const row of rows) update.run(PROM_REGISTRY_STATES.CONFIRMED_IN_PROM, timestamp, bootstrap.bootstrap_id, row.registry_id);
      db.exec('COMMIT');
      return {
        status: PROM_REGISTRY_STATES.CONFIRMED_IN_PROM,
        confirmedCount: rows.length,
        registryIds: rows.map((row) => row.registry_id),
        codes: rows.map((row) => row.product_code),
        bootstrapId: bootstrap.bootstrap_id,
        dbPath: absolutePath,
      };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function confirmPromImportedProducts(input) {
  if (!isRecord(input)) throw new TypeError('confirmation input must be an object');
  return confirmPromImportedSelection(input, {
    registryIds: input.registryIds,
    productCodes: input.productCodes,
  });
}

export async function confirmPromImportedBatch(input) {
  if (!isRecord(input)) throw new TypeError('batch confirmation input must be an object');
  if (!text(input.batchId)) throw new TypeError('batchId is required');
  return confirmPromImportedSelection(input, { batchId: input.batchId });
}

export async function updatePromProductRegistryState(input) {
  if (!isRecord(input)) throw new TypeError('registry update input must be an object');
  assertRegistryState(input.status);
  const { db, absolutePath } = await openDatabase(input.dbPath ?? DEFAULT_PROM_BOOTSTRAP_CONFIG.dbPath);
  try {
    const bootstrap = resolveBootstrapId(db, input.bootstrapId);
    const productCode = text(input.productCode);
    const rows = input.registryId !== undefined
      ? db.prepare('SELECT * FROM prom_product_registry WHERE bootstrap_id = ? AND registry_id = ?').all(bootstrap.bootstrap_id, input.registryId)
      : db.prepare('SELECT * FROM prom_product_registry WHERE bootstrap_id = ? AND product_code = ? ORDER BY registry_id').all(bootstrap.bootstrap_id, productCode);
    if (rows.length > 1) throw new Error('registry state update requires registryId for a colliding product code');
    const payload = isRecord(input.payload) ? clone(input.payload) : {};
    if (rows.length === 0) {
      if (input.status !== PROM_REGISTRY_STATES.RESERVED_FOR_IMPORT || !productCode) throw new Error('registry row does not exist');
      const timestamp = now();
      db.prepare(`
        INSERT INTO prom_product_registry (
          bootstrap_id, product_code, row_number, unique_id, product_id,
          source_url, title_ru, title_ua, group_json, image_urls_json,
          status, provenance_json, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        bootstrap.bootstrap_id,
        productCode,
        text(payload.uniqueId) || null,
        text(payload.productId) || null,
        text(payload.sourceUrl) || null,
        text(payload.titleRu) || null,
        text(payload.titleUa) || null,
        json(payload.group, {}),
        json(payload.imageUrls, []),
        input.status,
        json({ payload }),
        timestamp,
        timestamp,
      );
      return { status: input.status, code: productCode, bootstrapId: bootstrap.bootstrap_id, dbPath: absolutePath };
    }
    const current = rows[0];
    const provenance = { ...parseJson(current.provenance_json, {}), ...payload.provenance, lastUpdate: payload };
    const timestamp = now();
    db.prepare(`
      UPDATE prom_product_registry SET
        unique_id = ?, product_id = ?, source_url = ?, title_ru = ?, title_ua = ?,
        group_json = ?, image_urls_json = ?, status = ?, provenance_json = ?, updated_at = ?
      WHERE registry_id = ?
    `).run(
      payloadValue(payload, 'uniqueId', current.unique_id),
      payloadValue(payload, 'productId', current.product_id),
      payloadValue(payload, 'sourceUrl', current.source_url),
      payloadValue(payload, 'titleRu', current.title_ru),
      payloadValue(payload, 'titleUa', current.title_ua),
      json(payloadValue(payload, 'group', parseJson(current.group_json, {})), {}),
      json(payloadValue(payload, 'imageUrls', parseJson(current.image_urls_json, [])), []),
      input.status,
      json(provenance),
      timestamp,
      current.registry_id,
    );
    return { status: input.status, code: current.product_code, registryId: current.registry_id, bootstrapId: bootstrap.bootstrap_id, dbPath: absolutePath };
  } finally {
    db.close();
  }
}
