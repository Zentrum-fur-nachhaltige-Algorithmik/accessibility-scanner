/**
 * Improved Images of Text Scanner for Phase6a
 * 
 * Fixes identified issues:
 * - Too low confidence thresholds
 * - Poor heuristics for text detection
 * - Missing context analysis
 * - Inadequate filtering of legitimate images
 * 
 * EN 301 549 criterion: 9.1.4.5 (Images of Text)
 */

class ImprovedImagesOfTextScanner {
    constructor(config = {}) {
        this.config = {
            confidenceThreshold: config.confidenceThreshold || 60, // Raised from 30
            enableOCR: config.enableOCR || false,
            excludePatterns: config.excludePatterns || [
                /logo/i,
                /brand/i,
                /decoration/i,
                /ornament/i,
                /avatar/i,
                /profile/i
            ],
            includePatternsForHighConfidence: config.includePatternsForHighConfidence || [
                /button/i,
                /nav/i,
                /heading/i,
                /header/i,
                /text/i,
                /title/i,
                /caption/i
            ],
            exemptImageTypes: config.exemptImageTypes || [
                'logo',
                'decorative',
                'avatar',
                'icon'
            ],
            debugging: config.debugging || false
        };
    }

    /**
     * IMPROVED: Enhanced confidence scoring with better heuristics
     */
    calculateImageTextConfidence(element, factors) {
        let confidence = 0;
        let reasoning = [];
        let penalties = [];
        
        // STRONG POSITIVE INDICATORS (High confidence boost)
        if (factors.hasTextKeywords) {
            confidence += 40;
            reasoning.push('Text-related keywords in filename/class/alt');
        }
        
        if (factors.hasButtonDimensions) {
            confidence += 35;
            reasoning.push('Button-like dimensions detected');
        }
        
        if (factors.hasNavigationText) {
            confidence += 30;
            reasoning.push('Navigation text patterns detected');
        }
        
        if (factors.hasHeadingText) {
            confidence += 35;
            reasoning.push('Heading text patterns detected');
        }
        
        // MEDIUM POSITIVE INDICATORS
        if (factors.isInTextualContext) {
            confidence += 25;
            reasoning.push('Located in textual content context');
        }
        
        if (factors.hasTextAltAttribute) {
            confidence += 20;
            reasoning.push('Alt text suggests textual content');
        }
        
        if (factors.hasTypicalTextRatio) {
            confidence += 15;
            reasoning.push('Aspect ratio typical for text elements');
        }
        
        if (factors.isInFormContext) {
            confidence += 20;
            reasoning.push('Located in form context (likely button)');
        }
        
        // WEAK POSITIVE INDICATORS
        if (factors.hasTextualFilename) {
            confidence += 10;
            reasoning.push('Filename suggests text content');
        }
        
        if (factors.hasTextualClasses) {
            confidence += 10;
            reasoning.push('CSS classes suggest text content');
        }
        
        // NEGATIVE INDICATORS (Reduce confidence)
        if (factors.hasDecorativeKeywords) {
            confidence -= 25;
            penalties.push('Contains decorative keywords');
        }
        
        if (factors.isIconSize) {
            confidence -= 20;
            penalties.push('Too small to contain meaningful text');
        }
        
        if (factors.isInGalleryContext) {
            confidence -= 15;
            penalties.push('Located in image gallery context');
        }
        
        if (factors.hasPhotoKeywords) {
            confidence -= 20;
            penalties.push('Photo/image keywords detected');
        }
        
        if (factors.isVectorGraphic) {
            confidence -= 10;
            penalties.push('Vector graphic (may be decorative)');
        }
        
        if (factors.hasAriaHidden) {
            confidence -= 30;
            penalties.push('Marked as aria-hidden (decorative)');
        }
        
        if (factors.hasEmptyAlt) {
            confidence -= 15;
            penalties.push('Empty alt attribute (decorative intent)');
        }
        
        // CONTEXT-BASED ADJUSTMENTS
        if (factors.isInNavigationContext && !factors.hasNavigationText) {
            confidence -= 5;
            penalties.push('In navigation but no nav text patterns');
        }
        
        const finalConfidence = Math.max(0, Math.min(100, confidence));
        
        return {
            confidence: finalConfidence,
            reasoning: reasoning,
            penalties: penalties,
            threshold: this.config.confidenceThreshold,
            isViolation: finalConfidence >= this.config.confidenceThreshold
        };
    }

    /**
     * IMPROVED: Comprehensive image analysis
     */
    analyzeImage(image) {
        const analysis = {
            element: image,
            tagName: image.tagName.toLowerCase(),
            src: image.src || image.getAttribute('src'),
            alt: image.getAttribute('alt'),
            title: image.getAttribute('title'),
            className: image.className,
            dimensions: this.getImageDimensions(image),
            context: this.getImageContext(image)
        };
        
        const factors = this.extractImageFactors(analysis);
        const confidence = this.calculateImageTextConfidence(image, factors);
        
        return {
            ...analysis,
            factors: factors,
            confidence: confidence,
            recommendation: this.generateRecommendation(analysis, confidence)
        };
    }

    /**
     * NEW: Extract comprehensive factors for analysis
     */
    extractImageFactors(analysis) {
        const src = analysis.src || '';
        const alt = analysis.alt || '';
        const title = analysis.title || '';
        const className = analysis.className || '';
        const textualContent = `${src} ${alt} ${title} ${className}`.toLowerCase();
        
        return {
            // Text-related keywords
            hasTextKeywords: this.config.includePatternsForHighConfidence.some(pattern => 
                pattern.test(textualContent)
            ),
            hasNavigationText: /\\b(nav|menu|home|about|contact|login|signup|submit)\\b/i.test(textualContent),
            hasHeadingText: /\\b(heading|header|title|caption|h1|h2|h3)\\b/i.test(textualContent),
            hasButtonText: /\\b(button|btn|click|submit|send|save|delete|edit)\\b/i.test(textualContent),
            
            // Dimensional analysis
            hasButtonDimensions: this.hasButtonDimensions(analysis.dimensions),
            hasTypicalTextRatio: this.hasTypicalTextRatio(analysis.dimensions),
            isIconSize: this.isIconSize(analysis.dimensions),
            
            // Content analysis
            hasTextAltAttribute: this.hasTextualAltAttribute(alt),
            hasTextualFilename: this.hasTextualFilename(src),
            hasTextualClasses: this.hasTextualClasses(className),
            
            // Context analysis
            isInTextualContext: this.isInTextualContext(analysis.context),
            isInNavigationContext: analysis.context.navigation,
            isInFormContext: analysis.context.form,
            isInGalleryContext: analysis.context.gallery,
            
            // Negative indicators
            hasDecorativeKeywords: this.config.excludePatterns.some(pattern => 
                pattern.test(textualContent)
            ),
            hasPhotoKeywords: /\\b(photo|pic|image|img|gallery|slideshow)\\b/i.test(textualContent),
            isVectorGraphic: /\\.svg$/i.test(src) || analysis.element.tagName.toLowerCase() === 'svg',
            hasAriaHidden: analysis.element.getAttribute('aria-hidden') === 'true',
            hasEmptyAlt: alt === '',
            hasDecorativeRole: analysis.element.getAttribute('role') === 'presentation' ||
                              analysis.element.getAttribute('role') === 'none'
        };
    }

    /**
     * NEW: Check for button-like dimensions
     */
    hasButtonDimensions(dimensions) {
        if (!dimensions.width || !dimensions.height) return false;
        
        // Typical button dimensions
        const isButtonWidth = dimensions.width >= 60 && dimensions.width <= 300;
        const isButtonHeight = dimensions.height >= 20 && dimensions.height <= 60;
        const hasButtonRatio = dimensions.width / dimensions.height >= 1.5 && 
                              dimensions.width / dimensions.height <= 8;
        
        return isButtonWidth && isButtonHeight && hasButtonRatio;
    }

    /**
     * NEW: Check for typical text aspect ratios
     */
    hasTypicalTextRatio(dimensions) {
        if (!dimensions.width || !dimensions.height) return false;
        
        const ratio = dimensions.width / dimensions.height;
        
        // Text typically has wider aspect ratios
        return ratio >= 2 && ratio <= 12;
    }

    /**
     * NEW: Check for icon-sized images
     */
    isIconSize(dimensions) {
        if (!dimensions.width || !dimensions.height) return false;
        
        // Icons are typically small and square-ish
        const maxDimension = Math.max(dimensions.width, dimensions.height);
        const minDimension = Math.min(dimensions.width, dimensions.height);
        
        return maxDimension <= 64 && minDimension <= 32;
    }

    /**
     * NEW: Analyze alt attribute for textual content
     */
    hasTextualAltAttribute(alt) {
        if (!alt || alt.trim() === '') return false;
        
        // Check for common button/navigation text patterns
        const textualPatterns = [
            /\\b(click|press|select|choose|go to|navigate)\\b/i,
            /\\b(home|about|contact|login|signup|submit|send|save)\\b/i,
            /\\b(next|previous|back|forward|up|down)\\b/i,
            /\\b(menu|navigation|header|footer)\\b/i
        ];
        
        return textualPatterns.some(pattern => pattern.test(alt));
    }

    /**
     * NEW: Analyze filename for textual indicators
     */
    hasTextualFilename(src) {
        if (!src) return false;
        
        const filename = src.split('/').pop().toLowerCase();
        
        const textualPatterns = [
            /\\b(btn|button|nav|menu|header|title)\\b/,
            /\\b(submit|send|save|delete|edit|click)\\b/,
            /\\b(text|heading|caption|label)\\b/
        ];
        
        return textualPatterns.some(pattern => pattern.test(filename));
    }

    /**
     * NEW: Analyze CSS classes for textual indicators
     */
    hasTextualClasses(className) {
        if (!className) return false;
        
        const classes = className.toLowerCase();
        
        const textualPatterns = [
            /\\b(btn|button|nav|navigation|menu)\\b/,
            /\\b(header|heading|title|caption)\\b/,
            /\\b(text|label|link)\\b/,
            /\\b(submit|action|cta|call-to-action)\\b/
        ];
        
        return textualPatterns.some(pattern => pattern.test(classes));
    }

    /**
     * NEW: Get image dimensions
     */
    getImageDimensions(image) {
        return {
            width: image.offsetWidth || image.width || 0,
            height: image.offsetHeight || image.height || 0,
            naturalWidth: image.naturalWidth || 0,
            naturalHeight: image.naturalHeight || 0
        };
    }

    /**
     * IMPROVED: Get comprehensive image context
     */
    getImageContext(image) {
        return {
            navigation: !!image.closest('nav, [role="navigation"], .nav, .navigation, .menu'),
            form: !!image.closest('form, [role="form"]'),
            button: !!image.closest('button, [role="button"], .btn, .button'),
            header: !!image.closest('header, [role="banner"], h1, h2, h3, h4, h5, h6'),
            gallery: !!image.closest('.gallery, .carousel, .slider, [role="img"]'),
            textContent: !!image.closest('p, article, section, main, [role="main"]'),
            sidebar: !!image.closest('aside, [role="complementary"], .sidebar'),
            footer: !!image.closest('footer, [role="contentinfo"]')
        };
    }

    /**
     * NEW: Check if image is in textual context
     */
    isInTextualContext(context) {
        return context.navigation || context.form || context.button || 
               context.header || context.textContent;
    }

    /**
     * IMPROVED: Analyze background images
     */
    analyzeBackgroundImage(element) {
        const style = window.getComputedStyle(element);
        const backgroundImage = style.backgroundImage;
        
        if (!backgroundImage || backgroundImage === 'none') {
            return null;
        }
        
        // Extract URL from background-image
        const urlMatch = backgroundImage.match(/url\\(["']?([^"'\\)]+)["']?\\)/);
        const imageUrl = urlMatch ? urlMatch[1] : '';
        
        const analysis = {
            element: element,
            tagName: element.tagName.toLowerCase(),
            backgroundImage: backgroundImage,
            imageUrl: imageUrl,
            className: element.className,
            textContent: element.textContent.trim(),
            dimensions: {
                width: element.offsetWidth,
                height: element.offsetHeight
            },
            context: this.getImageContext(element)
        };
        
        // Check if text overlay exists
        const hasTextOverlay = analysis.textContent.length > 0;
        const hasTextualClasses = this.hasTextualClasses(analysis.className);
        const isInTextualContext = this.isInTextualContext(analysis.context);
        
        const factors = {
            hasTextOverlay: hasTextOverlay,
            hasTextualClasses: hasTextualClasses,
            isInTextualContext: isInTextualContext,
            hasButtonDimensions: this.hasButtonDimensions(analysis.dimensions),
            hasDecorativeKeywords: this.config.excludePatterns.some(pattern => 
                pattern.test(`${imageUrl} ${analysis.className}`.toLowerCase())
            ),
            isLargeBackground: analysis.dimensions.width > 500 || analysis.dimensions.height > 300
        };
        
        let confidence = 0;
        let reasoning = [];
        
        if (factors.hasTextOverlay && factors.hasTextualClasses) {
            confidence += 50;
            reasoning.push('Text overlay with textual CSS classes');
        } else if (factors.hasTextOverlay) {
            confidence += 30;
            reasoning.push('Text overlay detected');
        }
        
        if (factors.hasButtonDimensions) {
            confidence += 25;
            reasoning.push('Button-like dimensions');
        }
        
        if (factors.hasDecorativeKeywords) {
            confidence -= 20;
            reasoning.push('Decorative keywords detected');
        }
        
        if (factors.isLargeBackground) {
            confidence -= 15;
            reasoning.push('Large background image (likely decorative)');
        }
        
        const finalConfidence = Math.max(0, Math.min(100, confidence));
        
        return {
            ...analysis,
            factors: factors,
            confidence: {
                confidence: finalConfidence,
                reasoning: reasoning,
                threshold: this.config.confidenceThreshold,
                isViolation: finalConfidence >= this.config.confidenceThreshold
            }
        };
    }

    /**
     * NEW: Generate specific recommendations
     */
    generateRecommendation(analysis, confidence) {
        if (!confidence.isViolation) {
            return {
                action: 'no-action',
                message: 'Image appears to be decorative or properly implemented',
                priority: 'low'
            };
        }
        
        let message = '';
        let priority = 'medium';
        
        if (confidence.confidence >= 80) {
            priority = 'high';
            message = 'High confidence text image detected. ';
        } else if (confidence.confidence >= 60) {
            priority = 'medium';
            message = 'Likely text image detected. ';
        }
        
        if (analysis.context.button || analysis.context.form) {
            message += 'Convert to HTML button with CSS styling.';
        } else if (analysis.context.navigation) {
            message += 'Convert to HTML text links with CSS styling.';
        } else if (analysis.context.header) {
            message += 'Convert to HTML heading elements with CSS styling.';
        } else {
            message += 'Convert to HTML text with CSS styling for visual design.';
        }
        
        return {
            action: 'convert-to-text',
            message: message,
            priority: priority,
            suggestedTags: this.suggestHTMLTags(analysis.context)
        };
    }

    /**
     * NEW: Suggest appropriate HTML tags
     */
    suggestHTMLTags(context) {
        if (context.button || context.form) {
            return ['button', 'input[type="submit"]'];
        } else if (context.navigation) {
            return ['a', 'nav'];
        } else if (context.header) {
            return ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        } else {
            return ['span', 'div', 'p'];
        }
    }

    /**
     * MAIN SCAN FUNCTION
     */
    async scanImagesOfText(page) {
        const results = {
            criterion: '9.1.4.5',
            passed: true,
            violations: [],
            summary: {
                totalImages: 0,
                suspectedTextImages: 0,
                highConfidenceViolations: 0,
                backgroundImages: 0
            },
            performance: {
                startTime: Date.now(),
                endTime: null,
                duration: null
            }
        };
        
        try {
            await page.evaluate((config) => {
                window.__phase6aImagesOfTextScanner = new ImprovedImagesOfTextScanner(config);
            }, this.config);
            
            const violations = await page.evaluate(() => {
                const scanner = window.__phase6aImagesOfTextScanner;
                const violations = [];
                let stats = {
                    totalImages: 0,
                    suspectedTextImages: 0,
                    highConfidenceViolations: 0,
                    backgroundImages: 0
                };
                
                // Analyze IMG elements
                document.querySelectorAll('img').forEach(img => {
                    stats.totalImages++;
                    
                    if (scanner.isRelevantElement(img)) {
                        const analysis = scanner.analyzeImage(img);
                        
                        if (analysis.confidence.isViolation) {
                            stats.suspectedTextImages++;
                            
                            if (analysis.confidence.confidence >= 80) {
                                stats.highConfidenceViolations++;
                            }
                            
                            violations.push({
                                type: 'image-of-text',
                                element: scanner.getElementSelector(img),
                                issue: 'Image likely contains text that should be HTML',
                                src: analysis.src,
                                alt: analysis.alt,
                                confidence: analysis.confidence.confidence,
                                reasoning: analysis.confidence.reasoning,
                                penalties: analysis.confidence.penalties,
                                recommendation: analysis.recommendation,
                                dimensions: analysis.dimensions,
                                context: analysis.context
                            });
                        }
                    }
                });
                
                // Analyze background images
                document.querySelectorAll('*').forEach(element => {
                    const style = window.getComputedStyle(element);
                    if (style.backgroundImage && style.backgroundImage !== 'none') {
                        stats.backgroundImages++;
                        
                        if (scanner.isRelevantElement(element)) {
                            const analysis = scanner.analyzeBackgroundImage(element);
                            
                            if (analysis && analysis.confidence.isViolation) {
                                stats.suspectedTextImages++;
                                
                                violations.push({
                                    type: 'background-image-of-text',
                                    element: scanner.getElementSelector(element),
                                    issue: 'Background image likely contains text',
                                    backgroundImage: analysis.backgroundImage,
                                    textContent: analysis.textContent,
                                    confidence: analysis.confidence.confidence,
                                    reasoning: analysis.confidence.reasoning,
                                    recommendation: {
                                        action: 'convert-to-css-text',
                                        message: 'Convert background image text to HTML text with CSS styling',
                                        priority: 'medium'
                                    }
                                });
                            }
                        }
                    }
                });
                
                return { violations, stats };
            });
            
            results.violations = violations.violations;
            results.summary = violations.stats;
            results.passed = violations.violations.length === 0;
            
        } catch (error) {
            throw new Error(`Images of text scan failed: ${error.message}`);
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
        
        const style = window.getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        
        return true;
    }

    getElementSelector(element) {
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

module.exports = ImprovedImagesOfTextScanner;