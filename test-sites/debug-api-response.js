#!/usr/bin/env node

/**
 * Debug Script für Phase6a API Responses
 * 
 * Analysiert die detaillierten API-Antworten um zu verstehen
 * warum die Tests fehlschlagen
 */

const http = require('http');
const fs = require('fs');

const API_BASE_URL = 'http://localhost:3000';
const STATIC_SERVER_PORT = 8082;

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
 * Startet einen einfachen HTTP-Server
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
                res.end('Debug Server Running');
                return;
            }
            
            const filePath = __dirname + req.url;
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
                console.log(`🔧 Debug server running on http://localhost:${STATIC_SERVER_PORT}`);
                resolve(server);
            }
        });
    });
}

/**
 * Führt detaillierte API-Analyse durch
 */
async function debugAPIResponse(testFile, description) {
    console.log(`\n🔍 DEBUGGING: ${description}`);
    console.log(`📄 File: ${testFile}`);
    
    const testUrl = `http://localhost:${STATIC_SERVER_PORT}/${testFile}`;
    console.log(`🌐 Test URL: ${testUrl}`);
    
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
            console.log(`❌ API Error: Status ${response.statusCode}`);
            console.log(`Response:`, JSON.stringify(response.data, null, 2));
            return;
        }
        
        const result = response.data;
        
        console.log(`\n📊 OVERALL RESULTS:`);
        console.log(`   Status Code: ${response.statusCode}`);
        console.log(`   Overall Score: ${result.overallScore}`);
        console.log(`   Phase6a Score: ${result.phase6AScore}%`);
        console.log(`   Scan Duration: ${result.scanDuration}ms`);
        
        if (result.phase6ACompliance) {
            console.log(`\n🎯 PHASE6A DETAILED RESULTS:`);
            
            // Color Contrast Details
            const colorContrast = result.phase6ACompliance.colorContrast;
            console.log(`\n   🎨 COLOR CONTRAST (EN 301 549 - 9.1.4.3):`);
            console.log(`      Status: ${colorContrast.passed ? 'PASS' : 'FAIL'}`);
            console.log(`      Violations: ${colorContrast.violations?.length || 0}`);
            
            if (colorContrast.violations && colorContrast.violations.length > 0) {
                console.log(`      Top 5 Violations:`);
                colorContrast.violations.slice(0, 5).forEach((violation, i) => {
                    console.log(`        ${i+1}. Element: ${violation.element || 'N/A'}`);
                    console.log(`           Issue: ${violation.issue || violation.description || 'N/A'}`);
                    console.log(`           Contrast: ${violation.contrastRatio || 'N/A'}`);
                    console.log(`           Required: ${violation.requiredRatio || 'N/A'}`);
                    console.log(`           Confidence: ${violation.confidence || 'N/A'}`);
                });
            }
            
            // Use of Color Details
            const useOfColor = result.phase6ACompliance.useOfColor;
            console.log(`\n   🌈 USE OF COLOR (EN 301 549 - 9.1.4.1):`);
            console.log(`      Status: ${useOfColor.passed ? 'PASS' : 'FAIL'}`);
            console.log(`      Violations: ${useOfColor.violations?.length || 0}`);
            
            if (useOfColor.violations && useOfColor.violations.length > 0) {
                console.log(`      Top 5 Violations:`);
                useOfColor.violations.slice(0, 5).forEach((violation, i) => {
                    console.log(`        ${i+1}. Element: ${violation.element || 'N/A'}`);
                    console.log(`           Issue: ${violation.issue || violation.description || 'N/A'}`);
                    console.log(`           Type: ${violation.type || 'N/A'}`);
                    console.log(`           Confidence: ${violation.confidence || 'N/A'}`);
                });
            }
            
            // Images of Text Details
            const imagesOfText = result.phase6ACompliance.imagesOfText;
            console.log(`\n   🖼️ IMAGES OF TEXT (EN 301 549 - 9.1.4.5):`);
            console.log(`      Status: ${imagesOfText.passed ? 'PASS' : 'FAIL'}`);
            console.log(`      Violations: ${imagesOfText.violations?.length || 0}`);
            
            if (imagesOfText.violations && imagesOfText.violations.length > 0) {
                console.log(`      Top 5 Violations:`);
                imagesOfText.violations.slice(0, 5).forEach((violation, i) => {
                    console.log(`        ${i+1}. Element: ${violation.element || 'N/A'}`);
                    console.log(`           Issue: ${violation.issue || violation.description || 'N/A'}`);
                    console.log(`           Text Content: ${violation.textContent || 'N/A'}`);
                    console.log(`           Confidence: ${violation.confidence || 'N/A'}`);
                });
            }
        } else {
            console.log(`❌ No Phase6a compliance data found in API response`);
        }
        
        // EN 301 549 Compliance
        if (result.enCompliance) {
            console.log(`\n📋 EN 301 549 COMPLIANCE:`);
            Object.entries(result.enCompliance).forEach(([criterion, passed]) => {
                console.log(`      ${criterion}: ${passed ? '✅ PASS' : '❌ FAIL'}`);
            });
        }
        
        // Full Response Sample (für Debugging)
        if (process.env.DEBUG_FULL_RESPONSE) {
            console.log(`\n🔍 FULL API RESPONSE:`);
            console.log(JSON.stringify(result, null, 2));
        }
        
    } catch (error) {
        console.log(`💥 Debug Error: ${error.message}`);
        console.log(error.stack);
    }
}

/**
 * Main Debug Function
 */
async function main() {
    console.log('🚀 Starting Phase6a API Debug Analysis...\n');
    
    // Server starten
    let debugServer;
    try {
        debugServer = await startDebugServer();
    } catch (error) {
        console.log(`💥 Failed to start debug server: ${error.message}`);
        return;
    }
    
    try {
        // Alle Test-Dateien analysieren
        await debugAPIResponse('bad-color-contrast.html', 'Color Contrast Violations');
        await debugAPIResponse('bad-use-of-color.html', 'Use of Color Violations');
        await debugAPIResponse('bad-images-of-text.html', 'Images of Text Violations');
        await debugAPIResponse('good-accessibility.html', 'Good Accessibility Practices');
        
    } finally {
        if (debugServer) {
            debugServer.close();
            console.log(`\n🛑 Debug server stopped`);
        }
    }
    
    console.log(`\n🎯 DEBUG ANALYSIS COMPLETE`);
    console.log(`\n💡 RECOMMENDATIONS:`);
    console.log(`   1. Check if Phase6a scanners are detecting the right violations`);
    console.log(`   2. Verify scanner thresholds and configuration`);
    console.log(`   3. Review HTML test files for unexpected accessibility issues`);
    console.log(`   4. Consider adjusting test expectations based on actual scanner behavior`);
    console.log(`\n   Set DEBUG_FULL_RESPONSE=true for complete API response output`);
}

if (require.main === module) {
    main();
}