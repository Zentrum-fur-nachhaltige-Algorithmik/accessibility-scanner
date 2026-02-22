const { HTML_SCANNER_MAPPING, getTestFilesByType, getFilesForScanner } = require('../../test-sites/html-scanner-mapping');

/**
 * Build test.each-compatible arrays from the HTML scanner mapping.
 */

function buildBadCases() {
  const badFiles = getTestFilesByType('bad');
  return badFiles.map((fileName) => {
    const config = HTML_SCANNER_MAPPING[fileName];
    return {
      fileName,
      expectedScanners: config.expectedScanners,
      excludedScanners: config.excludedScanners,
      wcagCriteria: config.wcagCriteria,
      description: config.description,
    };
  });
}

function buildGoodCases() {
  const goodFiles = getTestFilesByType('good');
  return goodFiles.map((fileName) => {
    const config = HTML_SCANNER_MAPPING[fileName];
    return {
      fileName,
      excludedScanners: config.excludedScanners,
      wcagCriteria: config.wcagCriteria,
      description: config.description,
    };
  });
}

function buildCasesForScanner(scannerId) {
  const badFiles = getFilesForScanner(scannerId);
  return badFiles.map((fileName) => ({
    fileName,
    ...HTML_SCANNER_MAPPING[fileName],
  }));
}

const badCases = buildBadCases();
const goodCases = buildGoodCases();

module.exports = { badCases, goodCases, buildCasesForScanner };
