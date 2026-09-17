import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runProductionCli } from '../../src/cli/production.mjs';

test('CLI writes the exact canonical runner result and treats waiting as success', async () => {
  const writes = [];
  const expected = { status: 'WAITING_FOR_OPERATOR', operatorTasks: [{ productKey: 'p-1', taskType: 'MARKET_RESEARCH' }] };
  const result = await runProductionCli(['--request', 'request.json', '--result', 'result.json'], {
    readFile: async () => JSON.stringify({ mode: 'EXPLICIT_CATEGORIES', categories: [] }),
    writeFile: async (...args) => writes.push(args),
    runner: async (request) => ({ ...expected, request }),
  });
  assert.equal(result.status, 'WAITING_FOR_OPERATOR');
  assert.equal(writes[0][0], 'result.json');
  assert.deepEqual(JSON.parse(writes[0][1]), { ...expected, request: { mode: 'EXPLICIT_CATEGORIES', categories: [] } });
});

test('CLI rejects missing request/result, malformed JSON, and unsupported flags', async () => {
  await assert.rejects(() => runProductionCli([]), /Usage/u);
  await assert.rejects(() => runProductionCli(['--request', 'a', '--result', 'b', '--extra', 'c']), /Unsupported argument/u);
  await assert.rejects(() => runProductionCli(['--request', 'a', '--result', 'b'], { readFile: async () => '{' }), /valid JSON/u);
});

function runProcess(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr }));
  });
}

test('actual production CLI invokes the default canonical runner and writes a valid waiting-free result', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pr27-cli-'));
  const requestPath = path.join(root, 'request.json');
  const resultPath = path.join(root, 'result.json');
  const invalidPath = path.join(root, 'invalid.json');
  try {
    await fs.writeFile(requestPath, JSON.stringify({ mode: 'EXPLICIT_CATEGORIES', categories: [] }), 'utf8');
    const completed = await runProcess(['src/cli/production.mjs', '--request', requestPath, '--result', resultPath]);
    assert.equal(completed.code, 0, completed.stderr);
    assert.equal((JSON.parse(await fs.readFile(resultPath, 'utf8'))).status, 'COMPLETED');

    await fs.writeFile(invalidPath, '{', 'utf8');
    const invalid = await runProcess(['src/cli/production.mjs', '--request', invalidPath, '--result', resultPath]);
    assert.equal(invalid.code, 1);
    assert.match(invalid.stderr, /valid JSON/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
