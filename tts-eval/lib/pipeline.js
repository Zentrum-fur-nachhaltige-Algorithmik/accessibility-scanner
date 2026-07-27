import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { processArxivPaper } from './mistral-ocr.js';
import { assembleHtml } from './html-assembler.js';
import { getExtractor } from './extractors/registry.js';

/**
 * Run the full pipeline for a single paper:
 * PDF → Extractor (OCR/text) → HTML with MathML
 *
 * @param {string} paperId - arXiv paper ID
 * @param {Object} options
 * @param {string} options.extractor - Extractor name (default: config.extractors.default)
 */
export async function runPipeline(paperId, { extractor: extractorName } = {}) {
  const resolvedExtractor = extractorName || config.extractors.default;
  const paperDir = path.join(config.paths.arxivPapers, paperId);
  const metadataPath = path.join(paperDir, 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    throw new Error(`No metadata.json found for paper ${paperId}`);
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  console.log(`\nPipeline: ${paperId} — ${metadata.title} [extractor: ${resolvedExtractor}]`);

  // Step 1: Extract text from PDF
  console.log(`  Step 1: ${resolvedExtractor} extraction...`);
  let ocrResult;

  if (resolvedExtractor === 'mistral') {
    // Legacy path: use existing Mistral OCR with its own caching
    const cachePath = path.join(config.paths.cache, `${paperId}_ocr.json`);
    if (fs.existsSync(cachePath)) {
      ocrResult = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      console.log(`    Using cached OCR result (${ocrResult.totalPages} pages)`);
    } else {
      ocrResult = await processArxivPaper(paperId);
    }
  } else {
    // Multi-extractor path: use adapter with cache
    const adapter = await getExtractor(resolvedExtractor, { paperId });
    if (!adapter.isAvailable()) {
      throw new Error(`Extractor "${resolvedExtractor}" is not available. Check dependencies/API keys.`);
    }
    const pdfPath = path.join(paperDir, 'paper.pdf');
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF not found: ${pdfPath}`);
    }
    const result = await adapter.extractWithCache(paperId, pdfPath);
    // Normalize to legacy ocrResult format for downstream compatibility
    ocrResult = {
      arxivId: paperId,
      pages: result.pages,
      totalPages: result.metadata.totalPages,
      latencyMs: result.metadata.latencyMs,
      model: result.metadata.modelVersion || resolvedExtractor,
      processedAt: result.metadata.processedAt,
    };
  }

  // Step 2: Assemble HTML with MathML conversion
  console.log('  Step 2: HTML assembly with MathML...');
  const { html, formulaStats } = assembleHtml(ocrResult, metadata.title);

  // Step 3: Save output
  const outputDir = config.paths.outputHtml;
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${paperId}.html`);
  fs.writeFileSync(outputPath, html);

  console.log(`  Output: ${outputPath}`);
  console.log(`  Formulas: ${formulaStats.total} total, ${formulaStats.converted} converted, ${formulaStats.failed} failed`);

  return {
    paperId,
    title: metadata.title,
    outputPath,
    formulaStats,
    ocrPages: ocrResult.totalPages,
  };
}
