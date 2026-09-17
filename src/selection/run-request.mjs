function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function validateLimit(value, label) {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new TypeError(`Invalid ${label}`);
  }
}

function validateCandidate(candidate, categoryIndex, candidateIndex) {
  if (!isRecord(candidate)) {
    throw new TypeError(`Invalid candidate at category ${categoryIndex}, index ${candidateIndex}`);
  }
  requireNonEmptyString(candidate.selectionKey, `selectionKey at category ${categoryIndex}, index ${candidateIndex}`);
  if (!Object.prototype.hasOwnProperty.call(candidate, 'product')) {
    throw new TypeError(`Missing product at category ${categoryIndex}, index ${candidateIndex}`);
  }
}

export function validateRunRequest(request) {
  if (!isRecord(request)) throw new TypeError('request must be an object');
  if (!Array.isArray(request.categories)) throw new TypeError('categories must be an array');
  validateLimit(request.totalLimit, 'totalLimit');

  request.categories.forEach((category, categoryIndex) => {
    if (!isRecord(category)) throw new TypeError(`Invalid category at index ${categoryIndex}`);
    requireNonEmptyString(category.requestKey, `requestKey at category ${categoryIndex}`);
    requireNonEmptyString(category.requestedName, `requestedName at category ${categoryIndex}`);
    validateLimit(category.limit, `category limit at index ${categoryIndex}`);
    if (!Array.isArray(category.candidates)) {
      throw new TypeError(`candidates must be an array at category ${categoryIndex}`);
    }

    if (category.resolution === 'notFound') {
      if (Object.prototype.hasOwnProperty.call(category, 'resolvedCategory')) {
        throw new TypeError(`Unresolved category must not have resolvedCategory at index ${categoryIndex}`);
      }
      if (category.candidates.length > 0) {
        throw new TypeError(`Unresolved category must not contain candidates at index ${categoryIndex}`);
      }
      return;
    }

    if (category.resolution !== undefined && category.resolution !== 'resolved') {
      throw new TypeError(`Invalid resolution at category ${categoryIndex}`);
    }
    if (!isRecord(category.resolvedCategory)) {
      throw new TypeError(`resolvedCategory must be an object at category ${categoryIndex}`);
    }
    category.candidates.forEach((candidate, candidateIndex) => validateCandidate(candidate, categoryIndex, candidateIndex));
  });

  return request;
}
