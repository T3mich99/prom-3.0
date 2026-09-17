import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { resolveInputPath, resolveOutputPath } from "./src/config/paths.mjs";

const root = resolveInputPath(process.argv[2], {
  envName: "PHOTO_SOURCE_ROOT",
  defaultRelative: path.join("outputs", "product-photos", "batch-10", "source"),
});
const outputPath = resolveOutputPath(process.argv[3], {
  envName: "PHOTO_CONTACT_SHEET_PATH",
  defaultPath: path.join(root, "contact-sheet.png"),
});
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
const cellW = 360, cellH = 420, labelH = 60;
const layers = [];
for (let i = 0; i < manifest.length; i++) {
  const x = (i % 2) * cellW;
  const y = Math.floor(i / 2) * cellH;
  const image = await sharp(manifest[i].sourceImage).resize(cellW - 20, cellH - labelH - 20, { fit: "contain", background: "white" }).png().toBuffer();
  const label = Buffer.from(`<svg width="${cellW}" height="${labelH}"><rect width="100%" height="100%" fill="white"/><text x="12" y="23" font-family="Arial" font-size="18" font-weight="bold" fill="#111">${manifest[i].code}</text><text x="12" y="46" font-family="Arial" font-size="14" fill="#333">${String(manifest[i].name).slice(0, 42).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text></svg>`);
  layers.push({ input: image, left: x + 10, top: y + labelH });
  layers.push({ input: label, left: x, top: y });
}
await sharp({ create: { width: cellW * 2, height: cellH * 5, channels: 3, background: "#eeeeee" } }).composite(layers).png().toFile(outputPath);
