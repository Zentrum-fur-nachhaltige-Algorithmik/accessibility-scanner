/**
 * Improved Use of Color Scanner for Phase6a
 * 
 * Fixes identified issues:
 * - Over-sensitive link detection
 * - Poor status message recognition
 * - Inadequate pattern matching
 * - Missing context awareness
 * 
 * EN 301 549 criterion: 9.1.4.1 (Use of Color)
 */

class ImprovedUseOfColorScanner {
    constructor(config = {}) {
        this.config = {
            sensitivity: config.sensitivity || 'medium', // 'low', 'medium', 'high'
            requireMultipleIndicators: config.requireMultipleIndicators !== false,
            linkRequirements: {
                requireUnderlineOrBorder: config.linkRequirements?.requireUnderlineOrBorder !== false,
                allowFontWeightDifference: config.linkRequirements?.allowFontWeightDifference !== false,
                allowIconIndicators: config.linkRequirements?.allowIconIndicators !== false,
                allowAriaLabels: config.linkRequirements?.allowAriaLabels !== false
            },
            statusMessageRequirements: {
                requireTextOrIcon: config.statusMessageRequirements?.requireTextOrIcon !== false,
                allowSemanticMarkup: config.statusMessageRequirements?.allowSemanticMarkup !== false,
                allowBorderIndicators: config.statusMessageRequirements?.allowBorderIndicators !== false
            },
            formRequirements: {
                requireTextLabels: config.formRequirements?.requireTextLabels !== false,
                allowAriaDescriptions: config.formRequirements?.allowAriaDescriptions !== false
            },
            excludeSelectors: config.excludeSelectors || [
                '[aria-hidden="true"]',
                '.sr-only',
                '.visually-hidden'
            ],
            debugging: config.debugging || false
        };
    }

    /**
     * IMPROVED: Smart link differentiation analysis
     */
    analyzeLinkDifferentiation(link) {
        const linkStyle = window.getComputedStyle(link);
        const parentStyle = window.getComputedStyle(link.parentElement);
        
        const indicators = {
            // Visual indicators (non-color)
            hasUnderline: this.hasTextDecoration(linkStyle, 'underline'),
            hasBorder: this.hasVisibleBorder(linkStyle),
            hasBackground: this.hasDistinctBackground(linkStyle, parentStyle),
            hasFontWeight: this.hasFontWeightDifference(linkStyle, parentStyle),
            hasFontStyle: linkStyle.fontStyle !== parentStyle.fontStyle,
            hasTransform: linkStyle.textTransform !== parentStyle.textTransform,
            
            // Semantic indicators
            hasIcon: this.hasIcon(link),
            hasAriaLabel: this.hasAriaLabel(link),
            hasTitle: link.hasAttribute('title') && link.getAttribute('title').trim(),
            
            // Context indicators
            isInNavigation: this.isInNavigationContext(link),
            isButton: link.hasAttribute('role') && link.getAttribute('role') === 'button',
            
            // Color indicators
            hasColorDifference: this.hasColorDifference(linkStyle, parentStyle),
            colorContrast: this.calculateColorContrast(linkStyle.color, parentStyle.color)
        };
        
        // Focus/hover state analysis
        indicators.hasFocusStyle = this.hasFocusStyle(link);
        indicators.hasHoverStyle = this.hasHoverStyle(link);
        
        return this.evaluateLinkDifferentiation(indicators, link);
    }

    /**
     * NEW: Check for text decoration with inheritance
     */
    hasTextDecoration(style, type) {
        const decoration = style.textDecoration || style.textDecorationLine;
        return decoration && decoration.includes(type);
    }

    /**
     * NEW: Check for visible borders
     */
    hasVisibleBorder(style) {
        const borderWidth = parseFloat(style.borderWidth) || 
                           parseFloat(style.borderTopWidth) ||
                           parseFloat(style.borderBottomWidth) ||
                           parseFloat(style.borderLeftWidth) ||
                           parseFloat(style.borderRightWidth);
        
        const borderStyle = style.borderStyle || style.borderTopStyle;
        
        return borderWidth > 0 && borderStyle && borderStyle !== 'none';
    }

    /**
     * NEW: Check for distinct background
     */
    hasDistinctBackground(linkStyle, parentStyle) {
        const linkBg = linkStyle.backgroundColor;
        const parentBg = parentStyle.backgroundColor;
        
        if (linkBg === parentBg || linkBg === 'transparent') {
            return false;
        }
        
        // Parse colors and check for meaningful difference
        const linkColor = this.parseColor(linkBg);
        const parentColor = this.parseColor(parentBg);
        
        if (!linkColor || !parentColor) return false;
        
        return this.calculateColorContrast(linkBg, parentBg) > 1.5;
    }

    /**
     * NEW: Check for font weight difference
     */
    hasFontWeightDifference(linkStyle, parentStyle) {
        const linkWeight = this.normalizeFontWeight(linkStyle.fontWeight);
        const parentWeight = this.normalizeFontWeight(parentStyle.fontWeight);
        
        return Math.abs(linkWeight - parentWeight) >= 200; // Meaningful difference
    }

    /**
     * NEW: Check for icons in links
     */
    hasIcon(link) {
        // Check for icon elements
        const iconSelectors = [
            'svg',
            'img',
            '[class*="icon"]',
            '[class*="fa-"]', // Font Awesome
            '[class*="material-icons"]', // Material Icons
            'i[class]' // Generic icon elements
        ];
        
        for (const selector of iconSelectors) {
            if (link.querySelector(selector)) {
                return true;
            }
        }
        
        // Check for Unicode icons in text content
        const unicodeIcons = /[\\u2190-\\u21FF\\u2600-\\u26FF\\u2700-\\u27BF\\uE000-\\uF8FF]/;
        return unicodeIcons.test(link.textContent);
    }

    /**
     * NEW: Check for meaningful aria labels
     */
    hasAriaLabel(link) {
        const ariaLabel = link.getAttribute('aria-label');
        const ariaLabelledBy = link.getAttribute('aria-labelledby');
        
        if (ariaLabel && ariaLabel.trim() && ariaLabel.trim() !== link.textContent.trim()) {
            return true;
        }
        
        if (ariaLabelledBy) {
            const labelElement = document.getElementById(ariaLabelledBy);
            if (labelElement && labelElement.textContent.trim()) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * NEW: Check if link is in navigation context
     */
    isInNavigationContext(link) {
        const navigationSelectors = [
            'nav',
            '[role="navigation"]',
            '[class*="nav"]',
            '[class*="menu"]',
            'header',
            '[role="banner"]'
        ];
        
        for (const selector of navigationSelectors) {
            if (link.closest(selector)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * NEW: Check for focus styling
     */
    hasFocusStyle(link) {
        // This is simplified - in practice, we'd need to simulate focus
        const style = window.getComputedStyle(link, ':focus');
        return style.outline !== 'none' || 
               style.outlineWidth !== '0px' ||
               style.boxShadow !== 'none';
    }

    /**
     * NEW: Check for hover styling  
     */
    hasHoverStyle(link) {
        // This is simplified - in practice, we'd need to simulate hover
        const style = window.getComputedStyle(link, ':hover');
        const normalStyle = window.getComputedStyle(link);
        
        return style.textDecoration !== normalStyle.textDecoration ||
               style.backgroundColor !== normalStyle.backgroundColor ||
               style.color !== normalStyle.color;
    }

    /**
     * IMPROVED: Evaluate link differentiation with configurable rules
     */
    evaluateLinkDifferentiation(indicators, link) {
        const nonColorIndicators = [
            indicators.hasUnderline,
            indicators.hasBorder,
            indicators.hasBackground,
            indicators.hasFontWeight,
            indicators.hasFontStyle,
            indicators.hasTransform,
            indicators.hasIcon,
            indicators.hasAriaLabel,
            indicators.hasTitle,
            indicators.hasFocusStyle,
            indicators.hasHoverStyle
        ].filter(Boolean).length;
        
        const contextualIndicators = [
            indicators.isInNavigation,
            indicators.isButton
        ].filter(Boolean).length;
        
        // Determine if link is properly differentiated
        let isViolation = false;
        let confidence = 'low';
        let reasoning = [];
        
        // If no color difference, not a color-only issue
        if (!indicators.hasColorDifference) {
            return {
                isViolation: false,
                confidence: 'high',
                reasoning: ['No color differentiation used'],
                indicators: indicators
            };
        }
        
        // Evaluate based on configuration
        if (this.config.requireMultipleIndicators) {
            if (nonColorIndicators === 0) {
                isViolation = true;
                confidence = 'high';
                reasoning.push('Color is the only differentiating factor');
            } else if (nonColorIndicators === 1 && contextualIndicators === 0) {
                isViolation = this.config.sensitivity === 'high';
                confidence = 'medium';
                reasoning.push('Only one non-color indicator present');
            }
        }
        
        // Special rules for navigation links
        if (indicators.isInNavigation && nonColorIndicators > 0) {
            isViolation = false;
            reasoning.push('Navigation context with additional indicators');
        }
        
        // Special handling for underlines
        if (indicators.hasUnderline && this.config.linkRequirements.requireUnderlineOrBorder) {
            isViolation = false;
            reasoning.push('Traditional underline present');
        }
        
        return {
            isViolation: isViolation,
            confidence: confidence,
            reasoning: reasoning,
            indicators: indicators,
            nonColorIndicatorCount: nonColorIndicators
        };
    }

    /**
     * IMPROVED: Status message analysis with better heuristics
     */
    analyzeStatusMessage(element) {
        const style = window.getComputedStyle(element);
        const text = element.textContent.toLowerCase().trim();
        const className = element.className.toLowerCase();
        
        const indicators = {
            // Text-based indicators
            hasSuccessText: /\\b(success|successful|complete|done|saved|created)\\b/i.test(text),
            hasErrorText: /\\b(error|failed|invalid|incorrect|wrong|missing)\\b/i.test(text),
            hasWarningText: /\\b(warning|caution|attention|notice|important)\\b/i.test(text),
            hasInfoText: /\\b(info|information|note|tip|help)\\b/i.test(text),
            
            // Icon indicators
            hasTextIcon: /[✓✗⚠❌✅⛔📝ℹ️]/g.test(element.textContent),
            hasIconElement: element.querySelector('svg, img, [class*="icon"]') !== null,
            
            // Semantic indicators
            hasAriaRole: ['alert', 'status', 'log', 'marquee'].includes(element.getAttribute('role')),
            hasSemanticClass: /\\b(alert|notification|message|status|error|warning|success|info)\\b/i.test(className),
            hasAriaLive: element.hasAttribute('aria-live'),
            hasAriaAtomic: element.hasAttribute('aria-atomic'),
            
            // Visual indicators (non-color)
            hasBorder: this.hasVisibleBorder(style),
            hasDistinctPadding: this.hasDistinctPadding(element, style),
            hasDistinctMargin: this.hasDistinctMargin(element, style),
            hasShadow: style.boxShadow && style.boxShadow !== 'none',
            
            // Color indicators
            hasBackgroundColor: this.hasDistinctBackgroundColor(element, style),
            hasTextColor: this.hasDistinctTextColor(element, style)
        };
        
        return this.evaluateStatusMessage(indicators, element);
    }

    /**
     * NEW: Check for distinct padding patterns
     */
    hasDistinctPadding(element, style) {
        const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
                       parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        
        // Compare with parent padding
        const parentStyle = window.getComputedStyle(element.parentElement);
        const parentPadding = parseFloat(parentStyle.paddingTop) + parseFloat(parentStyle.paddingBottom) +
                             parseFloat(parentStyle.paddingLeft) + parseFloat(parentStyle.paddingRight);
        
        return Math.abs(padding - parentPadding) > 10; // 10px difference threshold
    }

    /**
     * NEW: Check for distinct margin patterns
     */
    hasDistinctMargin(element, style) {
        const margin = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
        return margin > 10; // Distinct vertical spacing
    }

    /**
     * IMPROVED: Evaluate status message with comprehensive logic
     */
    evaluateStatusMessage(indicators, element) {
        const textBasedIndicators = [
            indicators.hasSuccessText,
            indicators.hasErrorText,
            indicators.hasWarningText,
            indicators.hasInfoText
        ].filter(Boolean).length;
        
        const iconIndicators = [
            indicators.hasTextIcon,
            indicators.hasIconElement
        ].filter(Boolean).length;
        
        const semanticIndicators = [
            indicators.hasAriaRole,
            indicators.hasSemanticClass,
            indicators.hasAriaLive,
            indicators.hasAriaAtomic
        ].filter(Boolean).length;
        
        const visualIndicators = [
            indicators.hasBorder,
            indicators.hasDistinctPadding,
            indicators.hasDistinctMargin,
            indicators.hasShadow
        ].filter(Boolean).length;
        
        const colorIndicators = [
            indicators.hasBackgroundColor,
            indicators.hasTextColor
        ].filter(Boolean).length;
        
        const totalNonColorIndicators = textBasedIndicators + iconIndicators + 
                                       semanticIndicators + visualIndicators;
        
        let isViolation = false;
        let confidence = 'low';
        let reasoning = [];
        
        // If no color-based status indication, not a violation
        if (colorIndicators === 0) {
            return {
                isViolation: false,
                confidence: 'high',
                reasoning: ['No color-based status indication detected'],
                indicators: indicators
            };
        }
        
        // Evaluate based on non-color indicators
        if (totalNonColorIndicators === 0) {
            isViolation = true;
            confidence = 'high';
            reasoning.push('Status communicated only through color');
        } else {
            // Check quality of non-color indicators
            if (textBasedIndicators > 0 || iconIndicators > 0) {
                isViolation = false;
                confidence = 'high';
                reasoning.push('Clear text or icon indicators present');
            } else if (semanticIndicators > 0) {
                isViolation = false;
                confidence = 'medium';
                reasoning.push('Semantic markup provides programmatic indication');
            } else if (visualIndicators > 1) {
                isViolation = false;
                confidence = 'medium';
                reasoning.push('Multiple visual indicators beyond color');
            } else {
                isViolation = true;
                confidence = 'medium';
                reasoning.push('Weak non-color indicators');
            }
        }
        
        return {
            isViolation: isViolation,
            confidence: confidence,
            reasoning: reasoning,
            indicators: indicators,
            nonColorIndicatorCount: totalNonColorIndicators
        };
    }

    /**
     * IMPROVED: Form error analysis
     */
    analyzeFormError(element) {
        const style = window.getComputedStyle(element);
        const text = element.textContent.toLowerCase().trim();
        
        const indicators = {
            // Error text patterns
            hasErrorKeyword: /\\b(error|fehler|invalid|ungültig|required|erforderlich|missing|fehlt)\\b/i.test(text),
            hasErrorPunctuation: /[!⚠]/.test(element.textContent),
            
            // Semantic associations
            hasAriaDescribedBy: this.isAriaDescribedBy(element),
            hasErrorRole: element.getAttribute('role') === 'alert',
            hasErrorClass: /\\b(error|invalid|required)\\b/i.test(element.className),
            
            // Visual indicators
            hasErrorIcon: /[✗❌⚠]/.test(element.textContent),
            hasIconElement: element.querySelector('[class*="error"], [class*="warning"], svg') !== null,
            hasBorder: this.hasVisibleBorder(style),
            
            // Color indicators
            hasRedColor: this.isRedishColor(style.color),
            hasRedBackground: this.isRedishColor(style.backgroundColor)
        };
        
        const nonColorIndicators = [
            indicators.hasErrorKeyword,
            indicators.hasErrorPunctuation,
            indicators.hasAriaDescribedBy,
            indicators.hasErrorRole,
            indicators.hasErrorClass,
            indicators.hasErrorIcon,
            indicators.hasIconElement,
            indicators.hasBorder
        ].filter(Boolean).length;
        
        const isColorOnly = (indicators.hasRedColor || indicators.hasRedBackground) && 
                           nonColorIndicators === 0;
        
        return {
            isViolation: isColorOnly,
            confidence: isColorOnly ? 'high' : 'low',
            reasoning: isColorOnly ? ['Error indication relies solely on red color'] : 
                       ['Adequate non-color error indicators present'],
            indicators: indicators,
            nonColorIndicatorCount: nonColorIndicators
        };
    }

    /**
     * MAIN SCAN FUNCTION
     */
    async scanColorDependency(page) {
        const results = {
            criterion: '9.1.4.1',
            passed: true,
            violations: [],
            summary: {
                linksChecked: 0,
                statusMessagesChecked: 0,
                formErrorsChecked: 0,
                linksColorOnly: 0,
                statusColorOnly: 0,
                formErrorsColorOnly: 0
            },
            performance: {
                startTime: Date.now(),
                endTime: null,
                duration: null
            }
        };
        
        try {
            await page.evaluate((config) => {
                window.__phase6aUseOfColorScanner = new ImprovedUseOfColorScanner(config);
            }, this.config);
            
            const violations = await page.evaluate(() => {
                const scanner = window.__phase6aUseOfColorScanner;
                const violations = [];
                let stats = {
                    linksChecked: 0,
                    statusMessagesChecked: 0,
                    formErrorsChecked: 0,
                    linksColorOnly: 0,
                    statusColorOnly: 0,
                    formErrorsColorOnly: 0
                };
                
                // Analyze links
                document.querySelectorAll('a[href]').forEach(link => {
                    if (scanner.isRelevantElement(link)) {
                        stats.linksChecked++;
                        const analysis = scanner.analyzeLinkDifferentiation(link);
                        
                        if (analysis.isViolation) {
                            stats.linksColorOnly++;
                            violations.push({
                                type: 'link-color-only',
                                element: scanner.getElementSelector(link),
                                issue: 'Link differentiated only by color',
                                text: link.textContent.trim().substring(0, 50),
                                confidence: analysis.confidence,
                                reasoning: analysis.reasoning,
                                indicators: analysis.indicators,
                                href: link.href
                            });
                        }
                    }
                });
                
                // Analyze status messages
                const statusSelectors = [
                    '[class*="status"]',
                    '[class*="message"]', 
                    '[class*="alert"]',
                    '[class*="notification"]',
                    '[role="alert"]',
                    '[role="status"]',
                    '.error',
                    '.warning',
                    '.success',
                    '.info'
                ];
                
                statusSelectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(element => {
                        if (scanner.isRelevantElement(element)) {
                            stats.statusMessagesChecked++;
                            const analysis = scanner.analyzeStatusMessage(element);
                            
                            if (analysis.isViolation) {
                                stats.statusColorOnly++;
                                violations.push({
                                    type: 'status-color-only',
                                    element: scanner.getElementSelector(element),
                                    issue: 'Status indicated only by color',
                                    text: element.textContent.trim().substring(0, 50),
                                    confidence: analysis.confidence,
                                    reasoning: analysis.reasoning,
                                    indicators: analysis.indicators
                                });
                            }
                        }
                    });
                });
                
                // Analyze form errors
                const errorSelectors = [
                    '[class*="error"]',
                    '[aria-invalid="true"] + *',
                    'input[aria-invalid="true"] ~ *',
                    '.form-error',
                    '.field-error',
                    '.validation-error'
                ];
                
                errorSelectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(element => {
                        if (scanner.isRelevantElement(element) && element.textContent.trim()) {
                            stats.formErrorsChecked++;
                            const analysis = scanner.analyzeFormError(element);
                            
                            if (analysis.isViolation) {
                                stats.formErrorsColorOnly++;
                                violations.push({
                                    type: 'form-error-color-only',
                                    element: scanner.getElementSelector(element),
                                    issue: 'Form error indicated only by color',
                                    text: element.textContent.trim().substring(0, 50),
                                    confidence: analysis.confidence,
                                    reasoning: analysis.reasoning,
                                    indicators: analysis.indicators
                                });
                            }
                        }
                    });
                });
                
                return { violations, stats };
            });
            
            results.violations = violations.violations;
            results.summary = violations.stats;
            results.passed = violations.violations.length === 0;
            
        } catch (error) {
            throw new Error(`Use of color scan failed: ${error.message}`);
        } finally {
            results.performance.endTime = Date.now();
            results.performance.duration = results.performance.endTime - results.performance.startTime;
        }
        
        return results;
    }

    /**
     * UTILITY FUNCTIONS
     */
    isRelevantElement(element) {
        if (element.offsetWidth === 0 || element.offsetHeight === 0) return false;
        if (element.getAttribute('aria-hidden') === 'true') return false;
        
        for (const selector of this.config.excludeSelectors) {
            if (element.matches(selector)) return false;
        }
        
        const style = window.getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        
        return true;
    }

    parseColor(colorString) {
        // Same implementation as in ColorContrastScanner
        if (!colorString || colorString === 'transparent') return null;
        
        const rgbaMatch = colorString.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
        if (rgbaMatch) {
            return {
                r: parseInt(rgbaMatch[1]),
                g: parseInt(rgbaMatch[2]),
                b: parseInt(rgbaMatch[3]),
                a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1
            };
        }
        
        return null;
    }

    calculateColorContrast(color1, color2) {
        const c1 = this.parseColor(color1);
        const c2 = this.parseColor(color2);
        
        if (!c1 || !c2) return 1;
        
        const l1 = this.getRelativeLuminance(c1);
        const l2 = this.getRelativeLuminance(c2);
        
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        
        return (lighter + 0.05) / (darker + 0.05);
    }

    getRelativeLuminance(color) {
        const rsRGB = color.r / 255;
        const gsRGB = color.g / 255;
        const bsRGB = color.b / 255;
        
        const r = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
        const g = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
        const b = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
        
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    normalizeFontWeight(fontWeight) {
        const weights = {
            'normal': 400,
            'bold': 700,
            'lighter': 300,
            'bolder': 700
        };
        
        return weights[fontWeight] || parseInt(fontWeight) || 400;
    }

    hasColorDifference(style1, style2) {
        return style1.color !== style2.color;
    }

    hasDistinctBackgroundColor(element, style) {
        const parent = element.parentElement;
        if (!parent) return false;
        
        const parentStyle = window.getComputedStyle(parent);
        return style.backgroundColor !== parentStyle.backgroundColor &&
               style.backgroundColor !== 'transparent';
    }

    hasDistinctTextColor(element, style) {
        const parent = element.parentElement;
        if (!parent) return false;
        
        const parentStyle = window.getComputedStyle(parent);
        return style.color !== parentStyle.color;
    }

    isRedishColor(color) {
        const parsed = this.parseColor(color);
        if (!parsed) return false;
        
        // Check if red component is significantly higher than green and blue
        return parsed.r > 150 && parsed.r > parsed.g + 50 && parsed.r > parsed.b + 50;
    }

    isAriaDescribedBy(element) {
        const describedBy = element.getAttribute('aria-describedby');
        if (!describedBy) return false;
        
        const describingElement = document.getElementById(describedBy);
        return describingElement && describingElement.textContent.trim();
    }

    getElementSelector(element) {
        // Same implementation as ColorContrastScanner
        if (element.id) return `#${element.id}`;
        
        if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\\s+/).slice(0, 3);
            if (classes.length > 0) {
                return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
            }
        }
        
        return element.tagName.toLowerCase();
    }
}

module.exports = ImprovedUseOfColorScanner;