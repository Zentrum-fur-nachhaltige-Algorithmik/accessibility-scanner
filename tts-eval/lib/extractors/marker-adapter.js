import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BaseExtractor } from './base-extractor.js';
import config from '../../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARKER_SCRIPT = path.join(__dirname, '..', '..', 'python', 'extractors', 'marker_extract.py');
const MARKER_MODAL_SCRIPT = path.join(__dirname, '..', '..', 'python', 'modal', 'marker_modal.py');

/**
 * Marker adapter — PDF → Markdown converter.
 * Produces markdown with $...$ / $$...$$ formula delimiters.
 *
 * Runs locally if marker is installed, or via Modal GPU if configured.
 */
export class MarkerAdapter extends BaseExtractor {
  constructor(options = {}) {
    super('marker', options);
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
      execSync('python3 -c "from marker.converters.pdf import PdfConverter"', {
        encoding: 'utf-8', timeout: 10000, stdio: 'pipe',
      });
      return true;
    } catch {
      // Check CLI
      try {
        execSync('which marker_single', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
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
        `python3 "${MARKER_SCRIPT}" "${pdfPath}"`,
        {
          encoding: 'utf-8',
          timeout: config.extractors.modal?.marker?.timeout * 1000 || 600000,
          maxBuffer: 100 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
    } catch (err) {
      throw new Error(`[marker] Local extraction failed: ${err.stderr || err.message}`);
    }

    const parsed = JSON.parse(stdout);
    if (parsed.error) {
      throw new Error(`[marker] ${parsed.error}`);
    }

    return {
      pages: parsed.pages || [],
      metadata: {
        costUsd: 0,
        modelVersion: 'marker-local',
      },
    };
  }

  async _extractViaModal(pdfPath) {
    const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');

    let stdout;
    try {
      stdout = execSync(
        `python3 "${MARKER_MODAL_SCRIPT}" --base64`,
        {
          input: pdfBase64,
          encoding: 'utf-8',
          timeout: config.extractors.modal?.marker?.timeout * 1000 || 600000,
          maxBuffer: 100 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
    } catch (err) {
      throw new Error(`[marker] Modal extraction failed: ${err.stderr || err.message}`);
    }

    const parsed = JSON.parse(stdout);
    if (parsed.error) {
      throw new Error(`[marker] ${parsed.error}`);
    }

    return {
      pages: parsed.pages || [],
      metadata: {
        costUsd: 0,
        modelVersion: 'marker-modal',
      },
    };
  }
}
