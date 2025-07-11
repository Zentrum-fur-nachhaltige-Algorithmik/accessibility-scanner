#!/usr/bin/env node

/**
 * Analyze what axe-core tests vs what CSP-immune alternatives can test
 * Shows exactly what we lose with CSP-blocked axe and what alternatives exist
 */

const axe = require('axe-core');

console.log('🔍 AXE-CORE vs CSP-IMMUNE ALTERNATIVES ANALYSIS');
console.log('='.repeat(80));

// Get all axe rules
const rules = axe.getRules();
console.log(`📊 Total axe-core rules: ${rules.length}`);

// Categorize axe rules
const categories = {};
rules.forEach(rule => {
  rule.tags.forEach(tag => {
    if (!categories[tag]) categories[tag] = [];
    categories[tag].push({
      id: rule.ruleId,
      description: rule.description,
      impact: rule.impact
    });
  });
});

console.log('\n📋 AXE-CORE RULE CATEGORIES:');
Object.keys(categories).sort().forEach(category => {
  if (category.includes('wcag') || category.includes('best-practice')) {
    console.log(`   ${category}: ${categories[category].length} rules`);
  }
});

// Define what our CSP-immune scanners can test
const cspImmuneCapabilities = {
  'ScreenReaderScanner': {
    covers: [
      'html-has-lang',
      'html-lang-valid', 
      'heading-order',
      'landmark-one-main',
      'landmark-no-duplicate-banner',
      'landmark-no-duplicate-contentinfo',
      'region',
      'page-has-heading-one',
      'bypass',
      'image-alt',
      'image-redundant-alt',
      'aria-labels',
      'aria-labelledby',
      'aria-describedby',
      'form-field-multiple-labels',
      'label',
      'aria-valid-attr',
      'aria-valid-attr-value',
      'aria-roles'
    ],
    description: 'DOM-based analysis of semantic HTML structure, headings, landmarks, ARIA'
  },
  
  'ColorContrastScanner': {
    covers: [
      'color-contrast',
      'color-contrast-enhanced'
    ],
    description: 'Canvas-based color analysis independent of CSP'
  },
  
  'HTMLValidationScanner': {
    covers: [
      'valid-lang',
      'html-has-lang',
      'html-lang-valid',
      'duplicate-id',
      'duplicate-id-active', 
      'duplicate-id-aria',
      'aria-valid-attr',
      'aria-valid-attr-value',
      'aria-roles',
      'aria-allowed-attr',
      'aria-required-attr',
      'aria-required-children',
      'aria-required-parent'
    ],
    description: 'HTML parsing and validation without script injection'
  },
  
  'KeyboardNavigationScanner': {
    covers: [
      'focusable-element',
      'focus-order-semantics',
      'tabindex',
      'keyboard',
      'keyboard-navigation'
    ],
    description: 'Direct interaction testing without axe dependency'
  },
  
  'LanguageDetectionScanner': {
    covers: [
      'html-has-lang',
      'html-lang-valid',
      'valid-lang'
    ],
    description: 'Language attribute analysis'
  }
};

console.log('\n🛡️ CSP-IMMUNE ALTERNATIVES:');
console.log('='.repeat(50));

Object.entries(cspImmuneCapabilities).forEach(([scanner, info]) => {
  console.log(`\n📊 ${scanner}:`);
  console.log(`   📝 ${info.description}`);
  console.log(`   ✅ Covers ${info.covers.length} axe rules:`);
  info.covers.slice(0, 5).forEach(rule => {
    console.log(`      • ${rule}`);
  });
  if (info.covers.length > 5) {
    console.log(`      • ... and ${info.covers.length - 5} more`);
  }
});

// Calculate coverage
const allCoveredRules = new Set();
Object.values(cspImmuneCapabilities).forEach(scanner => {
  scanner.covers.forEach(rule => allCoveredRules.add(rule));
});

const axeRuleIds = rules.map(r => r.ruleId);
const coveredByAlternatives = Array.from(allCoveredRules).filter(rule => 
  axeRuleIds.includes(rule)
);

const notCoveredByAlternatives = axeRuleIds.filter(rule => 
  !allCoveredRules.has(rule)
);

console.log('\n📈 COVERAGE ANALYSIS:');
console.log('='.repeat(50));
console.log(`✅ Covered by CSP-immune alternatives: ${coveredByAlternatives.length}/${rules.length} rules (${Math.round(coveredByAlternatives.length/rules.length*100)}%)`);
console.log(`❌ Only available via axe: ${notCoveredByAlternatives.length} rules`);

console.log('\n❌ RULES ONLY AVAILABLE VIA AXE (CSP-dependent):');
notCoveredByAlternatives.slice(0, 15).forEach(ruleId => {
  const rule = rules.find(r => r.ruleId === ruleId);
  if (rule) {
    console.log(`   • ${ruleId}: ${rule.description}`);
  }
});

if (notCoveredByAlternatives.length > 15) {
  console.log(`   • ... and ${notCoveredByAlternatives.length - 15} more rules`);
}

console.log('\n💡 PRACTICAL IMPLICATIONS:');
console.log('='.repeat(50));

// Critical missing functionality
const criticalMissing = [
  'button-name',
  'link-name', 
  'frame-title',
  'object-alt',
  'area-alt',
  'input-image-alt',
  'meta-refresh',
  'meta-viewport',
  'bypass',
  'skip-link'
];

const criticalMissingInAxeOnly = criticalMissing.filter(rule => 
  notCoveredByAlternatives.includes(rule)
);

if (criticalMissingInAxeOnly.length > 0) {
  console.log(`🚨 Critical missing in CSP-immune alternatives:`);
  criticalMissingInAxeOnly.forEach(rule => {
    console.log(`   • ${rule}`);
  });
}

console.log(`\n✅ RECOMMENDATION:`);
console.log(`   Use CSP-immune scanners as PRIMARY method`);
console.log(`   ${Math.round(coveredByAlternatives.length/rules.length*100)}% coverage without CSP dependency`);
console.log(`   Axe-core as ENHANCEMENT when CSP allows`);
console.log(`   Focus on implementing missing critical rules in specialized scanners`);

// Specific test case recommendations
console.log('\n🎯 TEST CASE STRATEGY:');
console.log('='.repeat(50));
console.log('✅ SAFE FOR CSP-PROTECTED SITES:');
console.log('   • Screen reader structure tests');
console.log('   • Color contrast analysis');
console.log('   • HTML validation tests');
console.log('   • Keyboard navigation tests');
console.log('   • Language compliance tests');

console.log('\n⚠️ REQUIRES CSP BYPASS OR ALTERNATIVES:');
console.log('   • Button/link naming validation');
console.log('   • Frame title checking');
console.log('   • Meta tag analysis');
console.log('   • Skip link functionality');
console.log('   • Complex ARIA relationship validation');

console.log('\n🔄 HYBRID APPROACH:');
console.log('   1. Run CSP-immune scanners FIRST (always works)');
console.log('   2. Attempt axe with CSP bypass (when possible)');
console.log('   3. Combine results for comprehensive coverage');
console.log('   4. Flag CSP-only rules as "requires manual review"');

module.exports = {
  cspImmuneCapabilities,
  coveredByAlternatives,
  notCoveredByAlternatives,
  coveragePercentage: Math.round(coveredByAlternatives.length/rules.length*100)
};