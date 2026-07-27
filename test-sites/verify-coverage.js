#!/usr/bin/env node

/**
 * WCAG 2.2 Coverage Verification Script
 *
 * Verifies that every WCAG 2.2 criterion (minus 4.1.1, removed) has
 * at least one bad + one good test file.
 *
 * Usage:
 *   node test-sites/verify-coverage.js
 *   node test-sites/verify-coverage.js --verify-coverage  (strict mode, exits 1 on gaps)
 */

const path = require('path');
const { parseDirectory } = require('./wcag-metadata-parser');

const TEST_DIR = __dirname;
const STRICT = process.argv.includes('--verify-coverage');

/**
 * All WCAG 2.2 success criteria (minus 4.1.1 which was removed).
 */
const ALL_CRITERIA = {
  '1.1.1': { level: 'A', title: 'Non-text Content' },
  '1.2.1': { level: 'A', title: 'Audio-only and Video-only (Recorded)' },
  '1.2.2': { level: 'A', title: 'Captions (Recorded)' },
  '1.2.3': { level: 'A', title: 'Audio Description or Media Alternative (Recorded)' },
  '1.2.4': { level: 'AA', title: 'Captions (Live)' },
  '1.2.5': { level: 'AA', title: 'Audio Description (Recorded)' },
  '1.2.6': { level: 'AAA', title: 'Sign Language (Recorded)' },
  '1.2.7': { level: 'AAA', title: 'Extended Audio Description (Recorded)' },
  '1.2.8': { level: 'AAA', title: 'Media Alternative (Recorded)' },
  '1.2.9': { level: 'AAA', title: 'Audio-only (Live)' },
  '1.3.1': { level: 'A', title: 'Info and Relationships' },
  '1.3.2': { level: 'A', title: 'Meaningful Sequence' },
  '1.3.3': { level: 'A', title: 'Sensory Characteristics' },
  '1.3.4': { level: 'AA', title: 'Orientation' },
  '1.3.5': { level: 'AA', title: 'Identify Input Purpose' },
  '1.3.6': { level: 'AAA', title: 'Identify Purpose' },
  '1.4.1': { level: 'A', title: 'Use of Color' },
  '1.4.2': { level: 'A', title: 'Audio Control' },
  '1.4.3': { level: 'AA', title: 'Contrast (Minimum)' },
  '1.4.4': { level: 'AA', title: 'Resize Text' },
  '1.4.5': { level: 'AA', title: 'Images of Text' },
  '1.4.6': { level: 'AAA', title: 'Contrast (Enhanced)' },
  '1.4.7': { level: 'AAA', title: 'Low or No Background Audio' },
  '1.4.8': { level: 'AAA', title: 'Visual Presentation' },
  '1.4.9': { level: 'AAA', title: 'Images of Text (No Exception)' },
  '1.4.10': { level: 'AA', title: 'Reflow' },
  '1.4.11': { level: 'AA', title: 'Non-text Contrast' },
  '1.4.12': { level: 'AA', title: 'Text Spacing' },
  '1.4.13': { level: 'AA', title: 'Content on Hover or Focus' },
  '2.1.1': { level: 'A', title: 'Keyboard' },
  '2.1.2': { level: 'A', title: 'No Keyboard Trap' },
  '2.1.3': { level: 'AAA', title: 'Keyboard (No Exception)' },
  '2.1.4': { level: 'A', title: 'Character Key Shortcuts' },
  '2.2.1': { level: 'A', title: 'Timing Adjustable' },
  '2.2.2': { level: 'A', title: 'Pause, Stop, Hide' },
  '2.2.3': { level: 'AAA', title: 'No Timing' },
  '2.2.4': { level: 'AAA', title: 'Interruptions' },
  '2.2.5': { level: 'AAA', title: 'Re-authentication' },
  '2.2.6': { level: 'AAA', title: 'Timeouts' },
  '2.3.1': { level: 'A', title: 'Three Flashes or Below Threshold' },
  '2.3.2': { level: 'AAA', title: 'Three Flashes' },
  '2.3.3': { level: 'AAA', title: 'Animation from Interactions' },
  '2.4.1': { level: 'A', title: 'Bypass Blocks' },
  '2.4.2': { level: 'A', title: 'Page Titled' },
  '2.4.3': { level: 'A', title: 'Focus Order' },
  '2.4.4': { level: 'A', title: 'Link Purpose (In Context)' },
  '2.4.5': { level: 'AA', title: 'Multiple Ways' },
  '2.4.6': { level: 'AA', title: 'Headings and Labels' },
  '2.4.7': { level: 'AA', title: 'Focus Visible' },
  '2.4.8': { level: 'AAA', title: 'Location' },
  '2.4.9': { level: 'AAA', title: 'Link Purpose (Link Only)' },
  '2.4.10': { level: 'AAA', title: 'Section Headings' },
  '2.4.11': { level: 'AA', title: 'Focus Not Obscured (Minimum)' },
  '2.4.12': { level: 'AAA', title: 'Focus Not Obscured (Enhanced)' },
  '2.4.13': { level: 'AAA', title: 'Focus Appearance' },
  '2.5.1': { level: 'A', title: 'Pointer Gestures' },
  '2.5.2': { level: 'A', title: 'Pointer Cancellation' },
  '2.5.3': { level: 'A', title: 'Label in Name' },
  '2.5.4': { level: 'A', title: 'Motion Actuation' },
  '2.5.5': { level: 'AAA', title: 'Target Size (Enhanced)' },
  '2.5.6': { level: 'AAA', title: 'Concurrent Input Mechanisms' },
  '2.5.7': { level: 'AA', title: 'Dragging Movements' },
  '2.5.8': { level: 'AA', title: 'Target Size (Minimum)' },
  '3.1.1': { level: 'A', title: 'Language of Page' },
  '3.1.2': { level: 'AA', title: 'Language of Parts' },
  '3.1.3': { level: 'AAA', title: 'Unusual Words' },
  '3.1.4': { level: 'AAA', title: 'Abbreviations' },
  '3.1.5': { level: 'AAA', title: 'Reading Level' },
  '3.1.6': { level: 'AAA', title: 'Pronunciation' },
  '3.2.1': { level: 'A', title: 'On Focus' },
  '3.2.2': { level: 'A', title: 'On Input' },
  '3.2.3': { level: 'AA', title: 'Consistent Navigation' },
  '3.2.4': { level: 'AA', title: 'Consistent Identification' },
  '3.2.5': { level: 'AAA', title: 'Change on Request' },
  '3.2.6': { level: 'A', title: 'Consistent Help' },
  '3.3.1': { level: 'A', title: 'Error Identification' },
  '3.3.2': { level: 'A', title: 'Labels or Instructions' },
  '3.3.3': { level: 'AA', title: 'Error Suggestion' },
  '3.3.4': { level: 'AA', title: 'Error Prevention (Legal, Financial, Data)' },
  '3.3.5': { level: 'AAA', title: 'Help' },
  '3.3.6': { level: 'AAA', title: 'Error Prevention (All)' },
  '3.3.7': { level: 'A', title: 'Redundant Entry' },
  '3.3.8': { level: 'AA', title: 'Accessible Authentication (Minimum)' },
  '3.3.9': { level: 'AAA', title: 'Accessible Authentication (Enhanced)' },
  '4.1.2': { level: 'A', title: 'Name, Role, Value' },
  '4.1.3': { level: 'AA', title: 'Status Messages' },
};

function verify() {
  const { parsed, unparsed } = parseDirectory(TEST_DIR);

  // Build coverage map
  const coverage = {};
  for (const criterion of Object.keys(ALL_CRITERIA)) {
    coverage[criterion] = { bad: [], good: [] };
  }

  for (const meta of parsed) {
    for (const c of meta.criterion) {
      if (coverage[c]) {
        coverage[c][meta.testType].push(meta.file);
      }
    }
  }

  // Analyze
  const totalCriteria = Object.keys(ALL_CRITERIA).length;
  let fullyCovered = 0;
  let badOnly = 0;
  let goodOnly = 0;
  let uncovered = 0;

  const gaps = { noBad: [], noGood: [], none: [] };

  for (const [criterion, info] of Object.entries(ALL_CRITERIA)) {
    const cov = coverage[criterion];
    const hasBad = cov.bad.length > 0;
    const hasGood = cov.good.length > 0;

    if (hasBad && hasGood) {
      fullyCovered++;
    } else if (hasBad) {
      badOnly++;
      gaps.noGood.push({ criterion, ...info });
    } else if (hasGood) {
      goodOnly++;
      gaps.noBad.push({ criterion, ...info });
    } else {
      uncovered++;
      gaps.none.push({ criterion, ...info });
    }
  }

  // Scanner coverage matrix
  const scannerMatrix = {};
  for (const meta of parsed) {
    const scanners = meta.scanners || [];
    for (const s of scanners) {
      if (!scannerMatrix[s]) scannerMatrix[s] = new Set();
      for (const c of meta.criterion) {
        scannerMatrix[s].add(c);
      }
    }
  }

  // Output
  console.log('=== WCAG 2.2 Coverage Verification ===\n');
  console.log(`Total criteria (minus 4.1.1): ${totalCriteria}`);
  console.log(`Test files parsed: ${parsed.length}`);
  if (unparsed.length > 0) {
    console.log(`Files without metadata: ${unparsed.length} (${unparsed.join(', ')})`);
  }

  const badFiles = parsed.filter(m => m.testType === 'bad').length;
  const goodFiles = parsed.filter(m => m.testType === 'good').length;
  console.log(`Bad examples: ${badFiles}`);
  console.log(`Good examples: ${goodFiles}`);

  console.log(`\n--- Coverage Summary ---`);
  console.log(`Fully covered (bad + good): ${fullyCovered}/${totalCriteria} (${(fullyCovered / totalCriteria * 100).toFixed(1)}%)`);
  console.log(`Bad only (missing good): ${badOnly}`);
  console.log(`Good only (missing bad): ${goodOnly}`);
  console.log(`Uncovered: ${uncovered}`);

  if (gaps.none.length > 0) {
    console.log(`\n--- Uncovered Criteria ---`);
    for (const g of gaps.none) {
      console.log(`  ${g.criterion} (${g.level}) ${g.title}`);
    }
  }

  if (gaps.noGood.length > 0) {
    console.log(`\n--- Missing Good Counterparts ---`);
    for (const g of gaps.noGood) {
      console.log(`  ${g.criterion} (${g.level}) ${g.title}`);
    }
  }

  if (gaps.noBad.length > 0) {
    console.log(`\n--- Missing Bad Examples ---`);
    for (const g of gaps.noBad) {
      console.log(`  ${g.criterion} (${g.level}) ${g.title}`);
    }
  }

  console.log(`\n--- Scanner Coverage Matrix ---`);
  for (const [scanner, criteria] of Object.entries(scannerMatrix).sort()) {
    console.log(`  ${scanner}: ${Array.from(criteria).sort().join(', ')}`);
  }

  // Level breakdown
  const byLevel = { A: { total: 0, covered: 0 }, AA: { total: 0, covered: 0 }, AAA: { total: 0, covered: 0 } };
  for (const [criterion, info] of Object.entries(ALL_CRITERIA)) {
    byLevel[info.level].total++;
    if (coverage[criterion].bad.length > 0 || coverage[criterion].good.length > 0) {
      byLevel[info.level].covered++;
    }
  }

  console.log(`\n--- Coverage by Level ---`);
  for (const [level, stats] of Object.entries(byLevel)) {
    console.log(`  ${level}: ${stats.covered}/${stats.total} (${(stats.covered / stats.total * 100).toFixed(0)}%)`);
  }

  if (STRICT && (uncovered > 0 || gaps.noGood.length > 0)) {
    console.log('\nSTRICT MODE: Coverage gaps detected. Exiting with code 1.');
    process.exit(1);
  }

  return { totalCriteria, fullyCovered, badOnly, goodOnly, uncovered, gaps, coverage };
}

if (require.main === module) {
  verify();
}

module.exports = { verify, ALL_CRITERIA };
