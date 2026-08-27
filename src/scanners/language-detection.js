const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');

/**
 * Language Detection Scanner for WCAG 2.2 compliance testing
 * Implements EN 301 549 criteria 9.3.1.1, 9.3.1.2 (Language of Page, Language of Parts)
 * Detects page language declarations and multilingual content marking
 */
class LanguageDetectionScanner extends BaseScanner {
  constructor() {
    super('language-detection', {
      wcagCriteria: ['3.1.1', '3.1.2'],
      wcagPrinciple: 'understandable',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const scanOptions = {
      timeout: options.timeout || 60000,
      ...options,
    };

    // Create timestamped scan directory
    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const languageResults = await this.performLanguageAnalysis(page, scanDir, scanOptions);

    // Create report according to interface
    return {
      scannerId: this.id,
      criteria: ['9.3.1.1', '9.3.1.2'],
      passed: languageResults.violations.length === 0,
      violations: languageResults.violations,
      summary: {
        pageLanguageSet: languageResults.pageLanguageSet,
        pageLanguageValid: languageResults.pageLanguageValid,
        multilingualContentMarked: languageResults.multilingualContentMarked,
        languageChangesMarked: languageResults.languageChangesMarked,
      },
      screenshotPath: scanDir,
      visualEvidence: languageResults.visualEvidence,
    };
  }

  /**
   * Perform comprehensive language analysis
   */
  async performLanguageAnalysis(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let pageLanguageSet = false;
    let pageLanguageValid = false;
    let multilingualContentMarked = false;
    let languageChangesMarked = 0;

    console.log('Starting language detection analysis...');

    // Take initial screenshot
    const initialScreenshot = path.join(scanDir, 'language-analysis.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    // 1. Check page language declaration (WCAG 3.1.1)
    const pageLanguageAnalysis = await this.analyzePageLanguage(page, violations);
    pageLanguageSet = pageLanguageAnalysis.languageSet;
    pageLanguageValid = pageLanguageAnalysis.languageValid;

    // 2. Detect text content and analyze language usage
    const contentAnalysis = await this.analyzeContentLanguages(page, violations);

    // 3. Check for multilingual content marking (WCAG 3.1.2)
    const multilingualAnalysis = await this.analyzeMultilingualContent(
      page,
      violations,
      contentAnalysis
    );
    multilingualContentMarked = multilingualAnalysis.contentMarked;
    languageChangesMarked = multilingualAnalysis.changesMarked;

    // 4. Generate visual evidence
    visualEvidence.push({
      type: 'page-language',
      screenshot: path.basename(initialScreenshot),
      pageLanguage: pageLanguageAnalysis.declaredLanguage,
      detectedLanguage: contentAnalysis.primaryLanguage,
      confidence: contentAnalysis.confidence,
    });

    console.log(`Language analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      pageLanguageSet,
      pageLanguageValid,
      multilingualContentMarked,
      languageChangesMarked,
    };
  }

  /**
   * Analyze page language declaration
   */
  async analyzePageLanguage(page, violations) {
    console.log('Analyzing page language declaration...');

    const rawPageLanguageInfo = await page.evaluate(() => {
      const htmlElement = document.documentElement;

      // Same rule as above: plain serializable data only, and always the full shape.
      if (!htmlElement) {
        return {
          declaredLanguage: null,
          hasLang: false,
          htmlElement: { tagName: null, attributes: [] },
        };
      }

      const declaredLanguage =
        htmlElement.getAttribute('lang') || htmlElement.getAttribute('xml:lang') || null;

      return {
        declaredLanguage: declaredLanguage,
        hasLang: !!declaredLanguage,
        htmlElement: {
          tagName: htmlElement.tagName,
          attributes: Array.from(htmlElement.attributes).map((attr) => ({
            name: attr.name,
            value: attr.value,
          })),
        },
      };
    });

    const pageLanguageInfo = rawPageLanguageInfo || { declaredLanguage: null, hasLang: false };
    const languageSet = pageLanguageInfo.hasLang;
    let languageValid = false;

    // Check if page language is set
    if (!languageSet) {
      violations.push({
        criterion: '9.3.1.1',
        element: 'html',
        issue: 'no-page-language',
        description:
          'Page does not specify a language using the lang attribute on the html element',
        suggestion: 'Add lang attribute to <html> element (e.g., <html lang="en">)',
      });
    } else {
      // Validate language code format
      languageValid = this.isValidLanguageCode(pageLanguageInfo.declaredLanguage);

      if (!languageValid) {
        violations.push({
          criterion: '9.3.1.1',
          element: 'html',
          issue: 'invalid-language-code',
          declaredLanguage: pageLanguageInfo.declaredLanguage,
          description: `Page language code "${pageLanguageInfo.declaredLanguage}" is not a syntactically valid BCP 47 language tag`,
          suggestion:
            "Use a valid BCP 47 language tag (e.g., 'en', 'de', 'de-AT', 'deu', 'zh-Hant-TW') — not underscores, and not a bare word",
        });
      }
    }

    return {
      languageSet,
      languageValid,
      declaredLanguage: pageLanguageInfo.declaredLanguage,
    };
  }

  /**
   * Analyze content languages using simple heuristics
   */
  async analyzeContentLanguages(page, violations) {
    console.log('Analyzing content languages...');

    // NOTE: everything returned from page.evaluate() must be structured-cloneable.
    // Never put live DOM nodes (or anything holding a reference to one) into the
    // return value: on framework-rendered pages the nodes carry expando properties
    // (React attaches `__reactFiber$…` / `__reactProps$…`, which form a circular
    // object graph), CDP's returnByValue serialization then fails and Puppeteer
    // silently resolves the whole evaluate to `undefined`. That used to blow up the
    // consumer below with "Cannot read properties of undefined (reading 'map')" and,
    // because the pipeline swallows scanner rejections, blanked out 3.1.1/3.1.2 on
    // every React/Next.js page. Only plain, serializable data crosses the boundary.
    const rawContentAnalysis = await page.evaluate(() => {
      // Always return the same fully-populated shape, on every code path.
      const textElements = [];

      if (!document.body) {
        return { textElements };
      }

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          // Skip script and style content
          const parentTag = node.parentElement?.tagName.toLowerCase();
          if (['script', 'style', 'noscript'].includes(parentTag)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Only include text nodes with meaningful content
          const text = node.textContent.trim();
          if (text.length > 10) {
            // Minimum text length for language detection
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        },
      });

      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        const element = node.parentElement;
        if (!element) continue;

        textElements.push({
          text: text,
          selector:
            element.tagName.toLowerCase() +
            (element.id ? `#${element.id}` : '') +
            (element.className && typeof element.className === 'string'
              ? `.${element.className.split(' ')[0]}`
              : ''),
          langAttribute:
            element.getAttribute('lang') || element.closest('[lang]')?.getAttribute('lang') || null,
        });
      }

      return { textElements };
    });

    // Defensive defaults at the consumption site: never let a surprising evaluate
    // result turn into a hard crash (which the pipeline would report as 0 findings).
    const contentAnalysis = Array.isArray(rawContentAnalysis?.textElements)
      ? rawContentAnalysis.textElements
      : [];

    // Simple language detection heuristics
    const languagePatterns = {
      en: /\b(the|and|or|is|are|was|were|have|has|will|would|could|should|this|that|with|from|they|there|their|what|when|where|how)\b/gi,
      es: /\b(el|la|los|las|y|o|es|son|fue|fueron|tiene|han|será|podría|esto|eso|con|de|ellos|allí|su|qué|cuándo|dónde|cómo)\b/gi,
      fr: /\b(le|la|les|et|ou|est|sont|était|étaient|a|ont|sera|pourrait|ce|cette|avec|de|ils|là|leur|quoi|quand|où|comment)\b/gi,
      de: /\b(der|die|das|und|oder|ist|sind|war|waren|hat|haben|wird|könnte|dies|das|mit|von|sie|dort|ihr|was|wann|wo|wie)\b/gi,
      it: /\b(il|la|i|le|e|o|è|sono|era|erano|ha|hanno|sarà|potrebbe|questo|quella|con|di|loro|lì|il loro|cosa|quando|dove|come)\b/gi,
    };

    let primaryLanguage = 'unknown';
    let confidence = 0;
    const languageScores = {};

    // Analyze all text content
    const allText = contentAnalysis
      .map((item) => item.text)
      .join(' ')
      .toLowerCase();

    for (const [lang, pattern] of Object.entries(languagePatterns)) {
      const matches = allText.match(pattern) || [];
      languageScores[lang] = matches.length;
    }

    // Find the language with the highest score
    const maxScore = Math.max(...Object.values(languageScores));
    if (maxScore > 0) {
      primaryLanguage = Object.keys(languageScores).find(
        (lang) => languageScores[lang] === maxScore
      );
      confidence = Math.min(95, Math.round((maxScore / allText.split(' ').length) * 100 * 5)); // Rough confidence calculation
    }

    return {
      primaryLanguage,
      confidence,
      textElements: contentAnalysis,
      languageScores,
    };
  }

  /**
   * Analyze multilingual content marking
   */
  async analyzeMultilingualContent(page, violations, contentAnalysis) {
    console.log('Analyzing multilingual content marking...');

    let contentMarked = true;
    let changesMarked = 0;

    // Defensive default: an unexpected/aborted content analysis must degrade to
    // "nothing to check", never to a TypeError that the pipeline reports as 0 findings.
    const textElements = Array.isArray(contentAnalysis?.textElements)
      ? contentAnalysis.textElements
      : [];

    const primaryLanguage = contentAnalysis?.primaryLanguage || 'unknown';

    // Analyze each text element for language changes
    for (const textItem of textElements) {
      const text = (textItem?.text || '').toLowerCase();
      const declaredLang = textItem?.langAttribute;

      // Detect if text appears to be in a different language than the primary language
      const detectedLanguage = this.detectTextLanguage(text);

      if (
        detectedLanguage &&
        detectedLanguage !== primaryLanguage &&
        detectedLanguage !== 'unknown'
      ) {
        // This text appears to be in a different language
        if (!declaredLang || declaredLang !== detectedLanguage) {
          // Language change not properly marked
          violations.push({
            criterion: '9.3.1.2',
            element: textItem?.selector,
            issue: 'unmarked-language-change',
            detectedLanguage: detectedLanguage,
            declaredLanguage: declaredLang || primaryLanguage,
            confidence: this.getDetectionConfidence(text, detectedLanguage),
            textSample: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
            description: `Text appears to be in ${detectedLanguage} but is not marked with lang="${detectedLanguage}"`,
            suggestion: `Add lang="${detectedLanguage}" attribute to element containing foreign language text`,
          });

          contentMarked = false;
        } else {
          changesMarked++;
        }
      }
    }

    // Also check for invalid language codes on existing lang attributes
    const rawInvalidLangElements = await page.evaluate(() => {
      const elementsWithLang = document.querySelectorAll('[lang]');
      const invalid = [];

      elementsWithLang.forEach((element) => {
        const langCode = element.getAttribute('lang');
        const selector =
          element.tagName.toLowerCase() +
          (element.id ? `#${element.id}` : '') +
          (element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '');

        invalid.push({
          selector: selector,
          langCode: langCode,
          text: element.textContent.trim().substring(0, 100),
        });
      });

      return invalid;
    });

    const invalidLangElements = Array.isArray(rawInvalidLangElements) ? rawInvalidLangElements : [];

    // Validate language codes
    for (const element of invalidLangElements) {
      if (!this.isValidLanguageCode(element.langCode)) {
        violations.push({
          criterion: '9.3.1.2',
          element: element.selector,
          issue: 'invalid-language-code',
          declaredLanguage: element.langCode,
          description: `Element has a lang attribute ("${element.langCode}") that is not a syntactically valid BCP 47 language tag`,
          suggestion:
            "Use a valid BCP 47 language tag (e.g., 'en', 'de', 'de-AT', 'deu', 'zh-Hant-TW') — not underscores, and not a bare word",
        });
      }
    }

    return {
      contentMarked,
      changesMarked,
    };
  }

  /**
   * Detect language of text using simple heuristics
   */
  detectTextLanguage(text) {
    const languagePatterns = {
      es: /\b(este|esta|estos|estas|pero|porque|cuando|donde|como|muy|más|también|después|antes|durante)\b/gi,
      fr: /\b(cette|ces|mais|parce que|quand|où|comme|très|plus|aussi|après|avant|pendant)\b/gi,
      de: /\b(diese|dieser|dieses|aber|weil|wenn|wo|wie|sehr|mehr|auch|nach|vor|während)\b/gi,
      it: /\b(questo|questa|questi|queste|ma|perché|quando|dove|come|molto|più|anche|dopo|prima|durante)\b/gi,
    };

    let maxMatches = 0;
    let detectedLang = 'unknown';

    for (const [lang, pattern] of Object.entries(languagePatterns)) {
      const matches = (text.match(pattern) || []).length;
      if (matches > maxMatches && matches >= 2) {
        // Require at least 2 matches
        maxMatches = matches;
        detectedLang = lang;
      }
    }

    return detectedLang;
  }

  /**
   * Get confidence score for language detection
   */
  getDetectionConfidence(text, language) {
    const words = text.split(/\s+/).length;
    const languageWords =
      this.detectTextLanguage(text) === language
        ? (text.match(this.getLanguagePattern(language)) || []).length
        : 0;

    return Math.min(95, Math.round((languageWords / words) * 100));
  }

  /**
   * Get language pattern for a specific language
   */
  getLanguagePattern(language) {
    const patterns = {
      es: /\b(este|esta|estos|estas|pero|porque|cuando|donde|como|muy|más|también|después|antes|durante|el|la|los|las|y|o|es|son)\b/gi,
      fr: /\b(cette|ces|mais|parce que|quand|où|comme|très|plus|aussi|après|avant|pendant|le|la|les|et|ou|est|sont)\b/gi,
      de: /\b(diese|dieser|dieses|aber|weil|wenn|wo|wie|sehr|mehr|auch|nach|vor|während|der|die|das|und|oder|ist|sind)\b/gi,
      it: /\b(questo|questa|questi|queste|ma|perché|quando|dove|come|molto|più|anche|dopo|prima|durante|il|la|i|le|e|o|è|sono)\b/gi,
    };

    return patterns[language] || /\w+/gi;
  }

  /**
   * Validate language code format.
   *
   * The HTML `lang` attribute takes a BCP 47 language tag (RFC 5646), not a
   * bare ISO 639-1 code — three-letter ISO 639-2/639-3 subtags (e.g. "deu",
   * "gsw", "nds"), script/region/variant-qualified tags (e.g. "zh-Hant-TW",
   * "es-419", "de-CH-1901"), and grandfathered/private-use tags (e.g.
   * "en-GB-oed", "x-klingon") are all valid. This checks SYNTAX per the
   * RFC 5646 ABNF, not IANA Language Subtag Registry membership — there is
   * deliberately no hardcoded list of "known" languages here, so any tag that
   * is grammatically well-formed is accepted even if nobody has registered it.
   *
   * RFC 5646 §2.1 ABNF (grandfathered tags aside):
   *
   *   langtag     = language ["-" script] ["-" region]
   *                 *("-" variant) *("-" extension) ["-" privateuse]
   *   language    = 2*3ALPHA ["-" extlang] / 4ALPHA
   *   extlang     = 3ALPHA *2("-" 3ALPHA)
   *   script      = 4ALPHA
   *   region      = 2ALPHA / 3DIGIT
   *   variant     = 5*8alphanum / (DIGIT 3alphanum)
   *   extension   = singleton 1*("-" (2*8alphanum))
   *   singleton   = DIGIT / any ALPHA except "x"/"X"
   *   privateuse  = "x" 1*("-" (1*8alphanum))
   *
   * One deliberate narrowing vs. the raw ABNF: RFC 5646 also allows a bare
   * 5*8ALPHA primary subtag ("registered" for future use), but the RFC's own
   * text says "there were no examples of this kind of subtag" and "future
   * registrations of this type are discouraged" — none exist today either.
   * Accepting it would mean accepting any plain English (or German, etc.)
   * word of 5-8 letters — e.g. "english" itself — as a syntactically "valid
   * language", which defeats the point of validating. That form is excluded;
   * every other production above is implemented in full.
   */
  isValidLanguageCode(code) {
    if (!code || typeof code !== 'string') return false;
    const tag = code.trim();
    if (!tag) return false;

    // Grandfathered tags (RFC 5646 §2.2.8): a fixed, closed set of tags that
    // predate the subtag grammar and remain valid via the standard's own
    // exception clause. This is a syntactic constant of BCP 47 itself (there
    // will never be a 18th entry without a new RFC) — not a language
    // registry lookup.
    const GRANDFATHERED = new Set([
      // irregular
      'en-gb-oed',
      'i-ami',
      'i-bnn',
      'i-default',
      'i-enochian',
      'i-hak',
      'i-klingon',
      'i-lux',
      'i-mingo',
      'i-navajo',
      'i-pwn',
      'i-tao',
      'i-tay',
      'i-tsu',
      'sgn-be-fr',
      'sgn-be-nl',
      'sgn-ch-de',
      // regular
      'art-lojban',
      'cel-gaulish',
      'no-bok',
      'no-nyn',
      'zh-guoyu',
      'zh-hakka',
      'zh-min',
      'zh-min-nan',
      'zh-xiang',
    ]);
    if (GRANDFATHERED.has(tag.toLowerCase())) return true;

    const alphanum = '[a-zA-Z0-9]';
    const extlang = '[a-zA-Z]{3}(?:-[a-zA-Z]{3}){0,2}';
    const language = `(?:[a-zA-Z]{2,3}(?:-${extlang})?|[a-zA-Z]{4})`;
    const script = '[a-zA-Z]{4}';
    const region = '(?:[a-zA-Z]{2}|[0-9]{3})';
    const variant = `(?:${alphanum}{5,8}|[0-9]${alphanum}{3})`;
    const singleton = '[0-9a-wyzA-WYZ]'; // any letter/digit except x/X
    const extension = `${singleton}(?:-${alphanum}{2,8})+`;
    const privateuse = `x(?:-${alphanum}{1,8})+`;

    const langtagPattern = new RegExp(
      `^${language}(?:-${script})?(?:-${region})?(?:-${variant})*(?:-${extension})*(?:-${privateuse})?$`,
      'i'
    );
    const privateUseOnlyPattern = new RegExp(`^${privateuse}$`, 'i');

    return langtagPattern.test(tag) || privateUseOnlyPattern.test(tag);
  }
}

module.exports = LanguageDetectionScanner;
