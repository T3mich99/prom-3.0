import ExcelJS from 'exceljs';

export class XlsxEngineError extends Error {
  constructor(message, code = 'XLSX_ENGINE_ERROR', cause = undefined) {
    super(message, { cause });
    this.name = 'XlsxEngineError';
    this.code = code;
  }
}

function columnLetter(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cellAddress(rowNumber, columnIndex) {
  return `${columnLetter(columnIndex)}${rowNumber}`;
}

function cellHasContent(cell) {
  const value = cell.value;
  return value !== null && value !== undefined && value !== '';
}

function cellValue(cell) {
  return cell.value ?? null;
}

function mergedRangeFromModel(model) {
  return {
    startAddress: cellAddress(model.top, model.left - 1),
    endAddress: cellAddress(model.bottom, model.right - 1),
  };
}

class XlsxWorksheet {
  constructor(worksheet, index) {
    this._worksheet = worksheet;
    this.index = index;
  }

  get name() {
    return this._worksheet.name;
  }

  get hidden() {
    return this._worksheet.state !== 'visible';
  }

  get state() {
    return this._worksheet.state;
  }

  getUsedRange() {
    let minRow = Number.POSITIVE_INFINITY;
    let minColumn = Number.POSITIVE_INFINITY;
    let maxRow = 0;
    let maxColumn = 0;

    this._worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (!cellHasContent(cell)) return;
        minRow = Math.min(minRow, row.number);
        minColumn = Math.min(minColumn, cell.col);
        maxRow = Math.max(maxRow, row.number);
        maxColumn = Math.max(maxColumn, cell.col);
      });
    });

    if (!Number.isFinite(minRow)) return null;
    const rowIndex = minRow - 1;
    const columnIndex = minColumn - 1;
    const rowCount = maxRow - minRow + 1;
    const columnCount = maxColumn - minColumn + 1;
    return {
      rowIndex,
      columnIndex,
      rowCount,
      columnCount,
      address: `${cellAddress(minRow, columnIndex)}:${cellAddress(maxRow, maxColumn - 1)}`,
      values: this.readRangeByIndexes(rowIndex, columnIndex, rowCount, columnCount),
    };
  }

  readRangeByIndexes(rowIndex, columnIndex, rowCount, columnCount) {
    return Array.from({ length: rowCount }, (_, rowOffset) => Array.from({ length: columnCount }, (_, columnOffset) => this.readCell(rowIndex + rowOffset, columnIndex + columnOffset)));
  }

  readCell(rowIndex, columnIndex) {
    return cellValue(this._worksheet.getCell(rowIndex + 1, columnIndex + 1));
  }

  readFormula(rowIndex, columnIndex) {
    return this._worksheet.getCell(rowIndex + 1, columnIndex + 1).formula ?? '';
  }

  readFormulasByColumn(rowIndex, columnIndex, rowCount) {
    return Array.from({ length: rowCount }, (_, offset) => this.readFormula(rowIndex + offset, columnIndex));
  }

  writeCell(rowIndex, columnIndex, value) {
    this._worksheet.getCell(rowIndex + 1, columnIndex + 1).value = value;
  }

  replaceRowsFrom(rowNumber, rows) {
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) throw new TypeError('rowNumber must be a positive integer');
    if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
    const deleteCount = Math.max(0, this._worksheet.rowCount - rowNumber + 1);
    this._worksheet.spliceRows(rowNumber, deleteCount, ...rows);
    const targetLength = rowNumber - 1 + rows.length;
    if (this._worksheet._rows.length > targetLength) this._worksheet._rows.length = targetLength;
  }

  mergedRanges() {
    return Object.values(this._worksheet._merges ?? {}).map((merge) => mergedRangeFromModel(merge.model));
  }

  cellInsideMergedRange(rowNumber, columnIndex) {
    const target = { rowNumber, columnIndex };
    return this.mergedRanges().find((merge) => {
      const start = this.parseAddress(merge.startAddress);
      const end = this.parseAddress(merge.endAddress);
      return target.rowNumber >= start.rowNumber
        && target.rowNumber <= end.rowNumber
        && target.columnIndex >= start.columnIndex
        && target.columnIndex <= end.columnIndex;
    }) ?? null;
  }

  getColumnWidth(columnIndex) {
    return this._worksheet.getColumn(columnIndex + 1).width;
  }

  getRowHeight(rowNumber) {
    return this._worksheet.getRow(rowNumber).height;
  }

  getCellStyle(rowIndex, columnIndex) {
    const cell = this._worksheet.getCell(rowIndex + 1, columnIndex + 1);
    return {
      font: cell.font,
      fill: cell.fill,
      border: cell.border,
      alignment: cell.alignment,
      numberFormat: cell.numFmt,
    };
  }

  getDataValidations() {
    return structuredClone(this._worksheet.dataValidations?.model ?? {});
  }

  parseAddress(address) {
    const match = String(address).match(/^([A-Z]+)(\d+)$/iu);
    if (!match) throw new XlsxEngineError(`Invalid cell address: ${address}`, 'INVALID_CELL_ADDRESS');
    let columnIndex = 0;
    for (const letter of match[1].toUpperCase()) columnIndex = columnIndex * 26 + letter.charCodeAt(0) - 64;
    return { rowNumber: Number.parseInt(match[2], 10), columnIndex: columnIndex - 1 };
  }
}

class XlsxWorkbook {
  constructor(workbook) {
    this._workbook = workbook;
  }

  get worksheets() {
    return this._workbook.worksheets.map((worksheet, index) => new XlsxWorksheet(worksheet, index));
  }

  getWorksheet(name) {
    const worksheet = this._workbook.getWorksheet(name);
    if (!worksheet) throw new XlsxEngineError(`Unknown worksheet: ${name}`, 'UNKNOWN_WORKSHEET');
    return new XlsxWorksheet(worksheet, this._workbook.worksheets.indexOf(worksheet));
  }

  async save(outputPath) {
    await this._workbook.xlsx.writeFile(outputPath);
  }
}

export async function loadXlsx(inputPath) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(inputPath);
    return new XlsxWorkbook(workbook);
  } catch (error) {
    throw new XlsxEngineError(`Unable to read workbook: ${inputPath}`, 'WORKBOOK_READ_ERROR', error);
  }
}

export async function saveXlsx(workbook, outputPath) {
  await workbook.save(outputPath);
}
