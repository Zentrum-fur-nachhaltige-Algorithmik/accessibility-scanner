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
      // Contradictory decorative markup, a data graphic with a short alt and
      // a video whose audio track could not be read: questions, not findings.
      needsReview: mediaResults.needsReview,
      summary: {
        totalImages: mediaResults.totalImages,
        totalVideos: mediaResults.totalVideos,
        videosWithoutCaptions: mediaResults.videosWithoutCaptions,
        totalAudio: mediaResults.totalAudio,
        audioWithoutTranscripts: mediaResults.audioWithoutTranscripts,
        totalCanvases: mediaResults.totalCanvases,
        openQuestions: mediaResults.needsReview.length,
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

      // "Transcript", in the words a page uses for one. The word has to name
      // the link or the section, not merely occur somewhere in the subtree
      // around the media: "a transcript is not available" contains it too.
      const TRANSCRIPT_WORDS = /transcript|transkript|mitschrift|abschrift|volltext/i;

      /**
       * A media element ships an "alternative for time-based media" when a
       * substantive text description is programmatically associated with it
       * (aria-describedby), or a link or section NAMED as a transcript sits
       * beside it. This is the mechanism WCAG 1.2.1 accepts for audio-only and
       * video-only content and the "media alternative" route of 1.2.3.
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

        const scope =
          el.closest('section, article, figure, .media-section, .media-container') ||
          el.parentElement;
        if (!scope) return false;

        // A link to the transcript: its own text or its accessible name says so.
        for (const link of scope.querySelectorAll('a[href]')) {
          const name = [
            link.textContent || '',
            link.getAttribute('aria-label') || '',
            link.getAttribute('title') || '',
          ].join(' ');
          if (TRANSCRIPT_WORDS.test(name)) return true;
        }

        // A section or disclosure named as the transcript, carrying real text.
        const named = scope.querySelectorAll(
          'section, article, div, details, aside, figure, [role="region"]'
        );
        for (const candidate of named) {
          if (candidate === el || el.contains(candidate)) continue;
          const heading = candidate.querySelector('h1, h2, h3, h4, h5, h6, summary, legend');
          const name = [
            heading ? heading.textContent : '',
            candidate.getAttribute('aria-label') || '',
          ].join(' ');
          if (!TRANSCRIPT_WORDS.test(name)) continue;
          if (candidate.textContent.trim().length >= MIN_ALT_LENGTH) return true;
        }

        return false;
      }

      /** Captions a JS player added count: they are read off textTracks. */
      function trackKinds(el) {
        const kinds = new Set();
        for (const track of el.querySelectorAll('track')) {
          kinds.add((track.getAttribute('kind') || 'subtitles').toLowerCase());
        }
        const list = el.textTracks;
        if (list && typeof list.length === 'number') {
          for (let i = 0; i < list.length; i++) {
            if (list[i] && list[i].kind) kinds.add(String(list[i].kind).toLowerCase());
          }
        }
        return kinds;
      }

      /**
       * Live media is outside 1.2.1, 1.2.2 (prerecorded) and 1.2.3/1.2.5: a
       * stream has no duration, and a live source is declared as one.
       */
      function isLiveMedia(el) {
        if (el.duration === Infinity) return true;
        const sources = [el.getAttribute('src') || ''];
        for (const source of el.querySelectorAll('source')) {
          sources.push(source.getAttribute('src') || '', source.getAttribute('type') || '');
        }
        const joined = sources.join(' ').toLowerCase();
        if (/\.m3u8|\.mpd|application\/x-mpegurl|dash\+xml/.test(joined)) return true;
        const label = [
          el.getAttribute('aria-label') || '',
          typeof el.className === 'string' ? el.className : '',
          el.id || '',
        ]
          .join(' ')
          .toLowerCase();
        return /\blive\b|livestream|\bstream\b/.test(label);
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
      // What the page cannot decide: carried with what was measured.
      const allQuestions = [];
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

      /**
       * The image is the only content of a control its author named, which is
       * the icon-in-labelled-button case: the control carries the name, the
       * icon is never announced on its own, and its filename alt is harmless.
       * The same gate the axe adapter applies to image-alt.
       */
      function isSoleIconOfNamedControl(img) {
        const control = img.closest(
          'button, a[href], [role="button"], [role="link"], input, summary'
        );
        if (!control) return false;
        const labelledby = (control.getAttribute('aria-labelledby') || '')
          .split(/\s+/)
          .filter(Boolean)
          .some((id) => document.getElementById(id));
        const named = (control.getAttribute('aria-label') || '').trim().length > 0 || labelledby;
        if (!named) return false;
        if ((control.textContent || '').trim().length > 0) return false;
        return control.querySelectorAll('img').length === 1;
      }

      /**
       * Evidence that the image carries more information than a short alt can
       * hold: the author put it in a figure and the caption says it is a
       * chart, a diagram, a map or a plan. A filename, a class name and a
       * pixel size are not that evidence.
       */
      const COMPLEX_CAPTION =
        /\b(chart|charts|graph|graphs|diagram|diagramm|diagramme|map|karte|plan|schema|infographic|infografik|abbildung)\b/i;
      function complexityEvidence(img) {
        const figure = img.closest('figure');
        if (!figure) return null;
        const caption = figure.querySelector('figcaption');
        if (!caption) return null;
        const text = caption.textContent.trim();
        if (!COMPLEX_CAPTION.test(text)) return null;
        return text.substring(0, 160);
      }

      images.forEach((img) => {
        const selector = getElementSelector(img);
        const alt = img.getAttribute('alt');
        const src = img.getAttribute('src') || '';
        if (img.offsetParent === null) return;

        const role = img.getAttribute('role');
        const isDeclaredDecorative = role === 'presentation' || role === 'none';

        // role="presentation" removes the image from the accessibility tree,
        // so its alt text can never be read: the two contradict each other.
        if (isDeclaredDecorative && alt) {
          // The markup contradicts itself, but an image with role="presentation"
          // and alt="" satisfies the 1.1.1 exception, so which of the two the
          // author meant is a question about the image, not a proven failure.
          allQuestions.push({
            type: 'decorative-img',
            element: selector,
            alt: alt,
            html: img.outerHTML ? img.outerHTML.substring(0, 200) : null,
            role: role,
            question: `Is this image decorative? It carries role="${role}", which removes it from the accessibility tree, and alt="${alt.substring(0, 60)}", which is then never read.`,
            description: `Image with role="${role}" carries alt text that is never exposed`,
            measurements: { alt: alt.substring(0, 120), role: role, src: src.substring(0, 160) },
            context: {
              nearbyText: (img.parentElement ? img.parentElement.textContent : '')
                .trim()
                .substring(0, 160),
            },
          });
        }

        if (alt === null || isDeclaredDecorative) return;

        // The file name is what the browser shows when the image fails to
        // load; as alt text it describes nothing.
        const srcBase = src.split(/[?#]/)[0].split('/').pop() || '';
        if (
          alt &&
          !isSoleIconOfNamedControl(img) &&
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

        // Whether a short alt serves the same purpose as the image is a
        // judgement about the content. It is only asked where the page itself
        // says the image is a data graphic.
        const evidence = complexityEvidence(img);
        if (
          evidence &&
          !img.hasAttribute('longdesc') &&
          !img.hasAttribute('aria-describedby') &&
          !(alt && alt.length > 50)
        ) {
          allQuestions.push({
            type: 'complex-img-alt',
            element: selector,
            alt: alt ? alt.substring(0, 50) : '',
            html: img.outerHTML ? img.outerHTML.substring(0, 200) : null,
            role: img.getAttribute('role') || null,
            question: `Does a reader of the alt text "${(alt || '').substring(0, 60)}" learn what this image conveys, or does it need a long description (WCAG 1.1.1)?`,
            description: 'Image the page presents as a data graphic has only a short alt text',
            measurements: { alt: (alt || '').substring(0, 120), altLength: (alt || '').length },
            context: { figcaption: evidence },
          });
        }
      });

      // ========== VIDEO ANALYSIS ==========
      // The four criteria are separate measurements, and each is only asked
      // where its own precondition holds:
      //   1.2.1  prerecorded video-only: a transcript, or an audio track that
      //          carries the same information;
      //   1.2.2  captions for prerecorded synchronized media, which needs an
      //          audio track, and which a transcript does NOT satisfy;
      //   1.2.3  audio description OR a media alternative for text;
      //   1.2.5  audio description, and nothing else.
      const videos = document.querySelectorAll('video');
      mediaCounts.totalVideos = videos.length;

      videos.forEach((video) => {
        const selector = getElementSelector(video);

        if (!isEvaluableMedia(video)) return;
        if (isDecorativeBackgroundVideo(video)) return;
        // Live media is outside every "prerecorded" criterion here.
        if (isLiveMedia(video)) return;

        const kinds = trackKinds(video);
        const hasCaptionTrack = kinds.has('captions') || kinds.has('subtitles');
        const hasDescriptionTrack = kinds.has('descriptions');
        const hasTextAlternative = hasTimeBasedTextAlternative(video);
        const audioState = __mediaAudioState(video);

        // Nothing was decoded (preload="none", a file that never loaded), so
        // whether this is synchronized media or a silent clip is not known.
        // One question, not three findings.
        if (audioState === 'unknown') {
          allQuestions.push({
            type: 'media-audio-track-unknown',
            element: selector,
            html: video.outerHTML ? video.outerHTML.substring(0, 200) : null,
            role: 'video',
            question: `Does this video carry an audio track? With one it needs captions (WCAG 1.2.2) and audio description (1.2.5); without one it needs a text alternative (1.2.1).`,
            description: 'Video whose audio track could not be read from the page',
            measurements: {
              preload: video.getAttribute('preload') || '',
              readyState: video.readyState,
              hasCaptionTrack: hasCaptionTrack,
              hasDescriptionTrack: hasDescriptionTrack,
              hasTextAlternative: hasTextAlternative,
            },
            context: { src: (video.getAttribute('src') || '').substring(0, 160) },
          });
          return;
        }

        if (audioState === 'silent') {
          // SC 1.2.1, video-only: an alternative for time-based media, or an
          // audio track presenting the same information (which it has not).
          if (!hasTextAlternative) {
            allIssues.push({
              type: 'video-only-no-alternative',
              criterion: '9.1.2.1',
              element: selector,
              description:
                'Prerecorded video with no audio track offers neither a text alternative nor an audio track presenting the same information',
              severity: 'serious',
              suggestion:
                'Provide a transcript of what the video shows, clearly labelled and beside the video, or add an audio track that presents the same information',
            });
          }
          return;
        }

        // Synchronized media from here on: the video carries audio.
        if (!hasCaptionTrack) {
          mediaCounts.videosWithoutCaptions++;
          allIssues.push({
            type: 'video-caption',
            criterion: '9.1.2.2',
            element: selector,
            description:
              'Synchronized media has no captions for its audio; a transcript does not satisfy SC 1.2.2',
            severity: 'serious',
            suggestion:
              'Add <track kind="captions"> (or subtitles) with the dialogue and the sounds that matter',
          });
        }

        // SC 1.2.3 (A): audio description OR a media alternative for text.
        if (!hasDescriptionTrack && !hasTextAlternative) {
          allIssues.push({
            type: 'video-description',
            criterion: '9.1.2.3',
            element: selector,
            description:
              'Synchronized media offers neither an audio description nor an alternative for time-based media',
            severity: 'serious',
            suggestion:
              'Provide a full text alternative for the video, or add audio description via <track kind="descriptions">',
          });
        }

        // SC 1.2.5 (AA): audio description, and only that. A transcript is
        // the 1.2.3 route and does not satisfy this one.
        if (!hasDescriptionTrack) {
          allIssues.push({
            type: 'video-audio-description',
            criterion: '9.1.2.5',
            element: selector,
            description: 'Synchronized media has no audio description of its visual content',
            severity: 'moderate',
            suggestion:
              'Add audio description via <track kind="descriptions">, or supply an audio-described version of the video',
          });
        }
      });

      // ========== AUDIO ANALYSIS ==========
      // SC 1.2.1, audio-only: prerecorded audio needs an alternative for
      // time-based media, i.e. a transcript that is named as one.
      const audioElements = document.querySelectorAll('audio');
      mediaCounts.totalAudio = audioElements.length;

      audioElements.forEach((audio) => {
        const selector = getElementSelector(audio);

        if (!isEvaluableMedia(audio)) return;
        if (isLiveMedia(audio)) return;

        if (!hasTimeBasedTextAlternative(audio)) {
          mediaCounts.audioWithoutTranscripts++;
          allIssues.push({
            type: 'audio-caption',
            criterion: '9.1.2.1',
            element: selector,
            description: 'Prerecorded audio-only content has no transcript',
            severity: 'serious',
            suggestion:
              'Link a transcript beside the audio, or put it in a section whose heading names it as the transcript',
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

      return { allIssues, allQuestions, mediaCounts };
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

    const needsReview = mediaAnalysis.allQuestions.map((q) =>
      this.formatViolation(
        q.type,
        'moderate',
        q.description,
        [{ selector: q.element }],
        'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
        'info',
        {
          verdict: 'needs-review',
          dossier: {
            question: q.question,
            element: { selector: q.element, html: q.html, role: q.role, name: q.alt || null },
            measurements: q.measurements,
            context: q.context,
          },
        }
      )
    );

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
      needsReview,
      visualEvidence,
      ...mediaAnalysis.mediaCounts,
    };
  }
}

module.exports = MediaAccessibilityScanner;
