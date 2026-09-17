import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import { resolveInputPath, resolveOutputPath } from "./src/config/paths.mjs";

const templatePath = resolveInputPath(process.argv[2], {
  envName: "PROM_TEMPLATE_PATH",
  defaultRelative: "prom-import-short-template.xlsx",
});
const outputDir = resolveOutputPath(process.argv[3], {
  envName: "PROM_INSPECT_OUTPUT_DIR",
  defaultPath: process.cwd(),
});
const input = await FileBlob.load(templatePath);
const workbook = await SpreadsheetFile.importXlsx(input);

const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 12000,
  tableMaxRows: 5,
  tableMaxCols: 40,
  tableMaxCellChars: 120,
});
console.log(summary.ndjson);

for (const sheetName of ["Export Products Sheet", "Export Groups Sheet"]) {
  try {
    const sheet = workbook.worksheets.getItem(sheetName);
    const used = sheet.getUsedRange();
    console.log(`SHEET ${sheetName} USED ${used.address ?? "unknown"}`);
    console.log(JSON.stringify(used.values?.slice(0, 5)));
    const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
    await fs.writeFile(path.join(outputDir, `template-${sheetName.replaceAll(" ", "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
  } catch (error) {
    console.log(`SHEET ${sheetName} ERROR ${error.message}`);
  }
}
