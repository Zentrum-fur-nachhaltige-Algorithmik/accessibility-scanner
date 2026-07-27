#!/usr/bin/env node

/**
 * Iteratives Phase6a Debugging mit Browser-Automatisierung und Screenshots
 * 
 * Verwendet Puppeteer für Browser-Automatisierung und Screenshots
 * zur visuellen Verifikation der Phase6a Scanner-Ergebnisse
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Konfiguration
const API_BASE_URL = 'http://localhost:3000';
const STATIC_SERVER_PORT = 8083;
const SCREENSHOTS_DIR = path.join(__dirname, 'debug-screenshots');
const DEBUG_REPORTS_DIR = path.join(__dirname, 'debug-reports');

// Erstelle Output-Verzeichnisse
if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}
if (!fs.existsSync(DEBUG_REPORTS_DIR)) {
    fs.mkdirSync(DEBUG_REPORTS_DIR, { recursive: true });
}

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
 * Startet HTTP-Server für Test-Dateien
 */
function startDebugServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Iterative Debug Server Running');
                return;
            }
            
            const filePath = path.join(__dirname, req.url);
            if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
                return;
            }
            
            const content = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        });
        
        server.listen(STATIC_SERVER_PORT, (err) => {
            if (err) reject(err);
            else {
                console.log(`🌐 Debug server running on http://localhost:${STATIC_SERVER_PORT}`);
                resolve(server);
            }
        });
    });
}

/**
 * Nimmt Screenshots einer Webseite
 */
async function takeScreenshots(browser, url, testName) {
    console.log(`📸 Taking screenshots for: ${testName}`);
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 });
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Full page screenshot
        const fullScreenshotPath = path.join(SCREENSHOTS_DIR, `${testName}-full-page.png`);
        await page.screenshot({ 
            path: fullScreenshotPath,
            fullPage: true 
        });
        console.log(`   ✅ Full page: ${fullScreenshotPath}`);
        
        // Viewport screenshot
        const viewportScreenshotPath = path.join(SCREENSHOTS_DIR, `${testName}-viewport.png`);
        await page.screenshot({ 
            path: viewportScreenshotPath 
        });
        console.log(`   ✅ Viewport: ${viewportScreenshotPath}`);
        
        return {
            fullPage: fullScreenshotPath,
            viewport: viewportScreenshotPath
        };
        
    } catch (error) {
        console.log(`   ❌ Screenshot error: ${error.message}`);
        return null;
    } finally {
        await page.close();
    }
}

/**
 * Analysiert Color Contrast visuell im Browser
 */
async function analyzeColorContrast(browser, url, testName) {
    console.log(`🎨 Analyzing color contrast for: ${testName}`);
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 });
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // JavaScript im Browser ausführen um Kontraste zu messen
        const contrastAnalysis = await page.evaluate(() => {
            function getComputedColor(element) {
                const style = window.getComputedStyle(element);
                return {
                    color: style.color,
                    backgroundColor: style.backgroundColor,
                    element: element.tagName.toLowerCase() + (element.className ? '.' + element.className.split(' ').join('.') : ''),
                    text: element.textContent.trim().substring(0, 50)
                };
            }
            
            function parseRGB(rgb) {
                const match = rgb.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
                if (!match) return null;
                return {
                    r: parseInt(match[1]),
                    g: parseInt(match[2]),
                    b: parseInt(match[3]),
                    a: match[4] ? parseFloat(match[4]) : 1
                };
            }
            
            function getLuminance(r, g, b) {
                const [rs, gs, bs] = [r, g, b].map(c => {
                    c = c / 255;
                    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
                });
                return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
            }
            
            function getContrastRatio(color1, color2) {
                const l1 = getLuminance(color1.r, color1.g, color1.b);
                const l2 = getLuminance(color2.r, color2.g, color2.b);
                const lighter = Math.max(l1, l2);
                const darker = Math.min(l1, l2);
                return (lighter + 0.05) / (darker + 0.05);
            }
            
            const textElements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, a, span, div, button, label, li'));
            const analysis = [];
            
            textElements.forEach(element => {
                if (element.textContent.trim().length === 0) return;
                
                const colors = getComputedColor(element);
                const foreground = parseRGB(colors.color);
                const background = parseRGB(colors.backgroundColor);
                
                if (foreground && background && background.a > 0) {
                    const contrast = getContrastRatio(foreground, background);
                    analysis.push({
                        ...colors,
                        contrastRatio: Math.round(contrast * 100) / 100,
                        wcagAA: contrast >= 4.5,
                        wcagAAA: contrast >= 7.0,
                        fontSize: window.getComputedStyle(element).fontSize
                    });
                }
            });
            
            return analysis.sort((a, b) => a.contrastRatio - b.contrastRatio);
        });
        
        // Screenshot mit Overlay für problematische Elemente
        await page.addStyleTag({
            content: `
                [data-contrast-violation] {
                    outline: 3px solid red !important;
                    position: relative !important;
                }
                [data-contrast-violation]::after {
                    content: "⚠ " attr(data-contrast-ratio);
                    position: absolute;
                    top: -25px;
                    left: 0;
                    background: red;
                    color: white;
                    padding: 2px 6px;
                    font-size: 12px;
                    z-index: 9999;
                }
            `
        });
        
        // Markiere problematische Elemente
        await page.evaluate((analysis) => {
            analysis.forEach(item => {
                if (!item.wcagAA) {
                    const elements = Array.from(document.querySelectorAll('*')).filter(el => 
                        el.textContent.trim().startsWith(item.text) && 
                        window.getComputedStyle(el).color === item.color
                    );
                    elements.forEach(el => {
                        el.setAttribute('data-contrast-violation', 'true');
                        el.setAttribute('data-contrast-ratio', item.contrastRatio + ':1');
                    });
                }
            });
        }, contrastAnalysis);
        
        // Screenshot mit Markierungen
        const annotatedScreenshotPath = path.join(SCREENSHOTS_DIR, `${testName}-contrast-analysis.png`);
        await page.screenshot({ 
            path: annotatedScreenshotPath,
            fullPage: true 
        });
        console.log(`   ✅ Contrast analysis: ${annotatedScreenshotPath}`);
        
        return {
            analysis: contrastAnalysis,
            screenshot: annotatedScreenshotPath,
            violations: contrastAnalysis.filter(item => !item.wcagAA).length
        };
        
    } catch (error) {
        console.log(`   ❌ Color contrast analysis error: ${error.message}`);
        return null;
    } finally {
        await page.close();
    }
}

/**
 * Analysiert Use of Color visuell
 */
async function analyzeUseOfColor(browser, url, testName) {
    console.log(`🌈 Analyzing use of color for: ${testName}`);
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 });
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        const colorAnalysis = await page.evaluate(() => {
            const issues = [];
            
            // Links ohne Unterstreichung prüfen
            const links = Array.from(document.querySelectorAll('a'));
            links.forEach(link => {
                const style = window.getComputedStyle(link);
                const parentStyle = window.getComputedStyle(link.parentElement);
                
                if (style.textDecoration === 'none' && 
                    style.color !== parentStyle.color) {
                    issues.push({
                        type: 'link-color-only',
                        element: 'a',
                        text: link.textContent.trim().substring(0, 30),
                        issue: 'Link unterscheidet sich nur durch Farbe'
                    });
                }
            });
            
            // Status-Nachrichten ohne zusätzliche Indikatoren
            const statusElements = Array.from(document.querySelectorAll('[class*="status"], [class*="error"], [class*="warning"], [class*="success"]'));
            statusElements.forEach(element => {
                const hasIcon = element.textContent.includes('✓') || 
                              element.textContent.includes('✗') || 
                              element.textContent.includes('⚠');
                const hasTextIndicator = element.textContent.includes('Erfolg') || 
                                       element.textContent.includes('Fehler') || 
                                       element.textContent.includes('Warnung');
                
                if (!hasIcon && !hasTextIndicator) {
                    issues.push({
                        type: 'status-color-only',
                        element: element.tagName.toLowerCase() + (element.className ? '.' + element.className.split(' ').join('.') : ''),
                        text: element.textContent.trim().substring(0, 30),
                        issue: 'Status nur durch Farbe angezeigt'
                    });
                }
            });
            
            return issues;
        });
        
        // Markiere problematische Elemente
        await page.addStyleTag({
            content: `
                [data-color-violation] {
                    outline: 3px solid orange !important;
                    position: relative !important;
                }
                [data-color-violation]::after {
                    content: "🌈 Color Only";
                    position: absolute;
                    top: -25px;
                    right: 0;
                    background: orange;
                    color: black;
                    padding: 2px 6px;
                    font-size: 12px;
                    z-index: 9999;
                }
            `
        });
        
        await page.evaluate((analysis) => {
            // Vereinfachte Markierung - markiere alle Links ohne Unterstreichung
            const links = Array.from(document.querySelectorAll('a'));
            links.forEach(link => {
                const style = window.getComputedStyle(link);
                if (style.textDecoration === 'none') {
                    link.setAttribute('data-color-violation', 'true');
                }
            });
        }, colorAnalysis);
        
        const annotatedScreenshotPath = path.join(SCREENSHOTS_DIR, `${testName}-color-use-analysis.png`);
        await page.screenshot({ 
            path: annotatedScreenshotPath,
            fullPage: true 
        });
        console.log(`   ✅ Use of color analysis: ${annotatedScreenshotPath}`);
        
        return {
            analysis: colorAnalysis,
            screenshot: annotatedScreenshotPath,
            violations: colorAnalysis.length
        };
        
    } catch (error) {
        console.log(`   ❌ Use of color analysis error: ${error.message}`);
        return null;
    } finally {
        await page.close();
    }
}

/**
 * Führt Phase6a API-Scan durch
 */
async function runPhase6aScan(testUrl, testName) {
    console.log(`🔍 Running Phase6a API scan for: ${testName}`);
    
    try {
        const response = await makeHttpRequest(`${API_BASE_URL}/api/enhanced-scan`, {
            method: 'POST',
            body: {
                url: testUrl,
                options: {
                    wcagLevel: 'AA',
                    includePhase6A: true,
                    includeWarnings: true,
                    timeout: 30000
                }
            }
        });
        
        if (response.statusCode !== 200) {
            throw new Error(`API returned status ${response.statusCode}`);
        }
        
        return response.data;
        
    } catch (error) {
        console.log(`   ❌ API scan error: ${error.message}`);
        return null;
    }
}

/**
 * Erstellt detaillierten Debug-Report
 */
function createDebugReport(testName, screenshots, visualAnalysis, apiResults) {
    const reportPath = path.join(DEBUG_REPORTS_DIR, `${testName}-debug-report.html`);
    
    const html = `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Debug Report: ${testName}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .section { margin: 30px 0; padding: 20px; border: 1px solid #ddd; }
        .screenshot { max-width: 100%; border: 1px solid #ccc; margin: 10px 0; }
        .comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .api-result { background: #f5f5f5; padding: 15px; border-radius: 5px; }
        .violation { background: #ffebee; padding: 10px; margin: 5px 0; border-left: 4px solid #f44336; }
        .pass { background: #e8f5e8; padding: 10px; margin: 5px 0; border-left: 4px solid #4caf50; }
        pre { background: #f5f5f5; padding: 10px; overflow-x: auto; }
    </style>
</head>
<body>
    <h1>🔍 Phase6a Debug Report: ${testName}</h1>
    <p>Generated: ${new Date().toLocaleString()}</p>
    
    <div class="section">
        <h2>📸 Screenshots</h2>
        <div class="comparison">
            <div>
                <h3>Full Page</h3>
                ${screenshots?.fullPage ? `<img src="${path.relative(DEBUG_REPORTS_DIR, screenshots.fullPage)}" class="screenshot" alt="Full page screenshot">` : 'No screenshot available'}
            </div>
            <div>
                <h3>Viewport</h3>
                ${screenshots?.viewport ? `<img src="${path.relative(DEBUG_REPORTS_DIR, screenshots.viewport)}" class="screenshot" alt="Viewport screenshot">` : 'No screenshot available'}
            </div>
        </div>
    </div>
    
    <div class="section">
        <h2>🎨 Visual Color Contrast Analysis</h2>
        ${visualAnalysis?.contrast ? `
            <p><strong>Violations found:</strong> ${visualAnalysis.contrast.violations}</p>
            <img src="${path.relative(DEBUG_REPORTS_DIR, visualAnalysis.contrast.screenshot)}" class="screenshot" alt="Color contrast analysis">
            <h3>Top 10 Worst Contrasts:</h3>
            ${visualAnalysis.contrast.analysis.slice(0, 10).map(item => `
                <div class="${item.wcagAA ? 'pass' : 'violation'}">
                    <strong>${item.element}</strong>: ${item.contrastRatio}:1 
                    (${item.wcagAA ? '✅ PASS' : '❌ FAIL'} WCAG AA)
                    <br><em>"${item.text}"</em>
                </div>
            `).join('')}
        ` : 'No visual analysis available'}
    </div>
    
    <div class="section">
        <h2>🌈 Visual Use of Color Analysis</h2>
        ${visualAnalysis?.color ? `
            <p><strong>Violations found:</strong> ${visualAnalysis.color.violations}</p>
            <img src="${path.relative(DEBUG_REPORTS_DIR, visualAnalysis.color.screenshot)}" class="screenshot" alt="Use of color analysis">
            <h3>Issues Found:</h3>
            ${visualAnalysis.color.analysis.map(item => `
                <div class="violation">
                    <strong>${item.type}</strong>: ${item.element}
                    <br><em>"${item.text}"</em>
                    <br>${item.issue}
                </div>
            `).join('')}
        ` : 'No visual analysis available'}
    </div>
    
    <div class="section">
        <h2>🤖 Phase6a API Results</h2>
        ${apiResults ? `
            <div class="api-result">
                <h3>Overall Results</h3>
                <p><strong>Phase6a Score:</strong> ${apiResults.phase6AScore}%</p>
                
                <h3>Color Contrast (9.1.4.3)</h3>
                <div class="${apiResults.phase6ACompliance?.colorContrast?.passed ? 'pass' : 'violation'}">
                    Status: ${apiResults.phase6ACompliance?.colorContrast?.passed ? 'PASS' : 'FAIL'}
                    <br>Violations: ${apiResults.phase6ACompliance?.colorContrast?.violations?.length || 0}
                </div>
                
                <h3>Use of Color (9.1.4.1)</h3>
                <div class="${apiResults.phase6ACompliance?.useOfColor?.passed ? 'pass' : 'violation'}">
                    Status: ${apiResults.phase6ACompliance?.useOfColor?.passed ? 'PASS' : 'FAIL'}
                    <br>Violations: ${apiResults.phase6ACompliance?.useOfColor?.violations?.length || 0}
                </div>
                
                <h3>Images of Text (9.1.4.5)</h3>
                <div class="${apiResults.phase6ACompliance?.imagesOfText?.passed ? 'pass' : 'violation'}">
                    Status: ${apiResults.phase6ACompliance?.imagesOfText?.passed ? 'PASS' : 'FAIL'}
                    <br>Violations: ${apiResults.phase6ACompliance?.imagesOfText?.violations?.length || 0}
                </div>
            </div>
            
            <h3>🔍 Comparison: Visual vs API</h3>
            <div class="comparison">
                <div>
                    <h4>Visual Analysis</h4>
                    <p>Color Contrast Issues: ${visualAnalysis?.contrast?.violations || 'N/A'}</p>
                    <p>Use of Color Issues: ${visualAnalysis?.color?.violations || 'N/A'}</p>
                </div>
                <div>
                    <h4>API Detection</h4>
                    <p>Color Contrast Issues: ${apiResults.phase6ACompliance?.colorContrast?.violations?.length || 0}</p>
                    <p>Use of Color Issues: ${apiResults.phase6ACompliance?.useOfColor?.violations?.length || 0}</p>
                </div>
            </div>
        ` : 'No API results available'}
    </div>
    
    <div class="section">
        <h2>📊 Debug Summary</h2>
        <h3>Key Findings:</h3>
        <ul>
            <li>Visual contrast violations detected: ${visualAnalysis?.contrast?.violations || 'Unknown'}</li>
            <li>API contrast violations detected: ${apiResults?.phase6ACompliance?.colorContrast?.violations?.length || 'Unknown'}</li>
            <li>Visual color use violations: ${visualAnalysis?.color?.violations || 'Unknown'}</li>
            <li>API color use violations: ${apiResults?.phase6ACompliance?.useOfColor?.violations?.length || 'Unknown'}</li>
        </ul>
        
        <h3>Recommendations:</h3>
        <ul>
            <li>Compare visual analysis with API results for accuracy</li>
            <li>Check if API is detecting the same issues visible in screenshots</li>
            <li>Adjust scanner thresholds if needed</li>
            <li>Verify scanner logic against visual evidence</li>
        </ul>
    </div>
</body>
</html>`;
    
    fs.writeFileSync(reportPath, html);
    console.log(`📋 Debug report created: ${reportPath}`);
    return reportPath;
}

/**
 * Führt iteratives Debugging für eine Test-Datei durch
 */
async function debugTestFile(browser, testFile, testName, server) {
    console.log(`\n🚀 Starting iterative debug for: ${testName}`);
    console.log(`📄 File: ${testFile}`);
    
    const testUrl = `http://localhost:${STATIC_SERVER_PORT}/${testFile}`;
    console.log(`🌐 URL: ${testUrl}`);
    
    // Schritt 1: Screenshots nehmen
    const screenshots = await takeScreenshots(browser, testUrl, testName);
    
    // Schritt 2: Visuelle Analyse der Farbkontraste
    const contrastAnalysis = await analyzeColorContrast(browser, testUrl, testName);
    
    // Schritt 3: Visuelle Analyse der Farbverwendung
    const colorAnalysis = await analyzeUseOfColor(browser, testUrl, testName);
    
    // Schritt 4: Phase6a API-Scan
    const apiResults = await runPhase6aScan(testUrl, testName);
    
    // Schritt 5: Debug-Report erstellen
    const reportPath = createDebugReport(testName, screenshots, {
        contrast: contrastAnalysis,
        color: colorAnalysis
    }, apiResults);
    
    console.log(`✅ Debug complete for: ${testName}`);
    
    return {
        testName,
        testFile,
        screenshots,
        visualAnalysis: {
            contrast: contrastAnalysis,
            color: colorAnalysis
        },
        apiResults,
        reportPath
    };
}

/**
 * Main Debugging Function
 */
async function main() {
    console.log('🔍 Starting Iterative Phase6a Debugging with Browser Automation...\n');
    
    // Server starten
    let server;
    try {
        server = await startDebugServer();
    } catch (error) {
        console.log(`💥 Failed to start server: ${error.message}`);
        return;
    }
    
    // Browser starten
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: false, // Zeige Browser für visuelle Verifikation
            defaultViewport: null,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        console.log('🌐 Browser launched successfully');
    } catch (error) {
        console.log(`💥 Failed to launch browser: ${error.message}`);
        if (server) server.close();
        return;
    }
    
    const results = [];
    
    try {
        // Test-Dateien definieren
        const testFiles = [
            { file: 'bad-color-contrast.html', name: 'bad-color-contrast' },
            { file: 'bad-use-of-color.html', name: 'bad-use-of-color' },
            { file: 'bad-images-of-text.html', name: 'bad-images-of-text' },
            { file: 'good-accessibility.html', name: 'good-accessibility' }
        ];
        
        // Jede Test-Datei debuggen
        for (const testFile of testFiles) {
            const result = await debugTestFile(browser, testFile.file, testFile.name, server);
            results.push(result);
            
            console.log(`\n⏸️  Pausing for 3 seconds before next test...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
    } finally {
        // Cleanup
        if (browser) {
            await browser.close();
            console.log('🛑 Browser closed');
        }
        
        if (server) {
            server.close();
            console.log('🛑 Server stopped');
        }
    }
    
    // Summary Report
    console.log('\n' + '='.repeat(70));
    console.log('📊 ITERATIVE DEBUG SUMMARY');
    console.log('='.repeat(70));
    
    results.forEach(result => {
        console.log(`\n📄 ${result.testName}:`);
        console.log(`   Screenshots: ${result.screenshots ? '✅' : '❌'}`);
        console.log(`   Visual Analysis: ${result.visualAnalysis ? '✅' : '❌'}`);
        console.log(`   API Results: ${result.apiResults ? '✅' : '❌'}`);
        console.log(`   Report: ${result.reportPath}`);
        
        if (result.apiResults && result.visualAnalysis) {
            console.log(`   Visual Contrast Issues: ${result.visualAnalysis.contrast?.violations || 'N/A'}`);
            console.log(`   API Contrast Issues: ${result.apiResults.phase6ACompliance?.colorContrast?.violations?.length || 0}`);
            console.log(`   Visual Color Issues: ${result.visualAnalysis.color?.violations || 'N/A'}`);
            console.log(`   API Color Issues: ${result.apiResults.phase6ACompliance?.useOfColor?.violations?.length || 0}`);
        }
    });
    
    console.log(`\n📋 Debug reports created in: ${DEBUG_REPORTS_DIR}`);
    console.log(`📸 Screenshots saved in: ${SCREENSHOTS_DIR}`);
    console.log('\n✅ Iterative debugging complete!');
}

if (require.main === module) {
    main().catch(error => {
        console.error('💥 Debug process failed:', error);
        process.exit(1);
    });
}

module.exports = {
    debugTestFile,
    takeScreenshots,
    analyzeColorContrast,
    analyzeUseOfColor,
    createDebugReport
};