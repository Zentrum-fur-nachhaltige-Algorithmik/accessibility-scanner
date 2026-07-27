import fs from 'fs';
import path from 'path';
import config from '../config.js';

const OCR_ENDPOINT = 'https://api.mistral.ai/v1/ocr';

/**
 * Process a PDF through Mistral OCR API.
 * Supports both URL-based and file-based PDFs.
 * Caches responses to data/cache/ for reproducibility and cost savings.
 *
 * @param {string} arxivId - Paper identifier for caching
 * @param {string} pdfPathOrUrl - Local path or URL to the PDF
 * @returns {Object} OCR result with pages, formulas, and cost info
 */
export async function processPdf(arxivId, pdfPathOrUrl) {
  if (!config.mistral.apiKey) {
    throw new Error('MISTRAL_API_KEY not set. Cannot call OCR API.');
  }

  // Check cache first
  const cacheDir = config.paths.cache;
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `${arxivId}_ocr.json`);

  if (fs.existsSync(cachePath)) {
    console.log(`  OCR cache hit: ${arxivId}`);
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  }

  // Determine if it's a URL or local file
  const isUrl = pdfPathOrUrl.startsWith('http');
  let document;

  if (isUrl) {
    document = {
      type: 'document_url',
      document_url: pdfPathOrUrl,
    };
  } else {
    // Read PDF and encode as base64
    const pdfBuffer = fs.readFileSync(pdfPathOrUrl);
    const base64 = pdfBuffer.toString('base64');
    document = {
      type: 'document_url',
      document_url: `data:application/pdf;base64,${base64}`,
    };
  }

  console.log(`  Calling Mistral OCR API for ${arxivId}...`);
  const startTime = Date.now();

  const response = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.mistral.apiKey}`,
    },
    body: JSON.stringify({
      model: config.mistral.model,
      document,
    }),
  });

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Mistral OCR API error ${response.status}: ${errorBody}`);
  }

  const ocrResult = await response.json();

  // Extract usage info
  const usageInfo = ocrResult.usage_info || {};
  const pages = ocrResult.pages || [];

  console.log(`  OCR completed: ${pages.length} pages in ${(latencyMs / 1000).toFixed(1)}s`);

  // Build structured result
  const result = {
    arxivId,
    pages: pages.map((page, i) => ({
      pageIndex: page.index ?? i,
      markdown: page.markdown || '',
      dimensions: page.dimensions || null,
    })),
    totalPages: pages.length,
    latencyMs,
    usageInfo,
    model: ocrResult.model || config.mistral.model,
    processedAt: new Date().toISOString(),
    cached: false,
  };

  // Cache the result
  fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
  console.log(`  Cached OCR result: ${cachePath}`);

  return result;
}

/**
 * Process a PDF via arXiv URL (avoids uploading large files).
 */
export async function processArxivPaper(arxivId) {
  const pdfUrl = `https://arxiv.org/pdf/${arxivId}`;
  return processPdf(arxivId, pdfUrl);
}
