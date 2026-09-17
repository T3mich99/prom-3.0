const DEFAULT_ORIGIN = 'https://ug-opt.in.ua';
const CATEGORY_PATH_PATTERN = /^\/ua\/g\d+-[^/?#]+\/?$/u;

export class UgoptCategoryCatalogParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UgoptCategoryCatalogParseError';
    this.kind = 'parse';
  }
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&quot;/giu, '"')
    .replace(/&#34;/gu, '"')
    .replace(/&amp;/giu, '&')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&#x2F;/giu, '/')
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hasClass(rawTag, className) {
  const value = rawTag.match(/\bclass\s*=\s*["']([^"']*)["']/iu)?.[1] ?? '';
  return value.split(/\s+/u).includes(className);
}

function attribute(rawTag, name) {
  return rawTag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'iu'))?.[1] ?? null;
}

function tagTokens(markup) {
  return markup.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)(?:\s[^>]*)?>/giu);
}

function isOpeningToken(token) {
  return token[1] !== undefined && token[0][1] !== '/';
}

function isSelfClosingToken(token) {
  return /\/\s*>$/u.test(token[0]);
}

function extractBalancedElement(markup, openingToken) {
  const tagName = openingToken[1].toLowerCase();
  let depth = 1;
  const searchStart = openingToken.index + openingToken[0].length;
  const rest = markup.slice(searchStart);
  for (const token of tagTokens(rest)) {
    const tokenTag = token[1]?.toLowerCase();
    if (tokenTag !== tagName) continue;
    if (isOpeningToken(token)) {
      if (!isSelfClosingToken(token)) depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        const end = searchStart + token.index + token[0].length;
        return markup.slice(openingToken.index, end);
      }
    }
  }
  return null;
}

function firstElement(markup, tagName, className) {
  for (const token of tagTokens(markup)) {
    if (!isOpeningToken(token) || token[1].toLowerCase() !== tagName || !hasClass(token[0], className)) continue;
    return extractBalancedElement(markup, token);
  }
  return null;
}

function directChildren(markup, childTag, className) {
  const parentToken = [...tagTokens(markup)].find((token) => isOpeningToken(token));
  if (!parentToken) return [];
  const searchStart = parentToken.index + parentToken[0].length;
  const rest = markup.slice(searchStart);
  const results = [];
  let depth = 0;
  for (const token of tagTokens(rest)) {
    const tokenTag = token[1]?.toLowerCase();
    if (tokenTag !== childTag) continue;
    if (isOpeningToken(token)) {
      depth += 1;
      if (depth === 1 && hasClass(token[0], className)) {
        const absoluteOpening = { ...token, index: searchStart + token.index };
        const element = extractBalancedElement(markup, absoluteOpening);
        if (element) results.push(element);
      }
    } else {
      depth -= 1;
    }
  }
  return results;
}

function allElements(markup, tagName, className) {
  const results = [];
  for (const token of tagTokens(markup)) {
    if (!isOpeningToken(token) || token[1].toLowerCase() !== tagName || !hasClass(token[0], className)) continue;
    const element = extractBalancedElement(markup, token);
    if (element) results.push(element);
  }
  return results;
}

function categoryUrl(value, origin) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const href = value.trim();
  if (/^(?:javascript|mailto|tel):/iu.test(href) || href.startsWith('#')) return null;

  let parsed;
  try {
    parsed = new URL(href, origin);
  } catch {
    return null;
  }
  if (!/^https?:$/u.test(parsed.protocol) || parsed.hostname !== 'ug-opt.in.ua') return null;
  if (parsed.hash || !CATEGORY_PATH_PATTERN.test(parsed.pathname)) return null;
  return parsed.toString();
}

function categoryFromAnchor(rawAnchor, origin, parentNames) {
  const opening = rawAnchor.match(/<a\b[^>]*>/iu)?.[0];
  if (!opening) return null;
  const sourceCategoryUrl = categoryUrl(attribute(opening, 'href'), origin);
  const sourceCategoryName = decodeHtml(rawAnchor.replace(/^<[\s\S]*?>/u, '').replace(/<\/a>\s*$/iu, ''));
  if (!sourceCategoryUrl || !sourceCategoryName) return null;
  return {
    supplier: 'ug-opt',
    sourceCategoryName,
    sourceCategoryUrl,
    ...(parentNames === undefined ? {} : { parentNames: [...parentNames] }),
  };
}

function findCategoryAnchor(markup, className) {
  for (const token of tagTokens(markup)) {
    if (!isOpeningToken(token) || token[1].toLowerCase() !== 'a' || !hasClass(token[0], className)) continue;
    const element = extractBalancedElement(markup, token);
    if (element) return element;
  }
  return null;
}

/**
 * Parse the supplier-owned UG-OPT homepage category catalog without I/O.
 * The product-groups list is the full server-rendered catalog; its nested
 * subgroup list proves parent-child relationships for the returned entries.
 */
export function parseUgoptCategoryCatalogHtml(html, options = {}) {
  if (typeof html !== 'string') throw new UgoptCategoryCatalogParseError('html must be a string');
  const origin = options.origin ?? DEFAULT_ORIGIN;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin).origin;
  } catch {
    throw new UgoptCategoryCatalogParseError('origin must be a valid URL');
  }

  const groupList = firstElement(html, 'ul', 'cs-product-groups-list');
  if (!groupList) {
    throw new UgoptCategoryCatalogParseError('Unrecognized UG-OPT category catalog: missing product groups list');
  }
  const groups = directChildren(groupList, 'li', 'cs-product-groups-list__item');
  if (groups.length === 0) {
    throw new UgoptCategoryCatalogParseError('Unrecognized UG-OPT category catalog: missing product groups');
  }

  const catalog = [];
  const seenUrls = new Set();
  const add = (entry) => {
    if (!entry || seenUrls.has(entry.sourceCategoryUrl)) return;
    seenUrls.add(entry.sourceCategoryUrl);
    catalog.push(entry);
  };

  for (const group of groups) {
    const parentAnchor = findCategoryAnchor(group, 'cs-product-groups-list__title');
    const parent = parentAnchor ? categoryFromAnchor(parentAnchor, parsedOrigin) : null;
    add(parent);

    const subgroupList = firstElement(group, 'ul', 'cs-product-groups-list__sublist');
    if (!subgroupList || !parent) continue;
    for (const subgroup of allElements(subgroupList, 'li', 'cs-product-subgroups__item')) {
      const childAnchor = findCategoryAnchor(subgroup, 'cs-product-subgroups__title');
      add(childAnchor ? categoryFromAnchor(childAnchor, parsedOrigin, [parent.sourceCategoryName]) : null);
    }
  }

  if (catalog.length === 0) {
    throw new UgoptCategoryCatalogParseError('Unrecognized UG-OPT category catalog: zero valid categories extracted');
  }
  return catalog;
}
