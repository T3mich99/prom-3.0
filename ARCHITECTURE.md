# Product Automation Architecture

This repository is currently a collection of batch scripts for supplier ingestion, product selection, Prom.ua workbook preparation, pricing, content, keywords, categories, images, Google Drive mappings, and QA. The migration to a modular platform has not happened yet.

The proposed target architecture is documented here for future work; it must not be read as a claim that the target has already been implemented.

## Target shape

```text
source adapters
  → immutable source snapshot
  → selection/run manifest
  → normalized product decisions
      ├─ category + identity
      ├─ pricing
      ├─ content/keywords
      └─ five-role photo manifest
  → shared validation gates
  → staged Prom workbook
  → verified publication artifact + QA report
```

The target should use explicit run configuration, versioned business policies, schema-aware workbook adapters, asset provenance, structured validation issues, and restartable run manifests. It should keep legacy scripts available during incremental migration.

## Read next

- [Architecture audit](docs/ARCHITECTURE_AUDIT.md) — evidence, current architecture, risks, data model, and protected behaviors.
- [Current workflows](docs/CURRENT_WORKFLOWS.md) — what the tracked scripts actually do and where hidden manual state exists.
- [Business rules](docs/BUSINESS_RULES.md) — pricing, identifiers, categories, content, photo, and retail rules with conflicts called out.
- [Technical debt](docs/TECHNICAL_DEBT.md) — ranked risks and containment/remediation.
- [Target architecture](docs/TARGET_ARCHITECTURE.md) — proposed modules, contracts, artifacts, and boundaries.
- [Migration plan](docs/MIGRATION_PLAN.md) — staged, rollback-safe path from the current script collection.

## Current safety rule

Do not change pricing, Prom.ua export fields, identifier semantics, category behavior, photo provenance/URL policy, content rules, or templates until characterization tests exist. This audit intentionally created documentation only.
