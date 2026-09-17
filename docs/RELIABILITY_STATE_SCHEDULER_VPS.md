# Reliability, Durable State, Scheduler, and VPS Operations

PR #28 adds an operational persistence layer around the existing PR27 runner. It does not replace pricing, content, photo, supplier, or Excel contracts. `runEndToEndProduction()` remains the business workflow authority; the state database only preserves its canonical request, resulting artifacts, run state, and waiting work for safe resume.

## Runtime state and schema

Use Node 24.x. The state store uses built-in `node:sqlite`; no SQLite npm dependency, paid provider, API key, browser automation, Prom API, or external alert API is required. Put the database under `runtime/`, for example `runtime/production.sqlite`. That directory is intentionally ignored by Git. Back up the SQLite database before deployments and retain the full history unless an operator explicitly manages retention.

Schema version `1` is recorded in `metadata`. Startup creates an empty database safely, recognizes version 1, and rejects newer or unsupported schemas without deleting or recreating data. SQLite WAL mode and transactional state transitions avoid partial success records.

The normalized durable entities are runs, product jobs, artifacts, operator tasks, supplier snapshots, supplier monitor state, repricing requirements, alerts, scheduler state/cycles, and leases. The store is the only module that uses SQL.

## Manual production versus durable operations

The existing stateless workflow remains available:

```powershell
npm run production -- --request request.json --result result.json
```

For a persistent run, create it through the service API, then resume it after each operator import. Operator artifacts are stored by task ID and product key, then are supplied back to PR27 on the next resume. PR25/PR26 revalidate them; storing an artifact never makes it valid by itself.

```powershell
npm run resume -- --state runtime/production.sqlite --run run-2026-09-13 --artifacts operator-results.json --result resume-result.json
npm run status -- --state runtime/production.sqlite --run run-2026-09-13
```

`operator-results.json` is an array of `{ "taskId", "taskType", "artifact" }`. The artifact must contain the same `productKey` as the stored task. Supported task outcomes map directly to existing contracts: market evidence, content artifact, photo artifact, and publishable-media artifact. Importing the exact same completed response is idempotent. A different response cannot overwrite it; a wrong-product response is rejected and leaves the task waiting.

Plus-first remains interactive: the service can monitor, persist, resume, and queue work 24/7, but market research, AI content, AI images, and public media hosting still require an operator or an explicitly injected provider. There is no ChatGPT UI automation and no claim of fully autonomous AI work.

## Scheduler configuration

Create a JSON file outside Git, for example `runtime/scheduler.json`:

```json
{
  "scheduleId": "daily-production",
  "databasePath": "runtime/production.sqlite",
  "productionRequestPath": "runtime/production-request.json",
  "runId": "daily-production-run",
  "dailyLocalTime": "03:30",
  "leaseDurationMs": 600000,
  "alertOutputPath": "runtime/alerts.json"
}
```

Exactly one timing mode is required: `dailyLocalTime` (`HH:MM`, interpreted by the VPS/local machine clock) or `intervalMs` (for deterministic test or controlled maintenance use). The scheduler has no hidden UTC conversion. By default every cycle builds a live PR23 snapshot through the existing UG-OPT category catalog and category-adapter boundaries; it does not introduce another scraper or parser.

The current category-card source contract confirms product identity, source URL, SKU, and price, but it does **not** confirm stock availability. The live snapshot therefore records `availability: UNKNOWN`, which PR23 correctly treats as `AT_RISK`; a successful page fetch is never treated as proof that a product is sellable. Collection failures make the snapshot partial and block unsafe removal decisions.

`supplierSnapshotPath` remains available only as an explicit diagnostic/test override. When it is supplied, the scheduler reads that local PR23 snapshot instead of making the live collection call. It is not required for routine daily production.

Run it with:

```powershell
npm run scheduler -- --config runtime/scheduler.json
```

One cycle acquires a SQLite lease, collects or reads the explicit diagnostic PR23 supplier snapshot, persists monitoring state, records deduplicated alerts, resumes the durable PR27 run, persists tasks/results, records the cycle, and schedules the next occurrence. A non-expired lease rejects a second instance; an expired lease can be recovered after a crash. Repeating the same logical cycle is ignored.

The first trusted PR23 snapshot establishes a baseline and does not create a flood of new-product alerts. Partial/untrusted scans are persisted as warnings and cannot create mass removals. Confirmed unavailable or removed supplier states become alerts only; PR28 never mutates Prom listings.

When PR23 reports a trusted purchase-price change, the store creates one idempotent repricing requirement scoped to that run and product. On resume, the durable service injects the current PR23 `purchasePriceMinor` as the exact UAH purchase price for PR27/PR22, removes stale market evidence and stale pricing decisions, and lets PR27 create a fresh `MARKET_RESEARCH` task when evidence is missing. A newly completed market-research task for that requirement is accepted; PR22 then performs the only pricing calculation. The requirement is resolved only after that new PR22 decision is returned, and the authoritative pricing product is persisted for subsequent resumes. Existing valid content, photos, and approved media remain intact; only economics is invalidated.

Alerts are durable local records (`CRITICAL`, `WARNING`, `INFO`) with stable deduplication keys. A confirmed unavailable/removed state is critical only when PR23 identifies the product as active through `activeStoreProducts`; non-active supplier changes remain warnings. Scheduler output is JSON to stdout; `alertOutputPath` optionally writes the current JSON alert list. Operator work is stored per task and status reports aggregate waiting counts by type, avoiding thousands of duplicate notifications.

Operational retries, where used by a caller/provider boundary, must be bounded and only cover safe transient infrastructure work. Waiting, review, rework, malformed artifacts, invalid contracts, and unsupported workbook templates are not retryable business failures. PR28 itself does not blind-retry them.

## Windows and Linux VPS

Windows can run the same commands from PowerShell. On a Linux VPS:

```bash
git clone <approved-repository-url> product-automation
cd product-automation
npm ci
node --version
mkdir -p runtime
node tests/quality-gate.mjs
```

Example `systemd` unit (adjust user and paths):

```ini
[Unit]
Description=Product Automation Scheduler
After=network.target

[Service]
Type=simple
User=productautomation
WorkingDirectory=/srv/product-automation
ExecStart=/usr/bin/npm run scheduler -- --config /srv/product-automation/runtime/scheduler.json
Restart=on-failure
RestartSec=30
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

Install with `sudo systemctl daemon-reload`, `sudo systemctl enable --now product-automation`, inspect with `systemctl status product-automation`, and follow logs with `journalctl -u product-automation -f`. SIGINT/SIGTERM stops the scheduler loop without treating waiting operator tasks as a process failure.

Safe updates: stop the service, copy `runtime/production.sqlite` and the scheduler/request/artifact files to a backup location, fetch only an approved main/release revision, run `npm ci`, run the quality gate, verify schema compatibility by opening the store, then restart and inspect status. Do not deploy arbitrary feature branches and do not overwrite runtime state during updates.
