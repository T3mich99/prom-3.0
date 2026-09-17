import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function readUInt16(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function crc32(data) {
  if (!crc32.table) {
    crc32.table = Array.from({ length: 256 }, (_, value) => {
      let current = value;
      for (let bit = 0; bit < 8; bit += 1) {
        current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
      }
      return current >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crc32.table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipEntries(buffer) {
  const minimumEndRecord = 22;
  const searchStart = Math.max(0, buffer.length - 0xffff - minimumEndRecord);
  let endRecord = -1;
  for (let offset = buffer.length - minimumEndRecord; offset >= searchStart; offset -= 1) {
    if (readUInt32(buffer, offset) === 0x06054b50) {
      endRecord = offset;
      break;
    }
  }
  if (endRecord < 0) throw new Error('XLSX ZIP end record was not found');

  const entryCount = readUInt16(buffer, endRecord + 10);
  const directorySize = readUInt32(buffer, endRecord + 12);
  const directoryOffset = readUInt32(buffer, endRecord + 16);
  const entries = new Map();
  let offset = directoryOffset;
  const directoryEnd = directoryOffset + directorySize;

  for (let index = 0; index < entryCount && offset < directoryEnd; index += 1) {
    if (readUInt32(buffer, offset) !== 0x02014b50) throw new Error('Invalid XLSX ZIP directory entry');
    const method = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const nameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localOffset = readUInt32(buffer, offset + 42);
    const name = textDecoder.decode(buffer.subarray(offset + 46, offset + 46 + nameLength));
    const localNameLength = readUInt16(buffer, localOffset + 26);
    const localExtraLength = readUInt16(buffer, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`Unsupported XLSX ZIP compression method: ${method}`);
    entries.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function zipFile(entries) {
  const localParts = [];
  const directoryParts = [];
  let localOffset = 0;
  for (const [name, input] of entries) {
    const nameBytes = Buffer.from(textEncoder.encode(name));
    const data = Buffer.isBuffer(input) ? input : Buffer.from(textEncoder.encode(input));
    const crc = crc32(data);
    const local = Buffer.concat([
      writeUInt32(0x04034b50), writeUInt16(20), writeUInt16(0), writeUInt16(0),
      writeUInt16(0), writeUInt16(0), writeUInt32(crc), writeUInt32(data.length),
      writeUInt32(data.length), writeUInt16(nameBytes.length), writeUInt16(0),
      nameBytes, data,
    ]);
    localParts.push(local);
    const directory = Buffer.concat([
      writeUInt32(0x02014b50), writeUInt16(20), writeUInt16(20), writeUInt16(0),
      writeUInt16(0), writeUInt16(0), writeUInt16(0), writeUInt32(crc),
      writeUInt32(data.length), writeUInt32(data.length), writeUInt16(nameBytes.length),
      writeUInt16(0), writeUInt16(0), writeUInt16(0), writeUInt16(0), writeUInt32(0),
      writeUInt32(localOffset), nameBytes,
    ]);
    directoryParts.push(directory);
    localOffset += local.length;
  }
  const localData = Buffer.concat(localParts);
  const directory = Buffer.concat(directoryParts);
  const endRecord = Buffer.concat([
    writeUInt32(0x06054b50), writeUInt16(0), writeUInt16(0), writeUInt16(entries.length),
    writeUInt16(entries.length), writeUInt32(directory.length), writeUInt32(localData.length),
    writeUInt16(0),
  ]);
  return Buffer.concat([localData, directory, endRecord]);
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function xmlUnescape(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gu, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&');
}

function xmlAttributes(tag) {
  const attributes = {};
  for (const match of String(tag).matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/gu)) {
    attributes[match[1]] = xmlUnescape(match[2]);
  }
  return attributes;
}

function xmlText(xml) {
  return [...String(xml).matchAll(/<(?:[A-Za-z_][\w.-]*:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/gu)]
    .map((match) => xmlUnescape(match[1]))
    .join('');
}

function parseSharedStrings(xml) {
  return [...String(xml).matchAll(/<(?:[A-Za-z_][\w.-]*:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/gu)]
    .map((match) => xmlText(match[1]));
}

function columnIndex(reference) {
  const letters = String(reference).match(/^[A-Z]+/iu)?.[0] ?? '';
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function cellValue(cellXml, attributes, sharedStrings) {
  const valueMatch = cellXml.match(/<(?:[A-Za-z_][\w.-]*:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/u);
  if (attributes.t === 'inlineStr') return xmlText(cellXml);
  if (!valueMatch) return null;
  const raw = xmlUnescape(valueMatch[1]);
  if (attributes.t === 's') return sharedStrings[Number.parseInt(raw, 10)] ?? null;
  if (attributes.t === 'b') return raw === '1';
  if (attributes.t === 'str') return raw;
  const numeric = Number(raw);
  return Number.isNaN(numeric) ? raw : numeric;
}

function parseWorksheet(xml, sharedStrings) {
  const cells = [];
  let maxRow = -1;
  let maxColumn = -1;
  let rowNumber = 0;
  for (const rowMatch of String(xml).matchAll(/<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row>/gu)) {
    const rowAttributes = xmlAttributes(rowMatch[1]);
    const currentRow = rowAttributes.r ? Number.parseInt(rowAttributes.r, 10) - 1 : rowNumber;
    rowNumber = currentRow + 1;
    maxRow = Math.max(maxRow, currentRow);
    for (const cellMatch of rowMatch[2].matchAll(/<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>)/gu)) {
      const attributes = xmlAttributes(cellMatch[1]);
      const reference = attributes.r;
      if (!reference) continue;
      const currentColumn = columnIndex(reference);
      cells.push([currentRow, currentColumn, cellValue(cellMatch[2] ?? '', attributes, sharedStrings)]);
      maxColumn = Math.max(maxColumn, currentColumn);
    }
  }
  if (maxRow < 0 || maxColumn < 0) return [];
  const values = Array.from({ length: maxRow + 1 }, () => Array(maxColumn + 1).fill(null));
  for (const [row, column, value] of cells) values[row][column] = value;
  return values;
}

function relationshipTarget(target) {
  const normalized = target.replace(/^\//u, '');
  return normalized.startsWith('xl/') ? normalized : path.posix.normalize(path.posix.join('xl', normalized));
}

async function importWorkbook(filePath) {
  const entries = zipEntries(await fs.readFile(filePath));
  const workbookXml = textDecoder.decode(entries.get('xl/workbook.xml'));
  const relationshipXml = textDecoder.decode(entries.get('xl/_rels/workbook.xml.rels'));
  const sharedStrings = entries.has('xl/sharedStrings.xml')
    ? parseSharedStrings(textDecoder.decode(entries.get('xl/sharedStrings.xml')))
    : [];
  const relationships = {};
  for (const match of String(relationshipXml).matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/gu)) {
    const attributes = xmlAttributes(match[1]);
    if (attributes.Id && attributes.Target) relationships[attributes.Id] = relationshipTarget(attributes.Target);
  }
  const sheets = [];
  for (const match of String(workbookXml).matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*)\/?>(?:<\/(?:[A-Za-z_][\w.-]*:)?sheet>)?/gu)) {
    const attributes = xmlAttributes(match[1]);
    const target = relationships[attributes['r:id']];
    if (!attributes.name || !target || !entries.has(target)) continue;
    sheets.push(new Worksheet(attributes.name, parseWorksheet(textDecoder.decode(entries.get(target)), sharedStrings)));
  }
  return new Workbook(sheets);
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function worksheetXml(values) {
  const rowXml = [];
  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] ?? [];
    const cells = [];
    for (let column = 0; column < row.length; column += 1) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      const reference = `${columnName(column)}${rowIndex + 1}`;
      if (typeof value === 'number' && Number.isFinite(value)) {
        cells.push(`<c r="${reference}"><v>${value}</v></c>`);
      } else {
        cells.push(`<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`);
      }
    }
    if (cells.length) rowXml.push(`<row r="${rowIndex + 1}">${cells.join('')}</row>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml.join('')}</sheetData></worksheet>`;
}

function exportWorkbook(workbook) {
  const sheets = workbook.worksheets.items;
  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  const relationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  const contentTypes = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const entries = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${contentTypes}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`],
    ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet.values)]),
  ];
  return zipFile(entries);
}

class WorksheetRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  get values() {
    return this.sheet.values.slice(this.row, this.row + this.rowCount).map((row) => row.slice(this.column, this.column + this.columnCount));
  }

  set values(input) {
    for (let row = 0; row < this.rowCount; row += 1) {
      if (!this.sheet.values[this.row + row]) this.sheet.values[this.row + row] = [];
      for (let column = 0; column < this.columnCount; column += 1) {
        this.sheet.values[this.row + row][this.column + column] = input[row]?.[column] ?? null;
      }
    }
  }
}

class Worksheet {
  constructor(name, values = []) {
    this.name = name;
    this.values = values;
  }

  getUsedRange() {
    return { values: this.values };
  }

  getRangeByIndexes(row, column, rowCount, columnCount) {
    return new WorksheetRange(this, row, column, rowCount, columnCount);
  }
}

class WorksheetCollection {
  constructor(items = []) {
    this.items = items;
  }

  add(name) {
    const sheet = new Worksheet(name);
    this.items.push(sheet);
    return sheet;
  }

  getItem(name) {
    const sheet = this.items.find((item) => item.name === name);
    if (!sheet) throw new Error(`Worksheet not found: ${name}`);
    return sheet;
  }
}

export class Workbook {
  constructor(sheets = []) {
    this.worksheets = new WorksheetCollection(sheets);
  }

  static create() {
    return new Workbook();
  }
}

export class FileBlob {
  constructor(filePath) {
    this.filePath = filePath;
  }

  static async load(filePath) {
    return new FileBlob(filePath);
  }
}

export class SpreadsheetFile {
  static async importXlsx(blob) {
    return importWorkbook(blob.filePath);
  }

  static async exportXlsx(workbook) {
    return {
      async save(filePath) {
        await fs.writeFile(filePath, exportWorkbook(workbook));
      },
    };
  }
}
