import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workspace = "C:/Users/Dell/Documents/ChatGPT/пром";
const outputDir = `${workspace}/outputs/prom-product-factory-2026-08-23`;
const outputPath = `${outputDir}/Prom-final-products.xlsx`;
const templatePath = `${workspace}/prom-import-short-template.xlsx`;

const config = {
  targetCount: 100,
  sourceSearchUrl:
    "https://ug-opt.in.ua/ua/site_search?search_term=%D0%BA%D0%B8%D0%BB%D0%B8%D0%BC%D0%BA%D0%B8++%D0%B4%D0%BB%D1%8F+%D1%85%D0%BE%D0%BB%D0%BE%D0%B4%D0%B8%D0%BB%D1%8C%D0%BD%D0%B8%D0%BA%D0%B0",
  dropshipMarkup: 1.3,
  safetyMarginPercent: 5,
  commissionRateFallback: 0.125,
  marketResearch: true,
};

const headers = [
  "Код_товару",
  "Название_позиции",
  "Название_позиции_укр",
  "Поисковые_запросы",
  "Поисковые_запросы_укр",
  "Описание",
  "Описание_укр",
  "Тип_товара",
  "Цена",
  "Цена_от",
  "Валюта",
  "Единица_измерения",
  "Минимальный_объем_заказа",
  "Оптовая_цена",
  "Минимальный_заказ_опт",
  "Количество",
  "Ссылка_изображения",
  "Наличие",
  "Номер_группы",
  "Название_группы",
  "Ссылка_подраздела",
  "Продукт_на_сайте",
  "Идентификатор_товара",
  "Идентификатор_подраздела",
  "Идентификатор_группы",
  "Уникальный_идентификатор",
  "Код_маркировки_(GTIN)",
  "Номер_устройства_(MPN)",
  "Производитель",
  "Страна_производитель",
];

const charNames = [
  ["Название_характеристики", "Единица_измерения_характеристики", "Значение_характеристики"],
  ["Название_характеристики_2", "Единица_измерения_характеристики_2", "Значение_характеристики_2"],
  ["Название_характеристики_3", "Единица_измерения_характеристики_3", "Значение_характеристики_3"],
  ["Название_характеристики_4", "Единица_измерения_характеристики_4", "Значение_характеристики_4"],
];
headers.push(...charNames.flat());

const headersWithCore = headers;

function decodeHtml(value = "") {
  return String(value)
    .replace(/&#34;|&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtml(value = "") {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function firstMatch(html, regex) {
  const m = html.match(regex);
  return m ? decodeHtml(m[1] || "").trim() : "";
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0 Safari/537.36",
      "Accept-Language": "uk-UA,uk;q=0.9,ru;q=0.8",
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return await response.text();
}

async function discoverProductLinks() {
  const seen = new Set();
  const links = [];
  for (let page = 1; page <= 10 && links.length < config.targetCount; page++) {
    const url = new URL(config.sourceSearchUrl);
    url.searchParams.set("page", String(page));
    const html = await fetchText(url.toString());
    const matches = html.matchAll(/href="(\/ua\/p(\d+)-[^"]+\.html)"/gi);
    for (const m of matches) {
      const sku = m[2];
      if (!seen.has(sku)) {
        seen.add(sku);
        links.push({ sourceSku: sku, url: `https://ug-opt.in.ua${m[1]}` });
      }
    }
    if (!html.includes("/ua/p") || links.length >= config.targetCount) break;
  }
  return links.slice(0, config.targetCount);
}

function parseCategoryId(html) {
  const token = firstMatch(html, /data-advtracking-prosale-token="([^"]+)"/i);
  if (!token) return "64409";
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
    return String(json.categoryId || "64409");
  } catch {
    return "64409";
  }
}

function parseImages(html) {
  const urls = [];
  const imageIds = new Set();
  const addImage = (url) => {
    const clean = decodeHtml(url).replace(/_w\d+(?:_h\d+)?(?=_)/i, "");
    const id = (clean.match(/\/([0-9]+)_/) || ["", clean])[1];
    if (!imageIds.has(id)) {
      imageIds.add(id);
      urls.push(clean);
    }
  };
  const rx = /<img\b[^>]*src="(https:\/\/images\.prom\.ua\/[^\"]+)"[^>]*data-cspgo-image-id=/gi;
  for (const m of html.matchAll(rx)) {
    addImage(m[1]);
  }
  const og = firstMatch(html, /property="og:image"[^>]+content="([^"]+)"/i);
  if (og) {
    const clean = decodeHtml(og).replace(/_w\d+(?:_h\d+)?(?=_)/i, "");
    const id = (clean.match(/\/([0-9]+)_/) || ["", clean])[1];
    if (!imageIds.has(id)) {
      imageIds.add(id);
      urls.unshift(clean);
    }
  }
  return urls.slice(0, 8);
}

function parseProduct(html, source) {
  const productName = firstMatch(html, /data-qaid="product_name">([\s\S]*?)<\/span>/i);
  const priceText = firstMatch(html, /data-qaid="product_price">([\s\S]*?)<\/span>/i);
  const price = Number((priceText.match(/[\d]+(?:[.,]\d+)?/) || ["0"])[0].replace(",", "."));
  const sourceCode = firstMatch(html, /data-qaid="product_code">([\s\S]*?)<\/span>/i);
  const descriptionHtml = firstMatch(html, /data-qaid="product_description">([\s\S]*?)<\/div>/i);
  const description = stripHtml(descriptionHtml).slice(0, 1500);
  const characteristics = [];
  for (const m of html.matchAll(/<tr data-qaid="attribute_item">([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/data-qaid="attribute_(?:name|value)">([\s\S]*?)<\/td>/gi)].map((x) => stripHtml(x[1]));
    if (cells.length >= 2) characteristics.push({ name: cells[0], value: cells[1], unit: "" });
  }
  const hasStock = /data-qaid="presence_data">\s*Готово до відправки/i.test(html);
  return {
    ...source,
    productName,
    sourceCode,
    purchasePrice: price,
    inStock: hasStock,
    description,
    characteristics,
    images: parseImages(html),
    categoryId: parseCategoryId(html),
    categoryName: "Запчастини для холодильників",
  };
}

function commercialRound(price) {
  const anchors = [49, 99, 149, 199, 249, 299, 349, 399, 449, 499, 549, 599, 649, 699, 749, 799, 849, 899, 949, 999, 1099, 1199, 1299, 1399, 1499, 1699, 1899, 1999, 2499, 2999, 3499, 3999, 4999, 5999, 7999, 9999];
  for (const anchor of anchors) if (price <= anchor + 1) return anchor;
  return Math.ceil(price / 100) * 100 - 1;
}

function priceEngine(purchasePrice, commissionRate = config.commissionRateFallback) {
  const protectedCost = purchasePrice * config.dropshipMarkup * (1 + config.safetyMarginPercent / 100);
  const totalRate = commissionRate + 0.07 + 0.05 + 0.03 + 0.02;
  const M = protectedCost <= 50 ? 2 : protectedCost <= 100 ? 1.5 : protectedCost <= 200 ? 1 : protectedCost <= 300 ? 0.85 : protectedCost <= 500 ? 0.7 : protectedCost <= 800 ? 0.55 : protectedCost <= 1200 ? 0.45 : protectedCost <= 2000 ? 0.35 : protectedCost <= 3500 ? 0.28 : protectedCost <= 6000 ? 0.22 : protectedCost <= 10000 ? 0.18 : 0.15;
  const minProfit = protectedCost <= 50 ? 80 : protectedCost <= 100 ? 100 : protectedCost <= 200 ? 120 : protectedCost <= 300 ? 150 : protectedCost <= 500 ? 180 : protectedCost <= 800 ? 220 : protectedCost <= 1200 ? 280 : protectedCost <= 2000 ? 350 : protectedCost <= 3500 ? 450 : protectedCost <= 6000 ? 600 : protectedCost <= 10000 ? 800 : 1200;
  const denominator = 1 - totalRate;
  const targetRaw = (protectedCost + protectedCost * M) / denominator;
  const floorRaw = (protectedCost + minProfit) / denominator;
  return {
    protectedCost: Math.round(protectedCost * 100) / 100,
    targetPrice: commercialRound(targetRaw),
    hardFloor: Math.ceil(floorRaw),
    finalPrice: Math.max(commercialRound(targetRaw), Math.ceil(floorRaw)),
    commissionRate,
  };
}

function contentFor(product) {
  const titleRu = "Антибактериальный коврик для холодильника, набор 6 шт.";
  const titleUa = "Антибактеріальний килимок для холодильника, набір 6 шт.";
  const descriptionRu = "Антибактериальные коврики для холодильника помогают поддерживать чистоту полок и защищать продукты от контакта с влагой. Специальное антимикробное и грязеотталкивающее покрытие препятствует развитию бактерий. Капли соуса, масла или напитка остаются на поверхности и легко смываются проточной водой с небольшим количеством моющего средства. Набор состоит из 6 ковриков. Назначение — для холодильной камеры. Страна производства — Китай. Состояние — новый.";
  const descriptionUa = "Антибактеріальні килимки для холодильника допомагають підтримувати чистоту полиць і захищати продукти від контакту з вологою. Спеціальне антимікробне та брудовідштовхувальне покриття перешкоджає розвитку бактерій. Краплі соусу, олії чи напою залишаються на поверхні та легко змиваються проточною водою з невеликою кількістю мийного засобу. Набір складається з 6 килимків. Призначення — для холодильної камери. Країна виробництва — Китай. Стан — новий.";
  const searchRu = [
    "коврик для холодильника", "антибактериальный коврик", "защитный коврик для холодильника", "коврик на полку холодильника", "вкладыш на полку холодильника", "коврик в холодильник", "аксессуар для холодильника", "коврик для хранения продуктов", "коврик против влаги", "грязеотталкивающий коврик", "антибактериальная подкладка", "набор ковриков для холодильника", "коврик для полки холодильника", "коврики 6 штук", "уход за холодильником", "защита полок холодильника", "коврик для кухонного холодильника", "съемный коврик для холодильника", "легко моющийся коврик", "оптовая покупка ковриков",
  ].join(", ");
  const searchUa = [
    "килимок для холодильника", "антибактеріальний килимок", "захисний килимок для холодильника", "килимок на полицю холодильника", "вкладиш на полицю холодильника", "килимок у холодильник", "аксесуар для холодильника", "килимок для зберігання продуктів", "килимок проти вологи", "брудовідштовхувальний килимок", "антибактеріальна підкладка", "набір килимків для холодильника", "килимок для полиці холодильника", "килимки 6 штук", "догляд за холодильником", "захист полиць холодильника", "килимок для кухонного холодильника", "знімний килимок для холодильника", "килимок, що легко миється", "оптова купівля килимків",
  ].join(", ");
  const chars = [
    { name: "Країна виробник", unit: "", value: "Китай" },
    { name: "Стан", unit: "", value: "Новий" },
    { name: "Призначення", unit: "", value: "Для холодильної камери" },
    { name: "Кількість в упаковці", unit: "шт", value: "6" },
  ];
  return { titleRu, titleUa, descriptionRu, descriptionUa, searchRu, searchUa, chars, productType: "w" };
}

function rowFor(product, pricing) {
  const content = contentFor(product);
  const code = `U${product.sourceSku}U`;
  const images = product.images.join(", ");
  const row = [
    code,
    content.titleRu,
    content.titleUa,
    content.searchRu,
    content.searchUa,
    content.descriptionRu,
    content.descriptionUa,
    content.productType,
    pricing.finalPrice,
    "-",
    "UAH",
    "шт",
    "",
    pricing.finalPrice,
    "",
    "",
    images,
    product.inStock ? "+" : "-",
    "",
    "",
    "",
    product.url,
    product.sourceSku,
    product.categoryId,
    "",
    "",
    "",
    "",
    "",
    "Китай",
  ];
  for (let i = 0; i < charNames.length; i++) {
    const c = content.chars[i] || { name: "", unit: "", value: "" };
    row.push(c.name, c.unit, c.value);
  }
  return row;
}

function colLetter(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const links = await discoverProductLinks();
if (links.length === 0) throw new Error("No products found at the configured source search URL.");
const products = [];
for (const source of links) {
  const html = await fetchText(source.url);
  products.push(parseProduct(html, source));
}

const pricing = products.map((product) => priceEngine(product.purchasePrice));

const input = await FileBlob.load(templatePath);
const workbook = await SpreadsheetFile.importXlsx(input);
const productSheet = workbook.worksheets.getItem("Export Products Sheet");
const groupSheet = workbook.worksheets.getItem("Export Groups Sheet");
const lastCol = colLetter(headersWithCore.length - 1);
const rows = [headersWithCore, ...products.map((product, i) => rowFor(product, pricing[i]))];
productSheet.getRange(`A1:${lastCol}${rows.length}`).values = rows;
productSheet.showGridLines = false;
groupSheet.showGridLines = false;
productSheet.freezePanes.freezeRows(1);
groupSheet.freezePanes.freezeRows(1);

const headerFormat = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
productSheet.getRange(`A1:${lastCol}1`).format = headerFormat;
productSheet.getRange(`A1:${lastCol}${rows.length}`).format.verticalAlignment = "top";
productSheet.getRange(`A2:${lastCol}${rows.length}`).format.wrapText = true;
productSheet.getRange(`A1:${lastCol}${rows.length}`).format.borders = { preset: "inside", style: "thin", color: "#D9E2F3" };
productSheet.getRange(`A1:${lastCol}${rows.length}`).format.borders = { preset: "outside", style: "thin", color: "#9FBAD0" };
productSheet.getRange(`I2:I${rows.length}`).format.numberFormat = "0";
productSheet.getRange(`A1:${lastCol}1`).format.rowHeight = 38;
productSheet.getRange(`A2:${lastCol}${rows.length}`).format.rowHeight = 80;

const widths = {
  A: 16, B: 38, C: 40, D: 46, E: 46, F: 52, G: 52, H: 12, I: 12, J: 10, K: 10, L: 16, M: 18, N: 14, O: 18, P: 12, Q: 72, R: 12, S: 12, T: 24, U: 22, V: 52, W: 18, X: 18, Y: 18, Z: 18, AA: 18, AB: 18, AC: 18, AD: 18, AE: 24, AF: 18, AG: 18, AH: 24, AI: 18, AJ: 18, AK: 24, AL: 18, AM: 18, AN: 24,
};
for (const [col, width] of Object.entries(widths)) productSheet.getRange(`${col}1:${col}${rows.length}`).format.columnWidth = width;

groupSheet.getRange("A1:E1").format = headerFormat;
groupSheet.getRange("A1:E1").format.rowHeight = 38;
groupSheet.getRange("A1:E1").format.borders = { preset: "outside", style: "thin", color: "#9FBAD0" };
for (const [col, width] of Object.entries({ A: 16, B: 34, C: 18, D: 18, E: 18 })) groupSheet.getRange(`${col}1:${col}1`).format.columnWidth = width;

await fs.mkdir(outputDir, { recursive: true });
for (const sheetName of ["Export Products Sheet", "Export Groups Sheet"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}/${sheetName.replaceAll(" ", "_")}.png`, new Uint8Array(await preview.arrayBuffer()));
}
for (const [range, fileName] of [["A1:R3", "Export_Products_core.png"], ["S1:AP3", "Export_Products_extended.png"]]) {
  const preview = await workbook.render({ sheetName: "Export Products Sheet", range, scale: 2, format: "png" });
  await fs.writeFile(`${outputDir}/${fileName}`, new Uint8Array(await preview.arrayBuffer()));
}

const inspect = await workbook.inspect({
  kind: "table",
  sheetId: "Export Products Sheet",
  range: `A1:${lastCol}${Math.min(rows.length, 4)}`,
  include: "values,formulas",
  tableMaxRows: 4,
  tableMaxCols: 50,
  maxChars: 18000,
});
console.log(`PRODUCTS_FOUND=${products.length}`);
console.log(`SOURCE_SKUS=${products.map((p) => p.sourceSku).join(",")}`);
console.log(`PRICES=${pricing.map((p) => p.finalPrice).join(",")}`);
console.log(inspect.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`OUTPUT=${outputPath}`);
