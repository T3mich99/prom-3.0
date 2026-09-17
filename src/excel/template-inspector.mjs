import path from 'node:path';
import {
  canonicalCandidatesForHeader,
  columnLetter,
  isDynamicCharacteristicHeader,
  normalizeHeader,
} from './schema-mapper.mjs';
import { loadXlsx, XlsxEngineError } from './xlsx-engine.mjs';

const MAX_HEADER_SCAN_ROWS = 50;
const SERVICE_SHEET_RE = /(?:^|[ _-])(?:qa|service|reference|lookup|config|справоч|служб|перевір|провер)(?:$|[ _-])/iu;
const PRODUCT_SIGNAL_FIELDS = new Set(['productCode', 'titleRu', 'titleUa', 'descriptionRu', 'descriptionUa', 'price', 'keywordsRu', 'keywordsUa', 'photoUrls']);

export class ExcelTemplateError extends Error {
  constructor(message, code = 'EXCEL_TEMPLATE_ERROR', cause = undefined) {
    super(message, { cause });
    this.name = 'ExcelTemplateError';
    this.code = code;
  }
}

function nonBlank(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function rowValues(values, rowNumber) {
  return values[rowNumber - 1] ?? [];
}

function candidateColumns(row, startColumnIndex = 0) {
  const width = row.length;
  return Array.from({ length: width }, (_, columnIndex) => {
    const originalHeader = row[columnIndex] === null || row[columnIndex] === undefined ? '' : String(row[columnIndex]);
    const canonicalCandidates = canonicalCandidatesForHeader(originalHeader);
    const kind = canonicalCandidates.length
      ? 'known'
      : isDynamicCharacteristicHeader(originalHeader)
        ? 'dynamicCharacteristic'
        : 'unknown';
    return {
      columnIndex: startColumnIndex + columnIndex,
      columnLetter: columnLetter(startColumnIndex + columnIndex),
      originalHeader,
      normalizedHeader: normalizeHeader(originalHeader),
      kind,
      canonicalCandidates,
    };
  });
}

function headerCandidate(values, rowNumber, startColumnIndex = 0) {
  const row = rowValues(values, rowNumber);
  const nonEmpty = row.filter(nonBlank);
  if (nonEmpty.length < 2) return null;
  const columns = candidateColumns(row, startColumnIndex);
  const recognized = columns.filter((column) => column.canonicalCandidates.length);
  const distinctFields = new Set(recognized.flatMap((column) => column.canonicalCandidates));
  const productSignalCount = [...distinctFields].filter((field) => PRODUCT_SIGNAL_FIELDS.has(field)).length;
  const allStrings = nonEmpty.every((value) => typeof value === 'string');
  if (!recognized.length && !allStrings) return null;
  return {
    rowNumber,
    score: recognized.length * 100 + distinctFields.size * 10 + (allStrings ? nonEmpty.length : 0),
    recognizedCount: recognized.length,
    distinctCanonicalCount: distinctFields.size,
    productSignalCount,
    nonEmptyCount: nonEmpty.length,
    columns,
  };
}

function inspectSheet(sheet, index) {
  const usedRange = sheet.getUsedRange();
  const values = usedRange?.values ?? [];
  const usedRowStartIndex = Number.isSafeInteger(usedRange?.rowIndex) ? usedRange.rowIndex : 0;
  const usedColumnStartIndex = Number.isSafeInteger(usedRange?.columnIndex) ? usedRange.columnIndex : 0;
  const usedRowCount = Number.isSafeInteger(usedRange?.rowCount) ? usedRange.rowCount : values.length;
  const usedColumnCount = Number.isSafeInteger(usedRange?.columnCount) ? usedRange.columnCount : Math.max(0, ...values.map((row) => row.length));
  const headerCandidates = [];
  const scanLimit = Math.min(MAX_HEADER_SCAN_ROWS, values.length);
  for (let localRowNumber = 1; localRowNumber <= scanLimit; localRowNumber += 1) {
    const rowNumber = usedRowStartIndex + localRowNumber;
    const candidate = headerCandidate(values, localRowNumber, usedColumnStartIndex);
    if (candidate) headerCandidates.push({ ...candidate, rowNumber });
  }
  headerCandidates.sort((a, b) => b.score - a.score || a.rowNumber - b.rowNumber);
  const hidden = sheet.hidden;
  const serviceLike = SERVICE_SHEET_RE.test(sheet.name);
  const top = headerCandidates.find((candidate) => candidate.recognizedCount > 0) ?? null;
  return {
    name: sheet.name,
    index,
    hidden,
    serviceLike,
    usedRange: {
      startRow: usedRowCount ? usedRowStartIndex + 1 : null,
      endRow: usedRowCount ? usedRowStartIndex + usedRowCount : null,
      startColumn: usedColumnCount ? usedColumnStartIndex + 1 : null,
      endColumn: usedColumnCount ? usedColumnStartIndex + usedColumnCount : null,
      rowCount: usedRowCount,
      columnCount: usedColumnCount,
    },
    candidateHeaderRows: headerCandidates.map(({ rowNumber, score, recognizedCount, distinctCanonicalCount, productSignalCount, nonEmptyCount }) => ({ rowNumber, score, recognizedCount, distinctCanonicalCount, productSignalCount, nonEmptyCount })),
    headerCandidates,
    columns: top?.columns ?? [],
  };
}

export async function inspectWorkbook(inputPath) {
  const resolvedPath = path.resolve(String(inputPath));
  if (path.extname(resolvedPath).toLocaleLowerCase('en-US') !== '.xlsx') {
    return { workbookType: path.extname(resolvedPath).slice(1).toLowerCase() || null, sheets: [], candidateProductSheets: [], diagnostics: [{ code: 'UNSUPPORTED_EXTENSION', message: 'Only .xlsx workbooks are supported in v1', inputPath: resolvedPath }] };
  }
  let workbook;
  try {
    workbook = await loadXlsx(resolvedPath);
  } catch (error) {
    const cause = error instanceof XlsxEngineError ? error : error;
    throw new ExcelTemplateError(`Unable to read workbook: ${resolvedPath}`, 'WORKBOOK_READ_ERROR', cause);
  }
  const sheets = workbook.worksheets.map((sheet, index) => inspectSheet(sheet, index));
  const candidateProductSheets = sheets
    .filter((sheet) => !sheet.hidden && !sheet.serviceLike)
    .map((sheet) => {
      const top = sheet.headerCandidates.find((candidate) => candidate.recognizedCount > 0);
      if (!top || top.productSignalCount === 0) return null;
      return { name: sheet.name, index: sheet.index, score: top.score + top.productSignalCount * 1000 + Math.min(sheet.usedRange.rowCount, 100), headerRow: top.rowNumber, recognizedCount: top.recognizedCount, productSignalCount: top.productSignalCount };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    workbookType: 'xlsx',
    sheets,
    candidateProductSheets,
    diagnostics: sheets.length ? [] : [{ code: 'NO_WORKSHEETS', message: 'Workbook contains no worksheets' }],
  };
}
