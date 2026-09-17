# Incremental Migration Plan

This plan keeps the current batch scripts usable while introducing contracts around them. It deliberately avoids a big-bang rewrite and does not authorize production behavior changes by itself.

## Principles

1. Characterize before consolidating.
2. Keep `main` and `vibe-baseline` recoverable and untouched.
3. Prefer new read-only adapters and reports before replacing writers.
4. Preserve every historical business policy as a named version until a decision is approved and tested.
5. Publish only artifacts that pass schema, semantic, asset, and remote checks.
6. Make every stage restartable from a run ID and immutable inputs.

## Stage 0 — Audit and safety baseline (current stage)

**Objective:** document the current system and freeze the guardrails.

**Files affected:** documentation only: `ARCHITECTURE.md` and `docs/*.md`.

**Risk:** documentation can describe an incorrect assumption if evidence is weak.

**Dependencies:** verified branch and tracked-file inspection.

**Tests required:** branch/status verification; inventory completeness review.

**Rollback:** remove only the new documentation files if required; no production files are changed.

**Definition of done:** current workflows, rules, debt, target architecture, and migration sequence are documented; `git status` shows documentation only.

## Stage 1 — Characterization fixtures and critical tests

**Objective:** capture representative source snapshots, workbook templates, photo manifests, and current outputs; write tests for existing behavior without changing it.

**Files affected:** new `tests/fixtures`, `tests/unit`, `tests/integration`; test configuration/manifest only.

**Risk:** fixtures may accidentally contain private data or stale external URLs.

**Dependencies:** Stage 0; access to known-good and known-bad workbooks/asset maps.

**Tests required:** Prom golden workbook, identifiers, pricing formula families, categories/manufacturer, keywords/HTML, photo manifest/URL probes.

**Rollback:** delete/disable new test-only files; leave production scripts intact.

**Definition of done:** tests reproduce the current outputs for at least one representative product per category and fail for known Prom errors (bad IDs, missing category, bad URL, HTML over limit, incomplete photos).

## Stage 2 — Shared configuration and run manifest

**Objective:** make paths, input artifacts, target scope, external IDs, and policy versions explicit while preserving current defaults.

**Files affected:** new `src/config`, `src/storage/run-manifest-store`, compatibility wrappers around existing scripts; no deletion/move yet.

**Risk:** a default path/config translation can select a different artifact than a legacy script.

**Dependencies:** Stage 1 fixtures; inventory of hardcoded paths/maps.

**Tests required:** config validation, path-root containment, run manifest serialization, legacy-to-config parity.

**Rollback:** run existing dated scripts with their current arguments; ignore the new config layer.

**Definition of done:** a run records exact entry point, inputs, policy versions, output paths, status, and checksums; no existing output changes under parity fixtures.

## Stage 3 — Shared domain utilities

**Objective:** create pure/shared implementations for identity, retail-only fields, manufacturer fallback, category decisions, keyword/HTML QA, and photo role validation.

**Files affected:** new `src/domain`, `src/validation`; adapters initially call them in shadow/read-only mode.

**Risk:** “utility” logic may accidentally choose one of the conflicting current policies.

**Dependencies:** Stage 1 tests and explicit policy registry from Stage 2.

**Tests required:** exhaustive unit tests with conflicting/unknown source facts; property tests for identifier uniqueness/format; photo role/count tests.

**Rollback:** disable shadow validator; legacy builders remain writers.

**Definition of done:** shared functions can evaluate a row without filesystem/network/Excel; differences from each legacy script are reported, not silently applied.

## Stage 4 — Extract source and external adapters

**Objective:** isolate UG-OPT/BigDrop parsing, Drive map reading, public asset probing, and image metadata validation.

**Files affected:** new `src/adapters`; fixture parsers; compatibility calls from selection/download scripts.

**Risk:** supplier markup or retry changes can alter selected/enriched data.

**Dependencies:** Stage 1 snapshots and Stage 2 run manifest.

**Tests required:** parser fixtures, timeout/retry/error classification, response size/MIME tests, Drive URL probe tests.

**Rollback:** use legacy fetch/parsers for production; new adapters remain diagnostic.

**Definition of done:** adapter outputs match legacy snapshots for fixed inputs and return structured per-row errors instead of losing the whole batch.

## Stage 5 — Centralize decision services

**Objective:** route content, keywords, pricing, categories, identifiers, and photo-manifest decisions through explicit policy services while supporting historical policy versions.

**Files affected:** new `src/services`, `src/config/policy-registry`, adapters in final builders; no legacy deletion.

**Risk:** this is where business behavior can change materially.

**Dependencies:** Stages 1–4; explicit product-owner choice for pricing, ID, manufacturer, category, and photo modes.

**Tests required:** golden decisions per product; profitability boundary tests; conflict fixtures; parity reports against every relevant legacy builder.

**Rollback:** select the legacy policy adapter in config; leave old scripts runnable.

**Definition of done:** every decision records policy version/provenance and parity differences are approved before becoming the default.

## Stage 6 — Validated export adapter and publication gate

**Objective:** build one schema-aware Prom adapter that writes a staged workbook and blocks publication on hard validation errors.

**Files affected:** new `src/adapters/prom`, `src/validation`, `src/pipelines/export-run`; existing builders can be wrapped as legacy producers.

**Risk:** template/column type changes can cause import rejection.

**Dependencies:** Stage 1 golden workbook tests; shared decisions and asset manifest.

**Tests required:** golden-file import structure, required headers, cell types, sheet names, HTML/keyword limits, all hard business rules, remote asset probe.

**Rollback:** publish through the existing builder only for a run explicitly marked legacy; retain staged artifacts and prior known-good output.

**Definition of done:** no export is labeled ready unless the unified gate passes; incomplete/fallback photo rows are explicitly blocked in strict mode.

## Stage 7 — State, recovery, and idempotency

**Objective:** make selection/enrichment/photo/export restartable and safe to rerun.

**Files affected:** `src/storage`, run manifests, artifact directories, compatibility wrappers; no broad data migration yet.

**Risk:** stale run state can exclude valid products or reuse an incorrect asset.

**Dependencies:** Stage 2 manifest and Stage 4 snapshots.

**Tests required:** resume after failure at each stage, duplicate execution, interrupted publication, wrong-run artifact rejection.

**Rollback:** disable resume mode and run from a fresh run ID; preserve old outputs.

**Definition of done:** a failed run can resume from its last durable checkpoint without duplicate products/assets or workbook corruption.

## Stage 8 — Observability and operator runbook

**Objective:** replace filename archaeology with structured logs, reports, and a documented command sequence.

**Files affected:** `src/observability`, `docs/RUNBOOK.md` if later approved, CI logs/report format.

**Risk:** logs can leak local paths or external identifiers.

**Dependencies:** Stage 7 run ID and issue schema.

**Tests required:** log redaction, report schema, counts/reconciliation checks.

**Rollback:** retain console-only legacy logging; disable new reporting adapters.

**Definition of done:** an operator can identify inputs, outputs, blocked rows, and exact remediation without inspecting source code.

## Stage 9 — CI and legacy retirement

**Objective:** automate unit/integration/golden tests and retire or quarantine obsolete scripts only after usage and parity are known.

**Files affected:** package manifest/lockfile, CI config, `scripts/legacy`, docs; production files removed only by a separate approved change.

**Risk:** hidden operator workflows may depend on a legacy script.

**Dependencies:** Stages 1–8, usage inventory, owner approval.

**Tests required:** full suite on clean environment, fixture export, network-mocked integration, regression of every retained policy mode.

**Rollback:** restore legacy entry point and previous runtime lockfile; do not delete the protected baseline.

**Definition of done:** a clean checkout can run the supported workflow from documented config, CI blocks regressions, and every retired script has a replacement/rollback reference.

## Duplication migration matrix

| Current cluster | First safe move | Later target |
|---|---|---|
| Workbook access | Add schema/header fixtures and read-only adapter | `prom/workbook-adapter` |
| Pricing | Characterize all formulas and label policy versions | `pricing-service` |
| IDs | Add format/uniqueness tests; stop chaining unverified repairs | `identity-service` |
| Photos/Drive | Add provenance manifest and remote probe | `photo-manifest-service` + `drive-adapter` |
| Categories/manufacturer | Record provenance and unknown state | `category-service` + `attribute-policy` |
| Content/keywords | Separate fact extraction from language generation | `content-service` |
| Selection | Persist source snapshot and exclusion index | `selection-service` |
| QA | Normalize issue schema and hard/soft severity | `validation-core` |
| Paths/dependencies | Add explicit config and runtime smoke test | `run-config` + manifest |

## First implementation recommendation

After this audit, the first code change should be tests and fixtures only: one known-good Prom workbook, one known-bad workbook for each historical failure class, one product source snapshot, one complete five-photo manifest, and one incomplete/fallback manifest. Do not start by moving or deleting scripts.
