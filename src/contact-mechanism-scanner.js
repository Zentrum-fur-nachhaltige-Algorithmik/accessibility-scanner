const BaseScanner = require('./base-scanner');
const { findStatementLink } = require('./utils/accessibility-statement');

/**
 * Contact Mechanism Scanner for EAA Procedural Requirements
 * Implements European Accessibility Act contact requirements
 * EN 301 549 criteria 12.1.2 (Accessible procurement)
 */
class ContactMechanismScanner extends BaseScanner {
  constructor() {
    super('contact-mechanism', {
      wcagCriteria: ['EN 301 549 12.2'],
      wcagPrinciple: 'robust'
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * This scanner may navigate to sub-pages to find contact information,
   * so it uses the provided page as a starting point.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const defaultOptions = {
      timeout: 30000,
      searchDepth: 3
    };

    const scanOptions = { ...defaultOptions, ...options };

    const contactResults = await this.analyzeContactMechanisms(page, scanOptions);

    return {
      scannerId: this.id,
      criteria: ["EAA-Contact", "EN-301-549-12.1.2"],
      passed: contactResults.violations.length === 0,
      violations: contactResults.violations,
      summary: {
        emailContactAvailable: contactResults.emailContactAvailable,
        phoneContactAvailable: contactResults.phoneContactAvailable,
        onlineFormAvailable: contactResults.onlineFormAvailable,
        contactAccessible: contactResults.contactAccessible,
        responseTimeStated: contactResults.responseTimeStated,
        multipleOptionsAvailable: contactResults.multipleOptionsAvailable,
        gatedOnMissingStatement: !contactResults.statementPresent
      }
    };
  }

  /**
   * @deprecated Use scan(page, options) via ScanPipeline instead
   * Scan for contact mechanism compliance
   * @param {string} url - URL to scan
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ContactMechanismReport
   */
  async scanContactMechanisms(url, options = {}) {
    const defaultOptions = {
      timeout: 30000,
      searchDepth: 3
    };

    const scanOptions = { ...defaultOptions, ...options };

    try {
      await this.init();
      const page = await this.browser.newPage();

      await page.goto(url, { waitUntil: 'networkidle0', timeout: scanOptions.timeout });

      try {
        return await this.scan(page, options);
      } finally {
        await page.close();
      }

    } catch (error) {
      throw new Error(`Contact mechanism scan failed: ${error.message}`);
    }
  }

  /**
   * Analyze contact mechanisms on the page
   */
  async analyzeContactMechanisms(page, options) {
    console.log('Analyzing contact mechanisms...');

    const violations = [];
    let emailContactAvailable = false;
    let phoneContactAvailable = false;
    let onlineFormAvailable = false;
    let contactAccessible = false;
    let responseTimeStated = false;
    let multipleOptionsAvailable = false;

    // Analyze main page for contact mechanisms
    const mainPageAnalysis = await this.analyzePageContactMechanisms(page);
    const statementPresent = (await findStatementLink(page)).found;

    // Check if we found any contact mechanisms on main page
    if (mainPageAnalysis.hasContactMechanisms) {
      emailContactAvailable = mainPageAnalysis.emailContact;
      phoneContactAvailable = mainPageAnalysis.phoneContact;
      onlineFormAvailable = mainPageAnalysis.onlineForm;
      responseTimeStated = mainPageAnalysis.responseTime;
      contactAccessible = true;
    } else {
      // Look for contact page
      const contactPageResult = await this.findAndAnalyzeContactPage(page, options);

      if (contactPageResult.found) {
        emailContactAvailable = contactPageResult.emailContact;
        phoneContactAvailable = contactPageResult.phoneContact;
        onlineFormAvailable = contactPageResult.onlineForm;
        responseTimeStated = contactPageResult.responseTime;
        contactAccessible = contactPageResult.accessible;
      }
    }

    // Calculate if multiple options are available
    const contactMethodCount = [emailContactAvailable, phoneContactAvailable, onlineFormAvailable].filter(Boolean).length;
    multipleOptionsAvailable = contactMethodCount >= 2;

    // Generate violations
    if (!emailContactAvailable && !phoneContactAvailable && !onlineFormAvailable) {
      violations.push({
        criterion: "EAA-Contact",
        issue: "no-contact-methods",
        description: "No accessibility contact mechanisms found",
        suggestion: "Provide at least one contact method (email, phone, or online form) for accessibility issues",
        severity: "serious"
      });
    } else {
      // Check individual contact methods quality
      if (emailContactAvailable) {
        const emailValidation = await this.validateEmailContacts(page);
        if (!emailValidation.valid) {
          violations.push({
            criterion: "EAA-Contact",
            issue: "invalid-email",
            description: `Email contact found but appears invalid: ${emailValidation.reason}`,
            element: emailValidation.element,
            suggestion: "Ensure email addresses are valid and functional",
            severity: "major"
          });
        }
      }

      if (phoneContactAvailable) {
        const phoneValidation = await this.validatePhoneContacts(page);
        if (!phoneValidation.valid) {
          violations.push({
            criterion: "EAA-Contact",
            issue: "invalid-phone",
            description: `Phone contact found but appears invalid: ${phoneValidation.reason}`,
            element: phoneValidation.element,
            suggestion: "Ensure phone numbers are valid and properly formatted",
            severity: "major"
          });
        }
      }

      if (!contactAccessible) {
        violations.push({
          criterion: "EAA-Contact",
          issue: "inaccessible-contact",
          description: "Contact information found but contact page is not accessible",
          suggestion: "Ensure contact page loads correctly and is accessible to all users",
          severity: "major"
        });
      }

      if (contactMethodCount === 1) {
        violations.push({
          criterion: "EAA-Contact",
          issue: "insufficient-methods",
          description: "Only one contact method available. Multiple options recommended for better accessibility",
          suggestion: "Provide multiple contact options (email, phone, and/or online form)",
          severity: "minor"
        });
      }

      // A response-time commitment for accessibility enquiries is something the
      // accessibility statement has to declare (EN 301 549 clause 12.2.2). With
      // no statement published there is nothing to read it out of, and
      // `accessibility-statement` already reports that root cause — reporting
      // the consequence too would double-count one defect.
      if (!responseTimeStated && statementPresent) {
        violations.push({
          criterion: "EAA-Contact",
          issue: "no-response-time",
          description: "No response time commitment stated for accessibility inquiries",
          suggestion: "State expected response time for accessibility-related contact (e.g., '2 business days')",
          severity: "minor"
        });
      }
    }

    return {
      violations,
      emailContactAvailable,
      phoneContactAvailable,
      onlineFormAvailable,
      contactAccessible,
      responseTimeStated,
      multipleOptionsAvailable,
      statementPresent
    };
  }

  /**
   * Analyze contact mechanisms on current page
   */
  async analyzePageContactMechanisms(page) {
    console.log('  Analyzing contact mechanisms on current page...');

    const analysis = await page.evaluate(() => {
      const pageText = document.body.textContent.toLowerCase();

      // Check for email contacts
      const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emailMatches = pageText.match(emailPattern);
      const emailLinks = document.querySelectorAll('a[href^="mailto:"]');
      const emailContact = (emailMatches && emailMatches.length > 0) || emailLinks.length > 0;

      // Check for phone contacts
      const phonePattern = /(\+?[0-9\s\-()]{10,}|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b)/g;
      const phoneMatches = pageText.match(phonePattern);
      const phoneLinks = document.querySelectorAll('a[href^="tel:"]');
      const phoneContact = (phoneMatches && phoneMatches.length > 0) || phoneLinks.length > 0;

      // Check for online forms
      const forms = document.querySelectorAll('form');
      const contactForms = Array.from(forms).filter(form => {
        const formText = form.textContent.toLowerCase();
        return formText.includes('contact') ||
               formText.includes('feedback') ||
               formText.includes('accessibility') ||
               formText.includes('support');
      });
      const onlineForm = contactForms.length > 0;

      // Check for response time statements
      const responseTimePatterns = [
        /respond\s+within\s+\d+/i,
        /response\s+time[:\s]*\d+/i,
        /within\s+\d+\s+(business\s+)?days?/i,
        /\d+\s+(business\s+)?days?\s+to\s+respond/i,
        /reply\s+within/i
      ];

      let responseTime = false;
      for (const pattern of responseTimePatterns) {
        if (pattern.test(pageText)) {
          responseTime = true;
          break;
        }
      }

      // Check if there are any contact mechanisms at all
      const hasContactMechanisms = emailContact || phoneContact || onlineForm;

      return {
        emailContact,
        phoneContact,
        onlineForm,
        responseTime,
        hasContactMechanisms
      };
    });

    return analysis;
  }

  /**
   * Find and analyze dedicated contact page
   */
  async findAndAnalyzeContactPage(page, options) {
    console.log('  Looking for dedicated contact page...');

    // Find contact page link
    const contactLinkResult = await page.evaluate(() => {
      const contactPatterns = [
        'contact us',
        'contact',
        'kontakt',
        'support',
        'help',
        'feedback',
        'accessibility contact'
      ];

      const links = Array.from(document.querySelectorAll('a[href]'));

      for (const link of links) {
        const text = link.textContent.toLowerCase().trim();
        const href = link.getAttribute('href').toLowerCase();

        for (const pattern of contactPatterns) {
          if (text.includes(pattern) || href.includes(pattern)) {
            return {
              found: true,
              url: link.href,
              text: link.textContent.trim()
            };
          }
        }
      }

      return { found: false };
    });

    if (!contactLinkResult.found) {
      return {
        found: false,
        emailContact: false,
        phoneContact: false,
        onlineForm: false,
        responseTime: false,
        accessible: false
      };
    }

    // Navigate to contact page
    try {
      await page.goto(contactLinkResult.url, { waitUntil: 'networkidle0', timeout: options.timeout });
      console.log(`  Found contact page at: ${contactLinkResult.url}`);

      // Analyze contact page
      const contactPageAnalysis = await this.analyzePageContactMechanisms(page);

      return {
        found: true,
        emailContact: contactPageAnalysis.emailContact,
        phoneContact: contactPageAnalysis.phoneContact,
        onlineForm: contactPageAnalysis.onlineForm,
        responseTime: contactPageAnalysis.responseTime,
        accessible: true
      };

    } catch (error) {
      console.log(`  Contact page not accessible: ${error.message}`);
      return {
        found: true,
        emailContact: false,
        phoneContact: false,
        onlineForm: false,
        responseTime: false,
        accessible: false
      };
    }
  }

  /**
   * Validate email contacts
   */
  async validateEmailContacts(page) {
    const validation = await page.evaluate(() => {
      // Find email addresses and mailto links
      const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const pageText = document.body.textContent;
      const emailMatches = pageText.match(emailPattern);
      const emailLinks = document.querySelectorAll('a[href^="mailto:"]');

      // Basic validation
      if (emailMatches) {
        for (const email of emailMatches) {
          // Check if email looks valid
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email)) {
            return {
              valid: false,
              reason: `Invalid email format: ${email}`,
              element: 'text content'
            };
          }
        }
      }

      if (emailLinks.length > 0) {
        for (const link of emailLinks) {
          const href = link.getAttribute('href');
          const email = href.replace('mailto:', '');
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

          if (!emailRegex.test(email)) {
            const selector = link.id ? `a#${link.id}` :
                           link.className ? `a.${link.className.split(' ')[0]}` :
                           'a[href^="mailto:"]';
            return {
              valid: false,
              reason: `Invalid mailto link: ${href}`,
              element: selector
            };
          }
        }
      }

      return { valid: true };
    });

    return validation;
  }

  /**
   * Validate phone contacts
   */
  async validatePhoneContacts(page) {
    const validation = await page.evaluate(() => {
      const phoneLinks = document.querySelectorAll('a[href^="tel:"]');

      if (phoneLinks.length > 0) {
        for (const link of phoneLinks) {
          const href = link.getAttribute('href');
          const phone = href.replace('tel:', '');

          // Basic phone validation - should contain only numbers, spaces, +, -, ()
          const phoneRegex = /^[\+]?[0-9\s\-()]+$/;
          if (!phoneRegex.test(phone) || phone.replace(/[^0-9]/g, '').length < 7) {
            const selector = link.id ? `a#${link.id}` :
                           link.className ? `a.${link.className.split(' ')[0]}` :
                           'a[href^="tel:"]';
            return {
              valid: false,
              reason: `Invalid phone format: ${href}`,
              element: selector
            };
          }
        }
      }

      return { valid: true };
    });

    return validation;
  }

  get needsExclusiveAccess() {
    return true;
  }

}

module.exports = ContactMechanismScanner;
