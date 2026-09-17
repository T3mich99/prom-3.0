# Photo Pipeline and Photo QA v1

For the v3 production policy, [PHOTO_PRODUCTION_CONTRACT.md](PHOTO_PRODUCTION_CONTRACT.md)
is the canonical source of truth. This document describes the runtime
boundaries and validation interfaces used by that policy.

This document describes the provider-neutral photo boundary introduced in PR
#20. It is a metadata contract and deterministic quality gate; it is not a
Drive uploader, image renderer, or Excel exporter.

## Business standard

Each product has exactly five separate final images. Every image is a square
1280×1280 asset targeted for a Prom.ua gallery; a 1254×1254 square provider
output is also accepted. Visible selling copy is Ukrainian only. A five-image
collage or contact sheet is not a valid final set.

The five roles are fixed and ordered:

1. `hero` — the exact product is large and dominant in a clean main-listing
   composition with minimal copy.
2. `usage` — a believable use or result context where the product stays clear
   and relevant; unsupported before/after claims are not allowed.
3. `benefits` — two to four concise, verified benefits or characteristics.
4. `feature` — one important verified feature or operating advantage.
5. `final` — a clean, product-first alternate gallery composition, not a copy
   of the hero.

The planner expresses these purposes, composition keys, product placement, and
scene intent. It does not force one identical beige template onto every
category. Text density is structural: the default maximum is 2, 2, 4, 2, and
1 element for the five roles respectively, with a 160-character maximum per
element. These are configurable policy limits, not invented marketing copy.

The central photo-generation policy requires premium commercial visual
direction for every role, preserves a verified brand, and forbids visible model
identifiers, unverified claims, unsupported accessories, and invented
specifications. The approved content title remains available to the content
and Excel contracts, but it is not used as hero text in the photo prompt.

## Authority and source media

The input to `buildPhotoProductionPlan` is:

```js
{
  selectedProduct: { selectionKey, ... },
  contentArtifact,
  sourceImages: [{ id, url|path|reference, role?, provenance? }],
  sourceFacts: { ... }
}
```

`selectedProduct.selectionKey` and `contentArtifact.productKey` must match.
Each source image has a non-empty stable `id` and a usable URL, path, or
reference. The plan keeps normalized references, role, and provenance in their
original deterministic order. Empty source media produces a `REWORK` plan;
malformed media is an explicit input error. No source file is changed and no
previous, nearby, generic, or supplier-fallback photo is selected by this
pipeline.

`sourceFacts` is the factual authority for structured claims. Approved Content
Quality text supplies wording/context only, and source images are the physical
appearance authority. Economic fields such as price, cost, commission, margin,
profit, delivery, and market pricing are excluded from plan claims and are not
sent to the image generator.

## Production plan

```js
buildPhotoProductionPlan(input, { policy? })
```

The pure result contains `status`, `productKey`, `version`, five ordered
`photos`, normalized `sourceImageRefs`, preservation constraints,
`fidelityVerification: 'STRUCTURAL_ONLY'`, and deterministic diagnostics.
Each planned photo contains `index`, `role`, `objective`, `verifiedClaims`,
Ukrainian `text` metadata, a unique `visualDirection.compositionKey`, and the
source references. A plan is `READY` only when the supplied Content Artifact is
`READY` under the existing `validateContentArtifact` validator and usable
source media is present. Content Quality is not duplicated here; `REVIEW` or
`REWORK` content conservatively blocks photo planning.

The default policy is exported as `DEFAULT_PHOTO_QUALITY_POLICY` and resolved
by `resolvePhotoQualityPolicy`. v1 fixes the required count and generation
target at five and 1280×1280; the provider boundary also accepts the supported
1254×1254 square output variant. Formats are limited to PNG/JPEG metadata.
Invalid policy values are configuration errors, not quality statuses. The role
order is also fixed to the five-role order above in v1.

## Provider-neutral generation

```js
generateProductPhotos(plan, { generator, policy? })
```

The caller injects a function. It is called once per planned photo, in order,
with a provider-neutral request containing only product identity, the planned
role/objective, approved Ukrainian text, verified claims, source references,
preservation constraints, and a neutral prompt. It contains no raw economic
metadata and no OpenAI, Gemini, Drive, or other provider SDK schema.

The generator returns one metadata-bearing artifact per call:

```js
{
  productKey,
  photoIndex,
  role,
  asset: { path|url|reference, width, height, format? },
  claimsUsed,
  sourceImageRefs,
  text?,
  hash?, providerArtifactId?, message?, composition?, fidelity?
}
```

Missing or malformed responses raise `PHOTO_GENERATOR_RESPONSE_INVALID`;
injected operational failures raise `PHOTO_GENERATOR_FAILURE`. No binary image
library, provider, API key, upload, or network call is required by v1.

## Photo QA

```js
validatePhotoArtifacts({ plan, artifacts, sourceFacts }, { policy? })
```

QA returns product/media status, a report for each planned photo, a
photo-specific `reworkPlan`, a deterministic summary, and an
`approvedMediaArtifact` only when every hard check passes. Production
orchestration additionally calls this boundary with
`{ requireVisualQa: true }`:

```js
{
  productKey,
  version,
  photos: [{ index, assetRef, width: 1280, height: 1280, format? }]
}
```

The status precedence is `REWORK` > `REVIEW` > `READY`. Hard failures include
wrong product identity, index or role, missing asset/source references, wrong
dimensions, unsupported format, unsupported claims, changed fidelity metadata,
non-Ukrainian or changed structured text, wrong count, and exact duplicate
asset reference/hash/provider artifact ID. Repeated message/composition
metadata is `REVIEW` by default and can be configured as `REWORK`.

QA checks exact structured claims against `sourceFacts` and exact structured
text against the approved plan. It does not use OCR and does not claim to see
pixels. `fidelityVerification: 'STRUCTURAL_ONLY'` means the source references,
preservation constraints, identity fields, and any explicit change flags were
checked; it is not a pixel-level vision comparison. Near-duplicate pixels,
unreported logo changes, and remote URL reachability remain future checks.

When visual QA is required, `visualQa.verification` must be
`OPERATOR_CHECKLIST`. The operator checks product identity, brand/model
fidelity, visible text and claim safety, role composition, premium commercial
quality, AI defects, and slot distinctness. Technical PNG checks alone produce
`REVIEW` and never `PHOTO_READY`; only technical `READY` plus operator visual
`READY` can produce an approved media artifact. This visual boundary is an
operator approval, not automated OCR or pixel-level vision.

## Selective photo rework

```js
reworkProductPhotos(
  { plan, artifacts, quality, sourceFacts, visualQa? },
  { generator, policy? },
)
```

Rework recomputes QA and compares it with the supplied quality result before
calling the generator. Forged or stale quality is rejected. Only the indexes in
the current photo rework plan are regenerated; accepted artifacts remain in
their original order and value. The returned plan version increments once.
The original plan, artifact array, source facts, and quality object are never
mutated. A new approved media artifact is produced only if the new aggregate
status is `READY`.

## Future integration and scope

The approved media artifact is the future authority for Excel `photoUrls`, but
PR #20 intentionally does not implement that bridge. The existing Excel
adapter and writer do not trust arbitrary generated URLs. Drive upload/public
sharing, remote URL probes, real image generation, OCR/vision fidelity,
near-duplicate pixel similarity, Excel serialization, pricing, categories,
identifiers, content rules, and Prom publishing remain outside this PR and are
planned for later reviewed boundaries.

Historical scripts remain untouched. The repository currently contains several
older pipelines: Sharp/Python local compositors and normalizers, role prompt and
manifest builders, and dated workbook builders that use Google Drive maps.
Those workflows have used 1280×1280 PNGs and names such as
`01_main.png` through `05_details.png`, but some also permit old/supplier
fallbacks or padded links. This v1 contract does not inherit those fallback
semantics.
