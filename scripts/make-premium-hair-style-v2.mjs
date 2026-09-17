import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const [input, output, scene = 'main'] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node make-premium-hair-style-v2.mjs <input> <output>');

const mainSvg = `<svg width="1280" height="1280" viewBox="0 0 1280 1280" xmlns="http://www.w3.org/2000/svg">
  <style>
    .badge { font-family: Arial, Helvetica, sans-serif; font-size: 28px; font-weight: 700; fill: #fffaf4; }
    .title { font-family: Arial, Helvetica, sans-serif; font-size: 78px; font-weight: 800; letter-spacing: -2.8px; fill: #11100f; }
    .sub { font-family: Arial, Helvetica, sans-serif; font-size: 30px; font-weight: 500; fill: #29231f; }
    .pill { font-family: Arial, Helvetica, sans-serif; font-size: 28px; font-weight: 600; fill: #28211d; }
  </style>
  <rect x="52" y="46" width="76" height="55" rx="20" fill="#564b40" opacity="0.92"/>
  <text x="69" y="84" class="badge">01</text>
  <rect x="44" y="120" width="474" height="272" rx="30" fill="#fffaf4" opacity="0.82"/>
  <text x="70" y="211" class="title">ФЕН</text>
  <text x="70" y="292" class="title">ДЛЯ ВОЛОССЯ</text>
  <rect x="72" y="319" width="100" height="8" rx="4" fill="#9c5a50"/>
  <text x="72" y="370" class="sub">Сушіння та укладання</text>
  <rect x="52" y="1064" width="400" height="105" rx="45" fill="#fffaf4" opacity="0.91"/>
  <circle cx="109" cy="1117" r="34" fill="#9c5a50"/>
  <path d="M94 1118h30m-23-12v24m16-24v24" stroke="#fffaf4" stroke-width="4" stroke-linecap="round"/>
  <text x="162" y="1126" class="pill">До 2200 Вт</text>
</svg>`;

const resultSvg = `<svg width="1280" height="1280" viewBox="0 0 1280 1280" xmlns="http://www.w3.org/2000/svg">
  <style>
    .badge { font-family: Arial, Helvetica, sans-serif; font-size: 28px; font-weight: 700; fill: #fffaf4; }
    .title { font-family: Arial, Helvetica, sans-serif; font-size: 70px; font-weight: 800; letter-spacing: -2.6px; fill: #11100f; }
    .sub { font-family: Arial, Helvetica, sans-serif; font-size: 30px; font-weight: 500; fill: #2c2621; }
    .benefit { font-family: Arial, Helvetica, sans-serif; font-size: 27px; font-weight: 500; fill: #2c2621; }
  </style>
  <rect x="52" y="46" width="76" height="55" rx="20" fill="#564b40" opacity="0.92"/>
  <text x="69" y="84" class="badge">02</text>
  <rect x="42" y="121" width="530" height="698" rx="32" fill="#fffaf4" opacity="0.84"/>
  <text x="70" y="207" class="title">СУШІТЬ</text>
  <text x="70" y="278" class="title">ТАК, ЯК</text>
  <text x="70" y="349" class="title">ЗРУЧНО ВАМ</text>
  <rect x="72" y="383" width="88" height="8" rx="4" fill="#9c5a50"/>
  <circle cx="112" cy="473" r="35" fill="#9c5a50"/>
  <path d="M100 458c-12 13 12 16 0 31m16-31c-12 13 12 16 0 31m16-31c-12 13 12 16 0 31" fill="none" stroke="#fffaf4" stroke-width="4" stroke-linecap="round"/>
  <text x="170" y="465" class="benefit">3 температурні</text><text x="170" y="497" class="benefit">режими</text>
  <circle cx="112" cy="602" r="35" fill="#9c5a50"/>
  <path d="M112 578v48m-20-24h40m-34-14 28 28m0-28-28 28" stroke="#fffaf4" stroke-width="4" stroke-linecap="round"/>
  <text x="170" y="594" class="benefit">Холодний обдув</text><text x="170" y="626" class="benefit">для завершення укладки</text>
  <text x="72" y="734" class="sub">До 2200 Вт</text>
</svg>`;

const svg = Buffer.from(scene === 'result' ? resultSvg : mainSvg);

await fs.mkdir(path.dirname(output), { recursive: true });
await sharp(input).resize(1280, 1280, { fit: 'cover' }).composite([{ input: svg }]).png({ compressionLevel: 9 }).toFile(output);
