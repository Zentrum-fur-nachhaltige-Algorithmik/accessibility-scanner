#!/usr/bin/env node

/**
 * Visual Baseline Creator - Phase 1.1 des Iterative Debugging Plans
 * 
 * Erstellt umfassende visuelle Baselines aller Test-Cases mit:
 * - Original Screenshots
 * - Kontrast-Heatmaps 
 * - Color-Usage-Annotationen
 * - Images-of-Text-Detektionen
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Konfiguration
const STATIC_SERVER_PORT = 8086;
const BASELINE_DIR = path.join(__dirname, '../test-sites/baseline');
const TEST_CASES = [
    { name: 'bad-color-contrast', file: 'bad-color-contrast.html' },
    { name: 'bad-use-of-color', file: 'bad-use-of-color.html' },
    { name: 'bad-images-of-text', file: 'bad-images-of-text.html' },
    { name: 'good-accessibility', file: 'good-accessibility.html' }
];

// Erstelle Output-Verzeichnis
if (!fs.existsSync(BASELINE_DIR)) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
}

class VisualBaselineCreator {
    constructor() {
        this.browser = null;
        this.server = null;
    }

    async initialize() {
        console.log('🚀 Initializing Visual Baseline Creator...');
        
        // Start HTTP Server
        this.server = await this.startStaticServer();
        
        // Start Browser
        this.browser = await puppeteer.launch({
            headless: false, // Show browser for debugging
            defaultViewport: { width: 1280, height: 1024 },
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        console.log('✅ Browser and server ready');
    }

    async startStaticServer() {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                
                if (req.url === '/') {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Visual Baseline Server');
                    return;
                }
                
                const filePath = path.join(__dirname, '../test-sites', req.url);
                if (!fs.existsSync(filePath)) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                
                const content = fs.readFileSync(filePath, 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(content);
            });
            
            server.listen(STATIC_SERVER_PORT, (err) => {
                if (err) reject(err);
                else {
                    console.log(`📡 Static server running on port ${STATIC_SERVER_PORT}`);
                    resolve(server);
                }
            });
        });
    }

    /**
     * STEP 1: Capture original state
     */
    async captureOriginalState(testCase) {
        console.log(`📸 Capturing original state: ${testCase.name}`);
        
        const page = await this.browser.newPage();
        const url = `http://localhost:${STATIC_SERVER_PORT}/${testCase.file}`;
        
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Full page screenshot
            await page.screenshot({
                path: path.join(BASELINE_DIR, `${testCase.name}-original.png`),
                fullPage: true
            });
            
            // Viewport screenshot
            await page.screenshot({
                path: path.join(BASELINE_DIR, `${testCase.name}-viewport.png`)
            });
            
            console.log(`   ✅ Original screenshots saved`);
            
        } catch (error) {
            console.log(`   ❌ Error capturing original: ${error.message}`);
        } finally {
            await page.close();
        }
    }

    /**
     * STEP 2: Create contrast heatmap
     */
    async createContrastHeatmap(testCase) {
        console.log(`🎨 Creating contrast heatmap: ${testCase.name}`);
        
        const page = await this.browser.newPage();
        const url = `http://localhost:${STATIC_SERVER_PORT}/${testCase.file}`;
        
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Inject contrast analysis
            const contrastResults = await page.evaluate(() => {
                // Helper functions
                function parseColor(colorString) {
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
                
                function getRelativeLuminance(color) {
                    const rsRGB = color.r / 255;
                    const gsRGB = color.g / 255;
                    const bsRGB = color.b / 255;
                    
                    const r = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
                    const g = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
                    const b = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
                    
                    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
                }
                
                function calculateContrastRatio(color1, color2) {
                    const l1 = getRelativeLuminance(color1);
                    const l2 = getRelativeLuminance(color2);
                    const lighter = Math.max(l1, l2);
                    const darker = Math.min(l1, l2);
                    return (lighter + 0.05) / (darker + 0.05);
                }
                
                const results = [];
                const textElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, a, span, div, button, label, li');
                
                textElements.forEach(element => {
                    const text = element.textContent.trim();
                    if (!text || text.length === 0) return;
                    if (element.offsetWidth === 0 || element.offsetHeight === 0) return;
                    
                    const style = window.getComputedStyle(element);
                    const foregroundColor = parseColor(style.color);
                    const backgroundColor = parseColor(style.backgroundColor);
                    
                    if (!foregroundColor) return;
                    
                    // Simplified background detection
                    let bgColor = backgroundColor;
                    if (!bgColor || bgColor.a < 1) {
                        // Use white as fallback
                        bgColor = { r: 255, g: 255, b: 255, a: 1 };
                    }
                    
                    const contrastRatio = calculateContrastRatio(foregroundColor, bgColor);
                    const isLargeText = parseFloat(style.fontSize) >= 18 || 
                                       (parseFloat(style.fontSize) >= 14 && style.fontWeight === 'bold');
                    const requiredRatio = isLargeText ? 3.0 : 4.5;
                    const passes = contrastRatio >= requiredRatio;
                    
                    results.push({
                        element: element,
                        contrastRatio: contrastRatio,
                        requiredRatio: requiredRatio,
                        passes: passes,
                        text: text.substring(0, 50)
                    });
                    
                    // Add visual indicators
                    const indicator = document.createElement('div');
                    indicator.style.cssText = `
                        position: absolute !important;
                        top: ${element.offsetTop - 25}px !important;
                        left: ${element.offsetLeft}px !important;
                        background: ${passes ? '#4caf50' : '#f44336'} !important;
                        color: white !important;
                        padding: 2px 6px !important;
                        font-size: 12px !important;
                        z-index: 9999 !important;
                        border-radius: 3px !important;
                        font-family: monospace !important;
                        pointer-events: none !important;
                    `;
                    indicator.textContent = `${contrastRatio.toFixed(2)}:1`;
                    document.body.appendChild(indicator);
                    
                    // Outline problematic elements
                    if (!passes) {
                        element.style.outline = '3px solid red';
                        element.style.outlineOffset = '2px';
                    } else {
                        element.style.outline = '1px solid green';
                    }
                });
                
                return results;
            });
            
            // Take screenshot with overlays
            await page.screenshot({
                path: path.join(BASELINE_DIR, `${testCase.name}-contrast-heatmap.png`),
                fullPage: true
            });
            
            // Save contrast analysis data
            const analysisPath = path.join(BASELINE_DIR, `${testCase.name}-contrast-analysis.json`);
            fs.writeFileSync(analysisPath, JSON.stringify({
                testCase: testCase.name,
                timestamp: new Date().toISOString(),
                contrastResults: contrastResults.map(r => ({
                    contrastRatio: r.contrastRatio,
                    requiredRatio: r.requiredRatio,
                    passes: r.passes,
                    text: r.text
                })),
                summary: {
                    totalElements: contrastResults.length,
                    passingElements: contrastResults.filter(r => r.passes).length,
                    failingElements: contrastResults.filter(r => !r.passes).length
                }
            }, null, 2));
            
            console.log(`   ✅ Contrast heatmap created (${contrastResults.length} elements analyzed)`);
            console.log(`   📊 ${contrastResults.filter(r => !r.passes).length} contrast violations found`);
            
        } catch (error) {
            console.log(`   ❌ Error creating contrast heatmap: ${error.message}`);
        } finally {
            await page.close();
        }
    }

    /**
     * STEP 3: Annotate color usage
     */
    async annotateColorUsage(testCase) {
        console.log(`🌈 Annotating color usage: ${testCase.name}`);
        
        const page = await this.browser.newPage();
        const url = `http://localhost:${STATIC_SERVER_PORT}/${testCase.file}`;
        
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            const colorResults = await page.evaluate(() => {
                const results = [];
                
                // Check links
                const links = document.querySelectorAll('a[href]');
                links.forEach(link => {
                    const linkStyle = window.getComputedStyle(link);
                    const parentStyle = window.getComputedStyle(link.parentElement);
                    
                    const hasUnderline = linkStyle.textDecoration.includes('underline');
                    const hasBorder = linkStyle.borderWidth !== '0px';
                    const hasColorDiff = linkStyle.color !== parentStyle.color;
                    
                    if (hasColorDiff && !hasUnderline && !hasBorder) {
                        results.push({
                            type: 'color-only-link',
                            element: link,
                            issue: 'Link distinguished only by color'
                        });
                        
                        // Mark element
                        link.style.outline = '3px solid orange';
                        link.style.outlineOffset = '2px';
                        
                        // Add indicator
                        const indicator = document.createElement('div');
                        indicator.style.cssText = `
                            position: absolute !important;
                            top: ${link.offsetTop - 25}px !important;
                            left: ${link.offsetLeft}px !important;
                            background: orange !important;
                            color: white !important;
                            padding: 2px 6px !important;
                            font-size: 12px !important;
                            z-index: 9999 !important;
                            border-radius: 3px !important;
                        `;
                        indicator.textContent = 'COLOR-ONLY';
                        document.body.appendChild(indicator);
                    }
                });
                
                // Check status messages
                const statusElements = document.querySelectorAll('[class*="status"], [class*="error"], [class*="warning"], [class*="success"]');
                statusElements.forEach(element => {
                    const hasIcon = /[✓✗⚠❌✅]/.test(element.textContent);
                    const hasText = /\\b(error|warning|success|info)\\b/i.test(element.textContent);
                    const style = window.getComputedStyle(element);
                    const hasBackground = style.backgroundColor !== 'transparent';
                    
                    if (hasBackground && !hasIcon && !hasText) {
                        results.push({
                            type: 'color-only-status',
                            element: element,
                            issue: 'Status indicated only by color'
                        });
                        
                        element.style.outline = '3px solid red';
                        element.style.outlineOffset = '2px';
                    }
                });
                
                return results;
            });
            
            await page.screenshot({
                path: path.join(BASELINE_DIR, `${testCase.name}-color-annotations.png`),
                fullPage: true
            });
            
            // Save color usage analysis
            const analysisPath = path.join(BASELINE_DIR, `${testCase.name}-color-analysis.json`);
            fs.writeFileSync(analysisPath, JSON.stringify({
                testCase: testCase.name,
                timestamp: new Date().toISOString(),
                colorResults: colorResults.map(r => ({
                    type: r.type,
                    issue: r.issue
                })),
                summary: {
                    colorOnlyLinks: colorResults.filter(r => r.type === 'color-only-link').length,
                    colorOnlyStatus: colorResults.filter(r => r.type === 'color-only-status').length
                }
            }, null, 2));
            
            console.log(`   ✅ Color usage annotated (${colorResults.length} issues found)`);
            
        } catch (error) {
            console.log(`   ❌ Error annotating color usage: ${error.message}`);
        } finally {
            await page.close();
        }
    }

    /**
     * STEP 4: Detect text images
     */
    async detectTextImages(testCase) {
        console.log(`🖼️ Detecting text images: ${testCase.name}`);
        
        const page = await this.browser.newPage();
        const url = `http://localhost:${STATIC_SERVER_PORT}/${testCase.file}`;
        
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            const imageResults = await page.evaluate(() => {
                const results = [];
                
                // Check IMG elements
                const images = document.querySelectorAll('img');
                images.forEach(img => {
                    const src = img.src || '';
                    const alt = img.alt || '';
                    const className = img.className || '';
                    
                    let confidence = 0;
                    const reasons = [];
                    
                    // Text-related keywords
                    if (/\\b(button|btn|nav|text|heading)\\b/i.test(src + alt + className)) {
                        confidence += 40;
                        reasons.push('text keywords');
                    }
                    
                    // Button-like dimensions
                    const isButtonSize = img.offsetWidth > 60 && img.offsetWidth < 300 && 
                                        img.offsetHeight > 20 && img.offsetHeight < 60;
                    if (isButtonSize) {
                        confidence += 30;
                        reasons.push('button dimensions');
                    }
                    
                    // Context clues
                    if (img.closest('nav, form, .nav, .button')) {
                        confidence += 20;
                        reasons.push('navigation/form context');
                    }
                    
                    if (confidence >= 50) {
                        results.push({
                            type: 'suspected-text-image',
                            element: img,
                            confidence: confidence,
                            reasons: reasons,
                            src: src
                        });
                        
                        // Add bounding box
                        img.style.outline = '3px solid purple';
                        img.style.outlineOffset = '2px';
                        
                        // Add indicator
                        const indicator = document.createElement('div');
                        indicator.style.cssText = `
                            position: absolute !important;
                            top: ${img.offsetTop - 25}px !important;
                            left: ${img.offsetLeft}px !important;
                            background: purple !important;
                            color: white !important;
                            padding: 2px 6px !important;
                            font-size: 12px !important;
                            z-index: 9999 !important;
                            border-radius: 3px !important;
                        `;
                        indicator.textContent = `TEXT-IMG ${confidence}%`;
                        document.body.appendChild(indicator);
                    }
                });
                
                // Check background images with text content
                const elementsWithBgImg = Array.from(document.querySelectorAll('*')).filter(el => {
                    const style = window.getComputedStyle(el);
                    return style.backgroundImage && style.backgroundImage !== 'none' && el.textContent.trim();
                });
                
                elementsWithBgImg.forEach(element => {
                    if (element.textContent.trim().length > 5) {
                        results.push({
                            type: 'background-text-image',
                            element: element,
                            confidence: 60,
                            reasons: ['background image with text overlay']
                        });
                        
                        element.style.outline = '3px dashed purple';
                        element.style.outlineOffset = '2px';
                    }
                });
                
                return results;
            });
            
            await page.screenshot({
                path: path.join(BASELINE_DIR, `${testCase.name}-text-images-detected.png`),
                fullPage: true
            });
            
            // Save image analysis
            const analysisPath = path.join(BASELINE_DIR, `${testCase.name}-images-analysis.json`);
            fs.writeFileSync(analysisPath, JSON.stringify({
                testCase: testCase.name,
                timestamp: new Date().toISOString(),
                imageResults: imageResults.map(r => ({
                    type: r.type,
                    confidence: r.confidence,
                    reasons: r.reasons,
                    src: r.src
                })),
                summary: {
                    suspectedTextImages: imageResults.filter(r => r.type === 'suspected-text-image').length,
                    backgroundTextImages: imageResults.filter(r => r.type === 'background-text-image').length
                }
            }, null, 2));
            
            console.log(`   ✅ Text images detected (${imageResults.length} suspects found)`);
            
        } catch (error) {
            console.log(`   ❌ Error detecting text images: ${error.message}`);
        } finally {
            await page.close();
        }
    }

    /**
     * Create comprehensive baseline for all test cases
     */
    async createBaseline() {
        console.log('🎯 Creating comprehensive visual baseline...\n');
        
        for (const testCase of TEST_CASES) {
            console.log(`\n📋 Processing: ${testCase.name}`);
            
            await this.captureOriginalState(testCase);
            await this.createContrastHeatmap(testCase);
            await this.annotateColorUsage(testCase);
            await this.detectTextImages(testCase);
            
            // Pause between test cases
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // Generate summary report
        await this.generateSummaryReport();
    }

    /**
     * Generate HTML summary report
     */
    async generateSummaryReport() {
        console.log('\n📊 Generating summary report...');
        
        const reportPath = path.join(BASELINE_DIR, 'baseline-summary.html');
        
        const html = `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Phase6a Visual Baseline Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .test-case { margin: 40px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
        .screenshots { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
        .screenshot-group { text-align: center; }
        .screenshot-group img { max-width: 100%; border: 1px solid #ccc; }
        .analysis-summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0; }
        .critical { background: #ffebee; border-left: 5px solid #f44336; }
        .good { background: #e8f5e8; border-left: 5px solid #4caf50; }
    </style>
</head>
<body>
    <h1>🎯 Phase6a Visual Baseline Report</h1>
    <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
    <p><strong>Purpose:</strong> Visual evidence for iterative debugging of Phase6a scanners</p>
    
    ${TEST_CASES.map(testCase => {
        const contrastFile = path.join(BASELINE_DIR, `${testCase.name}-contrast-analysis.json`);
        const colorFile = path.join(BASELINE_DIR, `${testCase.name}-color-analysis.json`);
        const imageFile = path.join(BASELINE_DIR, `${testCase.name}-images-analysis.json`);
        
        let contrastData = {}, colorData = {}, imageData = {};
        
        try {
            if (fs.existsSync(contrastFile)) contrastData = JSON.parse(fs.readFileSync(contrastFile, 'utf8'));
            if (fs.existsSync(colorFile)) colorData = JSON.parse(fs.readFileSync(colorFile, 'utf8'));
            if (fs.existsSync(imageFile)) imageData = JSON.parse(fs.readFileSync(imageFile, 'utf8'));
        } catch (e) {}
        
        const isCritical = testCase.name === 'good-accessibility';
        
        return `
        <div class="test-case ${isCritical ? 'critical' : ''}">
            <h2>${testCase.name} ${isCritical ? '🚨 CRITICAL TEST' : ''}</h2>
            <p><strong>File:</strong> ${testCase.file}</p>
            ${isCritical ? '<p><strong>⚠️ This should pass all scanners with minimal violations!</strong></p>' : ''}
            
            <div class="screenshots">
                <div class="screenshot-group">
                    <h3>Original + Contrast Heatmap</h3>
                    <img src="${testCase.name}-original.png" alt="Original">
                    <img src="${testCase.name}-contrast-heatmap.png" alt="Contrast Heatmap">
                </div>
                <div class="screenshot-group">
                    <h3>Color Usage + Text Images</h3>
                    <img src="${testCase.name}-color-annotations.png" alt="Color Usage">
                    <img src="${testCase.name}-text-images-detected.png" alt="Text Images">
                </div>
            </div>
            
            <div class="analysis-summary">
                <h3>📊 Analysis Summary</h3>
                <p><strong>Contrast Issues:</strong> ${contrastData.summary?.failingElements || 'N/A'} elements fail requirements</p>
                <p><strong>Color-Only Issues:</strong> ${(colorData.summary?.colorOnlyLinks || 0) + (colorData.summary?.colorOnlyStatus || 0)} elements rely only on color</p>
                <p><strong>Text Images:</strong> ${(imageData.summary?.suspectedTextImages || 0) + (imageData.summary?.backgroundTextImages || 0)} suspected text images</p>
            </div>
        </div>`;
    }).join('')}
    
    <div class="analysis-summary good">
        <h2>🎯 Next Steps</h2>
        <ol>
            <li><strong>Run API Analysis:</strong> <code>node analyze-current-api.js</code></li>
            <li><strong>Compare Visual vs API:</strong> <code>node compare-visual-vs-api.js</code></li>
            <li><strong>Start Scanner Debugging:</strong> <code>node debug-color-contrast.js --test-case=good-accessibility</code></li>
        </ol>
        
        <h3>🔍 Key Findings</h3>
        <ul>
            <li>Visual baseline established for all 4 test cases</li>
            <li>Contrast issues clearly marked with red outlines</li>
            <li>Color-only elements highlighted in orange</li>
            <li>Suspected text images outlined in purple</li>
            <li>Ready for API comparison and iterative debugging</li>
        </ul>
    </div>
</body>
</html>`;
        
        fs.writeFileSync(reportPath, html);
        console.log(`✅ Summary report generated: ${reportPath}`);
    }

    async cleanup() {
        if (this.browser) await this.browser.close();
        if (this.server) this.server.close();
    }
}

// Main execution
async function main() {
    const creator = new VisualBaselineCreator();
    
    try {
        await creator.initialize();
        await creator.createBaseline();
        console.log('\n🎉 Visual baseline creation complete!');
        console.log(`📋 Results saved in: ${BASELINE_DIR}`);
        console.log(`📊 Open: ${path.join(BASELINE_DIR, 'baseline-summary.html')}`);
        
    } catch (error) {
        console.error('💥 Visual baseline creation failed:', error);
    } finally {
        await creator.cleanup();
    }
}

if (require.main === module) {
    main();
}