# Plus-first Production Orchestration v1

## Purpose

`src/orchestration/production-orchestrator.mjs` is the additive composition
layer for one selected UG-OPT product or an ordered batch of products. It
connects the existing supplier, pricing, content, characteristics and photo
contracts without replacing their validators or writing an Excel file.

The canonical identity is `selectedProduct.selectionKey`. Every carried
artifact must use the same `productKey`; a mismatch is a hard orchestration
error. Inputs and option objects are cloned before processing and the public
functions do not mutate caller-owned data.

## Modes and external work

The default mode is `PLUS_FIRST`. Node.js does not call ChatGPT Plus, the
ChatGPT UI, browser cookies, or a browser automation layer. It creates a
deterministic operator task and waits for the operator to return a validated
artifact. No API key is required by default.

`AUTOMATED_PROVIDER` is an explicit opt-in for injected providers. Missing
providers produce a deterministic failure; they never imply that Plus access
is an API. The module contains no paid/live image provider and no web scraping
or Prom publication client.

The single-product entry point is:

```js
await advanceProductionProduct(job, options)
```

The batch entry point is:

```js
await advanceProductionBatch(jobs, options)
```

Batch processing calls the single-product path in input order. A malformed
job is isolated as `FAILED` so another product can continue. The batch result
contains per-product results, deterministic counters, and
`collectOperatorTasks(batchResult)` for the current deduplicated task list.

## State model

The orchestration states are:

```text
SELECTED
  -> WAITING_FOR_MARKET_RESEARCH -> PRICING_REVIEW / SKIPPED
  -> WAITING_FOR_CONTENT -> CONTENT_REVIEW / CONTENT_REWORK
  -> WAITING_FOR_PHOTOS -> PHOTO_REVIEW / PHOTO_REWORK
  -> READY_FOR_EXPORT
```

Supplier states can stop the flow before expensive work:

- `UNAVAILABLE` and `REMOVED` produce `BLOCKED_SUPPLIER`;
- `AT_RISK` produces `SUPPLIER_REVIEW`;
- `SELLABLE` proceeds;
- an unknown supplier state is rejected.

The exported status is intentionally `READY_FOR_EXPORT`, not
`READY_FOR_PROM`. It is not a claim that a Prom listing has been written or
published.

## Operator task contract

Each task has a stable `taskType`, `productKey`, `taskVersion`, input data,
instructions, expected result schema, and validation authority. The task
types are:

- `MARKET_RESEARCH`: return comparable market evidence only;
- `CONTENT_GENERATION`: produce the complete content artifact;
- `CONTENT_REWORK`: rewrite only the fields in the current rework plan;
- `PHOTO_GENERATION`: produce five separate photo files;
- `PHOTO_REWORK`: regenerate only the failed photo indexes.

Tasks preserve verified product facts and exclude economic metadata from
content and photo work. A market task can include non-economic identity facts
needed to find the exact product, but asks for evidence rather than a pricing
decision.

The intended Plus-first sequence is resumable by passing the returned
artifact back into the same job:

1. Run 1 returns `WAITING_FOR_MARKET_RESEARCH` and a market task.
2. The operator researches the exact product and supplies `marketEvidence`.
3. Run 2 returns `WAITING_FOR_CONTENT` and a content task.
4. The operator supplies a content artifact or the next run uses an injected
   content generator.
5. Run 3 returns `WAITING_FOR_PHOTOS` and a five-output photo task.
6. The operator supplies the validated photo artifact, or an injected photo
   provider materializes it.
7. Run 4 returns `READY_FOR_EXPORT` only after all gates pass.

No database, scheduler, retry loop, or global queue is required for resume;
the job and its validated artifacts are the state.

## Gate authorities

### Market pricing

Pricing is recomputed through `src/pricing/market-pricing.mjs` (PR22). A
supplied pricing decision is never trusted without recomputation from the
validated supplier product and market evidence. `PRICE_REVIEW` becomes
`PRICING_REVIEW`; `SKIP` becomes `SKIPPED`. The final selling price is taken
from the authoritative pricing decision, not recalculated by this layer.

The supplier purchase price remains in the internal pricing input and result
where the PR22 contract requires it. It is not copied into content or photo
operator tasks.

### Commercial content

Content is generated and checked through the existing Content Contract and
Commercial Content Quality v2 adapter. Base or commercial `REVIEW` remains a
manual `CONTENT_REVIEW`; `REWORK` creates a field-level task and accepted
fields are preserved by the existing rework adapter. Content must keep
Russian and Ukrainian fields separate and must not contain economic metadata
or a completeness/package section.

### Photos

The existing photo plan defines exactly five separate outputs in canonical
order: hero, usage, benefits, feature and final. Each task explicitly forbids
a collage and carries the fixed 1280 x 1280 output contract. The supplied
source images and verified facts are preserved for fidelity checks; this layer
does not invent product controls, accessories or properties.

Operator-supplied files are revalidated from their actual local bytes through
the PR24 PNG byte validator and PR20 Photo QA. A stale supplied quality result
or approved-media object is not trusted. If only some indexes fail, the
photo rework task contains only those indexes and accepted files remain
untouched. `approvedMedia` is produced only when aggregate photo status is
`READY`.

The output root is injected by the caller. The orchestration layer does not
publish files to a public host; final media is marked `LOCAL_ONLY` with
`publicUrlsAvailable: false`.

### Characteristics and category metadata

If a SAFE characteristic-column mapping is supplied, the existing dynamic
characteristic adapter validates and preserves its plan. Without a template
mapping, characteristic export is deferred rather than guessed. A non-SAFE
mapping fails the export gate.

Category metadata is preserved when supplied by the caller. The orchestrator
does not infer a Prom category. Missing category metadata is reported as an
explicit diagnostic for the future export bridge. Product identifiers are
preserved from the selected product; this layer does not normalize or invent
them.

## Final artifact

The `productionArtifact` on `READY_FOR_EXPORT` contains the canonical product
key, selected product, authoritative pricing decision, commercial content,
optional safe characteristic plan, five approved media records, optional
resolved metadata, provenance, and diagnostics. It is a local production
artifact, not an Excel row and not a Prom upload.

The final gate requires all of the following:

- supplier work is not blocked;
- PR22 pricing is `READY`;
- commercial content is `READY`;
- photo plan is valid;
- all five photo files pass actual byte validation and Photo QA;
- approved media belongs to the same canonical product key;
- any supplied characteristic mapping is `SAFE`.

## Scale and limits

The batch API has no hardcoded 1000-product or Plus quota assumption. It keeps
each job independent and returns compact per-product results; it does not
create one giant shared photo task. A 6000-job batch remains a caller-owned
collection of independent jobs and should be operationally chunked by the
caller when appropriate.

## Deliberate non-goals

This phase does not add an API key, paid provider, ChatGPT UI automation,
browser scraping, database, scheduler, retries, public image hosting, Prom
publication, or Excel writing. Those remain future adapter/operations work.
