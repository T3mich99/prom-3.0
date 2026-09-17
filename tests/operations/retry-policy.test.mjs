import assert from 'node:assert/strict';
import test from 'node:test';

import { OperationalRetryError, runWithBoundedOperationalRetry } from '../../src/operations/retry-policy.mjs';

test('bounded operational retry succeeds after a declared transient failure', async () => {
  let calls = 0;
  const result = await runWithBoundedOperationalRetry(async () => {
    calls += 1;
    if (calls < 3) { const error = new Error('temporary'); error.code = 'NETWORK'; throw error; }
    return 'ok';
  }, { policy: { maxAttempts: 3, delayMs: 0 }, isRetryable: (error) => error.code === 'NETWORK' });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('business review and contract errors are never blindly retried', async () => {
  let calls = 0;
  await assert.rejects(
    () => runWithBoundedOperationalRetry(async () => { calls += 1; const error = new Error('review'); error.code = 'CONTENT_REVIEW'; throw error; }, { isRetryable: () => false }),
    OperationalRetryError,
  );
  assert.equal(calls, 1);
});

test('retry stops at the configured maximum', async () => {
  let calls = 0;
  await assert.rejects(
    () => runWithBoundedOperationalRetry(async () => { calls += 1; const error = new Error('temporary'); error.code = 'NETWORK'; throw error; }, { policy: { maxAttempts: 2, delayMs: 0 }, isRetryable: () => true }),
    (error) => error instanceof OperationalRetryError && error.details.attempts === 2,
  );
  assert.equal(calls, 2);
});
