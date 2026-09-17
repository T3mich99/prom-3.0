import fs from 'node:fs/promises';

const outputPath = process.argv[2];
if (!outputPath) throw new Error('Usage: save-generated-image.mjs <outputPath>');


const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
  const combined = Buffer.concat(chunks).toString('utf8').replace(/\r\n/g, '\n');
  if (combined.includes('\n__CODEX_EOF__\n')) break;
}
const normalized = Buffer.concat(chunks).toString('utf8').replace(/\r\n/g, '\n');
const payload = normalized.split('\n__CODEX_EOF__\n')[0].trim();
const base64 = payload.startsWith('data:') ? payload.slice(payload.indexOf(',') + 1) : payload;
await fs.writeFile(outputPath, Buffer.from(base64, 'base64'));
console.log(JSON.stringify({ outputPath, bytes: Buffer.byteLength(base64, 'base64') }));
