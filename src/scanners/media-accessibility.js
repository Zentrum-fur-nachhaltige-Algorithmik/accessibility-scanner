/**
 * Media Accessibility Scanner.
 * WCAG 1.1.1, 1.2.1, 1.2.2, 1.2.3, 1.2.5 (EN 301 549 9.1.1.1, 9.1.2.x).
 * Covers what axe-core cannot decide from markup alone: whether time-based
 * media ships an alternative, and whether a painted canvas or a data
 * visualisation carries a description. Naming of img, svg[role=img], object,
 * area and input[type=image] is axe-core's (`image-alt`, `svg-img-alt`,
 * `object-alt`, `area-alt`, `input-image-alt`) and is not restated here.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const { injectableCode: mediaAudioUtils } = require('../utils/media-audio');
const log = require('../utils/logger').createLogger('media-accessibility');

class MediaAccessibilityScanner extends BaseScanner {
  constructor() {
    super('media-accessibility', {
      wcagCriteria: ['1.2.1', '1.2.2', '1.2.3', '1.2.5'],
      wcagPrinciple: 'perceivable',
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
      timeout: TIMEOUTS.scanner,
    };

    const scanOptions = { ...defaultOptions, ...options };

    // Create timestamped scan directory
    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const mediaResults = await this.performMediaAnalysis(page, scanDir, scanOptions);

    return {
      scannerId: this.id,
      criteria: ['9.1.1.1', '9.1.2.1', '9.1.2.2', '9.1.2.3', '9.1.2.5'],
      passed: mediaResults.violations.length === 0,
      violations: mediaResults.violations,
      summary: {
        totalImages: mediaResults.totalImages,
        totalVideos: mediaResults.totalVideos,
        videosWithoutCaptions: mediaResults.videosWithoutCaptions,
        totalAudio: mediaResults.totalAudio,
        audioWithoutTranscripts: mediaResults.audioWithoutTranscripts,
        totalCanvases: mediaResults.totalCanvases,
      },
      screenshotPath: scanDir,
      visualEvidence: mediaResults.visualEvidence,
    };
  }

  /**
   * Analyse all media elements in a single DOM pass.
   */
  async performMediaAnalysis(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];

    log.debug('Starting media accessibility analysis...');

    const initialScreenshot = path.join(scanDir, 'media-accessibility.png');
    let screenshotPromise;

    if (options.skipScreenshot) {
      screenshotPromise = Promise.resolve();
    } else {
      screenshotPromise = page.screenshot({ path: initialScreenshot, fullPage: true });
    }

    const mediaAnalysis = await page.evaluate((mediaAudioCode) => {
      eval(mediaAudioCode);
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className =
          element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';
        return `${tagName}${id}${className}`;
      }

      /**
       * A media element ships an "alternative for time-based media" when a
       * substantive text description is programmatically associated with it
       * (aria-describedby) or a transcript container sits in the same block.
       * This is the mechanism WCAG 1.2.1 accepts for video-only content and
       * the "media alternative" route of 1.2.3.
       */
      function hasTimeBasedTextAlternative(el) {
        const MIN_ALT_LENGTH = 80; // a real description, not a caption/label

        const describedBy = (el.getAttribute('aria-describedby') || '')
          .split(/\s+/)
          .filter(Boolean);
        for (const id of describedBy) {
          const target = document.getElementById(id);
          if (
            target &&
            !el.contains(target) &&
            target.textContent.trim().length >= MIN_ALT_LENGTH
          ) {
            return true;
          }
        }

        // Transcript / text-alternative container in the same content block.
        const scope =
          el.closest('section, article, figure, .media-section, .media-container') ||
          el.parentElement;
        if (scope) {
          const candidates = scope.querySelectorAll(
            '[class*="transcript"], [id*="transcript"], [class*="text-alternative"], [id*="text-alternative"], [class*="audiodesc"], [class*="audio-desc"]'
          );
          for (const candidate of candidates) {
            if (candidate === el || el.contains(candidate)) continue;
            if (candidate.textContent.trim().length >= MIN_ALT_LENGTH) return true;
          }
        }

        return false;
      }

      /**
       * Whether a <video>/<audio> element should be evaluated for media
       * alternatives. CSS visibility at load time is NOT a reliable signal of
       * whether media is content: custom players, lightboxes, tab panels and
       * accordions all hide the native element, and the UA stylesheet hides
       * every <audio> that has no controls attribute. A hidden media
       * element is therefore still evaluated when it exposes a player
       * (controls) or plays by itself (autoplay). Hidden media with neither -
       * e.g. a JS-triggered notification sound - is skipped.
       */
      function isEvaluableMedia(el) {
        if (el.getAttribute('aria-hidden') === 'true' && !el.hasAttribute('autoplay')) return false;
        if (el.offsetParent !== null) return true;
        return el.hasAttribute('controls') || el.hasAttribute('autoplay');
      }

      /**
       * A video that starts by itself, loops and offers no player is
       * decoration behind a headline. It carries no audio to caption and no
       * information the page does not also state in text.
       */
      const isDecorativeBackgroundVideo = __isDecorativeBackgroundVideo;

      const allIssues = [];
      const mediaCounts = {
        totalImages: 0,
        totalVideos: 0,
        videosWithoutCaptions: 0,
        totalAudio: 0,
        audioWithoutTranscripts: 0,
        totalCanvases: 0,
      };

      // ========== IMAGE ANALYSIS ==========
      const images = document.querySelectorAll('img');
      mediaCounts.totalImages = images.length;

      const FILE_NAME_ALT = /^[\w %+.-]+\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i;
      // Whole words only: "photograph", "infographics" and a BEM class ending
      // in "-paragraph" all contain "graph" without being a data visualisation.
      const COMPLEX_WORDS = ['chart', 'charts', 'graph', 'graphs', 'diagram', 'diagrams'];
      const namesComplexImage = (value) =>
        String(value || '')
          .toLowerCase()
          .split(/[^a-z]+/)
          .some((word) => COMPLEX_WORDS.includes(word));

      images.forEach((img) => {
        const selector = getElementSelector(img);
        const alt = img.getAttribute('alt');
        const src = img.getAttribute('src') || '';
        const className = typeof img.className === 'string' ? img.className : '';
        const id = img.id || '';

        if (img.offsetParent === null) return;

        const role = img.getAttribute('role');
        const isDeclaredDecorative = role === 'presentation' || role === 'none';

        // role="presentation" removes the image from the accessibility tree,
        // so its alt text can never be read: the two contradict each other.
        if (isDeclaredDecorative && alt) {
          allIssues.push({
            type: 'decorative-img',
            element: selector,
            alt: alt,
            description: `Image with role="${role}" carries alt text that is never exposed`,
            severity: 'minor',
            suggestion: 'Use alt="" for a decorative image, or drop the presentation role',
          });
        }

        if (alt === null || isDeclaredDecorative) return;

        // The file name is what the browser shows when the image fails to
        // load; as alt text it describes nothing.
        const srcBase = src.split(/[?#]/)[0].split('/').pop() || '';
        if (
          alt &&
          (FILE_NAME_ALT.test(alt.trim()) || alt.trim().toLowerCase() === srcBase.toLowerCase())
        ) {
          allIssues.push({
            type: 'image-alt',
            element: selector,
            alt: alt,
            description: 'Alt text is the image file name',
            severity: 'serious',
            suggestion: 'Replace the file name with a description of what the image shows',
          });
        }

        // A data visualisation carries information that a short alt cannot
        // hold. The word alone is not evidence: an icon of a chart is not a
        // chart, so the image also has to be painted at figure size.
        const rect = img.getBoundingClientRect();
        const isFigureSized = rect.width >= 200 && rect.height >= 150;
        const isLikelyComplex =
          isFigureSized &&
          (namesComplexImage(src) ||
            namesComplexImage(alt) ||
            namesComplexImage(className) ||
            namesComplexImage(id));

        if (
          isLikelyComplex &&
          !img.hasAttribute('longdesc') &&
          !img.hasAttribute('aria-describedby') &&
          !(alt && alt.length > 50)
        ) {
          allIssues.push({
            type: 'complex-img-alt',
            element: selector,
            alt: alt ? alt.substring(0, 50) : '',
            description: 'Complex image lacks detailed description',
            severity: 'moderate',
            suggestion:
              'Describe the data the chart shows in aria-describedby, longdesc or a longer alt text',
          });
        }
      });

      // ========== VIDEO ANALYSIS ==========
      const videos = document.querySelectorAll('video');
      mediaCounts.totalVideos = videos.length;

      videos.forEach((video) => {
        const selector = getElementSelector(video);

        if (!isEvaluableMedia(video)) return;
        if (isDecorativeBackgroundVideo(video)) return;
        // 1.2.2, 1.2.3 and 1.2.5 all govern synchronized media, which is
        // audio synchronized with video. A file that decoded video and no
        // audio carries none, so none of them applies to it.
        if (__mediaAudioState(video) === 'silent') return;

        const tracks = video.querySelectorAll('track[kind="captions"], track[kind="subtitles"]');
        const hasCaptionTrack = tracks.length > 0;
        const hasDescriptionTrack = video.querySelectorAll('track[kind="descriptions"]').length > 0;
        const hasTextAlternative = hasTimeBasedTextAlternative(video);

        // WCAG 1.2.2 (Captions, Prerecorded). Only reported when the video
        // ships no captions AND no text alternative - a full text alternative
        // is the recognised mechanism for video-only (silent) content under
        // 1.2.1, and whether a video carries an audio track at all cannot be
        // determined from markup.
        if (!hasCaptionTrack && !hasTextAlternative) {
          mediaCounts.videosWithoutCaptions++;
          allIssues.push({
            type: 'video-caption',
            criterion: '9.1.2.2',
            element: selector,
            description: 'Video provides neither a captions/subtitles track nor a text alternative',
            severity: 'serious',
            suggestion:
              'Add <track> elements with kind="captions" or kind="subtitles", or provide a full transcript linked via aria-describedby',
          });
        }

        // WCAG 1.2.3 (A) / 1.2.5 (AA). A missing kind="descriptions" track on
        // its own is NOT evidence of a failure: audio description is not
        // required when the audio track already conveys the visual
        // information, and that is not determinable from markup. Only report
        // when the video ships no description track, no captions AND no text
        // alternative - i.e. no accessible alternative of any kind exists.
        if (!hasDescriptionTrack && !hasCaptionTrack && !hasTextAlternative) {
          allIssues.push({
            type: 'video-description',
            criterion: '9.1.2.3',
            element: selector,
            description:
              'Video provides neither an audio description nor an alternative for time-based media',
            severity: 'serious',
            suggestion:
              'Provide a full text alternative for the video, or add audio description via <track kind="descriptions">',
          });
          allIssues.push({
            type: 'video-audio-description',
            criterion: '9.1.2.5',
            element: selector,
            description: 'Video lacks an audio description track for its visual content',
            severity: 'moderate',
            suggestion:
              'Add audio descriptions via <track kind="descriptions"> or supply an audio-described version of the video',
          });
        }
      });

      // ========== AUDIO ANALYSIS ==========
      const audioElements = document.querySelectorAll('audio');
      mediaCounts.totalAudio = audioElements.length;

      audioElements.forEach((audio) => {
        const selector = getElementSelector(audio);

        if (!isEvaluableMedia(audio)) return;

        const parent = audio.parentElement;
        const parentText = parent ? parent.textContent.toLowerCase() : '';
        const hasTranscriptLink =
          hasTimeBasedTextAlternative(audio) ||
          (parent &&
            (parent.querySelector('a[href*="transcript"]') ||
              parent.querySelector('a[href*="transkript"]') ||
              parent.querySelector('[class*="transcript"]') ||
              parent.querySelector('[id*="transcript"]') ||
              parent.querySelector('[class*="transkript"]') ||
              parent.querySelector('[id*="transkript"]') ||
              parentText.includes('transcript') ||
              parentText.includes('transkript') ||
              parentText.includes('abschrift')));

        if (!hasTranscriptLink) {
          mediaCounts.audioWithoutTranscripts++;
          allIssues.push({
            type: 'audio-caption',
            criterion: '9.1.2.1',
            element: selector,
            description: 'Audio content lacks transcript',
            severity: 'serious',
            suggestion: 'Provide a transcript link or text near the audio element',
          });
        }
      });

      // ========== CANVAS ==========
      // A canvas paints pixels and exposes nothing else, so a canvas of
      // content size with no name and no fallback subtree is non-text content
      // without an alternative. A decorative canvas says so with
      // aria-hidden or a presentation role, and a sub-icon-sized canvas
      // carries nothing to describe.
      const canvases = document.querySelectorAll('canvas');
      mediaCounts.totalCanvases = canvases.length;

      canvases.forEach((canvas) => {
        const selector = getElementSelector(canvas);
        if (canvas.offsetParent === null) return;
        if (canvas.getAttribute('aria-hidden') === 'true') return;
        const role = canvas.getAttribute('role');
        if (role === 'presentation' || role === 'none') return;

        const rect = canvas.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 50) return;

        const named =
          (canvas.getAttribute('aria-label') || '').trim() ||
          canvas.hasAttribute('aria-labelledby') ||
          (canvas.getAttribute('title') || '').trim() ||
          canvas.textContent.trim().length > 0;

        if (!named) {
          allIssues.push({
            type: 'canvas',
            element: selector,
            description: 'Canvas element lacks accessible name or fallback content',
            severity: 'serious',
            suggestion: 'Add aria-label, fallback text content, or alternative text representation',
          });
        }
      });

      return { allIssues, mediaCounts };
    }, mediaAudioUtils);

    // Wait for screenshot to complete
    await screenshotPromise;

    // Create violations from analyzed issues
    mediaAnalysis.allIssues.forEach((issue) => {
      violations.push({
        criterion: issue.criterion || '9.1.1.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });

    // Generate visual evidence
    visualEvidence.push({
      type: 'media-accessibility',
      screenshot: path.basename(initialScreenshot),
      totalImages: mediaAnalysis.mediaCounts.totalImages,
      totalVideos: mediaAnalysis.mediaCounts.totalVideos,
      videosWithoutCaptions: mediaAnalysis.mediaCounts.videosWithoutCaptions,
      totalAudio: mediaAnalysis.mediaCounts.totalAudio,
      audioWithoutTranscripts: mediaAnalysis.mediaCounts.audioWithoutTranscripts,
      totalCanvases: mediaAnalysis.mediaCounts.totalCanvases,
    });

    log.debug(`Media accessibility analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      ...mediaAnalysis.mediaCounts,
    };
  }
}

module.exports = MediaAccessibilityScanner;
