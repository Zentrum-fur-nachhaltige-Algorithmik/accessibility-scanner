'use strict';

/**
 * auth — bearer-token protection for the scan API and generated reports.
 *
 * The API drives a headless browser and writes files; leaving it open on a
 * public port is a resource-abuse and SSRF-pivot risk. When `API_TOKEN` is set
 * every `/api/*` route except the health probe requires
 * `Authorization: Bearer <API_TOKEN>`.
 *
 * `/reports/*` is protected on the same terms: that static mount serves exactly
 * the same generated files as `/api/report/:id` — scanned URLs, DOM snippets
 * and findings — so leaving it open would hand out through one door what the
 * other door locks.
 *
 * When `API_TOKEN` is unset the server stays open (local development, CLI and
 * test harnesses) and logs a loud startup warning instead.
 *
 * @module auth
 */

const log = require('../utils/logger').createLogger('auth');

const crypto = require('crypto');

/** Routes reachable without a token even when API_TOKEN is configured. */
const DEFAULT_PUBLIC_PATHS = ['/api/health'];

/**
 * Path prefixes that require a token when API_TOKEN is set. Everything else
 * (unmatched routes, future static assets) stays open.
 */
const DEFAULT_PROTECTED_PREFIXES = ['/api', '/reports'];

/**
 * Constant-time string comparison.
 *
 * Both sides are hashed first so that `timingSafeEqual` always sees equal-length
 * buffers — otherwise it throws, and the throw itself leaks the token length.
 */
function safeCompare(a, b) {
  const digest = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/**
 * Extract the token from an `Authorization: Bearer <token>` header.
 * @returns {string|null}
 */
function extractBearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer[ \t]+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Normalise the request path for public-path matching, independent of where the
 * middleware was mounted (`app.use(mw)` vs `app.use('/api', mw)`).
 */
function fullPath(req) {
  const combined = `${req.baseUrl || ''}${req.path || ''}`;
  const withoutQuery = combined.split('?')[0];
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery;
}

/**
 * Does `requestPath` sit at or under `prefix`?
 *
 * Compares whole path segments, so `/reports` and `/reports/x.html` match while
 * a sibling route like `/reports-public` does not.
 */
function isUnderPrefix(requestPath, prefix) {
  const base = prefix.replace(/\/+$/, '');
  return requestPath === base || requestPath.startsWith(`${base}/`);
}

/**
 * Build the auth middleware.
 *
 * @param {object} [options]
 * @param {string} [options.token] token to require (default: `process.env.API_TOKEN`)
 * @param {string[]} [options.publicPaths] paths exempt from auth
 * @param {string[]} [options.protectedPrefixes] only paths under these prefixes are guarded
 * @returns {import('express').RequestHandler}
 */
function createAuthMiddleware(options = {}) {
  const {
    token = process.env.API_TOKEN,
    publicPaths = DEFAULT_PUBLIC_PATHS,
    protectedPrefixes = DEFAULT_PROTECTED_PREFIXES,
  } = options;

  const configuredToken = typeof token === 'string' && token.length > 0 ? token : null;
  const publicSet = new Set(publicPaths);

  return function authMiddleware(req, res, next) {
    // Dev mode: no token configured, everything is open (warning logged at startup).
    if (!configuredToken) return next();

    const requestPath = fullPath(req);
    if (!protectedPrefixes.some((prefix) => isUnderPrefix(requestPath, prefix))) return next();
    if (publicSet.has(requestPath)) return next();

    const presented = extractBearerToken(req.get('authorization'));
    if (!presented || !safeCompare(presented, configuredToken)) {
      res.set('WWW-Authenticate', 'Bearer realm="accessibility-api"');
      return res.status(401).json({ error: 'Unauthorized: valid Bearer token required' });
    }

    return next();
  };
}

/**
 * Log the auth posture once at startup.
 * @param {string} [token] default: `process.env.API_TOKEN`
 * @param {Console} [logger]
 */
function logAuthStartupState(token = process.env.API_TOKEN, logger = log) {
  if (typeof token === 'string' && token.length > 0) {
    logger.info(
      'Auth: API_TOKEN set — /api/* and /reports/* require Authorization: Bearer <token> (except /api/health)'
    );
    return true;
  }
  logger.warn('Auth: API is running OPEN — set API_TOKEN for deployment');
  return false;
}

module.exports = {
  createAuthMiddleware,
  logAuthStartupState,
  extractBearerToken,
  safeCompare,
  isUnderPrefix,
  DEFAULT_PUBLIC_PATHS,
  DEFAULT_PROTECTED_PREFIXES,
};
