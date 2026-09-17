import { CONTENT_STATUSES, validateContentArtifact } from '../content/content-quality.mjs';
import { columnLetter, normalizeHeader } from './schema-mapper.mjs';

const INPUT_KEYS = new Set(['contentArtifact', 'mapping']);
const OPTION_KEYS = new Set(['policy']);
const DYNAMIC_ROLES = Object.freeze(['name', 'unit', 'value']);
const DYNAMIC_HEADER_RE = /^(назва|название|одиниця виміру|единица измерения|значення|значение) характеристики(?: (\d+))?$/iu;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function parseDynamicHeader(column) {
  const match = normalizeHeader(column.originalHeader).match(DYNAMIC_HEADER_RE);
  if (!match) return null;
  const role = match[1].toLocaleLowerCase('uk-UA') === 'назва'
    || match[1].toLocaleLowerCase('uk-UA') === 'название'
    ? 'name'
    : match[1].toLocaleLowerCase('uk-UA') === 'одиниця виміру'
      || match[1].toLocaleLowerCase('uk-UA') === 'единица измерения'
      ? 'unit'
      : 'value';
  return {
    role,
    slotNumber: match[2] === undefined ? null : Number.parseInt(match[2], 10),
  };
}

function characteristicResult({ status, productKey, quality, diagnostics = [], mappedCharacteristics = [], unresolvedCharacteristics = [], writes = [] }) {
  return {
    status,
    productKey,
    unitHandling: 'leave-unwritten',
    writes,
    mappedCharacteristics,
    unresolvedCharacteristics,
    diagnostics,
    quality,
  };
}

function validateInput(input, options) {
  assertRecord(input, 'characteristic input');
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) throw new TypeError(`Unsupported characteristic input field: ${key}`);
  }
  assertRecord(input.contentArtifact, 'characteristic input.contentArtifact');
  assertRecord(input.mapping, 'characteristic input.mapping');
  assertRecord(options, 'characteristic options');
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.has(key)) throw new TypeError(`Unsupported characteristic option: ${key}`);
  }
}

function mappingStatusResult(mapping, productKey, quality) {
  if (mapping.status === 'NEEDS_MAPPING') {
    return characteristicResult({
      status: 'NEEDS_MAPPING',
      productKey,
      quality,
      diagnostics: [{ code: 'MAPPING_NOT_SAFE', message: 'A SAFE workbook mapping is required for characteristic writes' }],
    });
  }
  if (mapping.status !== 'SAFE') {
    return characteristicResult({
      status: 'UNSUPPORTED',
      productKey,
      quality,
      diagnostics: [{ code: 'MAPPING_UNSUPPORTED', message: 'The workbook mapping does not expose a supported product structure' }],
    });
  }
  return null;
}

function parseSlots(mapping) {
  if (!Array.isArray(mapping.dynamicCharacteristicColumns)) {
    throw new TypeError('mapping.dynamicCharacteristicColumns must be an array');
  }
  const columns = mapping.dynamicCharacteristicColumns.map((column) => {
    assertRecord(column, 'mapping.dynamicCharacteristicColumns entry');
    if (!Number.isSafeInteger(column.columnIndex) || column.columnIndex < 0) {
      throw new TypeError('dynamic characteristic columnIndex must be a non-negative integer');
    }
    if (typeof column.originalHeader !== 'string' || !column.originalHeader.trim()) {
      throw new TypeError('dynamic characteristic originalHeader must be a non-empty string');
    }
    const parsed = parseDynamicHeader(column);
    if (!parsed) throw new TypeError(`Unsupported dynamic characteristic header: ${column.originalHeader}`);
    return { ...column, ...parsed };
  }).sort((left, right) => left.columnIndex - right.columnIndex);

  const indexes = columns.map((column) => column.columnIndex);
  if (new Set(indexes).size !== indexes.length) {
    return { status: 'NEEDS_MAPPING', diagnostics: [{ code: 'DUPLICATE_DYNAMIC_TARGET', message: 'Dynamic characteristic columns contain duplicate physical targets' }] };
  }
  if (columns.length === 0) {
    return { status: 'UNSUPPORTED', diagnostics: [{ code: 'NO_CHARACTERISTIC_COLUMNS', message: 'Workbook exposes no supported dynamic characteristic columns' }] };
  }
  if (columns.some((column, index) => column.columnIndex !== indexes[0] + index)) {
    return { status: 'UNSUPPORTED', diagnostics: [{ code: 'NON_CONTIGUOUS_CHARACTERISTIC_SLOTS', message: 'Dynamic characteristic columns are not a contiguous slot block' }] };
  }

  const hasIndexedHeader = columns.some((column) => column.slotNumber !== null);
  const slots = [];
  if (hasIndexedHeader) {
    const grouped = new Map();
    for (const column of columns) {
      const slotNumber = column.slotNumber ?? 1;
      if (!Number.isSafeInteger(slotNumber) || slotNumber < 1) {
        return { status: 'UNSUPPORTED', diagnostics: [{ code: 'INVALID_CHARACTERISTIC_SLOT', message: 'Dynamic characteristic slot numbers must be positive integers' }] };
      }
      const entries = grouped.get(slotNumber) ?? [];
      entries.push(column);
      grouped.set(slotNumber, entries);
    }
    const slotNumbers = [...grouped.keys()].sort((left, right) => left - right);
    for (let index = 0; index < slotNumbers.length; index += 1) {
      if (slotNumbers[index] !== index + 1) {
        return { status: 'UNSUPPORTED', diagnostics: [{ code: 'NON_CONTIGUOUS_CHARACTERISTIC_SLOTS', message: 'Dynamic characteristic slot numbers are not contiguous' }] };
      }
      const entries = grouped.get(slotNumbers[index]);
      if (entries.length !== 3 || new Set(entries.map((entry) => entry.role)).size !== 3) {
        return { status: 'NEEDS_MAPPING', diagnostics: [{ code: 'AMBIGUOUS_CHARACTERISTIC_SLOT', message: `Dynamic characteristic slot ${slotNumbers[index]} does not contain exactly one name, unit, and value column` }] };
      }
      const ordered = [...entries].sort((left, right) => left.columnIndex - right.columnIndex);
      if (ordered.map((entry) => entry.role).join(',') !== DYNAMIC_ROLES.join(',')) {
        return { status: 'UNSUPPORTED', diagnostics: [{ code: 'INVALID_CHARACTERISTIC_SLOT_ORDER', message: `Dynamic characteristic slot ${slotNumbers[index]} is not ordered name, unit, value` }] };
      }
      slots.push({ slotIndex: index, name: ordered[0], unit: ordered[1], value: ordered[2] });
    }
    return { status: 'SAFE', slots };
  }

  for (let index = 0; index < columns.length; index += 3) {
    const entries = columns.slice(index, index + 3);
    if (entries.length !== 3) {
      return { status: 'UNSUPPORTED', diagnostics: [{ code: 'INCOMPLETE_CHARACTERISTIC_SLOT', message: 'Dynamic characteristic columns end with an incomplete name, unit, value slot' }] };
    }
    if (entries.map((entry) => entry.role).join(',') !== DYNAMIC_ROLES.join(',')) {
      return { status: 'NEEDS_MAPPING', diagnostics: [{ code: 'AMBIGUOUS_CHARACTERISTIC_SLOT', message: 'Repeated dynamic characteristic headers do not form unambiguous name, unit, value slots' }] };
    }
    slots.push({ slotIndex: index / 3, name: entries[0], unit: entries[1], value: entries[2] });
  }
  return { status: 'SAFE', slots };
}

function targetFor(column, role, value, characteristicIndex) {
  return {
    characteristicIndex,
    role,
    value,
    columnIndex: column.columnIndex,
    columnLetter: column.columnLetter ?? columnLetter(column.columnIndex),
    originalHeader: column.originalHeader,
  };
}

function buildWrites(characteristics, slots) {
  const mappedCharacteristics = [];
  const writes = [];
  for (const [characteristicIndex, characteristic] of characteristics.entries()) {
    const slot = slots[characteristicIndex];
    mappedCharacteristics.push({
      characteristicIndex,
      slotIndex: slot.slotIndex,
      name: characteristic.name,
      value: characteristic.value,
      nameColumnIndex: slot.name.columnIndex,
      valueColumnIndex: slot.value.columnIndex,
    });
    writes.push(targetFor(slot.name, 'name', characteristic.name, characteristicIndex));
    writes.push(targetFor(slot.value, 'value', characteristic.value, characteristicIndex));
  }
  return { mappedCharacteristics, writes };
}

export function buildCharacteristicColumnPlan(input, options = {}) {
  validateInput(input, options);
  const { contentArtifact, mapping } = input;
  const quality = validateContentArtifact(contentArtifact, options.policy === undefined ? {} : { policy: options.policy });
  if (quality.status !== CONTENT_STATUSES.READY) {
    return characteristicResult({
      status: quality.status,
      productKey: contentArtifact.productKey,
      quality,
      diagnostics: [{ code: 'CONTENT_NOT_READY', message: 'Characteristic writes require a READY Content Artifact', contentStatus: quality.status }],
    });
  }

  const mappingResult = mappingStatusResult(mapping, contentArtifact.productKey, quality);
  if (mappingResult) return mappingResult;

  const characteristics = contentArtifact.content.characteristics;
  if (!Array.isArray(characteristics)) {
    throw new TypeError('contentArtifact.content.characteristics must be an array after READY validation');
  }
  if (characteristics.length === 0) {
    return characteristicResult({
      status: 'SAFE',
      productKey: contentArtifact.productKey,
      quality,
      diagnostics: [],
    });
  }

  const structure = parseSlots(mapping);
  if (structure.status !== 'SAFE') {
    return characteristicResult({
      status: structure.status,
      productKey: contentArtifact.productKey,
      quality,
      diagnostics: structure.diagnostics,
    });
  }
  if (characteristics.length > structure.slots.length) {
    return characteristicResult({
      status: 'NEEDS_MAPPING',
      productKey: contentArtifact.productKey,
      quality,
      unresolvedCharacteristics: characteristics.slice(structure.slots.length).map((characteristic, offset) => ({
        characteristicIndex: structure.slots.length + offset,
        name: characteristic.name,
        value: characteristic.value,
        reason: 'INSUFFICIENT_CHARACTERISTIC_CAPACITY',
      })),
      diagnostics: [{ code: 'INSUFFICIENT_CHARACTERISTIC_CAPACITY', message: 'Workbook has fewer characteristic slots than the artifact requires' }],
    });
  }

  const { mappedCharacteristics, writes } = buildWrites(characteristics, structure.slots);
  return characteristicResult({
    status: 'SAFE',
    productKey: contentArtifact.productKey,
    quality,
    mappedCharacteristics,
    writes,
    diagnostics: [],
  });
}
