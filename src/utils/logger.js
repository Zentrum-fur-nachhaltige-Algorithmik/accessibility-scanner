/**
 * Minimal leveled logger.
 * Level comes from LOG_LEVEL (error, warn, info, debug); default is info, or
 * silent when NODE_ENV=test and LOG_LEVEL is unset. No timestamps: the
 * process supervisor adds them.
 */
const LEVELS = { silent: -1, error: 0, warn: 1, info: 2, debug: 3 };

function threshold() {
  const env = (process.env.LOG_LEVEL || '').toLowerCase();
  if (env in LEVELS) return LEVELS[env];
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return LEVELS.silent;
  return LEVELS.info;
}

function write(stream, scope, args) {
  const line = args
    .map((a) =>
      a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)
    )
    .join(' ');
  stream.write(`[${scope}] ${line}\n`);
}

/**
 * @param {string} scope short module name shown as a prefix
 * @returns {{error: Function, warn: Function, info: Function, debug: Function}}
 */
function createLogger(scope) {
  return {
    error: (...args) => threshold() >= LEVELS.error && write(process.stderr, scope, args),
    warn: (...args) => threshold() >= LEVELS.warn && write(process.stderr, scope, args),
    info: (...args) => threshold() >= LEVELS.info && write(process.stdout, scope, args),
    debug: (...args) => threshold() >= LEVELS.debug && write(process.stdout, scope, args),
  };
}

module.exports = { createLogger, log: createLogger('app') };
