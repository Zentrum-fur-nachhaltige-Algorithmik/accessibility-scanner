import { convertToMathml } from './mathml-converter.js';

/**
 * Convert Mistral OCR markdown to accessible HTML with MathML.
 * Handles: headings, paragraphs, formulas (inline/display), lists.
 */
export function assembleHtml(ocrResult, title = 'Untitled Document') {
  const pages = ocrResult.pages || [];
  const bodyParts = [];
  const headings = [];
  let formulaStats = { total: 0, converted: 0, fallbackLevel1: 0, failed: 0 };

  for (const page of pages) {
    const html = convertMarkdownToHtml(page.markdown, formulaStats, headings);
    bodyParts.push(`<!-- Page ${page.pageIndex + 1} -->\n${html}`);
  }

  // Build TOC from headings
  const tocHtml = buildToc(headings);

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      font-family: 'Cambria', 'Georgia', serif;
      max-width: 50em;
      margin: 2em auto;
      padding: 0 1em;
      line-height: 1.7;
      color: #1a1a1a;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      line-height: 1.3;
    }
    math[display="block"] {
      display: block;
      margin: 1em 0;
      overflow-x: auto;
    }
    .formula-error {
      display: inline-block;
      border: 2px solid #c00;
      padding: 0.3em 0.5em;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.9em;
      background: #fff0f0;
      border-radius: 3px;
    }
    nav[aria-label="Document navigation"] {
      background: #f5f5f5;
      padding: 1em 1.5em;
      border-radius: 5px;
      margin-bottom: 2em;
    }
    nav ul { list-style: none; padding-left: 0; }
    nav ul ul { padding-left: 1.5em; }
    nav a { text-decoration: none; color: #0055aa; }
    nav a:hover { text-decoration: underline; }
    .page-break {
      border-top: 1px solid #ddd;
      margin: 2em 0;
      padding-top: 1em;
    }
    table {
      border-collapse: collapse;
      margin: 1em 0;
    }
    td, th {
      border: 1px solid #ccc;
      padding: 0.4em 0.8em;
    }
    .stats {
      font-size: 0.85em;
      color: #666;
      border-top: 1px solid #ddd;
      padding-top: 1em;
      margin-top: 3em;
    }
  </style>
  <script>
    // MathJax for client-side rendering as progressive enhancement
    window.MathJax = {
      startup: { typeset: true },
      options: { enableMenu: false }
    };
  </script>
  <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/mml-chtml.js" async></script>
</head>
<body>
  ${tocHtml}
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${bodyParts.join('\n<div class="page-break"></div>\n')}
  </main>
  <footer class="stats" aria-label="Conversion statistics">
    <p>Formulas: ${formulaStats.total} total, ${formulaStats.converted} converted to MathML,
    ${formulaStats.fallbackLevel1} via fallback, ${formulaStats.failed} failed.</p>
  </footer>
</body>
</html>`;

  return { html: fullHtml, formulaStats };
}

/**
 * Convert markdown text to HTML, replacing formulas with MathML.
 */
function convertMarkdownToHtml(markdown, stats, headings) {
  if (!markdown) return '';

  const lines = markdown.split('\n');
  const htmlParts = [];
  let inParagraph = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      if (inParagraph) {
        htmlParts.push('</p>');
        inParagraph = false;
      }
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inParagraph) {
        htmlParts.push('</p>');
        inParagraph = false;
      }
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const id = `heading-${headings.length}`;
      headings.push({ level, text: stripFormulas(text), id });
      const processedText = processInlineFormulas(text, stats);
      htmlParts.push(`<h${level} id="${id}">${processedText}</h${level}>`);
      continue;
    }

    // Display formula (standalone $$...$$)
    if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
      if (inParagraph) {
        htmlParts.push('</p>');
        inParagraph = false;
      }
      const latex = trimmed.slice(2, -2).trim();
      htmlParts.push(renderFormula(latex, true, stats));
      continue;
    }

    // Multi-line display formula
    if (trimmed === '$$') {
      if (inParagraph) {
        htmlParts.push('</p>');
        inParagraph = false;
      }
      // Collect until closing $$
      const formulaLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '$$') {
        formulaLines.push(lines[i]);
        i++;
      }
      const latex = formulaLines.join('\n').trim();
      if (latex) {
        htmlParts.push(renderFormula(latex, true, stats));
      }
      continue;
    }

    // List items
    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      if (inParagraph) {
        htmlParts.push('</p>');
        inParagraph = false;
      }
      const content = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
      htmlParts.push(`<li>${processInlineFormulas(content, stats)}</li>`);
      continue;
    }

    // Regular text
    if (!inParagraph) {
      htmlParts.push('<p>');
      inParagraph = true;
    }
    htmlParts.push(processInlineFormulas(trimmed, stats) + ' ');
  }

  if (inParagraph) htmlParts.push('</p>');

  return htmlParts.join('\n');
}

/**
 * Process inline formulas ($...$) in a text string.
 */
function processInlineFormulas(text, stats) {
  return text.replace(/(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+?)\$(?!\$)/g, (match, latex) => {
    return renderFormula(latex.trim(), false, stats);
  });
}

/**
 * Render a single formula to MathML or error fallback.
 */
function renderFormula(latex, displayMode, stats) {
  stats.total++;

  const result = convertToMathml(latex, displayMode);

  if (result.mathml) {
    stats.converted++;
    if (result.fallbackLevel === 1) stats.fallbackLevel1++;
    return result.mathml;
  }

  // Total failure: render as monospace with error styling
  stats.failed++;
  const ariaLabel = `Formula could not be converted: ${latex}`;
  return `<span class="formula-error" role="math" aria-label="${escapeHtml(ariaLabel)}">${escapeHtml(latex)}</span>`;
}

/**
 * Build table of contents from collected headings.
 */
function buildToc(headings) {
  if (headings.length === 0) return '';

  const items = headings.map(h =>
    `${'  '.repeat(h.level - 1)}<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`
  ).join('\n');

  return `<nav aria-label="Document navigation">
  <h2>Table of Contents</h2>
  <ul>
${items}
  </ul>
</nav>`;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripFormulas(text) {
  return text.replace(/\$[^$]+\$/g, '[formula]').trim();
}
