#!/usr/bin/env node

/**
 * capture-realworld.js: capture real pages into test-sites/realworld/*.html and
 * sanitize them (analytics scripts dropped, external URLs rewritten) for offline scanning.
 *
 * Usage:
 *   node scripts/capture-realworld.js            # capture all
 *   node scripts/capture-realworld.js --only med-theme
 *   node scripts/capture-realworld.js --url https://example.org --name example-org --purpose "..."
 *
 * The `own-audit-ui` target needs the repo's own Next.js frontend running:
 *   npx next start frontend -p 3111     (or: npx next dev frontend -p 3111)
 */

const fs = require('fs');
const path = require('path');

// The captured files are committed. Re-run only to refresh the corpus, which
// invalidates the sanity bands in scripts/harness/realworld.js.
const OUT_DIR = path.join(__dirname, '..', 'test-sites', 'realworld');

/**
 * Analytics / tag-manager / session-replay signatures.
 * Scripts whose `src` or inline body match are dropped. Everything else is
 * kept: scanners must see real script-bearing markup.
 */
const ANALYTICS_RE =
  'google-analytics|googletagmanager|gtag\\(|gtm\\.js|hotjar|segment\\.|plausible|matomo|piwik|facebook\\.net|fbq\\(|clarity\\.ms|doubleclick|sentry|datadog|intercom|hubspot';

/**
 * Elements whose resource URLs get neutralised. `<a href>` is excluded:
 * navigation targets are page content that scanners inspect, not resources
 * to be fetched.
 */
const RESOURCE_SELECTOR = 'img, script, link, video, audio, source, iframe';

// Per-stylesheet ceiling for inlining, so one framework bundle cannot blow the
// snapshot past the size the corpus is meant to stay within.
const MAX_INLINE_CSS_BYTES = 2000000;

const TARGETS = [
  {
    name: 'own-audit-ui',
    url: 'http://localhost:3111/audit',
    fallbackUrl: 'http://localhost:3111/',
    purpose:
      "this repo's own Next.js /audit route: hydration markup and the __next-route-announcer__ live region. This route renders no inline SVG (the icon-bearing ScanResults component only mounts after a scan completes)",
  },
  {
    name: 'med-theme',
    url: 'https://dr-mauermann-urologe.vercel.app',
    purpose:
      'med-websites theme export: German medical content, the production target of this scanner',
  },
  {
    name: 'beeproduced',
    url: 'https://beeproduced.com',
    purpose: 'agency marketing site: the original real-world page this project was built to audit',
  },
  {
    name: 'wiki-medical-de',
    url: 'https://de.wikipedia.org/wiki/Prostatakarzinom',
    purpose:
      'long German medical article: content-rich, data tables, inline lang switches, several hundred thousand characters of text',
  },
  {
    name: 'modern-commercial',
    url: 'https://www.mozilla.org/de/',
    purpose:
      'modern commercial page: cookie banner, fixed header, heavy inline-SVG icon usage, German locale',
  },
  {
    name: 'gov-uk-guide',
    url: 'https://www.gov.uk/vehicle-tax',
    purpose:
      'GOV.UK service guide: a page held up as a reference for accessible public-sector markup, GDS Transport webfont, skip link, breadcrumb, step-by-step navigation',
  },
  {
    name: 'webaim-article',
    url: 'https://webaim.org/techniques/skipnav/',
    purpose:
      'WebAIM technique article: hand-written reference markup by accessibility practitioners, a real skip link, code samples and a sidebar navigation',
  },
  {
    name: 'govuk-design-system',
    url: 'https://design-system.service.gov.uk/components/text-input/',
    purpose:
      'component library documentation: tabbed example/HTML/Nunjucks panels, iframe-embedded live examples, sub navigation, a page whose components are themselves the accessibility reference',
  },
  {
    name: 'a11y-project-checklist',
    url: 'https://www.a11yproject.com/checklist/',
    purpose:
      'community accessibility checklist: long list-heavy content, many in-page anchors and disclosure widgets, dark-mode-capable colour tokens',
  },
  {
    name: 'broadcaster-news',
    url: 'https://www.bbc.com/news',
    purpose:
      'public broadcaster news front page: dense card grid, many links whose accessible name comes from a heading, region landmarks and a live promo carousel',
  },
  {
    name: 'wiki-accessibility-en',
    url: 'https://en.wikipedia.org/wiki/Web_accessibility',
    purpose:
      'English encyclopedia article: reference lists, footnote superscript links, sidebar navigation and inline lang switches on a different Wikipedia skin path than the German capture',
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
 * Sanitize in the live DOM, immediately before serialising.
 *
 * Done in-page rather than by regexing the HTML string: attribute rewriting is
 * exact (no risk of mangling `<a href>` or of tripping over quoting styles),
 * and it also catches analytics tags that scripts injected at runtime.
 * `page.content()` serialises the DOM as-is, so structure is preserved.
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
    'sanitized: analytics scripts removed; stylesheets inlined; external resource URLs rewritten to ./_offline/*\n' +
    `purpose: ${purpose}\n` +
    '-->\n'
  );
}

/**
 * Inline the stylesheets the page loaded, so the snapshot renders with the
 * layout and colours of the original. Without this every external sheet
 * becomes a dead ./_offline/ URL and the snapshot is unstyled markup, which
 * hides everything the contrast, reflow and text-resize scanners look at.
 *
 * `bodies` maps stylesheet URL to CSS text, collected from the responses of
 * the live navigation.
 */
async function inlineStylesheets(page, bodies, maxBytes) {
  return page.evaluate(
    (map, limit) => {
      let inlined = 0;
      let skipped = 0;
      for (const link of Array.from(document.querySelectorAll('link[rel~="stylesheet"]'))) {
        const href = link.href;
        const css = map[href];
        if (!css) {
          skipped++;
          continue;
        }
        if (css.length > limit) {
          skipped++;
          continue;
        }
        const style = document.createElement('style');
        if (link.media) style.media = link.media;
        style.textContent = css;
        link.replaceWith(style);
        inlined++;
      }
      return { inlined, skipped };
    },
    bodies,
    maxBytes
  );
}

async function captureOne(browser, target) {
  const page = await browser.newPage();

  // Must be installed before navigation: puppeteer leaves a dialog open while
  // no listener is attached, and an open dialog blocks the renderer main
  // thread forever.
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  page.on('pageerror', () => {});

  // Stylesheet bodies, keyed by URL, so they can be inlined before serialising.
  const cssBodies = {};
  page.on('response', async (resp) => {
    const type = resp.headers()['content-type'] || '';
    if (!/text\/css/i.test(type)) return;
    try {
      cssBodies[resp.url()] = await resp.text();
    } catch {
      // Redirects and aborted requests have no body: nothing to inline.
    }
  });

  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  );

  let usedUrl = target.url;
  try {
    const resp = await page.goto(target.url, { waitUntil: 'networkidle2', timeout: 45000 });
    if (resp && resp.status() === 404 && target.fallbackUrl) {
      console.log(`  ${target.url} returned 404, falling back to ${target.fallbackUrl}`);
      usedUrl = target.fallbackUrl;
      await page.goto(usedUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    }
  } catch (err) {
    if (!target.fallbackUrl) throw err;
    console.log(`  ${target.url} failed (${err.message}), falling back to ${target.fallbackUrl}`);
    usedUrl = target.fallbackUrl;
    await page.goto(usedUrl, { waitUntil: 'networkidle2', timeout: 45000 });
  }

  // Let client-side frameworks hydrate, cookie banners appear, lazy content
  // settle. For Next.js this is when __next-route-announcer__ gets created.
  await new Promise((r) => setTimeout(r, 2000));

  const cssStats = await inlineStylesheets(page, cssBodies, MAX_INLINE_CSS_BYTES);
  const stats = await sanitizeInPage(page, ANALYTICS_RE, RESOURCE_SELECTOR);
  stats.cssInlined = cssStats.inlined;
  stats.cssSkipped = cssStats.skipped;
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
  // An ad-hoc target for widening the corpus: --url <url> --name <file stem> [--purpose <text>].
  const argOf = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  const adHoc =
    argOf('--url') && argOf('--name')
      ? [
          {
            name: argOf('--name'),
            url: argOf('--url'),
            purpose: argOf('--purpose') || 'corpus widening',
          },
        ]
      : null;

  const targets = adHoc || (only ? TARGETS.filter((t) => t.name === only) : TARGETS);
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
          `  OK ${path.relative(process.cwd(), r.dest)}: ${r.bytes} bytes ` +
            `(${r.stats.scriptsRemoved} analytics scripts removed, ${r.stats.urlsRewritten} attr URLs ` +
            `+ ${r.stats.cssUrlsRewritten} css url() rewritten, ${r.stats.cssInlined} stylesheets inlined, ` +
            `${r.stats.cssSkipped} skipped)`
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
  for (const t of adHoc || TARGETS) {
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
