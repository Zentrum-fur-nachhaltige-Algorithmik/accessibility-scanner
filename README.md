# accessibility-scanner

Three layers of WCAG 2.2 checking on top of axe-core, and a measurement of what
the checks cannot see: whether a screen reader user can actually get things done.

1. axe-core covers the criteria that can be decided from the DOM alone.
2. 26 deterministic Puppeteer scanners cover what needs a real browser session:
   keyboard and focus behaviour, reflow and text resize, motion, timing,
   contrast of non-text content, EAA statement and contact requirements.
3. 12 LLM-assisted scanners cover criteria that need judgement: reading level,
   sensory characteristics, alt text quality, consistent help.
4. The screen reader agent: an LLM has to complete real tasks on the page
   while receiving only what a screen reader announces. Its detours against
   the shortest possible route are the score; the places it got stuck are the
   findings. A playable version of the same setup (Blind Mode) lets a sighted
   person try it.

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

`tests/data/realworld-labels.json` judges every finding the sixteen real-world
snapshots produced, one entry per (snapshot, rule id, node selector), as
`true`, `false`, `review` or `artefact`, each with the reason; `artefact` is a
finding the snapshot reports and the live page does not, because the replay
keeps a state the page script would remove. `npm run precision:check` runs the
real-world pipeline again, matches what is reported against those labels and
prints, per rule id, how many findings are real: precision = true /
(true + false). It fails when a rule with at least three judged findings
reports a false one, and lists reported findings that carry no label yet.
Artefacts never count, and neither does a rule that measures the rendering
(contrast, reflow, target size, focus appearance) on one of the five snapshots
captured before the stylesheets were inlined. Its result is recorded in `tests/data/harness/harness-precision.json`
and is the third condition for a `proven` tier.

## WCAG 2.2 coverage

Generated by `npm run coverage-matrix`; `npm run coverage-matrix:check` runs in CI.

<!-- coverage-matrix:start -->
| Mechanism | Criteria | A | AA | AAA | Removed |
|---|---:|---:|---:|---:|---:|
| axe-core | 8 | 5 | 2 | 1 | 0 |
| hybrid | 21 | 11 | 5 | 5 | 0 |
| deterministic | 27 | 11 | 13 | 3 | 0 |
| llm | 23 | 3 | 1 | 19 | 0 |
| MANUAL | 7 | 1 | 3 | 3 | 0 |
| NOT-APPLICABLE-STATIC | 1 | 0 | 0 | 0 | 1 |
| total | 87 | 31 | 24 | 31 | 1 |

A and AA: 51 of 55 criteria are covered by proven mechanisms, 4 need manual review, 0 are covered only by experimental scanners and do not count as covered.

Full matrix with fixtures, harness evidence and justifications: tests/data/coverage-matrix.json.
<!-- coverage-matrix:end -->

## Screen reader agent

Static checks cannot tell whether a page is usable without sight. The agent
measures that directly: it gets a task ("send the contact form", "find the
state pension age") and a screen reader, nothing else.

```
task ------------------------------+
                                   v
+-----------------+   phrase,    +-----------+   command    +------------------+
| ScreenReaderEnv | ---------->  | LLM agent | ---------->  | ScreenReaderEnv  |
| virtual screen  |  rotor lists |           |  next, tab,  | in the page      |
| reader in page  |  live regions|           |  H 1-6, L, F,|                  |
|                 |              |           |  D, B, find, |                  |
+-----------------+              +-----------+  activate    +------------------+
        ^                                                          |
        |                  oracle checked after every step         |
        +----------------------------------------------------------+
```

The agent never sees HTML, an accessibility tree, a screenshot or a selector.
Each turn it receives the phrase at the cursor, the announcements since the
last step and, on request, one PAGE of a rotor list (headings, landmarks, links,
form fields, buttons; eight entries, `more` for the next eight, a first-letter
jump to skip ahead). The command set is the browse mode of NVDA and JAWS: the
quick-navigation keys of each kind, heading levels 1 to 6, and a search over the
spoken text (`find`, `findNext`). Every command counts as one step, including
failed ones; only `find` counts as two, for the word and the Enter. A container
and its first line of text are one reading stop ("paragraph, We build small
things"), the closing boundaries are none.

Scoring per task:

```
nOpt  shortest command sequence that solves the task, computed
      deterministically along the sighted reference path, or along a link
      that leads straight to the target when the page has one (optimal-path.js)
nSr   commands the agent used
R     = min(1, nOpt / nSr), 0 when the task was not solved
```

`siteScore` is the weighted mean of R over the valid tasks. Tasks come from
`generic-tasks.js` (cookie banner, navigation, search, contact, login, form)
or from the task generator, which solves the page sighted first, derives an
oracle for each task and validates it by deterministic replay; a task that
cannot be replayed is excluded, never scored.

Every task is written in the language of the page and carries the words a user
would look for on it ("Kontakt", "Termin vereinbaren"). A task in the wrong
language cannot be solved by anyone matching words against what is spoken, and
it hands the model a goal in a language the site does not use. Neither route is
allowed to be longer than the page really is either: when the sighted solution
wandered through a menu but the start page links straight to the destination,
that single click is what `nSighted` and `nOpt` are measured against.

Findings are read off the trace without an LLM and use the same shape as the
scanners' violations: `focus-lost` (2.4.3), `dialog-not-trapped` (2.4.3),
`escape-does-not-close` (2.1.2), `unannounced-change` (4.1.3),
`unnamed-control-used` (4.1.2), `reading-fragmentation` (1.3.1/1.3.2: one
visual line of text spoken as three or more separate phrases, as visual site
builders produce), `agent-claimed-done-prematurely` (4.1.3, only when the page
reacted to nothing the agent did) and `agent-stopped-early` (an agent finding
that stays out of the site score).

A task that asks for information ("what is the phone number?") carries both the
verbatim page text (`evidence`) and the answer itself (`answer` plus
`answerType`: phone, email, address, hours or text). It counts as solved when
the screen reader spoke the evidence OR when what the user heard carries the
same answer in another spelling or on another page - decided deterministically
per answer type, and only if that fails and the agent gave up, by one cheap LLM
judge call. Every run reports how it was solved (`successBy`).

Three agents share the same environment, so a site's score can be read against
a ladder rather than against one number: `nOpt` is the deterministic optimum,
`--agent greedy` is a word matcher without any model (it compares the task
description with what the screen reader speaks and follows a fixed policy:
links list, jump, activate, read under the best heading, search for a keyword),
and the default `--agent llm` is the model. The greedy agent answers "how far
does a user get who can only match words, without understanding" and needs no
API key.

R still mixes two things: how weak the agent is and how much the page hides
from it. `--observation privileged` separates them. It runs the same LLM agent
with the same prompt, commands and costs, but hands it the sighted page view
(landmarks, headings, every control with its name and target, the main text)
on every turn. It still has to navigate with the screen reader; it only knows
where to go. With `nPriv` from that run,

```
nOpt / nSr = (nOpt / nPriv) * (nPriv / nSr)
Q = nOpt / nPriv    the agent: how close it gets when information is no problem
B = nPriv / nSr     the barrier: what the same agent loses for hearing only
```

`B` is the score to report for a site; `Q` says whether the agent can be
trusted on it. `barrier-score.js` prints both from a blind and a privileged
result over the same tasks; a task the privileged agent never solved is
agent-limited and stays out of `B`.

A run on gov.uk with generated tasks:

```
task                                   nOpt  nSr   R
cookie-banner-dismiss                     2    5   0.40
site-search                               3    5   0.60
contact-page, mot-history, travel-advice,
passport, departments                     3    3   1.00
state-pension-age                         6    6   1.00
siteScore 0.94, 8 tasks, cost 0.056 USD
```

```
export OPENROUTER_API_KEY=...
npm run sr-agent -- https://example.com --generate --out result.json
npm run sr-agent -- https://example.com --tasks tasks.json --k 3
npm run sr-agent -- https://example.com --tasks tasks.json --agent greedy   # no LLM
npm run sr-agent -- https://example.com --tasks tasks.json --k 3 --observation privileged --out priv.json
npm run sr-agent:barrier -- result.json priv.json
node src/agent/validate-nopt.js https://example.com --tasks tasks.json
```

### Blind Mode (live demo)

The same environment as a game: black screen, speech output through the Web
Speech API, one key per screen reader command, the oracle evaluated on the
server after every step. At the end the player sees their step count against
`nOpt`, the same R as the agent, and the longest stretch without progress.

```
npm run blind-mode          # http://127.0.0.1:8790, demo site included
```

Sessions are logged as traces in the same format as the agent runs, so human
and agent routes through the same task are directly comparable.

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
npm run test:agent          # screen reader agent, Chromium, no API key needed
npm run test:self-scan      # builds the UI and scans it with the API
npm run lint                # eslint, prettier, dash check
```

`test-sites/` holds about 250 `good-*.html` / `bad-*.html` fixtures with
a `WCAG-TEST` metadata block naming the criteria they exercise. The axe e2e
test runs every fixture; the harnesses in `scripts/harness/` measure true and
false positives per scanner and write the JSON that feeds the trust tiers:

```
npm run harness:exclusive   # one scanner at a time, fresh page each
npm run harness:concurrent  # read-only scanners
npm run harness:llm         # LLM scanners, needs OPENROUTER_API_KEY
npm run harness:realworld -- --json tests/data/harness/harness-realworld.json   # captured real pages, no-crash invariant
npm run precision:check     # captured real pages against the audit labels
```

The two real-world runs scan three snapshots at once (`--parallel 1` for a
sequential run); `harness:realworld` records only with `--json`.

```
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
  scanners/              axe-core adapter and 26 deterministic scanners
  scanners/llm/          12 LLM scanners plus their base class and page context
  llm/client.js          OpenRouter client with retry and fallback models
  report/                HTML and PDF report generator
  utils/                 accessible name, contrast, rendered-state helpers, logger
  agent/                 screen reader agent: env, optimal path, tasks, harness, blind-mode
  data/                  wcag22-criteria.json
frontend/                Next.js UI (pages, components, lib)
scripts/                 coverage matrix, trust derivation, harnesses, fixture capture
tests/
  unit/  e2e/  agent/  self-scan/  helpers/  data/
test-sites/              fixture pages and captured real-world snapshots
Dockerfile, docker-compose.yml, .github/workflows/ci.yml
```
