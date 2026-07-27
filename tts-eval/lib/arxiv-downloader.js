import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import config from '../config.js';

const ARXIV_API = 'https://export.arxiv.org/api/query';
const ARXIV_PDF = 'https://arxiv.org/pdf/';
const ARXIV_SOURCE = 'https://arxiv.org/e-print/';

/**
 * Query arXiv API for papers in a given category.
 * Returns parsed entries with id, title, summary, categories.
 */
export async function queryArxiv(category, maxResults = 50) {
  const query = `cat:${category}`;
  const url = `${ARXIV_API}?search_query=${encodeURIComponent(query)}&start=0&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;

  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url);
    if (response.status === 429) {
      const wait = (attempt + 1) * 5000;
      console.warn(`  arXiv rate limited, waiting ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    break;
  }
  if (!response.ok) {
    throw new Error(`arXiv API returned ${response.status}: ${response.statusText}`);
  }

  const xml = await response.text();
  return parseArxivXml(xml);
}

/**
 * Parse arXiv Atom XML response into structured entries.
 */
function parseArxivXml(xml) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];

    const id = extractTag(entry, 'id');
    const title = extractTag(entry, 'title')?.replace(/\s+/g, ' ').trim();
    const summary = extractTag(entry, 'summary')?.replace(/\s+/g, ' ').trim();

    // Extract arXiv ID from URL (e.g., http://arxiv.org/abs/2301.12345v1 -> 2301.12345)
    const arxivId = id?.match(/abs\/(\d+\.\d+)(?:v\d+)?/)?.[1];
    if (!arxivId) continue;

    // Extract categories
    const categories = [];
    const catRegex = /<category[^>]*term="([^"]+)"/g;
    let catMatch;
    while ((catMatch = catRegex.exec(entry)) !== null) {
      categories.push(catMatch[1]);
    }

    // Extract PDF link
    const pdfLink = entry.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/)?.[1];

    entries.push({ arxivId, title, summary, categories, pdfLink });
  }

  return entries;
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1] : null;
}

/**
 * Download a PDF from arXiv.
 */
export async function downloadPdf(arxivId, destDir) {
  const pdfPath = path.join(destDir, 'paper.pdf');
  if (fs.existsSync(pdfPath)) {
    console.log(`  PDF already cached: ${arxivId}`);
    return pdfPath;
  }

  const url = `${ARXIV_PDF}${arxivId}`;
  console.log(`  Downloading PDF: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download PDF for ${arxivId}: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(pdfPath, buffer);
  console.log(`  PDF saved: ${pdfPath} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
  return pdfPath;
}

/**
 * Download and extract LaTeX source from arXiv.
 */
export async function downloadSource(arxivId, destDir) {
  const sourceDir = path.join(destDir, 'source');

  // Check if we already have .tex files
  if (fs.existsSync(sourceDir)) {
    const texFiles = findTexFiles(sourceDir);
    if (texFiles.length > 0) {
      console.log(`  Source already cached: ${arxivId} (${texFiles.length} .tex files)`);
      return texFiles;
    }
  }

  const url = `${ARXIV_SOURCE}${arxivId}`;
  console.log(`  Downloading source: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download source for ${arxivId}: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const tarPath = path.join(destDir, 'source.tar.gz');
  fs.writeFileSync(tarPath, buffer);

  // Extract tarball
  fs.mkdirSync(sourceDir, { recursive: true });

  try {
    // arXiv source can be tar.gz, gz (single file), or plain tex
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/x-eprint-tar') || contentType.includes('application/gzip')) {
      // Try tar extraction first
      try {
        execSync(`tar xzf "${tarPath}" -C "${sourceDir}" 2>/dev/null`, { stdio: 'pipe' });
      } catch {
        // Might be a single gzipped file
        try {
          execSync(`gunzip -c "${tarPath}" > "${path.join(sourceDir, 'main.tex')}" 2>/dev/null`, { stdio: 'pipe' });
        } catch {
          // Last resort: it might be a plain tex file
          fs.copyFileSync(tarPath, path.join(sourceDir, 'main.tex'));
        }
      }
    } else {
      // Plain tex file
      fs.copyFileSync(tarPath, path.join(sourceDir, 'main.tex'));
    }
  } finally {
    // Clean up tarball
    if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);
  }

  const texFiles = findTexFiles(sourceDir);
  console.log(`  Source extracted: ${texFiles.length} .tex files`);

  if (texFiles.length === 0) {
    throw new Error(`No .tex files found in source for ${arxivId}`);
  }

  return texFiles;
}

/**
 * Find all .tex files recursively in a directory.
 */
function findTexFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTexFiles(fullPath));
    } else if (entry.name.endsWith('.tex')) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Count formulas in a .tex file to check if it meets density criteria.
 * Quick heuristic — not a full parse.
 */
export function countFormulas(texContent) {
  // Strip comments
  const stripped = texContent.replace(/%.*$/gm, '');

  // Count display formulas (including starred variants like equation*, align*, etc.)
  const displayPatterns = [
    /\$\$[\s\S]*?\$\$/g,
    /\\\[[\s\S]*?\\\]/g,
    /\\begin\{equation\*?\}/g,
    /\\begin\{align\*?\}/g,
    /\\begin\{gather\*?\}/g,
    /\\begin\{multline\*?\}/g,
    /\\begin\{eqnarray\*?\}/g,
    /\\begin\{flalign\*?\}/g,
    /\\begin\{split\}/g,
  ];

  let displayCount = 0;
  for (const pattern of displayPatterns) {
    const matches = stripped.match(pattern);
    displayCount += matches ? matches.length : 0;
  }

  // Count inline formulas (rough: count $ pairs that aren't $$)
  // Replace $$ first to avoid double-counting
  const noDisplay = stripped.replace(/\$\$[\s\S]*?\$\$/g, '');
  const inlineMatches = noDisplay.match(/(?<!\$)\$(?!\$)[\s\S]*?(?<!\$)\$(?!\$)/g);
  const inlineCount = inlineMatches ? inlineMatches.length : 0;

  return { displayCount, inlineCount, total: displayCount + inlineCount };
}

/**
 * Find the main .tex file from a list of .tex files.
 * The main file typically contains \documentclass.
 */
export function findMainTexFile(texFiles) {
  for (const file of texFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes('\\documentclass')) {
      return file;
    }
  }
  // Fallback: return the largest .tex file
  return texFiles.sort((a, b) => {
    return fs.statSync(b).size - fs.statSync(a).size;
  })[0];
}

/**
 * Count formulas across all .tex files in a list.
 */
export function countFormulasAllFiles(texFiles) {
  let displayCount = 0;
  let inlineCount = 0;

  for (const file of texFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const counts = countFormulas(content);
    displayCount += counts.displayCount;
    inlineCount += counts.inlineCount;
  }

  return { displayCount, inlineCount, total: displayCount + inlineCount };
}

/**
 * Download and validate a single paper. Returns paper metadata or null if it doesn't meet criteria.
 */
export async function downloadAndValidatePaper(arxivId, title) {
  const destDir = path.join(config.paths.arxivPapers, arxivId);
  fs.mkdirSync(destDir, { recursive: true });

  console.log(`\nProcessing ${arxivId}: ${title}`);

  try {
    // Download source first (cheaper than PDF, and we need it to validate formula density)
    const texFiles = await downloadSource(arxivId, destDir);
    const mainFile = findMainTexFile(texFiles);
    // Count formulas across ALL .tex files (not just main)
    const counts = countFormulasAllFiles(texFiles);

    console.log(`  Formulas: ${counts.displayCount} display, ${counts.inlineCount} inline`);

    if (counts.displayCount < config.arxiv.minDisplayFormulas || counts.inlineCount < config.arxiv.minInlineFormulas) {
      console.log(`  SKIP: Below formula density threshold`);
      return null;
    }

    // Download PDF
    await downloadPdf(arxivId, destDir);

    // Save metadata
    const metadata = {
      arxivId,
      title,
      mainTexFile: mainFile,
      texFiles,
      formulaCounts: counts,
      downloadedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(destDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

    console.log(`  OK: Paper accepted`);
    return metadata;
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    return null;
  }
}

/**
 * Search and download papers meeting criteria.
 */
export async function discoverAndDownloadPapers() {
  const accepted = [];

  for (const category of config.arxiv.categories) {
    if (accepted.length >= config.arxiv.targetPaperCount) break;

    console.log(`\nSearching arXiv category: ${category}`);
    const entries = await queryArxiv(category, 30);
    console.log(`  Found ${entries.length} recent papers`);

    for (const entry of entries) {
      if (accepted.length >= config.arxiv.targetPaperCount) break;

      // Rate limit: be nice to arXiv
      await new Promise(r => setTimeout(r, 3000));

      const result = await downloadAndValidatePaper(entry.arxivId, entry.title);
      if (result) {
        accepted.push(result);
      }
    }
  }

  console.log(`\n=== Downloaded ${accepted.length} papers ===`);
  return accepted;
}
