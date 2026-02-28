import { execSync } from 'child_process';

/**
 * Normalize a LaTeX string for comparison.
 * Strips whitespace, normalizes delimiters, removes labels/tags.
 */
export function normalizeLatex(latex) {
  let s = latex;
  // Remove \label{...}, \tag{...}, \nonumber, \notag
  s = s.replace(/\\label\{[^}]*\}/g, '');
  s = s.replace(/\\tag\{[^}]*\}/g, '');
  s = s.replace(/\\(nonumber|notag)/g, '');
  // Normalize \left( -> (, \right) -> ), etc.
  s = s.replace(/\\left\s*/g, '');
  s = s.replace(/\\right\s*/g, '');
  // Normalize \dfrac -> \frac, \tfrac -> \frac
  s = s.replace(/\\[dt]frac/g, '\\frac');
  // Strip all whitespace
  s = s.replace(/\s+/g, '');
  // Lowercase (math is case-sensitive, but for matching purposes)
  // Actually, don't lowercase — math variables are case-sensitive
  return s;
}

/**
 * Compute Levenshtein distance between two strings.
 * Simple O(n*m) implementation — sufficient for formula lengths.
 */
function levenshtein(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;

  const dp = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[n][m];
}

/**
 * Compute normalized similarity (0-1) between two LaTeX strings.
 */
export function similarity(a, b) {
  const na = normalizeLatex(a);
  const nb = normalizeLatex(b);
  if (na === nb) return 1.0;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshtein(na, nb) / maxLen;
}

/**
 * Strategy A: Sequential Position Matching
 * Aligns OCR formulas with ground truth formulas by sequential position.
 * Uses a ±tolerance window when the direct position doesn't match well.
 */
export function matchSequential(gtFormulas, ocrFormulas, tolerance = 2, minSimilarity = 0.3) {
  const matched = [];
  const usedGt = new Set();
  const usedOcr = new Set();

  // First pass: match by position with tolerance window
  for (let ocrIdx = 0; ocrIdx < ocrFormulas.length; ocrIdx++) {
    const ocrLatex = ocrFormulas[ocrIdx].latex;
    let bestGtIdx = -1;
    let bestSim = minSimilarity;

    // Look at corresponding GT position ± tolerance
    const center = Math.round((ocrIdx / ocrFormulas.length) * gtFormulas.length);
    const start = Math.max(0, center - tolerance);
    const end = Math.min(gtFormulas.length, center + tolerance + 1);

    for (let gtIdx = start; gtIdx < end; gtIdx++) {
      if (usedGt.has(gtIdx)) continue;
      const sim = similarity(gtFormulas[gtIdx].latex, ocrLatex);
      if (sim > bestSim) {
        bestSim = sim;
        bestGtIdx = gtIdx;
      }
    }

    if (bestGtIdx >= 0) {
      matched.push({
        gtIndex: bestGtIdx,
        ocrIndex: ocrIdx,
        similarity: bestSim,
        gtLatex: gtFormulas[bestGtIdx].latex,
        ocrLatex,
      });
      usedGt.add(bestGtIdx);
      usedOcr.add(ocrIdx);
    }
  }

  return {
    strategy: 'sequential',
    matched,
    unmatchedGt: gtFormulas
      .map((f, i) => ({ index: i, latex: f.latex }))
      .filter((_, i) => !usedGt.has(i)),
    unmatchedOcr: ocrFormulas
      .map((f, i) => ({ index: i, latex: f.latex }))
      .filter((_, i) => !usedOcr.has(i)),
    stats: {
      totalMatched: matched.length,
      avgSimilarity: matched.length > 0
        ? matched.reduce((s, m) => s + m.similarity, 0) / matched.length
        : 0,
    },
  };
}

/**
 * Strategy B: Hungarian Algorithm Matching
 * Computes optimal bipartite matching using normalized Levenshtein similarity.
 * Uses Python scipy for the assignment (more robust than JS implementations).
 */
export function matchHungarian(gtFormulas, ocrFormulas, minSimilarity = 0.3) {
  const n = gtFormulas.length;
  const m = ocrFormulas.length;

  if (n === 0 || m === 0) {
    return {
      strategy: 'hungarian',
      matched: [],
      unmatchedGt: gtFormulas.map((f, i) => ({ index: i, latex: f.latex })),
      unmatchedOcr: ocrFormulas.map((f, i) => ({ index: i, latex: f.latex })),
      stats: { totalMatched: 0, avgSimilarity: 0 },
    };
  }

  // For large formula sets, subsample to avoid O(n^2*m) explosion
  // Hungarian is O(n^3) — manageable up to ~1000
  const maxSize = 800;
  let gtSubset = gtFormulas;
  let ocrSubset = ocrFormulas;
  let gtMap = gtFormulas.map((_, i) => i);
  let ocrMap = ocrFormulas.map((_, i) => i);

  if (n > maxSize || m > maxSize) {
    // Fall back to greedy matching for very large sets
    console.warn(`WARN: Formula sets too large for Hungarian (${n}x${m}), using greedy matching`);
    return matchGreedy(gtFormulas, ocrFormulas, minSimilarity);
  }

  // Compute cost matrix (1 - similarity, since Hungarian minimizes)
  const costMatrix = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < m; j++) {
      const sim = similarity(gtSubset[i].latex, ocrSubset[j].latex);
      row.push(1 - sim);
    }
    costMatrix.push(row);
  }

  // Call Python scipy for optimal assignment
  const costJson = JSON.stringify(costMatrix);
  let assignment;

  try {
    const pyScript = `
import json, sys, numpy as np
from scipy.optimize import linear_sum_assignment
cost = np.array(json.loads(sys.stdin.read()))
# Pad to square matrix if needed
rows, cols = cost.shape
if rows != cols:
    size = max(rows, cols)
    padded = np.ones((size, size)) * 2.0  # high cost for padding
    padded[:rows, :cols] = cost
    row_ind, col_ind = linear_sum_assignment(padded)
    # Filter out padded assignments
    valid = [(int(r), int(c)) for r, c in zip(row_ind, col_ind) if r < rows and c < cols]
else:
    row_ind, col_ind = linear_sum_assignment(cost)
    valid = [(int(r), int(c)) for r, c in zip(row_ind, col_ind)]
print(json.dumps(valid))
`;
    const result = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, {
      input: costJson,
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
    });
    assignment = JSON.parse(result.trim());
  } catch (err) {
    console.warn(`WARN: Hungarian algorithm failed: ${err.message}, falling back to greedy`);
    return matchGreedy(gtFormulas, ocrFormulas, minSimilarity);
  }

  // Build matched pairs, filtering by minimum similarity
  const matched = [];
  const usedGt = new Set();
  const usedOcr = new Set();

  for (const [gtIdx, ocrIdx] of assignment) {
    const sim = 1 - costMatrix[gtIdx][ocrIdx];
    if (sim >= minSimilarity) {
      matched.push({
        gtIndex: gtMap[gtIdx],
        ocrIndex: ocrMap[ocrIdx],
        similarity: sim,
        gtLatex: gtSubset[gtIdx].latex,
        ocrLatex: ocrSubset[ocrIdx].latex,
      });
      usedGt.add(gtIdx);
      usedOcr.add(ocrIdx);
    }
  }

  return {
    strategy: 'hungarian',
    matched,
    unmatchedGt: gtFormulas
      .map((f, i) => ({ index: i, latex: f.latex }))
      .filter((_, i) => !usedGt.has(i)),
    unmatchedOcr: ocrFormulas
      .map((f, i) => ({ index: i, latex: f.latex }))
      .filter((_, i) => !usedOcr.has(i)),
    stats: {
      totalMatched: matched.length,
      avgSimilarity: matched.length > 0
        ? matched.reduce((s, m) => s + m.similarity, 0) / matched.length
        : 0,
    },
  };
}

/**
 * Greedy matching fallback for large formula sets.
 * Matches each OCR formula to the most similar unmatched GT formula.
 */
function matchGreedy(gtFormulas, ocrFormulas, minSimilarity = 0.3) {
  const matched = [];
  const usedGt = new Set();

  for (let ocrIdx = 0; ocrIdx < ocrFormulas.length; ocrIdx++) {
    let bestGtIdx = -1;
    let bestSim = minSimilarity;

    for (let gtIdx = 0; gtIdx < gtFormulas.length; gtIdx++) {
      if (usedGt.has(gtIdx)) continue;
      const sim = similarity(gtFormulas[gtIdx].latex, ocrFormulas[ocrIdx].latex);
      if (sim > bestSim) {
        bestSim = sim;
        bestGtIdx = gtIdx;
      }
    }

    if (bestGtIdx >= 0) {
      matched.push({
        gtIndex: bestGtIdx,
        ocrIndex: ocrIdx,
        similarity: bestSim,
        gtLatex: gtFormulas[bestGtIdx].latex,
        ocrLatex: ocrFormulas[ocrIdx].latex,
      });
      usedGt.add(bestGtIdx);
    }
  }

  const usedOcr = new Set(matched.map(m => m.ocrIndex));

  return {
    strategy: 'greedy',
    matched,
    unmatchedGt: gtFormulas
      .map((f, i) => ({ index: i, latex: f.latex }))
      .filter((_, i) => !usedGt.has(i)),
    unmatchedOcr: ocrFormulas
      .map((f, i) => ({ index: i, latex: f.latex }))
      .filter((_, i) => !usedOcr.has(i)),
    stats: {
      totalMatched: matched.length,
      avgSimilarity: matched.length > 0
        ? matched.reduce((s, m) => s + m.similarity, 0) / matched.length
        : 0,
    },
  };
}
