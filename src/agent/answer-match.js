/**
 * Answer equivalence for information tasks.
 *
 * An information task ships two things: the `evidence` (the verbatim page text
 * the sighted generator picked, used as the read target of `nOpt` and as the
 * primary quick match) and the `answer` (the ground truth in plain text, e.g.
 * "+43 1 2039333"). Literal evidence matching alone is far too strict: the same
 * phone number is spoken "Telefon: +43 1 203 93 33" on the imprint page while
 * the evidence was picked as "TEL: 01 2039333" on the home page. A user who
 * heard the second one HAS the answer.
 *
 * This module answers one question deterministically, without an LLM:
 * "do the phrases this user heard carry the answer?" - per `answerType`, with
 * normalisers that know how the same fact is written differently.
 */

'use strict';

/** The kinds of answer an information task can ask for. */
const ANSWER_TYPES = ['phone', 'email', 'address', 'hours', 'text'];

/** How many consecutive spoken phrases may be joined into one window. */
const MAX_ANSWER_PHRASE_SPAN = 3;

/** How many of the most recent phrases the LLM judge is shown. */
const JUDGE_PHRASE_WINDOW = 40;

/**
 * Structural phrases the virtual screen reader speaks as container boundaries
 * ("paragraph", "end of paragraph", "document"). They are punctuation, not
 * content: they must never break a window that would otherwise carry the answer
 * ("Donaustadtstraße 1" / "end of paragraph" / "paragraph" / "1220 Wien"), and
 * they must not count as fragments in the fragmentation check either.
 */
const CONTAINER_ROLES =
  'document|paragraph|list|listitem|list item|table|row|cell|columnheader|rowheader|' +
  'figure|blockquote|region|banner|navigation|main|contentinfo|complementary|form|' +
  'search|article|section|group|separator|generic|heading';

const STRUCTURAL_RE = new RegExp(`^(end of\\b.*|(${CONTAINER_ROLES}))$`, 'i');

/** True for a VSR boundary phrase (see STRUCTURAL_RE). */
function isStructuralPhrase(phrase) {
  return STRUCTURAL_RE.test(String(phrase == null ? '' : phrase).trim());
}

/** Whitespace-normalised, lowercased. */
function squash(s) {
  return String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Lowercase + German transliteration + diacritics removed, so "Donaustadtstraße"
 * and "Donaustadtstrasse" are the same token.
 */
function fold(s) {
  return squash(s)
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Every digit, in order. */
const digitsOf = (s) => String(s == null ? '' : s).replace(/\D+/g, '');

/* ------------------------------------------------------------------ */
/* Normalisers per answer type                                         */
/* ------------------------------------------------------------------ */

/** Minimum number of trailing digits that must line up for a phone match. */
const PHONE_TAIL_DIGITS = 7;

/**
 * Phone numbers: only the digits matter, and the country code does not.
 * "+43 1 203 93 33", "0043 1 2039333" and "01 2039333" are the same number, so
 * the comparison runs over the last `PHONE_TAIL_DIGITS` digits (the whole
 * number when it is shorter).
 */
function phoneMatches(answer, text) {
  const want = digitsOf(answer);
  if (want.length < 4) return false;
  const got = digitsOf(text);
  if (!got) return false;
  const tail = want.length > PHONE_TAIL_DIGITS ? want.slice(-PHONE_TAIL_DIGITS) : want;
  return got.includes(tail);
}

/** The e-mail addresses inside a string, lowercased. */
function emailsIn(s) {
  return (
    String(s == null ? '' : s).match(/[^\s<>()[\]:;,"]+@[^\s<>()[\]:;,"]+\.[a-z]{2,}/gi) || []
  )
    .map((e) => e.toLowerCase().replace(/[.,;:]+$/, ''))
    .filter(Boolean);
}

/** E-mail: exact, lowercased, whitespace-insensitive (VSR may space out the @). */
function emailMatches(answer, text) {
  const want = emailsIn(answer);
  const hay = squash(text).replace(/\s+/g, '');
  if (want.length === 0) {
    const bare = squash(answer).replace(/\s+/g, '');
    return bare.includes('@') && hay.includes(bare);
  }
  return want.every((e) => hay.includes(e));
}

/** Street-type abbreviations folded onto one spelling. */
function normaliseAddress(s) {
  return (
    fold(s)
      // "Hauptstr." / "Haupt str" -> "hauptstrasse", also as a suffix.
      .replace(/str\.?(?=\s|,|;|$)/g, 'strasse')
      .replace(/g\.(?=\s|,|;|$)/g, 'gasse')
      .replace(/\bpl\.(?=\s|,|;|$)/g, 'platz')
  );
}

/** Alphanumeric tokens of >= 3 characters (house numbers like "1" carry nothing). */
function addressTokens(s) {
  return normaliseAddress(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
}

/**
 * Address: every distinctive token of the ground truth must be in the window.
 * The order does not matter - the screen reader speaks street, postcode and
 * city as separate nodes and in whatever order the markup has them.
 */
function addressMatches(answer, text) {
  const want = addressTokens(answer);
  if (want.length === 0) return false;
  const hay = normaliseAddress(text);
  return want.every((t) => hay.includes(t));
}

// Long spellings first, and only unambiguous abbreviations: "die", "mit", "son"
// are ordinary German words and must never be read as weekdays.
const WEEKDAYS = [
  ['mo', ['montag', 'monday', 'mon', 'mo']],
  ['di', ['dienstag', 'tuesday', 'tue', 'di']],
  ['mi', ['mittwoch', 'wednesday', 'wed', 'mi']],
  ['do', ['donnerstag', 'thursday', 'thu', 'do']],
  ['fr', ['freitag', 'friday', 'fri', 'fr']],
  ['sa', ['sonnabend', 'samstag', 'saturday', 'sat', 'sa']],
  ['so', ['sonntag', 'sunday', 'sun', 'so']],
];

/**
 * Opening hours: times in every common spelling ("12h30", "12.30", "12:30",
 * "12 Uhr 30") become "12:30", weekdays become their two-letter code.
 */
function normaliseHours(s) {
  let out = fold(s);
  out = out.replace(/(\d{1,2})\s*(?:uhr|h|:|\.)\s*(\d{2})\b/g, (_m, h, m) => `${pad2(h)}:${m}`);
  out = out.replace(/\b(\d{1,2})\s*uhr\b/g, (_m, h) => `${pad2(h)}:00`);
  for (const [code, spellings] of WEEKDAYS) {
    for (const word of spellings) {
      out = out.replace(new RegExp(`\\b${word}\\b`, 'g'), code);
    }
  }
  return out;
}

const pad2 = (n) => String(parseInt(n, 10)).padStart(2, '0');

/** The first `(weekday, from, to)` triple of a normalised hours string. */
function firstHoursPair(normalised) {
  const day = (normalised.match(/\b(mo|di|mi|do|fr|sa|so)\b/) || [])[1] || null;
  const times = normalised.match(/\b\d{2}:\d{2}\b/g) || [];
  return { day, from: times[0] || null, to: times[1] || null };
}

/**
 * Hours: the FIRST (day, time range) pair of the ground truth must be in the
 * window. Requiring the whole week would fail on any page that speaks one line
 * per day, which is most of them.
 */
function hoursMatches(answer, text) {
  const want = firstHoursPair(normaliseHours(answer));
  if (!want.from) return textMatches(answer, text);
  const hay = normaliseHours(text);
  if (!hay.includes(want.from)) return false;
  if (want.to && !hay.includes(want.to)) return false;
  if (want.day && !new RegExp(`\\b${want.day}\\b`).test(hay)) return false;
  return true;
}

/** Ratio of answer keywords that must appear for a free-text match. */
const TEXT_KEYWORD_RATIO = 0.7;

/** Distinctive words of a free-text answer. */
function textKeywords(s) {
  return fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 4);
}

/** Free text: at least `TEXT_KEYWORD_RATIO` of the answer's keywords. */
function textMatches(answer, text) {
  const want = textKeywords(answer);
  if (want.length === 0) {
    const needle = fold(answer);
    return needle.length > 0 && fold(text).includes(needle);
  }
  const hay = fold(text);
  const hits = want.filter((w) => hay.includes(w)).length;
  return hits / want.length >= TEXT_KEYWORD_RATIO;
}

const MATCHERS = {
  phone: phoneMatches,
  email: emailMatches,
  address: addressMatches,
  hours: hoursMatches,
  text: textMatches,
};

/**
 * Does `text` carry `answer`, read as an `answerType` value?
 * Deterministic; unknown types fall back to the free-text rule.
 */
function answerMatches(answer, answerType, text) {
  if (!answer || !text) return false;
  const matcher = MATCHERS[answerType] || textMatches;
  try {
    return matcher(answer, text);
  } catch (_) {
    return false;
  }
}

/**
 * Every window of heard speech an answer may sit in:
 *  - each single phrase (cursor phrases, live-region announcements, rotor entries);
 *  - runs of up to `MAX_ANSWER_PHRASE_SPAN` consecutive CONTENT cursor phrases,
 *    with the structural boundary phrases removed first - "Donaustadtstraße 1",
 *    "end of paragraph", "paragraph", "1220 Wien" is one address spoken in a row,
 *    and the two boundaries in the middle must not push the city out of reach.
 *
 * @param {{all: string[], cursor: string[]}} heard
 * @returns {string[]}
 */
function answerWindows(heard) {
  const all = (heard.all || []).filter((p) => typeof p === 'string' && p.trim() !== '');
  const content = (heard.cursor || []).filter(
    (p) => typeof p === 'string' && p.trim() !== '' && !isStructuralPhrase(p)
  );
  const windows = all.slice();
  for (let i = 0; i < content.length; i += 1) {
    let joined = content[i];
    for (let w = 2; w <= MAX_ANSWER_PHRASE_SPAN && i + w <= content.length; w += 1) {
      joined = `${joined} ${content[i + w - 1]}`;
      windows.push(joined);
    }
  }
  return windows;
}

/**
 * True once the heard speech carries the task's answer.
 *
 * @param {{all: string[], cursor: string[]}} heard - see `answerWindows`
 * @param {string} answer - the ground-truth value in plain text
 * @param {string} answerType - one of ANSWER_TYPES
 * @returns {{matched: boolean, window?: string}} the window that carried it
 */
function heardAnswer(heard, answer, answerType) {
  if (!answer) return { matched: false };
  for (const window of answerWindows(heard)) {
    if (answerMatches(answer, answerType, window)) return { matched: true, window };
  }
  return { matched: false };
}

/**
 * Validate an `answer` proposed by the generator against the page text.
 * Cheap sanity check, not a semantic one: it only rejects invented answers.
 *
 * @returns {{ok: boolean, reason?: string}}
 */
function validateAnswerAgainstPage(answer, answerType, pageText) {
  const value = String(answer == null ? '' : answer).trim();
  if (!value) return { ok: false, reason: 'answer is empty' };
  if (!ANSWER_TYPES.includes(answerType)) {
    return {
      ok: false,
      reason: `answerType "${answerType}" is not one of ${ANSWER_TYPES.join('|')}`,
    };
  }
  const hay = String(pageText == null ? '' : pageText);
  if (!hay) return { ok: true };

  if (answerType === 'phone') {
    const want = digitsOf(value);
    if (want.length < 4) return { ok: false, reason: `answer "${value}" holds no phone number` };
    const tail = want.length > PHONE_TAIL_DIGITS ? want.slice(-PHONE_TAIL_DIGITS) : want;
    return digitsOf(hay).includes(tail)
      ? { ok: true }
      : { ok: false, reason: `phone answer "${value}" is not in the page text` };
  }
  if (answerType === 'email') {
    return emailMatches(value, hay)
      ? { ok: true }
      : { ok: false, reason: `e-mail answer "${value}" is not in the page text` };
  }
  const words = fold(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
  if (words.length === 0) {
    return digitsOf(hay).includes(digitsOf(value))
      ? { ok: true }
      : { ok: false, reason: `answer "${value}" is not in the page text` };
  }
  const hayFolded = fold(hay);
  return words.some((w) => hayFolded.includes(w))
    ? { ok: true }
    : { ok: false, reason: `no word of the answer "${value}" occurs in the page text` };
}

module.exports = {
  ANSWER_TYPES,
  MAX_ANSWER_PHRASE_SPAN,
  JUDGE_PHRASE_WINDOW,
  isStructuralPhrase,
  fold,
  digitsOf,
  phoneMatches,
  emailMatches,
  addressMatches,
  addressTokens,
  normaliseAddress,
  normaliseHours,
  firstHoursPair,
  hoursMatches,
  textMatches,
  textKeywords,
  answerMatches,
  answerWindows,
  heardAnswer,
  validateAnswerAgainstPage,
};
