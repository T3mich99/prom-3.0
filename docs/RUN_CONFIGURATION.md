# Run Configuration

Status: first run-configuration architecture phase on
`refactor/run-config-v1`.

This phase introduces only a small technical runtime seam. It does not create
a universal application configuration and does not change workflow policy.

## Technical runtime configuration

`src/config/run-config.mjs` exports one pure helper:

- `getCliArgument(argv, position)` returns `argv[position]` directly.

The helper intentionally has no validation, fallback, trimming, coercion,
environment lookup, filesystem access, or mutable state. Its purpose is to
preserve the existing direct `process.argv[position]` semantics while giving
low-risk read-only diagnostics one shared entry point for positional CLI
arguments.

## Phase-1 boundary and evidence

The audit found a repeated required input pattern in three read-only Excel
inspectors: `process.argv[2]` is passed unchanged to the workbook loader. No
environment variable or default is used by these scripts. The migrated calls
therefore preserve the existing invocation contract exactly, including
`undefined` when the position is absent.

The independent test uses literal argv values and checks both a present
argument and an absent position. Existing Excel integration and golden tests
remain independent of the helper and protect workbook behavior separately.

## Migrated consumers

- `excel-work/inspect-current-headers.mjs`
- `excel-work/inspect-current-workbook.mjs`
- `excel-work/inspect-photo-urls.mjs`

These scripts remain read-only. Their argument positions, workbook inputs,
sheet access, ranges, output, and error behavior are unchanged.

## Relationship to `src/config/paths.mjs`

`src/config/paths.mjs` remains the single path-resolution foundation. It owns
repository roots and the already-established explicit/environment/default path
precedence. `run-config.mjs` does not resolve paths and does not duplicate or
wrap those helpers.

No environment-variable support was added in this phase. Adding env overrides
to scripts that currently accept only positional arguments would change their
observable behavior and requires separate parity evidence.

## Intentionally deferred runtime behavior

The repository contains several incompatible CLI patterns:

- required input/output/map arguments in final exporters and repair scripts;
- optional positional arguments with dated batch-specific defaults in content,
  selector, and downloader workflows;
- custom option parsing in the disabled photo generator;
- optional flags and role defaults in image/contact-sheet utilities;
- path arguments whose relative-path behavior depends on the legacy script.

These workflows are not centralized because their defaults, requiredness,
side effects, and business coupling differ. No shared helper for defaults,
environment precedence, required-argument errors, flags, batch directories,
or path resolution was introduced.

## Business policy boundary

Run configuration deliberately excludes prices, commissions, margins,
profitability, categories, identifiers, supplier/product selection,
descriptions, keywords, manufacturer fallback, photo rules, publishing
decisions, and retry/concurrency policy. Technical runtime inputs may later
reference artifacts or policies, but the business meaning and decisions remain
outside this module.

## Future candidates

The next safe candidates are a run-scoped artifact/config object and explicit
legacy-to-config adapters, but only after each workflow's defaults and path
semantics are characterized. A future phase may also add environment or
default precedence for a named workflow if that behavior is specified and
tested independently. This phase does not claim that all repository runtime
configuration is centralized.
