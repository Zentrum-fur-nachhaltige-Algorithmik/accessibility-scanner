#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');

/**
 * File-by-File False Positive Analyzer
 * Deep analysis of individual good HTML files to understand false positive root causes
 */
class FileByFileAnalyzer {
  constructor() {
    this.apiPort = 3002;
    this.testSitesDir = path.join(__dirname, 'test-sites');
    this.isolationDir = path.join(__dirname, 'false-positive-isolation');
    
    // Ensure isolation directory exists
    if (!fs.existsSync(this.isolationDir)) {
      fs.mkdirSync(this.isolationDir, { recursive: true });
    }
  }

  /**
   * Make HTTP request to scanner API
   */
  async makeRequest(endpoint, data) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(data);
      const options = {
        hostname: 'localhost',
        port: this.apiPort,
        path: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(responseData));
          } catch (e) {
            reject(new Error(`Invalid JSON: ${responseData}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Deep analysis of a single file's false positives
   */
  async analyzeFile(filename, targetScanner = null) {
    console.log(`🔍 DEEP ANALYSIS: ${filename}\n`);
    
    const fileUrl = `file://${path.join(this.testSitesDir, filename)}`;
    const htmlContent = fs.readFileSync(path.join(this.testSitesDir, filename), 'utf8');
    
    // Test with all scanners or specific scanner
    const scannersToTest = targetScanner ? [targetScanner] : [
      'color-contrast', 'keyboard-navigation', 'html-validation'
    ];
    
    const analysis = {
      file: filename,
      htmlPreview: htmlContent.substring(0, 500) + '...',
      scannerResults: {},
      isolatedViolations: [],
      recommendedFixes: [],
      timestamp: new Date().toISOString()
    };

    for (const scanner of scannersToTest) {
      console.log(`📊 Testing with ${scanner} scanner...`);
      
      try {
        const result = await this.makeRequest(`/api/scan/${scanner}`, { url: fileUrl });
        
        const violations = result.result?.violations || [];
        const passed = result.result?.passed || false;
        
        analysis.scannerResults[scanner] = {
          passed,
          totalViolations: violations.length,
          violations: violations
        };
        
        if (!passed && violations.length > 0) {
          console.log(`   ❌ Found ${violations.length} false positive violations`);
          
          // Categorize violations
          const categories = this.categorizeViolations(violations, scanner);
          
          console.log(`\n   📂 Violation Categories:`);
          Object.entries(categories).forEach(([category, items]) => {
            console.log(`      ${category}: ${items.length} violations`);
            items.slice(0, 3).forEach((item, i) => {
              const element = item.element || item.selector || 'unknown';
              const issue = item.description || item.issue || 'no description';
              console.log(`         ${i + 1}. ${element}: ${issue}`);
            });
            if (items.length > 3) {
              console.log(`         ... and ${items.length - 3} more`);
            }
          });
          
          // Generate isolated test cases
          await this.generateIsolatedTestCases(filename, scanner, violations, categories);
          
          // Analyze root causes
          const rootCauses = this.analyzeRootCauses(scanner, categories, htmlContent);
          analysis.recommendedFixes.push(...rootCauses);
          
        } else {
          console.log(`   ✅ Clean - no violations`);
        }
        
        console.log('');
        
      } catch (error) {
        console.log(`   ⚠️  ERROR: ${error.message}\n`);
        analysis.scannerResults[scanner] = { error: error.message };
      }
    }
    
    // Save detailed analysis
    const analysisPath = path.join(this.isolationDir, `${filename.replace('.html', '')}-analysis.json`);
    fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
    
    // Display recommendations
    this.displayRecommendations(analysis);
    
    console.log(`\n📄 Detailed analysis saved: ${analysisPath}`);
    
    return analysis;
  }

  /**
   * Categorize violations by type for better understanding
   */
  categorizeViolations(violations, scanner) {
    const categories = {};
    
    violations.forEach(violation => {
      let category = 'unknown';
      
      if (scanner === 'color-contrast') {
        if (violation.foregroundColor && violation.backgroundColor) {
          category = 'color-contrast-ratio';
        } else {
          category = 'color-detection-issue';
        }
      } else if (scanner === 'keyboard-navigation') {
        const issue = violation.issue || violation.description || '';
        if (issue.includes('keyboard accessible')) {
          category = 'keyboard-accessibility';
        } else if (issue.includes('focus')) {
          category = 'focus-management';
        } else if (issue.includes('label') || issue.includes('name')) {
          category = 'accessible-names';
        } else if (issue.includes('landmark')) {
          category = 'page-structure';
        } else {
          category = 'keyboard-other';
        }
      } else if (scanner === 'html-validation') {
        const issue = violation.issue || violation.type || violation.description || '';
        if (issue.includes('aria')) {
          category = 'aria-validation';
        } else if (issue.includes('label') || issue.includes('form')) {
          category = 'form-validation';
        } else if (issue.includes('duplicate')) {
          category = 'id-duplication';
        } else if (issue.includes('heading')) {
          category = 'heading-structure';
        } else {
          category = 'html-structure';
        }
      }
      
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(violation);
    });
    
    return categories;
  }

  /**
   * Generate isolated test cases for each violation category
   */
  async generateIsolatedTestCases(filename, scanner, violations, categories) {
    const baseFilename = filename.replace('.html', '');
    const isolationSubDir = path.join(this.isolationDir, `${baseFilename}-${scanner}`);
    
    if (!fs.existsSync(isolationSubDir)) {
      fs.mkdirSync(isolationSubDir, { recursive: true });
    }
    
    // Read original file
    const originalHtml = fs.readFileSync(path.join(this.testSitesDir, filename), 'utf8');
    
    // Create isolated test case for each category
    Object.entries(categories).forEach(([category, categoryViolations]) => {
      const isolatedHtml = this.createIsolatedTestCase(
        originalHtml, 
        categoryViolations, 
        category,
        scanner
      );
      
      const isolatedPath = path.join(isolationSubDir, `${category}-isolated.html`);
      fs.writeFileSync(isolatedPath, isolatedHtml);
      
      // Create analysis file
      const analysisData = {
        originalFile: filename,
        scanner,
        category,
        violationsInCategory: categoryViolations.length,
        violations: categoryViolations,
        isolatedTestCase: isolatedPath,
        timestamp: new Date().toISOString()
      };
      
      const analysisPath = path.join(isolationSubDir, `${category}-analysis.json`);
      fs.writeFileSync(analysisPath, JSON.stringify(analysisData, null, 2));
    });
    
    console.log(`   📁 Isolated test cases saved to: ${isolationSubDir}`);
  }

  /**
   * Create minimal HTML test case focusing on specific violation category
   */
  createIsolatedTestCase(originalHtml, violations, category, scanner) {
    // Extract elements mentioned in violations
    const violationElements = violations.map(v => v.element || v.selector).filter(e => e);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Isolated Test Case: ${category}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .isolated-container { border: 2px solid #007acc; padding: 20px; margin: 20px 0; }
        .violation-info { background: #f0f8ff; padding: 10px; margin-bottom: 20px; }
    </style>
</head>
<body>
    <div class="violation-info">
        <h1>Isolated False Positive Test Case</h1>
        <p><strong>Category:</strong> ${category}</p>
        <p><strong>Scanner:</strong> ${scanner}</p>
        <p><strong>Violations:</strong> ${violations.length}</p>
        <p><strong>Goal:</strong> This minimal test case should PASS (no violations)</p>
    </div>
    
    <div class="isolated-container">
        <h2>Test Elements</h2>
        <!-- TODO: Extract and simplify relevant HTML sections -->
        <!-- Current approach: Include full original for now -->
        <!-- In future iterations, minimize to specific elements -->
    </div>
    
    <script>
        // Log violation details for debugging
        console.log('Violation details:', ${JSON.stringify(violations, null, 2)});
    </script>
    
    <!-- 
    DEBUGGING NOTES:
    - This test case should pass all accessibility scanners
    - Current violations suggest scanner logic needs refinement
    - Focus areas: ${violationElements.join(', ')}
    -->
</body>
</html>`;
  }

  /**
   * Analyze root causes and generate fix recommendations
   */
  analyzeRootCauses(scanner, categories, htmlContent) {
    const recommendations = [];
    
    Object.entries(categories).forEach(([category, violations]) => {
      let recommendation = {
        scanner,
        category,
        violationCount: violations.length,
        rootCause: 'unknown',
        suggestedFix: 'needs investigation',
        priority: 'medium'
      };
      
      // Scanner-specific root cause analysis
      if (scanner === 'color-contrast') {
        if (category === 'color-contrast-ratio') {
          recommendation.rootCause = 'Scanner may not handle CSS custom properties, gradients, or dynamic colors correctly';
          recommendation.suggestedFix = 'Improve CSS parsing to handle modern color patterns';
          recommendation.priority = 'high';
        }
      } else if (scanner === 'keyboard-navigation') {
        if (category === 'keyboard-accessibility') {
          recommendation.rootCause = 'Scanner may not recognize modern accessibility patterns or framework-specific implementations';
          recommendation.suggestedFix = 'Add pattern recognition for valid custom controls and framework patterns';
          recommendation.priority = 'high';
        } else if (category === 'accessible-names') {
          recommendation.rootCause = 'Scanner may not properly detect label associations or ARIA labeling';
          recommendation.suggestedFix = 'Improve accessible name calculation logic';
          recommendation.priority = 'high';
        }
      } else if (scanner === 'html-validation') {
        if (category === 'aria-validation') {
          recommendation.rootCause = 'Scanner may not support modern ARIA patterns or be overly strict';
          recommendation.suggestedFix = 'Update ARIA validation rules to match current specifications';
          recommendation.priority = 'medium';
        }
      }
      
      recommendations.push(recommendation);
    });
    
    return recommendations;
  }

  /**
   * Display actionable recommendations
   */
  displayRecommendations(analysis) {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 ACTIONABLE RECOMMENDATIONS');
    console.log('='.repeat(60));
    
    const hasFalsePositives = Object.values(analysis.scannerResults)
      .some(result => !result.passed && result.totalViolations > 0);
    
    if (!hasFalsePositives) {
      console.log('✅ This file is clean! No false positives detected.');
      return;
    }
    
    analysis.recommendedFixes.forEach((fix, i) => {
      console.log(`\n${i + 1}. ${fix.scanner.toUpperCase()} - ${fix.category}`);
      console.log(`   🚨 Priority: ${fix.priority.toUpperCase()}`);
      console.log(`   🔍 Root Cause: ${fix.rootCause}`);
      console.log(`   🔧 Suggested Fix: ${fix.suggestedFix}`);
      console.log(`   📊 Violations: ${fix.violationCount}`);
    });
    
    console.log(`\n📋 NEXT STEPS:`);
    console.log(`1. Review isolated test cases in false-positive-isolation/${analysis.file.replace('.html', '')}-*/`);
    console.log(`2. Modify scanner logic for highest priority issues`);
    console.log(`3. Test fixes against isolated cases first`);
    console.log(`4. Re-run analysis to verify improvements`);
    console.log(`5. Move to next problematic file`);
  }

  /**
   * Batch analyze multiple files
   */
  async batchAnalyze(filenames, targetScanner = null) {
    console.log(`🚀 BATCH ANALYSIS: ${filenames.length} files\n`);
    
    const results = [];
    
    for (let i = 0; i < filenames.length; i++) {
      const filename = filenames[i];
      console.log(`[${i + 1}/${filenames.length}] Analyzing ${filename}...`);
      
      const analysis = await this.analyzeFile(filename, targetScanner);
      results.push(analysis);
      
      console.log('\n' + '-'.repeat(60) + '\n');
    }
    
    return results;
  }
}

// CLI Usage
if (require.main === module) {
  const analyzer = new FileByFileAnalyzer();
  
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node file-by-file-analyzer.js <filename> [scanner]');
    console.log('Example: node file-by-file-analyzer.js good-cognitive-accessibility.html color-contrast');
    process.exit(1);
  }
  
  const filename = args[0];
  const scanner = args[1] || null;
  
  analyzer.analyzeFile(filename, scanner)
    .catch(console.error);
}

module.exports = FileByFileAnalyzer;