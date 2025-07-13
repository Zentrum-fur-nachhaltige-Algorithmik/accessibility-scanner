#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');

/**
 * Comprehensive False Positive Detection Framework
 * Tests all good HTML files against all scanners to identify false positives systematically
 */
class FalsePositiveDetector {
  constructor() {
    this.apiPort = 3002;
    this.testSitesDir = path.join(__dirname, 'test-sites');
    this.reportDir = path.join(__dirname, 'false-positive-reports');
    this.scanners = [
      'color-contrast',
      'keyboard-navigation', 
      'html-validation',
      'use-of-color',
      'images-of-text',
      'language-detection'
    ];
    
    // Ensure report directory exists
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
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
   * Get all good HTML files for testing
   */
  getGoodFiles() {
    return fs.readdirSync(this.testSitesDir)
      .filter(file => file.startsWith('good-') && file.endsWith('.html'))
      .sort();
  }

  /**
   * Test single file against all scanners
   */
  async testFile(filename) {
    console.log(`🔍 Testing: ${filename}`);
    const fileUrl = `file://${path.join(this.testSitesDir, filename)}`;
    const fileResults = {
      file: filename,
      scanners: {},
      totalFalsePositives: 0,
      hasAnyFalsePositives: false,
      timestamp: new Date().toISOString()
    };

    for (const scanner of this.scanners) {
      try {
        const result = await this.makeRequest(`/api/scan/${scanner}`, { url: fileUrl });
        
        const violations = result.result?.violations?.length || 0;
        const passed = result.result?.passed || false;
        
        const scannerResult = {
          violations,
          passed,
          isFalsePositive: !passed && violations > 0,
          violationDetails: result.result?.violations || []
        };
        
        fileResults.scanners[scanner] = scannerResult;
        
        if (scannerResult.isFalsePositive) {
          fileResults.totalFalsePositives += violations;
          fileResults.hasAnyFalsePositives = true;
          console.log(`   ❌ ${scanner}: ${violations} false positives`);
        } else {
          console.log(`   ✅ ${scanner}: clean`);
        }
        
        // Small delay to prevent API overload
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.log(`   ⚠️  ${scanner}: ERROR - ${error.message}`);
        fileResults.scanners[scanner] = {
          error: error.message,
          isFalsePositive: false
        };
      }
    }

    return fileResults;
  }

  /**
   * Run comprehensive false positive detection across all good files
   */
  async runComprehensiveDetection() {
    console.log('🚀 STARTING COMPREHENSIVE FALSE POSITIVE DETECTION\n');
    
    const goodFiles = this.getGoodFiles();
    console.log(`📊 Testing ${goodFiles.length} good HTML files against ${this.scanners.length} scanners\n`);
    
    const allResults = [];
    let totalFalsePositives = 0;
    let filesWithFalsePositives = 0;

    // Test each file
    for (let i = 0; i < goodFiles.length; i++) {
      const file = goodFiles[i];
      console.log(`[${i + 1}/${goodFiles.length}]`);
      
      const result = await this.testFile(file);
      allResults.push(result);
      
      if (result.hasAnyFalsePositives) {
        filesWithFalsePositives++;
        totalFalsePositives += result.totalFalsePositives;
        console.log(`   📊 Total: ${result.totalFalsePositives} false positives\n`);
      } else {
        console.log(`   ✅ Clean file\n`);
      }
    }

    // Generate comprehensive report
    const report = {
      summary: {
        totalFiles: goodFiles.length,
        filesWithFalsePositives,
        cleanFiles: goodFiles.length - filesWithFalsePositives,
        totalFalsePositives,
        falsePositiveRate: (filesWithFalsePositives / goodFiles.length * 100),
        scannersTestedPerFile: this.scanners.length,
        timestamp: new Date().toISOString()
      },
      fileResults: allResults,
      prioritizedFiles: allResults
        .filter(r => r.hasAnyFalsePositives)
        .sort((a, b) => b.totalFalsePositives - a.totalFalsePositives),
      scannerAnalysis: this.analyzeScannerPerformance(allResults)
    };

    // Save detailed report
    const reportPath = path.join(this.reportDir, `comprehensive-false-positive-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    // Display summary
    this.displaySummary(report);
    
    console.log(`\n📄 Detailed report saved: ${reportPath}`);
    
    return report;
  }

  /**
   * Analyze performance by scanner
   */
  analyzeScannerPerformance(allResults) {
    const scannerStats = {};
    
    this.scanners.forEach(scanner => {
      const scannerResults = allResults.map(r => r.scanners[scanner]).filter(s => s && !s.error);
      const falsePositives = scannerResults.filter(s => s.isFalsePositive);
      const totalViolations = scannerResults.reduce((sum, s) => sum + (s.violations || 0), 0);
      
      scannerStats[scanner] = {
        totalTests: scannerResults.length,
        falsePositiveFiles: falsePositives.length,
        totalFalsePositiveViolations: totalViolations,
        falsePositiveRate: scannerResults.length > 0 ? (falsePositives.length / scannerResults.length * 100) : 0
      };
    });
    
    return scannerStats;
  }

  /**
   * Display comprehensive summary
   */
  displaySummary(report) {
    console.log('\n' + '='.repeat(70));
    console.log('📈 COMPREHENSIVE FALSE POSITIVE SUMMARY');
    console.log('='.repeat(70));
    
    const { summary, prioritizedFiles, scannerAnalysis } = report;
    
    console.log(`\n📊 OVERALL STATS:`);
    console.log(`   Total good files tested: ${summary.totalFiles}`);
    console.log(`   Clean files (no false positives): ${summary.cleanFiles}`);
    console.log(`   Files with false positives: ${summary.filesWithFalsePositives}`);
    console.log(`   Total false positive violations: ${summary.totalFalsePositives}`);
    console.log(`   False positive rate: ${summary.falsePositiveRate.toFixed(1)}%`);
    
    console.log(`\n🚨 TOP 10 PROBLEMATIC FILES:`);
    prioritizedFiles.slice(0, 10).forEach((file, i) => {
      console.log(`   ${i + 1}. ${file.file}: ${file.totalFalsePositives} false positives`);
      const worstScanners = Object.entries(file.scanners)
        .filter(([_, result]) => result.isFalsePositive)
        .sort(([_, a], [__, b]) => b.violations - a.violations)
        .slice(0, 3);
      
      worstScanners.forEach(([scanner, result]) => {
        console.log(`      - ${scanner}: ${result.violations} violations`);
      });
    });
    
    console.log(`\n🔧 SCANNER PERFORMANCE:`);
    Object.entries(scannerAnalysis)
      .sort(([_, a], [__, b]) => b.falsePositiveRate - a.falsePositiveRate)
      .forEach(([scanner, stats]) => {
        console.log(`   ${scanner.padEnd(20)}: ${stats.falsePositiveRate.toFixed(1)}% false positive rate (${stats.falsePositiveFiles}/${stats.totalTests} files)`);
      });
      
    console.log(`\n🎯 NEXT STEPS:`);
    if (summary.totalFalsePositives > 0) {
      const worstScanner = Object.entries(scannerAnalysis)
        .sort(([_, a], [__, b]) => b.falsePositiveRate - a.falsePositiveRate)[0];
      
      console.log(`   1. 🔧 Start with ${worstScanner[0]} scanner (highest false positive rate)`);
      console.log(`   2. 📋 Focus on ${prioritizedFiles[0]?.file} (most false positives)`);
      console.log(`   3. 🔍 Use file-by-file analysis tool for detailed debugging`);
      console.log(`   4. ⚙️  Apply iterative fixes and re-test`);
    } else {
      console.log(`   ✅ All scanners are clean! No false positives detected.`);
    }
  }

  /**
   * Generate prioritized work queue for iterative fixing
   */
  generateWorkQueue(report) {
    const workQueue = [];
    
    // Sort scanners by false positive rate
    const scannersByWorstFirst = Object.entries(report.scannerAnalysis)
      .sort(([_, a], [__, b]) => b.falsePositiveRate - a.falsePositiveRate);
    
    scannersByWorstFirst.forEach(([scanner, stats]) => {
      if (stats.falsePositiveFiles > 0) {
        // Get files for this scanner, sorted by violation count
        const filesForScanner = report.fileResults
          .filter(f => f.scanners[scanner] && f.scanners[scanner].isFalsePositive)
          .sort((a, b) => b.scanners[scanner].violations - a.scanners[scanner].violations);
        
        workQueue.push({
          scanner,
          priority: stats.falsePositiveRate,
          totalFiles: filesForScanner.length,
          totalViolations: stats.totalFalsePositiveViolations,
          files: filesForScanner.map(f => ({
            file: f.file,
            violations: f.scanners[scanner].violations
          }))
        });
      }
    });
    
    return workQueue;
  }
}

// CLI Usage
if (require.main === module) {
  const detector = new FalsePositiveDetector();
  detector.runComprehensiveDetection()
    .then(report => {
      const workQueue = detector.generateWorkQueue(report);
      
      console.log(`\n📋 WORK QUEUE GENERATED:`);
      console.log(`   ${workQueue.length} scanners need false positive fixes`);
      console.log(`   Use file-by-file-analyzer.js to start debugging`);
    })
    .catch(console.error);
}

module.exports = FalsePositiveDetector;