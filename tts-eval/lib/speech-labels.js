/**
 * Generate aria-labels for MathML formulas.
 * Level 1: speech-rule-engine (SRE) — high quality
 * Level 2: LaTeX heuristic cleanup — basic fallback
 */

let sre = null;
let sreReady = false;

/**
 * Initialize speech-rule-engine. Must be called before generateSpeech.
 */
export async function initSRE() {
  try {
    const sreModule = await import('speech-rule-engine');
    sre = sreModule.default || sreModule;

    // SRE needs to be set up with a locale and domain
    await sre.setupEngine({
      locale: 'en',
      domain: 'mathspeak',
      style: 'default',
    });

    sreReady = true;
    console.log('speech-rule-engine initialized');
    return true;
  } catch (err) {
    console.warn(`WARN [SRE]: Failed to initialize: ${err.message}`);
    return false;
  }
}

/**
 * Generate speech text for a MathML string.
 * Returns { speech, source } where source is 'sre' or 'heuristic'.
 */
export function generateSpeech(mathml, latexFallback = '') {
  // Level 1: Try SRE
  if (sreReady && sre && mathml) {
    try {
      const speech = sre.toSpeech(mathml);
      if (speech && speech.length > 0) {
        return { speech, source: 'sre' };
      }
    } catch (err) {
      console.warn(`WARN [SRE]: Speech generation failed: ${err.message}`);
    }
  }

  // Level 2: Heuristic LaTeX-to-speech
  if (latexFallback) {
    console.warn(`WARN [speech-fallback]: Using heuristic for: ${latexFallback.substring(0, 50)}...`);
    const speech = latexToSpeechHeuristic(latexFallback);
    return { speech, source: 'heuristic' };
  }

  return { speech: '', source: 'none' };
}

/**
 * Simple heuristic to convert LaTeX to rough speech text.
 * Not perfect, but provides basic accessibility for screen readers.
 */
function latexToSpeechHeuristic(latex) {
  let s = latex;

  // Common math operations
  s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 over $2');
  s = s.replace(/\\sqrt\{([^}]+)\}/g, 'square root of $1');
  s = s.replace(/\\sqrt\[(\d+)\]\{([^}]+)\}/g, '$1th root of $2');

  // Greek letters
  const greekMap = {
    '\\alpha': 'alpha', '\\beta': 'beta', '\\gamma': 'gamma', '\\delta': 'delta',
    '\\epsilon': 'epsilon', '\\zeta': 'zeta', '\\eta': 'eta', '\\theta': 'theta',
    '\\iota': 'iota', '\\kappa': 'kappa', '\\lambda': 'lambda', '\\mu': 'mu',
    '\\nu': 'nu', '\\xi': 'xi', '\\pi': 'pi', '\\rho': 'rho',
    '\\sigma': 'sigma', '\\tau': 'tau', '\\phi': 'phi', '\\chi': 'chi',
    '\\psi': 'psi', '\\omega': 'omega',
    '\\Gamma': 'Gamma', '\\Delta': 'Delta', '\\Theta': 'Theta',
    '\\Lambda': 'Lambda', '\\Sigma': 'Sigma', '\\Phi': 'Phi',
    '\\Psi': 'Psi', '\\Omega': 'Omega',
  };
  for (const [cmd, name] of Object.entries(greekMap)) {
    s = s.replace(new RegExp(cmd.replace(/\\/g, '\\\\') + '(?![a-zA-Z])', 'g'), ` ${name} `);
  }

  // Operators
  s = s.replace(/\\sum/g, 'sum');
  s = s.replace(/\\prod/g, 'product');
  s = s.replace(/\\int/g, 'integral');
  s = s.replace(/\\infty/g, 'infinity');
  s = s.replace(/\\partial/g, 'partial');
  s = s.replace(/\\nabla/g, 'nabla');
  s = s.replace(/\\cdot/g, 'dot');
  s = s.replace(/\\times/g, 'times');
  s = s.replace(/\\leq/g, 'less than or equal to');
  s = s.replace(/\\geq/g, 'greater than or equal to');
  s = s.replace(/\\neq/g, 'not equal to');
  s = s.replace(/\\approx/g, 'approximately');
  s = s.replace(/\\equiv/g, 'is equivalent to');
  s = s.replace(/\\in/g, 'in');
  s = s.replace(/\\to/g, 'to');
  s = s.replace(/\\rightarrow/g, 'right arrow');
  s = s.replace(/\\leftarrow/g, 'left arrow');
  s = s.replace(/\\forall/g, 'for all');
  s = s.replace(/\\exists/g, 'there exists');

  // Superscript and subscript
  s = s.replace(/\^{([^}]+)}/g, ' to the power of $1');
  s = s.replace(/\^(\w)/g, ' to the power of $1');
  s = s.replace(/_{([^}]+)}/g, ' sub $1');
  s = s.replace(/_(\w)/g, ' sub $1');

  // Remove remaining LaTeX commands
  s = s.replace(/\\[a-zA-Z]+/g, '');
  // Remove braces
  s = s.replace(/[{}]/g, '');
  // Clean up whitespace
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/**
 * Add aria-labels to MathML elements in an HTML string.
 */
export function addAriaLabelsToHtml(html) {
  // Match <math ...>...</math> and add aria-label
  return html.replace(/<math([^>]*)>([\s\S]*?)<\/math>/g, (match, attrs, content) => {
    // Extract the LaTeX from annotation if present, otherwise use content
    const latex = content.match(/<annotation encoding="application\/x-tex">([^<]+)<\/annotation>/)?.[1] || '';

    const { speech } = generateSpeech(match, latex);
    if (speech) {
      // Add aria-label if not already present
      if (!attrs.includes('aria-label')) {
        return `<math${attrs} aria-label="${escapeAttr(speech)}">${content}</math>`;
      }
    }
    return match;
  });
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
