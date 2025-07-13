const express = require('express');
const cors = require('cors');

// Import all individual scanners
const ColorContrastScanner = require('./color-contrast-scanner');
const UseOfColorScanner = require('./use-of-color-scanner');
const ImagesOfTextScanner = require('./images-of-text-scanner');
const LanguageDetectionScanner = require('./language-detection-scanner');
const HTMLValidationScanner = require('./html-validation-scanner');
const KeyboardNavigationScanner = require('./keyboard-navigation-scanner');
const InputModalitiesScanner = require('./input-modalities-scanner');
const TimingControlsScanner = require('./timing-controls-scanner');
const SeizurePreventionScanner = require('./seizure-prevention-scanner');
const PredictableNavigationScanner = require('./predictable-navigation-scanner');
const ErrorHandlingScanner = require('./error-handling-scanner');
const EAAProcedureScanner = require('./eaa-procedure-scanner');
const FocusManagementScanner = require('./focus-management-scanner');
const PageStructureScanner = require('./page-structure-scanner');
const AccessibilityStatementScanner = require('./accessibility-statement-scanner');
const ContactMechanismScanner = require('./contact-mechanism-scanner');
const ComplianceMonitoringScanner = require('./compliance-monitoring-scanner');

/**
 * Individual Scanner API Server
 * Provides isolated testing endpoints for each accessibility scanner
 * Enables systematic false positive/negative analysis
 */
class IndividualScannerAPI {
    constructor() {
        this.app = express();
        this.port = process.env.INDIVIDUAL_SCANNER_PORT || 3001;
        
        // Initialize scanner instances
        this.scanners = {
            'color-contrast': new ColorContrastScanner(),
            'use-of-color': new UseOfColorScanner(),
            'images-of-text': new ImagesOfTextScanner(),
            'language-detection': new LanguageDetectionScanner(),
            'html-validation': new HTMLValidationScanner(),
            'keyboard-navigation': new KeyboardNavigationScanner(),
            'input-modalities': new InputModalitiesScanner(),
            'timing-controls': new TimingControlsScanner(),
            'seizure-prevention': new SeizurePreventionScanner(),
            'predictable-navigation': new PredictableNavigationScanner(),
            'error-handling': new ErrorHandlingScanner(),
            'eaa-procedure': new EAAProcedureScanner(),
            'focus-management': new FocusManagementScanner(),
            'page-structure': new PageStructureScanner(),
            'accessibility-statement': new AccessibilityStatementScanner(),
            'contact-mechanism': new ContactMechanismScanner(),
            'compliance-monitoring': new ComplianceMonitoringScanner()
        };
        
        this.setupMiddleware();
        this.setupRoutes();
    }
    
    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        
        // Request logging
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
            next();
        });
    }
    
    setupRoutes() {
        // Health check
        this.app.get('/api/health', (req, res) => {
            res.json({
                status: 'OK',
                service: 'Individual Scanner API',
                version: '1.0.0',
                availableScanners: Object.keys(this.scanners),
                timestamp: new Date().toISOString()
            });
        });
        
        // List all available scanners
        this.app.get('/api/scanners', (req, res) => {
            const scannerInfo = Object.keys(this.scanners).map(key => ({
                name: key,
                displayName: this.getScannerDisplayName(key),
                endpoint: `/api/scan/${key}`,
                description: this.getScannerDescription(key)
            }));
            
            res.json({
                totalScanners: scannerInfo.length,
                scanners: scannerInfo
            });
        });
        
        // Individual scanner endpoints
        this.createScannerEndpoints();
        
        // Batch testing endpoint
        this.app.post('/api/scan/batch', async (req, res) => {
            try {
                const { url, scanners: requestedScanners, options = {} } = req.body;
                
                if (!url) {
                    return res.status(400).json({ error: 'URL is required' });
                }
                
                const scannersToRun = requestedScanners || Object.keys(this.scanners);
                const results = {};
                
                console.log(`Running batch scan for ${scannersToRun.length} scanners on ${url}`);
                
                for (const scannerName of scannersToRun) {
                    if (this.scanners[scannerName]) {
                        try {
                            console.log(`  Running ${scannerName}...`);
                            const startTime = Date.now();
                            results[scannerName] = await this.runIndividualScanner(scannerName, url, options);
                            results[scannerName].scanDuration = Date.now() - startTime;
                        } catch (error) {
                            console.error(`  Error in ${scannerName}:`, error.message);
                            results[scannerName] = {
                                success: false,
                                error: error.message,
                                scanDuration: 0
                            };
                        }
                    }
                }
                
                res.json({
                    url,
                    totalScanners: scannersToRun.length,
                    results,
                    timestamp: new Date().toISOString()
                });
                
            } catch (error) {
                console.error('Batch scan error:', error);
                res.status(500).json({ error: 'Batch scan failed' });
            }
        });
        
        // Matrix testing endpoint
        this.app.post('/api/test/matrix', async (req, res) => {
            try {
                const { urls, scanners: requestedScanners, options = {} } = req.body;
                
                if (!urls || !Array.isArray(urls)) {
                    return res.status(400).json({ error: 'URLs array is required' });
                }
                
                const scannersToRun = requestedScanners || Object.keys(this.scanners);
                const matrix = {};
                
                console.log(`Running matrix test: ${urls.length} URLs × ${scannersToRun.length} scanners = ${urls.length * scannersToRun.length} combinations`);
                
                let completed = 0;
                const total = urls.length * scannersToRun.length;
                
                for (const url of urls) {
                    matrix[url] = {};
                    
                    for (const scannerName of scannersToRun) {
                        if (this.scanners[scannerName]) {
                            try {
                                const startTime = Date.now();
                                matrix[url][scannerName] = await this.runIndividualScanner(scannerName, url, options);
                                matrix[url][scannerName].scanDuration = Date.now() - startTime;
                                
                                completed++;
                                console.log(`  Progress: ${completed}/${total} (${Math.round(completed/total*100)}%) - ${scannerName} on ${url}`);
                                
                            } catch (error) {
                                console.error(`  Error: ${scannerName} on ${url}:`, error.message);
                                matrix[url][scannerName] = {
                                    success: false,
                                    error: error.message,
                                    scanDuration: 0
                                };
                                completed++;
                            }
                        }
                    }
                }
                
                res.json({
                    urls,
                    scanners: scannersToRun,
                    matrix,
                    summary: {
                        totalCombinations: total,
                        completed: completed,
                        successRate: `${Math.round(completed/total*100)}%`
                    },
                    timestamp: new Date().toISOString()
                });
                
            } catch (error) {
                console.error('Matrix test error:', error);
                res.status(500).json({ error: 'Matrix test failed' });
            }
        });
    }
    
    createScannerEndpoints() {
        Object.keys(this.scanners).forEach(scannerName => {
            this.app.post(`/api/scan/${scannerName}`, async (req, res) => {
                try {
                    const { url, options = {} } = req.body;
                    
                    if (!url) {
                        return res.status(400).json({ error: 'URL is required' });
                    }
                    
                    console.log(`Running ${scannerName} scanner on ${url}`);
                    const startTime = Date.now();
                    
                    const result = await this.runIndividualScanner(scannerName, url, options);
                    const scanDuration = Date.now() - startTime;
                    
                    res.json({
                        scanner: scannerName,
                        url,
                        result,
                        scanDuration,
                        timestamp: new Date().toISOString()
                    });
                    
                } catch (error) {
                    console.error(`${scannerName} scanner error:`, error);
                    res.status(500).json({ 
                        error: `${scannerName} scanner failed`,
                        details: error.message 
                    });
                }
            });
        });
    }
    
    async runIndividualScanner(scannerName, url, options = {}) {
        const scanner = this.scanners[scannerName];
        if (!scanner) {
            throw new Error(`Scanner ${scannerName} not found`);
        }
        
        // Call the appropriate scan method based on scanner type
        switch (scannerName) {
            case 'color-contrast':
                return await scanner.scanColorContrast(url, options);
            case 'use-of-color':
                return await scanner.scanColorDependency(url, options);
            case 'images-of-text':
                return await scanner.scanImagesOfText(url, options);
            case 'language-detection':
                return await scanner.scanLanguageCompliance(url, options);
            case 'html-validation':
                return await scanner.scanHTMLCompliance(url, options);
            case 'keyboard-navigation':
                return await scanner.scanKeyboardAccess(url, options);
            case 'input-modalities':
                return await scanner.scanInputModalities(url, options);
            case 'timing-controls':
                return await scanner.scanTimingControls(url, options);
            case 'seizure-prevention':
                return await scanner.scanSeizurePrevention(url, options);
            case 'predictable-navigation':
                return await scanner.scanPredictableNavigation(url, options);
            case 'error-handling':
                return await scanner.scanErrorHandling(url, options);
            case 'eaa-procedure':
                return await scanner.scanEAAProcedure(url, options);
            case 'focus-management':
                return await scanner.scanFocusManagement(url, options);
            case 'page-structure':
                return await scanner.scanPageStructure(url, options);
            case 'accessibility-statement':
                return await scanner.scanAccessibilityStatement(url, options);
            case 'contact-mechanism':
                return await scanner.scanContactMechanisms(url, options);
            case 'compliance-monitoring':
                return await scanner.scanComplianceMonitoring(url, options);
            default:
                throw new Error(`No scan method defined for ${scannerName}`);
        }
    }
    
    getScannerDisplayName(scannerName) {
        const displayNames = {
            'color-contrast': 'Color Contrast Scanner',
            'use-of-color': 'Use of Color Scanner',
            'images-of-text': 'Images of Text Scanner',
            'language-detection': 'Language Detection Scanner',
            'html-validation': 'HTML Validation Scanner',
            'keyboard-navigation': 'Keyboard Navigation Scanner',
            'input-modalities': 'Input Modalities Scanner',
            'timing-controls': 'Timing Controls Scanner',
            'seizure-prevention': 'Seizure Prevention Scanner',
            'predictable-navigation': 'Predictable Navigation Scanner',
            'error-handling': 'Error Handling Scanner',
            'eaa-procedure': 'EAA Procedure Scanner',
            'focus-management': 'Focus Management Scanner',
            'page-structure': 'Page Structure Scanner',
            'accessibility-statement': 'Accessibility Statement Scanner',
            'contact-mechanism': 'Contact Mechanism Scanner',
            'compliance-monitoring': 'Compliance Monitoring Scanner'
        };
        return displayNames[scannerName] || scannerName;
    }
    
    getScannerDescription(scannerName) {
        const descriptions = {
            'color-contrast': 'WCAG 1.4.3 - Tests color contrast ratios for text and background',
            'use-of-color': 'WCAG 1.4.1 - Checks for information conveyed by color alone',
            'images-of-text': 'WCAG 1.4.5 - Identifies text rendered as images',
            'language-detection': 'WCAG 3.1.1/3.1.2 - Validates language declarations',
            'html-validation': 'WCAG 4.1.1 - Checks HTML markup validity',
            'keyboard-navigation': 'WCAG 2.1.1 - Tests keyboard accessibility',
            'input-modalities': 'WCAG 2.5.1 - Validates input method alternatives',
            'timing-controls': 'WCAG 2.2.2 - Checks auto-playing content controls',
            'seizure-prevention': 'WCAG 2.3.1 - Tests for flashing content',
            'predictable-navigation': 'WCAG 3.2.1/3.2.2 - Validates predictable interactions',
            'error-handling': 'WCAG 3.3.1/3.3.3 - Tests error identification and handling',
            'eaa-procedure': 'EN 301 549 - European Accessibility Act compliance',
            'focus-management': 'WCAG 2.4.3 - Tests focus order and management',
            'page-structure': 'WCAG 1.3.1 - Validates semantic page structure',
            'accessibility-statement': 'Legal requirement - Accessibility statement presence',
            'contact-mechanism': 'Legal requirement - Accessible contact methods',
            'compliance-monitoring': 'Overall compliance monitoring and reporting'
        };
        return descriptions[scannerName] || 'Accessibility compliance scanner';
    }
    
    async start() {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                console.log(`🚀 Individual Scanner API running on http://localhost:${this.port}`);
                console.log(`📊 Available scanners: ${Object.keys(this.scanners).length}`);
                console.log(`🔗 Health check: http://localhost:${this.port}/api/health`);
                console.log(`📋 Scanner list: http://localhost:${this.port}/api/scanners`);
                console.log(`🧪 Individual endpoints: http://localhost:${this.port}/api/scan/{scanner-name}`);
                console.log(`📦 Batch testing: http://localhost:${this.port}/api/scan/batch`);
                console.log(`🔢 Matrix testing: http://localhost:${this.port}/api/test/matrix`);
                resolve();
            });
        });
    }
    
    async stop() {
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('Individual Scanner API stopped');
                    resolve();
                });
            });
        }
    }
}

// Export for use as module or direct execution
if (require.main === module) {
    const api = new IndividualScannerAPI();
    api.start().catch(console.error);
}

module.exports = IndividualScannerAPI;