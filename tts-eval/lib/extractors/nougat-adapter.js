import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BaseExtractor } from './base-extractor.js';
import config from '../../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOUGAT_SCRIPT = path.join(__dirname, '..', '..', 'python', 'extractors', 'nougat_extract.py');
const NOUGAT_MODAL_SCRIPT = path.join(__dirname, '..', '..', 'python', 'modal', 'nougat_modal.py');

/**
 * Nougat (Meta) adapter — academic document OCR.
 * Produces Mathpix-markdown with \(...\) / \[...\] formula delimiters.
 *
 * Runs locally if nougat is installed, or via Modal GPU if configured.
 */
export class NougatAdapter extends BaseExtractor {
  constructor(options = {}) {
    super('nougat', options);
    this.useModal = options.useModal || false;
  }

  isAvailable() {
    if (this.useModal) {
      return this._isModalAvailable();
    }
    return this._isLocalAvailable();
  }

  _isLocalAvailable() {
    try {
      execSync('python3 -c "import nougat"', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
      return true;
    } catch {
      // Also check if the nougat CLI is available
      try {
        execSync('which nougat', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    }
  }

  _isModalAvailable() {
    try {
      execSync('python3 -c "import modal"', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  async _extract(pdfPath) {
    if (this.useModal) {
      return this._extractViaModal(pdfPath);
    }
    return this._extractLocal(pdfPath);
  }

  _extractLocal(pdfPath) {
    let stdout;
    try {
      stdout = execSync(
        `python3 "${NOUGAT_SCRIPT}" "${pdfPath}"`,
        {
          encoding: 'utf-8',
          timeout: config.extractors.modal?.nougat?.timeout * 1000 || 600000,
          maxBuffer: 100 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
    } catch (err) {
      throw new Error(`[nougat] Local extraction failed: ${err.stderr || err.message}`);
    }

    const parsed = JSON.parse(stdout);
    if (parsed.error) {
      throw new Error(`[nougat] ${parsed.error}`);
    }

    return {
      pages: (parsed.pages || []).map(p => ({
        pageIndex: p.pageIndex,
        markdown: this._normalizeDelimiters(p.markdown),
      })),
      metadata: {
        costUsd: 0,
        modelVersion: 'nougat-base',
      },
    };
  }

  async _extractViaModal(pdfPath) {
    const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');

    let stdout;
    try {
      stdout = execSync(
        `python3 "${NOUGAT_MODAL_SCRIPT}" --base64`,
        {
          input: pdfBase64,
          encoding: 'utf-8',
          timeout: config.extractors.modal?.nougat?.timeout * 1000 || 600000,
          maxBuffer: 100 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
    } catch (err) {
      throw new Error(`[nougat] Modal extraction failed: ${err.stderr || err.message}`);
    }

    const parsed = JSON.parse(stdout);
    if (parsed.error) {
      throw new Error(`[nougat] ${parsed.error}`);
    }

    return {
      pages: (parsed.pages || []).map(p => ({
        pageIndex: p.pageIndex,
        markdown: this._normalizeDelimiters(p.markdown),
      })),
      metadata: {
        costUsd: 0,
        modelVersion: 'nougat-base-modal',
      },
    };
  }

  _normalizeDelimiters(markdown) {
    // Nougat uses \( \) for inline and \[ \] for display
    let result = markdown;
    result = result.replace(/\\\((.+?)\\\)/g, '$$$1$$');
    result = result.replace(/\\\[(.+?)\\\]/gs, '$$$$$$$1$$$$$$');
    return result;
  }
}
