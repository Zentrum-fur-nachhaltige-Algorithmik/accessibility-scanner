#!/usr/bin/env node

import { discoverAndDownloadPapers, downloadAndValidatePaper } from '../lib/arxiv-downloader.js';

const args = process.argv.slice(2);

// Usage: node download-papers.js [arxivId1 arxivId2 ...]
// Without args: auto-discover papers via arXiv API
// With args: download specific papers by ID

console.log('=== arXiv Paper Downloader ===\n');

try {
  let papers;

  if (args.length > 0) {
    console.log(`Downloading ${args.length} specific papers...`);
    papers = [];
    for (const id of args) {
      const result = await downloadAndValidatePaper(id, id);
      if (result) papers.push(result);
    }
  } else {
    console.log('Auto-discovering formula-dense papers...');
    papers = await discoverAndDownloadPapers();
  }

  if (papers.length === 0) {
    console.error('\nERROR: No papers met the selection criteria.');
    process.exit(1);
  }

  console.log('\nAccepted papers:');
  for (const p of papers) {
    console.log(`  ${p.arxivId}: ${p.title}`);
    console.log(`    Display: ${p.formulaCounts.displayCount}, Inline: ${p.formulaCounts.inlineCount}`);
  }
} catch (err) {
  console.error('Fatal error:', err.message);
  process.exit(1);
}
