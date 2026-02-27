/**
 * Extract LaTeX formulas from Mistral OCR markdown output.
 * Handles: $...$ (inline), $$...$$ (display), and code blocks.
 */
export function extractFormulasFromMarkdown(markdown) {
  const formulas = [];

  // First, mask code blocks so we don't extract formulas from them
  const masked = maskCodeBlocks(markdown);

  // Extract display formulas ($$...$$) first
  const displayRanges = [];
  const displayPattern = /\$\$([\s\S]*?)\$\$/g;
  let match;

  while ((match = displayPattern.exec(masked)) !== null) {
    const latex = match[1].trim();
    if (!latex) continue;

    displayRanges.push([match.index, match.index + match[0].length]);

    formulas.push({
      type: 'display',
      latex,
      position: match.index,
      raw: match[0],
    });
  }

  // Extract inline formulas ($...$) — skip positions inside display formulas
  const inlinePattern = /(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+?)\$(?!\$)/g;

  while ((match = inlinePattern.exec(masked)) !== null) {
    const start = match.index;

    // Skip if inside a display formula range
    if (displayRanges.some(([s, e]) => start >= s && start < e)) continue;

    const latex = match[1].trim();
    if (!latex) continue;

    // Skip dollar amounts and other non-math uses
    if (/^\d+[.,]?\d*$/.test(latex)) continue;

    formulas.push({
      type: 'inline',
      latex,
      position: start,
      raw: match[0],
    });
  }

  // Sort by position
  formulas.sort((a, b) => a.position - b.position);

  // Add indices and context
  formulas.forEach((f, i) => {
    f.index = i;
    f.context = getContext(markdown, f.position, f.position + f.raw.length);
  });

  return formulas;
}

/**
 * Mask code blocks to prevent formula extraction from code.
 * Replaces fenced code blocks and inline code with spaces.
 */
function maskCodeBlocks(markdown) {
  let result = markdown;

  // Fenced code blocks: ```...```
  result = result.replace(/```[\s\S]*?```/g, (match) => ' '.repeat(match.length));

  // Inline code: `...`
  result = result.replace(/`[^`]+`/g, (match) => ' '.repeat(match.length));

  return result;
}

function getContext(text, start, end, chars = 50) {
  const before = text.substring(Math.max(0, start - chars), start).replace(/\s+/g, ' ').trim();
  const after = text.substring(end, Math.min(text.length, end + chars)).replace(/\s+/g, ' ').trim();
  return `...${before} [FORMULA] ${after}...`;
}

/**
 * Extract formulas from all pages of an OCR result.
 */
export function extractFromOcrResult(ocrResult) {
  const allFormulas = [];

  for (const page of ocrResult.pages) {
    const formulas = extractFormulasFromMarkdown(page.markdown);

    for (const f of formulas) {
      allFormulas.push({
        ...f,
        pageIndex: page.pageIndex,
      });
    }
  }

  // Re-index globally
  allFormulas.forEach((f, i) => {
    f.index = i;
  });

  return {
    formulas: allFormulas,
    totalFormulas: allFormulas.length,
    byType: {
      inline: allFormulas.filter(f => f.type === 'inline').length,
      display: allFormulas.filter(f => f.type === 'display').length,
    },
  };
}
