#!/usr/bin/env node

/**
 * Migration script: Add WCAG-TEST metadata blocks to all existing HTML test files.
 *
 * Reads current mapping from html-scanner-mapping.js, enriches with WCAG 2.2 level/title
 * data, and prepends comment blocks to HTML files.
 *
 * Run once: node test-sites/migrate-metadata.js
 */

const fs = require('fs');
const path = require('path');

const TEST_DIR = __dirname;

// Current mapping data
const { HTML_SCANNER_MAPPING } = require('./html-scanner-mapping');

/**
 * WCAG 2.2 criteria reference: number -> { level, title }
 */
const WCAG_CRITERIA = {
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
  '4.1.1': { level: 'A', title: 'Parsing (removed in WCAG 2.2)' },
  '4.1.2': { level: 'A', title: 'Name, Role, Value' },
  '4.1.3': { level: 'AA', title: 'Status Messages' },
};

/**
 * Determine the highest WCAG level from a list of criteria.
 */
function getHighestLevel(criteria) {
  const levels = criteria.map(c => WCAG_CRITERIA[c]?.level).filter(Boolean);
  if (levels.includes('AAA')) return 'AAA';
  if (levels.includes('AA')) return 'AA';
  return 'A';
}

/**
 * Get a combined title for criteria.
 */
function getCriteriaTitle(criteria) {
  if (criteria.length === 1) {
    return WCAG_CRITERIA[criteria[0]]?.title || 'Unknown';
  }
  return criteria.map(c => WCAG_CRITERIA[c]?.title || c).join(', ');
}

/**
 * Determine testable_by based on scanner type.
 */
function getTestableBy(scanners) {
  // LLM scanners will be prefixed with 'llm-'
  const hasLlm = scanners.some(s => s.startsWith('llm-'));
  const hasDom = scanners.some(s => [
    'keyboard-navigation', 'focus-management', 'input-modalities',
    'responsive-design', 'dynamic-spa', 'mobile-specific'
  ].includes(s));

  const methods = [];
  if (hasLlm) methods.push('llm');
  if (hasDom) methods.push('dom');
  if (methods.length === 0) methods.push('regex');
  return methods;
}

function migrate() {
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const [fileName, config] of Object.entries(HTML_SCANNER_MAPPING)) {
    const filePath = path.join(TEST_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${fileName}`);
      errors++;
      continue;
    }

    let html = fs.readFileSync(filePath, 'utf-8');

    // Skip if already has WCAG-TEST block
    if (html.includes('<!-- WCAG-TEST')) {
      console.log(`Skipping (already migrated): ${fileName}`);
      skipped++;
      continue;
    }

    const criteria = config.wcagCriteria.filter(c => c !== 'all');
    if (criteria.length === 0) {
      // 'all' criteria files — use a broad set
      criteria.push('1.1.1', '1.3.1', '2.1.1', '2.4.4', '3.1.1', '4.1.2');
    }

    const level = getHighestLevel(criteria);
    const title = getCriteriaTitle(criteria);
    const scanners = config.testType === 'bad'
      ? config.expectedScanners
      : config.excludedScanners;
    const testableBy = getTestableBy(scanners);

    const block = [
      '<!-- WCAG-TEST',
      `criterion: ${criteria.join(', ')}`,
      `level: ${level}`,
      `title: ${title}`,
      `test_type: ${config.testType}`,
      `expected_violations: ${config.testType === 'bad' ? 5 : 0}`,
      `testable_by: ${testableBy.join(', ')}`,
      `scanners: ${scanners.join(', ')}`,
      `description: ${config.description}`,
      '-->',
    ].join('\n');

    // Prepend before <!DOCTYPE or first tag
    const insertPos = html.search(/<!DOCTYPE|<html|</i);
    if (insertPos === 0) {
      html = block + '\n' + html;
    } else if (insertPos > 0) {
      html = html.slice(0, insertPos) + block + '\n' + html.slice(insertPos);
    } else {
      html = block + '\n' + html;
    }

    fs.writeFileSync(filePath, html, 'utf-8');
    migrated++;
    console.log(`Migrated: ${fileName} (${criteria.join(', ')} ${level})`);
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate, WCAG_CRITERIA };
