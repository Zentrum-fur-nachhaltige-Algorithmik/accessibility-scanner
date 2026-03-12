/**
 * Improved Color Contrast Scanner for Phase6a
 * 
 * Fixes identified issues:
 * - Background color inheritance bugs
 * - Element filtering problems  
 * - Hardcoded thresholds
 * - Poor CSS parsing
 * 
 * EN 301 549 criterion: 9.1.4.3 (Contrast Minimum)
 */

class ImprovedColorContrastScanner {
    constructor(config = {}) {
        this.config = {
            wcagLevel: config.wcagLevel || 'AA',
            thresholds: {
                normal: config.thresholds?.normal || 4.5,
                large: config.thresholds?.large || 3.0,
                nonText: config.thresholds?.nonText || 3.0
            },
            largeText: {
                fontSize: config.largeText?.fontSize || 18,
                fontWeightBold: config.largeText?.fontWeightBold || 14
            },
            tolerances: {
                rounding: config.tolerances?.rounding || 0.1,
                measurement: config.tolerances?.measurement || 0.05
            },
            excludeSelectors: config.excludeSelectors || [
                '[aria-hidden="true"]',
                '.sr-only',
                '.visually-hidden',
                '.screen-reader-text'
            ],
            debugging: config.debugging || false
        };
    }

    /**
     * FIXED: Proper background color inheritance with alpha blending
     */
    getEffectiveBackgroundColor(element) {
        const debug = [];
        const backgroundStack = [];
        let currentElement = element;
        
        while (currentElement && currentElement !== document.documentElement) {
            const style = window.getComputedStyle(currentElement);
            const bgColor = style.backgroundColor;
            const bgImage = style.backgroundImage;
            
            if (this.config.debugging) {
                debug.push({
                    element: this.getElementSelector(currentElement),
                    backgroundColor: bgColor,
                    backgroundImage: bgImage
                });
            }
            
            // Handle background color
            if (bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)') {
                const rgba = this.parseColor(bgColor);
                if (rgba) {
                    backgroundStack.push({
                        color: rgba,
                        element: currentElement.tagName,
                        zIndex: this.getStackingOrder(currentElement)
                    });
                    
                    // If we have a fully opaque color, we can stop
                    if (rgba.a >= 1) {
                        break;
                    }
                }
            }
            
            // Handle background gradients (simplified - get average color)
            if (bgImage && bgImage.includes('gradient')) {
                const gradientColor = this.extractGradientAverageColor(bgImage);
                if (gradientColor) {
                    backgroundStack.push({
                        color: gradientColor,
                        element: currentElement.tagName + ' (gradient)',
                        zIndex: this.getStackingOrder(currentElement)
                    });
                }
            }
            
            currentElement = currentElement.parentElement;
        }
        
        // Add default white background if no opaque background found
        if (backgroundStack.length === 0 || backgroundStack[backgroundStack.length - 1].color.a < 1) {
            backgroundStack.push({
                color: { r: 255, g: 255, b: 255, a: 1 },
                element: 'default',
                zIndex: -1
            });
        }
        
        // Blend colors from bottom to top
        const finalColor = this.blendColors(backgroundStack.map(bg => bg.color));
        
        return {
            color: finalColor,
            stack: backgroundStack,
            debug: this.config.debugging ? debug : undefined
        };
    }

    /**
     * FIXED: Proper alpha blending algorithm
     */
    blendColors(colors) {
        if (colors.length === 0) {
            return { r: 255, g: 255, b: 255, a: 1 }; // Default white
        }
        
        if (colors.length === 1) {
            return colors[0];
        }
        
        // Start with the bottom color
        let result = { ...colors[colors.length - 1] };
        
        // Blend each color on top
        for (let i = colors.length - 2; i >= 0; i--) {
            const top = colors[i];
            const alpha = top.a;
            const invAlpha = 1 - alpha;
            
            result = {
                r: Math.round(top.r * alpha + result.r * invAlpha),
                g: Math.round(top.g * alpha + result.g * invAlpha),
                b: Math.round(top.b * alpha + result.b * invAlpha),
                a: alpha + result.a * invAlpha
            };
        }
        
        return result;
    }

    /**
     * FIXED: Comprehensive element filtering
     */
    isRelevantTextElement(element) {
        // Skip elements with no dimensions
        if (element.offsetWidth === 0 || element.offsetHeight === 0) {
            return false;
        }
        
        // Skip aria-hidden elements
        if (element.getAttribute('aria-hidden') === 'true') {
            return false;
        }
        
        // Skip elements matched by exclude selectors
        for (const selector of this.config.excludeSelectors) {
            if (element.matches(selector)) {
                return false;
            }
        }
        
        // Skip elements with no visible text content
        const text = element.textContent.trim();
        if (!text || text.length === 0) {
            return false;
        }
        
        // Skip pseudo-content only elements
        if (this.isPseudoContentOnly(element)) {
            return false;
        }
        
        // Check computed visibility
        const style = window.getComputedStyle(element);
        if (style.visibility === 'hidden' || 
            style.display === 'none' || 
            parseFloat(style.opacity) === 0) {
            return false;
        }
        
        // Skip elements that are positioned off-screen
        if (this.isPositionedOffScreen(element, style)) {
            return false;
        }
        
        // Skip decorative elements
        if (this.isDecorativeElement(element)) {
            return false;
        }
        
        return true;
    }

    /**
     * NEW: Check if element contains only pseudo-content
     */
    isPseudoContentOnly(element) {
        // Check if element has text content beyond pseudo-elements
        const textNodes = Array.from(element.childNodes).filter(
            node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
        );
        
        const textElements = Array.from(element.children).filter(
            child => child.textContent.trim() && 
            !this.isPseudoContentOnly(child)
        );
        
        return textNodes.length === 0 && textElements.length === 0;
    }

    /**
     * NEW: Check if element is positioned off-screen
     */
    isPositionedOffScreen(element, style) {
        const rect = element.getBoundingClientRect();
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };
        
        // Common off-screen positioning techniques
        if (style.position === 'absolute' || style.position === 'fixed') {
            if (rect.right < 0 || 
                rect.bottom < 0 || 
                rect.left > viewport.width || 
                rect.top > viewport.height) {
                return true;
            }
        }
        
        // Negative margins that push content off-screen
        if (parseInt(style.marginLeft) < -9999 || 
            parseInt(style.marginTop) < -9999) {
            return true;
        }
        
        return false;
    }

    /**
     * NEW: Check if element is decorative
     */
    isDecorativeElement(element) {
        const decorativeRoles = ['presentation', 'none'];
        const role = element.getAttribute('role');
        
        if (decorativeRoles.includes(role)) {
            return true;
        }
        
        // Check for decorative class names
        const decorativeClasses = /\b(decoration|ornament|divider|spacer|bullet)\b/i;
        if (decorativeClasses.test(element.className)) {
            return true;
        }
        
        return false;
    }

    /**
     * IMPROVED: Better color parsing with error handling
     */
    parseColor(colorString) {
        if (!colorString || colorString === 'transparent') {
            return null;
        }
        
        // Handle rgb/rgba
        const rgbaMatch = colorString.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
        if (rgbaMatch) {
            return {
                r: parseInt(rgbaMatch[1]),
                g: parseInt(rgbaMatch[2]),
                b: parseInt(rgbaMatch[3]),
                a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1
            };
        }
        
        // Handle hex colors
        const hexMatch = colorString.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hexMatch) {
            const hex = hexMatch[1];
            if (hex.length === 3) {
                return {
                    r: parseInt(hex[0] + hex[0], 16),
                    g: parseInt(hex[1] + hex[1], 16),
                    b: parseInt(hex[2] + hex[2], 16),
                    a: 1
                };
            } else {
                return {
                    r: parseInt(hex.slice(0, 2), 16),
                    g: parseInt(hex.slice(2, 4), 16),
                    b: parseInt(hex.slice(4, 6), 16),
                    a: 1
                };
            }
        }
        
        // Handle named colors (basic set)
        const namedColors = {
            'black': { r: 0, g: 0, b: 0, a: 1 },
            'white': { r: 255, g: 255, b: 255, a: 1 },
            'red': { r: 255, g: 0, b: 0, a: 1 },
            'green': { r: 0, g: 128, b: 0, a: 1 },
            'blue': { r: 0, g: 0, b: 255, a: 1 }
            // Add more as needed
        };
        
        return namedColors[colorString.toLowerCase()] || null;
    }

    /**
     * IMPROVED: More accurate large text detection
     */
    isLargeText(element) {
        const style = window.getComputedStyle(element);
        const fontSize = parseFloat(style.fontSize);
        const fontWeight = style.fontWeight;
        
        // Convert font-weight to numeric if needed
        const numericWeight = this.normalizeFontWeight(fontWeight);
        
        // WCAG 2.2 large text criteria:
        // - 18pt (24px) or larger
        // - 14pt (18.66px) or larger AND bold (700+)
        if (fontSize >= 24) {
            return true;
        }
        
        if (fontSize >= 18.66 && numericWeight >= 700) {
            return true;
        }
        
        // Custom thresholds from config
        if (fontSize >= this.config.largeText.fontSize) {
            return true;
        }
        
        if (fontSize >= this.config.largeText.fontWeightBold && numericWeight >= 700) {
            return true;
        }
        
        return false;
    }

    /**
     * NEW: Normalize font-weight to numeric value
     */
    normalizeFontWeight(fontWeight) {
        const weights = {
            'normal': 400,
            'bold': 700,
            'lighter': 300,
            'bolder': 700
        };
        
        return weights[fontWeight] || parseInt(fontWeight) || 400;
    }

    /**
     * IMPROVED: Enhanced contrast ratio calculation with proper luminance
     */
    calculateContrastRatio(color1, color2) {
        const luminance1 = this.getRelativeLuminance(color1);
        const luminance2 = this.getRelativeLuminance(color2);
        
        const lighter = Math.max(luminance1, luminance2);
        const darker = Math.min(luminance1, luminance2);
        
        const ratio = (lighter + 0.05) / (darker + 0.05);
        
        // Apply rounding tolerance
        return Math.round(ratio * 100) / 100;
    }

    /**
     * ACCURATE: WCAG 2.2 relative luminance calculation
     */
    getRelativeLuminance(color) {
        const rsRGB = color.r / 255;
        const gsRGB = color.g / 255;
        const bsRGB = color.b / 255;
        
        const r = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
        const g = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
        const b = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
        
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    /**
     * MAIN SCAN FUNCTION - Improved logic
     */
    async scanColorContrast(page) {
        const results = {
            criterion: '9.1.4.3',
            passed: true,
            violations: [],
            summary: {
                totalElements: 0,
                checkedElements: 0,
                minimumRatio: this.config.thresholds.normal,
                averageRatio: 0
            },
            performance: {
                startTime: Date.now(),
                endTime: null,
                duration: null
            }
        };
        
        try {
            await page.evaluate((config) => {
                // Inject improved scanner into page context
                window.__phase6aColorContrastScanner = new ImprovedColorContrastScanner(config);
            }, this.config);
            
            const violations = await page.evaluate(() => {
                const scanner = window.__phase6aColorContrastScanner;
                const violations = [];
                const allElements = document.querySelectorAll('*');
                let checkedCount = 0;
                let totalRatio = 0;
                
                allElements.forEach(element => {
                    // Skip non-text elements
                    if (!element.textContent.trim()) return;
                    
                    // Apply improved filtering
                    if (!scanner.isRelevantTextElement(element)) return;
                    
                    checkedCount++;
                    
                    // Get foreground color
                    const style = window.getComputedStyle(element);
                    const foregroundColor = scanner.parseColor(style.color);
                    
                    if (!foregroundColor) return;
                    
                    // Get effective background color
                    const backgroundAnalysis = scanner.getEffectiveBackgroundColor(element);
                    const backgroundColor = backgroundAnalysis.color;
                    
                    // Calculate contrast ratio
                    const contrastRatio = scanner.calculateContrastRatio(foregroundColor, backgroundColor);
                    totalRatio += contrastRatio;
                    
                    // Determine required threshold
                    const isLarge = scanner.isLargeText(element);
                    const requiredRatio = isLarge ? scanner.config.thresholds.large : scanner.config.thresholds.normal;
                    
                    // Check if violation exists (with tolerance)
                    if (contrastRatio < (requiredRatio - scanner.config.tolerances.rounding)) {
                        violations.push({
                            element: scanner.getElementSelector(element),
                            tagName: element.tagName.toLowerCase(),
                            textContent: element.textContent.trim().substring(0, 100),
                            contrastRatio: contrastRatio,
                            requiredRatio: requiredRatio,
                            isLargeText: isLarge,
                            foregroundColor: `rgb(${foregroundColor.r}, ${foregroundColor.g}, ${foregroundColor.b})`,
                            backgroundColor: `rgb(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b})`,
                            backgroundStack: backgroundAnalysis.stack,
                            fontSize: style.fontSize,
                            fontWeight: style.fontWeight,
                            confidence: contrastRatio < (requiredRatio * 0.8) ? 'high' : 'medium',
                            wcagLevel: scanner.config.wcagLevel,
                            debug: backgroundAnalysis.debug
                        });
                    }
                });
                
                return {
                    violations: violations,
                    stats: {
                        totalElements: allElements.length,
                        checkedElements: checkedCount,
                        averageRatio: checkedCount > 0 ? totalRatio / checkedCount : 0
                    }
                };
            });
            
            results.violations = violations.violations;
            results.summary.totalElements = violations.stats.totalElements;
            results.summary.checkedElements = violations.stats.checkedElements;
            results.summary.averageRatio = Math.round(violations.stats.averageRatio * 100) / 100;
            results.passed = violations.violations.length === 0;
            
        } catch (error) {
            throw new Error(`Color contrast scan failed: ${error.message}`);
        } finally {
            results.performance.endTime = Date.now();
            results.performance.duration = results.performance.endTime - results.performance.startTime;
        }
        
        return results;
    }

    /**
     * UTILITY: Better CSS selector generation
     */
    getElementSelector(element) {
        if (element.id) {
            return `#${element.id}`;
        }
        
        if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\\s+/).slice(0, 3);
            if (classes.length > 0) {
                return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
            }
        }
        
        // Build path-based selector
        const path = [];
        let current = element;
        
        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
            let selector = current.tagName.toLowerCase();
            
            if (current.id) {
                selector += `#${current.id}`;
                path.unshift(selector);
                break;
            }
            
            if (current.className && typeof current.className === 'string') {
                const classes = current.className.trim().split(/\\s+/).slice(0, 2);
                if (classes.length > 0) {
                    selector += `.${classes.join('.')}`;
                }
            }
            
            // Add nth-child if needed for uniqueness
            const siblings = Array.from(current.parentNode?.children || []).filter(
                sibling => sibling.tagName === current.tagName
            );
            
            if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += `:nth-child(${index})`;
            }
            
            path.unshift(selector);
            current = current.parentElement;
            
            if (path.length >= 4) break; // Limit path length
        }
        
        return path.join(' > ');
    }

    /**
     * NEW: Extract average color from gradient (simplified)
     */
    extractGradientAverageColor(gradient) {
        // Simplified gradient color extraction
        // In a full implementation, this would parse the gradient and calculate average
        const colorMatches = gradient.match(/rgb\\([^)]+\\)/g);
        if (colorMatches && colorMatches.length > 0) {
            return this.parseColor(colorMatches[0]);
        }
        return null;
    }

    /**
     * NEW: Get stacking order for layering analysis
     */
    getStackingOrder(element) {
        const style = window.getComputedStyle(element);
        const zIndex = parseInt(style.zIndex);
        return isNaN(zIndex) ? 0 : zIndex;
    }
}

module.exports = ImprovedColorContrastScanner;