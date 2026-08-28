# accessibility-scanner

axe-core covers the WCAG 2.2 criteria that can be decided from the DOM alone.
This project extends it with checks that need a real browser session or
judgement: 30 deterministic Puppeteer scanners (keyboard, focus, reflow, text
resize, motion, timing, contrast of non-text content, EAA statement and
contact requirements) and 12 LLM-assisted scanners for criteria such as
reading level, sensory characteristics or alt text quality. An agentic
screen-reader check, where an LLM has to complete tasks using only what a
screen reader announces, is in progress on the `feat/sr-agent` branch.

Everything runs through one Express API and one headless Chromium pipeline
and comes back as JSON, HTML or PDF. Every success criterion is mapped to a
mechanism and to the fixtures that prove it; the mapping is checked in CI.

[![ci](https://github.com/Zentrum-fur-nachhaltige-Algorithmik/accessibility-scanner/actions/workflows/ci.yml/badge.svg)](https://github.com/Zentrum-fur-nachhaltige-Algorithmik/accessibility-scanner/actions/workflows/ci.yml)

## How it works

```
client (curl, Next.js UI)
   |
   |  POST /api/scan {url, profile}            202 {jobId}
   v
+------------------------+       +--------------------+
| Express API            | ----> | job store + queue  |  SCAN_CONCURRENCY
| bearer auth            |       | (in memory)        |
| rate limit             |       +---------+----------+
| url-guard (SSRF)       |                 |
+------------------------+                 v
   ^                             +--------------------+
   |  GET /api/scan/job/:id      | ScanPipeline       |  one context per scan
   |                             +--------------------+
   |                                |              |
   |            page loaded once    |              |  reload before each
   |                                v              v
   |                    +----------------+  +----------------+
   |                    | concurrent     |  | exclusive      |
   |                    | read-only DOM  |  | viewport,      |
   |                    | axe-core       |  | keyboard,      |
   |                    | deterministic  |  | navigation     |
   |                    | LLM (optional) |  |                |
   |                    +----------------+  +----------------+
   |                                |              |
   |                                v              v
   |                    +------------------------------+
   |                    | assemble: dedupe, severity,  |
   |                    | WCAG level, trust tag, score |
   |                    +------------------------------+
   |                                   |
   +-----------------------------------+   JSON  ->  HTML / PDF report
```

The process keeps one Chromium and relaunches it every 50 scans. Each scan
runs in its own browser context, so cookies, storage and cache never carry
over from one target to the next.

Scanners extend `BaseScanner` and receive an already loaded page. Concurrent
scanners only read the DOM and run in parallel; exclusive scanners change the
viewport, send input or navigate, so the pipeline runs them one at a time and
reloads the URL in between. LLM scanners register only when
`OPENROUTER_API_KEY` is set.

## Quick start

Docker:

```
cp .env.example .env
docker compose up --build
# API on http://localhost:3000, UI on http://localhost:3001
```

Local (Node 22, downloads Chrome for Testing on install):

```
npm ci
npm run dev                 # API with .env loaded, restarts on change
npm run frontend:dev        # UI on http://localhost:3001
```

Scan a page and poll the job:

```
curl -s -X POST localhost:3000/api/scan \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","profile":"standard"}'
# {"jobId":"...","status":"queued","statusUrl":"/api/scan/job/..."}

curl -s localhost:3000/api/scan/job/<jobId>
```

Add `"sync": true` to get the result in the same response. When `API_TOKEN`
is set, send `Authorization: Bearer <token>` on every route except
`/api/health`.

## API

| Method | Route                    | Purpose                                                      |
|--------|--------------------------|--------------------------------------------------------------|
| POST   | /api/scan                | Start a scan: `{url, profile?, scannerIds?, options?, sync?}` |
| GET    | /api/scan/job/:jobId     | Job status, queue position, progress, result                 |
| POST   | /api/report              | Render a scan result to HTML (and PDF with `includePDF`)     |
| GET    | /api/report/:id          | Fetch the HTML report                                        |
| GET    | /api/report/:id/pdf      | Fetch the PDF report                                         |
| GET    | /api/scanners            | Registered scanners with their WCAG criteria                 |
| GET    | /api/health              | Liveness, scanner count, uptime (no auth)                    |

Scan targets are checked against `SCAN_ALLOWED_HOSTS` and against private and
loopback address ranges before a browser is started.

## Scan profiles

| Profile  | Scanners                                                       | Typical time |
|----------|----------------------------------------------------------------|--------------|
| fast     | axe-core, concurrent checks, quick exclusive checks            | about 30 s   |
| standard | fast plus the slower exclusive checks, 3 s observation window  | 1 to 2 min   |
| full     | every proven scanner including LLM scanners                    | 2 to 4 min   |

Profiles list scanner ids; a scanner is only part of a default profile while
its trust tier is `proven`. Pass `scannerIds` to run an explicit set, or
`includeExperimental: true` in `options` to add quarantined scanners.

## Scanner trust tiers

`scripts/derive-scanner-trust.js` reads the recorded harness results in
`tests/data/harness/` and writes `src/core/scanner-trust.json`. A scanner is
`proven` when it detects every fixture it claims, raises no false positive on
the good-file corpus and never crashes on the real-world corpus; otherwise it
is `experimental`, stays registered, is left out of the default profiles and
its findings carry `confidence: "low"`. CI fails when the file is stale.

## WCAG 2.2 coverage

Generated by `npm run coverage-matrix`; `npm run coverage-matrix:check` runs in CI.

<!-- coverage-matrix:start -->
| Mechanism | Criteria | A | AA | AAA | Removed |
|---|---:|---:|---:|---:|---:|
| axe-core | 12 | 9 | 2 | 1 | 0 |
| hybrid | 16 | 7 | 5 | 4 | 0 |
| deterministic | 24 | 10 | 11 | 3 | 0 |
| llm | 24 | 3 | 1 | 20 | 0 |
| experimental-only | 5 | 1 | 4 | 0 | 0 |
| MANUAL | 5 | 1 | 1 | 3 | 0 |
| NOT-APPLICABLE-STATIC | 1 | 0 | 0 | 0 | 1 |
| total | 87 | 31 | 24 | 31 | 1 |

A and AA: 48 of 55 criteria are covered by proven mechanisms, 2 need manual review, 5 are covered only by experimental scanners and do not count as covered.

Full matrix with fixtures, harness evidence and justifications: tests/data/coverage-matrix.json.
<!-- coverage-matrix:end -->

## Configuration

| Variable                  | Default                          | Purpose                                      |
|---------------------------|----------------------------------|----------------------------------------------|
| PORT                      | 3000                             | API port                                     |
| API_TOKEN                 | (unset: open)                    | Bearer token for /api/* and /reports/*       |
| SCAN_ALLOWED_HOSTS        | (unset: any public host)         | Comma-separated allowlist for scan targets   |
| SCAN_CONCURRENCY          | 1                                | Parallel scans, one Chromium each            |
| SCAN_RATE_LIMIT_MAX       | 5                                | Scan requests per window and IP              |
| SCAN_RATE_LIMIT_WINDOW_MS | 3600000                          | Rate limit window                            |
| OPENROUTER_API_KEY        | (unset: LLM scanners off)        | Enables the 12 LLM scanners                  |
| LLM_MODEL                 | google/gemini-3.5-flash          | Primary model                                |
| LLM_FALLBACK_MODELS       | google/gemini-3-flash-preview    | Comma-separated fallback models              |
| LOG_LEVEL                 | info                             | error, warn, info or debug                   |
| SCREENSHOT_DIR            | os tmpdir                        | Scanner screenshots                          |
| REPORTS_DIR               | ./reports                        | Generated reports                            |
| REPORT_ORG_NAME           | Accessibility Scanner            | Organisation printed on reports              |
| API_ORIGIN                | http://localhost:3000            | Frontend build: API the UI proxies to        |

`npm run dev` loads `.env` through `node --env-file`; Docker Compose reads it
directly. Nothing reads `.env` in production.

## Testing

```
npm test                    # unit: no browser, seconds
npm run test:e2e            # scanners against test-sites/ fixtures, Chromium, sequential
npm run test:self-scan      # builds the UI and scans it with the API
npm run lint                # eslint, prettier, dash check
```

`test-sites/` holds about 180 `good-*.html` / `bad-*.html` fixture pairs with
a `WCAG-TEST` metadata block naming the criteria they exercise. The axe e2e
test runs every fixture; the harnesses in `scripts/harness/` measure true and
false positives per scanner and write the JSON that feeds the trust tiers:

```
npm run harness:exclusive   # one scanner at a time, fresh page each
npm run harness:concurrent  # read-only scanners
npm run harness:llm         # LLM scanners, needs OPENROUTER_API_KEY
npm run harness:realworld   # captured real pages, no-crash invariant
npm run trust:derive        # rewrite src/core/scanner-trust.json
npm run coverage-matrix     # rewrite the coverage section above
```

## Project layout

```
src/
  server.js              Express API
  config.js              every environment variable, with defaults
  api/                   auth, url-guard (SSRF), scan-jobs
  core/                  base-scanner, scan-pipeline, scanner-registry, profiles,
                         scanner-trust, severity, wcag-levels, constants
  scanners/              axe-core adapter and 30 deterministic scanners
  scanners/llm/          12 LLM scanners plus their base class and page context
  llm/client.js          OpenRouter client with retry and fallback models
  report/                HTML and PDF report generator
  utils/                 accessible name, contrast, rendered-state helpers, logger
  data/                  wcag22-criteria.json
frontend/                Next.js UI (pages, components, lib)
scripts/                 coverage matrix, trust derivation, harnesses, fixture capture
tests/
  unit/  e2e/  self-scan/  helpers/  data/
test-sites/              fixture pages and captured real-world snapshots
Dockerfile, docker-compose.yml, .github/workflows/ci.yml
```
