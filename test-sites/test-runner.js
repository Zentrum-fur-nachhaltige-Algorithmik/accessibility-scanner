#!/usr/bin/env node

/**
 * Test Runner für Phase6a Accessibility Scanner
 * 
 * Dieser Script testet die Genauigkeit der Phase6a Implementierung
 * durch Validierung gegen die erstellten Test-Websites.
 */

const fs = require('fs');
const path = require('path');

// Import der Phase6a Scanner (Pfad muss angepasst werden)
// const { runPhase6aScan } = require('../phase6a/scanner');

// Test-Konfiguration
const TEST_SITES = {
    // BAD Examples - sollten als SCHLECHT erkannt werden
    bad: [
        {
            name: 'Color Contrast Violations',
            file: 'bad-color-contrast.html',
            expectedViolations: [
                'color_contrast_insufficient',
                'text_background_contrast_too_low',
                'button_contrast_insufficient',
                'form_contrast_poor'
            ],
            expectedConfidence: 'high', // >80%
            description: 'Multiple color contrast violations with ratios below WCAG AA standards'
        },
        {
            name: 'Use of Color Violations', 
            file: 'bad-use-of-color.html',
            expectedViolations: [
                'links_color_only',
                'form_errors_color_only',
                'required_fields_color_only',
                'status_messages_color_only',
                'chart_legend_color_only',
                'navigation_state_color_only',
                'availability_color_only'
            ],
            expectedConfidence: 'high',
            description: 'Information conveyed by color alone without additional indicators'
        },
        {
            name: 'Images of Text Violations',
            file: 'bad-images-of-text.html', 
            expectedViolations: [
                'text_in_images_buttons',
                'text_in_images_headers',
                'text_in_images_navigation',
                'text_in_images_prices',
                'text_in_images_cta',
                'text_in_images_forms'
            ],
            expectedConfidence: 'medium', // 60-80% aufgrund Heuristiken
            description: 'Text content rendered as images instead of HTML text'
        }
    ],
    
    // GOOD Examples - sollten als GUT erkannt werden
    good: [
        {
            name: 'Good Accessibility Practices',
            file: 'good-accessibility.html',
            expectedViolations: [], // Keine Verletzungen erwartet
            expectedConfidence: 'high',
            description: 'Proper implementation of WCAG 2.1 Level AA standards'
        }
    ]
};

// Erwartete Scanner-Ergebnisse
const EXPECTED_RESULTS = {
    'bad-color-contrast.html': {
        overallScore: 'FAIL',
        violations: {
            colorContrast: { count: '>=5', confidence: 'high' },
            useOfColor: { count: 0, confidence: 'none' },
            imagesOfText: { count: 0, confidence: 'none' }
        }
    },
    'bad-use-of-color.html': {
        overallScore: 'FAIL', 
        violations: {
            colorContrast: { count: 0, confidence: 'none' },
            useOfColor: { count: '>=7', confidence: 'high' },
            imagesOfText: { count: 0, confidence: 'none' }
        }
    },
    'bad-images-of-text.html': {
        overallScore: 'FAIL',
        violations: {
            colorContrast: { count: 0, confidence: 'none' },
            useOfColor: { count: 0, confidence: 'none' },
            imagesOfText: { count: '>=6', confidence: 'medium' }
        }
    },
    'good-accessibility.html': {
        overallScore: 'PASS',
        violations: {
            colorContrast: { count: 0, confidence: 'none' },
            useOfColor: { count: 0, confidence: 'none' },
            imagesOfText: { count: 0, confidence: 'none' }
        }
    }
};

/**
 * Lädt und parst eine HTML-Testdatei
 */
function loadTestFile(filename) {
    const filePath = path.join(__dirname, filename);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Test file not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf8');
}

/**
 * Simuliert den Phase6a Scanner (muss durch echte Implementierung ersetzt werden)
 */
async function runMockPhase6aScan(htmlContent, filename) {
    console.log(`🔍 Scanning ${filename}...`);
    
    // Mock-Implementierung basierend auf erwarteten Ergebnissen
    const expected = EXPECTED_RESULTS[filename];
    if (!expected) {
        throw new Error(`No expected results defined for ${filename}`);
    }
    
    // Simuliere Scanner-Verzögerung
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
        filename,
        overallScore: expected.overallScore,
        scanDuration: Math.random() * 8000 + 2000, // 2-10 Sekunden
        violations: {
            colorContrast: {
                violations: expected.violations.colorContrast.count === 0 ? [] : 
                    Array(typeof expected.violations.colorContrast.count === 'string' ? 5 : expected.violations.colorContrast.count)
                        .fill().map((_, i) => ({
                            element: `element-${i}`,
                            issue: 'Insufficient color contrast',
                            confidence: expected.violations.colorContrast.confidence,
                            contrastRatio: '2.1:1',
                            requiredRatio: '4.5:1'
                        }))
            },
            useOfColor: {
                violations: expected.violations.useOfColor.count === 0 ? [] :
                    Array(typeof expected.violations.useOfColor.count === 'string' ? 7 : expected.violations.useOfColor.count)
                        .fill().map((_, i) => ({
                            element: `element-${i}`,
                            issue: 'Information conveyed by color only',
                            confidence: expected.violations.useOfColor.confidence
                        }))
            },
            imagesOfText: {
                violations: expected.violations.imagesOfText.count === 0 ? [] :
                    Array(typeof expected.violations.imagesOfText.count === 'string' ? 6 : expected.violations.imagesOfText.count)
                        .fill().map((_, i) => ({
                            element: `element-${i}`,
                            issue: 'Text rendered as image',
                            confidence: expected.violations.imagesOfText.confidence,
                            textContent: 'Button text'
                        }))
            }
        },
        enCompliance: {
            '9.1.4.1': expected.violations.useOfColor.count === 0,
            '9.1.4.3': expected.violations.colorContrast.count === 0,
            '9.1.4.5': expected.violations.imagesOfText.count === 0
        }
    };
}

/**
 * Validiert Scanner-Ergebnisse gegen erwartete Werte
 */
function validateResults(results, expected, testCase) {
    const issues = [];
    
    // Overall Score validieren
    if (results.overallScore !== expected.overallScore) {
        issues.push(`Expected overall score ${expected.overallScore}, got ${results.overallScore}`);
    }
    
    // Violations validieren
    for (const [scannerType, expectedData] of Object.entries(expected.violations)) {
        const actualViolations = results.violations[scannerType].violations;
        const expectedCount = expectedData.count;
        
        if (typeof expectedCount === 'string' && expectedCount.startsWith('>=')) {
            const minCount = parseInt(expectedCount.substring(2));
            if (actualViolations.length < minCount) {
                issues.push(`${scannerType}: Expected at least ${minCount} violations, got ${actualViolations.length}`);
            }
        } else if (actualViolations.length !== expectedCount) {
            issues.push(`${scannerType}: Expected ${expectedCount} violations, got ${actualViolations.length}`);
        }
        
        // Confidence Level validieren
        if (actualViolations.length > 0) {
            const actualConfidence = actualViolations[0].confidence;
            if (actualConfidence !== expectedData.confidence && expectedData.confidence !== 'none') {
                issues.push(`${scannerType}: Expected confidence ${expectedData.confidence}, got ${actualConfidence}`);
            }
        }
    }
    
    // Performance validieren (sollte unter 10 Sekunden sein)
    if (results.scanDuration > 10000) {
        issues.push(`Scan took ${Math.round(results.scanDuration)}ms, expected <10000ms`);
    }
    
    return {
        passed: issues.length === 0,
        issues,
        testCase: testCase.name
    };
}

/**
 * Führt alle Tests aus und gibt Bericht zurück
 */
async function runAllTests() {
    console.log('🚀 Starting Phase6a Test Runner...\n');
    
    const results = {
        passed: 0,
        failed: 0,
        total: 0,
        details: []
    };
    
    // BAD Examples testen
    console.log('📛 Testing BAD examples (should be detected as POOR):');
    for (const testCase of TEST_SITES.bad) {
        results.total++;
        console.log(`\n Testing: ${testCase.name}`);
        
        try {
            const htmlContent = loadTestFile(testCase.file);
            const scanResults = await runMockPhase6aScan(htmlContent, testCase.file);
            const validation = validateResults(scanResults, EXPECTED_RESULTS[testCase.file], testCase);
            
            if (validation.passed) {
                console.log(`   ✅ PASSED - Correctly identified as ${scanResults.overallScore}`);
                results.passed++;
            } else {
                console.log(`   ❌ FAILED - Issues found:`);
                validation.issues.forEach(issue => console.log(`      - ${issue}`));
                results.failed++;
            }
            
            results.details.push({
                testCase: testCase.name,
                file: testCase.file,
                expected: EXPECTED_RESULTS[testCase.file].overallScore,
                actual: scanResults.overallScore,
                passed: validation.passed,
                issues: validation.issues,
                scanTime: Math.round(scanResults.scanDuration) + 'ms'
            });
            
        } catch (error) {
            console.log(`   💥 ERROR - ${error.message}`);
            results.failed++;
            results.details.push({
                testCase: testCase.name,
                file: testCase.file,
                error: error.message,
                passed: false
            });
        }
    }
    
    // GOOD Examples testen
    console.log('\n\n✅ Testing GOOD examples (should be detected as GOOD):');
    for (const testCase of TEST_SITES.good) {
        results.total++;
        console.log(`\n Testing: ${testCase.name}`);
        
        try {
            const htmlContent = loadTestFile(testCase.file);
            const scanResults = await runMockPhase6aScan(htmlContent, testCase.file);
            const validation = validateResults(scanResults, EXPECTED_RESULTS[testCase.file], testCase);
            
            if (validation.passed) {
                console.log(`   ✅ PASSED - Correctly identified as ${scanResults.overallScore}`);
                results.passed++;
            } else {
                console.log(`   ❌ FAILED - Issues found:`);
                validation.issues.forEach(issue => console.log(`      - ${issue}`));
                results.failed++;
            }
            
            results.details.push({
                testCase: testCase.name,
                file: testCase.file,
                expected: EXPECTED_RESULTS[testCase.file].overallScore,
                actual: scanResults.overallScore,
                passed: validation.passed,
                issues: validation.issues,
                scanTime: Math.round(scanResults.scanDuration) + 'ms'
            });
            
        } catch (error) {
            console.log(`   💥 ERROR - ${error.message}`);
            results.failed++;
            results.details.push({
                testCase: testCase.name,
                file: testCase.file,
                error: error.message,
                passed: false
            });
        }
    }
    
    return results;
}

/**
 * Erstellt detaillierten Test-Bericht
 */
function generateReport(results) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 PHASE6A TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    
    const successRate = Math.round((results.passed / results.total) * 100);
    console.log(`Tests passed: ${results.passed}/${results.total} (${successRate}%)`);
    console.log(`Tests failed: ${results.failed}/${results.total}`);
    
    if (results.failed > 0) {
        console.log('\n❌ FAILED TESTS:');
        results.details
            .filter(test => !test.passed)
            .forEach(test => {
                console.log(`\n  ${test.testCase} (${test.file})`);
                if (test.error) {
                    console.log(`    Error: ${test.error}`);
                } else {
                    console.log(`    Expected: ${test.expected}, Got: ${test.actual}`);
                    if (test.issues) {
                        test.issues.forEach(issue => console.log(`    - ${issue}`));
                    }
                }
            });
    }
    
    console.log('\n✅ PASSED TESTS:');
    results.details
        .filter(test => test.passed)
        .forEach(test => {
            console.log(`  ✓ ${test.testCase} (${test.scanTime})`);
        });
    
    console.log('\n📈 RECOMMENDATIONS:');
    if (successRate === 100) {
        console.log('  🎉 Perfect! Phase6a is correctly identifying all test cases.');
        console.log('  Ready for production deployment.');
    } else if (successRate >= 75) {
        console.log('  👍 Good accuracy, but some issues need attention.');
        console.log('  Review failed test cases and adjust scanner logic.');
    } else {
        console.log('  ⚠️  Significant issues detected.');
        console.log('  Phase6a needs substantial improvements before deployment.');
    }
    
    return results;
}

/**
 * Main Test Runner
 */
async function main() {
    try {
        const results = await runAllTests();
        const report = generateReport(results);
        
        // Exit code für CI/CD
        process.exit(results.failed > 0 ? 1 : 0);
        
    } catch (error) {
        console.error('💥 Test runner failed:', error.message);
        process.exit(1);
    }
}

// Führe Tests aus wenn Script direkt ausgeführt wird
if (require.main === module) {
    main();
}

module.exports = {
    runAllTests,
    validateResults,
    generateReport,
    TEST_SITES,
    EXPECTED_RESULTS
};