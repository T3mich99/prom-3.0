import assert from 'node:assert/strict';
import test from 'node:test';
import { stripOuterU } from '../../src/contracts/product-identifiers.mjs';

test('stripOuterU preserves the characterized outer-U normalization semantics', () => {
  const cases = [
    ['123', '123'],
    ['U123U', '123'],
    ['u123u', '123'],
    ['U123', '123'],
    ['123U', '123'],
    ['', ''],
    [undefined, ''],
    [null, ''],
    [123, '123'],
    ['U12U3U', '12U3'],
    [' U123U ', ' U123U '],
  ];

  for (const [input, expected] of cases) {
    assert.equal(stripOuterU(input), expected, String(input));
  }
});
