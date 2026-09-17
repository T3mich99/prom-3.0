import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const [input, output, headline, subheadline] = process.argv.slice(2);
if (!input || !output || !headline || !subheadline) {
  throw new Error('Usage: node overlay-ukrainian-photo-text.mjs input output headline subheadline');
}

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function words(value, max = 18) {
  const list = value.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of list) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > max && line) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

const titleLines = words(headline.toLocaleUpperCase('uk-UA'), 12);
const subLines = words(subheadline, 29);
const titleSvg = titleLines.map((line, index) => `<text x="62" y="${125 + index * 78}" class="headline">${escapeXml(line)}</text>`).join('');
const subY = 145 + titleLines.length * 78;
const subSvg = subLines.map((line, index) => `<text x="66" y="${subY + index * 35}" class="subhead">${escapeXml(line)}</text>`).join('');
const dividerY = subY + subLines.length * 35 + 22;
const svg = Buffer.from(`<svg width="1280" height="1280" viewBox="0 0 1280 1280" xmlns="http://www.w3.org/2000/svg">
  <style>
    .headline { font-family: Arial, Helvetica, sans-serif; font-size: 58px; font-weight: 800; letter-spacing: -1.2px; fill: #111111; }
    .subhead { font-family: Arial, Helvetica, sans-serif; font-size: 26px; font-weight: 500; letter-spacing: .1px; fill: #27231f; }
  </style>
  <rect x="42" y="54" width="510" height="${dividerY - 28}" rx="22" fill="#fffaf3" opacity="0.80"/>
  ${titleSvg}
  <rect x="66" y="${dividerY}" width="78" height="6" rx="3" fill="#a85a55"/>
  ${subSvg}
</svg>`);

await fs.mkdir(path.dirname(output), { recursive: true });
await sharp(input).resize(1280, 1280, { fit: 'cover' }).composite([{ input: svg, top: 0, left: 0 }]).png({ compressionLevel: 9 }).toFile(output);
