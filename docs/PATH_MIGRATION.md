# Path Migration

**Branch:** `refactor/path-migration-v3`
**Phase:** portable configuration and path resolution, phases 1–3 (final low-risk pass)
**Scope:** five low-risk diagnostic/local image-asset utilities; no business policy migration

## Inventory before this phase

The audit and a fresh search of tracked production code found machine-specific path assumptions in several groups:

| Classification | Findings | Migration risk |
|---|---|---|
| A — safe to migrate now | `inspect-template.mjs` used an absolute repository template path; `make-source-contact-sheet.mjs` used an absolute source-photo root and derived output path; `scripts/normalize-product-images.mjs` imported Sharp from the local runtime cache | Low: read-only inspection or local image utilities; the selected changes are path/dependency resolution only, with no pricing, identity, category, publication, or workbook field decisions |
| B — workflow-specific decision required | Dated selection/enrichment scripts under `excel-work/` refer to prior output folders, source workbooks, category maps, and historical artifacts; several builders embed batch-specific roots, templates, and Drive maps | Medium/high: changing a default can select a different run, source snapshot, category catalog, photo map, or workbook |
| C — intentionally untouched in this phase | Prom builders and repair scripts with pricing/category/identity/photo behavior; dynamic Sharp runtime imports; Python batch roots and Windows font paths; disabled legacy generators | High or dependency-specific: a path edit can alter external execution, image output, or a business-facing artifact |

The search also confirmed the broader audit finding: absolute `C:/Users` and `C:\Users` paths remain in many tracked scripts. This phase does not claim that the repository is fully portable.

## Paths migrated

### `inspect-template.mjs`

Before, the template was fixed to the workstation path `C:/Users/Dell/Documents/ChatGPT/пром/prom-import-short-template.xlsx`, and rendered previews were written relative to whichever shell directory launched the script.

After, the script uses `resolveInputPath` with:

1. optional first CLI argument;
2. `PROM_TEMPLATE_PATH` environment override;
3. `prom-import-short-template.xlsx` relative to the repository root.

The optional second CLI argument or `PROM_INSPECT_OUTPUT_DIR` selects the preview output directory; when neither is supplied, the default remains `process.cwd()`, matching the pre-refactor relative `fs.writeFile` behavior. The workbook inspection and rendered content are unchanged.

### `make-source-contact-sheet.mjs`

Before, the source folder was fixed to `C:/Users/Dell/Documents/ChatGPT/пром/outputs/product-photos/batch-10/source`, with `contact-sheet.png` always derived there.

After, the script uses `resolveInputPath` with:

1. optional first CLI argument;
2. `PHOTO_SOURCE_ROOT` environment override;
3. `outputs/product-photos/batch-10/source` relative to the repository root.

The optional second CLI argument or `PHOTO_CONTACT_SHEET_PATH` selects the output file. Without an override, the output remains `contact-sheet.png` inside the resolved source root. The manifest reading, image composition, dimensions, and labels are unchanged.

## Phase 2 paths migrated

### `download-batch-10-sources.mjs`

Before, the workspace root was fixed to `C:/Users/Dell/Documents/ChatGPT/пром`; source and output directories were then derived from it. After, the workspace root is `resolveRepositoryPath()`. The selected source files, first-ten-product behavior, downloaded filenames, fallback order, manifest fields, and network behavior are unchanged.

### `finalize-batch-10-photos.mjs`

Before, the batch root was fixed to `C:/Users/Dell/Documents/ChatGPT/пром/outputs/product-photos/batch-10`. After, it is resolved with `resolveRepositoryPath("outputs", "product-photos", "batch-10")`. The fixed product/slot lists, input and output filenames, resize mode, PNG validation, manifest contents, console output, and normal `sharp` package API are unchanged.

Phase 2 introduces no new CLI arguments or environment variables: both scripts retain their original fixed default locations, now expressed relative to the repository root.

## Phase 3 paths migrated

### `scripts/normalize-product-images.mjs`

Before, the utility imported Sharp through the workstation-specific Codex runtime cache path. After, it uses the normal package import `sharp`, which is already used successfully by other repository scripts and was verified against the same `resize(...).png()` API. The CLI root, recursive file walk, 1280×1280 dimensions, `fit: 'fill'`, temporary-file naming, in-place replacement, and output summary are unchanged.

No new CLI arguments or environment variables were introduced.

## Shared foundation

`src/config/paths.mjs` exports:

- `REPOSITORY_ROOT` and `WORKSPACE_ROOT`, resolved from the module location with `fileURLToPath` and `node:path`;
- `resolveRepositoryPath(...segments)` for repository-relative paths;
- `resolveConfiguredPath({ explicit, envName, defaultPath, defaultRelative, env })`;
- `resolveInputPath`, `resolveOutputPath`, and `resolveTemporaryPath` convenience wrappers.

The deterministic priority is explicit value, then the named environment variable, then a default path. Relative values resolve under the repository root; absolute values are normalized and preserved. Importing the module has no filesystem or network side effects.

## Tests

`tests/config/paths.test.mjs` covers repository-root resolution, relative paths, paths containing spaces, explicit-over-environment priority, environment-over-default priority, absolute/non-existing targets, Windows-style input handling, and the phase 2 batch utility roots. It uses no external resources.

## Intentionally deferred paths

The following paths remain unchanged because their defaults encode workflow state or touch a higher-risk boundary:

- root and dated Prom builders, including hardcoded source exports, output roots, pricing, categories, identifiers, and photo maps;
- `excel-work/` selectors and enrichers that scan prior local artifacts, category JSON, source workbooks, or dated batches;
- final exporters and repair scripts that write Prom workbooks or choose current/old/supplier photo behavior;
- absolute Sharp runtime imports in other image utilities, including the disabled legacy generator;
- Python batch directories and Windows font locations;
- disabled legacy generators and any external Drive/Prom/supplier integration paths.

These require a run configuration, dependency contract, source-artifact selection policy, or business-parity fixture before migration. They are candidates for later phases, not hidden fallbacks in the new resolver.

## Portable usage examples

From the repository root, existing no-argument usage keeps repository-relative defaults:

```text
node inspect-template.mjs
node make-source-contact-sheet.mjs
```

Optional explicit paths are supported without changing the script names:

```text
node inspect-template.mjs path/to/template.xlsx path/to/previews
node make-source-contact-sheet.mjs path/to/source path/to/contact-sheet.png
```

Environment overrides are useful for a run-specific artifact directory:

```text
PROM_TEMPLATE_PATH=path/to/template.xlsx node inspect-template.mjs
PHOTO_SOURCE_ROOT=path/to/source PHOTO_CONTACT_SHEET_PATH=path/to/contact-sheet.png node make-source-contact-sheet.mjs
```

On PowerShell, set the values with `$env:PROM_TEMPLATE_PATH` and `$env:PHOTO_SOURCE_ROOT` before invoking the same commands.

## Final low-risk pass conclusion

The final inventory review found no additional category-A candidates. Remaining machine-specific paths belong to dated workflow state, external supplier/Drive/Prom boundaries, business-field builders/repairs, Windows-only image rendering, or disabled legacy code. The low-risk path migration program is complete for the current inventory; further portability work should begin with the planned run-configuration and dependency-contract architecture rather than additional ad hoc substitutions.

## Parity statement

No pricing formulas, commissions, profitability calculations, categories, identifiers, manufacturer fallback, keyword/content rules, photo order/fallback policy, Prom headers, or workbook field values were changed. Phases 1–3 only change how five low-risk utilities locate existing repository artifacts or load the already-supported Sharp dependency. Defaults resolve to the same artifacts as before, including the phase 1 `process.cwd()` preview behavior; image and workbook behavior remains unchanged.
