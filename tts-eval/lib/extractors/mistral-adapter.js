import fs from 'fs';
import path from 'path';
import config from '../../config.js';
import { BaseExtractor } from './base-extractor.js';
import { processPdf } from '../mistral-ocr.js';

/**
 * Adapter wrapping the existing Mistral OCR module.
 * Delegates to lib/mistral-ocr.js for actual API calls + caching.
 */
export class MistralAdapter extends BaseExtractor {
  constructor(options = {}) {
    super('mistral', options);
  }

  isAvailable() {
    return !!config.mistral.apiKey;
  }

  async _extract(pdfPath) {
    // Derive a paperId from the path for caching compatibility
    const paperId = this.options.paperId || path.basename(path.dirname(pdfPath));

    // Delegate to existing mistral-ocr.js (handles its own caching at ${paperId}_ocr.json)
    const ocrResult = await processPdf(paperId, pdfPath);

    // Normalize to common format
    return {
      pages: (ocrResult.pages || []).map((page, i) => ({
        pageIndex: page.pageIndex ?? i,
        markdown: page.markdown || '',
      })),
      metadata: {
        costUsd: this._estimateCost(ocrResult),
        modelVersion: ocrResult.model || config.mistral.model,
        usageInfo: ocrResult.usageInfo || {},
      },
    };
  }

  /**
   * Extract using arXiv URL (avoids base64 upload for large PDFs).
   * @param {string} paperId - arXiv paper ID
   * @returns {Promise<Object>}
   */
  async extractFromArxiv(paperId) {
    const { processArxivPaper } = await import('../mistral-ocr.js');
    const ocrResult = await processArxivPaper(paperId);

    return {
      pages: (ocrResult.pages || []).map((page, i) => ({
        pageIndex: page.pageIndex ?? i,
        markdown: page.markdown || '',
      })),
      metadata: {
        extractor: this.name,
        latencyMs: ocrResult.latencyMs,
        totalPages: ocrResult.totalPages,
        costUsd: this._estimateCost(ocrResult),
        modelVersion: ocrResult.model || config.mistral.model,
        processedAt: ocrResult.processedAt,
        usageInfo: ocrResult.usageInfo || {},
      },
    };
  }

  _estimateCost(ocrResult) {
    // Mistral OCR: ~$0.01 per page (approximate)
    const pages = ocrResult.totalPages || ocrResult.pages?.length || 0;
    return pages * 0.01;
  }

  /**
   * Override cache methods — Mistral has its own cache at ${paperId}_ocr.json.
   * We check both the adapter cache key and the legacy cache key.
   */
  getCached(paperId) {
    // Check adapter-style cache first
    const adapterCached = super.getCached(paperId);
    if (adapterCached) return adapterCached;

    // Check legacy Mistral cache (${paperId}_ocr.json)
    const legacyPath = path.join(config.paths.cache, `${paperId}_ocr.json`);
    if (fs.existsSync(legacyPath)) {
      const ocrResult = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
      // Normalize to adapter format
      return {
        pages: (ocrResult.pages || []).map((page, i) => ({
          pageIndex: page.pageIndex ?? i,
          markdown: page.markdown || '',
        })),
        metadata: {
          extractor: this.name,
          latencyMs: ocrResult.latencyMs,
          totalPages: ocrResult.totalPages,
          costUsd: this._estimateCost(ocrResult),
          modelVersion: ocrResult.model || config.mistral.model,
          processedAt: ocrResult.processedAt,
          cached: true,
        },
      };
    }

    return null;
  }
}
