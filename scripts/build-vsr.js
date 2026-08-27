#!/usr/bin/env node
/**
 * Bundles @guidepup/virtual-screen-reader into a single browser IIFE so the
 * SR-agent env can inject it into any Puppeteer page.
 *
 * The published browser entry (`@guidepup/virtual-screen-reader/browser.js`)
 * is an ES module, which cannot be injected through `page.evaluate(source)`.
 * We therefore re-bundle it as an IIFE exposing `window.__VSR = { Virtual,
 * virtual }`. Injecting via `page.evaluate` (CDP Runtime.evaluate) instead of
 * `page.addScriptTag` also survives sites with a restrictive script-src CSP.
 *
 * Output (committed): src/agent/vendor/virtual-screen-reader.js
 * Run with: npm run build:vsr
 */
const path = require('path');
const esbuild = require('esbuild');

const outfile = path.resolve(__dirname, '../src/agent/vendor/virtual-screen-reader.js');

esbuild
  .build({
    entryPoints: [require.resolve('@guidepup/virtual-screen-reader/browser.js')],
    bundle: true,
    format: 'iife',
    globalName: '__VSR',
    platform: 'browser',
    target: ['chrome110'],
    legalComments: 'none',
    sourcemap: false,
    minify: true,
    outfile,
  })
  .then(() => {
    console.log(`built ${outfile}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
