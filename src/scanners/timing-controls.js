/**
 * Timing Controls Scanner.
 * WCAG 2.2.1, 2.2.2 (EN 301 549 9.2.2.1, 9.2.2.2).
 * Watches the page for a ticking countdown, for media that plays by itself and
 * for content that moves or rewrites itself, and reports the ones the user
 * cannot extend, pause or stop.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const { injectableCode: renderedCode } = require('../utils/rendered');
const { injectableCode: accnameCode } = require('../utils/accessible-name');
const log = require('../utils/logger').createLogger('timing-controls');

/**
 * Every rule here decides from a before/after comparison, so the window has to
 * be long enough for a second of page time to pass. Callers that ask for a
 * shorter one (the harnesses pass `observationTime: 0`) get this instead.
 */
const MIN_OBSERVATION_MS = 1500;

/** Updates below this count are a page settling in, not auto-updating content. */
const MIN_AUTO_UPDATES = 3;

/**
 * A page hydrates, injects its consent banner and swaps its skeletons in the
 * first seconds after load. None of that is auto-updating information, so the
 * probes are installed only once the page has stopped settling: the pipeline's
 * gotoSettled plus this.
 */
const SETTLE_BEFORE_OBSERVING_MS = 2000;

/** Movement and playback shorter than this are outside 2.2.2. */
const LONG_ENOUGH_SECONDS = 5;

/** Below this the painted box only jitters, as a rotating indicator does. */
const MIN_SHIFT_PX = 8;

class TimingControlsScanner extends BaseScanner {
  constructor() {
    super('timing-controls', {
      wcagCriteria: ['2.2.1', '2.2.2'],
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
    const scanOptions = {
      observationTime: 5000,
      timeout: TIMEOUTS.scanner,
      ...options,
    };
    const windowMs = Math.max(Number(scanOptions.observationTime) || 0, MIN_OBSERVATION_MS);

    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const timingResults = await this.performTimingControlsAnalysis(page, scanDir, windowMs);

    return {
      scannerId: this.id,
      criteria: ['9.2.2.1', '9.2.2.2'],
      passed: timingResults.violations.length === 0,
      violations: timingResults.violations,
      needsReview: timingResults.needsReview,
      summary: {
        timeoutsAdjustable: timingResults.timeoutsAdjustable,
        autoPlayControlled: timingResults.autoPlayControlled,
        movingContentControllable: timingResults.movingContentControllable,
      },
      screenshotPath: scanDir,
      visualEvidence: timingResults.visualEvidence,
    };
  }

  /**
   * Install the probes, let the page run untouched for the observation window,
   * then read what changed and turn the readings into violations.
   */
  async performTimingControlsAnalysis(page, scanDir, windowMs) {
    const violations = [];
    const needsReview = [];

    log.debug('Starting timing controls analysis...');

    const initialScreenshot = path.join(scanDir, 'timing-controls-analysis.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    await new Promise((resolve) => setTimeout(resolve, SETTLE_BEFORE_OBSERVING_MS));
    await this.installProbes(page);
    await new Promise((resolve) => setTimeout(resolve, windowMs));
    const observed = await this.readProbes(page, windowMs);

    for (const issue of observed.countdowns) {
      violations.push({
        criterion: '9.2.2.1',
        element: issue.element,
        issue: 'timeout-no-extend-option',
        description: issue.description,
        severity: 'error',
        evidence: issue.evidence,
        suggestion: this.getTimeoutSuggestion('timeout-no-extend-option'),
      });
    }

    // A control that offers more time exists, but not where the countdown is.
    // Whether it extends THIS limit is a reading of the page, not a
    // measurement, so it is asked rather than decided.
    for (const issue of observed.countdownQuestions) {
      needsReview.push({
        ...this.formatViolation(
          'timeout-no-extend-option',
          'moderate',
          issue.description,
          [{ selector: issue.element }],
          'https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html',
          'info',
          {
            verdict: 'needs-review',
            dossier: {
              question: `Does "${issue.controlText}" extend the countdown that runs in ${issue.element}?`,
              element: { selector: issue.element, html: null, role: null, name: null },
              measurements: {
                countdownFrom: issue.from,
                countdownTo: issue.to,
                controlText: issue.controlText,
                controlInSameRegion: false,
              },
              context: { region: issue.region, observedMs: windowMs },
            },
          }
        ),
        criterion: '9.2.2.1',
        wcagCriteria: ['2.2.1'],
        issue: 'timeout-no-extend-option',
        element: issue.element,
        evidence: issue.evidence,
      });
    }

    for (const issue of [...observed.media, ...observed.moving, ...observed.updates]) {
      violations.push({
        criterion: '9.2.2.2',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        evidence: issue.evidence,
        suggestion: this.getPauseStopHideSuggestion(issue.type),
      });
    }

    log.debug(`Timing controls analysis complete: ${violations.length} violations found`);

    return {
      violations,
      needsReview,
      timeoutsAdjustable: observed.countdowns.length === 0,
      autoPlayControlled: observed.media.length === 0,
      movingContentControllable: observed.moving.length === 0 && observed.updates.length === 0,
      visualEvidence: [
        {
          type: 'timing-controls',
          screenshot: path.basename(initialScreenshot),
          observationMs: windowMs,
          countdowns: observed.countdowns.length,
          autoPlayingMedia: observed.media.length,
          movingElements: observed.moving.length,
          autoUpdatingElements: observed.updates.length,
        },
      ],
    };
  }

  /**
   * Record the starting state: mutation counts, the text of every short leaf
   * that could be a counter, the playback position of every media element and
   * the painted rectangle of every element running a long or endless animation.
   */
  async installProbes(page) {
    await page.evaluate(
      (renderedHelpers, longEnough) => {
        eval(renderedHelpers);

        // 2.2.2 is about auto-updating INFORMATION: text the user reads, in a
        // region that carries content. A class swap, an attribute change or a
        // node inserted into an off-screen wrapper updates no information.
        const LANDMARK =
          'main, article, section, aside, nav, header, footer, [role="main"], [role="article"], ' +
          '[role="region"], [role="complementary"], [role="navigation"], [role="banner"], ' +
          '[role="contentinfo"], [role="feed"], [role="log"], [role="status"], [role="marquee"]';
        const changesText = (rec) => {
          if (rec.type === 'characterData') return true;
          const nodes = [...rec.addedNodes, ...rec.removedNodes];
          return nodes.some(
            (n) =>
              (n.nodeType === 3 && (n.textContent || '').trim()) ||
              (n.nodeType === 1 && (n.textContent || '').trim())
          );
        };
        const counts = new Map();
        const observer = new MutationObserver((records) => {
          for (const rec of records) {
            if (!changesText(rec)) continue;
            const node = rec.type === 'characterData' ? rec.target.parentElement : rec.target;
            if (!node || node.nodeType !== 1) continue;
            if (node.closest('script, style, head')) continue;
            if (!node.closest(LANDMARK)) continue;
            counts.set(node, (counts.get(node) || 0) + 1);
          }
        });
        observer.observe(document.body, { childList: true, characterData: true, subtree: true });

        // Leaves whose whole rendered text is short enough to be a counter.
        const counters = new Map();
        for (const el of document.body.querySelectorAll('*')) {
          if (el.children.length) continue;
          const text = (el.textContent || '').trim();
          if (!text || text.length > 24) continue;
          counters.set(el, text);
        }

        const media = new Map();
        for (const el of document.querySelectorAll('video, audio')) {
          media.set(el, el.currentTime);
        }

        // An animation that either never ends or runs longer than the 2.2.2
        // threshold. Everything shorter stops on its own before it matters.
        const animated = new Map();
        for (const el of document.body.querySelectorAll('*')) {
          const style = getComputedStyle(el);
          if (style.animationName === 'none') continue;
          // The five seconds of the clause are the time the movement LASTS:
          // one run of the animation times the number of runs.
          const seconds = parseFloat(style.animationDuration) || 0;
          const endless = style.animationIterationCount === 'infinite';
          const iterations = endless ? Infinity : parseFloat(style.animationIterationCount) || 1;
          if (seconds * iterations <= longEnough) continue;
          if (!__isRendered(el)) continue;
          const rect = el.getBoundingClientRect();
          animated.set(el, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }

        window.__a11yTiming = { counts, observer, counters, media, animated };
      },
      renderedCode,
      LONG_ENOUGH_SECONDS
    );
  }

  /**
   * Compare the page against the recorded starting state.
   */
  async readProbes(page, windowMs) {
    return page.evaluate(
      (renderedHelpers, accnameHelpers, config) => {
        eval(renderedHelpers);
        eval(accnameHelpers);
        const { minUpdates, longEnough } = config;

        const probe = window.__a11yTiming;
        if (!probe) {
          return { countdowns: [], countdownQuestions: [], media: [], moving: [], updates: [] };
        }
        probe.observer.disconnect();

        function selectorFor(el) {
          const className = typeof el.className === 'string' ? el.className : '';
          return (
            el.tagName.toLowerCase() +
            (el.id ? `#${el.id}` : '') +
            (className ? `.${className.split(' ')[0]}` : '')
          );
        }

        /**
         * A control the user can reach that could act on this element: a button
         * inside it, in its parent or in its grandparent, or one that
         * names it in aria-controls. Pause buttons commonly sit in a sibling
         * toolbar rather than in the moving block itself.
         */
        const CONTROL_SELECTOR = 'button, [role="button"], input[type="button"]';
        function hasControl(el) {
          if (el.id && document.querySelector(`[aria-controls~="${el.id}"]`)) return true;
          let scope = el;
          for (let level = 0; level < 3 && scope; level++) {
            if (scope.querySelector(CONTROL_SELECTOR)) return true;
            scope = scope.parentElement;
          }
          return false;
        }

        /** 2.2.2 is about moving content, so the element has to carry content. */
        function carriesContent(el) {
          if ((el.textContent || '').trim()) return true;
          return Boolean(el.querySelector('img, svg, video, canvas, picture'));
        }

        /**
         * "presented in parallel with other content": the clause exempts a
         * page whose only content is the moving thing (a splash animation, a
         * full-screen player), because nothing else is being read beside it.
         */
        function inParallelWithOtherContent(el) {
          const pageText = (document.body.textContent || '').replace(/\s+/g, ' ').trim().length;
          const ownText = (el.textContent || '').replace(/\s+/g, ' ').trim().length;
          if (pageText - ownText > 40) return true;
          return Array.from(
            document.body.querySelectorAll('img, svg, video, canvas, picture')
          ).some((other) => !el.contains(other) && other !== el && __isRendered(other));
        }

        /**
         * The "essential" exception, only where the page declares it. Whether
         * movement is essential to an activity is an authoring statement, not
         * something to infer from a class name.
         */
        function declaredEssential(el) {
          const holder = el.closest('[data-a11y-essential], [data-essential]');
          if (!holder) return false;
          const value = (
            holder.getAttribute('data-a11y-essential') ||
            holder.getAttribute('data-essential') ||
            'true'
          ).toLowerCase();
          return value !== 'false';
        }

        /**
         * A remaining-time display of a media player is not a session time
         * limit: it counts the track down, and the player's own controls stop
         * it. Anything within a few levels of a video or audio element is part
         * of that player.
         */
        const PLAYER =
          'figure, [class*="player" i], [class*="video" i], [class*="audio" i], ' +
          '[id*="player" i], [role="application"], [role="group"], [role="timer"]';
        function insideMediaPlayer(el) {
          let scope = el.parentElement;
          for (let level = 0; level < 4 && scope && scope !== document.body; level++) {
            if (scope.querySelector('video, audio')) {
              // The wrapper of a player, not the section that happens to hold
              // both a player and a session warning: it is named as a player,
              // or it carries nothing but the player and its controls.
              const own = (scope.textContent || '').replace(/\s+/g, ' ').trim();
              if (scope.matches(PLAYER) || own.length <= 200) return true;
            }
            scope = scope.parentElement;
          }
          return false;
        }

        /** The landmark, dialog or form the countdown lives in. */
        function regionOf(el) {
          return (
            el.closest(
              'dialog, [role="dialog"], [role="alertdialog"], form, main, [role="main"], ' +
                'section, [role="region"], article, aside, header, footer, nav'
            ) || document.body
          );
        }

        /**
         * A "12:34", "90" or "90 sec" reading as seconds, with a note whether
         * it was written as a clock, else null.
         */
        function readClock(text) {
          const value = String(text || '').trim();
          const clock = value.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
          if (clock) {
            const parts = clock.slice(1).filter(Boolean).map(Number);
            return { seconds: parts.reduce((total, part) => total * 60 + part, 0), isClock: true };
          }
          const plain = value.match(/^(\d+)\s*[\p{L}.]{0,12}$/u);
          return plain ? { seconds: Number(plain[1]), isClock: false } : null;
        }

        // ---- 2.2.1: a counter that ticked downwards ------------------------
        // A bare number counts only when it fell at about one unit per second,
        // which is what a clock does; any other falling number (a price, a
        // stock quantity, a slide index) is not a time limit.
        // A clock counts one second per second just as a bare number does, so
        // the same tolerance applies to both: a "12:34" that jumps by minutes
        // between two samples is not counting time down.
        const perSecondTolerance = Math.ceil(config.windowMs / 1000) + 1;
        const countdowns = [];
        for (const [el, before] of probe.counters) {
          if (!el.isConnected) continue;
          const from = readClock(before);
          const to = readClock((el.textContent || '').trim());
          if (!from || !to || to.seconds >= from.seconds) continue;
          if (from.seconds - to.seconds > perSecondTolerance) continue;
          if (!__isRendered(el)) continue;
          if (insideMediaPlayer(el)) continue;
          countdowns.push({ el, from: before, to: (el.textContent || '').trim() });
        }

        // 2.2.1 is met when the user can turn the limit off, adjust it or ask
        // for more time. A control that offers more time is that mechanism,
        // but only where the countdown is: one "Rezept verlängern" link in a
        // sidebar says nothing about the session timer in a dialog.
        const offersTime =
          /\b(extend|more time|keep me|stay signed|continue session)\b|verläng|mehr zeit/i;
        function extendControlIn(root) {
          for (const control of root.querySelectorAll(
            'button, [role="button"], input[type="button"], input[type="submit"], a[href]'
          )) {
            if (!__isRendered(control)) continue;
            const name = (__accessibleName(control) || '').trim();
            if (offersTime.test(name)) return name || control.tagName.toLowerCase();
          }
          return null;
        }
        const pageWideControl = extendControlIn(document.body);

        const countdownIssues = [];
        const countdownQuestions = [];
        for (const { el, from, to } of countdowns) {
          const region = regionOf(el);
          if (extendControlIn(region)) continue;
          const evidence = `counted down from "${from}" to "${to}" in ${config.windowMs} ms`;
          if (pageWideControl) {
            countdownQuestions.push({
              element: selectorFor(el),
              description:
                'A running countdown has no control beside it, and the page offers one elsewhere',
              evidence,
              from,
              to,
              controlText: pageWideControl,
              region: selectorFor(region),
            });
            continue;
          }
          countdownIssues.push({
            element: selectorFor(el),
            description: 'A running countdown offers no way to extend or turn off the time limit',
            evidence,
          });
        }

        // ---- 2.2.2: media that played by itself ---------------------------
        const media = [];
        for (const [el, startedAt] of probe.media) {
          if (!el.isConnected || el.currentTime <= startedAt) continue;
          const duration = Number.isFinite(el.duration) ? el.duration : Infinity;
          if (!el.loop && duration <= longEnough) continue;
          if (el.hasAttribute('controls') || hasControl(el)) continue;
          if (!inParallelWithOtherContent(el) || declaredEssential(el)) continue;
          media.push({
            type: 'autoplay-no-controls',
            element: selectorFor(el),
            description: 'Media started playing on its own and offers no pause or stop control',
            severity: 'error',
            evidence: `playback advanced to ${el.currentTime.toFixed(1)}s, ${
              el.loop ? 'looping' : `duration ${duration.toFixed(1)}s`
            }`,
          });
        }

        // ---- 2.2.2: content that changed its painted position -------------
        const moving = [];
        for (const [el, before] of probe.animated) {
          if (!el.isConnected) continue;
          const rect = el.getBoundingClientRect();
          // A rotating or pulsing indicator shifts its box by a pixel or two;
          // content that travels across the page shifts it much further.
          const shifted =
            Math.abs(rect.x - before.x) >= config.minShiftPx ||
            Math.abs(rect.y - before.y) >= config.minShiftPx ||
            Math.abs(rect.width - before.width) >= config.minShiftPx ||
            Math.abs(rect.height - before.height) >= config.minShiftPx;
          if (!shifted || !carriesContent(el) || hasControl(el)) continue;
          if (!inParallelWithOtherContent(el) || declaredEssential(el)) continue;
          moving.push({
            type: 'moving-content-no-controls',
            element: selectorFor(el),
            description:
              'Content keeps moving on its own and offers no pause, stop or hide control',
            severity: 'error',
            evidence: `moved from (${Math.round(before.x)}, ${Math.round(before.y)}) to (${Math.round(rect.x)}, ${Math.round(rect.y)})`,
          });
        }

        // ---- 2.2.2: content that rewrote itself ---------------------------
        const updates = [];
        const reported = new Set(moving.map((issue) => issue.element));
        for (const [el, count] of probe.counts) {
          if (count < minUpdates || !el.isConnected) continue;
          if (!__isRendered(el) || hasControl(el)) continue;
          if (!inParallelWithOtherContent(el) || declaredEssential(el)) continue;
          const selector = selectorFor(el);
          if (reported.has(selector)) continue;
          reported.add(selector);
          updates.push({
            type: 'auto-update-no-controls',
            element: selector,
            description: `Content updated ${count} times on its own and lacks pause or stop controls`,
            severity: 'warning',
            evidence: `${count} updates in ${config.windowMs} ms`,
          });
        }

        delete window.__a11yTiming;
        return { countdowns: countdownIssues, countdownQuestions, media, moving, updates };
      },
      renderedCode,
      accnameCode,
      {
        minUpdates: MIN_AUTO_UPDATES,
        longEnough: LONG_ENOUGH_SECONDS,
        minShiftPx: MIN_SHIFT_PX,
        windowMs,
      }
    );
  }

  getTimeoutSuggestion(violationType) {
    const suggestions = {
      'timeout-no-extend-option':
        'Let the user turn the time limit off, adjust it, or extend it before it runs out',
    };
    return (
      suggestions[violationType] || 'Ensure timeout mechanisms are user-controllable and accessible'
    );
  }

  getPauseStopHideSuggestion(violationType) {
    const suggestions = {
      'autoplay-no-controls': 'Add pause and stop controls for media that starts on its own',
      'moving-content-no-controls':
        'Add pause, stop or hide controls for content that moves for more than five seconds',
      'auto-update-no-controls': 'Provide pause controls for auto-updating content like news feeds',
    };
    return suggestions[violationType] || 'Provide user controls for auto-playing content';
  }
}

module.exports = TimingControlsScanner;
