#!/usr/bin/env node

/**
 * Element-Level Test Isolator
 * 
 * Studies test outputs to identify specific HTML elements that cause false positives/negatives
 * Creates minimal test cases with just the problematic elements for debugging
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuration
const INDIVIDUAL_API_URL = 'http://localhost:3002';
const ISOLATED_ELEMENTS_DIR = path.join(__dirname, 'isolated-elements');
const TEST_SITES_DIR = path.join(__dirname, 'test-sites');

// Ensure isolated elements directory exists
if (!fs.existsSync(ISOLATED_ELEMENTS_DIR)) {
  fs.mkdirSync(ISOLATED_ELEMENTS_DIR, { recursive: true });
}

// Create subdirectories for different issue types
['false-positives', 'false-negatives'].forEach(dir => {
  const dirPath = path.join(ISOLATED_ELEMENTS_DIR, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

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
      },
      timeout: 30000
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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

/**
 * Extract specific elements from HTML based on selectors
 */
function extractElements(htmlContent, selectors) {
  // Simple regex-based extraction (for basic cases)
  const elements = [];
  
  selectors.forEach(selector => {
    // Handle basic selectors like 'img', 'button#submit', '.error-message'
    let pattern;
    
    if (selector.startsWith('#')) {
      // ID selector
      const id = selector.substring(1);
      pattern = new RegExp(`<[^>]+id\\s*=\\s*["']${id}["'][^>]*>.*?</[^>]+>`, 'gis');
    } else if (selector.startsWith('.')) {
      // Class selector
      const className = selector.substring(1);
      pattern = new RegExp(`<[^>]+class\\s*=\\s*["'][^"']*${className}[^"']*["'][^>]*>.*?</[^>]+>`, 'gis');
    } else if (selector.includes('[')) {
      // Attribute selector - simplified
      const match = selector.match(/(\w+)\[([^=]+)(?:=["']([^"']+)["'])?\]/);
      if (match) {
        const [, tag, attr, value] = match;
        if (value) {
          pattern = new RegExp(`<${tag}[^>]+${attr}\\s*=\\s*["']${value}["'][^>]*>.*?</${tag}>`, 'gis');
        } else {
          pattern = new RegExp(`<${tag}[^>]+${attr}[^>]*>.*?</${tag}>`, 'gis');
        }
      }
    } else {
      // Tag selector
      pattern = new RegExp(`<${selector}[^>]*>.*?</${selector}>`, 'gis');
    }
    
    if (pattern) {
      const matches = htmlContent.match(pattern);
      if (matches) {
        elements.push(...matches);
      }
    }
  });
  
  return elements;
}

/**
 * Create minimal HTML test case with isolated elements
 */
function createIsolatedElementTest(elements, metadata) {
  const template = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Isolated Element Test - ${metadata.scanner} - ${metadata.issue}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
    }
    .test-info {
      background: #f0f0f0;
      padding: 15px;
      margin-bottom: 20px;
      border-radius: 5px;
    }
    .test-info h2 {
      margin-top: 0;
    }
    .isolated-element {
      border: 2px dashed #ccc;
      padding: 10px;
      margin: 10px 0;
      background: #fafafa;
    }
    .element-info {
      font-size: 12px;
      color: #666;
      margin-bottom: 5px;
    }
  </style>
</head>
<body>
  <div class="test-info">
    <h2>Isolated Element Test</h2>
    <p><strong>Scanner:</strong> ${metadata.scanner}</p>
    <p><strong>Issue Type:</strong> ${metadata.issueType}</p>
    <p><strong>Original File:</strong> ${metadata.originalFile}</p>
    <p><strong>Expected Result:</strong> ${metadata.expected}</p>
    <p><strong>Actual Result:</strong> ${metadata.actual}</p>
    <p><strong>Problem:</strong> ${metadata.problem}</p>
    <p><strong>Generated:</strong> ${new Date().toISOString()}</p>
  </div>

  <h3>Isolated Elements:</h3>
  ${elements.map((element, index) => `
  <div class="isolated-element">
    <div class="element-info">Element ${index + 1}:</div>
    ${element}
  </div>
  `).join('\n')}

  <!-- Additional context if needed -->
  <script>
    // Log test metadata for debugging
    console.log('Isolated Element Test Metadata:', ${JSON.stringify(metadata, null, 2)});
  </script>
</body>
</html>`;

  return template;
}

/**
 * Analyze scanner output to identify problematic elements
 */
async function analyzeAndIsolateElements(scanner, testFile, issueType) {
  console.log(`\n🔍 Analyzing ${scanner} on ${testFile} (${issueType})`);
  
  // Read original HTML file
  const originalPath = path.join(TEST_SITES_DIR, testFile);
  if (!fs.existsSync(originalPath)) {
    console.error(`❌ Original file not found: ${testFile}`);
    return null;
  }
  
  const originalHTML = fs.readFileSync(originalPath, 'utf8');
  
  // Start a simple server to serve the test file
  const server = await startTestServer(originalPath);
  const testUrl = `http://localhost:${server.port}/${testFile}`;
  
  try {
    // Run scanner on the file
    console.log(`   Running ${scanner} scan...`);
    const response = await makeHttpRequest(`${INDIVIDUAL_API_URL}/api/scan/${scanner}`, {
      method: 'POST',
      body: {
        url: testUrl,
        options: { timeout: 30000 }
      }
    });
    
    if (response.statusCode !== 200) {
      throw new Error(`Scanner API returned ${response.statusCode}`);
    }
    
    const result = response.data.result;
    const violations = result.violations || [];
    
    console.log(`   Found ${violations.length} violations`);
    
    // Extract problematic elements based on violation data
    const problematicElements = [];
    const selectors = new Set();
    
    violations.forEach(violation => {
      // Collect selectors from violation nodes
      if (violation.nodes) {
        violation.nodes.forEach(node => {
          if (node.target && Array.isArray(node.target)) {
            node.target.forEach(selector => {
              selectors.add(selector);
            });
          }
        });
      }
    });
    
    console.log(`   Identified ${selectors.size} unique selectors`);
    
    // Extract elements using selectors
    const elements = extractElements(originalHTML, Array.from(selectors));
    
    // Create metadata
    const metadata = {
      scanner,
      originalFile: testFile,
      issueType,
      expected: issueType === 'false-negative' ? 'Should detect violations' : 'Should not detect violations',
      actual: violations.length > 0 ? `Detected ${violations.length} violations` : 'No violations detected',
      problem: issueType === 'false-negative' ? 
        'Scanner missing expected violations' : 
        'Scanner incorrectly detecting violations',
      violationSummary: violations.slice(0, 3).map(v => ({
        id: v.id,
        impact: v.impact,
        description: v.description
      }))
    };
    
    // Create isolated test file
    const isolatedHTML = createIsolatedElementTest(elements, metadata);
    const fileName = `${scanner}_${testFile.replace('.html', '')}_${issueType}_elements.html`;
    const outputPath = path.join(ISOLATED_ELEMENTS_DIR, issueType + 's', fileName);
    
    fs.writeFileSync(outputPath, isolatedHTML);
    console.log(`   ✅ Created isolated test: ${fileName}`);
    
    return {
      scanner,
      testFile,
      issueType,
      violationsFound: violations.length,
      elementsIsolated: elements.length,
      outputFile: fileName
    };
    
  } finally {
    server.close();
  }
}

/**
 * Start a simple HTTP server for testing
 */
function startTestServer(filePath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    });
    
    // Find available port
    server.listen(0, () => {
      const port = server.address().port;
      console.log(`   Test server started on port ${port}`);
      resolve({ server, port, close: () => server.close() });
    });
  });
}

/**
 * Study test results and isolate problematic elements
 */
async function studyAndIsolateFromResults() {
  console.log('📚 Studying test results to isolate problematic elements...\n');
  
  // Key test cases to study based on common issues
  const testCases = [
    // False Negatives - scanners missing violations they should catch
    { scanner: 'page-structure', file: 'bad-image-alt.html', issueType: 'false-negative' },
    { scanner: 'page-structure', file: 'bad-form-labels.html', issueType: 'false-negative' },
    { scanner: 'keyboard-navigation', file: 'bad-keyboard-access.html', issueType: 'false-negative' },
    { scanner: 'focus-management', file: 'bad-focus-visible.html', issueType: 'false-negative' },
    
    // False Positives - scanners detecting violations in good examples
    { scanner: 'color-contrast', file: 'good-accessibility.html', issueType: 'false-positive' },
    { scanner: 'use-of-color', file: 'good-accessibility.html', issueType: 'false-positive' },
    { scanner: 'page-structure', file: 'good-accessibility.html', issueType: 'false-positive' }
  ];
  
  // Check API health first
  try {
    const healthResponse = await makeHttpRequest(`${INDIVIDUAL_API_URL}/api/health`);
    if (healthResponse.statusCode !== 200) {
      console.log('❌ Individual Scanner API not available');
      console.log('Please start: INDIVIDUAL_SCANNER_PORT=3002 node src/individual-scanner-api.js');
      return;
    }
    console.log('✅ Individual Scanner API is healthy\n');
  } catch (error) {
    console.log('❌ Cannot connect to Individual Scanner API');
    return;
  }
  
  const results = [];
  
  for (const testCase of testCases) {
    const result = await analyzeAndIsolateElements(
      testCase.scanner, 
      testCase.file, 
      testCase.issueType
    );
    
    if (result) {
      results.push(result);
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Generate summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 ELEMENT ISOLATION SUMMARY');
  console.log('='.repeat(60));
  
  console.log(`\nTotal test cases analyzed: ${results.length}`);
  console.log(`Total elements isolated: ${results.reduce((sum, r) => sum + r.elementsIsolated, 0)}`);
  
  console.log('\n📁 Generated isolated element tests:');
  results.forEach(result => {
    console.log(`   ${result.outputFile}`);
    console.log(`     - ${result.elementsIsolated} elements from ${result.testFile}`);
    console.log(`     - Issue: ${result.issueType}`);
  });
  
  console.log(`\n🔧 Next steps:`);
  console.log(`   1. Review isolated element tests in: ${ISOLATED_ELEMENTS_DIR}`);
  console.log(`   2. Debug why these specific elements cause issues`);
  console.log(`   3. Fix scanner logic to handle these cases correctly`);
}

// Run if called directly
if (require.main === module) {
  studyAndIsolateFromResults().catch(console.error);
}

module.exports = {
  analyzeAndIsolateElements,
  studyAndIsolateFromResults
};