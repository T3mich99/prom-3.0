import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openProductionStateStore } from '../state/production-state-store.mjs';
import { createDurableProductionService } from '../operations/durable-production-service.mjs';

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || typeof argv[index + 1] !== 'string' || !argv[index + 1]) throw new Error(`Usage: npm run status -- --state <state.sqlite> [--run <runId>]`);
  return argv[index + 1];
}

export async function runStatusCli(argv, { writeFile = fs.writeFile, stdout = process.stdout } = {}) {
  const databasePath = argumentValue(argv, '--state');
  const runId = argv.includes('--run') ? argumentValue(argv, '--run') : undefined;
  const store = openProductionStateStore({ databasePath });
  try {
    const service = createDurableProductionService({ store });
    const result = runId === undefined ? store.status() : service.getDurableRunStatus(runId);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    store.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStatusCli(process.argv.slice(2)).then(() => { process.exitCode = 0; }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
