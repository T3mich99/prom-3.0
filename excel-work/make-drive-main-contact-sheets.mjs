import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import sharp from 'sharp';

const inputPath = process.argv[2];
const mapPath = process.argv[3];
const outputDir = process.argv[4];
const role = process.argv[5] || '01_main.png';
if (!inputPath || !mapPath || !outputDir) {
  throw new Error('Usage: node make-drive-main-contact-sheets.mjs <input.xlsx> <drive-map.json> <output-dir> [image-role]');
}

const stripCode = (value) => String(value ?? '').replace(/^U|U$/g, '').trim();
const publicUrl = (id) => `https://drive.usercontent.google.com/download?id=${id}&export=view`;
const escapeXml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const payload = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const imageMap = payload.images ?? {};
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const products = workbook.worksheets.getItem('Export Products Sheet');
const rows = products.getRange('A2:O90').values;
const items = rows.map((row, index) => {
  const code = stripCode(row[0]);
  const id = imageMap[code]?.[role];
  if (!id) throw new Error(`Missing ${role} in Drive map for row ${index + 2}, code ${code}`);
  return { code, url: publicUrl(id) };
});

await fs.mkdir(outputDir, { recursive: true });

async function fetchBuffer(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message ?? 'unknown error'}`);
}

const columns = 4;
const rowsPerSheet = 5;
const tileWidth = 300;
const tileHeight = 320;
const imageSize = 280;
const topBand = 50;
const sheetCount = Math.ceil(items.length / (columns * rowsPerSheet));
const outputs = [];
const roleLabel = role.replace(/\.png$/i, '');

for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
  const start = sheetIndex * columns * rowsPerSheet;
  const sheetItems = items.slice(start, start + columns * rowsPerSheet);
  const canvasWidth = columns * tileWidth;
  const canvasHeight = topBand + rowsPerSheet * tileHeight;
  const composites = [];

  composites.push({
    input: Buffer.from(`<svg width="${canvasWidth}" height="${topBand}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#e9eef5"/><text x="24" y="33" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#172033">${roleLabel} — товари ${start + 1}–${start + sheetItems.length} з ${items.length}</text></svg>`),
    left: 0,
    top: 0,
  });

  for (let i = 0; i < sheetItems.length; i += 1) {
    const item = sheetItems[i];
    const source = await fetchBuffer(item.url);
    const image = await sharp(source).resize(imageSize, imageSize, { fit: 'cover' }).png().toBuffer();
    const col = i % columns;
    const row = Math.floor(i / columns);
    const left = col * tileWidth + 10;
    const top = topBand + row * tileHeight + 10;
    composites.push({ input: image, left, top });
    composites.push({
      input: Buffer.from(`<svg width="${imageSize}" height="30" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#172033"/><text x="12" y="21" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#ffffff">${escapeXml(item.code)}</text></svg>`),
      left,
      top: top + imageSize,
    });
  }

  const outputPath = path.join(outputDir, `${roleLabel}-contact-${String(sheetIndex + 1).padStart(2, '0')}.png`);
  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 247, g: 248, b: 250, alpha: 1 },
    },
  }).composite(composites).png().toFile(outputPath);
  outputs.push(outputPath);
}

console.log(JSON.stringify({ sourceFolder: payload.folderId, role, items: items.length, sheets: outputs.length, outputs }, null, 2));
