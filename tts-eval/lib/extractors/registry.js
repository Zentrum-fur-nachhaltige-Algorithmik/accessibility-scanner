import { MistralAdapter } from './mistral-adapter.js';

/**
 * Registry of all available extractors.
 * Lazy-loads adapters to avoid import errors for missing dependencies.
 */

const EXTRACTOR_FACTORIES = {
  mistral: (opts) => new MistralAdapter(opts),

  pymupdf: async (opts) => {
    const { PyMuPDFAdapter } = await import('./pymupdf-adapter.js');
    return new PyMuPDFAdapter({ ...opts, hybrid: false });
  },

  'pymupdf-hybrid': async (opts) => {
    const { PyMuPDFAdapter } = await import('./pymupdf-adapter.js');
    return new PyMuPDFAdapter({ ...opts, hybrid: true });
  },

  nougat: async (opts) => {
    const { NougatAdapter } = await import('./nougat-adapter.js');
    return new NougatAdapter(opts);
  },

  marker: async (opts) => {
    const { MarkerAdapter } = await import('./marker-adapter.js');
    return new MarkerAdapter(opts);
  },

  mathpix: async (opts) => {
    const { MathpixAdapter } = await import('./mathpix-adapter.js');
    return new MathpixAdapter(opts);
  },
};

/**
 * Get an extractor instance by name.
 * @param {string} name - Extractor name (mistral, pymupdf, pymupdf-hybrid, nougat, marker, mathpix)
 * @param {Object} options - Options to pass to the adapter constructor
 * @returns {Promise<BaseExtractor>}
 */
export async function getExtractor(name, options = {}) {
  const factory = EXTRACTOR_FACTORIES[name];
  if (!factory) {
    throw new Error(`Unknown extractor: "${name}". Available: ${listExtractors().join(', ')}`);
  }
  const instance = await factory(options);
  return instance;
}

/**
 * List all registered extractor names.
 * @returns {string[]}
 */
export function listExtractors() {
  return Object.keys(EXTRACTOR_FACTORIES);
}

/**
 * Get all extractors that are currently available (dependencies met).
 * @param {Object} options - Options to pass to adapters
 * @returns {Promise<Array<{name: string, extractor: BaseExtractor}>>}
 */
export async function getAvailableExtractors(options = {}) {
  const available = [];

  for (const name of listExtractors()) {
    try {
      const extractor = await getExtractor(name, options);
      if (extractor.isAvailable()) {
        available.push({ name, extractor });
      }
    } catch {
      // Adapter module not found or import failed — skip
    }
  }

  return available;
}
