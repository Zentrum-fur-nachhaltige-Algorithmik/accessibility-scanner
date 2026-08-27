/**
 * Scanner Registry — instantiates and registers all scanners with a ScanPipeline.
 *
 * LLM-powered scanners are conditionally registered when OPENROUTER_API_KEY is set.
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
const MultipleWaysScanner = require('./multiple-ways-scanner');
const OrientationScanner = require('./orientation-scanner');
const InputPurposeScanner = require('./input-purpose-scanner');
const HoverFocusContentScanner = require('./hover-focus-content-scanner');
const ConcurrentInputScanner = require('./concurrent-input-scanner');
const AxeCoreAdapter = require('./axe-core-adapter');

/**
 * Create LLM scanner instances if OPENROUTER_API_KEY is available.
 * @returns {import('./base-scanner')[]}
 */
function createLLMScanners({ llmClient } = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!llmClient && !apiKey) {
    return [];
  }

  const { LLMClient } = require('./llm-client');
  const LLMSemanticTextScanner = require('./llm-semantic-text-scanner');
  const LLMAuthScanner = require('./llm-auth-scanner');
  const LLMMediaAlternativesScanner = require('./llm-media-alternatives-scanner');
  const LLMVisualPresentationScanner = require('./llm-visual-presentation-scanner');
  const LLMBehavioralScanner = require('./llm-behavioral-scanner');
  const LLMFocusAppearanceScanner = require('./llm-focus-appearance-scanner');
  const LLMSensoryCharacteristicsScanner = require('./llm-sensory-characteristics-scanner');
  const LLMReadingLevelScanner = require('./llm-reading-level-scanner');
  const LLMIncompleteReviewerScanner = require('./llm-incomplete-reviewer-scanner');
  const LLMRedundantEntryScanner = require('./llm-redundant-entry-scanner');
  const LLMConsistentHelpScanner = require('./llm-consistent-help-scanner');
  const LLMAltQualityScanner = require('./llm-alt-quality-scanner');

  const client = llmClient || new LLMClient({ apiKey });
  if (!llmClient) console.log('LLM scanners enabled (OPENROUTER_API_KEY detected)');

  return [
    new LLMSemanticTextScanner(client),
    new LLMAuthScanner(client),
    new LLMMediaAlternativesScanner(client),
    new LLMVisualPresentationScanner(client),
    new LLMBehavioralScanner(client),
    new LLMFocusAppearanceScanner(client),
    new LLMSensoryCharacteristicsScanner(client),
    new LLMReadingLevelScanner(client),
    // Sprint P2 additions — previously uncovered criteria plus the axe
    // `incomplete` adjudicator (highest-leverage precision win on real pages).
    new LLMIncompleteReviewerScanner(client),
    new LLMRedundantEntryScanner(client),
    new LLMConsistentHelpScanner(client),
    new LLMAltQualityScanner(client),
  ];
}

/**
 * Create all scanner instances.
 * @returns {import('./base-scanner')[]}
 */
function createAllScanners({ llmClient } = {}) {
  const scanners = [
    // axe-core — high-precision static DOM analysis (replaces 10 heuristic scanners)
    new AxeCoreAdapter(),

    // Concurrent scanners (perceivable)
    new ColorContrastScanner(),
    new UseOfColorScanner(),
    new ImagesOfTextScanner(),
    new AdvancedContrastScanner(),
    new NonTextContrastScanner(),
    new TextResizeScanner(),
    new ScreenReaderScanner(),
    new MediaAccessibilityScanner(),
    new OrientationScanner(),
    new InputPurposeScanner(),

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
    new MultipleWaysScanner(),

    // Exclusive scanners (operable)
    new KeyboardNavigationScanner(),
    new FocusManagementScanner(),
    new InputModalitiesScanner(),
    new ResponsiveDesignScanner(),
    new MobileSpecificScanner(),

    // Exclusive scanners (perceivable — hover/focus content)
    new HoverFocusContentScanner(),

    // Exclusive scanners (operable — reloads with listener instrumentation)
    new ConcurrentInputScanner(),

    // Exclusive scanners (robust)
    new DynamicSPAScanner(),

    // Exclusive scanners (EAA procedural — navigate to sub-pages)
    new AccessibilityStatementScanner(),
    new ContactMechanismScanner(),
    new ComplianceMonitoringScanner(),
    new EAAProcedureScanner(),
  ];

  // Conditionally add LLM-powered scanners
  const llmScanners = createLLMScanners({ llmClient });
  scanners.push(...llmScanners);

  return scanners;
}

/**
 * Scan profiles — subsets of scanners optimised for different speed/coverage
 * trade-offs. `null` means "every scanner this profile is eligible for".
 *
 * IMPORTANT: these lists express SPEED/SCOPE intent only. Actual membership is
 * then filtered by trust tier (see `getProfile`): a custom scanner appears in a
 * default profile only while `src/scanner-trust.json` says its record is clean.
 * Experimental scanners are quarantined out of the defaults but stay registered
 * and can be requested explicitly with `{ includeExperimental: true }`.
 */
const PROFILES = {
  fast: [
    'axe-core',
    // Concurrent (no seizure-prevention — its 10s observation dominates)
    'color-contrast', 'use-of-color', 'images-of-text', 'advanced-contrast',
    'nontext-contrast', 'screen-reader', 'media-accessibility',
    'language-detection', 'predictable-navigation', 'error-handling',
    'html-validation', 'page-structure', 'label-in-name',
    'status-messages', 'advanced-aria', 'timing-controls',
    'orientation', 'input-purpose',
    // Fast exclusive (~6s each with navigation)
    'keyboard-navigation', 'focus-management', 'input-modalities',
    'responsive-design', 'hover-focus-content',
  ],
  standard: [
    'axe-core',
    // Everything except text-resize, mobile-specific
    'color-contrast', 'use-of-color', 'images-of-text', 'advanced-contrast',
    'nontext-contrast', 'screen-reader', 'media-accessibility',
    'language-detection', 'predictable-navigation', 'error-handling',
    'html-validation', 'page-structure', 'label-in-name',
    'status-messages', 'advanced-aria',
    'seizure-prevention', 'timing-controls',
    'orientation', 'input-purpose',
    'keyboard-navigation', 'focus-management', 'input-modalities',
    'responsive-design', 'hover-focus-content', 'concurrent-input',
    'dynamic-spa',
    'accessibility-statement', 'contact-mechanism',
    'compliance-monitoring', 'eaa-procedure',
    'multiple-ways', 'llm-sensory-characteristics',
    // The axe `incomplete` adjudicator belongs in `standard`: it turns
    // axe's "needs manual review" backlog into decided findings, which is
    // the single biggest precision win on real pages.
    'llm-incomplete-reviewer',
  ],
  full: null, // all scanners
};

const PROFILE_OPTIONS = {
  fast: { observationTime: 0, heuristicOnly: true },
  standard: { observationTime: 3000 },
  full: {},
};

/**
 * Every scanner id the registry can produce, without instantiating LLM clients
 * twice or requiring an API key.
 */
function allScannerIds() {
  return createAllScanners({ llmClient: {} }).map((s) => s.id);
}

/**
 * Resolve a profile name to scanner ids and merged options.
 *
 * Membership is TRUST-TIERED: the profile list above states the speed/scope
 * intent, and this filters it to axe-core + the LLM scanners + the custom
 * scanners currently rated `proven` in `src/scanner-trust.json` (derived from
 * the recorded battery results by `scripts/derive-scanner-trust.js`).
 *
 * Quarantined scanners are not deleted — pass `{ includeExperimental: true }`
 * to run them. Their findings are tagged `confidence: 'low'` by the pipeline so
 * a report can present them separately.
 *
 * @param {string} name — 'fast' | 'standard' | 'full'
 * @param {{ includeExperimental?: boolean }} [opts]
 * @returns {{ scannerIds: string[], options: object, excluded: string[] }}
 */
function getProfile(name, opts = {}) {
  if (!PROFILES.hasOwnProperty(name)) {
    throw new Error(`Unknown scan profile: "${name}". Valid profiles: ${Object.keys(PROFILES).join(', ')}`);
  }

  const requested = PROFILES[name] || allScannerIds();
  const { isProven } = require('./scanner-trust');

  const scannerIds = opts.includeExperimental
    ? requested
    : requested.filter((id) => isProven(id));
  const excluded = requested.filter((id) => !scannerIds.includes(id));

  return {
    scannerIds,
    options: PROFILE_OPTIONS[name] || {},
    excluded,
  };
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

module.exports = {
  createAllScanners,
  createLLMScanners,
  registerAllScanners,
  getProfile,
  allScannerIds,
  PROFILES,
  PROFILE_OPTIONS,
};
