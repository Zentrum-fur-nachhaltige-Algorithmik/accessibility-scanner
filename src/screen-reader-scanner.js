const BaseScanner = require('./base-scanner');

class ScreenReaderScanner extends BaseScanner {
  constructor() {
    super('screen-reader', {
      wcagCriteria: ['1.3.1', '4.1.2', '4.1.3'],
      wcagPrinciple: 'perceivable'
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const [
      headingStructure,
      landmarks,
      images,
      forms,
      ariaUsage
    ] = await Promise.all([
      this.analyzeHeadingStructure(page),
      this.analyzeLandmarks(page),
      this.analyzeImages(page),
      this.analyzeForms(page),
      this.analyzeAriaUsage(page)
    ]);

    const pageTitle = await page.title();

    const euCompliance = this.calculateEUCompliance({
      headingStructure,
      landmarks,
      images,
      forms,
      ariaUsage
    });

    return {
      scannerId: this.id,
      passed: euCompliance.en301549.compliant,
      timestamp: new Date(),
      pageTitle,
      headingStructure,
      landmarks,
      images,
      forms,
      ariaUsage,
      euCompliance,
      violations: euCompliance.en301549.violations,
      summary: {
        score: euCompliance.en301549.score,
        headingIssues: headingStructure.issues.length,
        landmarkIssues: landmarks.issues.length,
        imageIssues: images.problematic.length,
        ariaIssues: ariaUsage.misusedAttributes.length
      }
    };
  }

  async analyzeHeadingStructure(page) {
    return await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const hierarchy = [];
      const issues = [];
      let lastLevel = 0;
      let h1Count = 0;

      headings.forEach((heading, index) => {
        const level = parseInt(heading.tagName.charAt(1));
        const text = heading.textContent.trim();
        const line = heading.getBoundingClientRect().top + window.scrollY;

        if (level === 1) h1Count++;

        hierarchy.push({
          level,
          text: text || '[Empty heading]',
          line: Math.round(line),
          tagName: heading.tagName,
          id: heading.id || '',
          isEmpty: !text
        });

        if (!text) {
          issues.push(`Empty heading at position ${index + 1} (${heading.tagName})`);
        }

        if (level > lastLevel + 1 && lastLevel !== 0) {
          issues.push(`${heading.tagName} follows H${lastLevel} (skipping levels)`);
        }

        lastLevel = level;
      });

      if (h1Count === 0) {
        issues.push('No H1 heading found');
      } else if (h1Count > 1) {
        issues.push(`Multiple H1 headings found (${h1Count})`);
      }

      return {
        valid: issues.length === 0,
        issues,
        hierarchy,
        totalHeadings: headings.length,
        h1Count
      };
    });
  }

  async analyzeLandmarks(page) {
    return await page.evaluate(() => {
      const landmarks = {
        main: document.querySelector('main, [role="main"]') !== null,
        navigation: document.querySelector('nav, [role="navigation"]') !== null,
        banner: document.querySelector('header, [role="banner"]') !== null,
        contentinfo: document.querySelector('footer, [role="contentinfo"]') !== null,
        complementary: document.querySelector('aside, [role="complementary"]') !== null,
        search: document.querySelector('[role="search"]') !== null
      };

      const issues = [];
      const landmarkElements = document.querySelectorAll(`
        main, [role="main"],
        nav, [role="navigation"],
        header, [role="banner"],
        footer, [role="contentinfo"],
        aside, [role="complementary"],
        [role="search"]
      `);

      if (!landmarks.main) {
        issues.push('No main landmark found');
      }

      if (!landmarks.navigation) {
        issues.push('No navigation landmark found');
      }

      const mainElements = document.querySelectorAll('main, [role="main"]');
      if (mainElements.length > 1) {
        issues.push('Multiple main landmarks found');
      }

      const contentWithoutLandmarks = Array.from(document.querySelectorAll('body > *'))
        .filter(el => {
          return el.offsetParent !== null &&
                 el.textContent.trim().length > 0 &&
                 !el.closest('main, nav, header, footer, aside, [role="main"], [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]');
        });

      if (contentWithoutLandmarks.length > 0) {
        issues.push('Content found outside of landmarks');
      }

      return {
        ...landmarks,
        issues,
        landmarkCount: landmarkElements.length
      };
    });
  }

  async analyzeImages(page) {
    return await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      const problematic = [];
      let withAlt = 0;
      let decorative = 0;

      images.forEach((img, index) => {
        const alt = img.getAttribute('alt');
        const src = img.src;
        const isDecorative = alt === '';

        if (isDecorative) {
          decorative++;
        } else if (alt && alt.trim()) {
          withAlt++;
        } else {
          problematic.push({
            index: index + 1,
            src: src.substring(0, 100),
            issue: 'Missing alt attribute',
            severity: 'critical'
          });
        }

        if (alt && alt.length > 125) {
          problematic.push({
            index: index + 1,
            src: src.substring(0, 100),
            issue: `Alt text too long (${alt.length} characters)`,
            severity: 'moderate'
          });
        }

        if (alt && /\.(jpg|jpeg|png|gif|svg|webp)$/i.test(alt)) {
          problematic.push({
            index: index + 1,
            src: src.substring(0, 100),
            issue: 'Alt text contains file extension',
            severity: 'minor'
          });
        }
      });

      return {
        total: images.length,
        withAlt,
        decorative,
        problematic
      };
    });
  }

  async analyzeForms(page) {
    return await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll('form'));
      const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
      const requiredFields = [];
      let labelsCorrect = true;
      let errorHandling = false;

      inputs.forEach((input, index) => {
        const label = document.querySelector(`label[for="${input.id}"]`) ||
                     input.closest('label') ||
                     document.querySelector(`[aria-labelledby="${input.id}"]`);

        const ariaLabel = input.getAttribute('aria-label');
        const ariaLabelledby = input.getAttribute('aria-labelledby');

        if (!label && !ariaLabel && !ariaLabelledby && input.type !== 'hidden' && input.type !== 'submit') {
          labelsCorrect = false;
          requiredFields.push({
            index: index + 1,
            type: input.type || input.tagName.toLowerCase(),
            id: input.id || '',
            issue: 'No associated label found'
          });
        }

        if (input.hasAttribute('required') || input.hasAttribute('aria-required')) {
          const hasRequiredIndicator =
            (label && label.textContent.includes('*')) ||
            input.getAttribute('aria-required') === 'true' ||
            input.hasAttribute('required');

          requiredFields.push({
            index: index + 1,
            type: input.type || input.tagName.toLowerCase(),
            id: input.id || '',
            required: true,
            hasIndicator: hasRequiredIndicator
          });
        }
      });

      const errorElements = document.querySelectorAll('[role="alert"], .error, .invalid, [aria-invalid="true"]');
      errorHandling = errorElements.length > 0;

      return {
        totalForms: forms.length,
        totalInputs: inputs.length,
        labelsCorrect,
        errorHandling,
        requiredFields
      };
    });
  }

  async analyzeAriaUsage(page) {
    return await page.evaluate(() => {
      const elementsWithAria = Array.from(document.querySelectorAll('[aria-label], [aria-labelledby], [aria-describedby], [role], [aria-expanded], [aria-hidden], [aria-live], [aria-atomic], [aria-busy]'));
      const misusedAttributes = [];
      const recommendations = [];
      let correctUsage = 0;

      const validRoles = [
        'alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell', 'checkbox',
        'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 'dialog',
        'directory', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell', 'group',
        'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee',
        'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
        'navigation', 'none', 'note', 'option', 'presentation', 'progressbar', 'radio',
        'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search',
        'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab',
        'table', 'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar', 'tooltip',
        'tree', 'treegrid', 'treeitem'
      ];

      elementsWithAria.forEach((element, index) => {
        const role = element.getAttribute('role');
        const ariaLabel = element.getAttribute('aria-label');
        const ariaLabelledby = element.getAttribute('aria-labelledby');
        const ariaDescribedby = element.getAttribute('aria-describedby');
        const ariaHidden = element.getAttribute('aria-hidden');

        if (role && !validRoles.includes(role)) {
          misusedAttributes.push(`Invalid role "${role}" on ${element.tagName}`);
        } else if (role && validRoles.includes(role)) {
          correctUsage++;
        }

        if (ariaLabel && ariaLabel.trim()) {
          correctUsage++;
        }

        if (ariaLabelledby) {
          const referencedElement = document.getElementById(ariaLabelledby);
          if (!referencedElement) {
            misusedAttributes.push(`aria-labelledby references non-existent element "${ariaLabelledby}"`);
          } else {
            correctUsage++;
          }
        }

        if (ariaDescribedby) {
          const referencedElement = document.getElementById(ariaDescribedby);
          if (!referencedElement) {
            misusedAttributes.push(`aria-describedby references non-existent element "${ariaDescribedby}"`);
          } else {
            correctUsage++;
          }
        }

        if (ariaHidden === 'true' && element.offsetParent !== null) {
          const hasVisibleText = element.textContent.trim().length > 0;
          if (hasVisibleText) {
            recommendations.push(`Element with aria-hidden="true" is visible and contains text`);
          }
        }
      });

      const imagesWithoutAlt = Array.from(document.querySelectorAll('img:not([alt])'));
      if (imagesWithoutAlt.length > 0) {
        recommendations.push(`Add alt attributes to ${imagesWithoutAlt.length} images`);
      }

      const buttonsWithoutLabels = Array.from(document.querySelectorAll('button:not([aria-label]):not([aria-labelledby])'))
        .filter(btn => !btn.textContent.trim());
      if (buttonsWithoutLabels.length > 0) {
        recommendations.push(`Add labels to ${buttonsWithoutLabels.length} buttons`);
      }

      return {
        totalAriaElements: elementsWithAria.length,
        correctUsage,
        misusedAttributes,
        recommendations
      };
    });
  }

  calculateEUCompliance(analysisResults) {
    const violations = [];
    let score = 100;

    if (!analysisResults.headingStructure.valid) {
      violations.push({
        clause: '9.1.3.1',
        description: 'Info and Relationships - Heading structure issues',
        severity: 'high',
        details: analysisResults.headingStructure.issues
      });
      score -= 15;
    }

    if (!analysisResults.landmarks.main) {
      violations.push({
        clause: '9.2.4.1',
        description: 'Bypass Blocks - No main landmark',
        severity: 'high',
        details: ['Missing main landmark for content navigation']
      });
      score -= 10;
    }

    if (analysisResults.images.problematic.length > 0) {
      violations.push({
        clause: '9.1.1.1',
        description: 'Non-text Content - Image accessibility issues',
        severity: 'critical',
        details: analysisResults.images.problematic.map(img => img.issue)
      });
      score -= Math.min(20, analysisResults.images.problematic.length * 5);
    }

    if (!analysisResults.forms.labelsCorrect) {
      violations.push({
        clause: '9.3.3.2',
        description: 'Labels or Instructions - Form labeling issues',
        severity: 'high',
        details: ['Form controls missing proper labels']
      });
      score -= 15;
    }

    if (analysisResults.ariaUsage.misusedAttributes.length > 0) {
      violations.push({
        clause: '9.4.1.2',
        description: 'Name, Role, Value - ARIA misuse',
        severity: 'moderate',
        details: analysisResults.ariaUsage.misusedAttributes
      });
      score -= Math.min(10, analysisResults.ariaUsage.misusedAttributes.length * 2);
    }

    const accessibilityStatement = false; // Would need to check for actual statement
    const contactMechanism = false; // Would need to check for contact info

    return {
      en301549: {
        compliant: violations.length === 0,
        score: Math.max(0, score),
        violations
      },
      eaaCompliance: {
        ready: accessibilityStatement && contactMechanism,
        missingRequirements: [
          ...(!accessibilityStatement ? ['No accessibility statement found'] : []),
          ...(!contactMechanism ? ['Contact mechanism not provided'] : [])
        ]
      }
    };
  }

  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  createErrorReport(url, errorMessage) {
    return {
      url,
      timestamp: new Date(),
      pageTitle: '',
      error: errorMessage,
      headingStructure: { valid: false, issues: [], hierarchy: [] },
      landmarks: { main: false, navigation: false, issues: [] },
      images: { total: 0, withAlt: 0, decorative: 0, problematic: [] },
      forms: { labelsCorrect: false, errorHandling: false, requiredFields: [] },
      ariaUsage: { correctUsage: 0, misusedAttributes: [], recommendations: [] }
    };
  }

}

module.exports = ScreenReaderScanner;
