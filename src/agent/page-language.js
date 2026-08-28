/**
 * The language a page is written in.
 * Tasks have to be stated in that language: a description in English on a German
 * page is unsolvable for anyone who matches words against what is spoken
 * ("get in touch" never matches "Kontakt"), and it hands the LLM agents a task
 * in a language the page does not use.
 * `lang` on the root element first; only when it is missing or useless does a
 * small stopword count over the visible text decide between the languages the
 * generic templates are translated into.
 */

'use strict';

/** Language of a page whose own markup and text say nothing. */
const DEFAULT_LANGUAGE = 'en';

/** Names used to tell the model which language to write in. */
const LANGUAGE_NAMES = {
  en: 'English',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
  nl: 'Dutch',
  pt: 'Portuguese',
  pl: 'Polish',
  cs: 'Czech',
  da: 'Danish',
  sv: 'Swedish',
  no: 'Norwegian',
  fi: 'Finnish',
  tr: 'Turkish',
};

/**
 * Frequent function words that separate the two languages the fallback has to
 * tell apart. Only ever used when the page carries no usable `lang`.
 */
const STOPWORD_MARKERS = {
  de: [
    'der',
    'die',
    'das',
    'und',
    'oder',
    'nicht',
    'mit',
    'für',
    'auf',
    'von',
    'sie',
    'wir',
    'ist',
    'sind',
    'eine',
    'einen',
    'bei',
    'auch',
    'über',
    'unsere',
  ],
  en: [
    'the',
    'and',
    'or',
    'not',
    'with',
    'for',
    'from',
    'you',
    'your',
    'our',
    'we',
    'is',
    'are',
    'this',
    'that',
    'about',
    'more',
    'have',
    'will',
    'can',
  ],
};

/** Primary subtag of a BCP 47 tag, lowercased (`de-AT` -> `de`); null if unusable. */
function normaliseLanguage(tag) {
  const primary = String(tag == null ? '' : tag)
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

/** English name of a language code, or the code itself when it is not in the table. */
function languageName(code) {
  const key = normaliseLanguage(code);
  return (key && LANGUAGE_NAMES[key]) || key || LANGUAGE_NAMES[DEFAULT_LANGUAGE];
}

/**
 * Decide the language of a text by counting the function words of each
 * candidate language. Returns null when nothing scores.
 */
function detectLanguageFromText(text) {
  const words = String(text == null ? '' : text)
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  if (words.length < 20) return null;
  const counts = new Map(words.map((w) => [w, 0]));
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  let best = null;
  for (const [code, markers] of Object.entries(STOPWORD_MARKERS)) {
    const score = markers.reduce((a, m) => a + (counts.get(m) || 0), 0);
    if (!best || score > best.score) best = { code, score };
  }
  return best && best.score > 0 ? best.code : null;
}

/**
 * The language of an already-navigated page: `<html lang>` (or `<body lang>`,
 * or a `content-language` meta) first, then the visible text, then the default.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<string>} a primary language subtag, e.g. `de`
 */
async function detectPageLanguage(page) {
  let info = null;
  try {
    info = await page.evaluate(() => {
      const meta = document.querySelector('meta[http-equiv="content-language" i]');
      return {
        lang:
          (document.documentElement && document.documentElement.getAttribute('lang')) ||
          (document.body && document.body.getAttribute('lang')) ||
          (meta && meta.getAttribute('content')) ||
          '',
        text: (document.body ? document.body.innerText || '' : '').slice(0, 4000),
      };
    });
  } catch (_) {
    return DEFAULT_LANGUAGE;
  }
  return (
    normaliseLanguage(info && info.lang) ||
    detectLanguageFromText(info && info.text) ||
    DEFAULT_LANGUAGE
  );
}

module.exports = {
  DEFAULT_LANGUAGE,
  LANGUAGE_NAMES,
  normaliseLanguage,
  languageName,
  detectLanguageFromText,
  detectPageLanguage,
};
