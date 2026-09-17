# Real Photo Production v1

For the v3 production policy, [PHOTO_PRODUCTION_CONTRACT.md](PHOTO_PRODUCTION_CONTRACT.md)
is the canonical source of truth. This document describes the provider-neutral
file-production boundary and its runtime safety rules.

This document describes the real-file production boundary added after the
provider-neutral Photo Pipeline and Photo QA contracts. It produces actual
PNG bytes and files for one already planned product. It does not connect to
Drive, Excel, Prom, pricing, categories, scheduling, or a database.

## Boundary and provider contract

The existing `src/photos/photo-production-plan.mjs`,
`src/photos/photo-prompt.mjs`, `src/photos/photo-generation-adapter.mjs`, and
`src/photos/photo-quality.mjs` remain the source of the plan, neutral prompt,
claims/text rules, and aggregate QA. Real production composes those modules;
it does not create a second photo plan or a second quality policy. The
production orchestrator adds the mandatory operator visual-QA gate after this
technical boundary; a technical-only result is not final `PHOTO_READY`.

```js
produceRealPhotoFiles(
  { plan, sourceFacts },
  { provider, outputRoot, policy? },
)
```

`provider` is deliberately provider-neutral and must expose:

```js
{
  async generateImage(request) {
    return {
      bytes: Buffer|Uint8Array,
      mimeType: 'image/png',
      providerArtifactId?,
    };
    // Or return { temporaryUrl: 'https://...', providerArtifactId? }.
  }
}
```

The request is the existing PR20 neutral request plus
`outputRequirements: { width: 1280, height: 1280, format: 'png' }`. It carries
the product key, one planned index/role, the plan's source references,
Ukrainian structured text, verified claims, preservation constraints, and the
existing neutral prompt. It contains no prices, costs, commission, margin,
profit, delivery, or market economics. For a `temporaryUrl`, the boundary
performs one download with no retry and validates the downloaded bytes. A
provider cannot choose its own path, filename, claims, or visible copy through
this boundary.

No concrete image vendor SDK or API key is assumed in v1. A concrete adapter
can be injected later when its credentials and configuration are explicitly
available. The repository has no portable image dependency suitable for this
boundary: `sharp` is present only in a local Codex runtime cache and is not a
repository dependency. The implementation therefore uses Node's standard
library for PNG byte validation and adds no dependency.

## Five-file contract

Every successful production has exactly five separate files, in the canonical
PR20 order:

| Index | Role | File |
| ---: | --- | --- |
| 1 | `hero` | `01-hero.png` |
| 2 | `usage` | `02-usage.png` |
| 3 | `benefits` | `03-benefits.png` |
| 4 | `feature` | `04-feature.png` |
| 5 | `final` | `05-final.png` |

Each file must contain actual PNG bytes. The validator checks the PNG
signature, chunk bounds and CRCs, IHDR dimensions, supported non-interlaced
8-bit scanline structure, IDAT decompression, and SHA-256. A valid production
technical production file is exactly 1280×1280 or 1254×1254 pixels. Provider
metadata cannot override the dimensions, format, or hash obtained from bytes.

## Isolation and atomic writes

`outputRoot` is mandatory and is resolved with `node:path`; no repository or
machine-specific default is used. The product folder is deterministic and
filesystem-safe: `product-` followed by the SHA-256 of the original
`selectionKey`. The original product key remains in every artifact and QA
result; hashing only protects the filesystem path.

Fresh production refuses to use an existing product folder, so it cannot
silently overwrite approved media. It writes each payload to a hidden staging
directory, validates the staged bytes, and renames the complete staged product
folder into the deterministic final folder. A provider failure, invalid byte
payload, hard QA failure, or write failure cleans staging and leaves no partial
final set.

Source references are copied into every artifact in their planned order. Source
files are never treated as output targets and are never changed.

## Quality and approval

Real-byte diagnostics are merged with the existing Photo QA result. Empty,
corrupt, wrong-dimension, wrong-MIME, or exact duplicate output is not an
approved set. Exact duplicate asset/hash/provider identity is `REWORK`; the
existing repeated message/composition policy remains `REVIEW` by default.
Only aggregate technical `READY` returns `approvedMediaArtifact` from this
file boundary. The production orchestrator additionally requires operator
visual QA `READY` before it exposes approved media for export. `REVIEW` and
`REWORK` at the final orchestration gate return no approved media artifact.

The five photo roles retain their commercial purposes from PR20: hero is
product-first with minimal text; usage is a believable use/result context;
benefits presents only verified benefits; feature explains one verified
feature; final is a distinct clean gallery presentation. A collage/contact
sheet is never requested by the neutral prompt. Ukrainian text is carried as
structured metadata and constrained by the plan; v1 performs no OCR and makes
no pixel-level language claim. Product fidelity is
`STRUCTURAL_ONLY`: source refs, identity, preservation constraints, and
explicit metadata flags are checked, not pixels.

The operator visual checklist is the required second approval boundary. It
checks that the real product and brand are preserved, no model identifier or
unsupported claim/accessory/specification is visible, the role composition is
correct, the image meets the premium commercial standard, and the slot is
distinct. This is operator verification, not automated OCR or pixel-level
vision QA.

## Selective rework

```js
reworkRealPhotoFiles(
  { plan, artifacts, quality, sourceFacts, visualQa? },
  { provider, outputRoot, policy? },
)
```

Rework revalidates the supplied quality result against the current files and
their byte-derived metadata before spending a provider call. Stale or forged
quality is rejected. Only indexes in the current `reworkPlan` are generated;
accepted files retain their original path, bytes, hash, order, source refs,
claims, and text. The plan version increments once.

All replacement files are staged and fully QA-validated before any replacement
is made. Target replacements use atomic rename with rollback backups. A
provider/write/QA failure removes staging and restores any target already
moved, so accepted files and the original approved set remain intact. A
successful replacement returns five final files and an approved artifact only
when the new aggregate result is `READY`.

## Explicit v1 limits

This boundary does not perform OCR, computer-vision or pixel-level product
fidelity comparison, near-duplicate image similarity, remote URL download,
Google Drive upload or sharing, Excel serialization, Prom assignment,
pricing, category resolution, identifiers, daily catalog sync, scheduling,
alerts, or provider-specific retry logic. A real vendor integration is an
injected boundary, not a fake PNG provider and not a hardcoded local runtime
path.
