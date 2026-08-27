import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createAllScanners } from '../../src/core/scanner-registry';

const SCANNERS_DIR = path.resolve(__dirname, '../../src/scanners');
const SUPPORT = new Set(['llm/base.js', 'llm/page-context.js', 'llm/analyze-compat.js']);

function scannerFiles() {
  const out = [];
  for (const entry of fs.readdirSync(SCANNERS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) out.push(entry.name);
    if (entry.isDirectory()) {
      for (const f of fs.readdirSync(path.join(SCANNERS_DIR, entry.name))) {
        if (f.endsWith('.js')) out.push(`${entry.name}/${f}`);
      }
    }
  }
  return out.filter((f) => !SUPPORT.has(f));
}

describe('scanner registry', () => {
  const scanners = createAllScanners({ llmClient: {} });
  const ids = scanners.map((s) => s.id);

  it('registers every scanner file exactly once', () => {
    const expected = scannerFiles()
      .map((f) => f.replace(/\.js$/, '').replace('/', '-'))
      .sort();
    expect([...ids].sort()).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names every scanner after its file', () => {
    for (const s of scanners) {
      const file = s.id.startsWith('llm-') ? `llm/${s.id.slice(4)}.js` : `${s.id}.js`;
      expect(fs.existsSync(path.join(SCANNERS_DIR, file)), `${s.id} -> ${file}`).toBe(true);
    }
  });

  it('declares WCAG criteria on every scanner that reports its own findings', () => {
    for (const s of scanners) {
      if (s.id === 'axe-core' || s.id === 'llm-incomplete-reviewer') continue;
      expect(s.wcagCriteria.length, s.id).toBeGreaterThan(0);
    }
  });
});
