import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openProductionStateStore } from '../state/production-state-store.mjs';
import { createDurableProductionService } from '../operations/durable-production-service.mjs';
import { normalizeSchedulerConfig, runScheduledProductionCycle, startProductionScheduler } from '../scheduler/production-scheduler.mjs';

function configPath(argv) {
  if (argv.length !== 2 || argv[0] !== '--config' || !argv[1]) throw new Error('Usage: npm run scheduler -- --config <scheduler.json>');
  return argv[1];
}

export async function runSchedulerCli(argv, { readFile = fs.readFile, writeFile = fs.writeFile, storeFactory = openProductionStateStore, serviceFactory = createDurableProductionService, stdout = process.stdout } = {}) {
  const config = normalizeSchedulerConfig(JSON.parse(await readFile(configPath(argv), 'utf8')));
  const productionRequest = JSON.parse(await readFile(config.productionRequestPath, 'utf8'));
  const store = storeFactory({ databasePath: config.databasePath });
  const service = serviceFactory({ store });
  let stopping = false;
  const runCycle = async () => {
    const snapshotProvider = config.supplierSnapshotPath === undefined
      ? undefined
      : async () => JSON.parse(await readFile(config.supplierSnapshotPath, 'utf8'));
    const result = await runScheduledProductionCycle({ config, store, service, productionRequest, snapshotProvider });
    if (config.alertOutputPath !== undefined) await writeFile(config.alertOutputPath, `${JSON.stringify(store.listAlerts(), null, 2)}\n`, 'utf8');
    stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  };
  const scheduler = startProductionScheduler({ runCycle, config, onResult: () => {} });
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    scheduler.stop();
    store.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { config, stop: shutdown };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSchedulerCli(process.argv.slice(2)).then(() => { process.exitCode = 0; }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
