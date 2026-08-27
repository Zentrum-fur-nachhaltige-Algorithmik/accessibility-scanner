/**
 * Runtime configuration. Every process.env read lives here.
 */
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function int(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}

function list(name) {
  const v = process.env[name];
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

const config = {
  port: int('PORT', 3000),
  apiToken: process.env.API_TOKEN || '',
  openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
  llmModel: process.env.LLM_MODEL || 'google/gemini-3.5-flash',
  llmFallbackModels: list('LLM_FALLBACK_MODELS').length
    ? list('LLM_FALLBACK_MODELS')
    : ['google/gemini-3-flash-preview'],
  scanAllowedHosts: process.env.SCAN_ALLOWED_HOSTS,
  scanConcurrency: int('SCAN_CONCURRENCY', 1),
  scanRateLimitMax: int('SCAN_RATE_LIMIT_MAX', 5),
  scanRateLimitWindowMs: int('SCAN_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000),
  reportsDir: process.env.REPORTS_DIR || path.join(ROOT, 'reports'),
  screenshotDir:
    process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), 'accessibility-scanner', 'screenshots'),
  reportOrgName: process.env.REPORT_ORG_NAME || 'Accessibility Scanner',
};

module.exports = config;
