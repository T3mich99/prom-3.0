import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { resolveRepositoryPath } from "./src/config/paths.mjs";

const root = resolveRepositoryPath("outputs", "product-photos", "batch-10");
const codes = ["0149", "34621", "34012", "34020", "10962", "14230", "14239", "34663", "34668", "34675"];
const slots = ["01_main", "02_benefits", "03_features", "04_use", "05_details"];
const manifest = JSON.parse(await fs.readFile(path.join(root, "source", "manifest.json"), "utf8"));
const byCode = new Map(manifest.map((item) => [String(item.code), item]));
const results = [];
for (const code of codes) {
  const dir = path.join(root, code);
  await fs.mkdir(dir, { recursive: true });
  const record = byCode.get(code);
  if (!record) throw new Error(`Missing source manifest record for ${code}`);
  for (const slot of slots) {
    const input = path.join(dir, `${slot}.raw.png`);
    const output = path.join(dir, `${slot}.png`);
    await sharp(input).resize(1280, 1280, { fit: "fill" }).png().toFile(output);
    const meta = await sharp(output).metadata();
    if (meta.width !== 1280 || meta.height !== 1280 || meta.format !== "png") throw new Error(`Invalid output ${output}`);
    results.push({ code, name: record.name, slot, path: output, width: meta.width, height: meta.height, format: meta.format });
  }
}
await fs.writeFile(path.join(root, "photo-manifest.json"), JSON.stringify({ rule: "PHOTO-MASTER-SPEC.md", products: results }, null, 2), "utf8");
console.log(`FINAL_IMAGES=${results.length}`);
console.log(`PRODUCTS=${new Set(results.map((x) => x.code)).size}`);
console.log(`INVALID=${results.filter((x) => x.width !== 1280 || x.height !== 1280 || x.format !== "png").length}`);
