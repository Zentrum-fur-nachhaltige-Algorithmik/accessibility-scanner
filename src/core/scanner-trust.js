/**
 * Scanner trust tiers.
 *
 * Default scan profiles contain axe-core, the LLM scanners, and ONLY those
 * custom scanners with a proven clean record. Everything else is quarantined
 * into an `experimental` tier: still registered, still runnable, but excluded
 * from the default profiles and reported with `confidence: 'low'` so a report
 * can mark it as such.
 *
 * The point is NOT that custom scanners are bad — axe + LLM alone would lose
 * every interaction criterion (keyboard, focus, reflow, target size, seizure,
 * hover, EAA procedural), which is this suite's whole differentiator. The
 * failure mode was shipping UNPROVEN scanners in default profiles. Nothing is
 * ever deleted; a scanner earns its way back by turning its harness red green.
 *
 * The tier data lives in `scanner-trust.json` and is DERIVED from the recorded
 * battery results by `scripts/derive-scanner-trust.js` — membership is evidence,
 * revisited each battery run, not opinion.
 */

const TRUST_DATA = require('./scanner-trust.json');

/**
 * @param {string} scannerId
 * @returns {'proven'|'experimental'}
 */
function trustTier(scannerId) {
  // An unlisted scanner is treated as experimental: a new scanner has, by
  // definition, no evidence yet, and defaulting it into production profiles is
  // exactly the mistake this mechanism exists to prevent.
  return TRUST_DATA.scanners[scannerId]?.tier === 'proven' ? 'proven' : 'experimental';
}

/** @returns {string} the recorded evidence for a scanner's tier. */
function trustReason(scannerId) {
  return TRUST_DATA.scanners[scannerId]?.reason || 'No recorded evidence yet (defaults to experimental).';
}

function isProven(scannerId) {
  return trustTier(scannerId) === 'proven';
}

function isExperimental(scannerId) {
  return !isProven(scannerId);
}

/** @returns {string[]} ids of every experimental scanner, sorted. */
function experimentalScannerIds() {
  return Object.entries(TRUST_DATA.scanners)
    .filter(([, v]) => v.tier !== 'proven')
    .map(([id]) => id)
    .sort();
}

module.exports = {
  TRUST_DATA,
  trustTier,
  trustReason,
  isProven,
  isExperimental,
  experimentalScannerIds,
};
