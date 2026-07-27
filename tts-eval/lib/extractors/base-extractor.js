import fs from 'fs';
import path from 'path';
import config from '../../config.js';

/**
 * Base class for all PDF extractors.
 * All adapters must implement extract(pdfPath) and isAvailable().
 * Output is normalized to { pages: [{ pageIndex, markdown }], metadata }.
 */
export class BaseExtractor {
  constructor(name, options = {}) {
    if (!name || typeof name !== 'string') {
      throw new Error('Extractor name is required');
    }
    this.name = name;
    this.options = options;
  }

  /**
   * Extract text/formulas from a PDF file.
   * @param {string} pdfPath - Absolute path to PDF file
   * @returns {Promise<{pages: Array<{pageIndex: number, markdown: string}>, metadata: Object}>}
   */
  async extract(pdfPath) {
    if (!pdfPath) {
      throw new Error(`[${this.name}] pdfPath is required`);
    }
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`[${this.name}] PDF not found: ${pdfPath}`);
    }

    const startTime = Date.now();
    const result = await this._extract(pdfPath);
    const latencyMs = Date.now() - startTime;

    // Validate output structure
    this._validateResult(result);

    // Attach standard metadata
    result.metadata = {
      ...result.metadata,
      extractor: this.name,
      latencyMs,
      totalPages: result.pages.length,
      processedAt: new Date().toISOString(),
    };

    return result;
  }

  /**
   * Internal extraction method — subclasses must override this.
   * @param {string} pdfPath
   * @returns {Promise<{pages: Array<{pageIndex: number, markdown: string}>, metadata: Object}>}
   */
  async _extract(pdfPath) {
    throw new Error(`[${this.name}] _extract() not implemented`);
  }

  /**
   * Check if this extractor is available (dependencies installed, API keys set, etc.).
   * @returns {boolean}
   */
  isAvailable() {
    throw new Error(`[${this.name}] isAvailable() not implemented`);
  }

  /**
   * Get cache key for a paper+extractor combination.
   * @param {string} paperId
   * @returns {string}
   */
  getCacheKey(paperId) {
    return `${paperId}_${this.name}`;
  }

  /**
   * Get cached result if available.
   * @param {string} paperId
   * @returns {Object|null}
   */
  getCached(paperId) {
    const cachePath = path.join(config.paths.cache, `${this.getCacheKey(paperId)}.json`);
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }
    return null;
  }

  /**
   * Save result to cache.
   * @param {string} paperId
   * @param {Object} result
   */
  saveCache(paperId, result) {
    const cacheDir = config.paths.cache;
    fs.mkdirSync(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, `${this.getCacheKey(paperId)}.json`);
    fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
  }

  /**
   * Extract with caching — checks cache first, extracts if missing.
   * @param {string} paperId
   * @param {string} pdfPath
   * @returns {Promise<Object>}
   */
  async extractWithCache(paperId, pdfPath) {
    const cached = this.getCached(paperId);
    if (cached) {
      console.log(`  [${this.name}] Cache hit: ${paperId}`);
      cached.metadata = { ...cached.metadata, cached: true };
      return cached;
    }

    const result = await this.extract(pdfPath);
    result.metadata.cached = false;
    this.saveCache(paperId, result);
    console.log(`  [${this.name}] Cached result for ${paperId}`);
    return result;
  }

  /**
   * Validate that the extraction result has the required structure.
   */
  _validateResult(result) {
    if (!result || typeof result !== 'object') {
      throw new Error(`[${this.name}] extract() must return an object`);
    }
    if (!Array.isArray(result.pages)) {
      throw new Error(`[${this.name}] extract() must return { pages: [...] }`);
    }
    for (let i = 0; i < result.pages.length; i++) {
      const page = result.pages[i];
      if (typeof page.pageIndex !== 'number') {
        throw new Error(`[${this.name}] page[${i}].pageIndex must be a number`);
      }
      if (typeof page.markdown !== 'string') {
        throw new Error(`[${this.name}] page[${i}].markdown must be a string`);
      }
    }
  }
}
