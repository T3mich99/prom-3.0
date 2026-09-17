import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openProductionStateStore } from '../state/production-state-store.mjs';
import { createDurableProductionService } from '../operations/durable-production-service.mjs';

function readArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--state', '--run', '--artifacts', '--result'].includes(key)) throw new Error(`Unsupported argument: ${key}`);
    const value = argv[index + 1];
    if (typeof value !== 'string' || !value) throw new Error(`${key} requires a path or value`);
    values[key.slice(2)] = value;
    index += 1;
  }
  if (!values.state || !values.run) throw new Error('Usage: npm run resume -- --state <state.sqlite> --run <runId> [--artifacts <artifacts.json>] [--result <result.json>]');
  return values;
}

export async function runResumeCli(argv, { readFile = fs.readFile, writeFile = fs.writeFile, serviceFactory = createDurableProductionService, storeFactory = openProductionStateStore } = {}) {
  const values = readArguments(argv);
  const store = storeFactory({ databasePath: values.state });
  try {
    const service = serviceFactory({ store });
    if (values.artifacts) {
      const artifacts = JSON.parse(await readFile(values.artifacts, 'utf8'));
      service.importDurableOperatorArtifacts({ runId: values.run, artifacts });
    }
    const result = await service.resumeDurableProductionRun({ runId: values.run });
    if (values.result) await writeFile(values.result, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    return result;
  } finally {
    store.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runResumeCli(process.argv.slice(2)).then(() => { process.exitCode = 0; }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
