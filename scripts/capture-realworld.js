#!/usr/bin/env node

/**
 * capture-realworld.js — build the frozen real-world regression corpus.
 *
 * Captures a handful of REAL pages into `test-sites/realworld/*.html` and
 * sanitizes them so the corpus is offline-reproducible and side-effect free.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every fundamental scanner bug found in the 2026-07 sprint came from real
 * page structures that the synthetic `test-sites/bad-*.html` corpus never
 * produces:
 *   - SVG `className` is an `SVGAnimatedString` object, not a string
 *   - an open JS dialog freezes the renderer for every later evaluate()
 *   - a dead <iframe> stalls axe-core injection
 *   - `language-detection` threw "Cannot read properties of undefined
 *     (reading 'map')" on Next.js pages
 * Hand-written fixtures are too tidy to reproduce any of that. These are not.
 *
 * The OUTPUT of this script is what gets committed — you should not need to
 * re-run it. Re-run only to refresh the corpus (which invalidates the sanity
 * bands hard-coded in test-realworld.js).
 *
 * Usage:
 *   node scripts/capture-realworld.js            # capture all
 *   node scripts/capture-realworld.js --only med-theme
 *
 * The `own-audit-ui` target needs the repo's own Next.js frontend running:
 *   npx next start frontend -p 3111     (or: npx next dev frontend -p 3111)
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'test-sites', 'realworld');

/**
 * Analytics / tag-manager / session-replay signatures.
 * Scripts whose `src` OR inline body match are DROPPED. Everything else is
 * kept on purpose — exercising real script-bearing markup is the whole point.
 */
const ANALYTICS_RE =
  'google-analytics|googletagmanager|gtag\\(|gtm\\.js|hotjar|segment\\.|plausible|matomo|piwik|facebook\\.net|fbq\\(|clarity\\.ms|doubleclick|sentry|datadog|intercom|hubspot';

/**
 * Elements whose resource URLs get neutralised. `<a href>` is deliberately
 * absent — navigation targets are page CONTENT (scanners inspect them), not
 * resources to be fetched.
 */
const RESOURCE_SELECTOR = 'img, script, link, video, audio, source, iframe';

const TARGETS = [
  {
    name: 'own-audit-ui',
    url: 'http://localhost:3111/audit',
    fallbackUrl: 'http://localhost:3111/',
    purpose:
      "this repo's own Next.js /audit route — hydration markup and the __next-route-announcer__ live region; live repro for the language-detection undefined.map crash. NOTE: this route renders no inline SVG (the icon-bearing ScanResults component only mounts after a scan completes)",
  },
  {
    name: 'med-theme',
    url: 'https://dr-mauermann-urologe.vercel.app',
    purpose:
      'med-websites theme export — German medical content, the actual production target of this scanner',
  },
  {
    name: 'beeproduced',
    url: 'https://beeproduced.com',
    purpose: 'agency marketing site — the original real-world page this project was built to audit',
  },
  {
    name: 'wiki-medical-de',
    url: 'https://de.wikipedia.org/wiki/Prostatakarzinom',
    purpose:
      "long German medical article — content-rich, data tables, inline lang switches; far exceeds the LLM extractors' old 15,000-char cutoff",
  },
  {
    name: 'modern-commercial',
    url: 'https://www.mozilla.org/de/',
    purpose:
      'modern commercial page — cookie banner, fixed header, heavy inline-SVG icon usage, German locale',
  },
];

async function loadPuppeteer() {
  try {
    return require('puppeteer');
  } catch {
    const mod = await import('puppeteer');
    return mod.default || mod;
  }
}

/**
 * Sanitize IN THE LIVE DOM, immediately before serialising.
 *
 * Done in-page rather than by regexing the HTML string for two reasons:
 *   1. attribute rewriting is exact (no risk of mangling `<a href>` or of
 *      tripping over quoting styles), and
 *   2. it also catches analytics tags that scripts INJECTED at runtime,
 *      which a string pass over the original source would miss.
 *
 * It does not reformat anything: `page.content()` serialises the DOM as-is,
 * so structural fidelity is preserved.
 */
async function sanitizeInPage(page, analyticsRe, resourceSelector) {
  return page.evaluate(
    (reSrc, selector) => {
      const re = new RegExp(reSrc, 'i');
      const stats = { scriptsRemoved: 0, urlsRewritten: 0, cssUrlsRewritten: 0 };

      // --- 1. drop analytics / tag-manager / session-replay scripts ---
      for (const s of Array.from(document.querySelectorAll('script'))) {
        const src = s.getAttribute('src') || '';
        const body = s.textContent || '';
        if (re.test(src) || re.test(body)) {
          s.remove();
          stats.scriptsRemoved++;
        }
      }

      // --- 2. neutralise external resource URLs ---
      const basenameOf = (raw) => {
        let u;
        try {
          u = new URL(raw, document.baseURI);
        } catch {
          return 'resource';
        }
        const seg = u.pathname.split('/').filter(Boolean).pop() || u.hostname || 'resource';
        const clean = seg.replace(/[^A-Za-z0-9._-]/g, '_');
        return clean || 'resource';
      };
      // Protocol-relative (`//upload.wikimedia.org/...`) counts as external:
      // served over http:// at test time it resolves to a real remote fetch.
      const isExternal = (v) => /^(https?:)?\/\//i.test((v || '').trim());

      for (const el of Array.from(document.querySelectorAll(selector))) {
        for (const attr of ['src', 'href']) {
          const v = el.getAttribute(attr);
          if (v && isExternal(v)) {
            el.setAttribute(attr, './_offline/' + basenameOf(v));
            stats.urlsRewritten++;
          }
        }
        const srcset = el.getAttribute('srcset');
        if (srcset) {
          const rewritten = srcset
            .split(',')
            .map((part) => {
              const t = part.trim();
              if (!t) return null;
              const bits = t.split(/\s+/);
              if (isExternal(bits[0])) {
                bits[0] = './_offline/' + basenameOf(bits[0]);
                stats.urlsRewritten++;
              }
              return bits.join(' ');
            })
            .filter(Boolean)
            .join(', ');
          el.setAttribute('srcset', rewritten);
        }
      }

      // --- 3. neutralise CSS url() fetches (webfonts, sprite sheets) ---
      // Not an attribute, but every bit as much a network fetch: leaving these
      // in makes the corpus non-reproducible AND lets webfont loading shift
      // rendered text metrics, which would make the sanity bands flaky.
      const CSS_URL_RE = /url\(\s*(['"]?)((?:https?:)?\/\/[^)'"]+)\1\s*\)/gi;
      const rewriteCss = (css) =>
        css.replace(CSS_URL_RE, (_m, _q, u) => {
          stats.cssUrlsRewritten++;
          return "url('./_offline/" + basenameOf(u) + "')";
        });

      for (const styleEl of Array.from(document.querySelectorAll('style'))) {
        const css = styleEl.textContent || '';
        if (CSS_URL_RE.test(css)) {
          CSS_URL_RE.lastIndex = 0;
          styleEl.textContent = rewriteCss(css);
        }
        CSS_URL_RE.lastIndex = 0;
      }
      for (const el of Array.from(document.querySelectorAll('[style*="url("]'))) {
        const css = el.getAttribute('style') || '';
        el.setAttribute('style', rewriteCss(css));
        CSS_URL_RE.lastIndex = 0;
      }

      return stats;
    },
    analyticsRe,
    resourceSelector
  );
}

function header(sourceUrl, purpose) {
  return (
    '<!-- REALWORLD-FIXTURE\n' +
    `source: ${sourceUrl}\n` +
    `captured: ${new Date().toISOString()}\n` +
    'sanitized: analytics scripts removed; external resource URLs rewritten to ./_offline/*\n' +
    `purpose: ${purpose}\n` +
    '-->\n'
  );
}

async function captureOne(browser, target) {
  const page = await browser.newPage();

  // MUST be installed before navigation: puppeteer leaves a dialog open while
  // no listener is attached, and an open dialog blocks the renderer main
  // thread forever. This is the exact freeze that bit the pipeline.
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  page.on('pageerror', () => {});

  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  );

  let usedUrl = target.url;
  try {
    const resp = await page.goto(target.url, { waitUntil: 'networkidle2', timeout: 45000 });
    if (resp && resp.status() === 404 && target.fallbackUrl) {
      console.log(`  ${target.url} returned 404 — falling back to ${target.fallbackUrl}`);
      usedUrl = target.fallbackUrl;
      await page.goto(usedUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    }
  } catch (err) {
    if (!target.fallbackUrl) throw err;
    console.log(`  ${target.url} failed (${err.message}) — falling back to ${target.fallbackUrl}`);
    usedUrl = target.fallbackUrl;
    await page.goto(usedUrl, { waitUntil: 'networkidle2', timeout: 45000 });
  }

  // Let client-side frameworks hydrate, cookie banners appear, lazy content
  // settle. For Next.js this is when __next-route-announcer__ gets created.
  await new Promise((r) => setTimeout(r, 2000));

  const stats = await sanitizeInPage(page, ANALYTICS_RE, RESOURCE_SELECTOR);
  const html = await page.content();
  await page.close().catch(() => {});

  const out = header(usedUrl, target.purpose) + html;
  const dest = path.join(OUT_DIR, `${target.name}.html`);
  fs.writeFileSync(dest, out, 'utf-8');

  return { dest, bytes: Buffer.byteLength(out), usedUrl, stats };
}

async function main() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

  const targets = only ? TARGETS.filter((t) => t.name === only) : TARGETS;
  if (targets.length === 0) {
    console.error(
      `No target matching --only ${only}. Known: ${TARGETS.map((t) => t.name).join(', ')}`
    );
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const puppeteer = await loadPuppeteer();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let failures = 0;
  try {
    for (const t of targets) {
      console.log(`\n=== ${t.name} <- ${t.url}`);
      try {
        const r = await captureOne(browser, t);
        console.log(
          `  OK ${path.relative(process.cwd(), r.dest)} — ${r.bytes} bytes ` +
            `(${r.stats.scriptsRemoved} analytics scripts removed, ${r.stats.urlsRewritten} attr URLs ` +
            `+ ${r.stats.cssUrlsRewritten} css url() rewritten)`
        );
      } catch (err) {
        failures++;
        console.error(`  FAILED ${t.name}: ${err.message}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log('\n=== CAPTURE SUMMARY ===');
  for (const t of TARGETS) {
    const f = path.join(OUT_DIR, `${t.name}.html`);
    if (fs.existsSync(f)) {
      console.log(`  ${t.name.padEnd(20)} ${String(fs.statSync(f).size).padStart(9)} bytes`);
    } else {
      console.log(`  ${t.name.padEnd(20)} MISSING`);
    }
  }
  process.exit(failures > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { TARGETS, ANALYTICS_RE, RESOURCE_SELECTOR };
