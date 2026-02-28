import fs from 'fs';
import { BaseExtractor } from './base-extractor.js';
import config from '../../config.js';

const MATHPIX_API = 'https://api.mathpix.com/v3/pdf';

/**
 * Mathpix v3 API adapter for PDF → Markdown with LaTeX formulas.
 * Uses \(...\) for inline and \[...\] for display formulas.
 * Requires MATHPIX_APP_ID and MATHPIX_APP_KEY env vars.
 */
export class MathpixAdapter extends BaseExtractor {
  constructor(options = {}) {
    super('mathpix', options);
    this.appId = config.extractors.mathpix?.appId || process.env.MATHPIX_APP_ID;
    this.appKey = config.extractors.mathpix?.appKey || process.env.MATHPIX_APP_KEY;
  }

  isAvailable() {
    return !!(this.appId && this.appKey);
  }

  async _extract(pdfPath) {
    if (!this.isAvailable()) {
      throw new Error('[mathpix] MATHPIX_APP_ID and MATHPIX_APP_KEY must be set');
    }

    // Step 1: Submit PDF for processing
    const pdfBuffer = fs.readFileSync(pdfPath);
    const formData = new FormData();
    formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'paper.pdf');
    formData.append('options_json', JSON.stringify({
      conversion_formats: { md: true },
      math_inline_delimiters: ['$', '$'],
      math_display_delimiters: ['$$', '$$'],
      enable_tables_fallback: true,
    }));

    const submitResponse = await fetch(MATHPIX_API, {
      method: 'POST',
      headers: {
        'app_id': this.appId,
        'app_key': this.appKey,
      },
      body: formData,
    });

    if (!submitResponse.ok) {
      const errorBody = await submitResponse.text();
      throw new Error(`[mathpix] API error ${submitResponse.status}: ${errorBody}`);
    }

    const submitResult = await submitResponse.json();
    const pdfId = submitResult.pdf_id;
    if (!pdfId) {
      throw new Error(`[mathpix] No pdf_id in response: ${JSON.stringify(submitResult)}`);
    }

    // Step 2: Poll for completion
    const markdown = await this._pollForResult(pdfId);

    // Step 3: Parse pages — Mathpix returns a single markdown document
    // Split on page markers if present, otherwise treat as single page
    const pages = this._splitPages(markdown);

    return {
      pages,
      metadata: {
        costUsd: this._estimateCost(pages.length),
        modelVersion: 'mathpix-v3',
        pdfId,
      },
    };
  }

  async _pollForResult(pdfId, maxAttempts = 60, intervalMs = 5000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const statusResponse = await fetch(`${MATHPIX_API}/${pdfId}`, {
        headers: {
          'app_id': this.appId,
          'app_key': this.appKey,
        },
      });

      if (!statusResponse.ok) {
        throw new Error(`[mathpix] Status check error ${statusResponse.status}`);
      }

      const status = await statusResponse.json();

      if (status.status === 'completed') {
        // Fetch the markdown output
        const mdResponse = await fetch(`${MATHPIX_API}/${pdfId}.md`, {
          headers: {
            'app_id': this.appId,
            'app_key': this.appKey,
          },
        });

        if (!mdResponse.ok) {
          throw new Error(`[mathpix] Failed to fetch markdown: ${mdResponse.status}`);
        }

        return await mdResponse.text();
      }

      if (status.status === 'error') {
        throw new Error(`[mathpix] Processing failed: ${status.error || 'unknown error'}`);
      }

      // Still processing — wait
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`[mathpix] Timed out after ${maxAttempts * intervalMs / 1000}s waiting for PDF processing`);
  }

  _splitPages(markdown) {
    // Mathpix uses \newpage or --- as page separators
    const pageMarker = /\\newpage|---\n/;
    const parts = markdown.split(pageMarker);

    return parts.map((content, i) => ({
      pageIndex: i,
      markdown: this._normalizeDelimiters(content.trim()),
    })).filter(p => p.markdown.length > 0);
  }

  _normalizeDelimiters(markdown) {
    // Mathpix may use \(...\) / \[...\] — normalize to $...$ / $$...$$
    let result = markdown;
    result = result.replace(/\\\((.+?)\\\)/g, '$$$1$$');
    result = result.replace(/\\\[(.+?)\\\]/gs, '$$$$$$$1$$$$$$');
    return result;
  }

  _estimateCost(pages) {
    return pages * 0.01; // ~$0.01 per page
  }
}
