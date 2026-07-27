#!/usr/bin/env node

/**
 * Comprehensive Real API Test Runner für Phase6a Accessibility Scanner
 * 
 * Tests all 74 test files against the real Phase6a API at localhost:3000
 * Provides complete false positive/negative analysis across ALL accessibility patterns
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Konfiguration
const API_BASE_URL = 'http://localhost:3000';
const TEST_HTML_DIR = __dirname;
const STATIC_SERVER_PORT = 8081;

// === COMPREHENSIVE TEST CONFIGURATION (ALL 74 TEST FILES) ===
const COMPREHENSIVE_TEST_SITES = {
    bad: [
        // === ORIGINAL PATTERNS ===
        {
            name: 'Color Contrast Violations',
            file: 'bad-color-contrast.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'colorContrast',
            expectedViolations: { colorContrast: true, useOfColor: false, imagesOfText: false },
            description: 'Multiple color contrast violations with ratios below WCAG AA standards'
        },
        {
            name: 'Use of Color Violations', 
            file: 'bad-use-of-color.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'useOfColor',
            expectedViolations: { colorContrast: false, useOfColor: true, imagesOfText: false },
            description: 'Information conveyed by color alone without additional indicators'
        },
        {
            name: 'Images of Text Violations',
            file: 'bad-images-of-text.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'imagesOfText',
            expectedViolations: { colorContrast: false, useOfColor: false, imagesOfText: true },
            description: 'Text content rendered as images instead of HTML text'
        },
        
        // === SAFETY CRITICAL PATTERNS ===
        {
            name: 'Seizure Risk Violations',
            file: 'bad-seizure-risk.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'seizurePrevention',
            description: 'Content flashing >3Hz causing seizure risk - SAFETY CRITICAL'
        },
        {
            name: 'Label in Name Violations',
            file: 'bad-label-in-name.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'labelInName',
            description: 'Voice control incompatible - visible text ≠ accessible name'
        },
        {
            name: 'Status Messages Violations',
            file: 'bad-status-messages.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'statusMessages',
            description: 'Screen reader users miss critical status updates'
        },
        
        // === CORE FUNCTIONALITY PATTERNS ===
        {
            name: 'Non-Text Contrast Violations',
            file: 'bad-nontext-contrast.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'nonTextContrast',
            description: 'UI components with contrast <3:1 invisible to low vision users'
        },
        {
            name: 'Timing Controls Violations',
            file: 'bad-timing-controls.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'timingControls',
            description: 'Auto-play and timing without user controls - motor disability barrier'
        },
        {
            name: 'Form Error Handling Violations',
            file: 'bad-form-errors.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'errorHandling',
            description: 'Poor form error handling prevents successful completion'
        },
        
        // === ADVANCED COVERAGE PATTERNS ===
        {
            name: 'Complex ARIA Violations',
            file: 'bad-complex-aria.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'complexAria',
            description: 'Complex ARIA widgets with incomplete implementations'
        },
        {
            name: 'Input Modalities Violations',
            file: 'bad-input-modalities.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'inputModalities',
            description: 'Gesture-dependent interactions without alternatives'
        },
        {
            name: 'HTML Validation Violations',
            file: 'bad-html-validation.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'htmlValidation',
            description: 'Invalid HTML structure breaking accessibility features'
        },
        
        // === CRITICAL PATTERN EXTENSIONS ===
        {
            name: 'CSS Background Info Violations',
            file: 'bad-css-background-info.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'cssBackgroundInfo',
            description: 'WCAG 1.1.1 - Information only available as CSS background images'
        },
        {
            name: 'Complex Data Tables Violations',
            file: 'bad-complex-data-tables.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'complexDataTables',
            description: 'WCAG 1.3.1 & 4.1.2 - Complex data tables without proper semantic structure'
        },
        {
            name: 'Hover Focus Content Violations',
            file: 'bad-hover-focus-content.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'hoverFocusContent',
            description: 'WCAG 1.4.13 - Content on hover/focus not dismissible, hoverable, or persistent'
        },
        {
            name: 'Pointer Cancellation Violations',
            file: 'bad-pointer-cancellation.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'pointerCancellation',
            description: 'WCAG 2.5.2 - Pointer events without cancellation or undo mechanism'
        },
        
        // === SUBTLE PATTERNS ===
        {
            name: 'ARIA State Updates Violations',
            file: 'bad-aria-state-updates.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'ariaStateUpdates',
            description: 'WCAG 4.1.2 & 4.1.3 - Dynamic UI components without ARIA state updates'
        },
        {
            name: 'Error Prevention Violations',
            file: 'bad-error-prevention.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'errorPrevention',
            description: 'WCAG 3.3.4 - Critical actions without error prevention mechanisms'
        },
        {
            name: 'Cognitive Accessibility Violations',
            file: 'bad-cognitive-accessibility.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'cognitiveAccessibility',
            description: 'WCAG 3.2.x & 3.3.2 - Cognitive barriers without assistive features'
        },
        {
            name: 'Motion and Vestibular Violations',
            file: 'bad-motion-vestibular.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'motionVestibular',
            description: 'WCAG 2.3.3 & 2.5.4 - Motion-based interactions without alternatives or controls'
        },
        {
            name: 'Target Size Violations',
            file: 'bad-target-size.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'targetSize',
            description: 'WCAG 2.5.5 - Touch targets below 44x44px minimum size requirement'
        },
        {
            name: 'Reading Level Violations',
            file: 'bad-reading-level.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'readingLevel',
            description: 'WCAG 3.1.5 - Text complexity exceeds secondary education level without simplified alternatives'
        },
        
        // === FOUNDATION PATTERNS ===
        {
            name: 'Image Alt Text Violations',
            file: 'bad-image-alt.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'imageAltText',
            description: 'WCAG 1.1.1 - Image alt text failures preventing screen reader access'
        },
        {
            name: 'Form Label Violations',
            file: 'bad-form-labels.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'formLabeling',
            description: 'WCAG 3.3.2 & 1.3.1 - Form labeling failures preventing form completion'
        },
        {
            name: 'Media Alternatives Violations',
            file: 'bad-media-alternatives.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'mediaAlternatives',
            description: 'WCAG 1.2.x - Media accessibility failures for deaf and blind users'
        },
        {
            name: 'Icon Accessibility Violations',
            file: 'bad-icon-accessibility.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'iconAccessibility',
            description: 'WCAG 1.1.1 & 4.1.2 - Icon accessibility failures preventing understanding'
        },
        
        // === KEYBOARD & NAVIGATION PATTERNS ===
        {
            name: 'Keyboard Access Violations',
            file: 'bad-keyboard-access.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'keyboardAccess',
            description: 'WCAG 2.2.1 & 2.1.3 - Keyboard accessibility failures preventing operation'
        },
        {
            name: 'Keyboard Trap Violations',
            file: 'bad-keyboard-trap.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'keyboardTraps',
            description: 'WCAG 2.2.2 - Keyboard trap failures preventing navigation escape'
        },
        {
            name: 'Focus Order Violations',
            file: 'bad-focus-order.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'focusOrder',
            description: 'WCAG 2.4.3 - Focus order failures causing navigation confusion'
        },
        {
            name: 'Focus Visible Violations',
            file: 'bad-focus-visible.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'focusVisible',
            description: 'WCAG 2.4.7 & 2.4.11 - Focus visibility failures for keyboard users'
        },
        {
            name: 'Link Purpose Violations',
            file: 'bad-link-purpose.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'linkPurpose',
            description: 'WCAG 2.4.4 & 2.4.9 - Ambiguous link text preventing destination understanding'
        },
        
        // === ADVANCED PATTERNS ===
        {
            name: 'Reflow Violations',
            file: 'bad-reflow.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'reflow',
            description: 'WCAG 1.4.10 & 1.4.4 - Reflow failures making content unusable when zoomed'
        },
        {
            name: 'Language Declaration Violations',
            file: 'bad-language.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'languageDeclaration',
            description: 'WCAG 3.1.1 & 3.1.2 - Language declaration failures causing pronunciation errors'
        },
        {
            name: 'Context Change Violations',
            file: 'bad-context-change.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'contextChange',
            description: 'WCAG 3.2.1 & 3.2.2 - Unexpected context changes causing user disorientation'
        },
        {
            name: 'Form Grouping Violations',
            file: 'bad-form-grouping.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'formGrouping',
            description: 'WCAG 1.3.1 & 3.3.2 - Form grouping failures preventing context understanding'
        },
        
        // === EDGE CASES ===
        {
            name: 'Text Resize Violations',
            file: 'bad-text-resize.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'textResize',
            description: 'WCAG 1.4.4 - Text disappears or becomes unusable when zoomed to 200%'
        },
        {
            name: 'Complex Image Alt Text Violations',
            file: 'bad-image-alt-complex.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'complexImageAlt',
            description: 'WCAG 1.1.1 - Complex images with inadequate descriptive alternatives'
        },
        {
            name: 'Focus Management Violations',
            file: 'bad-focus-management.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'focusManagement',
            description: 'WCAG 2.4.3 & 3.2.1 - Focus management failures in dynamic interfaces'
        },
        {
            name: 'Keyboard Native Override Violations',
            file: 'bad-keyboard-native-override.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'keyboardNativeOverride',
            description: 'WCAG 2.2.1 & 2.1.2 - Custom controls that override expected keyboard behavior'
        },
        {
            name: 'Concurrent Input Mechanisms Violations',
            file: 'bad-concurrent-input.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'concurrentInputMechanisms',
            description: 'WCAG 2.5.6 - Input mechanisms that conflict with or disable other input methods'
        },
        {
            name: 'Language Override Violations',
            file: 'bad-language-override.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'languageOverride',
            description: 'WCAG 3.1.2 - Foreign language content without proper lang attribute markup'
        },
        {
            name: 'Auto-Submitting Form Violations',
            file: 'bad-auto-submitting-form.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'autoSubmittingForm',
            description: 'WCAG 3.2.2 - Forms that submit automatically without user confirmation'
        },
        {
            name: 'ARIA Role Override Violations',
            file: 'bad-aria-role-override.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'ariaRoleOverride',
            description: 'WCAG 4.1.2 - ARIA roles that override or conflict with native HTML semantics'
        },
        
        // === NEW CRITICAL MISSING PATTERNS ===
        {
            name: 'Autocomplete Violations',
            file: 'bad-autocomplete.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'autocompleteViolations',
            description: 'WCAG 1.3.5 - Missing or incorrect autocomplete attributes preventing assistive technology auto-fill'
        },
        {
            name: 'Scrollable Content Violations',
            file: 'bad-scrollable-content.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'scrollableContentViolations',
            description: 'WCAG 2.2.1 - Scrollable content regions not accessible via keyboard navigation'
        },
        {
            name: 'Text Spacing Violations',
            file: 'bad-text-spacing.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'textSpacingViolations',
            description: 'WCAG 1.4.12 - Content becomes unusable when users apply custom text spacing'
        },
        {
            name: 'Skip Links Violations',
            file: 'bad-skip-links.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'skipLinksViolations',
            description: 'WCAG 2.4.1 - Skip link failures preventing bypass of repetitive navigation blocks'
        },
        {
            name: 'Landmarks Violations',
            file: 'bad-landmarks.html',
            expectedPhase6aFail: true,
            expectedPrimaryPattern: 'landmarksViolations',
            description: 'Multiple ARIA landmark violations - Duplicate landmarks and improper nesting breaking screen reader navigation'
        }
    ],
    
    good: [
        // === GOOD EXAMPLES ===
        {
            name: 'Good Accessibility Practices',
            file: 'good-accessibility.html',
            expectedPhase6aFail: false,
            expectedViolations: { colorContrast: false, useOfColor: false, imagesOfText: false },
            description: 'Proper implementation of WCAG 2.2 Level AA standards'
        },
        {
            name: 'Good Seizure Safe Content',
            file: 'good-seizure-safe.html',
            expectedPhase6aFail: false,
            description: 'Seizure-safe animations with user controls <3Hz'
        },
        {
            name: 'Good Label in Name Implementation',
            file: 'good-label-in-name.html',
            expectedPhase6aFail: false,
            description: 'Voice control compatible - visible text matches accessible name'
        },
        {
            name: 'Good CSS Background Accessible',
            file: 'good-css-background-accessible.html',
            expectedPhase6aFail: false,
            description: 'WCAG 1.1.1 compliant - Information available through DOM text and ARIA'
        },
        {
            name: 'Good Complex Data Tables',
            file: 'good-complex-data-tables.html',
            expectedPhase6aFail: false,
            description: 'WCAG 1.3.1 & 4.1.2 compliant - Complex tables with full semantic structure'
        },
        {
            name: 'Good Hover Focus Content',
            file: 'good-hover-focus-content.html',
            expectedPhase6aFail: false,
            description: 'WCAG 1.4.13 compliant - Content is dismissible, hoverable, and persistent'
        },
        {
            name: 'Good Pointer Cancellation',
            file: 'good-pointer-cancellation.html',
            expectedPhase6aFail: false,
            description: 'WCAG 2.5.2 compliant - All pointer events support cancellation and undo'
        },
        {
            name: 'Good ARIA State Updates',
            file: 'good-aria-state-updates.html',
            expectedPhase6aFail: false,
            description: 'WCAG 4.1.2 & 4.1.3 compliant - Proper ARIA state management for dynamic UI'
        },
        {
            name: 'Good Error Prevention',
            file: 'good-error-prevention.html',
            expectedPhase6aFail: false,
            description: 'WCAG 3.3.4 compliant - Comprehensive error prevention for critical actions'
        },
        {
            name: 'Good Cognitive Accessibility',
            file: 'good-cognitive-accessibility.html',
            expectedPhase6aFail: false,
            description: 'WCAG 3.2.x & 3.3.2 compliant - Clear, predictable interactions and error handling'
        },
        {
            name: 'Good Motion and Vestibular',
            file: 'good-motion-vestibular.html',
            expectedPhase6aFail: false,
            description: 'WCAG 2.3.3 & 2.5.4 compliant - Accessible motion with user controls and alternatives'
        },
        {
            name: 'Good Target Size',
            file: 'good-target-size.html',
            expectedPhase6aFail: false,
            description: 'WCAG 2.5.5 compliant - All touch targets meet 44x44px minimum size requirement'
        },
        {
            name: 'Good Reading Level',
            file: 'good-reading-level.html',
            expectedPhase6aFail: false,
            description: 'WCAG 3.1.5 compliant - Clear language with simplified alternatives for complex content'
        },
        {
            name: 'Good Text Resize',
            file: 'good-text-resize.html',
            expectedPhase6aFail: false,
            description: 'WCAG 1.4.4 compliant - Content remains usable and visible at 200% zoom'
        },
        {
            name: 'Good Complex Image Alt Text',
            file: 'good-image-alt-complex.html',
            expectedPhase6aFail: false,
            description: 'WCAG 1.1.1 compliant - Complex images with comprehensive descriptive alternatives'
        },
        {
            name: 'Good Focus Management',
            file: 'good-focus-management.html',
            expectedPhase6aFail: false,
            description: 'WCAG 2.4.3 & 3.2.1 compliant - Proper focus management in dynamic interfaces'
        },
        {
            name: 'Good Keyboard Native Override',
            file: 'good-keyboard-native-override.html',
            expectedPhase6aFail: false,
            description: 'WCAG 2.2.1 & 2.1.2 compliant - Custom controls that preserve expected keyboard behavior'
        },
        {
            name: 'Good Concurrent Input Mechanisms',
            file: 'good-concurrent-input.html',
            expectedPhase6aFail: false,
            description: 'WCAG 2.5.6 compliant - Multiple input methods that work together harmoniously'
        },
        {
            name: 'Good Language Override',
            file: 'good-language-override.html',
            expectedPhase6aFail: false,
            description: 'WCAG 3.1.2 compliant - Proper language attributes for all foreign content'
        },
        {
            name: 'Good Auto-Submitting Form',
            file: 'good-auto-submitting-form.html',
            expectedPhase6aFail: false,
            description: 'WCAG 3.2.2 compliant - Forms with explicit user control over submission'
        },
        {
            name: 'Good ARIA Role Override',
            file: 'good-aria-role-override.html',
            expectedPhase6aFail: false,
            description: 'WCAG 4.1.2 compliant - ARIA roles that extend rather than override native semantics'
        },
        {
            name: 'Good Autocomplete',
            file: 'good-autocomplete.html',
            expectedPhase6aFail: false,
            description: 'WCAG 1.3.5 compliant - Proper autocomplete attributes enabling assistive technology auto-fill'
        },
        {
            name: 'Good Scrollable Content',
            file: 'good-scrollable-content.html',
            expectedPhase6aFail: false,
            description: 'WCAG 2.2.1 compliant - Scrollable content regions accessible via keyboard navigation'
        },
        {
            name: 'Good Text Spacing',
            file: 'good-text-spacing.html',
            expectedPhase6aFail: false,
            description: 'WCAG 1.4.12 compliant - Content remains usable when users apply custom text spacing'
        },
        {
            name: 'Good Skip Links',
            file: 'good-skip-links.html',
            expectedPhase6aFail: false,
            description: 'WCAG 2.4.1 compliant - Effective skip links for bypassing repetitive navigation blocks'
        },
        {
            name: 'Good Landmarks',
            file: 'good-landmarks.html',
            expectedPhase6aFail: false,
            description: 'ARIA landmark best practices - Proper landmark structure for screen reader navigation'
        }
    ]
};

/**
 * HTTP Request Helper
 */
function makeHttpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };
        
        const req = http.request(requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({
                        statusCode: res.statusCode,
                        data: jsonData
                    });
                } catch (error) {
                    resolve({
                        statusCode: res.statusCode,
                        data: data,
                        parseError: error.message
                    });
                }
            });
        });
        
        req.on('error', reject);
        
        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        
        req.end();
    });
}

/**
 * Startet einen einfachen HTTP-Server um HTML-Dateien zu servieren
 */
function startStaticServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            // CORS Headers hinzufügen
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            
            let filePath = path.join(TEST_HTML_DIR, req.url.substring(1));
            
            // Fallback auf index für root
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Comprehensive Test HTML Server Running - 74 Test Files Available');
                return;
            }
            
            // Datei existiert prüfen
            if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end(`File not found: ${req.url}`);
                return;
            }
            
            // HTML-Datei servieren
            const content = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        });
        
        server.listen(STATIC_SERVER_PORT, (err) => {
            if (err) {
                reject(err);
            } else {
                console.log(`📡 Comprehensive Test Server running on http://localhost:${STATIC_SERVER_PORT}`);
                console.log(`📊 Serving ${COMPREHENSIVE_TEST_SITES.bad.length + COMPREHENSIVE_TEST_SITES.good.length} test files`);
                resolve(server);
            }
        });
    });
}

/**
 * Phase6a API Health Check
 */
async function checkAPIHealth() {
    try {
        console.log('🔍 Checking Phase6a API health...');
        const response = await makeHttpRequest(`${API_BASE_URL}/api/health`);
        
        if (response.statusCode === 200) {
            console.log('✅ Phase6a API is running and healthy');
            return true;
        } else {
            console.log(`❌ API health check failed: ${response.statusCode}`);
            return false;
        }
    } catch (error) {
        console.log(`💥 API health check error: ${error.message}`);
        return false;
    }
}

/**
 * Führt Enhanced Scan mit Phase6a durch
 */
async function runComprehensiveScan(testUrl, testCase) {
    console.log(`\n🔍 Testing: ${testCase.name}`);
    console.log(`   File: ${testCase.file}`);
    console.log(`   URL: ${testUrl}`);
    console.log(`   Expected Pattern: ${testCase.expectedPrimaryPattern || 'various'}`);
    
    const startTime = Date.now();
    
    try {
        const response = await makeHttpRequest(`${API_BASE_URL}/api/enhanced-scan`, {
            method: 'POST',
            body: {
                url: testUrl,
                options: {
                    wcagLevel: 'AA',
                    includePhase6A: true,
                    includeWarnings: true,
                    timeout: 45000, // Increased timeout for comprehensive scans
                    comprehensive: true
                }
            }
        });
        
        const scanTime = Date.now() - startTime;
        
        if (response.statusCode !== 200) {
            throw new Error(`API returned status ${response.statusCode}: ${JSON.stringify(response.data)}`);
        }
        
        const result = response.data;
        
        console.log(`   ⏱️  Scan completed in ${scanTime}ms`);
        console.log(`   📊 Overall Score: ${result.overallScore}`);
        
        // Log comprehensive results
        if (result.violationsByCategory) {
            const categories = Object.keys(result.violationsByCategory);
            console.log(`   🎯 Violation Categories Detected (${categories.length}):`);
            categories.forEach(category => {
                const violations = result.violationsByCategory[category];
                if (violations && violations.length > 0) {
                    console.log(`      ${category}: ${violations.length} violations`);
                }
            });
        }
        
        if (result.phase6ACompliance) {
            console.log(`   📈 Phase6A Results:`);
            console.log(`      Color Contrast: ${result.phase6ACompliance.colorContrast?.passed ? '✅ PASS' : '❌ FAIL'} (${result.phase6ACompliance.colorContrast?.violations?.length || 0} violations)`);
            console.log(`      Use of Color: ${result.phase6ACompliance.useOfColor?.passed ? '✅ PASS' : '❌ FAIL'} (${result.phase6ACompliance.useOfColor?.violations?.length || 0} violations)`);
            console.log(`      Images of Text: ${result.phase6ACompliance.imagesOfText?.passed ? '✅ PASS' : '❌ FAIL'} (${result.phase6ACompliance.imagesOfText?.violations?.length || 0} violations)`);
            console.log(`      Phase6A Score: ${result.phase6AScore}%`);
        }
        
        return {
            success: true,
            result: result,
            scanTime: scanTime,
            testCase: testCase
        };
        
    } catch (error) {
        console.log(`   💥 Scan failed: ${error.message}`);
        return {
            success: false,
            error: error.message,
            scanTime: Date.now() - startTime,
            testCase: testCase
        };
    }
}

/**
 * Enhanced validation for comprehensive testing
 */
function validateComprehensiveResults(scanResult, testCase) {
    const issues = [];
    const warnings = [];
    const result = scanResult.result;
    
    if (!scanResult.success) {
        issues.push(`Scan failed: ${scanResult.error}`);
        return {
            passed: false,
            issues: issues,
            warnings: warnings,
            testCase: testCase.name
        };
    }
    
    // Overall Pass/Fail validation
    const overallShouldFail = testCase.expectedPhase6aFail;
    const overallPassed = result.phase6AScore >= 90; // >90% = Pass
    
    if (overallShouldFail && overallPassed) {
        issues.push(`Expected test to FAIL but got ${result.phase6AScore}% (PASS)`);
    } else if (!overallShouldFail && !overallPassed) {
        issues.push(`Expected test to PASS but got ${result.phase6AScore}% (FAIL)`);
    }
    
    // Pattern-specific validation for legacy tests
    if (testCase.expectedViolations) {
        if (result.phase6ACompliance) {
            const phase6a = result.phase6ACompliance;
            
            if (testCase.expectedViolations.colorContrast && phase6a.colorContrast?.passed) {
                issues.push('Expected Color Contrast violations but scanner found none');
            } else if (!testCase.expectedViolations.colorContrast && !phase6a.colorContrast?.passed) {
                issues.push(`Unexpected Color Contrast violations: ${phase6a.colorContrast?.violations?.length || 0}`);
            }
            
            if (testCase.expectedViolations.useOfColor && phase6a.useOfColor?.passed) {
                issues.push('Expected Use of Color violations but scanner found none');
            } else if (!testCase.expectedViolations.useOfColor && !phase6a.useOfColor?.passed) {
                issues.push(`Unexpected Use of Color violations: ${phase6a.useOfColor?.violations?.length || 0}`);
            }
            
            if (testCase.expectedViolations.imagesOfText && phase6a.imagesOfText?.passed) {
                issues.push('Expected Images of Text violations but scanner found none');
            } else if (!testCase.expectedViolations.imagesOfText && !phase6a.imagesOfText?.passed) {
                issues.push(`Unexpected Images of Text violations: ${phase6a.imagesOfText?.violations?.length || 0}`);
            }
        }
    }
    
    // Primary pattern detection validation
    if (testCase.expectedPrimaryPattern && result.violationsByCategory) {
        const primaryPatternFound = result.violationsByCategory[testCase.expectedPrimaryPattern];
        if (overallShouldFail && (!primaryPatternFound || primaryPatternFound.length === 0)) {
            issues.push(`Expected primary pattern '${testCase.expectedPrimaryPattern}' not detected`);
        }
    }
    
    // Cross-contamination detection (False Positives)
    if (result.violationsByCategory && testCase.expectedPrimaryPattern) {
        const categories = Object.keys(result.violationsByCategory);
        categories.forEach(category => {
            const violations = result.violationsByCategory[category];
            if (violations && violations.length > 0 && category !== testCase.expectedPrimaryPattern) {
                warnings.push(`Cross-contamination: ${category} pattern detected (${violations.length} violations) when testing ${testCase.expectedPrimaryPattern}`);
            }
        });
    }
    
    // Performance validation
    if (scanResult.scanTime > 45000) {
        warnings.push(`Scan took ${scanResult.scanTime}ms, exceeding 45s threshold`);
    }
    
    return {
        passed: issues.length === 0,
        issues: issues,
        warnings: warnings,
        testCase: testCase.name,
        crossContamination: warnings.filter(w => w.includes('Cross-contamination')).length,
        totalViolationCategories: result.violationsByCategory ? Object.keys(result.violationsByCategory).length : 0
    };
}

/**
 * Führt alle Tests aus und gibt detaillierten Bericht zurück
 */
async function runComprehensiveTests() {
    console.log('🚀 Starting COMPREHENSIVE Phase6a API Test Runner...\n');
    console.log(`📊 Testing ${COMPREHENSIVE_TEST_SITES.bad.length} BAD examples + ${COMPREHENSIVE_TEST_SITES.good.length} GOOD examples = ${COMPREHENSIVE_TEST_SITES.bad.length + COMPREHENSIVE_TEST_SITES.good.length} total tests\n`);
    
    const results = {
        passed: 0,
        failed: 0,
        total: 0,
        details: [],
        falsePositives: 0,
        falseNegatives: 0,
        crossContamination: 0,
        performanceIssues: 0
    };
    
    // Health check
    const apiHealthy = await checkAPIHealth();
    if (!apiHealthy) {
        console.log('💥 API is not available. Please start the Phase6a API server first.');
        process.exit(1);
    }
    
    // Start static server
    const server = await startStaticServer();
    
    try {
        // Test BAD examples
        console.log('\n📛 Testing BAD examples (should be detected as FAILING):');
        for (const testCase of COMPREHENSIVE_TEST_SITES.bad) {
            results.total++;
            const testUrl = `http://localhost:${STATIC_SERVER_PORT}/${testCase.file}`;
            
            // Check if test file exists
            if (!fs.existsSync(path.join(TEST_HTML_DIR, testCase.file))) {
                console.log(`\n⚠️  SKIPPING: ${testCase.name} - File ${testCase.file} not found`);
                results.details.push({
                    testCase: testCase.name,
                    file: testCase.file,
                    skipped: true,
                    reason: 'File not found'
                });
                continue;
            }
            
            const scanResult = await runComprehensiveScan(testUrl, testCase);
            const validation = validateComprehensiveResults(scanResult, testCase);
            
            if (validation.passed) {
                console.log(`   ✅ PASSED - Correctly identified as FAILING`);
                results.passed++;
            } else {
                console.log(`   ❌ FAILED - Issues found:`);
                validation.issues.forEach(issue => console.log(`      - ${issue}`));
                results.failed++;
                
                // Track false negatives (bad examples that passed)
                if (scanResult.success && scanResult.result.phase6AScore >= 90) {
                    results.falseNegatives++;
                }
            }
            
            if (validation.warnings.length > 0) {
                console.log(`   ⚠️  Warnings:`);
                validation.warnings.forEach(warning => console.log(`      - ${warning}`));
            }
            
            results.crossContamination += validation.crossContamination;
            results.details.push({
                testCase: testCase.name,
                file: testCase.file,
                expected: 'FAIL',
                actual: scanResult.success ? (scanResult.result.phase6AScore >= 90 ? 'PASS' : 'FAIL') : 'ERROR',
                score: scanResult.success ? scanResult.result.phase6AScore : 0,
                passed: validation.passed,
                issues: validation.issues,
                warnings: validation.warnings,
                scanTime: scanResult.scanTime,
                primaryPattern: testCase.expectedPrimaryPattern,
                violationCategories: validation.totalViolationCategories
            });
            
            // Small delay to prevent overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Test GOOD examples
        console.log('\n\n✅ Testing GOOD examples (should be detected as PASSING):');
        for (const testCase of COMPREHENSIVE_TEST_SITES.good) {
            results.total++;
            const testUrl = `http://localhost:${STATIC_SERVER_PORT}/${testCase.file}`;
            
            // Check if test file exists
            if (!fs.existsSync(path.join(TEST_HTML_DIR, testCase.file))) {
                console.log(`\n⚠️  SKIPPING: ${testCase.name} - File ${testCase.file} not found`);
                results.details.push({
                    testCase: testCase.name,
                    file: testCase.file,
                    skipped: true,
                    reason: 'File not found'
                });
                continue;
            }
            
            const scanResult = await runComprehensiveScan(testUrl, testCase);
            const validation = validateComprehensiveResults(scanResult, testCase);
            
            if (validation.passed) {
                console.log(`   ✅ PASSED - Correctly identified as PASSING`);
                results.passed++;
            } else {
                console.log(`   ❌ FAILED - Issues found:`);
                validation.issues.forEach(issue => console.log(`      - ${issue}`));
                results.failed++;
                
                // Track false positives (good examples that failed)
                if (scanResult.success && scanResult.result.phase6AScore < 90) {
                    results.falsePositives++;
                }
            }
            
            if (validation.warnings.length > 0) {
                console.log(`   ⚠️  Warnings:`);
                validation.warnings.forEach(warning => console.log(`      - ${warning}`));
            }
            
            results.crossContamination += validation.crossContamination;
            results.details.push({
                testCase: testCase.name,
                file: testCase.file,
                expected: 'PASS',
                actual: scanResult.success ? (scanResult.result.phase6AScore >= 90 ? 'PASS' : 'FAIL') : 'ERROR',
                score: scanResult.success ? scanResult.result.phase6AScore : 0,
                passed: validation.passed,
                issues: validation.issues,
                warnings: validation.warnings,
                scanTime: scanResult.scanTime,
                violationCategories: validation.totalViolationCategories
            });
            
            // Small delay to prevent overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
    } finally {
        // Stop static server
        server.close();
        console.log('🛑 Static server stopped');
    }
    
    return results;
}

/**
 * Generiert detaillierten Test-Bericht mit False Positive/Negative Analyse
 */
function generateComprehensiveReport(results) {
    console.log('\n' + '='.repeat(80));
    console.log('📊 COMPREHENSIVE PHASE6A API TEST RESULTS');
    console.log('='.repeat(80));
    
    const successRate = Math.round((results.passed / results.total) * 100);
    const falsePositiveRate = Math.round((results.falsePositives / results.total) * 100);
    const falseNegativeRate = Math.round((results.falseNegatives / results.total) * 100);
    
    console.log(`\n📈 SUMMARY:`);
    console.log(`   Tests passed: ${results.passed}/${results.total} (${successRate}%)`);
    console.log(`   Tests failed: ${results.failed}/${results.total}`);
    console.log(`   False Positives: ${results.falsePositives} (${falsePositiveRate}%)`);
    console.log(`   False Negatives: ${results.falseNegatives} (${falseNegativeRate}%)`);
    console.log(`   Cross-contamination incidents: ${results.crossContamination}`);
    
    // Detailed breakdown
    const badTests = results.details.filter(d => d.expected === 'FAIL' && !d.skipped);
    const goodTests = results.details.filter(d => d.expected === 'PASS' && !d.skipped);
    const skippedTests = results.details.filter(d => d.skipped);
    
    console.log(`\n📋 DETAILED BREAKDOWN:`);
    console.log(`   BAD examples tested: ${badTests.length}`);
    console.log(`   GOOD examples tested: ${goodTests.length}`);
    console.log(`   Skipped tests: ${skippedTests.length}`);
    
    if (skippedTests.length > 0) {
        console.log(`\n⚠️  SKIPPED TESTS:`);
        skippedTests.forEach(test => {
            console.log(`   - ${test.testCase} (${test.file}): ${test.reason}`);
        });
    }
    
    if (results.failed > 0) {
        console.log(`\n❌ FAILED TESTS:`);
        results.details
            .filter(test => !test.passed && !test.skipped)
            .forEach(test => {
                console.log(`\n   ${test.testCase} (${test.file})`);
                console.log(`     Expected: ${test.expected} | Actual: ${test.actual} | Score: ${test.score}%`);
                console.log(`     Scan Time: ${test.scanTime}ms | Violation Categories: ${test.violationCategories}`);
                if (test.primaryPattern) {
                    console.log(`     Primary Pattern: ${test.primaryPattern}`);
                }
                if (test.issues) {
                    test.issues.forEach(issue => console.log(`     - ${issue}`));
                }
                if (test.warnings && test.warnings.length > 0) {
                    console.log(`     Warnings: ${test.warnings.length}`);
                }
            });
    }
    
    console.log(`\n🎯 PERFORMANCE ANALYSIS:`);
    const avgScanTime = Math.round(results.details.reduce((sum, test) => sum + (test.scanTime || 0), 0) / results.details.length);
    const maxScanTime = Math.max(...results.details.map(test => test.scanTime || 0));
    const minScanTime = Math.min(...results.details.map(test => test.scanTime || 0));
    
    console.log(`   Average scan time: ${avgScanTime}ms`);
    console.log(`   Max scan time: ${maxScanTime}ms`);
    console.log(`   Min scan time: ${minScanTime}ms`);
    
    console.log(`\n🎯 RECOMMENDATIONS:`);
    if (successRate === 100) {
        console.log('   🎉 Perfect! Phase6a correctly identifies all test cases.');
        console.log('   ✅ Ready for production deployment.');
    } else if (successRate >= 90) {
        console.log('   👍 Excellent accuracy with minor issues.');
        console.log('   🔧 Review failed cases for fine-tuning.');
    } else if (successRate >= 75) {
        console.log('   ⚠️  Good accuracy but needs attention.');
        console.log('   🔧 Focus on reducing false positives and negatives.');
    } else if (successRate >= 50) {
        console.log('   ⚠️  Moderate accuracy - significant issues detected.');
        console.log('   🔧 Major scanner improvements needed.');
    } else {
        console.log('   🚨 Poor accuracy - critical issues detected.');
        console.log('   🔧 Complete scanner review required before deployment.');
    }
    
    if (results.crossContamination > 0) {
        console.log(`   🔧 Address ${results.crossContamination} cross-contamination issues between scanners.`);
    }
    
    if (results.falsePositives > 0) {
        console.log(`   🔧 Reduce ${results.falsePositives} false positives by adjusting scanner sensitivity.`);
    }
    
    if (results.falseNegatives > 0) {
        console.log(`   🔧 Address ${results.falseNegatives} false negatives by improving scanner coverage.`);
    }
    
    console.log('\n' + '='.repeat(80));
    
    return results;
}

/**
 * Main Test Runner
 */
async function main() {
    try {
        const results = await runComprehensiveTests();
        const report = generateComprehensiveReport(results);
        
        // Exit code für CI/CD
        process.exit(results.failed > 0 ? 1 : 0);
        
    } catch (error) {
        console.error('💥 Comprehensive test runner failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Führe Tests aus wenn Script direkt ausgeführt wird
if (require.main === module) {
    main();
}

module.exports = {
    runComprehensiveTests,
    validateComprehensiveResults,
    generateComprehensiveReport,
    COMPREHENSIVE_TEST_SITES
};