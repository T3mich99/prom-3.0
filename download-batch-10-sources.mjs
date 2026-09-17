import fs from "node:fs/promises";
import path from "node:path";
import { resolveRepositoryPath } from "./src/config/paths.mjs";

const workspace = resolveRepositoryPath();
const sourceDir = path.join(workspace, "outputs", "prom-product-factory-2026-08-23", "source-data");
const outDir = path.join(workspace, "outputs", "product-photos", "batch-10", "source");

const files = (await fs.readdir(sourceDir)).filter((name) => /^selected-\d+-\d+\.json$/.test(name)).sort();
const products = [];
for (const file of files) products.push(...JSON.parse(await fs.readFile(path.join(sourceDir, file), "utf8")));
const selected = products.slice(0, 10);
await fs.mkdir(outDir, { recursive: true });

const records = [];
for (const product of selected) {
  const productDir = path.join(outDir, String(product.code));
  await fs.mkdir(productDir, { recursive: true });
  let saved = null;
  let lastError = null;
  for (const url of product.images || []) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 1000) throw new Error("image response is too small");
      const ext = url.toLowerCase().includes(".png") ? ".png" : ".jpg";
      const filePath = path.join(productDir, `source${ext}`);
      await fs.writeFile(filePath, bytes);
      saved = { filePath, url, byteLength: bytes.length };
      break;
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  if (!saved) throw new Error(`Could not download source for ${product.code}: ${lastError}`);
  records.push({
    code: String(product.code),
    name: product.name,
    price: product.price,
    url: product.url,
    sourceImage: saved.filePath,
    sourceImageUrl: saved.url,
    sourceImageBytes: saved.byteLength,
    images: product.images || [],
    chars: product.chars || [],
  });
}
await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(records, null, 2), "utf8");
for (const record of records) console.log(`${record.code}\t${record.name}\t${record.sourceImage}`);
