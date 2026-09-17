import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const [sku, role, inputPath, outputRoot = './outputs/pets-all-2026-09-05/photos'] = process.argv.slice(2);
if (!sku || !role || !inputPath) throw new Error('Usage: node normalize-pets-image.mjs SKU ROLE INPUT [OUTPUT_ROOT]');
const dir = path.join(outputRoot, String(sku));
await fs.mkdir(dir, { recursive: true });
const outputPath = path.join(dir, `${role}.png`);
await sharp(inputPath).resize(1280, 1280, { fit: 'fill' }).png().toFile(outputPath);
console.log(JSON.stringify({ sku, role, outputPath }));
