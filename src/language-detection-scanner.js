const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Language Detection Scanner for WCAG 2.2 compliance testing
 * Implements EN 301 549 criteria 9.3.1.1, 9.3.1.2 (Language of Page, Language of Parts)
 * Detects page language declarations and multilingual content marking
 */
class LanguageDetectionScanner extends BaseScanner {
  constructor() {
    super('language-detection', {
      wcagCriteria: ['3.1.1', '3.1.2'],
      wcagPrinciple: 'understandable'
    });
    this.screenshotDir = path.join(__dirname, '../tmp/language-screenshots');
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
      ...options
    };

    // Create timestamped scan directory
    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const languageResults = await this.performLanguageAnalysis(page, scanDir, scanOptions);

    // Create report according to interface
    return {
      scannerId: this.id,
      criteria: ["9.3.1.1", "9.3.1.2"],
      passed: languageResults.violations.length === 0,
      violations: languageResults.violations,
      summary: {
        pageLanguageSet: languageResults.pageLanguageSet,
        pageLanguageValid: languageResults.pageLanguageValid,
        multilingualContentMarked: languageResults.multilingualContentMarked,
        languageChangesMarked: languageResults.languageChangesMarked
      },
      screenshotPath: scanDir,
      visualEvidence: languageResults.visualEvidence
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
    const multilingualAnalysis = await this.analyzeMultilingualContent(page, violations, contentAnalysis);
    multilingualContentMarked = multilingualAnalysis.contentMarked;
    languageChangesMarked = multilingualAnalysis.changesMarked;

    // 4. Generate visual evidence
    visualEvidence.push({
      type: 'page-language',
      screenshot: path.basename(initialScreenshot),
      pageLanguage: pageLanguageAnalysis.declaredLanguage,
      detectedLanguage: contentAnalysis.primaryLanguage,
      confidence: contentAnalysis.confidence
    });

    console.log(`Language analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      pageLanguageSet,
      pageLanguageValid,
      multilingualContentMarked,
      languageChangesMarked
    };
  }

  /**
   * Analyze page language declaration
   */
  async analyzePageLanguage(page, violations) {
    console.log('Analyzing page language declaration...');

    const pageLanguageInfo = await page.evaluate(() => {
      const htmlElement = document.documentElement;
      const declaredLanguage = htmlElement.getAttribute('lang') || htmlElement.getAttribute('xml:lang');

      return {
        declaredLanguage: declaredLanguage,
        hasLang: !!declaredLanguage,
        htmlElement: {
          tagName: htmlElement.tagName,
          attributes: Array.from(htmlElement.attributes).map(attr => ({
            name: attr.name,
            value: attr.value
          }))
        }
      };
    });

    const languageSet = pageLanguageInfo.hasLang;
    let languageValid = false;

    // Check if page language is set
    if (!languageSet) {
      violations.push({
        criterion: "9.3.1.1",
        element: "html",
        issue: "no-page-language",
        description: "Page does not specify a language using the lang attribute on the html element",
        suggestion: "Add lang attribute to <html> element (e.g., <html lang=\"en\">)"
      });
    } else {
      // Validate language code format
      languageValid = this.isValidLanguageCode(pageLanguageInfo.declaredLanguage);

      if (!languageValid) {
        violations.push({
          criterion: "9.3.1.1",
          element: "html",
          issue: "invalid-language-code",
          declaredLanguage: pageLanguageInfo.declaredLanguage,
          description: `Page language code "${pageLanguageInfo.declaredLanguage}" is not a valid language identifier`,
          suggestion: "Use a valid ISO 639-1 language code (e.g., 'en', 'es', 'fr', 'de')"
        });
      }
    }

    return {
      languageSet,
      languageValid,
      declaredLanguage: pageLanguageInfo.declaredLanguage
    };
  }

  /**
   * Analyze content languages using simple heuristics
   */
  async analyzeContentLanguages(page, violations) {
    console.log('Analyzing content languages...');

    const contentAnalysis = await page.evaluate(() => {
      // Get all text content from the page
      const textElements = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            // Skip script and style content
            const parentTag = node.parentElement?.tagName.toLowerCase();
            if (['script', 'style', 'noscript'].includes(parentTag)) {
              return NodeFilter.FILTER_REJECT;
            }

            // Only include text nodes with meaningful content
            const text = node.textContent.trim();
            if (text.length > 10) { // Minimum text length for language detection
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
          }
        }
      );

      let node;
      while (node = walker.nextNode()) {
        const text = node.textContent.trim();
        const element = node.parentElement;

        textElements.push({
          text: text,
          element: element,
          selector: element.tagName.toLowerCase() +
                   (element.id ? `#${element.id}` : '') +
                   (element.className ? `.${element.className.split(' ')[0]}` : ''),
          langAttribute: element.getAttribute('lang') || element.closest('[lang]')?.getAttribute('lang')
        });
      }

      return textElements;
    });

    // Simple language detection heuristics
    const languagePatterns = {
      'en': /\b(the|and|or|is|are|was|were|have|has|will|would|could|should|this|that|with|from|they|there|their|what|when|where|how)\b/gi,
      'es': /\b(el|la|los|las|y|o|es|son|fue|fueron|tiene|han|será|podría|esto|eso|con|de|ellos|allí|su|qué|cuándo|dónde|cómo)\b/gi,
      'fr': /\b(le|la|les|et|ou|est|sont|était|étaient|a|ont|sera|pourrait|ce|cette|avec|de|ils|là|leur|quoi|quand|où|comment)\b/gi,
      'de': /\b(der|die|das|und|oder|ist|sind|war|waren|hat|haben|wird|könnte|dies|das|mit|von|sie|dort|ihr|was|wann|wo|wie)\b/gi,
      'it': /\b(il|la|i|le|e|o|è|sono|era|erano|ha|hanno|sarà|potrebbe|questo|quella|con|di|loro|lì|il loro|cosa|quando|dove|come)\b/gi
    };

    let primaryLanguage = 'unknown';
    let confidence = 0;
    const languageScores = {};

    // Analyze all text content
    const allText = contentAnalysis.map(item => item.text).join(' ').toLowerCase();

    for (const [lang, pattern] of Object.entries(languagePatterns)) {
      const matches = allText.match(pattern) || [];
      languageScores[lang] = matches.length;
    }

    // Find the language with the highest score
    const maxScore = Math.max(...Object.values(languageScores));
    if (maxScore > 0) {
      primaryLanguage = Object.keys(languageScores).find(lang => languageScores[lang] === maxScore);
      confidence = Math.min(95, Math.round((maxScore / allText.split(' ').length) * 100 * 5)); // Rough confidence calculation
    }

    return {
      primaryLanguage,
      confidence,
      textElements: contentAnalysis,
      languageScores
    };
  }

  /**
   * Analyze multilingual content marking
   */
  async analyzeMultilingualContent(page, violations, contentAnalysis) {
    console.log('Analyzing multilingual content marking...');

    let contentMarked = true;
    let changesMarked = 0;

    // Analyze each text element for language changes
    for (const textItem of contentAnalysis.textElements) {
      const text = textItem.text.toLowerCase();
      const declaredLang = textItem.langAttribute;

      // Detect if text appears to be in a different language than the primary language
      const detectedLanguage = this.detectTextLanguage(text);

      if (detectedLanguage &&
          detectedLanguage !== contentAnalysis.primaryLanguage &&
          detectedLanguage !== 'unknown') {

        // This text appears to be in a different language
        if (!declaredLang || declaredLang !== detectedLanguage) {
          // Language change not properly marked
          violations.push({
            criterion: "9.3.1.2",
            element: textItem.selector,
            issue: "unmarked-language-change",
            detectedLanguage: detectedLanguage,
            declaredLanguage: declaredLang || contentAnalysis.primaryLanguage,
            confidence: this.getDetectionConfidence(text, detectedLanguage),
            textSample: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
            description: `Text appears to be in ${detectedLanguage} but is not marked with lang="${detectedLanguage}"`,
            suggestion: `Add lang="${detectedLanguage}" attribute to element containing foreign language text`
          });

          contentMarked = false;
        } else {
          changesMarked++;
        }
      }
    }

    // Also check for invalid language codes on existing lang attributes
    const invalidLangElements = await page.evaluate(() => {
      const elementsWithLang = document.querySelectorAll('[lang]');
      const invalid = [];

      elementsWithLang.forEach(element => {
        const langCode = element.getAttribute('lang');
        const selector = element.tagName.toLowerCase() +
                        (element.id ? `#${element.id}` : '') +
                        (element.className ? `.${element.className.split(' ')[0]}` : '');

        invalid.push({
          selector: selector,
          langCode: langCode,
          text: element.textContent.trim().substring(0, 100)
        });
      });

      return invalid;
    });

    // Validate language codes
    for (const element of invalidLangElements) {
      if (!this.isValidLanguageCode(element.langCode)) {
        violations.push({
          criterion: "9.3.1.2",
          element: element.selector,
          issue: "invalid-language-code",
          declaredLanguage: element.langCode,
          description: `Element has invalid language code "${element.langCode}"`,
          suggestion: "Use a valid ISO 639-1 language code"
        });
      }
    }

    return {
      contentMarked,
      changesMarked
    };
  }

  /**
   * Detect language of text using simple heuristics
   */
  detectTextLanguage(text) {
    const languagePatterns = {
      'es': /\b(este|esta|estos|estas|pero|porque|cuando|donde|como|muy|más|también|después|antes|durante)\b/gi,
      'fr': /\b(cette|ces|mais|parce que|quand|où|comme|très|plus|aussi|après|avant|pendant)\b/gi,
      'de': /\b(diese|dieser|dieses|aber|weil|wenn|wo|wie|sehr|mehr|auch|nach|vor|während)\b/gi,
      'it': /\b(questo|questa|questi|queste|ma|perché|quando|dove|come|molto|più|anche|dopo|prima|durante)\b/gi
    };

    let maxMatches = 0;
    let detectedLang = 'unknown';

    for (const [lang, pattern] of Object.entries(languagePatterns)) {
      const matches = (text.match(pattern) || []).length;
      if (matches > maxMatches && matches >= 2) { // Require at least 2 matches
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
    const languageWords = this.detectTextLanguage(text) === language ?
                         (text.match(this.getLanguagePattern(language)) || []).length : 0;

    return Math.min(95, Math.round((languageWords / words) * 100));
  }

  /**
   * Get language pattern for a specific language
   */
  getLanguagePattern(language) {
    const patterns = {
      'es': /\b(este|esta|estos|estas|pero|porque|cuando|donde|como|muy|más|también|después|antes|durante|el|la|los|las|y|o|es|son)\b/gi,
      'fr': /\b(cette|ces|mais|parce que|quand|où|comme|très|plus|aussi|après|avant|pendant|le|la|les|et|ou|est|sont)\b/gi,
      'de': /\b(diese|dieser|dieses|aber|weil|wenn|wo|wie|sehr|mehr|auch|nach|vor|während|der|die|das|und|oder|ist|sind)\b/gi,
      'it': /\b(questo|questa|questi|queste|ma|perché|quando|dove|come|molto|più|anche|dopo|prima|durante|il|la|i|le|e|o|è|sono)\b/gi
    };

    return patterns[language] || /\w+/gi;
  }

  /**
   * Validate language code format
   */
  isValidLanguageCode(code) {
    if (!code) return false;

    // Basic validation for ISO 639-1 codes (2 letters) and some extended formats
    const validPattern = /^[a-z]{2}(-[A-Z]{2})?$/;

    // Common valid language codes
    const validCodes = [
      'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi',
      'en-US', 'en-GB', 'es-ES', 'es-MX', 'fr-FR', 'fr-CA', 'de-DE', 'de-AT',
      'it-IT', 'pt-BR', 'pt-PT', 'zh-CN', 'zh-TW'
    ];

    return validPattern.test(code) && (code.length === 2 || validCodes.includes(code));
  }

}

module.exports = LanguageDetectionScanner;
