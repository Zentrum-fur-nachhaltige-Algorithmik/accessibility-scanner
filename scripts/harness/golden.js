#!/usr/bin/env node

/**
 * Golden-corpus false-positive harness.
 *
 * Scans the static export of the med-websites template (5 themes × 8 routes,
 * `test-sites/realworld/med-templates/`, built to be WCAG 2.2 AA compliant)
 * with the FULL profile and asserts two things per route:
 *
 *   1. FORBIDDEN rules (known false-positive classes) fire at most `max`
 *      times (default 0).
 *   2. EXPECTED rules (the real defects the report verified by hand) still
 *      fire — so the fixes cannot "pass" by going blind.
 *
 * Plus two corpus-wide invariants: no `critical` finding anywhere, and no
 * scanner crash.
 *
 * Every theme is served from its own document root because the Next.js export
 * uses absolute `/_next/...` asset paths.
 *
 * Usage:
 *   node scripts/harness/golden.js                   # all themes, no LLM
 *   node scripts/harness/golden.js --theme evergreen --route index
 *   node scripts/harness/golden.js --llm             # include LLM scanners (costs money)
 *   node scripts/harness/golden.js --json tests/data/harness/harness-golden.json
 *   node scripts/harness/golden.js --report          # print every rule, not only guarded ones
 */

const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const { isHardViolation, normalizeSeverity } = require(path.join(ROOT, 'src', 'core', 'severity'));
const CORPUS = path.join(ROOT, 'test-sites', 'realworld', 'med-templates');

if (!fs.existsSync(CORPUS)) {
  console.log(`golden corpus not present (${path.relative(ROOT, CORPUS)}), nothing to check`);
  process.exit(0);
}
const THEMES = ['evergreen', 'clinic', 'spectrum', 'lumen', 'warmth'];
const ROUTES = [
  'index',
  'leistungen',
  'team',
  'kontakt',
  'preise',
  'patienteninfo',
  'impressum',
  'datenschutz',
];
const PER_PAGE_TIMEOUT_MS = 600000;

/**
 * Rules that must NOT fire on a healthy page. Keys are the rule ids as they
 * appear on violations (`issue` || `type` || `ruleId`). `fp` links to the
 * report section, `criteria` to the WCAG SC the rule claims to test (so the
 * coverage matrix can record that the criterion has a golden guard).
 */
const FORBIDDEN = {
  'touch-target-too-small': { fp: 'FP-1', criteria: ['2.5.8'], max: 0 },
  'touch-targets-too-close': { fp: 'FP-1', criteria: ['2.5.8'], max: 0 },
  'target-size-too-small': { fp: 'FP-1', criteria: ['2.5.8'], max: 0 },
  'target-size-underspaced': { fp: 'FP-1', criteria: ['2.5.8'], max: 0 },
  // `real` = themes where the rule was RE-VERIFIED as a genuine defect on
  // 2026-08-24 (screenshots in the FP report addendum); there it is allowed
  // at most `realMax` times per route (grouped finding per overlay).
  'interaction-blocked': {
    fp: 'FP-2',
    criteria: ['1.4.4'],
    max: 0,
    real: ['warmth', 'lumen', 'spectrum'],
    realMax: 1,
  },
  'missing-focus-indicator': { fp: 'FP-3', criteria: ['2.4.7', '1.4.11'], max: 0 },
  'no-visible-focus': { fp: 'FP-3', criteria: ['2.4.7'], max: 0 },
  'horizontal-scroll': { fp: 'FP-4', criteria: ['1.4.10'], max: 0 },
  'content-loss': { fp: 'FP-4', criteria: ['1.4.10'], max: 0 },
  'overlapping-content': { fp: 'FP-4', criteria: ['1.4.10'], max: 0 },
  'keyboard-trap': { fp: 'FP-5', criteria: ['2.1.2'], max: 0 },
  'missing-scroll-padding': { fp: 'FP-7', criteria: ['2.4.11'], max: 0 },
  'focus-obscured-by-sticky-element': {
    fp: 'FP-9',
    criteria: ['2.4.11'],
    max: 0,
    real: ['lumen', 'warmth'],
    realMax: 1,
  },
  'focus-obscured-by-fixed-element': {
    fp: 'FP-9',
    criteria: ['2.4.11'],
    max: 0,
    real: ['evergreen', 'warmth', 'lumen', 'spectrum'],
    realMax: 1,
  },
  'accessible-name-no-visible-text': { fp: 'FP-10', criteria: ['2.5.3'], max: 0 },
  'hover-only-no-focus': { fp: 'FP-11', criteria: ['1.4.13'], max: 0 },
  'hover-content-not-dismissable': { fp: 'FP-11', criteria: ['1.4.13'], max: 0 },
  'insufficient-border-contrast': { fp: 'FP-12', criteria: ['1.4.11'], max: 0 },
  'missing-viewport-meta': { fp: 'FP-14', criteria: ['1.4.10'], max: 0 },
};

/**
 * Real defects verified by hand in the report (section "Echte Befunde"). Each
 * must still be detected somewhere in the theme (`anyRoute`) so a fix that
 * simply silences a scanner is caught. Matching is by rule id (substring).
 */
const EXPECTED = [
  {
    rule: 'insufficient-focus-indicator-contrast',
    why: 'footer focus ring 1.41:1 (1.4.11)',
    themes: ['evergreen'],
  },
  { rule: 'heading-order', why: 'h1 -> h4 jump in footer (axe-core)', themes: THEMES },
  { rule: 'accessibility-statement', why: 'no Barrierefreiheitserklärung (EAA)', themes: THEMES },
  // FP-8 was re-verified on 2026-08-24: with 1.4.12 spacing injected the stat
  // label "Ausführliche Gespräche" is clipped by its overflow:hidden grid
  // (evergreen/clinic @1920 by 30px) — a real loss of content, not a FP.
  {
    rule: 'text-spacing-failure',
    why: 'stat label clipped under 1.4.12 spacing (1.4.12)',
    themes: ['evergreen', 'clinic'],
  },
  // Skip link painted under header.header{z-index:100} (lumen/warmth) and
  // footer links under the fixed a.sticky-cta — real 2.4.11 template bugs.
  {
    rule: 'focus-obscured-by-sticky-element',
    why: 'skip link hidden behind header z-index (2.4.11)',
    themes: ['lumen', 'warmth'],
  },
  {
    rule: 'focus-obscured-by-fixed-element',
    why: 'footer links under fixed sticky-cta (2.4.11)',
    themes: ['evergreen'],
  },
  {
    rule: 'interaction-blocked',
    why: 'sticky-cta covers footer links at <=640px (1.4.10)',
    themes: ['warmth', 'lumen', 'spectrum'],
  },
];

/** Criteria that this harness guards against false positives. */
const GOLDEN_CRITERIA = [...new Set(Object.values(FORBIDDEN).flatMap((f) => f.criteria))].sort();

module.exports = { FORBIDDEN, EXPECTED, GOLDEN_CRITERIA, THEMES, ROUTES };

// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

function serve(rootDir) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    let p = path.join(rootDir, rel);
    if (!p.startsWith(rootDir)) {
      res.writeHead(403);
      return res.end();
    }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  });
  return new Promise((r) => server.listen(0, () => r({ server, port: server.address().port })));
}

function ruleOf(v) {
  return v.issue || v.type || v.ruleId || v.axeRuleId || 'unclassified';
}

function parseArgs(argv) {
  const out = { themes: THEMES, routes: ROUTES, llm: false, json: null, report: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--theme') out.themes = argv[++i].split(',');
    else if (argv[i] === '--route') out.routes = argv[++i].split(',');
    else if (argv[i] === '--llm') out.llm = true;
    else if (argv[i] === '--json') out.json = argv[++i];
    else if (argv[i] === '--report') out.report = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(
        'Usage: node scripts/harness/golden.js [--theme a,b] [--route x,y] [--llm] [--json <path>] [--report]'
      );
      process.exit(0);
    }
  }
  return out;
}

async function scanPage(url, scannerIds, scanOptions) {
  const ScanPipeline = require(path.join(ROOT, 'src', 'core', 'scan-pipeline'));
  const { registerAllScanners } = require(path.join(ROOT, 'src', 'core', 'scanner-registry'));
  const pipeline = new ScanPipeline();
  const registeredIds = registerAllScanners(pipeline).map((s) => s.id);
  const ids = scannerIds ? scannerIds.filter((id) => registeredIds.includes(id)) : registeredIds;
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(
      () => rej(new Error(`WALL-CLOCK TIMEOUT after ${PER_PAGE_TIMEOUT_MS}ms`)),
      PER_PAGE_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([
      pipeline.scan(url, { ...scanOptions, scannerIds: ids, timeout: 60000 }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
    await pipeline.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.llm) delete process.env.OPENROUTER_API_KEY;
  else {
    const envPath = path.join(ROOT, '.env');
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const m = line.match(/^(\w+)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
      }
    }
  }
  const { getProfile } = require(path.join(ROOT, 'src', 'core', 'scanner-registry'));
  // includeExperimental: a quarantined scanner must still prove it is clean
  // on the golden corpus before it can be promoted.
  const { scannerIds, options } = getProfile('full', { includeExperimental: true });

  const started = Date.now();
  const report = {
    generatedAt: new Date().toISOString(),
    profile: 'full',
    llm: !!process.env.OPENROUTER_API_KEY,
    pages: [],
    ruleTotals: {},
    failures: [],
  };
  const failures = report.failures;
  const seenExpected = {}; // theme -> Set(rule)

  for (const theme of args.themes) {
    const rootDir = path.join(CORPUS, theme);
    if (!fs.existsSync(rootDir)) {
      failures.push(`corpus missing: ${rootDir}`);
      continue;
    }
    const { server, port } = await serve(rootDir);
    seenExpected[theme] = new Set();
    try {
      for (const route of args.routes) {
        const url = `http://localhost:${port}/${route === 'index' ? '' : route + '/'}`;
        const label = `${theme}/${route}`;
        process.stdout.write(`${label.padEnd(26)} `);
        let result;
        try {
          result = await scanPage(url, scannerIds, options);
        } catch (err) {
          console.log(`CRASH ${err.message}`);
          failures.push(`${label}: scan crashed: ${err.message}`);
          report.pages.push({ theme, route, crashed: true, error: err.message });
          continue;
        }
        const violations = result.violations || [];
        const counts = {};
        for (const v of violations) {
          if (!isHardViolation(v)) continue; // info + best-practice carry no score weight
          const r = ruleOf(v);
          counts[r] = (counts[r] || 0) + 1;
          report.ruleTotals[r] = (report.ruleTotals[r] || 0) + 1;
        }
        const critical = violations.filter((v) => normalizeSeverity(v) === 'critical');
        const crashed = Object.entries(result.scanners || {})
          .filter(([, s]) => s.error)
          .map(([id, s]) => `${id}: ${s.error}`);

        const pageFail = [];
        for (const [rule, spec] of Object.entries(FORBIDDEN)) {
          const n = counts[rule] || 0;
          const max = (spec.real || []).includes(theme) ? spec.realMax : spec.max;
          if (n > max) pageFail.push(`${rule} ×${n} (${spec.fp}, max ${max})`);
        }
        if (critical.length)
          pageFail.push(
            `${critical.length} critical finding(s): ${[...new Set(critical.map(ruleOf))].join(', ')}`
          );
        for (const c of crashed) pageFail.push(`scanner error: ${c}`);
        // EXPECTED matches against EVERY violation, not just `counts`: the
        // harness counts only hard violations, but two of the real defects the
        // report verified by hand are reported by axe-core rules that carry
        // only the `best-practice` tag ('heading-order' is the h1->h4 footer
        // jump). Those now normalise to severity 'best-practice' — correctly,
        // that is axe's own taxonomy — and would otherwise look like a fix that
        // went blind.
        for (const e of EXPECTED)
          for (const v of violations)
            if (ruleOf(v).includes(e.rule)) seenExpected[theme].add(e.rule);

        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        console.log(
          `${pageFail.length ? 'FAIL' : 'ok  '} score=${String(result.accessibilityScore).padStart(3)} findings=${String(total).padStart(4)} critical=${critical.length}`
        );
        for (const f of pageFail) {
          console.log(`      - ${f}`);
          failures.push(`${label}: ${f}`);
        }
        report.pages.push({
          theme,
          route,
          score: result.accessibilityScore,
          findings: total,
          critical: critical.length,
          counts,
          failed: pageFail,
        });
      }
    } finally {
      server.close();
    }
    for (const e of EXPECTED) {
      if (!e.themes.includes(theme)) continue;
      if (!seenExpected[theme].has(e.rule)) {
        const msg = `${theme}: expected real finding '${e.rule}' not detected (${e.why})`;
        console.log(`      - MISSING ${msg}`);
        failures.push(msg);
      }
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `\n=== golden corpus: ${report.pages.length} pages in ${elapsed}s — ${failures.length ? `${failures.length} FAILURE(S)` : 'PASS'} ===`
  );
  const sorted = Object.entries(report.ruleTotals).sort((a, b) => b[1] - a[1]);
  console.log('\nrule totals across corpus' + (args.report ? '' : ' (top 15; --report for all)'));
  for (const [r, n] of args.report ? sorted : sorted.slice(0, 15)) {
    const g = FORBIDDEN[r] ? ` [${FORBIDDEN[r].fp}]` : '';
    console.log(`  ${String(n).padStart(5)}  ${r}${g}`);
  }
  if (args.json) {
    fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true });
    fs.writeFileSync(path.resolve(args.json), JSON.stringify(report, null, 2));
    console.log(`\nwrote ${args.json}`);
  }
  process.exit(failures.length ? 1 : 0);
}

if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
