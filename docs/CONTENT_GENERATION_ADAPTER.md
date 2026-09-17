# Content Generation Adapter v1

## Purpose

This boundary converts verified product facts into the existing Content
Artifact v1 contract through an injected, provider-neutral generator. It then
runs the existing Content Quality validator and returns `READY`, `REVIEW`, or
`REWORK` without changing those meanings.

`Generated Content Artifact` does **not** mean that factual claims are trusted
merely because an LLM produced them. Verified source facts remain the factual
authority, and Content Quality remains the separate readiness control.

## Public operations

Initial generation:

```js
await generateContentArtifact(input, { generator, policy })
```

Field-level rework:

```js
await reworkContentArtifact(
  { artifact, quality, sourceFacts },
  { generator, policy },
)
```

The generator is an async callable supplied by the caller. No provider SDK,
API key, environment lookup, network access, filesystem access, timestamp, or
random value is used by this core boundary.

## Generation input

The initial input is deliberately small:

```js
{
  productKey,
  sourceFacts,
  sourceText?,
  categoryContext?,
}
```

`productKey` is supplied by the caller and is never accepted from generated
output. `sourceFacts` is a JSON-compatible verified fact object and is copied
unchanged into the resulting artifact. `sourceFacts` is the authority for
factual values and specifications. `sourceText` is optional contextual/source
wording used only to construct the prompt; numeric or specification claims from
it require support in `sourceFacts`, and prices/costs/business metadata must
never be reproduced. `categoryContext` is optional context and does not assign
a Prom category.

URLs, image names, category names alone, price, model assumptions, and prior
generated content are not factual authority. Unknown facts are omitted.

## Provider boundary and deterministic prompt

The adapter calls the injected generator exactly once with:

```js
{
  system,
  prompt,
  responseFormat: { type: 'json_object' },
  metadata,
}
```

Prompt construction is deterministic for the same structured input. Object
keys in fact payloads are serialized in stable order. The prompt requires
separate RU and UA content, truthful sales copy, strict JSON, omission of
unknown specifications, and no price, photos, category IDs, product IDs,
currency, availability, manufacturer, or model metadata. Business/economic
source facts are rejected before the generator is called.

The core does not claim that a real provider is deterministic; deterministic
tests use injected fake generators.

## Structured response contract

Initial provider output may be a structured object or a strict JSON string.
The accepted top-level shape is:

```js
{
  content: {
    title?: { ru?, ua? },
    description?: { ru?, ua? },
    keywords?: { ru?, ua? },
    characteristics?: [{ name?, value? }],
  },
  claims?: [{ field, value, contentField? }],
}
```

Unknown top-level/content fields, Markdown fences, commentary, malformed JSON,
business metadata, wrong localized types, empty responses, and malformed
characteristics are rejected explicitly. Missing content fields remain
eligible for the existing Content Quality validator to classify as
`REWORK`/`REVIEW`; the adapter does not invent them.

The adapter composes `productKey`, `version: 1`, and the verified `sourceFacts`
itself. A provider cannot override product identity or source facts.

## Quality and artifact behavior

The current `validateContentArtifactStructure` and
`validateContentArtifact` implementations remain authoritative. No length,
keyword, claim, or characteristic rules are duplicated here.

- `READY`: returns a complete version-1 artifact and quality result.
- `REVIEW`: returns the artifact and review result; it is not automatically
  reworked.
- `REWORK`: returns the artifact and existing `reworkPlan`; it is eligible for
  one explicit field-level rework operation.

Initial results have the deterministic shape:

```js
{
  status,
  artifact,
  quality,
  reworkPlan,
  generation: { operation, fields },
}
```

## Field-level rework

`reworkContentArtifact` reads only the existing `quality.reworkPlan.fields`.
It sends the exact field names and reason codes, verified source facts, and
previous values for those fields to the generator. A response containing an
unrequested field or missing a requested field is rejected.

The existing `applyContentFieldRework` helper applies the replacement, so
unrelated content remains unchanged and the artifact version increments once
for a successful non-empty rework. Provider failure, invalid response,
invalid replacement, source-facts mismatch, and review-only results do not
increment the version. There is no autonomous retry or `while` loop; the
caller decides whether to start another explicit operation.

Operational/provider failures use `GENERATOR_FAILURE` or
`GENERATOR_RESPONSE_INVALID`. Invalid Content Artifact structure uses
`CONTENT_ARTIFACT_INVALID`. These failures are not disguised as Content
Quality `REWORK`.

## Relationship to the Content → Excel Row Adapter

The generated artifact can be passed to PR #17's
`buildContentExcelRow({ selectedProduct, contentArtifact, resolvedMetadata })`
after identity is established. The row adapter still defers characteristics,
does not calculate or copy price, does not approve photos, and does not infer
categories. Generated content ready for the row adapter is not a complete Prom
product ready to publish.

## Explicit non-goals

This v1 does not choose pricing, generate photos, write Excel, publish to Prom,
scrape suppliers, resolve categories, generate identifiers, modify Product
Selector behavior, change Content Quality thresholds, or modify historical
content builders. It does not introduce an OpenAI/Anthropic/Gemini dependency
or any live provider integration.
