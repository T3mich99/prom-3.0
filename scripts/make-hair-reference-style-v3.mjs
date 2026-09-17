import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const [input, output, scene] = process.argv.slice(2);
if (!input || !output || !scene) throw new Error('Usage: node make-hair-reference-style-v3.mjs <input> <output> <01|02>');

const base = `
  <style>
    .badge { font-family: Arial, Helvetica, sans-serif; font-size: 28px; font-weight: 700; fill: #fffaf4; }
    .head { font-family: Arial, Helvetica, sans-serif; font-size: 72px; font-weight: 800; letter-spacing: -2.5px; fill: #11100f; }
    .sub { font-family: Arial, Helvetica, sans-serif; font-size: 29px; font-weight: 500; fill: #26211d; }
    .benefit { font-family: Arial, Helvetica, sans-serif; font-size: 26px; font-weight: 500; fill: #26211d; }
    .caption { font-family: Arial, Helvetica, sans-serif; font-size: 25px; font-weight: 500; fill: #26211d; }
  </style>
  <rect x="50" y="43" width="76" height="54" rx="20" fill="#544a40" opacity="0.96"/>
`;

const main = `
  <text x="68" y="81" class="badge">01</text>
  <text x="62" y="182" class="head">ФЕН</text>
  <text x="62" y="258" class="head">ДЛЯ ВОЛОССЯ</text>
  <rect x="64" y="282" width="84" height="7" rx="4" fill="#9a584e"/>
  <text x="64" y="333" class="sub">СУШІННЯ ТА УКЛАДАННЯ</text>
  <rect x="54" y="1066" width="371" height="99" rx="45" fill="#fff8ee" opacity="0.92"/>
  <circle cx="111" cy="1115" r="34" fill="#9a584e"/>
  <path d="M92 1116h38m-27-12v24m16-24v24" fill="none" stroke="#fff8ee" stroke-width="4" stroke-linecap="round"/>
  <text x="166" y="1125" class="caption">До 2200 Вт</text>
`;

const result = `
  <text x="68" y="81" class="badge">02</text>
  <text x="62" y="177" class="head">СУШІТЬ</text>
  <text x="62" y="253" class="head">ТАК, ЯК</text>
  <text x="62" y="329" class="head">ЗРУЧНО ВАМ</text>
  <rect x="64" y="355" width="84" height="7" rx="4" fill="#9a584e"/>
  <circle cx="110" cy="467" r="34" fill="#9a584e"/>
  <path d="M98 451c-10 13 10 16 0 30m15-30c-10 13 10 16 0 30m15-30c-10 13 10 16 0 30" fill="none" stroke="#fff8ee" stroke-width="4" stroke-linecap="round"/>
  <text x="166" y="459" class="benefit">3 температурні</text><text x="166" y="491" class="benefit">режими</text>
  <circle cx="110" cy="594" r="34" fill="#9a584e"/>
  <path d="M110 570v48m-20-24h40m-34-14 28 28m0-28-28 28" fill="none" stroke="#fff8ee" stroke-width="4" stroke-linecap="round"/>
  <text x="166" y="587" class="benefit">Холодний обдув</text><text x="166" y="619" class="benefit">для завершення укладки</text>
`;

const controls = `
  <text x="68" y="81" class="badge">03</text>
  <text x="62" y="176" class="head">ОБИРАЙТЕ</text>
  <text x="62" y="252" class="head">СВІЙ РЕЖИМ</text>
  <rect x="64" y="278" width="84" height="7" rx="4" fill="#9a584e"/>
  <text x="64" y="330" class="sub">НАЛАШТУВАННЯ ПІД ВАШ РИТМ</text>
  <circle cx="110" cy="440" r="33" fill="#9a584e"/>
  <path d="M91 440h38m-19-19v38" fill="none" stroke="#fff8ee" stroke-width="4" stroke-linecap="round"/>
  <text x="166" y="448" class="benefit">2 швидкості</text>
  <circle cx="110" cy="526" r="33" fill="#9a584e"/>
  <path d="M98 510c-10 13 10 16 0 30m15-30c-10 13 10 16 0 30m15-30c-10 13 10 16 0 30" fill="none" stroke="#fff8ee" stroke-width="4" stroke-linecap="round"/>
  <text x="166" y="534" class="benefit">3 температурні режими</text>
`;

const cold = `
  <text x="68" y="81" class="badge">04</text>
  <text x="62" y="176" class="head">ХОЛОДНИЙ</text>
  <text x="62" y="252" class="head">ОБДУВ</text>
  <rect x="64" y="278" width="84" height="7" rx="4" fill="#9a584e"/>
  <text x="64" y="331" class="sub">ФІНАЛЬНИЙ ШТРИХ УКЛАДАННЯ</text>
  <circle cx="110" cy="449" r="34" fill="#9a584e"/>
  <path d="M110 425v48m-20-24h40m-34-14 28 28m0-28-28 28" fill="none" stroke="#fff8ee" stroke-width="4" stroke-linecap="round"/>
  <text x="166" y="441" class="benefit">Прохолодне повітря</text><text x="166" y="473" class="benefit">після сушіння</text>
`;

const nozzle = `
  <text x="68" y="81" class="badge">05</text>
  <text x="62" y="176" class="head">НАСАДКА-</text>
  <text x="62" y="252" class="head">КОНЦЕНТРАТОР</text>
  <rect x="64" y="278" width="84" height="7" rx="4" fill="#9a584e"/>
  <text x="64" y="331" class="sub">ТОЧНИЙ НАПРЯМОК ПОВІТРЯ</text>
`;

const scenes = { '01': main, '02': result, '03': controls, '04': cold, '05': nozzle };
if (!scenes[scene]) throw new Error('Scene must be 01, 02, 03, 04 or 05');
const layer = Buffer.from(`<svg width="1280" height="1280" viewBox="0 0 1280 1280" xmlns="http://www.w3.org/2000/svg">${base}${scenes[scene]}</svg>`);
await fs.mkdir(path.dirname(output), { recursive: true });
await sharp(input).resize(1280, 1280, { fit: 'cover' }).composite([{ input: layer }]).png({ compressionLevel: 9 }).toFile(output);
