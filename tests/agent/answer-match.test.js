import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  ANSWER_TYPES,
  isStructuralPhrase,
  phoneMatches,
  emailMatches,
  addressMatches,
  hoursMatches,
  textMatches,
  answerMatches,
  answerWindows,
  heardAnswer,
  validateAnswerAgainstPage,
} = require('../../src/agent/answer-match');

// The phrases urologiefischer.at really speaks on its imprint page, in order.
// Every one of them was heard in the k=3 measurement while the tasks still
// scored 0, because the evidence had been picked from the home page.
const IMPRINT_PHRASES = [
  'heading, Information gem. § 5 ECG undOffenlegung gem. § 25 MedienG, level 2',
  'Information gem.',
  '§ 5',
  'ECG undOffenlegung gem.',
  '§ 25',
  'MedienG',
  'end of heading, Information gem. § 5 ECG undOffenlegung gem. § 25 MedienG, level 2',
  'paragraph',
  'Diensteanbieter:',
  'end of paragraph',
  'paragraph',
  'Dr. Mons Fischer, F.E.B.U.',
  'end of paragraph',
  'paragraph',
  'Donaustadtstraße 1',
  'end of paragraph',
  'paragraph',
  '1220 Wien',
  'end of paragraph',
  'paragraph',
  'Telefon: +43 1 203 93 33',
  'end of paragraph',
  'paragraph',
  'mons.fischer@hotmail.com',
  'end of paragraph',
];

const heard = (phrases) => ({ all: phrases, cursor: phrases });

describe('agent/answer-match: types', () => {
  it('names the five answer types', () => {
    expect(ANSWER_TYPES).toEqual(['phone', 'email', 'address', 'hours', 'text']);
  });
});

describe('agent/answer-match: structural phrases', () => {
  it('recognises the screen reader boundary phrases', () => {
    expect(isStructuralPhrase('paragraph')).toBe(true);
    expect(isStructuralPhrase('end of paragraph')).toBe(true);
    expect(isStructuralPhrase('document')).toBe(true);
    expect(isStructuralPhrase('end of heading, Impressum, level 2')).toBe(true);
  });
  it('leaves content alone', () => {
    expect(isStructuralPhrase('Donaustadtstraße 1')).toBe(false);
    expect(isStructuralPhrase('heading, Impressum, level 2')).toBe(false);
    expect(isStructuralPhrase('link, Impressum')).toBe(false);
  });
});

describe('agent/answer-match: phone', () => {
  it('matches the same number written with and without country code', () => {
    expect(phoneMatches('+43 1 2039333', 'Telefon: +43 1 203 93 33')).toBe(true);
    expect(phoneMatches('+43 1 2039333', 'TEL: 01 2039333')).toBe(true);
    expect(phoneMatches('+43 1 2039333', '0043 1 203 93 33')).toBe(true);
    expect(phoneMatches('01 2039333', 'Telefon: +43 1 203 93 33')).toBe(true);
  });
  it('does not match a different number', () => {
    expect(phoneMatches('+43 1 2039333', 'Telefon: +43 1 4448888')).toBe(false);
    expect(phoneMatches('+43 1 2039333', 'Donaustadtstraße 1, 1220 Wien')).toBe(false);
  });
});

describe('agent/answer-match: email', () => {
  it('matches case-insensitively and ignores spacing', () => {
    expect(emailMatches('mons.fischer@hotmail.com', 'MONS.FISCHER@Hotmail.com')).toBe(true);
    expect(emailMatches('mons.fischer@hotmail.com', 'E-Mail: mons.fischer@hotmail.com')).toBe(true);
  });
  it('does not match another address', () => {
    expect(emailMatches('mons.fischer@hotmail.com', 'office@hotmail.com')).toBe(false);
  });
});

describe('agent/answer-match: address', () => {
  it('matches across spelling and order', () => {
    expect(addressMatches('Donaustadtstraße 1, 1220 Wien', '1220 WIEN DONAUSTADTSTRASSE 1')).toBe(
      true
    );
    expect(
      addressMatches('Donaustadtstrasse 1, 1220 Wien', 'Donaustadtstraße 1 1220 Wien Telefon')
    ).toBe(true);
    expect(addressMatches('Hauptstraße 5, 1010 Wien', 'Hauptstr. 5, 1010 Wien')).toBe(true);
  });
  it('needs every distinctive token', () => {
    expect(addressMatches('Donaustadtstraße 1, 1220 Wien', 'Donaustadtstraße 1')).toBe(false);
    expect(addressMatches('Donaustadtstraße 1, 1220 Wien', '1030 Wien, Landstraße 4')).toBe(false);
  });
});

describe('agent/answer-match: hours', () => {
  it('normalises 12h30 / 12.30 / 12:30 and the weekday spelling', () => {
    expect(
      hoursMatches('Mo 12:30-18:30, Di 08:00-12:00', 'ORDINATIONSZEITEN MO: 12h30 - 18h30')
    ).toBe(true);
    expect(hoursMatches('Mo 12:30-18:30', 'Montag 12.30 bis 18.30 Uhr')).toBe(true);
    expect(hoursMatches('Monday 12:30-18:30', 'MO: 12h30 - 18h30')).toBe(true);
  });
  it('rejects a different day or a different time', () => {
    expect(hoursMatches('Mo 12:30-18:30', 'DI: 12h30 - 18h30')).toBe(false);
    expect(hoursMatches('Mo 12:30-18:30', 'MO: 08h00 - 12h00')).toBe(false);
  });
});

describe('agent/answer-match: text', () => {
  it('accepts 70% of the answer keywords', () => {
    expect(textMatches('Facharzt für Urologie und Andrologie', 'Facharzt und Team')).toBe(false);
    // 3 of 4 keywords is enough.
    expect(textMatches('Facharzt für Urologie und Andrologie', 'Facharzt für Urologie')).toBe(true);
    expect(
      textMatches('Facharzt für Urologie und Andrologie', 'Facharzt fuer Urologie und Andrologie')
    ).toBe(true);
  });
  it('falls back to containment for keyword-less answers', () => {
    expect(answerMatches('42', 'unknown-type', 'Antwort: 42')).toBe(true);
  });
});

describe('agent/answer-match: windows over what was heard', () => {
  it('joins up to three CONSECUTIVE CONTENT phrases across the boundary phrases', () => {
    // Street and city sit four phrases apart, but only because "end of
    // paragraph" / "paragraph" are spoken in between.
    const windows = answerWindows(heard(IMPRINT_PHRASES));
    expect(windows.some((w) => w.includes('Donaustadtstraße 1') && w.includes('1220 Wien'))).toBe(
      true
    );
  });
  it('does not join four content phrases', () => {
    const phrases = ['a', 'b', 'c', 'd'];
    expect(answerWindows(heard(phrases))).not.toContain('a b c d');
    expect(answerWindows(heard(phrases))).toContain('a b c');
  });
});

describe('agent/answer-match: heardAnswer on the real imprint phrases', () => {
  const cases = [
    ['+43 1 2039333', 'phone'],
    ['mons.fischer@hotmail.com', 'email'],
    ['Donaustadtstraße 1, 1220 Wien', 'address'],
  ];
  for (const [answer, answerType] of cases) {
    it(`hears the ${answerType} answer`, () => {
      const res = heardAnswer(heard(IMPRINT_PHRASES), answer, answerType);
      expect(res.matched).toBe(true);
      expect(typeof res.window).toBe('string');
    });
  }
  it('does not hear an answer that is not there', () => {
    expect(heardAnswer(heard(IMPRINT_PHRASES), 'Mo 12:30-18:30', 'hours').matched).toBe(false);
    expect(heardAnswer(heard(IMPRINT_PHRASES), '+43 1 4448888', 'phone').matched).toBe(false);
  });
  it('is false without an answer', () => {
    expect(heardAnswer(heard(IMPRINT_PHRASES), '', 'phone').matched).toBe(false);
  });
});

describe('agent/answer-match: validateAnswerAgainstPage', () => {
  const page = 'Telefon: +43 1 203 93 33 Donaustadtstraße 1 1220 Wien mons.fischer@hotmail.com';
  it('accepts an answer that is really on the page', () => {
    expect(validateAnswerAgainstPage('+43 1 2039333', 'phone', page).ok).toBe(true);
    expect(validateAnswerAgainstPage('mons.fischer@hotmail.com', 'email', page).ok).toBe(true);
    expect(validateAnswerAgainstPage('Donaustadtstraße 1, 1220 Wien', 'address', page).ok).toBe(
      true
    );
  });
  it('rejects an empty answer, an unknown type and an invented value', () => {
    expect(validateAnswerAgainstPage('', 'phone', page).ok).toBe(false);
    expect(validateAnswerAgainstPage('+43 1 2039333', 'telephone', page).ok).toBe(false);
    expect(validateAnswerAgainstPage('+43 1 4448888', 'phone', page).ok).toBe(false);
    expect(validateAnswerAgainstPage('someone@else.com', 'email', page).ok).toBe(false);
    expect(validateAnswerAgainstPage('Musterplatz 9, 4020 Linz', 'address', page).ok).toBe(false);
  });
});
