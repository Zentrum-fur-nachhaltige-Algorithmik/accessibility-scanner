#!/usr/bin/env node

/**
 * Isolated Test Organizer
 * 
 * Organizes test results into isolated folders by classification type
 * This speeds up debugging by separating:
 * - False positives: Scanners incorrectly flagging clean content
 * - False negatives: Scanners missing actual violations
 * - True positives/negatives: Working correctly (for validation)
 */

const fs = require('fs');
const path = require('path');
const { 
  HTML_SCANNER_MAPPING, 
  getExpectedScannersForFile, 
  getExcludedScannersForFile
} = require('../test-sites/html-scanner-mapping');

// Configuration
const ISOLATED_TESTS_DIR = __dirname;
const TEST_SITES_DIR = path.join(__dirname, '..', 'test-sites');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

// Classification folders
const FOLDERS = {
  'FALSE_POSITIVE': 'false-positives',
  'FALSE_NEGATIVE': 'false-negatives', 
  'TRUE_POSITIVE': 'true-positives',
  'TRUE_NEGATIVE': 'true-negatives'
};

/**
 * Create isolated test file with metadata
 */
function createIsolatedTestFile(scanner, testFile, classification, violations = []) {
  const config = HTML_SCANNER_MAPPING[testFile];
  if (!config) return;
  
  const folder = FOLDERS[classification];
  if (!folder) return;
  
  const folderPath = path.join(ISOLATED_TESTS_DIR, folder);
  
  // Ensure folder exists
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  
  // Read original HTML file
  const originalPath = path.join(TEST_SITES_DIR, testFile);
  if (!fs.existsSync(originalPath)) {
    console.warn(`⚠️  Original file not found: ${testFile}`);
    return;
  }
  
  const originalContent = fs.readFileSync(originalPath, 'utf8');
  
  // Create isolated file name
  const isolatedFileName = `${scanner}_${testFile.replace('.html', '')}_${classification}.html`;
  const isolatedPath = path.join(folderPath, isolatedFileName);
  
  // Add debugging metadata to HTML
  const metadata = `
<!-- ISOLATED TEST METADATA -->
<!-- 
Classification: ${classification}
Scanner: ${scanner}
Original File: ${testFile}
Test Type: ${config.testType}
WCAG Criteria: ${config.wcagCriteria.join(', ')}
Description: ${config.description}
Expected Scanners: ${config.expectedScanners.join(', ')}
Excluded Scanners: ${config.excludedScanners.join(', ')}
Violations Found: ${violations.length}
Generated: ${new Date().toISOString()}
-->

`;
  
  // Inject metadata before closing head tag or at beginning if no head
  let modifiedContent;
  if (originalContent.includes('</head>')) {
    modifiedContent = originalContent.replace('</head>', `${metadata}</head>`);
  } else {
    modifiedContent = metadata + originalContent;
  }
  
  // Write isolated test file
  fs.writeFileSync(isolatedPath, modifiedContent);
  
  return isolatedPath;
}

/**
 * Create test instruction file for each classification
 */
function createTestInstructions(classification, testItems) {
  const folder = FOLDERS[classification];
  if (!folder) return;
  
  const folderPath = path.join(ISOLATED_TESTS_DIR, folder);
  const instructionPath = path.join(folderPath, 'TEST_INSTRUCTIONS.md');
  
  let instructions = '';
  
  switch (classification) {
    case 'FALSE_POSITIVE':
      instructions = `# False Positive Test Cases

These are cases where scanners incorrectly flag content as having violations when they shouldn't.

## Priority: HIGH - Fix These First

**Impact**: Users get incorrect accessibility reports, leading to unnecessary work and loss of confidence in the scanner.

## Test Cases (${testItems.length})

${testItems.map(item => `
### ${item.scanner} on ${item.testFile}
- **Expected**: Should NOT detect violations
- **Actual**: Detected ${item.violations} violations
- **Reason**: ${item.reason || 'Scanner triggering when excluded from this file type'}
- **File**: \`${item.isolatedFile}\`
`).join('')}

## Debugging Steps

1. **Run individual scanner**: \`node src/individual-scanner-api.js\`
2. **Test specific case**: \`curl -X POST http://localhost:3002/api/scan/{scanner} -H "Content-Type: application/json" -d '{"url":"http://localhost:8080/{file}"}'\\
3. **Analyze violations**: Check if scanner logic is too broad
4. **Adjust scanner**: Make scanner more specific to avoid false triggers
5. **Validate fix**: Ensure true positives still work

## Common Causes

- Scanner logic too broad or sensitive
- Missing exclusion rules for specific content patterns  
- Cross-contamination from unrelated accessibility patterns
- Incorrect WCAG criteria application
`;
      break;
      
    case 'FALSE_NEGATIVE':
      instructions = `# False Negative Test Cases

These are cases where scanners miss actual accessibility violations they should detect.

## Priority: HIGH - Fix These First

**Impact**: Real accessibility issues go undetected, leaving websites non-compliant.

## Test Cases (${testItems.length})

${testItems.map(item => `
### ${item.scanner} on ${item.testFile}
- **Expected**: Should detect violations  
- **Actual**: Detected ${item.violations} violations (expected > 0)
- **Reason**: ${item.reason || 'Scanner not triggering on expected violation pattern'}
- **File**: \`${item.isolatedFile}\`
`).join('')}

## Debugging Steps

1. **Run individual scanner**: \`node src/individual-scanner-api.js\`
2. **Test specific case**: \`curl -X POST http://localhost:3002/api/scan/{scanner} -H "Content-Type: application/json" -d '{"url":"http://localhost:8080/{file}"}'\\
3. **Analyze patterns**: Check why scanner missed the violation pattern
4. **Enhance scanner**: Improve detection logic for missed patterns
5. **Validate fix**: Ensure new detection doesn't create false positives

## Common Causes

- Scanner logic too narrow or specific
- Missing detection rules for violation patterns
- Incorrect DOM element selection
- Inadequate WCAG criteria coverage
`;
      break;
      
    case 'TRUE_POSITIVE':
      instructions = `# True Positive Test Cases

These are correctly working cases where scanners properly detect expected violations.

## Priority: MAINTAIN - Validate These Don't Break

**Impact**: These represent correct scanner behavior that should be preserved.

## Test Cases (${testItems.length})

${testItems.map(item => `
### ${item.scanner} on ${item.testFile}
- **Status**: ✅ Working correctly
- **Detected**: ${item.violations} violations (as expected)
- **File**: \`${item.isolatedFile}\`
`).join('')}

## Validation Steps

After fixing false positives/negatives, ensure these still work:

1. **Run regression tests** on these files
2. **Verify violation counts** remain similar  
3. **Check violation quality** - are they still relevant?
4. **Performance check** - scan times should remain reasonable
`;
      break;
      
    case 'TRUE_NEGATIVE':
      instructions = `# True Negative Test Cases

These are correctly working cases where scanners properly ignore content without relevant violations.

## Priority: MAINTAIN - Validate These Don't Break

**Impact**: These represent correct scanner behavior that should be preserved.

## Test Cases (${testItems.length})

${testItems.map(item => `
### ${item.scanner} on ${item.testFile}
- **Status**: ✅ Working correctly  
- **Detected**: ${item.violations} violations (correctly found none)
- **File**: \`${item.isolatedFile}\`
`).join('')}

## Validation Steps

After fixing false positives/negatives, ensure these still work:

1. **Run regression tests** on these files
2. **Verify no violations** are detected
3. **Check for new false positives** introduced by fixes
4. **Performance check** - scan times should remain reasonable
`;
      break;
  }
  
  fs.writeFileSync(instructionPath, instructions);
  return instructionPath;
}

/**
 * Organize test results from JSON report into isolated folders
 */
function organizeTestResults(reportPath) {
  if (!fs.existsSync(reportPath)) {
    console.error(`❌ Report file not found: ${reportPath}`);
    return;
  }
  
  console.log(`📁 Organizing test results from: ${reportPath}\n`);
  
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const { testCombinations } = report;
  
  if (!testCombinations || testCombinations.length === 0) {
    console.error('❌ No test combinations found in report');
    return;
  }
  
  // Group by classification
  const organized = {
    'FALSE_POSITIVE': [],
    'FALSE_NEGATIVE': [], 
    'TRUE_POSITIVE': [],
    'TRUE_NEGATIVE': []
  };
  
  let processed = 0;
  
  testCombinations.forEach(result => {
    if (!result.success || !result.classification) return;
    
    const classification = result.classification;
    if (!organized[classification]) return;
    
    // Create isolated test file
    const isolatedPath = createIsolatedTestFile(
      result.scanner, 
      result.testFile, 
      classification, 
      result.violationDetails || []
    );
    
    if (isolatedPath) {
      organized[classification].push({
        scanner: result.scanner,
        testFile: result.testFile,
        violations: result.violations || 0,
        isolatedFile: path.basename(isolatedPath),
        reason: getClassificationReason(result)
      });
      processed++;
    }
  });
  
  // Create instruction files for each classification
  Object.keys(organized).forEach(classification => {
    if (organized[classification].length > 0) {
      createTestInstructions(classification, organized[classification]);
    }
  });
  
  // Generate summary
  console.log(`📊 ORGANIZATION SUMMARY:`);
  console.log(`   Total test combinations processed: ${processed}`);
  Object.keys(organized).forEach(classification => {
    const count = organized[classification].length;
    const folder = FOLDERS[classification];
    console.log(`   ${classification}: ${count} files → ${folder}/`);
  });
  
  console.log(`\n📋 DEBUGGING PRIORITY:`);
  const falsePositiveCount = organized['FALSE_POSITIVE'].length;
  const falseNegativeCount = organized['FALSE_NEGATIVE'].length;
  
  if (falsePositiveCount > 0) {
    console.log(`   🚨 HIGH: Fix ${falsePositiveCount} false positives first`);
    console.log(`      → Check: isolated-tests/false-positives/`);
  }
  
  if (falseNegativeCount > 0) {
    console.log(`   🚨 HIGH: Fix ${falseNegativeCount} false negatives`);
    console.log(`      → Check: isolated-tests/false-negatives/`);
  }
  
  const truePositiveCount = organized['TRUE_POSITIVE'].length;
  const trueNegativeCount = organized['TRUE_NEGATIVE'].length;
  
  if (truePositiveCount > 0 || trueNegativeCount > 0) {
    console.log(`   ✅ VALIDATE: ${truePositiveCount + trueNegativeCount} working cases don't break`);
    console.log(`      → Check: isolated-tests/true-positives/, isolated-tests/true-negatives/`);
  }
  
  return organized;
}

/**
 * Get human-readable reason for classification
 */
function getClassificationReason(result) {
  const config = HTML_SCANNER_MAPPING[result.testFile];
  if (!config) return 'Unknown file configuration';
  
  const { scanner, testFile, classification, hasViolations } = result;
  const isExpected = config.expectedScanners.includes(scanner);
  const isExcluded = config.excludedScanners.includes(scanner);
  const isBadFile = config.testType === 'bad';
  const isGoodFile = config.testType === 'good';
  
  switch (classification) {
    case 'FALSE_POSITIVE':
      if (isExcluded) {
        return `Scanner explicitly excluded from ${testFile} but still triggered`;
      }
      if (isGoodFile) {
        return `Good example file should not have violations`;
      }
      return 'Unexpected violation detection';
      
    case 'FALSE_NEGATIVE':
      if (isExpected && isBadFile) {
        return `Scanner expected to find violations in this bad example but found none`;
      }
      return 'Expected violation not detected';
      
    case 'TRUE_POSITIVE':
      return `Correctly detected expected violations (${result.violations} found)`;
      
    case 'TRUE_NEGATIVE':
      if (isExcluded) {
        return 'Correctly ignored - scanner excluded from this pattern';
      }
      if (isGoodFile) {
        return 'Correctly ignored - good example with no violations';
      }
      return 'Correctly found no violations';
      
    default:
      return 'Unknown classification reason';
  }
}

/**
 * Quick organize from latest report
 */
async function organizeLatest() {
  // Find latest targeted test report
  if (!fs.existsSync(REPORTS_DIR)) {
    console.error('❌ Reports directory not found');
    return;
  }
  
  const reportFiles = fs.readdirSync(REPORTS_DIR)
    .filter(file => file.startsWith('targeted-test-results-') && file.endsWith('.json'))
    .sort((a, b) => {
      const aTime = fs.statSync(path.join(REPORTS_DIR, a)).mtime;
      const bTime = fs.statSync(path.join(REPORTS_DIR, b)).mtime;
      return bTime - aTime; // Most recent first
    });
  
  if (reportFiles.length === 0) {
    console.error('❌ No targeted test reports found');
    console.log('Run: node test-sites/targeted-test-runner.js expected');
    return;
  }
  
  const latestReport = path.join(REPORTS_DIR, reportFiles[0]);
  console.log(`📄 Using latest report: ${reportFiles[0]}\n`);
  
  return organizeTestResults(latestReport);
}

// CLI usage
if (require.main === module) {
  const reportPath = process.argv[2];
  
  if (reportPath) {
    organizeTestResults(reportPath);
  } else {
    organizeLatest();
  }
}

module.exports = {
  organizeTestResults,
  organizeLatest,
  createIsolatedTestFile,
  createTestInstructions
};