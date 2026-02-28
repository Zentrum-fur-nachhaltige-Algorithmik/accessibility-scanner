import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arxivPapersDir = path.join(__dirname, '..', '..', 'data', 'arxiv_papers');
const cacheDir = path.join(__dirname, '..', '..', 'data', 'cache');

/**
 * Dynamically scan data/arxiv_papers/ for paper IDs.
 */
export function getPaperIds() {
  if (!fs.existsSync(arxivPapersDir)) return [];
  return fs.readdirSync(arxivPapersDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
}

/**
 * Load ground truth formulas for a paper.
 */
export function loadPaperGt(paperId) {
  const gtPath = path.join(arxivPapersDir, paperId, 'formulas_gt.json');
  if (!fs.existsSync(gtPath)) {
    throw new Error(`Ground truth not found: ${gtPath}`);
  }
  return JSON.parse(fs.readFileSync(gtPath, 'utf-8'));
}

/**
 * Load OCR output for a paper (prefers paper-level, falls back to cache).
 */
export function loadPaperOcr(paperId) {
  const ocrPath = path.join(arxivPapersDir, paperId, 'ocr_output.json');
  if (fs.existsSync(ocrPath)) {
    return JSON.parse(fs.readFileSync(ocrPath, 'utf-8'));
  }
  const cachePath = path.join(cacheDir, `${paperId}_ocr.json`);
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  }
  throw new Error(`OCR output not found for paper ${paperId}`);
}

/**
 * Load cached OCR result (raw pages format for html-assembler).
 */
export function loadPaperCachedOcr(paperId) {
  const cachePath = path.join(cacheDir, `${paperId}_ocr.json`);
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  }
  // Fall back to paper-level OCR output
  return loadPaperOcr(paperId);
}

/**
 * Load metadata for a paper.
 */
export function loadPaperMetadata(paperId) {
  const metaPath = path.join(arxivPapersDir, paperId, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Metadata not found: ${metaPath}`);
  }
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

/**
 * Load all papers: returns array of { id, gt, ocr, metadata }.
 */
export function loadAllPapers() {
  const ids = getPaperIds();
  return ids.map(id => ({
    id,
    gt: loadPaperGt(id),
    ocr: loadPaperOcr(id),
    cachedOcr: loadPaperCachedOcr(id),
    metadata: loadPaperMetadata(id),
  }));
}
