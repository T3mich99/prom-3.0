import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CANONICAL_FIELDS, columnLetter } from './schema-mapper.mjs';
import { loadXlsx, saveXlsx } from './xlsx-engine.mjs';

export class AdaptiveWriterError extends Error {
  constructor(message, code = 'ADAPTIVE_WRITER_ERROR', details = undefined) {
    super(message);
    this.name = 'AdaptiveWriterError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function cellAddress(rowNumber, columnIndex) {
  return `${columnLetter(columnIndex)}${rowNumber}`;
}

function isPrimitive(value) {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(actual, expected) {
  if (expected === null || expected === undefined) return actual === null || actual === undefined || actual === '';
  return Object.is(actual, expected) || String(actual) === String(expected);
}

async function sha256(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function assertXlsx(filePath, label) {
  if (path.extname(filePath).toLocaleLowerCase('en-US') !== '.xlsx') throw new AdaptiveWriterError(`${label} must have a .xlsx extension`, 'UNSUPPORTED_EXTENSION');
}

function mergedCell(sheet, rowNumber, columnIndex) {
  return sheet.cellInsideMergedRange(rowNumber, columnIndex);
}

function targetFormula(sheet, columnIndex, usedRange) {
  const usedRowIndex = Number.isSafeInteger(usedRange?.rowIndex) ? usedRange.rowIndex : 0;
  const usedRowCount = Number.isSafeInteger(usedRange?.rowCount) ? usedRange.rowCount : 0;
  if (!usedRowCount) return null;
  const formulas = sheet.readFormulasByColumn(usedRowIndex, columnIndex, usedRowCount);
  for (let index = 0; index < formulas.length; index += 1) {
    if (String(formulas[index] ?? '').trim()) return { rowNumber: usedRowIndex + index + 1, formula: formulas[index] };
  }
  return null;
}

function pathIdentity(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

async function sameInputOutputPath(sourcePath, targetPath) {
  if (pathIdentity(sourcePath) === pathIdentity(targetPath)) return true;
  const [sourceRealPath, targetRealPath] = await Promise.all([
    fs.realpath(sourcePath).catch(() => null),
    fs.realpath(targetPath).catch(() => null),
  ]);
  return sourceRealPath !== null && targetRealPath !== null && pathIdentity(sourceRealPath) === pathIdentity(targetRealPath);
}

function assertRows(rows) {
  if (!Array.isArray(rows)) throw new AdaptiveWriterError('rows must be an array', 'INVALID_ROWS');
  for (const [index, row] of rows.entries()) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new AdaptiveWriterError(`row ${index} must be an object`, 'INVALID_ROW');
    for (const [field, value] of Object.entries(row)) {
      if (!CANONICAL_FIELDS.includes(field)) throw new AdaptiveWriterError(`Unknown row-record key: ${field}`, 'UNKNOWN_ROW_FIELD');
      if (!isPrimitive(value) && value !== undefined) throw new AdaptiveWriterError(`Unsupported value type for ${field}`, 'INVALID_ROW_VALUE');
    }
  }
}

function validateCharacteristicPlans(characteristicPlans, mapping, rows) {
  if (characteristicPlans === undefined) return undefined;
  if (!Array.isArray(characteristicPlans)) throw new AdaptiveWriterError('characteristicPlans must be an array', 'INVALID_CHARACTERISTIC_PLANS');
  if (characteristicPlans.length !== rows.length) {
    throw new AdaptiveWriterError('rows and characteristicPlans must have the same length', 'CHARACTERISTIC_ROWS_MISMATCH', {
      rowCount: rows.length,
      characteristicPlanCount: characteristicPlans.length,
    });
  }
  if (!Array.isArray(mapping.dynamicCharacteristicColumns)) {
    throw new AdaptiveWriterError('Mapping does not expose dynamic characteristic columns', 'CHARACTERISTIC_MAPPING_UNSUPPORTED');
  }
  const dynamicColumns = new Map();
  for (const column of mapping.dynamicCharacteristicColumns) {
    if (!isRecord(column) || !Number.isSafeInteger(column.columnIndex) || column.columnIndex < 0) {
      throw new AdaptiveWriterError('Mapping contains an invalid dynamic characteristic column', 'CHARACTERISTIC_MAPPING_INVALID');
    }
    if (dynamicColumns.has(column.columnIndex)) {
      throw new AdaptiveWriterError(`Dynamic target column ${column.columnIndex} is duplicated`, 'CHARACTERISTIC_TARGET_CONFLICT');
    }
    dynamicColumns.set(column.columnIndex, column);
  }
  return characteristicPlans.map((plan, rowIndex) => {
    if (!isRecord(plan)) throw new AdaptiveWriterError(`characteristic plan ${rowIndex} must be an object`, 'INVALID_CHARACTERISTIC_PLAN');
    if (plan.status !== 'SAFE') throw new AdaptiveWriterError(`characteristic plan ${rowIndex} is not SAFE`, 'CHARACTERISTIC_PLAN_NOT_SAFE', { rowIndex, status: plan.status });
    if (plan.unitHandling !== 'leave-unwritten') throw new AdaptiveWriterError(`characteristic plan ${rowIndex} must leave unit columns unwritten`, 'INVALID_CHARACTERISTIC_PLAN');
    if (!Array.isArray(plan.writes)) throw new AdaptiveWriterError(`characteristic plan ${rowIndex}.writes must be an array`, 'INVALID_CHARACTERISTIC_PLAN');
    if (Array.isArray(plan.unresolvedCharacteristics) && plan.unresolvedCharacteristics.length) {
      throw new AdaptiveWriterError(`characteristic plan ${rowIndex} contains unresolved characteristics`, 'CHARACTERISTIC_PLAN_NOT_SAFE', { rowIndex });
    }
    const targetColumns = new Set();
    const rolesByCharacteristic = new Map();
    let previousCharacteristicIndex = -1;
    for (const [writeIndex, write] of plan.writes.entries()) {
      if (!isRecord(write)) throw new AdaptiveWriterError(`characteristic plan ${rowIndex} write ${writeIndex} must be an object`, 'INVALID_CHARACTERISTIC_PLAN');
      if (!Number.isSafeInteger(write.characteristicIndex) || write.characteristicIndex < 0) throw new AdaptiveWriterError('Characteristic index must be a non-negative integer', 'INVALID_CHARACTERISTIC_PLAN');
      if (!['name', 'value'].includes(write.role)) throw new AdaptiveWriterError('Characteristic write role must be name or value', 'INVALID_CHARACTERISTIC_PLAN');
      if (typeof write.value !== 'string') throw new AdaptiveWriterError('Characteristic write value must be a string', 'INVALID_CHARACTERISTIC_PLAN');
      if (write.characteristicIndex < previousCharacteristicIndex) throw new AdaptiveWriterError('Characteristic writes must preserve artifact order', 'INVALID_CHARACTERISTIC_PLAN');
      previousCharacteristicIndex = write.characteristicIndex;
      const target = dynamicColumns.get(write.columnIndex);
      if (!target) throw new AdaptiveWriterError(`Characteristic target column ${write.columnIndex} is not a detected dynamic column`, 'CHARACTERISTIC_TARGET_UNMAPPED');
      if (write.columnLetter !== columnLetter(write.columnIndex)) throw new AdaptiveWriterError('Characteristic target column letter does not match column index', 'INVALID_CHARACTERISTIC_PLAN');
      if (write.originalHeader !== target.originalHeader) throw new AdaptiveWriterError('Characteristic target header does not match the mapping', 'CHARACTERISTIC_TARGET_HEADER_MISMATCH');
      if (targetColumns.has(write.columnIndex)) throw new AdaptiveWriterError(`Characteristic target column ${write.columnLetter} is written more than once`, 'CHARACTERISTIC_TARGET_CONFLICT');
      targetColumns.add(write.columnIndex);
      const roles = rolesByCharacteristic.get(write.characteristicIndex) ?? new Set();
      if (roles.has(write.role)) throw new AdaptiveWriterError('A characteristic role is written more than once', 'CHARACTERISTIC_TARGET_CONFLICT');
      roles.add(write.role);
      rolesByCharacteristic.set(write.characteristicIndex, roles);
    }
    for (const roles of rolesByCharacteristic.values()) {
      if (roles.size !== 2 || !roles.has('name') || !roles.has('value')) {
        throw new AdaptiveWriterError('Each characteristic must have exactly one name and one value write', 'INVALID_CHARACTERISTIC_PLAN');
      }
    }
    return plan;
  });
}

function mappingByField(mapping) {
  return new Map((mapping.mappings ?? []).map((item) => [item.canonicalField, item]));
}

function assertMapping(mapping) {
  if (!mapping || mapping.status !== 'SAFE') throw new AdaptiveWriterError('Writer requires a SAFE mapping', 'MAPPING_NOT_SAFE');
  if (!mapping.sheet || !Number.isSafeInteger(mapping.headerRow) || mapping.headerRow < 1) throw new AdaptiveWriterError('Mapping has no resolved sheet/header row', 'MAPPING_INCOMPLETE');
}

async function validateOutput({ inputPath, outputPath, mapping, rows, characteristicPlans, startRow, originalSheetNames, inputHash }) {
  const stat = await fs.stat(outputPath).catch(() => null);
  if (!stat?.isFile() || stat.size === 0) throw new AdaptiveWriterError('Output workbook was not created', 'OUTPUT_MISSING');
  const outputWorkbook = await loadXlsx(outputPath);
  const outputSheetNames = outputWorkbook.worksheets.map((sheet) => sheet.name);
  if (JSON.stringify(outputSheetNames) !== JSON.stringify(originalSheetNames)) throw new AdaptiveWriterError('Worksheet names/order changed during write', 'WORKSHEETS_CHANGED');
  const sheet = outputWorkbook.getWorksheet(mapping.sheet.name);
  const mappingEntries = mappingByField(mapping);
  const headerColumns = [
    ...mapping.mappings.map((item) => item.columnIndex),
    ...(mapping.dynamicCharacteristicColumns ?? []).map((item) => item.columnIndex),
  ];
  const headerValues = sheet.readRangeByIndexes(mapping.headerRow - 1, 0, 1, Math.max(...headerColumns, 0) + 1)[0] ?? [];
  for (const item of mapping.mappings) {
    if (String(headerValues[item.columnIndex] ?? '') !== String(item.originalHeader ?? '')) throw new AdaptiveWriterError(`Header changed at ${item.columnLetter}`, 'HEADER_CHANGED');
  }
  for (const column of mapping.dynamicCharacteristicColumns ?? []) {
    if (String(headerValues[column.columnIndex] ?? '') !== String(column.originalHeader ?? '')) throw new AdaptiveWriterError(`Characteristic header changed at ${column.columnLetter}`, 'HEADER_CHANGED');
  }
  for (const [rowIndex, row] of rows.entries()) {
    const physicalRow = startRow + rowIndex;
    for (const [field, value] of Object.entries(row)) {
      if (value === undefined) continue;
      const target = mappingEntries.get(field);
      if (!target) throw new AdaptiveWriterError(`Row field is not mapped: ${field}`, 'ROW_FIELD_UNMAPPED');
      const actual = sheet.readCell(physicalRow - 1, target.columnIndex);
      if (!sameValue(actual, value)) throw new AdaptiveWriterError(`Written value mismatch at ${cellAddress(physicalRow, target.columnIndex)}`, 'OUTPUT_VALUE_MISMATCH');
    }
  }
  for (const [rowIndex, plan] of (characteristicPlans ?? []).entries()) {
    const physicalRow = startRow + rowIndex;
    for (const write of plan.writes) {
      const actual = sheet.readCell(physicalRow - 1, write.columnIndex);
      if (!sameValue(actual, write.value)) throw new AdaptiveWriterError(`Written characteristic mismatch at ${cellAddress(physicalRow, write.columnIndex)}`, 'OUTPUT_VALUE_MISMATCH');
    }
  }
  if (await sha256(inputPath) !== inputHash) throw new AdaptiveWriterError('Input workbook hash changed during write', 'INPUT_MUTATED');
  const result = { outputExists: true, worksheetsPreserved: true, headerPreserved: true, valuesReadable: true, rowCount: rows.length, inputHashUnchanged: true };
  if (characteristicPlans !== undefined) result.characteristicRowCount = characteristicPlans.length;
  return result;
}

export async function writeAdaptiveWorkbook({ inputPath, outputPath, mapping, rows, characteristicPlans, mode = 'appendRows' }) {
  const sourcePath = path.resolve(String(inputPath));
  const targetPath = path.resolve(String(outputPath));
  assertXlsx(sourcePath, 'inputPath');
  assertXlsx(targetPath, 'outputPath');
  if (await sameInputOutputPath(sourcePath, targetPath)) throw new AdaptiveWriterError('outputPath must differ from inputPath', 'SAME_INPUT_OUTPUT');
  assertMapping(mapping);
  if (mode !== 'appendRows') throw new AdaptiveWriterError('Only appendRows mode is supported in v1', 'UNSUPPORTED_WRITE_MODE');
  assertRows(rows);
  const validatedCharacteristicPlans = validateCharacteristicPlans(characteristicPlans, mapping, rows);
  await fs.access(sourcePath);
  const inputHash = await sha256(sourcePath);
  const workbook = await loadXlsx(sourcePath);
  const sheet = workbook.getWorksheet(mapping.sheet.name);
  const originalSheetNames = workbook.worksheets.map((item) => item.name);
  const used = sheet.getUsedRange();
  const usedRowIndex = Number.isSafeInteger(used?.rowIndex) ? used.rowIndex : 0;
  const usedRowCount = Number.isSafeInteger(used?.rowCount) ? used.rowCount : 0;
  const lastUsedPhysicalRow = usedRowIndex + usedRowCount;
  const startRow = Math.max(mapping.headerRow + 1, lastUsedPhysicalRow + 1);
  for (const item of mapping.mappings) {
    const formula = targetFormula(sheet, item.columnIndex, used);
    if (formula) throw new AdaptiveWriterError(`Mapped target ${item.canonicalField} contains a formula at row ${formula.rowNumber}`, 'FORMULA_TARGET_UNSAFE', { canonicalField: item.canonicalField, ...formula });
  }
  for (const write of (validatedCharacteristicPlans ?? []).flatMap((plan) => plan.writes)) {
    const formula = targetFormula(sheet, write.columnIndex, used);
    if (formula) throw new AdaptiveWriterError(`Characteristic target ${write.columnLetter} contains a formula at row ${formula.rowNumber}`, 'FORMULA_TARGET_UNSAFE', { columnIndex: write.columnIndex, columnLetter: write.columnLetter, ...formula });
  }
  const mappingEntries = mappingByField(mapping);
  for (const [rowIndex, row] of rows.entries()) {
    const physicalRow = startRow + rowIndex;
    for (const [field, value] of Object.entries(row)) {
      if (value === undefined) continue;
      const target = mappingEntries.get(field);
      if (!target) throw new AdaptiveWriterError(`Row field is not mapped: ${field}`, 'ROW_FIELD_UNMAPPED');
      const merged = mergedCell(sheet, physicalRow, target.columnIndex);
      if (merged) throw new AdaptiveWriterError(`Write targets a merged cell at ${cellAddress(physicalRow, target.columnIndex)}`, 'MERGED_CELL_CONFLICT', { merged });
      sheet.writeCell(physicalRow - 1, target.columnIndex, value);
    }
  }
  for (const [rowIndex, plan] of (validatedCharacteristicPlans ?? []).entries()) {
    const physicalRow = startRow + rowIndex;
    for (const write of plan.writes) {
      const merged = mergedCell(sheet, physicalRow, write.columnIndex);
      if (merged) throw new AdaptiveWriterError(`Write targets a merged characteristic cell at ${cellAddress(physicalRow, write.columnIndex)}`, 'MERGED_CELL_CONFLICT', { merged });
      sheet.writeCell(physicalRow - 1, write.columnIndex, write.value);
    }
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await saveXlsx(workbook, targetPath);
  const validation = await validateOutput({ inputPath: sourcePath, outputPath: targetPath, mapping, rows, characteristicPlans: validatedCharacteristicPlans, startRow, originalSheetNames, inputHash });
  return { status: 'SAFE', outputPath: targetPath, sheetName: mapping.sheet.name, headerRow: mapping.headerRow, startRow, rowCount: rows.length, validation };
}
