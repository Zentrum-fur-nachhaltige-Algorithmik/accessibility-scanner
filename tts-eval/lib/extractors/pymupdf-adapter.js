import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { BaseExtractor } from './base-extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYMUPDF_SCRIPT = path.join(__dirname, '..', '..', 'python', 'extractors', 'pymupdf_extract.py');

/**
 * PyMuPDF-based PDF extractor.
 * - Plain mode: direct text extraction (no formula awareness)
 * - Hybrid mode: font-based math detection wrapping math spans in $...$
 */
export class PyMuPDFAdapter extends BaseExtractor {
  constructor(options = {}) {
    const name = options.hybrid ? 'pymupdf-hybrid' : 'pymupdf';
    super(name, options);
    this.hybrid = !!options.hybrid;
  }

  isAvailable() {
    try {
      execSync('python3 -c "import pymupdf"', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
      return true;
    } catch {
      try {
        execSync('python3 -c "import fitz"', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    }
  }

  async _extract(pdfPath) {
    const args = [PYMUPDF_SCRIPT, pdfPath];
    if (this.hybrid) {
      args.push('--hybrid');
    }

    let stdout;
    try {
      stdout = execSync(`python3 ${args.map(a => `"${a}"`).join(' ')}`, {
        encoding: 'utf-8',
        timeout: 120000,
        maxBuffer: 100 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const stderr = err.stderr || '';
      throw new Error(`[${this.name}] PyMuPDF extraction failed: ${stderr || err.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      throw new Error(`[${this.name}] Failed to parse PyMuPDF output: ${err.message}`);
    }

    if (parsed.error) {
      throw new Error(`[${this.name}] ${parsed.error}`);
    }

    return {
      pages: parsed.pages || [],
      metadata: {
        costUsd: 0, // Free extractor
        modelVersion: this.hybrid ? 'pymupdf-hybrid' : 'pymupdf-plain',
      },
    };
  }
}
