import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workspace = "C:/Users/Dell/Documents/ChatGPT/пром";
const sourceExportPath = "C:/Users/Dell/Downloads/export-products-23-08-26_23-58-38.xlsx";
const batchDir = `${workspace}/outputs/prom-product-factory-2026-08-24`;
const outputPath = `${batchDir}/Prom-UGOPT-100-with-photos-2026-08-25.xlsx`;
const commissionPath = `${workspace}/outputs/prom-product-factory-2026-08-23/reference/commission-A4-J4296.json`;
const sourceDir = `${workspace}/outputs/prom-product-factory-2026-08-23/source-data`;
const aiDriveImageIdsPath = `${batchDir}/batch-10-ai-photos/drive-image-ids-batch-10.json`;
let aiDriveImageIds = {};

const categoryBySku = {
  "0149": "151604", "34621": "33915", "34012": "63018", "34020": "15230436", "10962": "15230447",
  "14230": "154003", "14239": "810103", "34663": "15380313", "34668": "230620", "34675": "151405",
  "34722": "64410", "34728": "301010", "9230": "33915", "9231": "33915", "10383": "63018",
  "34764": "151403", "34767": "154003", "51378": "15230499", "34769": "151606", "34777": "162217",
  "34808": "130103", "51149": "4050705", "35991": "1343", "35837": "15230502", "7129": "1250341",
  "8861": "15230419", "54692": "371039", "35851": "4050705", "35853": "153722", "51236": "151405",
  "24260": "64311", "51772": "618", "8227": "15230501", "35871": "130119", "35917": "37034007",
  "35918": "152220", "35983": "151412", "35984": "151412", "35992": "1343", "35993": "1343",
  "36004": "15230501", "10548": "15230502", "13351": "151405", "10345": "162516", "36016": "130103",
  "5117": "153809", "23529": "14200312", "36064": "161314", "36065": "161314", "36066": "161314",
  "24307": "1534", "23757": "1250341", "35359": "121251", "35358": "121251", "36080": "121251",
  "24323": "1534", "23771": "151405", "35754": "1343", "36090": "1343", "36091": "1343",
  "36092": "1343", "36093": "1343", "34912": "154001", "57889": "161314", "36105": "154003",
  "36111": "1250353", "34500": "63018", "51644": "400902", "35054": "230620", "35066": "151403",
  "3688": "6371818", "10286": "13240508", "34801": "230620", "51740": "1620", "96306": "14201626",
  "34088": "1250341", "51494": "301514", "6824": "2652", "34553": "4050705", "23775": "230620",
  "61098": "3390101", "61133": "63011", "1964": "5090318", "61240": "16110904", "10257": "130119",
  "51500": "15230406", "35819": "154003", "10215": "151405", "3251": "5091001", "10583": "170702",
  "10610": "154009", "61169": "32710", "23543": "162504", "51057": "1527", "51493": "301514",
  "3346": "153722", "51766": "200317", "10411": "36090301", "34208": "154102", "34803": "130105",
};

const categoryUrlBySku = {
  "0149": "https://prom.ua/Napolnye-sushilki-dlya-belya",
  "34621": "https://prom.ua/Dozhdeviki",
  "34012": "https://prom.ua/Sushki-dlya-obuvi.html",
  "34020": "https://prom.ua/Kuhonnye-sushki",
  "10962": "https://prom.ua/Podstavki-dlya-kuhonnyh-i-stolovyh-prinadlezhnostej",
  "14230": "https://prom.ua/Prinadlezhnosti-dlya-vannoj",
  "14239": "https://prom.ua/Pompy-dlya-vody",
  "34663": "https://prom.ua/Dvernye-ogranichiteli",
  "34668": "https://prom.ua/Klejkaya-upakovochnaya-lenta",
  "34675": "https://prom.ua/Schetki-dlya-chistki",
};

const ruReplacements = [
  ["Підлогова", "Напольная"], ["електросушарка", "электросушилка"], ["білизни", "белья"], ["Дощовик", "Дождевик"],
  ["сушарки", "сушилки"], ["дощовики", "дождевики"], ["помпи", "помпы"], ["щітки", "щетки"], ["скребачки", "скребки"],
  ["кухонні", "кухонные"], ["кімнатні", "комнатные"], ["віконні", "оконные"], ["дверні", "дверные"], ["побуту", "быта"], ["прибирання", "уборки"],
  ["Сушарка", "Сушилка"], ["сушарка", "сушилка"], ["взуття", "обуви"], ["посуду", "посуды"], ["Тримач", "Держатель"],
  ["начиння", "утвари"], ["мочалок", "мочалок"], ["мильницею", "мыльницей"], ["натискна", "нажимная"], ["електрична", "электрическая"],
  ["Блокіратор", "Блокиратор"], ["дверної ручки", "дверной ручки"], ["захист дітей", "защита детей"], ["Багаторазова", "Многоразовая"],
  ["кріпильна стрічка", "крепежная лента"], ["Багатофункціональна щітка", "Многофункциональная щетка"], ["щітка", "щетка"],
  ["Паперовий фільтр", "Бумажный фильтр"], ["Дверний замок із сенсором і паролем", "Дверной замок с сенсором и паролем"],
  ["Плащ-намет пончо-накидка від дощу", "Плащ-палатка пончо-накидка от дождя"], ["Складана", "Складная"], ["М'який чохол", "Мягкий чехол"],
  ["Серветки безворсові багаторазові в рулоні для прибирання", "Безворсовые многоразовые салфетки в рулоне для уборки"],
  ["Захисний екран для кухні", "Защитный экран для кухни"], ["Тканинний кошик для білизни", "Тканевая корзина для белья"],
  ["Змішувач умивальник", "Смеситель для умывальника"], ["Килимок для холодильника", "Коврик для холодильника"],
  ["Самоклейна плівка", "Самоклеящаяся пленка"], ["Жиронепроникний папір", "Жиростойкая бумага"], ["Аератор для крана змішувача", "Аэратор для крана-смесителя"],
  ["Насадка для крана з фільтром", "Насадка для крана с фильтром"], ["Силіконова форма для морозива", "Силиконовая форма для мороженого"],
  ["Аромадифузор", "Аромадиффузор"], ["Антивібраційні", "Антивибрационные"], ["підставки", "подставки"],
  ["Термометр", "Термометр"], ["Магнітна щітка для миття вікон", "Магнитная щетка для мытья окон"], ["Електроморозь, машина для приготування морозива", "Электромороженица, машина для приготовления мороженого"],
  ["Лампа-вентилятор", "Лампа-вентилятор"], ["Пакети для вакуумного пакувальника", "Пакеты для вакуумного упаковщика"], ["Душова система для ванної кімнати", "Душевая система для ванной комнаты"],
  ["Приліжковий столик", "Прикроватный столик"], ["Контейнер для зберігання яєць", "Контейнер для хранения яиц"], ["Відро для сміття", "Ведро для мусора"],
  ["Папір для аерофритюрниці", "Бумага для аэрогриля"], ["Щітка для миття посуду", "Щетка для мытья посуды"], ["Антимоскітна сітка", "Антимоскитная сетка"],
  ["Автоматичний робот для миття вікон", "Автоматический робот для мытья окон"], ["Портативна коробка для таблеток", "Портативная коробка для таблеток"],
  ["Кейс для зберігання таблеток", "Кейс для хранения таблеток"], ["Гнучке прямокутне дзеркало на стіну", "Гибкое прямоугольное зеркало на стену"],
  ["Сонцезахисна шторка", "Солнцезащитная шторка"], ["Плівка на вікно сонцезахисна дзеркальна", "Солнцезащитная зеркальная пленка на окно"],
  ["Туалетний йоржик із силіконовою щіткою", "Туалетный ершик с силиконовой щеткой"], ["Таблетниця", "Таблетница"], ["Крабік-кріплення для рослин", "Крабик-крепление для растений"],
  ["Складана тростина для ходьби", "Складная трость для ходьбы"], ["Гучномовець", "Громкоговоритель"], ["Палички від засорення раковин", "Палочки от засоров раковины"],
  ["Слуховий апарат", "Слуховой аппарат"], ["Набір для фарбування", "Набор для покраски"], ["Економач води", "Экономитель воды"], ["стерилізатор", "стерилизатор"],
  ["Світловідбивна", "Светоотражающая"], ["Килимок для танцю", "Коврик для танцев"], ["Баф-шарф", "Баф-шарф"], ["Портативна сушарка", "Портативная сушилка"],
  ["Антирадіаційні наклейки", "Антирадиационные наклейки"], ["Пульсометр-оксиметр", "Пульсоксиметр"], ["Душова лійка", "Душевая лейка"],
  ["Фруктовниця", "Фруктовница"], ["Самоклейна стрічка бордюр для ванни", "Самоклеящаяся бордюрная лента для ванной"], ["Самоочисна щітка від шерсті", "Самоочищающаяся щетка от шерсти"],
  ["Трекер брелок", "Трекер-брелок"], ["Брелок", "Брелок"], ["Тримач зубних щіток з автоматичним дозатором", "Держатель зубных щеток с автоматическим дозатором"],
  ["Шапка-маска", "Шапка-маска"], ["Персональний алкотестер", "Персональный алкотестер"], ["Парасолька складана навпаки", "Складной обратный зонт"],
  ["Світловідбивна стрічка", "Светоотражающая лента"], ["Маска для плавання", "Маска для плавания"], ["Браслет для антисептика", "Браслет для антисептика"],
  ["Органайзер для футболок", "Органайзер для футболок"], ["Диспенсер для зубної пасти", "Диспенсер для зубной пасты"], ["Країна виробник", "Страна производитель"],
  ["Стан", "Состояние"], ["Новий", "Новый"], ["Так", "Да"], ["Ні", "Нет"], ["Матеріал", "Материал"], ["Колір", "Цвет"],
  ["Кількість", "Количество"], ["Ширина", "Ширина"], ["Довжина", "Длина"], ["Висота", "Высота"], ["Вага", "Вес"], ["Тип", "Тип"],
  ["Призначення", "Назначение"], ["Живлення", "Питание"], ["Країна", "Страна"], ["Виробник", "Производитель"], ["Матеріал виготовлення", "Материал изготовления"],
  ["\\bЦе\\b", "Это"], ["\\bце\\b", "это"], ["\\bі\\b", "и"], ["\\bй\\b", "и"], ["\\bта\\b", "и"], ["\\bіз\\b", "с"], ["\\bз\\b", "с"], ["\\bпід\\b", "под"], ["\\bу\\b", "в"], ["\\bвід\\b", "от"],
  ["зберігання", "хранения"], ["зручн", "удобн"], ["ефективн", "эффективн"], ["швидк", "быстр"], ["висушув", "суш"], ["одяг", "одежд"], ["рушник", "полотенец"], ["текстил", "текстил"],
  ["переваги", "преимущества"], ["характеристики", "характеристики"], ["потужність", "мощность"], ["напруга", "напряжение"], ["живлення", "питание"], ["матеріал", "материал"], ["захист", "защита"], ["навантаження", "нагрузка"],
  ["дверної", "дверной"], ["дверний", "дверной"], ["двері", "двери"], ["плівка", "пленка"], ["плівки", "пленки"], ["стрічка", "лента"], ["стрічки", "ленты"], ["клейка", "клеящаяся"], ["самоклейна", "самоклеящаяся"], ["змішувач", "смеситель"], ["душова", "душевая"], ["душовий", "душевой"], ["кімнатн", "комнатн"], ["сонцезахисн", "солнцезащитн"], ["дзеркальн", "зеркальн"],
  ["яєц", "яиц"], ["яйця", "яйца"], ["сміття", "мусор"], ["відро", "ведро"], ["кошик", "корзин"], ["серветк", "салфетк"], ["підставк", "подставк"], ["вікон", "окон"], ["туалетний", "туалетный"], ["йоржик", "ершик"], ["тростин", "трость"], ["парасольк", "зонт"], ["гучномовец", "громкоговоритель"], ["дощовик", "дождевик"], ["новий", "новый"], ["виробник", "производитель"], ["країна", "страна"], ["плавання", "плавания"],
];

function translateBasic(value) {
  let result = String(value ?? "");
  for (const [from, to] of ruReplacements) {
    const raw = String(from).replaceAll("\\b", "");
    const escaped = raw.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
    const pattern = `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`;
    result = result.replace(new RegExp(pattern, "giu"), to);
  }
  return result;
}

function stripHtml(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}

function escapeHtml(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function sanitizePublicText(product, value = "") {
  return String(value)
    .replace(new RegExp(`\\b${product.code}\\b`, "gi"), "")
    .replace(/\bAND\s*[-–—]?\s*\d+\b/gi, "")
    .replace(/\b(?:MAG\s*[-–—]?\s*728|K16|FOLD\s+POT)\b/gi, "")
    .replace(/\b(?:AE|SB|XL|NJ|YLN|QC|RD|HTC|RT|AA\d*|PC|DL|LY|FOLD)\s*[-–—]?\s*(?=[A-ZА-Я])/gi, "")
    .replace(/\b(?:AE|SB|XL|NJ|YLN|QC|RD|HTC|RT|AA\d*|PC|DL|LY|FOLD)\s*[-–—]?\s*(?=\s|$|[,.!?;:])/gi, "")
    .replace(/\b(?:AE|SB|XL|NJ|YLN|QC|RD|HTC|RT|AA\d*|PC|DL|LY|FOLD)\s*[-–—]?\s*[A-ZА-Я]?\d[\w-]*\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanPublicName(product) {
  let value = stripHtml(product.name).replace(new RegExp(`\\b${product.code}\\b`, "gi"), "");
  value = value.replace(/\bAND\s*[-–—]?\s*\d+\b/gi, "");
  value = value.replace(/\b(?:MAG\s*[-–—]?\s*728|K16|FOLD\s+POT)\b/gi, "");
  value = value.replace(/\b(?:AE|SB|XL|NJ|YLN|QC|RD|HTC|RT|AA\d*|PC|DL|LY|FOLD)\s*[-–—]?\s*(?=[A-ZА-Я])/gi, "");
  value = value.replace(/\b(?:AE|SB|XL|NJ|YLN|QC|RD|HTC|RT|AA\d*|PC|DL|LY|FOLD)\s*[-–—]?\s*(?=\s|$|[,.!?;:])/gi, "");
  value = value.replace(/\b(?:AE|SB|XL|NJ|YLN|QC|RD|HTC|RT|AA\d*|PC|DL|LY|FOLD)\s*[-–—]?\s*[A-ZА-Я]?\d[\w-]*\b/gi, "");
  value = value.replace(/\b(?:AE|SB|XL|NJ|YLN|QC|RD|HTC|RT|AA\d*|PC|DL|LY|FOLD)\b/gi, "");
  value = value.replace(/(^|\s)-\s*/g, "$1").replace(/\s{2,}/g, " ").replace(/\s*[-–—]\s*$/g, "").trim();
  return value || "Товар для дому";
}

function manufacturerOf(product) {
  const found = product.chars?.find((c) => /^(виробник|производитель|бренд|brand)$/i.test(String(c.name).trim()));
  return found?.value?.trim() || null;
}

function charsFor(product) {
  const result = (product.chars || []).filter((c) => c?.name && c?.value).map((c) => ({ name: String(c.name).trim(), unit: String(c.unit || "").trim(), value: String(c.value).trim() }));
  const has = (needle) => result.some((c) => c.name.toLowerCase().includes(needle));
  if (!has("країна виробник")) result.push({ name: "Країна виробник", unit: "", value: "Китай" });
  if (!has("стан")) result.push({ name: "Стан", unit: "", value: "Новий" });
  return result.slice(0, 19);
}

function descriptionText(product, title, lang) {
  const sourceText = sanitizePublicText(product, stripHtml(product.description || ""));
  const translated = lang === "ru" ? translateBasic(sourceText) : sourceText;
  const intro = lang === "ru"
    ? `${title} — практичный товар для повседневного использования по своему назначению.`
    : `${title} — практичний товар для щоденного використання за своїм призначенням.`;
  const value = `${intro} ${translated}`.replace(/\s+/g, " ").trim();
  return value.length <= 1800 ? value : value.slice(0, 1800).replace(/\s+\S*$/, "").trim();
}

function htmlDescription(product, title, lang) {
  const sourceText = sanitizePublicText(product, stripHtml(product.description || ""));
  const translated = lang === "ru" ? translateBasic(sourceText) : sourceText;
  const prefix = lang === "ru" ? `${title}. ` : `${title}. `;
  const value = `${prefix}${translated}`.replace(/\s+/g, " ").trim();
  const max = lang === "ru" ? 250 : 270;
  if (value.length <= max) return value;
  const cutAt = value.lastIndexOf(" ", max);
  return value.slice(0, cutAt > 40 ? cutAt : max).trim().replace(/[,:;—-]+$/, "");
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item).toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactPhrase(value, max = 56) {
  const cleaned = String(value || "").replace(/[<>\[\]{}()|/\\]+/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const words = cleaned.split(" ");
  const result = [];
  for (const word of words) {
    const next = [...result, word].join(" ");
    if (next.length > max) break;
    result.push(word);
  }
  return result.join(" ") || cleaned.slice(0, max);
}

function keywords(product, title, categoryName, lang) {
  const ru = lang === "ru";
  const base = compactPhrase(sanitizePublicText(product, title).toLowerCase(), 24);
  const cat = compactPhrase((ru ? translateBasic(categoryName) : categoryName).toLowerCase(), 24);
  const featureValues = charsFor(product)
    .filter((c) => !/^(країна виробник|стан|виробник|производитель|бренд|brand)$/i.test(c.name))
    .map((c) => compactPhrase(sanitizePublicText(product, ru ? translateBasic(c.value) : c.value), 26))
    .filter((value) => value && !/\b(?:U\d+U|UG\s*[- ]?OPT|supplier|поставщик|source\s*code|internal\s*id|AE|SB|XL|NJ|YLN|QC|RD|HTC|RT|AA\d*|PC|DL|LY|FOLD)\b/i.test(value));
  const phrases = ru
    ? [base, `купить ${base}`, `заказать ${base}`, `${base} цена`, `${base} доставка`, `${base} украина`, `${base} онлайн`, `${base} для дома`, `${base} для быта`, `${base} ежедневно`, cat, `купить ${cat}`, `заказать ${cat}`, `${cat} цена`, `${cat} доставка`, `${cat} украина`, `${cat} для дома`, `${cat} для быта`, `аксессуары ${cat}`, `практичный ${base}`, `компактный ${base}`, `качественный ${base}`, ...featureValues.slice(0, 3).map((value) => `${base} ${value}`)]
    : [base, `купити ${base}`, `замовити ${base}`, `${base} ціна`, `${base} доставка`, `${base} україна`, `${base} онлайн`, `${base} для дому`, `${base} для побуту`, `${base} щодня`, cat, `купити ${cat}`, `замовити ${cat}`, `${cat} ціна`, `${cat} доставка`, `${cat} україна`, `${cat} для дому`, `${cat} для побуту`, `аксесуари ${cat}`, `практичний ${base}`, `компактний ${base}`, `якісний ${base}`, ...featureValues.slice(0, 3).map((value) => `${base} ${value}`)];
  const selected = [];
  for (const phrase of unique(phrases).map((value) => String(value).replace(/\s+/g, " ").trim())) {
    if (!phrase || selected.length >= 25) continue;
    const candidate = [...selected, phrase].join(", ");
    if (candidate.length <= 1024) selected.push(phrase);
  }
  const shortBase = compactPhrase(base, 20);
  const shortCat = compactPhrase(cat, 16);
  const fallback = ru ? [`купить ${shortBase}`, `${shortBase} цена`, `${shortBase} онлайн`, `доставка ${shortCat}`, `для дома ${shortCat}`, `для быта ${shortCat}`, `товар ${shortBase}`] : [`купити ${shortBase}`, `${shortBase} ціна`, `${shortBase} онлайн`, `доставка ${shortCat}`, `для дому ${shortCat}`, `для побуту ${shortCat}`, `товар ${shortBase}`];
  for (const phrase of fallback) {
    if (selected.length >= 25) break;
    const candidate = [...selected, phrase].join(", ");
    if (candidate.length <= 1024 && !selected.includes(phrase)) selected.push(phrase);
  }
  if (selected.length < 25) throw new Error(`${lang} keywords below 25 phrases for ${product.code}`);
  return selected.join(", ");
}

const expectedDelivery = 105;
const worstCaseDelivery = 120;
const netProfitTiers = [
  { max: 300, minNetProfit: 150, targetNetProfit: 200 },
  { max: 700, minNetProfit: 220, targetNetProfit: 300 },
  { max: 1500, minNetProfit: 350, targetNetProfit: 450 },
  { max: 3000, minNetProfit: 500, targetNetProfit: 650 },
  { max: 5000, minNetProfit: 700, targetNetProfit: 900 },
  { max: 7500, minNetProfit: 900, targetNetProfit: 1200 },
  { max: 10000, minNetProfit: 1100, targetNetProfit: 1500 },
  { max: Infinity, minNetProfit: null, targetNetProfit: null },
];

function netProfitTierFor(purchasePrice) {
  const tier = netProfitTiers.find((item) => purchasePrice <= item.max);
  if (tier.minNetProfit == null) return { minNetProfit: Math.max(1500, purchasePrice * 0.15), targetNetProfit: Math.max(2000, purchasePrice * 0.20) };
  return tier;
}

function netMetrics(finalPrice, purchasePrice, commission, deliveryCost) {
  const afterCommission = finalPrice * (1 - commission);
  const profit = afterCommission - purchasePrice - deliveryCost;
  return { afterCommission, profit };
}

function priceFor(product, category) {
  const purchasePrice = Number(product.price);
  if (!(purchasePrice > 0)) throw new Error(`invalid purchase price for ${product.code}`);
  const tier = netProfitTierFor(purchasePrice);
  const targetRaw = (purchasePrice + expectedDelivery + tier.targetNetProfit) / (1 - category.commission);
  let finalPrice = Math.ceil(targetRaw);
  while (netMetrics(finalPrice, purchasePrice, category.commission, worstCaseDelivery).profit < tier.minNetProfit) finalPrice += 1;
  const expected = netMetrics(finalPrice, purchasePrice, category.commission, expectedDelivery);
  const worstCase = netMetrics(finalPrice, purchasePrice, category.commission, worstCaseDelivery);
  if (worstCase.profit < tier.minNetProfit) throw new Error(`net profit below minimum for ${product.code}`);
  return { purchasePrice, expectedDelivery, worstCaseDelivery, commissionPercent: category.commission * 100, targetRaw, finalPrice, minNetProfit: tier.minNetProfit, targetNetProfit: tier.targetNetProfit, expectedNetProfit: expected.profit, worstCaseNetProfit: worstCase.profit, raw: targetRaw };
}

function colLetter(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

function rowFor(product, category, pricing, headers) {
  const titleUa = cleanPublicName(product);
  const titleRu = translateBasic(titleUa);
  const chars = charsFor(product);
  const row = Array(headers.length).fill(null);
  const set = (name, value) => { const i = headers.indexOf(name); if (i >= 0) row[i] = value; };
  const aiNames = ["01_main.png", "02_benefits.png", "03_features.png", "04_use.png", "05_details.png"];
  const aiLinks = aiNames.map((name) => aiDriveImageIds[`${product.code}/${name}`] ? `https://drive.google.com/file/d/${aiDriveImageIds[`${product.code}/${name}`]}/view?usp=drive_link` : null);
  const sourceImages = (product.images || []).filter(Boolean);
  while (sourceImages.length < 5 && sourceImages.length > 0) sourceImages.push(sourceImages[sourceImages.length - 1]);
  const imageLinks = aiLinks.every(Boolean) ? aiLinks.join(", ") : sourceImages.slice(0, 5).join(", ");
  const descRu = descriptionText(product, titleRu, "ru");
  const descUa = descriptionText(product, titleUa, "ua");
  const htmlRu = htmlDescription(product, titleRu, "ru");
  const htmlUa = htmlDescription(product, titleUa, "ua");
  set("Код_товару", `U${product.code}U`);
  set("Назва_позиції", titleRu);
  set("Назва_позиції_укр", titleUa);
  set("Пошукові_запити", keywords(product, titleRu, category.name, "ru"));
  set("Пошукові_запити_укр", keywords(product, titleUa, category.name, "ua"));
  set("Опис", descRu);
  set("Опис_укр", descUa);
  set("Тип_товару", "r");
  set("Ціна", pricing.finalPrice);
  set("Валюта", "UAH");
  set("Одиниця_виміру", "шт.");
  set("Мінімальний_обсяг_замовлення", 1);
  set("Оптова_ціна", null);
  set("Мінімальне_замовлення_опт", null);
  set("Посилання_зображення", imageLinks);
  set("Наявність", product.inStock ? "+" : "-");
  set("Посилання_підрозділу", null);
  set("Ідентифікатор_товару", `U${product.code}U`);
  set("Унікальний_ідентифікатор", null);
  set("Ідентифікатор_підрозділу", String(category.id));
  set("Посилання_підрозділу", categoryUrlBySku[String(product.code)] || null);
  set("Виробник", manufacturerOf(product));
  set("Країна_виробник", "Китай");
  set("HTML_заголовок", titleRu);
  set("HTML_заголовок_укр", titleUa);
  set("HTML_опис", htmlRu);
  set("HTML_опис_укр", htmlUa);
  const charStart = headers.indexOf("Назва_Характеристики");
  for (let i = 0; i < chars.length && charStart + i * 3 + 2 < row.length; i++) {
    row[charStart + i * 3] = chars[i].name;
    row[charStart + i * 3 + 1] = chars[i].unit || null;
    row[charStart + i * 3 + 2] = chars[i].value;
  }
  return row;
}

function rowNonEmpty(row) { return row.some((v) => v !== null && v !== ""); }

await fs.mkdir(batchDir, { recursive: true });
aiDriveImageIds = JSON.parse(await fs.readFile(aiDriveImageIdsPath, "utf8"));
const sourceFiles = (await fs.readdir(sourceDir)).filter((name) => /^selected-\d+/.test(name)).sort();
const sourceProducts = [];
for (const file of sourceFiles) sourceProducts.push(...JSON.parse(await fs.readFile(`${sourceDir}/${file}`, "utf8")));
const commissionRows = JSON.parse(await fs.readFile(commissionPath, "utf8"));
const commissionById = new Map(commissionRows.slice(1).map((row) => [String(row[6]), { id: String(row[6]), name: String(row[7]), commission: Number(String(row[9]).replace("%", "").replace(",", ".")) / 100, path: row.slice(0, 5).filter(Boolean).join(" > ") }]));

const input = await FileBlob.load(sourceExportPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const productSheet = workbook.worksheets.getItem("Export Products Sheet");
const groupSheet = workbook.worksheets.getItem("Export Groups Sheet");
const productValues = productSheet.getUsedRange().values;
const headers = productValues[0];
if (headers.length !== 108) throw new Error(`Expected 108 source columns, got ${headers.length}`);
const existingCodes = new Set(productValues.slice(1).map((row) => String(row[0] ?? "").trim().toUpperCase()).filter(Boolean));
const selected = sourceProducts.filter((product) => !existingCodes.has(`U${product.code}U`)).slice(0, 100);
if (selected.length !== 100) throw new Error(`Expected 100 new products, got ${selected.length}`);

const records = selected.map((product) => {
  const categoryId = categoryBySku[String(product.code)];
  if (!categoryId) throw new Error(`No controlled category mapping for SKU ${product.code}`);
  const category = commissionById.get(String(categoryId));
  if (!category) throw new Error(`Commission category ${categoryId} not found for SKU ${product.code}`);
  const pricing = priceFor(product, category);
  return { product, category, pricing, row: rowFor(product, category, pricing, headers) };
});

// The updated export is the source of truth for headers and types; the final import file is a new 100-row batch.
const lastCol = colLetter(headers.length - 1);
productSheet.getRange(`A102:${lastCol}515`).clear();
productSheet.getRange(`A1:${lastCol}${selected.length + 1}`).values = [headers, ...records.map((r) => r.row)];
productSheet.showGridLines = false;
groupSheet.showGridLines = false;
productSheet.freezePanes.freezeRows(1);
groupSheet.freezePanes.freezeRows(1);

const headerFormat = { fill: "#1F4E78", font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
productSheet.getRange(`A1:${lastCol}1`).format = headerFormat;
productSheet.getRange(`A1:${lastCol}${selected.length + 1}`).format.verticalAlignment = "top";
productSheet.getRange(`A2:${lastCol}${selected.length + 1}`).format.wrapText = true;
productSheet.getRange(`A1:${lastCol}1`).format.rowHeight = 38;
productSheet.getRange(`A2:${lastCol}${selected.length + 1}`).format.rowHeight = 92;
productSheet.getRange(`I2:I${selected.length + 1}`).format.numberFormat = "0";
const widths = [16, 38, 40, 44, 44, 58, 58, 12, 12, 10, 12, 18, 14, 18, 72, 12, 12, 12, 28, 22, 22, 18, 18, 18, 18, 18, 18, 18, 24, 18, 14, 18, 22, 24, 18, 18, 12, 18, 38, 38, 58, 58, 18, 18, 12, 12, 12, 12, 18, 14, 28];
for (let i = 51; i < headers.length; i++) widths[i] = i % 3 === 0 ? 24 : i % 3 === 1 ? 10 : 28;
for (let i = 0; i < headers.length; i++) productSheet.getRange(`${colLetter(i)}1:${colLetter(i)}${selected.length + 1}`).format.columnWidth = widths[i] || 18;

const publicContentHeaders = ["Назва_позиції", "Назва_позиції_укр", "Пошукові_запити", "Пошукові_запити_укр", "Опис", "Опис_укр", "HTML_заголовок", "HTML_заголовок_укр", "HTML_опис", "HTML_опис_укр"];
const forbiddenPublicToken = /\b(?:U\d+U|AE\s*[-–—]?\s*\d+|SB\s*[-–—]?\s*\d+|XL\s*[-–—]?\s*\d+|NJ\s*[-–—]?\s*\d+|YLN\s*[-–—]?\s*\d+|QC\s*[-–—]?\s*\d+|RD\s*[-–—]?\s*\d+|HTC\s*[-–—]?\s*\d+|RT\s*[-–—]?\s*\d+|AA\d*\s*[-–—]?\s*\d+|MAG\s*[-–—]?\s*728|K16|FOLD\s+POT|UG\s*[- ]?OPT|supplier|поставщик|source\s*(?:url|code)|internal\s*id)\b/i;
const importQaErrors = [];
const productIdentifierIndex = headers.indexOf("Ідентифікатор_товару");
const uniqueIdentifierIndex = headers.indexOf("Унікальний_ідентифікатор");
const categoryIdentifierIndex = headers.indexOf("Ідентифікатор_підрозділу");
const categoryLinkIndex = headers.indexOf("Посилання_підрозділу");
const wholesalePriceIndex = headers.indexOf("Оптова_ціна");
const wholesaleMinimumIndex = headers.indexOf("Мінімальне_замовлення_опт");
const imageIndex = headers.indexOf("Посилання_зображення");
const htmlDescriptionRuIndex = headers.indexOf("HTML_опис");
const htmlDescriptionUaIndex = headers.indexOf("HTML_опис_укр");
for (const record of records) {
  const row = record.row;
  if (!String(row[productIdentifierIndex] || "").trim()) importQaErrors.push(`${record.product.code}:missing product identifier`);
  if (String(row[uniqueIdentifierIndex] || "").trim()) importQaErrors.push(`${record.product.code}:unexpected marketplace unique identifier`);
  if (!String(row[categoryIdentifierIndex] || "").trim()) importQaErrors.push(`${record.product.code}:missing category identifier`);
  if (String(row[wholesalePriceIndex] || "").trim() || String(row[wholesaleMinimumIndex] || "").trim()) importQaErrors.push(`${record.product.code}:wholesale fields must be empty`);
  if (!String(row[imageIndex] || "").trim()) importQaErrors.push(`${record.product.code}:missing image links`);
  if (String(row[htmlDescriptionRuIndex] || "").length > 250) importQaErrors.push(`${record.product.code}:RU HTML description too long`);
  if (String(row[htmlDescriptionUaIndex] || "").length > 270) importQaErrors.push(`${record.product.code}:UA HTML description too long`);
  for (const header of publicContentHeaders) {
    const index = headers.indexOf(header);
    const value = index >= 0 ? String(row[index] || "") : "";
    if (forbiddenPublicToken.test(value)) importQaErrors.push(`${record.product.code}:${header}:forbidden token`);
  }
  if (String(row[3] || "").split(",").filter(Boolean).length < 25) importQaErrors.push(`${record.product.code}:RU keywords below 25`);
  if (String(row[4] || "").split(",").filter(Boolean).length < 25) importQaErrors.push(`${record.product.code}:UA keywords below 25`);
}
if (importQaErrors.length) throw new Error(`Import QA failed: ${importQaErrors.slice(0, 30).join(", ")}`);

const pricingSheet = workbook.worksheets.add("Pricing QA");
const pricingHeaders = ["Код", "Товар", "Категорія Prom", "Закупівля UG OPT, грн", "Комісія Prom, %", "Доставка очікувана, грн", "Доставка worst-case, грн", "Мінімальна чиста прибуток, грн", "Цільова чиста прибуток, грн", "Ціна продажу, грн", "Чистий прибуток очікуваний, грн", "Чистий прибуток worst-case, грн", "QA"];
const pricingRows = records.map(({ product, category, pricing }) => [
  product.code,
  cleanPublicName(product),
  category.name,
  pricing.purchasePrice,
  pricing.commissionPercent,
  pricing.expectedDelivery,
  pricing.worstCaseDelivery,
  pricing.minNetProfit,
  pricing.targetNetProfit,
  pricing.finalPrice,
  pricing.expectedNetProfit,
  pricing.worstCaseNetProfit,
  pricing.worstCaseNetProfit >= pricing.minNetProfit ? "PASS" : "LOW_MARGIN_PRODUCT",
]);
pricingSheet.getRange(`A1:M${pricingRows.length + 1}`).values = [pricingHeaders, ...pricingRows];
pricingSheet.showGridLines = false;
pricingSheet.freezePanes.freezeRows(1);
pricingSheet.getRange("A1:M1").format = { fill: "#1F4E78", font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
pricingSheet.getRange("A1:M1").format.rowHeight = 42;
pricingSheet.getRange(`A2:M${pricingRows.length + 1}`).format = { verticalAlignment: "top", wrapText: true, rowHeight: 34 };
const pricingWidths = [12, 42, 28, 18, 15, 18, 20, 22, 22, 16, 24, 26, 22];
for (let i = 0; i < pricingHeaders.length; i++) pricingSheet.getRange(`${colLetter(i)}1:${colLetter(i)}${pricingRows.length + 1}`).format.columnWidth = pricingWidths[i];

const manifest = {
  batch: "2026-08-25-ugopt-100-ready",
  category: "1000 Мелочів для дому",
  categoryUrl: "https://ug-opt.in.ua/ua/g38298679-1000-melochej-dlya",
  sourceExport: sourceExportPath,
  imageMode: "10 approved AI photo series in Google Drive plus source photos for the remaining products",
  selected: records.map(({ product, category, pricing }) => ({
    promCode: `U${product.code}U`, sourceSku: product.code, sourceUrl: product.url, sourcePrice: product.price,
    categoryId: category.id, categoryName: category.name, commissionPercent: pricing.commissionPercent,
    expectedDelivery: pricing.expectedDelivery, worstCaseDelivery: pricing.worstCaseDelivery,
    minNetProfit: pricing.minNetProfit, targetNetProfit: pricing.targetNetProfit,
    expectedNetProfit: pricing.expectedNetProfit, worstCaseNetProfit: pricing.worstCaseNetProfit,
    rawPrice: pricing.raw, finalPrice: pricing.finalPrice,
    imageLinkCount: aiDriveImageIds[`${product.code}/01_main.png`] ? 5 : Math.min(5, (product.images || []).length),
    imageSource: aiDriveImageIds[`${product.code}/01_main.png`] ? "approved_ai_google_drive" : "source_prom_images",
    sourceImageCount: (product.images || []).length,
  })),
};
await fs.writeFile(`${batchDir}/batch-manifest.json`, JSON.stringify(manifest, null, 2), "utf8");

for (const [sheetName, range, fileName] of [["Export Products Sheet", "A1:Q6", "products-preview.png"], ["Export Groups Sheet", "A1:O25", "groups-preview.png"], ["Pricing QA", "A1:M11", "pricing-preview.png"]]) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(`${batchDir}/${fileName}`, new Uint8Array(await preview.arrayBuffer()));
}

const inspect = await workbook.inspect({ kind: "table", sheetId: "Export Products Sheet", range: `A1:${lastCol}4`, include: "values,formulas", tableMaxRows: 4, tableMaxCols: 108, maxChars: 30000 });
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" });
console.log(`SELECTED_NEW_PRODUCTS=${selected.length}`);
console.log(`EXISTING_CODES=${existingCodes.size}`);
console.log(`UNIQUE_NEW_CODES=${new Set(records.map((r) => `U${r.product.code}U`)).size}`);
console.log(`VALID_CATEGORY_IDS=${records.filter((r) => commissionById.has(r.category.id)).length}`);
console.log(`KEYWORD_MIN_RU=${Math.min(...records.map((r) => String(r.row[3] || "").split(",").length))}`);
console.log(`KEYWORD_MIN_UA=${Math.min(...records.map((r) => String(r.row[4] || "").split(",").length))}`);
console.log(`IMAGE_LINKS_MIN=${Math.min(...records.map((r) => String(r.row[14] || "").split(",").filter(Boolean).length))}`);
console.log(`AI_PHOTO_PRODUCTS=${records.filter((r) => Boolean(aiDriveImageIds[`${r.product.code}/01_main.png`])).length}`);
console.log(`WHOLESALE_EMPTY=${records.every((r) => r.row[headers.indexOf("Оптова_ціна")] == null && r.row[headers.indexOf("Мінімальне_замовлення_опт")] == null)}`);
console.log(`IMPORT_IDENTIFIER_QA=${records.every((r) => String(r.row[productIdentifierIndex] || "").trim() && !String(r.row[uniqueIdentifierIndex] || "").trim()) ? "PASS" : "CHECK"}`);
console.log(`HTML_DESCRIPTION_RU_MAX=${Math.max(...records.map((r) => String(r.row[htmlDescriptionRuIndex] || "").length))}`);
console.log(`HTML_DESCRIPTION_UA_MAX=${Math.max(...records.map((r) => String(r.row[htmlDescriptionUaIndex] || "").length))}`);
console.log(`PRICING_QA=${pricingRows.every((row) => row[12] === "PASS") ? "PASS" : "CHECK"}`);
console.log(`PRODUCT_INSPECT=${inspect.ndjson}`);
console.log(`ERROR_SCAN=${errors.ndjson}`);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`OUTPUT=${outputPath}`);
