import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const inputDir = process.argv[2];
if (!inputDir) throw new Error('Usage: node resize-images-1280.mjs <directory>');
const entries = await fs.readdir(inputDir, { withFileTypes: true });
const files = entries.filter((e) => e.isFile() && /\.png$/iu.test(e.name)).map((e) => e.name).sort();
for (const name of files) {
  const src = path.join(inputDir, name);
  const tmp = path.join(inputDir, `.${name}.tmp.png`);
  await sharp(src).resize(1280, 1280, { fit: 'fill' }).png().toFile(tmp);
  await fs.rename(tmp, src);
}
console.log(JSON.stringify({ inputDir, resized: files.length, files }, null, 2));
