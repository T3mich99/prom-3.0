import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { runEndToEndProduction } from '../orchestration/end-to-end-production-runner.mjs';

function usage() {
  return 'Usage: npm run production -- --request <request.json> --result <result.json>';
}

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!['--request', '--result'].includes(token)) throw new Error(`Unsupported argument: ${token}`);
    const value = argv[index + 1];
    if (typeof value !== 'string' || !value) throw new Error(`${token} requires a path`);
    values[token.slice(2)] = value;
    index += 1;
  }
  if (!values.request || !values.result) throw new Error(usage());
  return values;
}

export async function runProductionCli(argv, { runner = runEndToEndProduction, readFile = fs.readFile, writeFile = fs.writeFile } = {}) {
  const paths = argumentsFrom(argv);
  let request;
  try {
    request = JSON.parse(await readFile(paths.request, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read valid JSON request: ${error.message}`);
  }
  const result = await runner(request);
  await writeFile(paths.result, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProductionCli(process.argv.slice(2))
    .then(() => { process.exitCode = 0; })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
