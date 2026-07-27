import fs from 'fs';
import path from 'path';

/**
 * Extract all formulas from a .tex file with their surrounding context.
 * Returns classified formulas with tier assignments.
 */
export function extractFormulas(texContent, filePath = '') {
  // Strip comments (% to end of line, unless escaped with \%)
  const stripped = texContent.replace(/(?<!\\)%.*$/gm, '');

  const formulas = [];

  // Extract display formulas first (so we can skip their positions for inline)
  const displayRanges = [];

  // Pattern 1: $$...$$
  extractByRegex(stripped, /\$\$([\s\S]*?)\$\$/g, 'display', formulas, displayRanges);

  // Pattern 2: \[...\]
  extractByRegex(stripped, /\\\[([\s\S]*?)\\\]/g, 'display', formulas, displayRanges);

  // Pattern 3: equation environments (including starred)
  const envNames = ['equation', 'align', 'gather', 'multline', 'eqnarray', 'flalign', 'alignat'];
  for (const env of envNames) {
    const pattern = new RegExp(
      `\\\\begin\\{${env}\\*?\\}([\\s\\S]*?)\\\\end\\{${env}\\*?\\}`,
      'g'
    );
    extractByRegex(stripped, pattern, 'display', formulas, displayRanges);
  }

  // Pattern 4: split environment (usually inside equation, but capture if standalone)
  extractByRegex(
    stripped,
    /\\begin\{split\}([\s\S]*?)\\end\{split\}/g,
    'display',
    formulas,
    displayRanges
  );

  // Extract inline formulas: $...$ (not $$)
  // We need to avoid matching inside display ranges
  const inlinePattern = /(?<!\$)\$(?!\$)((?:[^$\\]|\\.)*?)\$(?!\$)/g;
  let match;
  while ((match = inlinePattern.exec(stripped)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    // Skip if this position falls inside a display range
    if (displayRanges.some(([s, e]) => start >= s && start < e)) continue;

    const latex = match[1].trim();
    if (!latex || latex.length < 1) continue;

    // Skip formulas that are clearly not math (e.g., just whitespace or numbers used as text)
    if (/^[\d\s.,]+$/.test(latex)) continue;

    const context = getContext(stripped, start, end);
    const lineNumber = stripped.substring(0, start).split('\n').length;

    formulas.push({
      type: 'inline',
      latex,
      position: start,
      lineNumber,
      context,
      source: filePath,
    });
  }

  // Sort by position in document
  formulas.sort((a, b) => a.position - b.position);

  // Assign indices and tiers
  formulas.forEach((f, i) => {
    f.index = i;
    f.tier = classifyTier(f.latex, f.type);
  });

  return formulas;
}

function extractByRegex(text, pattern, type, formulas, displayRanges) {
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const latex = match[1].trim();

    if (!latex) continue;

    displayRanges.push([start, end]);

    const context = getContext(text, start, end);
    const lineNumber = text.substring(0, start).split('\n').length;

    formulas.push({
      type,
      latex,
      position: start,
      lineNumber,
      context,
      source: '',
    });
  }
}

function getContext(text, start, end, contextChars = 60) {
  const before = text.substring(Math.max(0, start - contextChars), start).replace(/\s+/g, ' ').trim();
  const after = text.substring(end, Math.min(text.length, end + contextChars)).replace(/\s+/g, ' ').trim();
  return `...${before} [FORMULA] ${after}...`;
}

/**
 * Classify a formula into complexity tiers.
 * Tier 1: Simple — single variables, basic operations
 * Tier 2: Medium — fractions, sums, integrals
 * Tier 3: Complex — matrices, cases, deeply nested structures
 * Tier 4: Difficult — multi-line environments, custom macros, rare packages
 */
export function classifyTier(latex, type) {
  // Tier 4: multi-line environments, custom operators, tikz
  if (/\\begin\{(align|gather|multline|split|alignat|eqnarray)/.test(latex)) return 4;
  if (/\\DeclareMathOperator|\\tikzcd|\\xymatrix/.test(latex)) return 4;
  if (/\\newcommand|\\def\s/.test(latex)) return 4;

  // Tier 3: matrices, cases, deep nesting
  if (/\\begin\{(pmatrix|bmatrix|vmatrix|Vmatrix|matrix|smallmatrix|cases)\}/.test(latex)) return 3;
  if (/\\begin\{array\}/.test(latex)) return 3;
  // Nested fractions/sums (frac inside frac, sum inside sum, etc.)
  if ((latex.match(/\\frac/g) || []).length >= 2) return 3;
  if ((latex.match(/\\(sum|prod|int|oint)/g) || []).length >= 2) return 3;
  if (/\\(partial|nabla)/.test(latex) && /\\frac/.test(latex)) return 3;

  // Tier 2: fractions, sums, integrals, subscript/superscript nesting
  if (/\\frac\{/.test(latex)) return 2;
  if (/\\(sum|prod|int|oint|iint|iiint|bigcup|bigcap)/.test(latex)) return 2;
  if (/\{[^}]*\{/.test(latex) && latex.length > 30) return 2; // nested braces + long

  // Tier 1: simple
  return 1;
}

/**
 * Extract custom macros from the preamble of a .tex file.
 * Returns a map of macro name -> expansion.
 */
export function extractCustomMacros(texContent) {
  const macros = {};

  // \newcommand{\name}[args]{definition}
  const newcmdPattern = /\\(?:newcommand|renewcommand)\{?\\(\w+)\}?(?:\[(\d+)\])?\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
  let match;
  while ((match = newcmdPattern.exec(texContent)) !== null) {
    macros[`\\${match[1]}`] = {
      expansion: match[3],
      argCount: parseInt(match[2] || '0'),
    };
  }

  // \def\name{definition} (simplified — doesn't handle argument patterns)
  const defPattern = /\\def\\(\w+)\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
  while ((match = defPattern.exec(texContent)) !== null) {
    macros[`\\${match[1]}`] = {
      expansion: match[2],
      argCount: 0,
    };
  }

  // \DeclareMathOperator{\name}{text}
  const declPattern = /\\DeclareMathOperator\*?\{\\(\w+)\}\{([^}]+)\}/g;
  while ((match = declPattern.exec(texContent)) !== null) {
    macros[`\\${match[1]}`] = {
      expansion: `\\operatorname{${match[2]}}`,
      argCount: 0,
    };
  }

  return macros;
}

/**
 * Attempt to expand custom macros in a formula string.
 * Only handles zero-argument macros (safe expansion).
 */
export function expandMacros(latex, macros) {
  let result = latex;

  for (const [name, def] of Object.entries(macros)) {
    if (def.argCount === 0) {
      // Simple substitution for zero-arg macros
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped + '(?![a-zA-Z])', 'g'), def.expansion);
    }
    // Skip macros with arguments — too complex for simple regex expansion
  }

  return result;
}

/**
 * Process a complete paper: extract formulas from all .tex files,
 * merge, classify, and expand macros.
 */
export function processTexFiles(texFiles, mainFile) {
  // Read main file for preamble/macros
  const mainContent = fs.readFileSync(mainFile, 'utf-8');
  const macros = extractCustomMacros(mainContent);

  const allFormulas = [];

  for (const file of texFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const formulas = extractFormulas(content, path.basename(file));
    allFormulas.push(...formulas);
  }

  // Expand macros in all formulas
  for (const formula of allFormulas) {
    formula.latexOriginal = formula.latex;
    formula.latex = expandMacros(formula.latex, macros);
  }

  // Re-sort by source file and position
  allFormulas.sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.position - b.position;
  });

  // Re-index
  allFormulas.forEach((f, i) => {
    f.index = i;
  });

  // Count tiers
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const f of allFormulas) {
    tierCounts[f.tier]++;
  }

  return {
    totalFormulas: allFormulas.length,
    formulas: allFormulas,
    customMacros: macros,
    tierCounts,
  };
}

/**
 * Clean a LaTeX formula string: remove labels, tags, and normalize whitespace.
 */
export function cleanFormula(latex) {
  let cleaned = latex;
  // Remove \label{...}
  cleaned = cleaned.replace(/\\label\{[^}]*\}/g, '');
  // Remove \tag{...}
  cleaned = cleaned.replace(/\\tag\{[^}]*\}/g, '');
  // Remove \nonumber, \notag
  cleaned = cleaned.replace(/\\(nonumber|notag)/g, '');
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}
