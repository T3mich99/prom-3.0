const UGOPT_HOSTNAME = 'ug-opt.in.ua';

export class CategoryCatalogError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CategoryCatalogError';
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireNonEmptyString(value, label, ErrorType = TypeError) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ErrorType(`${label} must be a non-empty string`);
  }
}

function normalizeForMatch(value) {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('uk-UA');
}

function tokens(value) {
  return normalizeForMatch(value).split(' ').filter(Boolean);
}

function validateSourceCategoryUrl(value, index) {
  requireNonEmptyString(value, `catalog entry ${index} sourceCategoryUrl`, CategoryCatalogError);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new CategoryCatalogError(`Invalid catalog entry ${index} sourceCategoryUrl`);
  }
  if (!/^https?:$/u.test(parsed.protocol) || parsed.hostname !== UGOPT_HOSTNAME) {
    throw new CategoryCatalogError(`Catalog entry ${index} must use the UG-OPT hostname ${UGOPT_HOSTNAME}`);
  }
}

function normalizeCatalogEntry(entry, index) {
  if (!isRecord(entry)) throw new CategoryCatalogError(`Catalog entry ${index} must be an object`);
  requireNonEmptyString(entry.sourceCategoryName, `catalog entry ${index} sourceCategoryName`, CategoryCatalogError);
  validateSourceCategoryUrl(entry.sourceCategoryUrl, index);
  if (entry.supplier !== undefined && entry.supplier !== 'ug-opt') {
    throw new CategoryCatalogError(`Catalog entry ${index} has an unsupported supplier`);
  }
  if (entry.parentNames !== undefined && (!Array.isArray(entry.parentNames) || entry.parentNames.some((name) => typeof name !== 'string'))) {
    throw new CategoryCatalogError(`Catalog entry ${index} parentNames must be an array of strings`);
  }

  return {
    supplier: 'ug-opt',
    sourceCategoryName: entry.sourceCategoryName,
    sourceCategoryUrl: entry.sourceCategoryUrl,
    ...(entry.parentNames === undefined ? {} : { parentNames: [...entry.parentNames] }),
  };
}

function prepareCatalog(catalog) {
  if (!Array.isArray(catalog)) throw new CategoryCatalogError('category catalog must be an array');
  const seenUrls = new Set();
  const normalized = [];
  catalog.forEach((entry, index) => {
    const sourceCategory = normalizeCatalogEntry(entry, index);
    if (seenUrls.has(sourceCategory.sourceCategoryUrl)) return;
    seenUrls.add(sourceCategory.sourceCategoryUrl);
    normalized.push(sourceCategory);
  });
  return normalized;
}

function validateRunRequest(request) {
  if (!isRecord(request)) throw new TypeError('runRequest must be an object');
  if (!Array.isArray(request.categories)) throw new TypeError('runRequest.categories must be an array');
  request.categories.forEach((category, index) => {
    if (!isRecord(category)) throw new TypeError(`category request ${index} must be an object`);
    requireNonEmptyString(category.requestKey, `category request ${index} requestKey`);
    requireNonEmptyString(category.requestedName, `category request ${index} requestedName`);
  });
}

function categoryOutput(category) {
  const output = {
    requestKey: category.requestKey,
    requestedName: category.requestedName,
  };
  if (Object.prototype.hasOwnProperty.call(category, 'limit')) output.limit = category.limit;
  return output;
}

function isTokenContainmentMatch(requestedName, sourceCategoryName) {
  const requestedTokens = tokens(requestedName);
  const sourceTokens = new Set(tokens(sourceCategoryName));
  return requestedTokens.length > 0 && requestedTokens.every((token) => sourceTokens.has(token));
}

function resolveOne(category, catalog) {
  const output = categoryOutput(category);
  const exactMatches = catalog.filter((entry) => normalizeForMatch(entry.sourceCategoryName) === normalizeForMatch(category.requestedName));
  if (exactMatches.length === 1) {
    return {
      ...output,
      resolution: 'resolved',
      resolvedCategory: exactMatches[0],
      match: { kind: 'exactName' },
    };
  }
  if (exactMatches.length > 1) {
    return {
      ...output,
      resolution: 'ambiguous',
      alternatives: exactMatches,
    };
  }

  const containmentMatches = catalog.filter((entry) => isTokenContainmentMatch(category.requestedName, entry.sourceCategoryName));
  if (containmentMatches.length === 1) {
    return {
      ...output,
      resolution: 'resolved',
      resolvedCategory: containmentMatches[0],
      match: { kind: 'uniqueTokenContainment' },
    };
  }
  if (containmentMatches.length > 1) {
    return {
      ...output,
      resolution: 'ambiguous',
      alternatives: containmentMatches,
    };
  }
  return { ...output, resolution: 'notFound' };
}

/**
 * Resolve human category requests against a validated, injected UG-OPT
 * source-category catalog. Matching is deterministic and never performs I/O.
 */
export function resolveCategoryRequests(runRequest, catalog) {
  validateRunRequest(runRequest);
  const preparedCatalog = prepareCatalog(catalog);
  const categories = runRequest.categories.map((category) => resolveOne(category, preparedCatalog));
  return {
    ...runRequest,
    categories,
    summary: {
      requestedCount: categories.length,
      resolvedCount: categories.filter((category) => category.resolution === 'resolved').length,
      notFoundCount: categories.filter((category) => category.resolution === 'notFound').length,
      ambiguousCount: categories.filter((category) => category.resolution === 'ambiguous').length,
    },
  };
}
