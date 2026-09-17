import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const input = process.argv[2];
const outputDir = path.dirname(input);
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
const image = await wb.render({ sheetName: 'Export Products Sheet', range: 'AY1:BD8', scale: 1, format: 'png' });
await fs.writeFile(path.join(outputDir, 'prom-sales-characteristics-preview.png'), new Uint8Array(await image.arrayBuffer()));
