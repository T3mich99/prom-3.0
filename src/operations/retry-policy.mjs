export const DEFAULT_OPERATIONAL_RETRY_POLICY = Object.freeze({ maxAttempts: 3, delayMs: 250 });

export class OperationalRetryError extends Error {
  constructor(message, code = 'OPERATIONAL_RETRY_FAILED', details = undefined) {
    super(message);
    this.name = 'OperationalRetryError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function normalizePolicy(policy = {}) {
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) throw new TypeError('retry policy must be an object');
  const value = { ...DEFAULT_OPERATIONAL_RETRY_POLICY, ...policy };
  if (!Number.isSafeInteger(value.maxAttempts) || value.maxAttempts < 1) throw new TypeError('retry policy maxAttempts must be a positive safe integer');
  if (!Number.isSafeInteger(value.delayMs) || value.delayMs < 0) throw new TypeError('retry policy delayMs must be a non-negative safe integer');
  return value;
}

/** Retry only when the caller explicitly declares an operational failure safe to retry. */
export async function runWithBoundedOperationalRetry(operation, {
  policy,
  isRetryable = () => false,
  wait = async () => {},
  onAttempt = () => {},
} = {}) {
  if (typeof operation !== 'function' || typeof isRetryable !== 'function' || typeof wait !== 'function' || typeof onAttempt !== 'function') {
    throw new TypeError('operation, isRetryable, wait, and onAttempt must be functions');
  }
  const resolved = normalizePolicy(policy);
  let lastError;
  for (let attempt = 1; attempt <= resolved.maxAttempts; attempt += 1) {
    try {
      onAttempt({ attempt, maxAttempts: resolved.maxAttempts });
      return await operation({ attempt, maxAttempts: resolved.maxAttempts });
    } catch (error) {
      lastError = error;
      if (attempt === resolved.maxAttempts || !isRetryable(error)) break;
      await wait(resolved.delayMs, { attempt, maxAttempts: resolved.maxAttempts, error });
    }
  }
  throw new OperationalRetryError('Operational operation did not succeed within the configured retry budget', 'OPERATIONAL_RETRY_EXHAUSTED', { attempts: resolved.maxAttempts, causeCode: lastError?.code });
}
