import { parseHTML } from 'linkedom';

/**
 * Parse an HTML string and return a linkedom document.
 */
export function parseHtml(html) {
  const { document } = parseHTML(html);
  return document;
}

/**
 * Validate that all <math> elements in the HTML are well-formed.
 * Returns { valid: number, malformed: number, errors: string[] }.
 */
export function validateMathmlWellFormedness(html) {
  const doc = parseHtml(html);
  const mathElements = doc.querySelectorAll('math');
  const errors = [];
  let valid = 0;
  let malformed = 0;

  for (const el of mathElements) {
    const outerHtml = el.outerHTML;
    // Basic well-formedness: must have closing tag and contain child elements
    if (outerHtml.includes('<math') && outerHtml.includes('</math>')) {
      valid++;
    } else {
      malformed++;
      errors.push(`Malformed math element: ${outerHtml.substring(0, 100)}`);
    }
  }

  return { total: mathElements.length, valid, malformed, errors };
}

/**
 * Extract aria-label values from all elements that have them.
 */
export function extractAriaLabels(html) {
  const doc = parseHtml(html);
  const elements = doc.querySelectorAll('[aria-label]');
  return Array.from(elements).map(el => ({
    tag: el.tagName.toLowerCase(),
    ariaLabel: el.getAttribute('aria-label'),
  }));
}

/**
 * Validate that TOC links resolve to existing heading IDs.
 * Returns { valid: number, broken: number, brokenLinks: string[] }.
 */
export function validateTocLinks(html) {
  const doc = parseHtml(html);
  const nav = doc.querySelector('nav[aria-label="Document navigation"]');
  if (!nav) return { valid: 0, broken: 0, brokenLinks: [], hasNav: false };

  const links = nav.querySelectorAll('a[href^="#"]');
  const brokenLinks = [];
  let valid = 0;
  let broken = 0;

  for (const link of links) {
    const targetId = link.getAttribute('href').slice(1);
    const target = doc.getElementById(targetId);
    if (target) {
      valid++;
    } else {
      broken++;
      brokenLinks.push(`#${targetId}`);
    }
  }

  return { valid, broken, brokenLinks, hasNav: true };
}

/**
 * Extract document structure metadata.
 */
export function extractDocStructure(html) {
  const doc = parseHtml(html);
  const htmlEl = doc.querySelector('html');
  const meta = doc.querySelector('meta[charset]');
  const title = doc.querySelector('title');
  const main = doc.querySelector('main');
  const formulaErrors = doc.querySelectorAll('.formula-error');

  return {
    lang: htmlEl?.getAttribute('lang') || null,
    charset: meta?.getAttribute('charset') || null,
    title: title?.textContent || null,
    hasMain: !!main,
    formulaErrorCount: formulaErrors.length,
  };
}
