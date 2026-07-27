import temml from 'temml';
import { XMLParser } from 'fast-xml-parser';
import { execSync } from 'child_process';

const xmlParser = new XMLParser({ ignoreAttributes: false });

/**
 * Convert a LaTeX string to MathML using temml.
 * Returns { mathml, error } — never fakes success.
 * On failure, mathml is null and error contains the error message.
 */
export function convertWithTemml(latex, displayMode = false) {
  try {
    const mathml = temml.renderToString(latex, {
      displayMode,
      throwOnError: true,
      annotate: false,
    });

    // Validate well-formedness
    try {
      xmlParser.parse(mathml);
    } catch (xmlErr) {
      return {
        mathml: null,
        error: `temml produced malformed XML: ${xmlErr.message}`,
        converter: 'temml',
      };
    }

    return { mathml, error: null, converter: 'temml' };
  } catch (err) {
    return {
      mathml: null,
      error: `temml error: ${err.message}`,
      converter: 'temml',
    };
  }
}

/**
 * Convert a LaTeX string to MathML using Python latex2mathml (fallback).
 * Invoked via child_process — slower but handles more LaTeX.
 */
export function convertWithLatex2mathml(latex) {
  const escaped = latex.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

  try {
    const result = execSync(
      `python3 -c "import latex2mathml.converter; print(latex2mathml.converter.convert('${escaped}'))"`,
      { encoding: 'utf-8', timeout: 10000 }
    );

    const mathml = result.trim();
    if (!mathml || !mathml.includes('<math')) {
      return {
        mathml: null,
        error: 'latex2mathml returned empty or invalid output',
        converter: 'latex2mathml',
      };
    }

    try {
      xmlParser.parse(mathml);
    } catch (xmlErr) {
      return {
        mathml: null,
        error: `latex2mathml produced malformed XML: ${xmlErr.message}`,
        converter: 'latex2mathml',
      };
    }

    return { mathml, error: null, converter: 'latex2mathml' };
  } catch (err) {
    return {
      mathml: null,
      error: `latex2mathml error: ${err.message}`,
      converter: 'latex2mathml',
    };
  }
}

/**
 * Convert LaTeX to MathML with fallback cascade.
 * Level 1: temml (fast, JS-native)
 * Level 2: latex2mathml (Python, broader coverage)
 * Level 3: Raw LaTeX as aria-label (last resort)
 *
 * Each fallback logs a dedicated warning.
 */
export function convertToMathml(latex, displayMode = false) {
  // Level 1: temml
  const temmlResult = convertWithTemml(latex, displayMode);
  if (temmlResult.mathml) {
    return { ...temmlResult, fallbackLevel: 0 };
  }
  console.warn(`WARN [temml]: Failed for formula: ${latex.substring(0, 80)}... — ${temmlResult.error}`);

  // Level 2: latex2mathml (Python)
  const fallbackResult = convertWithLatex2mathml(latex);
  if (fallbackResult.mathml) {
    console.warn(`WARN [fallback]: latex2mathml succeeded where temml failed for: ${latex.substring(0, 60)}...`);
    return { ...fallbackResult, fallbackLevel: 1 };
  }
  console.warn(`WARN [latex2mathml]: ${fallbackResult.error}`);

  // Level 3: Total failure — return raw LaTeX as fallback text
  console.warn(`WARN [total-failure]: No converter succeeded for: ${latex.substring(0, 80)}...`);
  return {
    mathml: null,
    error: `All converters failed. temml: ${temmlResult.error}. latex2mathml: ${fallbackResult.error}`,
    converter: 'none',
    fallbackLevel: 2,
    fallbackText: latex,
  };
}
