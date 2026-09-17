import assert from 'node:assert/strict';
import test from 'node:test';
import { getCliArgument } from '../../src/config/run-config.mjs';

test('getCliArgument preserves direct argv lookup for present and missing positions', () => {
  const argv = ['node', 'inspect-current-workbook.mjs', 'input.xlsx'];
  assert.equal(getCliArgument(argv, 2), 'input.xlsx');
  assert.equal(getCliArgument(argv, 3), undefined);
});
