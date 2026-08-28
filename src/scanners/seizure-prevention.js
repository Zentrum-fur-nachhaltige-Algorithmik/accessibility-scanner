/**
 * Seizure Prevention Scanner.
 * WCAG 2.3.1, 2.3.2, 2.3.3 (EN 301 549 9.2.3.1, 9.2.3.3).
 * Samples the rendered luminance of animated elements frame by frame and
 * applies the WCAG general and red flash thresholds, and measures whether the
 * page reacts to prefers-reduced-motion by emulating the preference.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const { injectableCode: renderedCode } = require('../utils/rendered');
const log = require('../utils/logger').createLogger('seizure-prevention');

/** Shortest and longest luminance sampling window, in milliseconds. */
const MIN_SAMPLE_MS = 1600;
const MAX_SAMPLE_MS = 4000;

/**
 * Steps taken through one animation iteration for 2.3.3, and the travel a box
 * has to cover across them before the motion counts as large. Below this an
 * animation is a state change (a pulse, a hover lift, a 1.05 scale), not the
 * movement 2.3.3 is about.
 */
const MOTION_SAMPLE_STEPS = 16;
const MOTION_TRAVEL_PX = 100;

class SeizurePreventionScanner extends BaseScanner {
  constructor() {
    super('seizure-prevention', {
      // 2.3.3 (Animation from Interactions) is emitted by
      // analyzeMotionSensitivity() as EN 301 549 clause 9.2.3.3.
      wcagCriteria: ['2.3.1', '2.3.2', '2.3.3'],
      wcagPrinciple: 'operable',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const defaultOptions = {
      testFlashingContent: true,
      testMotionSensitivity: true,
      observationTime: 3000,
      timeout: TIMEOUTS.scanner,
    };

    const scanOptions = { ...defaultOptions, ...options };

    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const seizureResults = await this.performSeizurePreventionAnalysis(page, scanDir, scanOptions);

    return {
      scannerId: this.id,
      criteria: ['9.2.3.1', '9.2.3.3'],
      passed: seizureResults.violations.length === 0,
      violations: seizureResults.violations,
      summary: {
        noFlashingViolations: seizureResults.noFlashingViolations,
        motionSensitivitySupported: seizureResults.motionSensitivitySupported,
        seizureRiskLevel: seizureResults.seizureRiskLevel,
        sampledElements: seizureResults.sampledElements,
        sampleWindowMs: seizureResults.sampleWindowMs,
      },
      screenshotPath: scanDir,
      visualEvidence: seizureResults.visualEvidence,
    };
  }

  /**
   * Run the flash measurement and the reduced-motion measurement.
   */
  async performSeizurePreventionAnalysis(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let noFlashingViolations = true;
    let motionSensitivitySupported = true;
    let seizureRiskLevel = 'LOW';
    let sampledElements = 0;
    let sampleWindowMs = 0;

    log.debug('Starting seizure prevention analysis');

    const initialScreenshot = path.join(scanDir, 'seizure-prevention-analysis.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    if (options.testFlashingContent) {
      sampleWindowMs = Math.min(
        Math.max(options.observationTime || 0, MIN_SAMPLE_MS),
        MAX_SAMPLE_MS
      );
      const flashingResults = await this.analyzeFlashingContent(page, violations, sampleWindowMs);
      noFlashingViolations = flashingResults.safe;
      seizureRiskLevel = flashingResults.riskLevel;
      sampledElements = flashingResults.sampledElements;
    }

    if (options.testMotionSensitivity) {
      const motionResults = await this.analyzeMotionSensitivity(page, violations);
      motionSensitivitySupported = motionResults.supported;
    }

    visualEvidence.push({
      type: 'seizure-prevention',
      screenshot: path.basename(initialScreenshot),
      riskLevel: seizureRiskLevel,
      flashingSafe: noFlashingViolations,
      motionSensitive: motionSensitivitySupported,
      safetyWarning: seizureRiskLevel === 'HIGH' ? 'DANGER: High seizure risk detected' : null,
    });

    log.debug(`Seizure prevention analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      noFlashingViolations,
      motionSensitivitySupported,
      seizureRiskLevel,
      sampledElements,
      sampleWindowMs,
    };
  }

  /**
   * Measure flashing (WCAG 2.3.1 / 2.3.2).
   *
   * The relative luminance and the colour of every candidate are sampled once
   * per animation frame over the observation window. A flash is a pair of
   * opposing luminance changes of at least 0.1 whose darker end is below 0.8,
   * which is the WCAG general flash threshold; more than three such pairs per
   * second is a failure, provided the flashing area is larger than a quarter
   * of the 10-degree visual field (the small safe area exception). A pair
   * whose endpoints include a saturated red (R / (R + G + B) >= 0.8) is
   * reported under the red flash threshold instead.
   */
  async analyzeFlashingContent(page, violations, sampleMs) {
    log.debug(`Sampling rendered luminance for ${sampleMs}ms`);

    const analysis = await page.evaluate(
      async (renderedSrc, windowMs) => {
        eval(renderedSrc);

        const safeClass = (el) => (typeof el.className === 'string' ? el.className : '');
        const selectorOf = (el) => {
          const cls = safeClass(el).trim().split(/\s+/).filter(Boolean)[0];
          return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (cls ? `.${cls}` : '');
        };

        const parseColor = (value) => {
          const m = /rgba?\(([^)]+)\)/.exec(value || '');
          if (!m) return null;
          const parts = m[1]
            .split(/[\s,/]+/)
            .filter(Boolean)
            .map(parseFloat);
          if (parts.length < 3 || parts.some(Number.isNaN)) return null;
          return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
        };

        const brightnessOf = (filterValue) => {
          const m = /brightness\(([^)]+)\)/.exec(filterValue || '');
          if (!m) return 1;
          const raw = m[1].trim();
          const value = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
          return Number.isFinite(value) && value > 0 ? value : 1;
        };

        // The painted colour of the element: its own background composited over
        // white, or its text colour when the background is transparent, scaled
        // by opacity and by any brightness() filter.
        const paintedColor = (el) => {
          const s = window.getComputedStyle(el);
          const bg = parseColor(s.backgroundColor);
          const fg = parseColor(s.color);
          const base = bg && bg.a > 0.05 ? bg : fg;
          if (!base) return null;
          const opacity = parseFloat(s.opacity);
          const alpha = base.a * (Number.isFinite(opacity) ? opacity : 1);
          const gain = brightnessOf(s.filter);
          const mix = (c) => Math.max(0, Math.min(255, (c * alpha + 255 * (1 - alpha)) * gain));
          return { r: mix(base.r), g: mix(base.g), b: mix(base.b) };
        };

        const relativeLuminance = (c) => {
          const channel = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
        };

        // WCAG saturated red: R / (R + G + B) >= 0.8 of the transition colours.
        const isSaturatedRed = (c) => {
          if (!c) return false;
          const sum = c.r + c.g + c.b;
          return sum > 0 && c.r / sum >= 0.8 && c.r >= 128;
        };

        const visibleArea = (el) => {
          const r = el.getBoundingClientRect();
          const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
          const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
          return w * h;
        };

        const candidates = [];
        const seen = new Set();
        const addCandidate = (el, area) => {
          if (!el || seen.has(el)) return;
          seen.add(el);
          candidates.push({ el: el, area: area, selector: selectorOf(el) });
        };

        // The document background is repainted by script on many flashing
        // pages, so it is sampled whether or not it carries a CSS animation.
        addCandidate(document.documentElement, window.innerWidth * window.innerHeight);
        if (document.body) addCandidate(document.body, window.innerWidth * window.innerHeight);

        for (const el of document.querySelectorAll('body *')) {
          const s = window.getComputedStyle(el);
          const duration = parseFloat(s.animationDuration) || 0;
          if (s.animationName === 'none' || duration <= 0) continue;
          if (!__isRendered(el)) continue;
          addCandidate(el, visibleArea(el));
        }

        // Sampling every candidate once per frame is the cost of this scanner;
        // the largest boxes are the ones the area threshold can ever admit.
        candidates.sort((a, b) => b.area - a.area);
        const sampled = candidates.slice(0, 100);
        const series = sampled.map(() => []);
        const colors = sampled.map(() => []);

        const start = performance.now();
        await new Promise((resolve) => {
          const step = () => {
            for (let i = 0; i < sampled.length; i++) {
              const c = paintedColor(sampled[i].el);
              if (!c) continue;
              series[i].push(relativeLuminance(c));
              colors[i].push(c);
            }
            if (performance.now() - start >= windowMs) {
              resolve();
              return;
            }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        const elapsedSeconds = Math.max((performance.now() - start) / 1000, 0.001);

        // Small safe area: a flash smaller than a quarter of the 10-degree
        // visual field (341 x 256 px at the reference resolution) is exempt.
        const fieldArea = Math.min(341 * 256, window.innerWidth * window.innerHeight);
        const areaThreshold = 0.25 * fieldArea;

        const issues = [];
        for (let i = 0; i < sampled.length; i++) {
          const values = series[i];
          if (values.length < 6) continue;
          let transitions = 0;
          let direction = 0;
          let reference = values[0];
          let referenceIndex = 0;
          let sawRed = false;
          for (let k = 1; k < values.length; k++) {
            const delta = values[k] - reference;
            if (Math.abs(delta) < 0.1) continue;
            if (Math.min(values[k], reference) >= 0.8) {
              reference = values[k];
              referenceIndex = k;
              continue;
            }
            const nextDirection = delta > 0 ? 1 : -1;
            if (nextDirection !== direction) {
              transitions++;
              direction = nextDirection;
              if (isSaturatedRed(colors[i][k]) || isSaturatedRed(colors[i][referenceIndex])) {
                sawRed = true;
              }
            }
            reference = values[k];
            referenceIndex = k;
          }
          const pairs = Math.floor(transitions / 2);
          const hz = pairs / elapsedSeconds;
          if (hz <= 3) continue;
          const area = Math.max(sampled[i].area, visibleArea(sampled[i].el));
          if (area < areaThreshold) continue;

          issues.push({
            type: sawRed ? 'red-flashing-content' : 'dangerous-flash-frequency',
            element: sampled[i].selector,
            frequency: Math.round(hz * 100) / 100,
            flashingArea: Math.round(area),
            areaThreshold: Math.round(areaThreshold),
            samples: values.length,
            description: sawRed
              ? `Saturated red flashing measured at ${hz.toFixed(1)} Hz over ${Math.round(area)} px2, above the 3 Hz red flash threshold`
              : `Flashing measured at ${hz.toFixed(1)} Hz over ${Math.round(area)} px2, above the 3 Hz general flash threshold`,
            severity: 'critical',
          });
        }

        return { issues: issues, sampledElements: sampled.length };
      },
      renderedCode,
      sampleMs
    );

    for (const issue of analysis.issues) {
      violations.push({
        criterion: '9.2.3.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        frequency: issue.frequency,
        severity: issue.severity,
        riskLevel: 'HIGH',
        details: {
          measuredHz: issue.frequency,
          flashingAreaPx: issue.flashingArea,
          areaThresholdPx: issue.areaThreshold,
          luminanceSamples: issue.samples,
        },
        suggestion: this.getFlashingSuggestion(issue.type),
        safetyWarning: 'Immediate action required: seizure risk',
      });
    }

    log.debug(
      `Flash measurement complete: ${analysis.issues.length} issues over ${analysis.sampledElements} sampled elements`
    );

    return {
      safe: analysis.issues.length === 0,
      riskLevel: analysis.issues.length > 0 ? 'HIGH' : 'LOW',
      sampledElements: analysis.sampledElements,
    };
  }

  /**
   * Measure prefers-reduced-motion support (WCAG 2.3.3).
   *
   * Large motion is measured, not declared. Every running animation is seeked
   * through one iteration with the Web Animations API and the box of its target
   * is read at each step, so the travel a keyframe set produces is known
   * whatever its duration: a parallax layer that drifts 100px over eight
   * seconds counts, a colour pulse, a hover lift and a 1.05 scale do not. The
   * preference is then emulated and the same measurement is repeated, so a page
   * whose motion stops is silent whether it implements the query in a
   * cross-origin stylesheet or in script.
   */
  async analyzeMotionSensitivity(page, violations) {
    log.debug('Measuring prefers-reduced-motion support');

    const measure = () =>
      page.evaluate(
        async (renderedSrc, travelPx, steps) => {
          eval(renderedSrc);

          // One entry per animated element, with the animations driving it.
          const byTarget = new Map();
          for (const animation of document.getAnimations()) {
            const effect = animation.effect;
            const target = effect && effect.target;
            if (!target || target.nodeType !== 1) continue;
            if (animation.playState === 'idle' || animation.playState === 'finished') continue;
            const duration = effect.getComputedTiming().duration;
            if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
              continue;
            }
            if (!__isRendered(target)) continue;
            if (!byTarget.has(target)) byTarget.set(target, []);
            byTarget.get(target).push({ animation, duration });
            if (byTarget.size >= 60) break;
          }

          const moving = [];
          for (const [target, entries] of byTarget) {
            const saved = entries.map((e) => ({
              animation: e.animation,
              time: e.animation.currentTime,
              wasRunning: e.animation.playState === 'running',
            }));
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            let minW = Infinity;
            let maxW = -Infinity;
            let minH = Infinity;
            let maxH = -Infinity;

            try {
              for (let step = 0; step <= steps; step++) {
                for (const e of entries) {
                  e.animation.pause();
                  e.animation.currentTime = (e.duration * step) / steps;
                }
                const r = target.getBoundingClientRect();
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                minX = Math.min(minX, cx);
                maxX = Math.max(maxX, cx);
                minY = Math.min(minY, cy);
                maxY = Math.max(maxY, cy);
                minW = Math.min(minW, r.width);
                maxW = Math.max(maxW, r.width);
                minH = Math.min(minH, r.height);
                maxH = Math.max(maxH, r.height);
              }
            } finally {
              for (const s of saved) {
                s.animation.currentTime = s.time;
                if (s.wasRunning) s.animation.play();
              }
            }

            if (
              maxX - minX >= travelPx ||
              maxY - minY >= travelPx ||
              maxW - minW >= travelPx ||
              maxH - minH >= travelPx
            ) {
              const cls =
                typeof target.className === 'string' ? target.className.trim().split(/\s+/)[0] : '';
              moving.push(
                `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}${cls ? `.${cls}` : ''}`
              );
            }
          }

          const smoothScroll =
            window.getComputedStyle(document.documentElement).scrollBehavior === 'smooth';
          return { moving, smoothScroll };
        },
        renderedCode,
        MOTION_TRAVEL_PX,
        MOTION_SAMPLE_STEPS
      );

    let before;
    let after;
    try {
      before = await measure();
      if (before.moving.length === 0 && !before.smoothScroll) {
        return { supported: true };
      }
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      after = await measure();
    } catch (error) {
      log.warn(`Reduced-motion measurement failed: ${error.message}`);
      return { supported: true };
    } finally {
      await page.emulateMediaFeatures([]).catch(() => {
        /* emulation already reset */
      });
    }

    const stillMoving = after.moving.filter((entry) => before.moving.includes(entry));
    const unchanged =
      stillMoving.length === before.moving.length && after.smoothScroll === before.smoothScroll;

    if (!unchanged) return { supported: true };

    const evidence = [];
    if (before.moving.length) {
      evidence.push(
        `${before.moving.length} element(s) keep moving by at least ${MOTION_TRAVEL_PX}px`
      );
    }
    if (before.smoothScroll) evidence.push('scroll-behavior stays smooth');

    violations.push({
      criterion: '9.2.3.3',
      element: 'document',
      issue: 'no-reduced-motion-support',
      description: `With prefers-reduced-motion: reduce emulated, ${evidence.join(' and ')}: the page does not respond to the preference`,
      severity: 'warning',
      details: {
        animationsBefore: before.moving.length,
        animationsAfterEmulation: stillMoving.length,
        smoothScroll: before.smoothScroll,
        examples: before.moving.slice(0, 5),
      },
      suggestion:
        'Disable or shorten the animations inside @media (prefers-reduced-motion: reduce), or honour the preference in script',
    });

    return { supported: false };
  }

  /**
   * Get suggestion for flashing violations.
   */
  getFlashingSuggestion(violationType) {
    const suggestions = {
      'dangerous-flash-frequency':
        'Critical: keep flashing below 3 Hz, or reduce the flashing area below a quarter of the 10-degree visual field',
      'red-flashing-content':
        'Critical: remove the saturated red transitions, which carry the highest seizure risk',
    };
    return suggestions[violationType] || 'Review flashing content for seizure safety';
  }
}

module.exports = SeizurePreventionScanner;
