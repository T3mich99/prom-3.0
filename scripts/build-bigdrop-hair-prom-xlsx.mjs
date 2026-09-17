import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const workspace = 'C:/Users/Dell/Documents/ChatGPT/пром';
const batchRoot = path.join(workspace, 'outputs', 'bigdrop-hair-50-new-2026-09-09');
const outputDir = path.join(workspace, 'outputs', 'bigdrop-hair-50-new-2026-09-10');
const manifestPath = path.join(batchRoot, 'bigdrop-hair-50-manifest.json');
const driveMapPath = path.join(outputDir, 'drive-map.json');
const finalRoot = path.join(batchRoot, 'final');
const outputPath = path.join(outputDir, 'Prom-bigdrop-hair-50-new-2026-09-10.xlsx');

await fs.mkdir(outputDir, { recursive: true });

const decodeHtml = (value = '') => String(value)
  .replace(/&#34;|&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

const stripHtml = (value = '') => decodeHtml(String(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const esc = (value = '') => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const firstMatch = (html, regex) => {
  const m = html.match(regex);
  return m ? decodeHtml(m[1] || '').trim() : '';
};
const normalize = (value = '') => String(value).toLowerCase().replace(/ё/g, 'е').replace(/і/g, 'и').trim();
const unique = (items) => [...new Map(items.filter(Boolean).map((v) => [normalize(v), v])).values()];

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const driveMap = JSON.parse(await fs.readFile(driveMapPath, 'utf8'));
const photoPrefix = 'bigdrop-hair-50-new-2026-09-09-';

function parseCategoryId(html) {
  const token = firstMatch(html, /data-advtracking-prosale-token="([^"]+)"/i);
  if (!token) return '';
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return String(JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).categoryId || '');
  } catch {
    return '';
  }
}

function parseBreadcrumbs(html) {
  const raw = firstMatch(html, /data-crumbs-path="([^"]+)"/i);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function parseCharacteristics(html) {
  const out = [];
  for (const row of html.matchAll(/<tr\s+data-qaid="attribute_item">([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/data-qaid="attribute_(?:name|value)">([\s\S]*?)<\/td>/gi)].map((m) => stripHtml(m[1]));
    if (cells.length >= 2 && cells[0] && cells[1]) out.push({ name: cells[0], value: cells[1], unit: '' });
  }
  const seen = new Set();
  return out.filter((item) => {
    const key = `${normalize(item.name)}|${normalize(item.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseProduct(html, item) {
  const name = firstMatch(html, /data-qaid="product_name">([\s\S]*?)<\/span>/i) || item.name;
  const priceText = firstMatch(html, /data-qaid="product_price">([\s\S]*?)<\/span>/i);
  const compactPriceText = priceText.replace(/\s+/g, '');
  const price = Number((compactPriceText.match(/[\d]+(?:[.,]\d+)?/) || ['0'])[0].replace(',', '.')) || Number(item.price) || 0;
  const sourceCode = firstMatch(html, /data-qaid="product_code">([\s\S]*?)<\/span>/i) || String(item.code);
  const descriptionHtml = firstMatch(html, /data-qaid="product_description">([\s\S]*?)<\/div>/i);
  const breadcrumbs = parseBreadcrumbs(html);
  const categoryCrumb = breadcrumbs.length >= 2 ? breadcrumbs[breadcrumbs.length - 2] : null;
  return {
    ...item,
    name,
    sourceCode,
    purchasePrice: price,
    inStock: /data-qaid="presence_data">\s*Готово до відправки/i.test(html),
    descriptionText: stripHtml(descriptionHtml),
    characteristics: parseCharacteristics(html),
    categoryId: parseCategoryId(html),
    categorySourceName: categoryCrumb?.name || '',
    categorySourceUrl: categoryCrumb?.url ? `https://big-drop.in.ua${categoryCrumb.url}` : '',
  };
}

async function fetchSource(item) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36',
    'Accept-Language': 'uk-UA,uk;q=0.9,ru;q=0.8',
  };
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(item.url, { headers, redirect: 'follow' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return parseProduct(await response.text(), item);
    } catch (error) {
      lastError = String(error?.message || error);
      await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
  }
  return { ...item, name: item.name, sourceCode: item.code, purchasePrice: Number(item.price) || 0, characteristics: [], categoryId: '', categorySourceName: '', categorySourceUrl: '', fetchError: lastError, inStock: true };
}

let fetchCursor = 0;
const enriched = new Array(manifest.length);
async function fetchWorker() {
  while (true) {
    const index = fetchCursor++;
    if (index >= manifest.length) return;
    enriched[index] = await fetchSource(manifest[index]);
  }
}
await Promise.all(Array.from({ length: 5 }, () => fetchWorker()));
await fs.writeFile(path.join(outputDir, 'source-data.json'), JSON.stringify(enriched, null, 2), 'utf8');

const findAttr = (product, regex) => product.characteristics.find((x) => regex.test(String(x.name).toLowerCase()) || regex.test(normalize(x.name)))?.value || '';
const hasAttr = (product, regex) => Boolean(product.characteristics.find((x) => regex.test(String(x.name).toLowerCase()) || regex.test(normalize(x.name))));
const getModel = (name) => (name.match(/\b(?:V[- ]?\d+|HC\d+|SK[- ]?\d+|SY[- ]?\d+|GM[- ]?\d+|MS[- ]?\d+|EN[- ]?\d+|R\.\d+|WNK[- ]?\d+|CF\d+|KM[- ]?\d+|NHC[- ]?\d+|DSP\s*\d+|BT[- ]?\d+|LY[- ]?\d+|X\d+|\d{4}-\d+)\b/i) || [''])[0].replace(/\s+/g, ' ').trim();
const getKnownBrand = (name) => {
  const m = name.match(/\b(VGR|SURKER|Sokany|Rozia|Gemei|RAF|Kemei|ENZO|BITEK|XO|Flawless|DSP|Nova|domotec|One Step)\b/i);
  return m ? m[1] : '';
};

function classify(product) {
  const t = normalize(product.name);
  if (t.includes('гофре')) return 5;
  if (t.includes('праска') && !t.includes('плойка')) return 4;
  if (t.includes('плойка')) return 3;
  if (t.includes('мультистайлер') || (t.includes('стайлер') && !t.includes('фен'))) return 2;
  return 1;
}

const groupInfo = {
  1: { ua: 'Фени та фен-щітки', ru: 'Фены и фен-щётки', parentUa: 'Фени, Плойки, Бігуді, Праски' },
  2: { ua: 'Мультистайлери для волосся', ru: 'Мультистайлеры для волос', parentUa: 'Фени, Плойки, Бігуді, Праски' },
  3: { ua: 'Плойки та щипці для завивки', ru: 'Плойки и щипцы для завивки', parentUa: 'Фени, Плойки, Бігуді, Праски' },
  4: { ua: 'Випрямлячі для волосся', ru: 'Выпрямители для волос', parentUa: 'Фени, Плойки, Бігуді, Праски' },
  5: { ua: 'Щипці-гофре для волосся', ru: 'Щипцы-гофре для волос', parentUa: 'Фени, Плойки, Бігуді, Праски' },
};

const translateValueRu = (value = '') => {
  let out = String(value);
  const exact = {
    'білий': 'белый', 'біле': 'белое', 'чорний': 'чёрный', 'чорна': 'чёрная', 'чорне': 'чёрное',
    'синій': 'синий', 'блакитний': 'голубой', 'рожевий': 'розовый', 'фіолетовий': 'фиолетовый', 'зелений': 'зелёный', 'червоний': 'красный',
    'мережа 220 в': 'сеть 220 В', 'новий': 'новый', 'так': 'да', 'акумулятор': 'аккумулятор', 'випрямлячі': 'выпрямители', 'випрямляч': 'выпрямитель',
    'стайлери повітряні': 'воздушные стайлеры', 'фен-щітка': 'фен-щётка', 'плойки': 'плойки', 'плойка': 'плойка',
    'керамічне покриття': 'керамическое покрытие', 'кераміка': 'керамика', 'акумуляторний': 'аккумуляторный', 'дротовий': 'проводной',
  };
  const exactHit = exact[out.trim().toLowerCase()];
  if (exactHit) return exactHit;
  const map = [
    [/\bбілий\b/gi, 'белый'], [/\bбіле\b/gi, 'белое'], [/\bчорний\b/gi, 'чёрный'], [/\bчорна\b/gi, 'чёрная'],
    [/\bчорне\b/gi, 'чёрное'], [/\bсиній\b/gi, 'синий'], [/\bблакитний\b/gi, 'голубой'], [/\bрожевий\b/gi, 'розовый'],
    [/\bфіолетовий\b/gi, 'фиолетовый'], [/\bзелений\b/gi, 'зелёный'], [/\bчервоний\b/gi, 'красный'],
    [/\bмережа 220 В\b/gi, 'сеть 220 В'], [/\bновий\b/gi, 'новый'], [/\bкерамічне покриття\b/gi, 'керамическое покрытие'],
    [/\bкераміка\b/gi, 'керамика'], [/\bакумуляторний\b/gi, 'аккумуляторный'], [/\bдротовий\b/gi, 'проводной'],
    [/\bтак\b/gi, 'да'], [/\bакумулятор\b/gi, 'аккумулятор'], [/\bвипрямлячі\b/gi, 'выпрямители'], [/\bвипрямляч\b/gi, 'выпрямитель'],
    [/\bстайлери повітряні\b/gi, 'воздушные стайлеры'], [/\bфен-щітка\b/gi, 'фен-щётка'], [/\bплойки\b/gi, 'плойки'], [/\bплойка\b/gi, 'плойка'],
  ];
  for (const [pattern, replacement] of map) out = out.replace(pattern, replacement);
  return out;
};
const translateNameRu = (name = '') => {
  let out = String(name);
  const map = [
    [/Щипці-гофре/gi, 'Щипцы-гофре'], [/Щипці/gi, 'Щипцы'], [/Випрямлячі/gi, 'Выпрямители'], [/Випрямляч/gi, 'Выпрямитель'],
    [/Фен-щітка/gi, 'Фен-щётка'], [/Фен-стайлер/gi, 'Фен-стайлер'], [/Фен для волосся/gi, 'Фен для волос'], [/для волосся/gi, 'для волос'],
    [/Плойка для волосся/gi, 'Плойка для волос'], [/Потрійна плойка/gi, 'Тройная плойка'], [/Плойка-гофре/gi, 'Плойка-гофре'],
    [/Професійна/gi, 'Профессиональная'], [/Професійний/gi, 'Профессиональный'], [/Праска для волосся/gi, 'Выпрямитель для волос'],
    [/Праска/gi, 'Выпрямитель'], [/Потрійна/gi, 'Тройная'], [/Бездротовий/gi, 'Беспроводной'], [/Бездротовий фен/gi, 'Беспроводной фен'],
    [/з іонізацією/gi, 'с ионизацией'], [/Кількість/gi, 'Количество'], [/волосся/gi, 'волос'], [/Глянсовий Білий/gi, 'Глянцевый белый'],
  ];
  for (const [pattern, replacement] of map) out = out.replace(pattern, replacement);
  return out.replace(/\s+/g, ' ').trim();
};

function deriveModelFeature(product, group) {
  const name = product.name;
  const n = normalize(name);
  const ua = [];
  const ru = [];
  const mode = name.match(/\b(\d+)\s*(?:в|в|in)\s*1\b/i);
  if (mode) { ua.push(`${mode[1]} в 1`); ru.push(`${mode[1]} в 1`); }
  if (n.includes('бездротов')) { ua.push('акумуляторний'); ru.push('аккумуляторный'); }
  else if (n.includes('іонізаці') || product.characteristics.some((x) => /іоніз|иониз/i.test(`${x.name} ${x.value}`))) { ua.push('з іонізацією'); ru.push('с ионизацией'); }
  if (n.includes('потрійн')) { ua.push('потрійна'); ru.push('тройная'); }
  if (group === 5 || n.includes('гофр')) { ua.push('гофре'); ru.push('гофре'); }
  if (n.includes('складн')) { ua.push('складаний'); ru.push('складной'); }
  if (n.includes('дорож')) { ua.push('дорожній'); ru.push('дорожный'); }
  return { ua: unique(ua).join(' '), ru: unique(ru).join(' ') };
}

function deriveColor(product) {
  const raw = findAttr(product, /колір|цвет/) || product.name;
  const value = String(raw);
  const match = value.match(/білий|біле|чорний|чорна|чорне|синій|блакитний|рожевий|фіолетовий|зелений|червоний|білий|white|black|blue|pink|purple/i);
  if (!match) return { ua: '', ru: '' };
  const uaMap = { white: 'білий', black: 'чорний', blue: 'синій', pink: 'рожевий', purple: 'фіолетовий' };
  const token = match[0].toLowerCase();
  const ua = uaMap[token] || token;
  return { ua, ru: translateValueRu(ua) };
}

function derivePower(product) {
  const raw = findAttr(product, /потужн|мощн/) || product.name.match(/\b\d{2,5}\s*(?:вт|w)\b/i)?.[0] || '';
  if (!raw) return '';
  const m = String(raw).match(/\d{2,5}/);
  return m ? `${m[0]} Вт` : String(raw);
}

function deriveType(product, group, lang) {
  const n = normalize(product.name);
  const ua = group === 5 ? 'Щипці-гофре для волосся' : group === 4 ? 'Випрямляч для волосся' : group === 3 ? 'Плойка для волосся' : group === 2 ? (n.includes('мультистайлер') ? 'Мультистайлер для волосся' : 'Стайлер для волосся') : (n.includes('фен-щіт') || n.includes('браш') || n.includes('гребінець')) ? 'Фен-щітка для волосся' : 'Фен для волосся';
  if (lang === 'ua') return ua;
  return translateNameRu(ua);
}

function buildTitles(product, group) {
  const manufacturer = findAttr(product, /^виробник$/i) || '';
  const brand = manufacturer && normalize(manufacturer) !== 'and' ? manufacturer : getKnownBrand(product.name);
  const model = getModel(product.name);
  const feature = deriveModelFeature(product, group);
  const power = derivePower(product);
  const color = deriveColor(product);
  const otherUa = [];
  const otherRu = [];
  if (power && !normalize(product.name).includes(normalize(power).replace(' вт', ''))) { otherUa.push(power); otherRu.push(power); }
  if (normalize(product.name).includes('чохол') || normalize(product.name).includes('кейсі')) { otherUa.push('у кейсі'); otherRu.push('в кейсе'); }
  const ua = [deriveType(product, group, 'ua'), feature.ua, brand, model, ...otherUa, color.ua].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const ru = [deriveType(product, group, 'ru'), feature.ru, brand, model, ...otherRu, color.ru].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return { ua, ru, brand: brand || 'AND', model, color, power, feature };
}

function translatedCharName(name, lang) {
  if (lang === 'ua') return name;
  const exact = {
    'кількість температурних режимів': 'Количество температурных режимов', 'кількість швидкостей': 'Количество скоростей',
    'потужність фена': 'Мощность фена', 'тип живлення': 'Тип питания', 'потужність': 'Мощность', 'матеріал покриття': 'Материал покрытия',
    'діаметр': 'Диаметр', 'колір': 'Цвет', 'колір корпусу': 'Цвет корпуса', 'максимальна температура нагріву': 'Максимальная температура нагрева',
    'мінімальна температура нагріву': 'Минимальная температура нагрева', 'функція іонізації': 'Функция ионизации',
    'незалежне регулювання швидкості і температурного режиму': 'Независимая регулировка скорости и температуры',
    'петелька для підвішування': 'Петелька для подвешивания', 'поворот шнура на 360 градусів': 'Поворот шнура на 360 градусов',
    'регулювання швидкості': 'Регулировка скорости', 'складна ручка': 'Складная ручка', 'холодний обдув': 'Холодный обдув',
  };
  const exactHit = exact[String(name).trim().toLowerCase()];
  if (exactHit) return exactHit;
  const map = {
    'виробник': 'Производитель', 'країна виробник': 'Страна производства', 'вага': 'Вес', 'висота': 'Высота', 'довжина': 'Длина',
    'довжина мережевого шнура': 'Длина сетевого шнура', 'захист від перегріву': 'Защита от перегрева', 'керамічне покриття': 'Керамическое покрытие',
    'кількість температурних режимів': 'Количество температурных режимов', 'кількість швидкостей': 'Количество скоростей',
    'кількість режимів роботи': 'Количество режимов работы', 'потужність фена': 'Мощность фена', 'стан': 'Состояние', 'тип живлення': 'Тип питания',
    'потужність': 'Мощность', 'матеріал покриття': 'Материал покрытия', 'тип': 'Тип', 'діаметр': 'Диаметр', 'колір': 'Цвет', 'колір корпусу': 'Цвет корпуса',
    'кількість насадок': 'Количество насадок', 'максимальна температура нагріву': 'Максимальная температура нагрева', 'мінімальна температура нагріву': 'Минимальная температура нагрева',
    'незалежне регулювання швидкості і температурного режиму': 'Независимая регулировка скорости и температуры',
    'петелька для підвішування': 'Петелька для подвешивания', 'поворот шнура на 360 градусів': 'Поворот шнура на 360 градусов',
    'регулювання швидкості': 'Регулировка скорости', 'складна ручка': 'Складная ручка', 'споживана потужність': 'Потребляемая мощность',
    'терморегулятор': 'Терморегулятор', 'холодний обдув': 'Холодный обдув', 'ширина': 'Ширина',
    'функція іонізації': 'Функция ионизации', 'тип приладу': 'Тип прибора', 'комплектація': 'Комплектация', 'довжина шнура': 'Длина шнура',
  };
  return map[normalize(name)] || translateNameRu(name);
}

function textChars(product, lang) {
  const chars = [...product.characteristics];
  if (!chars.some((x) => normalize(x.name) === 'виробник')) chars.push({ name: 'Виробник', value: 'AND', unit: '' });
  if (!chars.some((x) => normalize(x.name) === 'стан')) chars.push({ name: 'Стан', value: 'Новий', unit: '' });
  return unique(chars.map((x) => `${translatedCharName(x.name, lang)}: ${lang === 'ru' ? translateValueRu(x.value) : x.value}`));
}

function actionText(group, lang) {
  const text = {
    1: { ru: 'сушить и укладывать волосы', ua: 'сушити та укладати волосся' },
    2: { ru: 'создавать разные варианты укладки', ua: 'створювати різні варіанти укладання' },
    3: { ru: 'создавать локоны и волны', ua: 'створювати локони та хвилі' },
    4: { ru: 'выпрямлять и укладывать волосы', ua: 'випрямляти та укладати волосся' },
    5: { ru: 'создавать прикорневой объём и текстуру', ua: 'створювати прикореневий об’єм і текстуру' },
  };
  return text[group][lang];
}

function benefits(product, group, lang, titleData) {
  const ru = [];
  const ua = [];
  const speed = findAttr(product, /кількість швидкост|скорост/);
  const temp = findAttr(product, /температур|режим.*нагрів|температурн/);
  const coating = findAttr(product, /покритт|покрыт/);
  const accessories = findAttr(product, /насадк/);
  const power = titleData.power;
  ru.push(`Помогает ${actionText(group, 'ru')} без лишних действий`);
  ua.push(`Допомагає ${actionText(group, 'ua')} без зайвих дій`);
  if (power) { ru.push(`Заявленная мощность ${power} помогает подобрать модель под вашу задачу`); ua.push(`Заявлена потужність ${power} допомагає обрати модель під ваше завдання`); }
  if (speed) { ru.push(`Доступно регулирование скоростей: ${translateValueRu(speed)}`); ua.push(`Доступне регулювання швидкостей: ${speed}`); }
  if (temp) { ru.push(`Температурные режимы указаны в карточке и помогают выбрать подходящий нагрев`); ua.push(`Температурні режими вказані в картці та допомагають обрати потрібний нагрів`); }
  if (coating) { ru.push(`Покрытие рабочей поверхности: ${translateValueRu(coating)}`); ua.push(`Покриття робочої поверхні: ${coating}`); }
  if (accessories) { ru.push(`Комплект с указанными насадками или аксессуарами для выбранного сценария`); ua.push(`Комплект із зазначеними насадками або аксесуарами для обраного сценарію`); }
  if (titleData.feature) { ru.push(`Особенность модели вынесена в название и помогает быстро сравнить варианты`); ua.push(`Особливість моделі винесена в назву та допомагає швидко порівняти варіанти`); }
  ru.push('Понятное управление без лишних действий перед укладкой');
  ua.push('Зрозуміле керування без зайвих дій перед укладанням');
  return { ru: unique(ru).slice(0, 8), ua: unique(ua).slice(0, 8) };
}

function renderDescription(product, group, lang, titleData) {
  const title = lang === 'ru' ? titleData.ru : titleData.ua;
  const chars = textChars(product, lang);
  const power = titleData.power;
  const speed = findAttr(product, /кількість швидкост|скорост/);
  const temp = findAttr(product, /температур|режим.*нагрів|температурн/);
  const coating = findAttr(product, /покритт|покрыт/);
  const powerType = findAttr(product, /тип живлення|тип питания/);
  const accessories = findAttr(product, /насадк/);
  const diameter = findAttr(product, /діаметр|диаметр/);
  const action = actionText(group, lang);
  const p = lang === 'ru' ? {
    intro: `${title} — прибор для того, чтобы ${action}. Он помогает привести волосы в аккуратный вид дома, когда важно получить понятный результат без записи в салон. Подтверждённые параметры собраны ниже, чтобы было проще сравнить модель с другими вариантами и выбрать подходящий прибор.`,
    use: `Формат рассчитан на понятный сценарий: подготовьте волосы, выберите подходящий режим, а затем выполните укладку по пряди. ${power ? `Заявленная мощность — ${power}. ` : ''}${speed ? `Предусмотрено скоростей: ${translateValueRu(speed)}. ` : ''}${temp ? `Количество или диапазон температур указан в характеристиках товара. ` : ''}${powerType ? `Тип питания: ${translateValueRu(powerType)}. ` : ''}${coating ? `Рабочая поверхность или покрытие: ${translateValueRu(coating)}. ` : ''}${diameter ? `Диаметр рабочей части: ${translateValueRu(diameter)}. ` : ''}${accessories ? `В описании поставщика указаны насадки: ${translateValueRu(accessories)}.` : ''}`,
    suitable: group === 1 ? 'Подходит для сушки и укладки дома, подготовки волос перед выходом, поездок и регулярного ухода.' : group === 2 ? 'Подходит для домашних укладок, смены образа и работы с разными зонами волос, если выбранная насадка предусмотрена комплектом.' : group === 3 ? 'Подходит для создания локонов, волн и акцентных прядей дома перед работой, встречей или событием.' : group === 4 ? 'Подходит для выпрямления и разглаживания волос дома, подготовки причёски и быстрой коррекции отдельных прядей.' : 'Подходит для создания объёма и текстуры, акцентных волн и укладки отдельных прядей дома.',
    comp: `Комплектация: ${group === 1 ? 'прибор для сушки или укладки — 1 шт.' : group === 2 ? 'стайлер — 1 шт.' : group === 3 ? 'плойка — 1 шт.' : group === 4 ? 'выпрямитель — 1 шт.' : 'щипцы-гофре — 1 шт.'} Дополнительные элементы перечислены только при подтверждении в характеристиках товара.`,
  } : {
    intro: `${title} — прилад для того, щоб ${action}. Він допомагає привести волосся до охайного вигляду вдома, коли важливо отримати зрозумілий результат без запису до салону. Підтверджені параметри зібрані нижче, щоб було простіше порівняти модель з іншими варіантами та обрати потрібний прилад.`,
    use: `Формат розрахований на зрозумілий сценарій: підготуйте волосся, оберіть потрібний режим, а потім виконайте укладання пасмо за пасмом. ${power ? `Заявлена потужність — ${power}. ` : ''}${speed ? `Передбачено швидкостей: ${speed}. ` : ''}${temp ? `Кількість або діапазон температур зазначено в характеристиках товару. ` : ''}${powerType ? `Тип живлення: ${powerType}. ` : ''}${coating ? `Робоча поверхня або покриття: ${coating}. ` : ''}${diameter ? `Діаметр робочої частини: ${diameter}. ` : ''}${accessories ? `В описі постачальника зазначені насадки: ${accessories}.` : ''}`,
    suitable: group === 1 ? 'Підійде для сушіння та укладання вдома, підготовки волосся перед виходом, поїздок і регулярного догляду.' : group === 2 ? 'Підійде для домашніх укладань, зміни образу та роботи з різними зонами волосся, якщо потрібна насадка передбачена комплектом.' : group === 3 ? 'Підійде для створення локонів, хвиль і акцентних пасом вдома перед роботою, зустріччю або подією.' : group === 4 ? 'Підійде для випрямлення та розгладження волосся вдома, підготовки зачіски й швидкої корекції окремих пасом.' : 'Підійде для створення об’єму та текстури, акцентних хвиль і укладання окремих пасом вдома.',
    comp: `Комплектація: ${group === 1 ? 'прилад для сушіння або укладання — 1 шт.' : group === 2 ? 'стайлер — 1 шт.' : group === 3 ? 'плойка — 1 шт.' : group === 4 ? 'випрямляч — 1 шт.' : 'щипці-гофре — 1 шт.'} Додаткові елементи перелічені лише за підтвердженням у характеристиках товару.`,
  };
  const b = benefits(product, group, lang, titleData)[lang];
  const featureLine = lang === 'ru' ? `Особенности конструкции и управления определяются характеристиками модели. ${power ? `Мощность ${power} вынесена в отдельный параметр. ` : ''}${speed ? `Регулировка скоростей: ${translateValueRu(speed)}. ` : ''}${temp ? `Температурные настройки: ${translateValueRu(temp)}. ` : ''}${coating ? `Рабочее покрытие: ${translateValueRu(coating)}.` : ''}` : `Особливості конструкції та керування визначаються характеристиками моделі. ${power ? `Потужність ${power} винесена в окремий параметр. ` : ''}${speed ? `Регулювання швидкостей: ${speed}. ` : ''}${temp ? `Температурні налаштування: ${temp}. ` : ''}${coating ? `Робоче покриття: ${coating}.` : ''}`;
  const charItems = chars.map((x) => `<li><strong>${esc(x.split(': ')[0])}:</strong> ${esc(x.split(': ').slice(1).join(': '))}</li>`).join('');
  return `<h2>${esc(title)}</h2><p>${esc(p.intro)}</p><p>${esc(p.use)}</p><h3>${lang === 'ru' ? 'Преимущества' : 'Переваги'}</h3><ul>${b.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><h3>${lang === 'ru' ? 'Особенности' : 'Особливості'}</h3><p>${esc(featureLine)}</p><h3>${lang === 'ru' ? 'Подходит для' : 'Підходить для'}</h3><p>${esc(p.suitable)}</p><h3>${lang === 'ru' ? 'Характеристики' : 'Характеристики'}</h3><ul>${charItems}</ul><h3>${lang === 'ru' ? 'Комплектация' : 'Комплектація'}</h3><ul><li>${esc(p.comp)}</li></ul>`;
}

function keywordList(product, group, lang, titleData) {
  const isRu = lang === 'ru';
  const phrases = isRu ? {
    1: ['фен для волос', 'фен для сушки волос', 'фен для укладки волос', 'фен щетка для волос', 'фен браш для волос', 'фен с регулировкой скорости', 'фен с регулировкой температуры', 'фен для укладки дома', 'фен для ежедневной укладки', 'фен для коротких волос', 'фен для длинных волос', 'фен для сушки после мытья', 'прибор для сушки волос', 'прибор для укладки волос', 'фен для домашнего использования', 'фен для аккуратной укладки', 'фен для объема волос', 'фен для выпрямления волос', 'фен с насадками', 'фен для женщины', 'фен для мужчин', 'фен для поездок', 'компактный фен для волос', 'электрический фен для волос', 'фен для салона и дома'],
    2: ['стайлер для волос', 'мультистайлер для волос', 'стайлер для укладки волос', 'прибор для укладки волос', 'стайлер для локонов', 'стайлер для волн', 'стайлер для выпрямления волос', 'стайлер для завивки волос', 'мультистайлер для дома', 'стайлер для домашней укладки', 'электрический стайлер для волос', 'стайлер с насадками', 'стайлер 3 в 1 для волос', 'стайлер 4 в 1 для волос', 'стайлер 5 в 1 для волос', 'устройство для укладки волос', 'прибор для создания локонов', 'прибор для смены образа', 'стайлер для длинных волос', 'стайлер для коротких волос', 'стайлер для ежедневной укладки', 'стайлер для праздничной укладки', 'стайлер для дома и поездок', 'набор для укладки волос', 'инструмент для укладки волос'],
    3: ['плойка для волос', 'щипцы для завивки волос', 'плойка для локонов', 'плойка для волн', 'электрическая плойка для волос', 'плойка для домашней укладки', 'плойка для завивки волос', 'прибор для создания локонов', 'плойка для красивых локонов', 'плойка для мягких волн', 'плойка для длинных волос', 'плойка для коротких волос', 'плойка для ежедневной укладки', 'плойка для праздничной прически', 'щипцы для локонов', 'инструмент для завивки волос', 'плойка с регулировкой температуры', 'плойка с керамическим покрытием', 'плойка для укладки прядей', 'прибор для завивки дома', 'плойка для объема волос', 'плойка для женской укладки', 'плойка для салона и дома', 'компактная плойка для волос', 'стайлер для создания локонов'],
    4: ['выпрямитель для волос', 'утюжок для волос', 'щипцы для выпрямления волос', 'выпрямитель для укладки волос', 'электрический выпрямитель для волос', 'выпрямитель для волос дома', 'утюжок для гладких волос', 'прибор для выпрямления волос', 'выпрямитель для длинных волос', 'выпрямитель для коротких волос', 'выпрямитель для ежедневной укладки', 'выпрямитель для прядей', 'утюжок для создания укладки', 'выпрямитель с регулировкой температуры', 'выпрямитель с керамическим покрытием', 'щипцы для гладкости волос', 'инструмент для выпрямления волос', 'выпрямитель для домашнего ухода', 'прибор для разглаживания волос', 'утюжок для женской укладки', 'выпрямитель для салона и дома', 'компактный утюжок для волос', 'выпрямитель для аккуратной прически', 'утюжок для подготовки прядей', 'прибор для укладки прямых волос'],
    5: ['щипцы гофре для волос', 'плойка гофре для волос', 'утюжок гофре для волос', 'щипцы для прикорневого объема', 'гофре для создания объема', 'гофре для текстуры волос', 'электрические щипцы гофре', 'прибор гофре для укладки', 'щипцы гофре для дома', 'гофре для домашней укладки', 'гофре для длинных волос', 'гофре для коротких волос', 'гофре для акцентных прядей', 'щипцы для волн на волосах', 'прибор для прикорневого объема', 'инструмент для текстурирования волос', 'щипцы для укладки волос', 'гофре для ежедневной укладки', 'гофре для праздничной прически', 'щипцы гофре с регулировкой температуры', 'утюжок для объема волос', 'плойка для прикорневого объема', 'гофре для создания волн', 'прибор для укладки гофре', 'щипцы для красивой текстуры'],
  } : {
    1: ['фен для волосся', 'фен для сушіння волосся', 'фен для укладання волосся', 'фен-щітка для волосся', 'фен-браш для волосся', 'фен із регулюванням швидкості', 'фен із регулюванням температури', 'фен для укладання вдома', 'фен для щоденного укладання', 'фен для короткого волосся', 'фен для довгого волосся', 'фен для сушіння після миття', 'прилад для сушіння волосся', 'прилад для укладання волосся', 'фен для домашнього використання', 'фен для охайного укладання', 'фен для об’єму волосся', 'фен для випрямлення волосся', 'фен із насадками', 'фен для жінок', 'фен для чоловіків', 'фен для поїздок', 'компактний фен для волосся', 'електричний фен для волосся', 'фен для салону та дому'],
    2: ['стайлер для волосся', 'мультистайлер для волосся', 'стайлер для укладання волосся', 'прилад для укладання волосся', 'стайлер для локонів', 'стайлер для хвиль', 'стайлер для випрямлення волосся', 'стайлер для завивання волосся', 'мультистайлер для дому', 'стайлер для домашнього укладання', 'електричний стайлер для волосся', 'стайлер із насадками', 'стайлер 3 в 1 для волосся', 'стайлер 4 в 1 для волосся', 'стайлер 5 в 1 для волосся', 'пристрій для укладання волосся', 'прилад для створення локонів', 'прилад для зміни образу', 'стайлер для довгого волосся', 'стайлер для короткого волосся', 'стайлер для щоденного укладання', 'стайлер для святкового укладання', 'стайлер для дому та поїздок', 'набір для укладання волосся', 'інструмент для укладання волосся'],
    3: ['плойка для волосся', 'щипці для завивання волосся', 'плойка для локонів', 'плойка для хвиль', 'електрична плойка для волосся', 'плойка для домашнього укладання', 'плойка для завивання волосся', 'прилад для створення локонів', 'плойка для красивих локонів', 'плойка для м’яких хвиль', 'плойка для довгого волосся', 'плойка для короткого волосся', 'плойка для щоденного укладання', 'плойка для святкової зачіски', 'щипці для локонів', 'інструмент для завивання волосся', 'плойка з регулюванням температури', 'плойка з керамічним покриттям', 'плойка для укладання пасом', 'прилад для завивання вдома', 'плойка для об’єму волосся', 'плойка для жіночого укладання', 'плойка для салону та дому', 'компактна плойка для волосся', 'стайлер для створення локонів'],
    4: ['випрямляч для волосся', 'праска для волосся', 'щипці для випрямлення волосся', 'випрямляч для укладання волосся', 'електричний випрямляч для волосся', 'випрямляч для волосся вдома', 'праска для гладкого волосся', 'прилад для випрямлення волосся', 'випрямляч для довгого волосся', 'випрямляч для короткого волосся', 'випрямляч для щоденного укладання', 'випрямляч для пасом', 'праска для створення укладання', 'випрямляч із регулюванням температури', 'випрямляч із керамічним покриттям', 'щипці для гладкості волосся', 'інструмент для випрямлення волосся', 'випрямляч для домашнього догляду', 'прилад для розгладження волосся', 'праска для жіночого укладання', 'випрямляч для салону та дому', 'компактна праска для волосся', 'випрямляч для охайної зачіски', 'праска для підготовки пасом', 'прилад для укладання прямого волосся'],
    5: ['щипці гофре для волосся', 'плойка гофре для волосся', 'праска гофре для волосся', 'щипці для прикореневого об’єму', 'гофре для створення об’єму', 'гофре для текстури волосся', 'електричні щипці гофре', 'прилад гофре для укладання', 'щипці гофре для дому', 'гофре для домашнього укладання', 'гофре для довгого волосся', 'гофре для короткого волосся', 'гофре для акцентних пасом', 'щипці для хвиль на волоссі', 'прилад для прикореневого об’єму', 'інструмент для текстурування волосся', 'щипці для укладання волосся', 'гофре для щоденного укладання', 'гофре для святкової зачіски', 'щипці гофре з регулюванням температури', 'праска для об’єму волосся', 'плойка для прикореневого об’єму', 'гофре для створення хвиль', 'прилад для укладання гофре', 'щипці для красивої текстури'],
  };
  const list = [...phrases[group]];
  const coating = findAttr(product, /покритт/);
  const speed = findAttr(product, /кількість швидкост/);
  const temp = findAttr(product, /температур/);
  const power = titleData.power;
  if (power) list.push(isRu ? `${group === 1 ? 'фен' : group === 3 ? 'плойка' : group === 4 ? 'выпрямитель' : 'стайлер'} ${power.toLowerCase()}` : `${group === 1 ? 'фен' : group === 3 ? 'плойка' : group === 4 ? 'випрямляч' : 'стайлер'} ${power.toLowerCase()}`);
  if (speed) list.push(isRu ? `прибор для укладки с ${translateValueRu(speed)} скоростями` : `прилад для укладання з ${speed} швидкостями`);
  if (temp) list.push(isRu ? 'прибор для укладки с температурными режимами' : 'прилад для укладання з температурними режимами');
  if (coating && /керамі|керам/i.test(coating)) list.push(isRu ? 'прибор для укладки с керамическим покрытием' : 'прилад для укладання з керамічним покриттям');
  const banned = [normalize(product.name), normalize(product.code), normalize(product.sourceCode), 'ug opt', 'поставщик', 'supplier'];
  const safe = unique(list).filter((x) => !banned.some((b) => b && normalize(x).includes(b)));
  while (safe.length > 25 && safe.join(', ').length > 1024) safe.pop();
  return safe.slice(0, 35).join(', ');
}

function shortHtml(product, group, lang, titleData, maxChars) {
  const title = lang === 'ru' ? titleData.ru : titleData.ua;
  const sentence = lang === 'ru' ? `Помогает ${actionText(group, 'ru')} дома.` : `Допомагає ${actionText(group, 'ua')} вдома.`;
  const html = `<p>${esc(title)}. ${esc(sentence)}</p>`;
  return html.length <= maxChars ? html : `<p>${esc(title)}</p>`;
}

function getPhotoLinks(product) {
  const folder = `${String(product.index).padStart(3, '0')}_${product.code}`;
  const localNames = [
    (fs.readdir(path.join(finalRoot, folder))).then((names) => names.find((x) => /^01_main\.png$/i.test(x))),
    (fs.readdir(path.join(finalRoot, folder))).then((names) => names.find((x) => /^02_benefit/i.test(x))),
    (fs.readdir(path.join(finalRoot, folder))).then((names) => names.find((x) => /^03_feature/i.test(x))),
    (fs.readdir(path.join(finalRoot, folder))).then((names) => names.find((x) => /^04_use\.png$/i.test(x))),
    (fs.readdir(path.join(finalRoot, folder))).then((names) => names.find((x) => /^05_detail/i.test(x))),
  ];
  return Promise.all(localNames).then((names) => names.map((name) => {
    if (!name) return '';
    const item = driveMap[`${photoPrefix}${folder}-${name}`];
    return item?.id ? `https://lh3.googleusercontent.com/d/${item.id}=w1280` : '';
  }));
}

const columns = [
  'Код_товару', 'Назва_позиції', 'Назва_позиції_укр', 'Пошукові_запити', 'Пошукові_запити_укр', 'Опис', 'Опис_укр', 'Тип_товару', 'Ціна', 'Валюта', 'Одиниця_виміру', 'Мінімальний_обсяг_замовлення', 'Оптова_ціна', 'Мінімальне_замовлення_опт', 'Посилання_зображення', 'Наявність', 'Кількість', 'Номер_групи', 'Назва_групи', 'Посилання_підрозділу', 'Можливість_поставки', 'Термін_поставки', 'Спосіб_пакування', 'Спосіб_пакування_укр', 'Унікальний_ідентифікатор', 'Ідентифікатор_товару', 'Ідентифікатор_підрозділу', 'Ідентифікатор_групи', 'Виробник', 'Країна_виробник', 'Знижка', 'ID_групи_різновидів', 'Особисті_нотатки', 'Продукт_на_сайті', 'Термін_дії_знижки_від', 'Термін_дії_знижки_до', 'Ціна_від', 'Ярлик', 'HTML_заголовок', 'HTML_заголовок_укр', 'HTML_опис', 'HTML_опис_укр', 'Код_маркування_(GTIN)', 'Номер_пристрою_(MPN)', 'Вага,кг', 'Ширина,см', 'Висота,см', 'Довжина,см', 'Де_знаходиться_товар', 'Товар_в_ProSale', 'Чому_товар_не_в_ProSale',
];
for (let i = 0; i < 19; i += 1) columns.push('Назва_Характеристики', 'Одиниця_виміру_Характеристики', 'Значення_Характеристики');

const letter = (index) => { let n = index; let out = ''; while (n >= 0) { out = String.fromCharCode((n % 26) + 65) + out; n = Math.floor(n / 26) - 1; } return out; };
const colIndex = Object.fromEntries(columns.map((x, i) => [x, i]));
const get = (row, name) => row[colIndex[name]];
const set = (row, name, value) => { row[colIndex[name]] = value; };

const productRows = [];
const photoQa = [];
for (const product of enriched) {
  const group = classify(product);
  const titleData = buildTitles(product, group);
  const sourceChars = [...product.characteristics];
  if (!sourceChars.some((x) => normalize(x.name) === 'виробник')) sourceChars.push({ name: 'Виробник', value: 'AND', unit: '' });
  if (!sourceChars.some((x) => normalize(x.name) === 'стан')) sourceChars.push({ name: 'Стан', value: 'Новий', unit: '' });
  const manufacturer = findAttr({ ...product, characteristics: sourceChars }, /^виробник$/i) || 'AND';
  const country = findAttr({ ...product, characteristics: sourceChars }, /країна виробник|страна производ/) || '';
  const rawPrice = Number(product.purchasePrice || product.price || 0) * 1.90 / 0.80;
  const finalPrice = Math.ceil(rawPrice);
  const expectedProfit = finalPrice * 0.80 - Number(product.purchasePrice || product.price || 0);
  const links = await getPhotoLinks(product);
  const row = new Array(columns.length).fill(null);
  set(row, 'Код_товару', `U${product.code}U`);
  set(row, 'Назва_позиції', titleData.ru);
  set(row, 'Назва_позиції_укр', titleData.ua);
  set(row, 'Пошукові_запити', keywordList({ ...product, characteristics: sourceChars }, group, 'ru', titleData));
  set(row, 'Пошукові_запити_укр', keywordList({ ...product, characteristics: sourceChars }, group, 'ua', titleData));
  set(row, 'Опис', renderDescription({ ...product, characteristics: sourceChars }, group, 'ru', titleData));
  set(row, 'Опис_укр', renderDescription({ ...product, characteristics: sourceChars }, group, 'ua', titleData));
  set(row, 'Тип_товару', 'r');
  set(row, 'Ціна', finalPrice);
  set(row, 'Валюта', 'UAH');
  set(row, 'Одиниця_виміру', 'шт.');
  set(row, 'Мінімальний_обсяг_замовлення', 1);
  set(row, 'Оптова_ціна', null);
  set(row, 'Мінімальне_замовлення_опт', null);
  set(row, 'Посилання_зображення', links.join(', '));
  set(row, 'Наявність', product.inStock === false ? '-' : '+');
  set(row, 'Номер_групи', group);
  set(row, 'Назва_групи', groupInfo[group].ua);
  set(row, 'Посилання_підрозділу', product.categorySourceUrl || '');
  set(row, 'Унікальний_ідентифікатор', Number(product.code));
  set(row, 'Ідентифікатор_товару', `U${product.code}U`);
  set(row, 'Ідентифікатор_підрозділу', product.categoryId ? Number(product.categoryId) : null);
  set(row, 'Ідентифікатор_групи', group);
  set(row, 'Виробник', manufacturer);
  set(row, 'Країна_виробник', country);
  set(row, 'Особисті_нотатки', `UGOPT_PROM_TIERED_V1 | закупівля ${Number(product.purchasePrice || product.price || 0).toFixed(2)} грн | комісія 20.00% | цільовий чистий прибуток 90.00% від закупівлі | очікуваний чистий прибуток ${expectedProfit.toFixed(2)} грн | ціна до округлення ${rawPrice.toFixed(2)} грн | RETAIL_ONLY | AI-фото: ${links.filter(Boolean).length}/5 | фото з папки Google Drive 1ON7z6_MnJwGCiM1w9wvjYNUynWRbHO5g`);
  set(row, 'HTML_заголовок', titleData.ru);
  set(row, 'HTML_заголовок_укр', titleData.ua);
  set(row, 'HTML_опис', shortHtml(product, group, 'ru', titleData, 250));
  set(row, 'HTML_опис_укр', shortHtml(product, group, 'ua', titleData, 270));
  set(row, 'Номер_пристрою_(MPN)', titleData.model || null);
  const charStart = 51;
  sourceChars.slice(0, 19).forEach((char, i) => {
    row[charStart + i * 3] = char.name;
    row[charStart + i * 3 + 1] = char.unit || null;
    row[charStart + i * 3 + 2] = char.value;
  });
  productRows.push(row);
  photoQa.push({ code: String(product.code), title: titleData.ua, group, price: finalPrice, purchasePrice: Number(product.purchasePrice || product.price || 0), images: links.length, nonEmptyImages: links.filter(Boolean).length, imageUrls: links, ruKeywordsChars: get(row, 'Пошукові_запити').length, uaKeywordsChars: get(row, 'Пошукові_запити_укр').length, ruKeywordsPhrases: get(row, 'Пошукові_запити').split(', ').length, uaKeywordsPhrases: get(row, 'Пошукові_запити_укр').split(', ').length, ruDescriptionChars: String(get(row, 'Опис') || '').replace(/<[^>]*>/g, '').length, uaDescriptionChars: String(get(row, 'Опис_укр') || '').replace(/<[^>]*>/g, '').length, htmlRuChars: get(row, 'HTML_опис').length, htmlUaChars: get(row, 'HTML_опис_укр').length, fetchError: product.fetchError || '' });
}

const workbook = Workbook.create();
const products = workbook.worksheets.add('Export Products Sheet');
const groups = workbook.worksheets.add('Export Groups Sheet');
products.showGridLines = false;
groups.showGridLines = false;
products.getRange(`A1:${letter(columns.length - 1)}${productRows.length + 1}`).values = [columns, ...productRows];
const groupRows = [1, 2, 3, 4, 5].map((id) => [id, groupInfo[id].ua, id, '', '']);
groups.getRange('A1:E6').values = [['Номер_групи', 'Назва_групи', 'Ідентифікатор_групи', 'Номер_родителя', 'Ідентифікатор_родителя'], ...groupRows];

products.getRange(`A1:${letter(columns.length - 1)}1`).format = { fill: '#1F4E78', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, wrapText: true, horizontalAlignment: 'center', verticalAlignment: 'center' };
groups.getRange('A1:E1').format = { fill: '#1F4E78', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, wrapText: true, horizontalAlignment: 'center', verticalAlignment: 'center' };
products.getRange(`A2:${letter(columns.length - 1)}${productRows.length + 1}`).format = { font: { name: 'Arial', size: 10, color: '#202124' }, verticalAlignment: 'center', wrapText: true };
groups.getRange('A2:E6').format = { font: { name: 'Arial', size: 10, color: '#202124' }, verticalAlignment: 'center' };
products.getRange(`A1:${letter(columns.length - 1)}${productRows.length + 1}`).format.borders = { preset: 'outside', style: 'thin', color: '#D9E2F3' };
products.getRange('I2:I51').format.numberFormat = '#,##0';
products.getRange('Y2:Y51').format.numberFormat = '0';
products.getRange('AA2:AB51').format.numberFormat = '0';
products.getRange('A1:DD1').format.rowHeight = 34;
products.getRange('A2:DD51').format.rowHeight = 110;
groups.getRange('A1:E6').format.borders = { preset: 'all', style: 'thin', color: '#D9E2F3' };
groups.getRange('A1:E6').format.rowHeight = 24;
products.freezePanes.freezeRows(1);
products.freezePanes.freezeColumns(2);
groups.freezePanes.freezeRows(1);
for (const [col, width] of Object.entries({ A: 15, B: 42, C: 42, D: 58, E: 58, F: 62, G: 62, H: 14, I: 12, J: 10, K: 13, L: 16, M: 14, N: 18, O: 58, P: 11, Q: 10, R: 12, S: 30, T: 38, Y: 18, Z: 18, AA: 18, AB: 15, AC: 18, AD: 18, AG: 65, AM: 42, AN: 42, AO: 45, AP: 45 })) products.getRange(`${col}1:${col}51`).format.columnWidth = width;
for (const col of ['W', 'X', 'U', 'V', 'AE', 'AF', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AV', 'AW', 'AX', 'AY']) products.getRange(`${col}1:${col}51`).format.columnWidth = 14;
for (let i = 50; i < columns.length; i += 3) { products.getRange(`${letter(i)}1:${letter(i + 2)}51`).format.columnWidth = 20; }
groups.getRange('A1:E6').format.columnWidth = 26;
groups.getRange('B1:B6').format.columnWidth = 38;

products.tables.add(`A1:${letter(columns.length - 1)}${productRows.length + 1}`, true, 'PromProducts');
groups.tables.add('A1:E6', true, 'PromGroups');
workbook.recalculate();

const formulaErrors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!', options: { useRegex: true, maxResults: 100 }, summary: 'Prom workbook formula error scan' });
const productPreview = await workbook.render({ sheetName: 'Export Products Sheet', range: 'A1:T12', scale: 1, format: 'png' });
await fs.writeFile(path.join(outputDir, 'products-preview.png'), new Uint8Array(await productPreview.arrayBuffer()));
const groupPreview = await workbook.render({ sheetName: 'Export Groups Sheet', range: 'A1:E6', scale: 1, format: 'png' });
await fs.writeFile(path.join(outputDir, 'groups-preview.png'), new Uint8Array(await groupPreview.arrayBuffer()));
const out = await SpreadsheetFile.exportXlsx(workbook);
await out.save(outputPath);

const qa = {
  outputPath,
  products: productRows.length,
  photosExpected: productRows.length * 5,
  photosNonEmpty: photoQa.reduce((sum, row) => sum + row.nonEmptyImages, 0),
  allProductsHaveFiveImages: photoQa.every((row) => row.nonEmptyImages === 5),
  allCategoriesFilled: productRows.every((row) => String(get(row, 'Назва_групи') || '').trim() !== ''),
  allUniqueIdentifiersNumeric: productRows.every((row) => typeof get(row, 'Унікальний_ідентифікатор') === 'number' && Number.isFinite(get(row, 'Унікальний_ідентифікатор'))),
  retailOnly: productRows.every((row) => !get(row, 'Оптова_ціна') && !get(row, 'Мінімальне_замовлення_опт')),
  ruKeywordsAtLeast25: photoQa.every((row) => row.ruKeywordsPhrases >= 25),
  uaKeywordsAtLeast25: photoQa.every((row) => row.uaKeywordsPhrases >= 25),
  keywordsWithin1024: photoQa.every((row) => row.ruKeywordsChars <= 1024 && row.uaKeywordsChars <= 1024),
  descriptionsAtLeast1000: photoQa.every((row) => row.ruDescriptionChars >= 1000 && row.uaDescriptionChars >= 1000),
  htmlLimits: photoQa.every((row) => row.htmlRuChars <= 250 && row.htmlUaChars <= 270),
  formulaErrors: formulaErrors.ndjson || '',
  sourceFetchErrors: photoQa.filter((row) => row.fetchError).map((row) => ({ code: row.code, error: row.fetchError })),
  photoQa,
};
await fs.writeFile(path.join(outputDir, 'prom-ready-qa.json'), JSON.stringify(qa, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, products: qa.products, photosNonEmpty: qa.photosNonEmpty, allProductsHaveFiveImages: qa.allProductsHaveFiveImages, allCategoriesFilled: qa.allCategoriesFilled, allUniqueIdentifiersNumeric: qa.allUniqueIdentifiersNumeric, retailOnly: qa.retailOnly, ruKeywordsAtLeast25: qa.ruKeywordsAtLeast25, uaKeywordsAtLeast25: qa.uaKeywordsAtLeast25, keywordsWithin1024: qa.keywordsWithin1024, htmlLimits: qa.htmlLimits, sourceFetchErrors: qa.sourceFetchErrors.length, formulaErrors: qa.formulaErrors }));
