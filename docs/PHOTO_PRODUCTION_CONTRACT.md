# Photo Production Contract v4 — approved style v3

This document is the canonical photo-production policy for the project. The
runtime implementation is split across the existing PR20/PR24 boundaries:

- `src/photos/photo-production-plan.mjs` — five-role plan and verified copy;
- `src/photos/photo-prompt.mjs` — provider-neutral generation prompt;
- `src/photos/photo-generation-adapter.mjs` — provider response contract;
- `src/photos/photo-quality.mjs` — technical, visual-checklist, and series QA;
- `src/photos/real-photo-production.mjs` — PNG byte validation and safe files.

## Source of truth

The real UG-OPT source images for the exact SKU are the physical appearance
authority. The request retains their ordered references and instructs the
provider to preserve the product shape, colour, construction, controls,
attachments, genuine brand mark, and distinguishing details. A generated
image is not required to be a pixel-perfect copy: harmless lighting, glare,
perspective, or minor secondary-detail differences are tolerated when the
product remains clearly the same and no buyer-relevant feature changes.

A different product, model, brand, construction, number of main parts,
functional element, or unsupported accessory is a hard identity failure and
requires rework.

Source images establish product identity, not the final composition. The
planner builds all five poses from the individual product's verified claims,
source references, purpose, and visual profile before generation. There is no
single global camera angle or category-wide pose template. Each planned photo
carries its composition intent, scene, placement, viewpoint, orientation, crop,
and position key, plus `usedPosesToAvoid` summaries for earlier slots. A new
background, prop, lighting treatment, or text message without a new product
presentation is not sufficient diversity.

## Exactly five roles

Every READY plan contains exactly these separate PNG files, in this order:

1. `01-hero.png` — large premium product-first presentation;
2. `02-usage.png` — believable use or application context;
3. `03-benefits.png` — two or three verified buyer benefits;
4. `04-feature.png` — one verified construction detail, control, attachment,
   or accessory;
5. `05-final.png` — distinct object-only photograph without text, icons or panels.

Each file is a square 1280×1280 or 1254×1254 PNG, not a collage or contact
sheet. The generation target remains 1280×1280; a 1254×1254 provider output
is accepted as the supported square variant. The five planned visual
directions must differ in scene, product placement, camera angle, orientation,
crop, position key, and composition intent. Series QA also checks product
position and marketing-message diversity after generation. Changing only the
visible text is not a valid distinction.

The feature role must expose verified attachments or accessories when they
exist in the source facts. No accessory, specification, function, or benefit
may be invented.

## Copy and generation

Each role receives a short role-specific `photoCopy` object containing a
Ukrainian headline, optional subtitle, and only verified supporting facts for roles 1–4.
The final object-only role uses `{supportingFacts: []}` and has no visible copy.
The content artifact title is not copied directly into advertising text. Model
identifiers are internal only and must not appear in visible copy. Verified
brand identity is preserved and may be shown as a brand cue.

The approved copy is passed into the ImageGen/provider prompt and must be
rendered as part of the generated advertising image. A later canvas or
post-processing typography overlay is not part of this contract. Text must be
readable on a product card, use free space, and never cover the product, logo,
controls, attachments, or other functional details. Selling text is Ukrainian;
this is a structured contract check, not an OCR or pixel-level language claim.

## QA boundaries

PR24 technical validation remains authoritative for real bytes: PNG signature,
decodable supported scanline structure, dimensions, hashes, duplicate assets,
atomic staging, and safe output paths. Product fidelity remains
`STRUCTURAL_ONLY`; source references, identity metadata, and preservation
constraints are checked, not pixel-diffed.

When visual QA is required, an operator checklist must confirm:

- exact product identity and preserved brand;
- no visible model identifier (including printed product markings), fabricated claim, specification, or accessory;
- role and product-position match;
- premium commercial quality and absence of obvious AI defects;
- text readability and no text-over-product overlap;
- slot, scene and typography-layout distinctness;
- a product-specific concept after comparison with other SKU galleries.

Technical READY without this checklist is REVIEW and cannot create an approved
media artifact. Only aggregate READY creates approved media.

Series QA is evaluated after the individual five-photo reports. Exact repeated
asset/hash/provider identity is REWORK. Repeated generated composition or
product position is REWORK. Repeated message metadata is REVIEW by default.
Harmless visual differences are not rejected as pixel-level duplicates.

## Selective rework

The rework plan contains only non-READY photo indexes. Rework regenerates only
those indexes and passes accepted pose context into the prompt so regenerated
slots do not repeat approved presentations. Accepted artifacts and files remain
byte-for-byte identical, the plan version increments once, and individual plus
series QA runs again. A forged or stale quality result is rejected before any
provider call.

## Local photo lifecycle after Drive publication

Generated PNG bytes are temporary working files. The category publication route
must upload the exact five files for one `productKey` and supplier SKU, verify
each direct public Drive URL without authorization, compare every remote SHA-256
with its local approved file, and only then remove those five local files.
`category:media` returns `cleanup.status=LOCAL_FILES_REMOVED` as the durable
handoff proof. It deletes by the bound product index, canonical role, absolute
path, and SHA-256; reused or mixed paths are rejected. Paths and hashes may stay
in provenance for Excel identity checks, but photo bytes do not remain on the
computer after successful publication. A cleanup failure blocks the handoff.

This contract does not add a provider, paid API, image hosting, category,
pricing, content, registry, or Excel architecture. Existing provider-neutral
and real-file boundaries remain in force.


## Persistent style corrections (2026-09-17)

config/photo-styles.json is read for each new plan. Global instructions are followed
by family, exact supplier category URL and product-key instructions. References are
repository files with content hashes, not claims that a prompt loaded an image.
Every photo carries a styleProfile snapshot and fingerprint. Generation and resumed
photo import reject stale profiles. Rebuild the plan and visually review the set;
never rewrite a saved fingerprint to pretend the old set used new rules.

The mandatory operator checklist now includes noDarkHalos. Black clouds, smoky
surrounds, heavy vignettes and dirty cutout edges fail VISUAL_DARK_HALO. A black
product remains black; subtle localized contact shadows are permitted. This is an
operator visual check, not an automatic pixel classifier. The real user-provided style collage is stored in references/photos/global; it is
style-only evidence and does not verify any supplier specifications.

The persistent global correction in photo-styles version 4 adds a full-bleed
boundary check. An accepted frame is fully opaque and reaches all four edges and
corners. Transparent or cutout borders, checkerboard areas, black corners, black
contours, dark vignettes and halos fail review and require regeneration before
the photo enters a gallery or workbook.

## Individual concepts are mandatory in CATEGORY_PRODUCTION

PHOTO_ART_DIRECTION precedes generation. Codex supplies `photoCreativeBrief` with
productKey, version=1, rationale and five photos in role order. Per photo:
message, scene, composition, camera, placement, orientation, crop, layout,
lighting, photoCopy. These fields enter the real provider prompt. Copy facts
must match sourceFacts. The final photo has no selling text.

Normalized repeated scenes, compositions, messages, layouts or headlines within
a gallery fail validation. A matching scene+composition+layout+lighting across
another SKU in the batch or persisted history triggers a new art-direction task.
Changing a SKU or headline cannot bypass that comparison. This catches exact
metadata reuse, not semantic paraphrases or visual similarity. Codex must inspect
all images before marking sceneDistinct, layoutDistinct and productSpecificDesign.
No static checks guarantee uniqueness, identity or conversion.

The legacy two-variant pose library remains a fallback only outside category mode.
In category mode every accepted brief overrides it with the product-specific plan.
