export const FIELD_ALIASES = {
  code: ['Код_товару', 'Код_товара'],
  titleRu: ['Название_позиции', 'Назва_позиції'],
  titleUa: ['Название_позиции_укр', 'Назва_позиції_укр'],
  keywordsRu: ['Поисковые_запросы', 'Пошукові_запити'],
  keywordsUa: ['Пошукові_запити_укр'],
  descriptionRu: ['Описание', 'Опис'],
  descriptionUa: ['Описание_укр', 'Опис_укр'],
  price: ['Цена', 'Ціна'],
  currency: ['Валюта'],
  unit: ['Единица_измерения', 'Одиниця_виміру'],
  imageLinks: ['Ссылка_изображения', 'Посилання_зображення'],
  availability: ['Наличие', 'Наявність'],
  groupNumber: ['Номер_группы', 'Номер_групи'],
  groupName: ['Название_группы', 'Назва_групи'],
  categoryLink: ['Ссылка_подраздела', 'Посилання_підрозділу'],
  uniqueId: ['Уникальный_идентификатор', 'Унікальний_ідентифікатор'],
  productId: ['Идентификатор_товара', 'Ідентифікатор_товару'],
  categoryId: ['Идентификатор_подраздела', 'Ідентифікатор_підрозділу'],
  groupId: ['Идентификатор_группы', 'Ідентифікатор_групи'],
  manufacturer: ['Производитель', 'Виробник'],
  country: ['Страна_производитель', 'Країна_виробник'],
  wholesalePrice: ['Оптовая_цена', 'Оптова_ціна'],
  wholesaleMinimum: ['Минимальный_заказ_опт', 'Мінімальне_замовлення_опт'],
  notes: ['Особисті_нотатки', 'Личные_заметки'],
  htmlTitleRu: ['HTML_заголовок'],
  htmlTitleUa: ['HTML_заголовок_укр'],
  htmlDescriptionRu: ['HTML_опис'],
  htmlDescriptionUa: ['HTML_опис_укр'],
  mpn: ['Номер_пристрою_(MPN)', 'Номер_устройства_(MPN)'],
};

export const IMPORTANT_FIELDS = Object.keys(FIELD_ALIASES);

export function normalizeCell(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return String(value);
  return value;
}

export function sanitizeCell(header, value) {
  const normalized = normalizeCell(value);
  if (normalized === null) return null;
  const name = String(header ?? '');
  if (!/зображ|изображ/iu.test(name) && /^https?:\/\//iu.test(String(normalized))) return null;
  return normalized;
}

export function headerIndex(headers, aliases) {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);
    if (index >= 0) return index;
  }
  return -1;
}

export function fieldValue(headers, row, field) {
  const index = headerIndex(headers, FIELD_ALIASES[field]);
  return index < 0 ? null : normalizeCell(row[index]);
}

export function splitPhotoLinks(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function photoUrlPolicy(links) {
  const first = links[0] ?? '';
  if (!first) return 'none';
  if (/lh3\.googleusercontent\.com\/d\//iu.test(first)) return 'direct-lh3';
  if (/drive\.google\.com\/uc\?export=view/iu.test(first)) return 'drive-uc-view';
  if (/drive\.google\.com\/uc\?export=download/iu.test(first)) return 'drive-uc-download';
  if (/images\.prom\.ua/iu.test(first)) return 'supplier-prom';
  return 'other';
}

export function importantSnapshot(headers, row) {
  const product = Object.fromEntries(IMPORTANT_FIELDS.map((field) => [field, fieldValue(headers, row, field)]));
  const photoLinks = splitPhotoLinks(product.imageLinks);
  return {
    ...product,
    photoLinks,
    photoCount: photoLinks.length,
    photoUrlPolicy: photoUrlPolicy(photoLinks),
  };
}

export function nonblankRow(row) {
  return row.some((value) => normalizeCell(value) !== null && String(value).trim() !== '');
}

export function canonicalSheet(values, { includeAllRows = false } = {}) {
  const headers = (values[0] ?? []).map((value) => String(value ?? ''));
  const rows = values.slice(1)
    .filter(nonblankRow)
    .map((row) => headers.map((header, index) => sanitizeCell(header, row[index])));
  return {
    headers,
    rows: includeAllRows ? rows : rows.slice(0, 1),
  };
}

export function canonicalProducts(values) {
  const sheet = canonicalSheet(values);
  const row = sheet.rows[0] ?? sheet.headers.map(() => null);
  return {
    headers: sheet.headers,
    row,
    important: importantSnapshot(sheet.headers, row),
  };
}

export function canonicalGroups(values, product) {
  const sheet = canonicalSheet(values, { includeAllRows: true });
  const groupNumber = String(product.important.groupNumber ?? '');
  const groupName = String(product.important.groupName ?? '').trim();
  const numberIndex = headerIndex(sheet.headers, ['Номер_группы', 'Номер_групи']);
  const nameIndex = headerIndex(sheet.headers, ['Название_группы', 'Назва_групи']);
  const matching = sheet.rows.filter((row) => {
    const numberMatches = numberIndex >= 0 && groupNumber && String(row[numberIndex] ?? '') === groupNumber;
    const nameMatches = nameIndex >= 0 && groupName && String(row[nameIndex] ?? '').trim() === groupName;
    return numberMatches || nameMatches;
  });
  return {
    headers: sheet.headers,
    rows: matching.length ? matching.slice(0, 1) : sheet.rows.slice(0, 1),
  };
}
