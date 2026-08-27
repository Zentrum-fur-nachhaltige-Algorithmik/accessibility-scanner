/**
 * scanner-trust
 * Trust tiers for custom scanners: `proven` scanners join the default profiles,
 * `experimental` ones stay registered but are excluded from defaults and report
 * `confidence: 'low'`. Tiers are derived from recorded battery results into scanner-trust.json.
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
  return (
    TRUST_DATA.scanners[scannerId]?.reason || 'No recorded evidence yet (defaults to experimental).'
  );
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
