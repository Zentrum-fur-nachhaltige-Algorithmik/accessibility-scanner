import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { processArxivPaper } from './mistral-ocr.js';
import { assembleHtml } from './html-assembler.js';

/**
 * Run the full pipeline for a single paper:
 * PDF → Mistral OCR → HTML with MathML
 */
export async function runPipeline(paperId) {
  const paperDir = path.join(config.paths.arxivPapers, paperId);
  const metadataPath = path.join(paperDir, 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    throw new Error(`No metadata.json found for paper ${paperId}`);
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  console.log(`\nPipeline: ${paperId} — ${metadata.title}`);

  // Step 1: OCR (uses cache if available)
  console.log('  Step 1: Mistral OCR...');
  let ocrResult;

  // Check for cached OCR result
  const ocrOutputPath = path.join(paperDir, 'ocr_output.json');
  const cachePath = path.join(config.paths.cache, `${paperId}_ocr.json`);

  if (fs.existsSync(cachePath)) {
    ocrResult = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    console.log(`    Using cached OCR result (${ocrResult.totalPages} pages)`);
  } else {
    ocrResult = await processArxivPaper(paperId);
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
