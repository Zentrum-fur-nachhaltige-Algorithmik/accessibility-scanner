/**
 * Shared scanner constants: timeouts, viewports, device matrix, contrast thresholds.
 */
const TIMEOUTS = {
  navigation: 30000,
  scanner: 60000,
  subpage: 10000,
  llmRequest: 30000,
};

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080 },
  desktopSmall: { width: 1280, height: 1024 },
  mobile: { width: 375, height: 667 },
};

/** WCAG contrast ratio minimums. */
const CONTRAST = {
  textAA: 4.5,
  largeTextAA: 3,
  textAAA: 7,
  largeTextAAA: 4.5,
  nonText: 3,
};

/** Puppeteer setViewport shapes. reflow320 is the WCAG 1.4.10 reference width. */
const DEVICES = {
  reflow320: { name: 'Reflow 320 CSS px', width: 320, height: 568, deviceScaleFactor: 2, isMobile: true },
  iphoneSe: { name: 'iPhone SE', width: 375, height: 667, deviceScaleFactor: 2, isMobile: true },
  iphone12: { name: 'iPhone 12', width: 390, height: 844, deviceScaleFactor: 3, isMobile: true },
  galaxyS21: { name: 'Galaxy S21', width: 360, height: 800, deviceScaleFactor: 3, isMobile: true },
  ipad: { name: 'iPad', width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true },
  ipadLandscape: { name: 'iPad landscape', width: 1024, height: 768, deviceScaleFactor: 2, isMobile: true },
  desktop: { name: 'Desktop', width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false },
};

module.exports = { TIMEOUTS, VIEWPORTS, CONTRAST, DEVICES };
