#!/usr/bin/env node

/**
 * WCAG Test Metadata Parser
 *
 * Parses <!-- WCAG-TEST --> comment blocks from HTML test files.
 * These blocks are the source of truth for test file metadata.
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse a WCAG-TEST comment block from HTML content.
 * @param {string} html - HTML file content
 * @returns {Object|null} Parsed metadata or null if no block found
 */
function parseWcagMetadata(html) {
  const match = html.match(/<!--\s*WCAG-TEST\s*\n([\s\S]*?)-->/);
  if (!match) return null;

  const block = match[1];
  const metadata = {};

  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    switch (key) {
      case 'criterion':
        metadata.criterion = value.split(',').map(c => c.trim()).filter(Boolean);
        break;
      case 'level':
        metadata.level = value;
        break;
      case 'title':
        metadata.title = value;
        break;
      case 'test_type':
        metadata.testType = value;
        break;
      case 'expected_violations':
        metadata.expectedViolations = parseInt(value, 10);
        break;
      case 'testable_by':
        metadata.testableBy = value.split(',').map(t => t.trim()).filter(Boolean);
        break;
      case 'scanners':
        metadata.scanners = value.split(',').map(s => s.trim()).filter(Boolean);
        break;
      case 'description':
        metadata.description = value;
        break;
      default:
        metadata[key] = value;
    }
  }

  // Validate required fields
  const required = ['criterion', 'level', 'title', 'testType'];
  const missing = required.filter(f => !metadata[f]);
  if (missing.length > 0) {
    throw new Error(`WCAG-TEST block missing required fields: ${missing.join(', ')}`);
  }

  return metadata;
}

/**
 * Parse metadata from an HTML file path.
 * @param {string} filePath - Absolute path to HTML file
 * @returns {Object|null} Parsed metadata with file info
 */
function parseFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const metadata = parseWcagMetadata(html);
  if (!metadata) return null;

  return {
    file: path.basename(filePath),
    path: filePath,
    ...metadata,
  };
}

/**
 * Parse all HTML files in a directory.
 * @param {string} dir - Directory to scan
 * @returns {{ parsed: Object[], unparsed: string[] }}
 */
function parseDirectory(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.html'))
    .sort();

  const parsed = [];
  const unparsed = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const meta = parseFile(filePath);
      if (meta) {
        parsed.push(meta);
      } else {
        unparsed.push(file);
      }
    } catch (err) {
      console.error(`Warning: ${file}: ${err.message}`);
      unparsed.push(file);
    }
  }

  return { parsed, unparsed };
}

/**
 * Build a WCAG-TEST comment block string from metadata.
 * @param {Object} meta - Metadata object
 * @returns {string} Comment block string
 */
function buildWcagTestBlock(meta) {
  const lines = [
    `criterion: ${Array.isArray(meta.criterion) ? meta.criterion.join(', ') : meta.criterion}`,
    `level: ${meta.level}`,
    `title: ${meta.title}`,
    `test_type: ${meta.testType || meta.test_type}`,
  ];

  if (meta.expectedViolations != null || meta.expected_violations != null) {
    lines.push(`expected_violations: ${meta.expectedViolations ?? meta.expected_violations}`);
  }
  if (meta.testableBy || meta.testable_by) {
    const val = meta.testableBy || meta.testable_by;
    lines.push(`testable_by: ${Array.isArray(val) ? val.join(', ') : val}`);
  }
  if (meta.scanners) {
    lines.push(`scanners: ${Array.isArray(meta.scanners) ? meta.scanners.join(', ') : meta.scanners}`);
  }
  if (meta.description) {
    lines.push(`description: ${meta.description}`);
  }

  return `<!-- WCAG-TEST\n${lines.join('\n')}\n-->`;
}

module.exports = {
  parseWcagMetadata,
  parseFile,
  parseDirectory,
  buildWcagTestBlock,
};

// CLI usage
if (require.main === module) {
  const dir = process.argv[2] || __dirname;
  const { parsed, unparsed } = parseDirectory(dir);

  console.log(`Parsed ${parsed.length} files with WCAG-TEST metadata`);
  if (unparsed.length > 0) {
    console.log(`${unparsed.length} files without metadata: ${unparsed.join(', ')}`);
  }

  // Group by criterion
  const byCriterion = {};
  for (const meta of parsed) {
    for (const c of meta.criterion) {
      if (!byCriterion[c]) byCriterion[c] = { bad: [], good: [] };
      byCriterion[c][meta.testType].push(meta.file);
    }
  }

  console.log('\nCoverage by criterion:');
  for (const [criterion, files] of Object.entries(byCriterion).sort()) {
    console.log(`  ${criterion}: ${files.bad.length} bad, ${files.good.length} good`);
  }
}
