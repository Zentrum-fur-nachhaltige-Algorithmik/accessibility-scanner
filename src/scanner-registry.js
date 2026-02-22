/**
 * Scanner Registry — instantiates and registers all scanners with a ScanPipeline.
 */

const ColorContrastScanner = require('./color-contrast-scanner');
const UseOfColorScanner = require('./use-of-color-scanner');
const ImagesOfTextScanner = require('./images-of-text-scanner');
const AdvancedContrastScanner = require('./advanced-contrast-scanner');
const NonTextContrastScanner = require('./phase6a-nontext-contrast-scanner');
const TextResizeScanner = require('./phase6a-text-resize-scanner');
const ScreenReaderScanner = require('./screen-reader-scanner');
const MediaAccessibilityScanner = require('./media-accessibility-scanner');
const LanguageDetectionScanner = require('./language-detection-scanner');
const PredictableNavigationScanner = require('./predictable-navigation-scanner');
const ErrorHandlingScanner = require('./error-handling-scanner');
const HTMLValidationScanner = require('./html-validation-scanner');
const PageStructureScanner = require('./page-structure-scanner');
const SeizurePreventionScanner = require('./seizure-prevention-scanner');
const TimingControlsScanner = require('./timing-controls-scanner');
const LabelInNameScanner = require('./phase6a-label-in-name-scanner');
const StatusMessagesScanner = require('./phase6a-status-messages-scanner');
const AdvancedAriaScanner = require('./phase6b-advanced-aria-scanner');
const AccessibilityStatementScanner = require('./accessibility-statement-scanner');
const ContactMechanismScanner = require('./contact-mechanism-scanner');
const ComplianceMonitoringScanner = require('./compliance-monitoring-scanner');
const EAAProcedureScanner = require('./eaa-procedure-scanner');
const KeyboardNavigationScanner = require('./keyboard-navigation-scanner');
const FocusManagementScanner = require('./focus-management-scanner');
const InputModalitiesScanner = require('./input-modalities-scanner');
const ResponsiveDesignScanner = require('./responsive-design-scanner');
const MobileSpecificScanner = require('./phase6d-mobile-specific-scanner');
const DynamicSPAScanner = require('./phase6e-dynamic-spa-scanner');

/**
 * Create all scanner instances.
 * @returns {import('./base-scanner')[]}
 */
function createAllScanners() {
  return [
    // Concurrent scanners (perceivable)
    new ColorContrastScanner(),
    new UseOfColorScanner(),
    new ImagesOfTextScanner(),
    new AdvancedContrastScanner(),
    new NonTextContrastScanner(),
    new TextResizeScanner(),
    new ScreenReaderScanner(),
    new MediaAccessibilityScanner(),

    // Concurrent scanners (understandable)
    new LanguageDetectionScanner(),
    new PredictableNavigationScanner(),
    new ErrorHandlingScanner(),

    // Concurrent scanners (robust)
    new HTMLValidationScanner(),
    new PageStructureScanner(),
    new LabelInNameScanner(),
    new StatusMessagesScanner(),
    new AdvancedAriaScanner(),

    // Concurrent scanners (operable)
    new SeizurePreventionScanner(),
    new TimingControlsScanner(),

    // Exclusive scanners (operable)
    new KeyboardNavigationScanner(),
    new FocusManagementScanner(),
    new InputModalitiesScanner(),
    new ResponsiveDesignScanner(),
    new MobileSpecificScanner(),

    // Exclusive scanners (robust)
    new DynamicSPAScanner(),

    // Exclusive scanners (EAA procedural — navigate to sub-pages)
    new AccessibilityStatementScanner(),
    new ContactMechanismScanner(),
    new ComplianceMonitoringScanner(),
    new EAAProcedureScanner(),
  ];
}

/**
 * Register all scanners with a pipeline.
 * @param {import('./scan-pipeline')} pipeline
 */
function registerAllScanners(pipeline) {
  const scanners = createAllScanners();
  pipeline.registerAll(scanners);
  return scanners;
}

module.exports = { createAllScanners, registerAllScanners };
