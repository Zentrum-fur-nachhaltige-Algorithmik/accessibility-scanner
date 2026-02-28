import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
  // Mistral OCR API
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY,
    model: 'mistral-ocr-latest',
    endpoint: 'https://api.mistral.ai/v1/ocr',
  },

  // Paths
  paths: {
    root: __dirname,
    data: path.join(__dirname, 'data'),
    arxivPapers: path.join(__dirname, 'data', 'arxiv_papers'),
    cache: path.join(__dirname, 'data', 'cache'),
    outputHtml: path.join(__dirname, 'output', 'html'),
    outputReports: path.join(__dirname, 'output', 'reports'),
    fixtures: path.join(__dirname, 'fixtures'),
  },

  // Converter settings
  converter: {
    primary: 'temml',
    fallback: 'latex2mathml',
  },

  // Evaluation thresholds (from design doc)
  thresholds: {
    pixelDiffCorrect: 0.01,
    pixelDiffMinor: 0.05,
    formulaRecallTarget: 0.90,
    conversionSuccessTarget: 0.80,
    fallbackCoverageTarget: 0.95,
    totalLossMax: 0.02,
  },

  // arXiv paper selection criteria
  arxiv: {
    categories: ['math.RA', 'math.AP', 'stat.ML'],
    minDisplayFormulas: 15,
    minInlineFormulas: 20,
    minPages: 15,
    targetPaperCount: 5,
  },

  // Formula complexity tier thresholds
  tiers: {
    tier1MaxChars: 30,
    tier2MaxChars: 100,
    complexPatterns: ['\\begin{pmatrix}', '\\begin{bmatrix}', '\\begin{cases}', '\\begin{vmatrix}'],
    difficultPatterns: ['\\begin{align}', '\\begin{gather}', '\\begin{multline}', '\\DeclareMathOperator', '\\tikzcd'],
  },

  // Multi-extractor configuration
  extractors: {
    available: ['mistral', 'pymupdf', 'pymupdf-hybrid', 'nougat', 'marker', 'mathpix'],
    default: 'mistral',
    modal: {
      nougat: { gpu: 'T4', timeout: 600 },
      marker: { gpu: 'T4', timeout: 600 },
    },
    mathpix: {
      appId: process.env.MATHPIX_APP_ID,
      appKey: process.env.MATHPIX_APP_KEY,
    },
  },

  // Corpus expansion configuration
  corpus: {
    densityTiers: {
      low: { min: 10, max: 50 },
      medium: { min: 100, max: 300 },
      high: { min: 500 },
    },
    targetPerTier: 3,
  },
};

// Validate required env vars at import time
if (!config.mistral.apiKey) {
  console.warn('WARN: MISTRAL_API_KEY not set. OCR steps will fail.');
}

export default config;
