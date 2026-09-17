import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

export async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-excel-'));
}

export async function createWorkbook(filePath, sheetDefinitions) {
  const workbook = new ExcelJS.Workbook();
  for (const definition of sheetDefinitions) {
    const sheet = workbook.addWorksheet(definition.name, { state: definition.state ?? 'visible' });
    const values = definition.values ?? [];
    const width = Math.max(1, ...values.map((row) => row.length));
    if (values.length) {
      const rectangular = values.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? null));
      const startRow = Math.max(0, (definition.startRow ?? 1) - 1);
      const startColumn = Math.max(0, (definition.startColumn ?? 1) - 1);
      rectangular.forEach((row, rowOffset) => row.forEach((value, columnOffset) => {
        sheet.getCell(startRow + rowOffset + 1, startColumn + columnOffset + 1).value = value;
      }));
    }
    for (const [address, formula] of Object.entries(definition.formulas ?? {})) {
      sheet.getCell(address).value = typeof formula === 'string' ? { formula } : formula;
    }
    for (const address of definition.merged ?? []) sheet.mergeCells(address);
    for (const { address, validation } of definition.validations ?? []) {
      const rule = { ...(validation.rule ?? validation) };
      if (rule.type === 'list' && Array.isArray(rule.values)) {
        rule.formulae = [`"${rule.values.join(',')}"`];
        delete rule.values;
      }
      sheet.dataValidations.add(address, rule);
    }
    for (const [columnIndex, widthValue] of Object.entries(definition.columnWidths ?? {})) sheet.getColumn(Number(columnIndex)).width = widthValue;
    for (const [rowNumber, heightValue] of Object.entries(definition.rowHeights ?? {})) sheet.getRow(Number(rowNumber)).height = heightValue;
    for (const [address, style] of Object.entries(definition.styles ?? {})) Object.assign(sheet.getCell(address), style);
  }
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

export async function loadWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

export async function fileHash(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

export async function cleanupTempDir(directory) {
  await fs.rm(directory, { recursive: true, force: true });
}
