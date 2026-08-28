/**
 * scanner-registry
 * Instantiates and registers all scanners with a ScanPipeline, and defines scan profiles.
 * LLM scanners are registered only when OPENROUTER_API_KEY is set; profile
 * membership is filtered by trust tier from scanner-trust.json.
 */

const ColorContrastScanner = require('../scanners/color-contrast');
const UseOfColorScanner = require('../scanners/use-of-color');
const ImagesOfTextScanner = require('../scanners/images-of-text');
const AdvancedContrastScanner = require('../scanners/advanced-contrast');
const NonTextContrastScanner = require('../scanners/nontext-contrast');
const TextResizeScanner = require('../scanners/text-resize');
const ScreenReaderScanner = require('../scanners/screen-reader');
const MediaAccessibilityScanner = require('../scanners/media-accessibility');
const PredictableNavigationScanner = require('../scanners/predictable-navigation');
const ErrorHandlingScanner = require('../scanners/error-handling');
const PageStructureScanner = require('../scanners/page-structure');
const SeizurePreventionScanner = require('../scanners/seizure-prevention');
const TimingControlsScanner = require('../scanners/timing-controls');
const LabelInNameScanner = require('../scanners/label-in-name');
const StatusMessagesScanner = require('../scanners/status-messages');
const AdvancedAriaScanner = require('../scanners/advanced-aria');
const AccessibilityStatementScanner = require('../scanners/accessibility-statement');
const ContactMechanismScanner = require('../scanners/contact-mechanism');
const ComplianceMonitoringScanner = require('../scanners/compliance-monitoring');
const EAAProcedureScanner = require('../scanners/eaa-procedure');
const KeyboardNavigationScanner = require('../scanners/keyboard-navigation');
const FocusManagementScanner = require('../scanners/focus-management');
const InputModalitiesScanner = require('../scanners/input-modalities');
const ResponsiveDesignScanner = require('../scanners/responsive-design');
const MobileSpecificScanner = require('../scanners/mobile-specific');
const DynamicSPAScanner = require('../scanners/dynamic-spa');
const MultipleWaysScanner = require('../scanners/multiple-ways');
const OrientationScanner = require('../scanners/orientation');
const InputPurposeScanner = require('../scanners/input-purpose');
const HoverFocusContentScanner = require('../scanners/hover-focus-content');
const ConcurrentInputScanner = require('../scanners/concurrent-input');
const AxeCoreAdapter = require('../scanners/axe-core');
const log = require('../utils/logger').createLogger('scanner-registry');

/**
 * Create LLM scanner instances if OPENROUTER_API_KEY is available.
 * @returns {import('./base-scanner')[]}
 */
function createLLMScanners({ llmClient } = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!llmClient && !apiKey) {
    return [];
  }

  const { LLMClient } = require('../llm/client');
  const LLMSemanticTextScanner = require('../scanners/llm/semantic-text');
  const LLMAuthScanner = require('../scanners/llm/auth');
  const LLMMediaAlternativesScanner = require('../scanners/llm/media-alternatives');
  const LLMVisualPresentationScanner = require('../scanners/llm/visual-presentation');
  const LLMBehavioralScanner = require('../scanners/llm/behavioral');
  const LLMFocusAppearanceScanner = require('../scanners/llm/focus-appearance');
  const LLMSensoryCharacteristicsScanner = require('../scanners/llm/sensory-characteristics');
  const LLMReadingLevelScanner = require('../scanners/llm/reading-level');
  const LLMIncompleteReviewerScanner = require('../scanners/llm/incomplete-reviewer');
  const LLMRedundantEntryScanner = require('../scanners/llm/redundant-entry');
  const LLMConsistentHelpScanner = require('../scanners/llm/consistent-help');
  const LLMAltQualityScanner = require('../scanners/llm/alt-quality');

  const client = llmClient || new LLMClient({ apiKey });
  if (!llmClient) log.info('LLM scanners enabled (OPENROUTER_API_KEY detected)');

  return [
    new LLMSemanticTextScanner(client),
    new LLMAuthScanner(client),
    new LLMMediaAlternativesScanner(client),
    new LLMVisualPresentationScanner(client),
    new LLMBehavioralScanner(client),
    new LLMFocusAppearanceScanner(client),
    new LLMSensoryCharacteristicsScanner(client),
    new LLMReadingLevelScanner(client),
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
    new AxeCoreAdapter(),
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
    new PredictableNavigationScanner(),
    new ErrorHandlingScanner(),
    new PageStructureScanner(),
    new LabelInNameScanner(),
    new StatusMessagesScanner(),
    new AdvancedAriaScanner(),
    new SeizurePreventionScanner(),
    new TimingControlsScanner(),
    new MultipleWaysScanner(),
    new KeyboardNavigationScanner(),
    new FocusManagementScanner(),
    new InputModalitiesScanner(),
    new ResponsiveDesignScanner(),
    new MobileSpecificScanner(),
    new HoverFocusContentScanner(),
    new ConcurrentInputScanner(),
    new DynamicSPAScanner(),
    new AccessibilityStatementScanner(),
    new ContactMechanismScanner(),
    new ComplianceMonitoringScanner(),
    new EAAProcedureScanner(),
  ];

  const llmScanners = createLLMScanners({ llmClient });
  scanners.push(...llmScanners);

  return scanners;
}

/**
 * Scan profiles: subsets of scanners optimised for different speed/coverage
 * trade-offs. `null` means "every scanner this profile is eligible for".
 *
 * IMPORTANT: these lists express SPEED/SCOPE intent only. Actual membership is
 * then filtered by trust tier (see `getProfile`): a custom scanner appears in a
 * default profile only while `src/core/scanner-trust.json` says its record is clean.
 * Experimental scanners are quarantined out of the defaults but stay registered
 * and can be requested explicitly with `{ includeExperimental: true }`.
 */
const PROFILES = {
  fast: [
    'axe-core',
    // No seizure-prevention: its 10s observation dominates
    'color-contrast',
    'use-of-color',
    'images-of-text',
    'advanced-contrast',
    'nontext-contrast',
    'screen-reader',
    'media-accessibility',
    'predictable-navigation',
    'error-handling',
    'page-structure',
    'label-in-name',
    'status-messages',
    'advanced-aria',
    'timing-controls',
    'orientation',
    'input-purpose',
    // Fast exclusive (~6s each with navigation)
    'keyboard-navigation',
    'focus-management',
    'input-modalities',
    'responsive-design',
    'hover-focus-content',
  ],
  standard: [
    'axe-core',
    // Everything except text-resize, mobile-specific
    'color-contrast',
    'use-of-color',
    'images-of-text',
    'advanced-contrast',
    'nontext-contrast',
    'screen-reader',
    'media-accessibility',
    'predictable-navigation',
    'error-handling',
    'page-structure',
    'label-in-name',
    'status-messages',
    'advanced-aria',
    'seizure-prevention',
    'timing-controls',
    'orientation',
    'input-purpose',
    'keyboard-navigation',
    'focus-management',
    'input-modalities',
    'responsive-design',
    'hover-focus-content',
    'concurrent-input',
    'dynamic-spa',
    'accessibility-statement',
    'contact-mechanism',
    'compliance-monitoring',
    'eaa-procedure',
    'multiple-ways',
    'llm-sensory-characteristics',
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
 * scanners currently rated `proven` in `src/core/scanner-trust.json` (derived from
 * the recorded battery results by `scripts/derive-scanner-trust.js`).
 *
 * Quarantined scanners stay registered; pass `{ includeExperimental: true }`
 * to run them. Their findings are tagged `confidence: 'low'` by the pipeline so
 * a report can present them separately.
 *
 * @param {string} name - 'fast' | 'standard' | 'full'
 * @param {{ includeExperimental?: boolean }} [opts]
 * @returns {{ scannerIds: string[], options: object, excluded: string[] }}
 */
function getProfile(name, opts = {}) {
  if (!Object.hasOwn(PROFILES, name)) {
    throw new Error(
      `Unknown scan profile: "${name}". Valid profiles: ${Object.keys(PROFILES).join(', ')}`
    );
  }

  const requested = PROFILES[name] || allScannerIds();
  const { isProven } = require('./scanner-trust');

  const scannerIds = opts.includeExperimental ? requested : requested.filter((id) => isProven(id));
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
