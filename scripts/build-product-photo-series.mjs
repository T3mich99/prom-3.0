throw new Error('Legacy product-photo generator disabled. Use PHOTO-MASTER-SPEC.md as the only active photo-generation specification.');

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sharp = (await import(pathToFileURL('C:/Users/Dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.mjs').href)).default;

const args = Object.fromEntries(process.argv.slice(2).map((v) => {
  const i = v.indexOf('='); return [v.slice(0, i).replace(/^--/, ''), v.slice(i + 1)];
}));
const sourceDataDir = args.sourceDataDir;
const sourceImageDir = args.sourceImageDir;
const outputDir = args.outputDir;
const manifestPath = args.manifestPath;
const approvedPath = args.approvedPath;
if (!sourceDataDir || !sourceImageDir || !outputDir) throw new Error('sourceDataDir, sourceImageDir and outputDir are required');

const roles = ['01_main', '02_benefits', '03_features', '04_use', '05_details'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wrap = (s, max = 34) => {
  const words = String(s ?? '').split(/\s+/); const lines = []; let line = '';
  for (const word of words) { const next = line ? `${line} ${word}` : word; if (next.length > max && line) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line); return lines.slice(0, 3);
};
const textBlock = (text, x, y, size, color, weight = 400, width = 600, lineGap = 1.22) => {
  const lines = wrap(text, Math.max(12, Math.floor(width / Math.max(12, size * 0.55))));
  return `<text x="${x}" y="${y}" font-family="Arial,Segoe UI,sans-serif" font-size="${size}px" font-weight="${weight}" fill="${color}">${lines.map((l, i) => `<tspan x="${x}" dy="${i ? size * lineGap : 0}">${esc(l)}</tspan>`).join('')}</text>`;
};
const listBlock = (items, x, y, size, color, width) => items.map((item, i) => {
  const yy = y + i * 132;
  return `<circle cx="${x}" cy="${yy - 9}" r="13" fill="#B27C28"/><text x="${x - 7}" y="${yy - 1}" font-family="Arial,sans-serif" font-size="18px" font-weight="700" fill="#FFFFFF">✓</text>${textBlock(item, x + 38, yy, size, color, 600, width)}`;
}).join('');
const svg = (content, bg = '#FFFFFF') => Buffer.from(`<svg width="1280" height="1280" viewBox="0 0 1280 1280" xmlns="http://www.w3.org/2000/svg"><rect width="1280" height="1280" fill="${bg}"/>${content}</svg>`);

async function files(dir) { return (await fs.readdir(dir)).filter((n) => /\.(jpg|jpeg|png|webp)$/i.test(n)).sort().map((n) => path.join(dir, n)); }
async function jsonFiles(dir) { return (await fs.readdir(dir)).filter((n) => /^selected-.*\.json$/i.test(n)).sort(); }
async function sourceBuffer(src, width, height, fit = 'contain') {
  return sharp(src).resize({ width, height, fit, background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer();
}
async function make(p, role, src, dest) {
  const name = String(p.breadcrumbs?.at(-2) || 'Товар для дому');
  const category = name.toUpperCase();
  const chars = (p.chars || []).filter((x) => !/модель|sku|артикул|код|бренд|виробник|постачальник/i.test(String(x.name))).filter((x) => x.value).slice(0, 5).map((x) => `${x.name} — ${x.value}`);
  const context = /авто|автомоб|сидін/i.test(`${p.name} ${name}`) ? 'Для поїздок та щоденного комфорту' : /кух|посуд|раковин/i.test(`${p.name} ${name}`) ? 'Для зручного використання на кухні' : /ванн|щіт|мочал/i.test(`${p.name} ${name}`) ? 'Для чистоти та порядку вдома' : 'Практично для щоденних справ';
  const benefits = /дощовик/i.test(`${p.name} ${name}`) ? ['Захист від дощу', 'Легкий матеріал', 'Зручно брати із собою'] : /сушарка.*білиз|білиз.*сушар/i.test(`${p.name} ${name}`) ? ['Зручне використання', 'Компактне зберігання', 'Для дому'] : /сушарка.*взут/i.test(`${p.name} ${name}`) ? ['Швидке сушіння', 'Компактний формат', 'Для щоденного використання'] : /посуд|раковин|кухон/i.test(`${p.name} ${name}`) ? ['Порядок на кухні', 'Зручний доступ', 'Легко підтримувати чистоту'] : ['Практичне рішення', 'Зручне використання', 'Для дому та щоденних справ'];
  const img = role === '05_details' ? await sourceBuffer(src, 1120, 960, 'cover') : await sourceBuffer(src, role === '02_benefits' ? 780 : 1120, role === '02_benefits' ? 980 : 980, role === '02_benefits' ? 'cover' : 'contain');
  let layers;
  if (role === '01_main') {
    layers = [{ input: svg(`<rect x="0" y="0" width="1280" height="150" fill="#EBF0F5"/>${textBlock(category, 55, 70, 48, '#13375B', 700, 1120)}${textBlock('Практичний вибір для дому', 58, 122, 28, '#1D2734', 400, 900)}`) }, { input: img, top: 175, left: 80 }];
  } else if (role === '02_benefits') {
    layers = [{ input: svg(`<rect x="0" y="0" width="430" height="1280" fill="#13375B"/>${textBlock('КЛЮЧОВІ ПЕРЕВАГИ', 42, 90, 42, '#FFFFFF', 700, 350)}${listBlock(benefits, 70, 300, 25, '#1D2734', 275)}`, '#F7F9FB') }, { input: img, top: 150, left: 450 }];
  } else if (role === '03_features') {
    const featureSvg = chars.length ? chars.map((x, i) => `<circle cx="795" cy="${250 + i * 145}" r="12" fill="#2265AB"/>${textBlock(x, 835, 258 + i * 145, 24, '#1D2734', 400, 340)}`).join('') : listBlock(['Практичний дизайн', 'Зручний формат', 'Для щоденного використання'], 795, 300, 24, '#1D2734', 340);
    layers = [{ input: svg(`<text x="50" y="95" font-family="Arial,Segoe UI,sans-serif" font-size="48px" font-weight="700" fill="#13375B">ХАРАКТЕРИСТИКИ</text><rect x="760" y="180" width="470" height="960" rx="12" fill="#F6F8FA"/>${featureSvg}`) }, { input: img, top: 190, left: 40 }];
  } else if (role === '04_use') {
    layers = [{ input: svg(`${textBlock('ЗРУЧНО ЩОДНЯ', 55, 95, 48, '#13375B', 700, 1120)}${textBlock(context, 58, 150, 28, '#1D2734', 400, 1050)}`, '#F5F1E8') }, { input: img, top: 210, left: 65 }];
  } else {
    layers = [{ input: svg(`${textBlock('ДЕТАЛІ', 55, 95, 48, '#FFFFFF', 700, 1120)}`, '#232A34') }, { input: img, top: 190, left: 80 }];
  }
  await sharp({ create: { width: 1280, height: 1280, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).composite(layers).png().toFile(dest);
}

const products = [];
for (const file of await jsonFiles(sourceDataDir)) products.push(...JSON.parse(await fs.readFile(path.join(sourceDataDir, file), 'utf8')));
const categoryMap = new Map();
if (manifestPath) { try { const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); for (const x of manifest.selected || []) categoryMap.set(String(x.sourceSku), x.categoryName); } catch {} }
const approved = new Set();
if (approvedPath) { try { for (const x of JSON.parse(await fs.readFile(approvedPath, 'utf8'))) approved.add(`${x.code}/${x.role}`); } catch {} }
for (const p of products) {
  const code = String(p.code); const srcs = await files(sourceImageDir); const productSrcs = srcs.filter((f) => path.basename(f).startsWith(`${code}_`)); if (!productSrcs.length) continue;
  if (categoryMap.has(code)) p.breadcrumbs = [...(p.breadcrumbs || []), categoryMap.get(code)];
  const dir = path.join(outputDir, code); await fs.mkdir(dir, { recursive: true });
  for (let i = 0; i < roles.length; i++) { const role = roles[i]; const dest = path.join(dir, `${role}.png`); if (approved.has(`${code}/${role}`)) continue;
    await make(p, role, productSrcs[i % productSrcs.length], dest);
  }
}
let count = 0; for (const code of await fs.readdir(outputDir)) { try { count += (await fs.readdir(path.join(outputDir, code))).filter((x) => x.endsWith('.png')).length; } catch {} }
console.log(JSON.stringify({ pngCount: count }));
