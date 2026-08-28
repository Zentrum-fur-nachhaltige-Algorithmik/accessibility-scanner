import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  normaliseLanguage,
  languageName,
  detectLanguageFromText,
  DEFAULT_LANGUAGE,
} = require('../../src/agent/page-language');

describe('agent/page-language', () => {
  it('reduces a BCP 47 tag to its primary subtag', () => {
    expect(normaliseLanguage('de-AT')).toBe('de');
    expect(normaliseLanguage('  EN_us ')).toBe('en');
    expect(normaliseLanguage('')).toBeNull();
    expect(normaliseLanguage('x')).toBeNull();
    expect(normaliseLanguage(null)).toBeNull();
  });

  it('names the languages the prompt has to ask for', () => {
    expect(languageName('de-CH')).toBe('German');
    expect(languageName('en')).toBe('English');
    // Not in the table: the code itself is still usable in the prompt.
    expect(languageName('sr')).toBe('sr');
    expect(languageName(null)).toBe('English');
  });

  it('tells German from English by their function words', () => {
    const german =
      'Wir sind eine Ordination im Herzen der Stadt und wir nehmen uns Zeit für Sie. ' +
      'Auf dieser Seite finden Sie unsere Leistungen, unsere Öffnungszeiten und die ' +
      'Möglichkeit, einen Termin zu vereinbaren. Rufen Sie uns an oder schreiben Sie uns.';
    const english =
      'We are a small practice in the heart of the city and we take our time for you. ' +
      'On this page you will find our services, our opening hours and the option to ' +
      'book an appointment. Call us or send us a message about your visit.';
    expect(detectLanguageFromText(german)).toBe('de');
    expect(detectLanguageFromText(english)).toBe('en');
  });

  it('gives up on text that is too short to judge', () => {
    expect(detectLanguageFromText('Kontakt')).toBeNull();
    expect(detectLanguageFromText('')).toBeNull();
    expect(DEFAULT_LANGUAGE).toBe('en');
  });
});
