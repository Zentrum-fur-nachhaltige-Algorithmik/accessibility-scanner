#!/usr/bin/env node
/**
 * build-vsr: bundles @guidepup/virtual-screen-reader into a browser IIFE
 * (`window.__VSR`) so ScreenReaderEnv can inject it via `page.evaluate`, which
 * survives a restrictive script-src CSP. Run with `npm run build:vsr`.
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
