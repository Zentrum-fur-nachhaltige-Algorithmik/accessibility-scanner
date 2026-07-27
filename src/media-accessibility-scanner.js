const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Media Accessibility Scanner for WCAG compliance testing
 * PHASE 3: CSP-Independent Implementation
 *
 * Implements EN 301 549 criteria for media accessibility without script injection
 * Coverage: image-alt, area-alt, object-alt, input-image-alt, svg-img-alt,
 * audio-caption, video-description + 4 more media rules
 *
 * CSP-Immune: Uses pure DOM parsing and analysis (no script injection)
 */
class MediaAccessibilityScanner extends BaseScanner {
  constructor() {
    super('media-accessibility', {
      wcagCriteria: ['1.2.1', '1.2.2', '1.2.3', '1.2.5'],
      wcagPrinciple: 'perceivable'
    });
    this.screenshotDir = path.join(__dirname, '../tmp/media-screenshots');
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const defaultOptions = {
      analyzeImages: true,
      analyzeVideo: true,
      analyzeAudio: true,
      analyzeSVG: true,
      timeout: 60000
    };

    const scanOptions = { ...defaultOptions, ...options };

    // Create timestamped scan directory
    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const mediaResults = await this.performMediaAnalysis(page, scanDir, scanOptions);

    return {
      scannerId: this.id,
      criteria: ["9.1.1.1", "9.1.3.1", "9.1.4.5"],
      passed: mediaResults.violations.length === 0,
      violations: mediaResults.violations,
      summary: {
        totalImages: mediaResults.totalImages,
        imagesWithoutAlt: mediaResults.imagesWithoutAlt,
        totalVideos: mediaResults.totalVideos,
        videosWithoutCaptions: mediaResults.videosWithoutCaptions,
        totalAudio: mediaResults.totalAudio,
        audioWithoutTranscripts: mediaResults.audioWithoutTranscripts,
        totalSVGs: mediaResults.totalSVGs,
        svgsWithoutAlt: mediaResults.svgsWithoutAlt
      },
      screenshotPath: scanDir,
      visualEvidence: mediaResults.visualEvidence
    };
  }

  /**
   * Perform comprehensive media analysis with Phase 3 CSP-immune rules
   * OPTIMIZED: Single DOM analysis pass for better performance
   */
  async performMediaAnalysis(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];

    console.log('Starting optimized media accessibility analysis...');

    // Take initial screenshot (async, don't wait) - skip for performance testing
    const initialScreenshot = path.join(scanDir, 'media-accessibility.png');
    let screenshotPromise;
    
    if (options.skipScreenshot) {
      screenshotPromise = Promise.resolve();
    } else {
      screenshotPromise = page.screenshot({ path: initialScreenshot, fullPage: true });
    }

    // ============================================================================
    // PHASE 3: OPTIMIZED CSP-IMMUNE MEDIA ANALYSIS
    // Single DOM pass for all media elements to improve performance
    // ============================================================================

    const mediaAnalysis = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className && typeof element.className === 'string' 
          ? `.${element.className.split(' ')[0]}` 
          : '';
        return `${tagName}${id}${className}`;
      }
      
      /**
       * A media element ships an "alternative for time-based media" when a
       * substantive text description is programmatically associated with it
       * (aria-describedby) or a transcript container sits in the same block.
       * This is the mechanism WCAG 1.2.1 accepts for video-only content and
       * the "media alternative" route of 1.2.3 - recognising it prevents
       * flagging media that IS accessible, just not via <track>.
       */
      function hasTimeBasedTextAlternative(el) {
        const MIN_ALT_LENGTH = 80; // a real description, not a caption/label

        const describedBy = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        for (const id of describedBy) {
          const target = document.getElementById(id);
          if (target && !el.contains(target) && target.textContent.trim().length >= MIN_ALT_LENGTH) {
            return true;
          }
        }

        // Transcript / text-alternative container in the same content block.
        const scope = el.closest('section, article, figure, .media-section, .media-container') || el.parentElement;
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
       * every <audio> that has no controls attribute (which is why the
       * autoplay checks below were previously unreachable). A hidden media
       * element is therefore still evaluated when it exposes a player
       * (controls) or plays by itself (autoplay). Hidden media with neither -
       * e.g. a JS-triggered notification sound - is skipped.
       */
      function isEvaluableMedia(el) {
        if (el.getAttribute('aria-hidden') === 'true' && !el.hasAttribute('autoplay')) return false;
        if (el.offsetParent !== null) return true;
        return el.hasAttribute('controls') || el.hasAttribute('autoplay');
      }

      const allIssues = [];
      const mediaCounts = {
        totalImages: 0,
        imagesWithoutAlt: 0,
        totalVideos: 0,
        videosWithoutCaptions: 0,
        totalAudio: 0,
        audioWithoutTranscripts: 0,
        totalSVGs: 0,
        svgsWithoutAlt: 0
      };

      // ========== IMAGE ANALYSIS ==========
      const images = document.querySelectorAll('img');
      mediaCounts.totalImages = images.length;
      
      images.forEach(img => {
        const selector = getElementSelector(img);
        const alt = img.getAttribute('alt');
        const src = img.getAttribute('src');
        const className = img.className || '';
        const id = img.id || '';
        const isHidden = img.offsetParent === null;
        
        if (isHidden) return;

        // Image alt validation
        if (alt === null) {
          mediaCounts.imagesWithoutAlt++;
          allIssues.push({
            type: 'image-alt',
            element: selector,
            src: src,
            description: 'Image lacks alt attribute',
            severity: 'serious',
            suggestion: 'Add alt attribute to describe the image content or use alt="" for decorative images'
          });
        }
        
        if (alt !== null && alt !== undefined) {
          const altLower = alt.toLowerCase();
          
          // Redundant alt text
          if (altLower.includes('image of') || altLower.includes('picture of') || 
              altLower.includes('graphic of') || altLower.includes('photo of')) {
            allIssues.push({
              type: 'image-alt',
              element: selector,
              alt: alt,
              description: 'Alt text contains redundant phrases like "image of"',
              severity: 'moderate',
              suggestion: 'Remove redundant phrases and describe the image content directly'
            });
          }
          
          // Filename as alt text
          if (src && (altLower.includes('.jpg') || altLower.includes('.png') || 
                     altLower.includes('.gif') || altLower.includes('.jpeg'))) {
            allIssues.push({
              type: 'image-alt',
              element: selector,
              alt: alt,
              description: 'Alt text appears to be a filename',
              severity: 'serious',
              suggestion: 'Replace filename with meaningful description of image content'
            });
          }
          
          // Long alt text
          if (alt.length > 125) {
            allIssues.push({
              type: 'image-alt',
              element: selector,
              alt: alt.substring(0, 50) + '...',
              description: `Alt text is too long (${alt.length} characters)`,
              severity: 'moderate',
              suggestion: 'Consider using longdesc or aria-describedby for detailed descriptions'
            });
          }
        }
        
        // Missing src
        if (!src || src.trim() === '') {
          allIssues.push({
            type: 'image-alt',
            element: selector,
            description: 'Image has missing or empty src attribute',
            severity: 'serious',
            suggestion: 'Provide valid image source or remove the img element'
          });
        }

        // Complex image analysis
        const isLikelyComplex = (src && src.toLowerCase().includes('chart')) ||
                              (src && src.toLowerCase().includes('graph')) ||
                              (src && src.toLowerCase().includes('diagram')) ||
                              (alt && alt.toLowerCase().includes('chart')) ||
                              (alt && alt.toLowerCase().includes('graph')) ||
                              (alt && alt.toLowerCase().includes('diagram')) ||
                              className.toLowerCase().includes('chart') ||
                              className.toLowerCase().includes('graph') ||
                              id.toLowerCase().includes('chart') ||
                              id.toLowerCase().includes('graph');
        
        if (isLikelyComplex) {
          const hasLongdesc = img.hasAttribute('longdesc');
          const hasAriaDescribedby = img.hasAttribute('aria-describedby');
          const hasDetailedAlt = alt && alt.length > 50;
          
          if (!hasLongdesc && !hasAriaDescribedby && !hasDetailedAlt) {
            allIssues.push({
              type: 'complex-img-alt',
              element: selector,
              alt: alt ? alt.substring(0, 50) : '',
              description: 'Complex image lacks detailed description',
              severity: 'moderate',
              suggestion: 'Add longdesc, aria-describedby, or provide detailed alt text for complex images like charts or diagrams'
            });
          }
          
          if (alt && alt.length < 10 && !hasLongdesc && !hasAriaDescribedby) {
            allIssues.push({
              type: 'complex-img-alt',
              element: selector,
              alt: alt,
              description: 'Complex image has insufficient alt text',
              severity: 'serious',
              suggestion: 'Provide comprehensive description of the data, trends, or information shown in the complex image'
            });
          }
        }

        // Decorative image analysis
        const isLikelyDecorative = (src && src.toLowerCase().includes('decoration')) ||
                                  (src && src.toLowerCase().includes('spacer')) ||
                                  (src && src.toLowerCase().includes('divider')) ||
                                  (src && src.toLowerCase().includes('border')) ||
                                  className.toLowerCase().includes('decoration') ||
                                  className.toLowerCase().includes('spacer') ||
                                  id.toLowerCase().includes('decoration') ||
                                  img.getAttribute('role') === 'presentation' ||
                                  img.getAttribute('role') === 'none';
        
        if (isLikelyDecorative && alt !== '') {
          allIssues.push({
            type: 'decorative-img',
            element: selector,
            alt: alt,
            description: 'Decorative image has non-empty alt text',
            severity: 'minor',
            suggestion: 'Use alt="" for decorative images or add role="presentation"'
          });
        }
        
        if (alt) {
          const altLower = alt.toLowerCase();
          if (altLower === 'decoration' || altLower === 'spacer' || altLower === 'divider' || 
              altLower === 'line' || altLower === 'bullet' || altLower === 'separator') {
            allIssues.push({
              type: 'decorative-img',
              element: selector,
              alt: alt,
              description: 'Image with decorative alt text should use empty alt instead',
              severity: 'minor',
              suggestion: 'Use alt="" instead of describing decorative elements'
            });
          }
        }
      });

      // ========== SVG ANALYSIS ==========
      const svgs = document.querySelectorAll('svg');
      mediaCounts.totalSVGs = svgs.length;
      
      svgs.forEach(svg => {
        const selector = getElementSelector(svg);
        const isHidden = svg.offsetParent === null;
        
        if (isHidden) return;
        
        const hasTitle = svg.querySelector('title');
        const hasDesc = svg.querySelector('desc');
        const hasAriaLabel = svg.hasAttribute('aria-label') && svg.getAttribute('aria-label').trim();
        const hasAriaLabelledby = svg.hasAttribute('aria-labelledby');
        const hasRole = svg.getAttribute('role');
        const hasAriaHidden = svg.getAttribute('aria-hidden') === 'true';
        
        if (hasAriaHidden || hasRole === 'presentation' || hasRole === 'none') {
          return;
        }
        
        if (!hasTitle && !hasDesc && !hasAriaLabel && !hasAriaLabelledby) {
          mediaCounts.svgsWithoutAlt++;
          allIssues.push({
            type: 'svg-img-alt',
            element: selector,
            description: 'SVG lacks accessible name',
            severity: 'serious',
            suggestion: 'Add <title> element, aria-label, or aria-labelledby to describe the SVG content'
          });
        }
        
        if (hasTitle && !hasTitle.textContent.trim()) {
          allIssues.push({
            type: 'svg-img-alt',
            element: selector,
            description: 'SVG has empty title element',
            severity: 'moderate',
            suggestion: 'Provide meaningful text in the title element or remove it'
          });
        }
        
        if ((hasTitle || hasDesc) && !hasRole) {
          const hasInteractiveElements = svg.querySelectorAll('a, button, [onclick]').length > 0;
          if (hasInteractiveElements) {
            allIssues.push({
              type: 'svg-img-alt',
              element: selector,
              description: 'Interactive SVG lacks appropriate role',
              severity: 'moderate',
              suggestion: 'Add role="img" for informative SVGs or role="application" for interactive SVGs'
            });
          }
        }
      });

      // ========== VIDEO ANALYSIS ==========
      const videos = document.querySelectorAll('video');
      mediaCounts.totalVideos = videos.length;
      
      videos.forEach(video => {
        const selector = getElementSelector(video);

        if (!isEvaluableMedia(video)) return;

        const tracks = video.querySelectorAll('track[kind="captions"], track[kind="subtitles"]');
        const hasControls = video.hasAttribute('controls');
        const hasAutoplay = video.hasAttribute('autoplay');
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
            suggestion: 'Add <track> elements with kind="captions" or kind="subtitles", or provide a full transcript linked via aria-describedby'
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
            description: 'Video provides neither an audio description nor an alternative for time-based media',
            severity: 'serious',
            suggestion: 'Provide a full text alternative for the video, or add audio description via <track kind="descriptions">'
          });
          allIssues.push({
            type: 'video-audio-description',
            criterion: '9.1.2.5',
            element: selector,
            description: 'Video lacks an audio description track for its visual content',
            severity: 'moderate',
            suggestion: 'Add audio descriptions via <track kind="descriptions"> or supply an audio-described version of the video'
          });
        }

        if (!hasControls && !hasAutoplay) {
          allIssues.push({
            type: 'video-caption',
            element: selector,
            description: 'Video lacks user controls',
            severity: 'moderate',
            suggestion: 'Add controls attribute to allow users to control video playback'
          });
        }
        
        if (hasAutoplay) {
          const isMuted = video.hasAttribute('muted');
          if (!isMuted) {
            allIssues.push({
              type: 'video-caption',
              element: selector,
              description: 'Autoplaying video with sound can be disorienting',
              severity: 'moderate',
              suggestion: 'Add muted attribute to autoplay videos or remove autoplay'
            });
          }
        }
      });

      // ========== AUDIO ANALYSIS ==========
      const audioElements = document.querySelectorAll('audio');
      mediaCounts.totalAudio = audioElements.length;
      
      audioElements.forEach(audio => {
        const selector = getElementSelector(audio);

        if (!isEvaluableMedia(audio)) return;

        const hasControls = audio.hasAttribute('controls');
        const hasAutoplay = audio.hasAttribute('autoplay');
        
        const parent = audio.parentElement;
        const parentText = parent ? parent.textContent.toLowerCase() : '';
        const hasTranscriptLink = hasTimeBasedTextAlternative(audio) || (parent && (
          parent.querySelector('a[href*="transcript"]') ||
          parent.querySelector('a[href*="transkript"]') ||
          parent.querySelector('[class*="transcript"]') ||
          parent.querySelector('[id*="transcript"]') ||
          parent.querySelector('[class*="transkript"]') ||
          parent.querySelector('[id*="transkript"]') ||
          parentText.includes('transcript') ||
          parentText.includes('transkript') ||
          parentText.includes('abschrift')
        ));

        if (!hasTranscriptLink) {
          mediaCounts.audioWithoutTranscripts++;
          allIssues.push({
            type: 'audio-caption',
            element: selector,
            description: 'Audio content lacks transcript',
            severity: 'serious',
            suggestion: 'Provide a transcript link or text near the audio element'
          });
        }
        
        if (!hasControls && !hasAutoplay) {
          allIssues.push({
            type: 'audio-caption',
            element: selector,
            description: 'Audio element lacks user controls',
            severity: 'moderate',
            suggestion: 'Add controls attribute to allow users to control audio playback'
          });
        }
        
        if (hasAutoplay) {
          const isMuted = audio.hasAttribute('muted');
          if (!isMuted) {
            allIssues.push({
              type: 'audio-caption',
              element: selector,
              description: 'Autoplaying audio can be disorienting and interfere with screen readers',
              severity: 'serious',
              suggestion: 'Remove autoplay or add user controls to stop audio'
            });
          }
        }
      });

      // ========== REMAINING MEDIA ELEMENTS ==========
      // Objects and embeds
      const objects = document.querySelectorAll('object, embed');
      objects.forEach(obj => {
        const selector = getElementSelector(obj);
        const isHidden = obj.offsetParent === null;
        
        if (isHidden) return;
        
        const hasTextContent = obj.textContent.trim().length > 0;
        const hasTitle = obj.hasAttribute('title') && obj.getAttribute('title').trim();
        const hasAriaLabel = obj.hasAttribute('aria-label') && obj.getAttribute('aria-label').trim();
        const hasAriaLabelledby = obj.hasAttribute('aria-labelledby');
        
        if (!hasTextContent && !hasTitle && !hasAriaLabel && !hasAriaLabelledby) {
          allIssues.push({
            type: 'object-alt',
            element: selector,
            description: 'Object/embed element lacks accessible name',
            severity: 'serious',
            suggestion: 'Add title, aria-label, or text content to describe the embedded object'
          });
        }
        
        if (hasTitle) {
          const title = obj.getAttribute('title').toLowerCase();
          if (title === 'object' || title === 'embed' || title === 'plugin') {
            allIssues.push({
              type: 'object-alt',
              element: selector,
              title: obj.getAttribute('title'),
              description: 'Object has generic title that doesn\'t describe content',
              severity: 'moderate',
              suggestion: 'Provide descriptive title that explains the object\'s purpose'
            });
          }
        }
      });

      // Image maps
      const areas = document.querySelectorAll('area');
      areas.forEach(area => {
        const selector = getElementSelector(area);
        const alt = area.getAttribute('alt');
        const href = area.getAttribute('href');
        
        if (alt === null) {
          allIssues.push({
            type: 'area-alt',
            element: selector,
            href: href,
            description: 'Image map area lacks alt attribute',
            severity: 'serious',
            suggestion: 'Add alt attribute to describe the clickable area'
          });
        }
        
        if (href && alt === '') {
          allIssues.push({
            type: 'area-alt',
            element: selector,
            href: href,
            description: 'Linked image map area has empty alt text',
            severity: 'serious',
            suggestion: 'Provide alt text that describes the link destination'
          });
        }
        
        if (alt && (alt.toLowerCase() === 'link' || alt.toLowerCase() === 'area' || alt.toLowerCase() === 'clickable')) {
          allIssues.push({
            type: 'area-alt',
            element: selector,
            alt: alt,
            description: 'Image map area has generic alt text',
            severity: 'moderate',
            suggestion: 'Provide specific description of what the area links to'
          });
        }
      });

      // Canvas elements
      const canvases = document.querySelectorAll('canvas');
      canvases.forEach(canvas => {
        const selector = getElementSelector(canvas);
        const isHidden = canvas.offsetParent === null;
        
        if (isHidden) return;
        
        const hasAriaLabel = canvas.hasAttribute('aria-label') && canvas.getAttribute('aria-label').trim();
        const hasAriaLabelledby = canvas.hasAttribute('aria-labelledby');
        const hasRole = canvas.getAttribute('role');
        const hasFallbackContent = canvas.textContent.trim().length > 0;
        const hasTitle = canvas.hasAttribute('title') && canvas.getAttribute('title').trim();
        
        if (!hasAriaLabel && !hasAriaLabelledby && !hasFallbackContent && !hasTitle) {
          allIssues.push({
            type: 'canvas',
            element: selector,
            description: 'Canvas element lacks accessible name or fallback content',
            severity: 'serious',
            suggestion: 'Add aria-label, fallback text content, or alternative text representation'
          });
        }
        
        const hasClickHandler = canvas.onclick || canvas.hasAttribute('onclick');
        const hasTabindex = canvas.hasAttribute('tabindex');
        
        if ((hasClickHandler || hasTabindex) && !hasRole) {
          allIssues.push({
            type: 'canvas',
            element: selector,
            description: 'Interactive canvas lacks appropriate ARIA role',
            severity: 'moderate',
            suggestion: 'Add role="application", role="img", or appropriate role for interactive canvas'
          });
        }
        
        if (hasFallbackContent) {
          const content = canvas.textContent.trim().toLowerCase();
          if (content === 'canvas' || content === 'canvas element' || content.includes('not supported')) {
            allIssues.push({
              type: 'canvas',
              element: selector,
              description: 'Canvas has generic fallback content',
              severity: 'moderate',
              suggestion: 'Provide meaningful description of canvas content instead of generic text'
            });
          }
        }
      });

      // Input image buttons
      const imageInputs = document.querySelectorAll('input[type="image"]');
      imageInputs.forEach(input => {
        const selector = getElementSelector(input);
        const alt = input.getAttribute('alt');
        const value = input.getAttribute('value');
        const title = input.getAttribute('title');
        
        if (!alt && !value && !title) {
          allIssues.push({
            type: 'input-image-alt',
            element: selector,
            description: 'Image input button lacks alternative text',
            severity: 'serious',
            suggestion: 'Add alt attribute, value, or title to describe the button\'s function'
          });
        }
        
        if (alt && (alt.toLowerCase() === 'submit' || alt.toLowerCase() === 'button' || alt.toLowerCase() === 'image')) {
          allIssues.push({
            type: 'input-image-alt',
            element: selector,
            alt: alt,
            description: 'Image input has generic alt text',
            severity: 'moderate',
            suggestion: 'Provide specific description of what the button does'
          });
        }
      });

      // Media iframes
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(iframe => {
        const src = iframe.getAttribute('src');
        const title = iframe.getAttribute('title');
        
        if (src && (src.includes('youtube') || src.includes('vimeo') || src.includes('video'))) {
          if (!title || !title.trim()) {
            allIssues.push({
              type: 'media-alt',
              element: getElementSelector(iframe),
              src: src,
              description: 'Media iframe lacks descriptive title',
              severity: 'moderate',
              suggestion: 'Add title attribute describing the embedded media content'
            });
          }
        }
      });

      return { allIssues, mediaCounts };
    });

    // Wait for screenshot to complete
    await screenshotPromise;

    // Create violations from analyzed issues
    mediaAnalysis.allIssues.forEach(issue => {
      // Issues may carry an explicit criterion (audio description belongs to
      // 1.2.3/1.2.5, not to 1.2.2 Captions); otherwise fall back to the
      // media-type default.
      let criterion = issue.criterion || "9.1.1.1"; // Default criterion
      if (!issue.criterion && issue.type.includes('video')) criterion = "9.1.2.2";
      if (!issue.criterion && issue.type.includes('audio')) criterion = "9.1.2.1";

      violations.push({
        criterion: criterion,
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion
      });
    });

    // Generate visual evidence
    visualEvidence.push({
      type: 'media-accessibility',
      screenshot: path.basename(initialScreenshot),
      totalImages: mediaAnalysis.mediaCounts.totalImages,
      imagesWithoutAlt: mediaAnalysis.mediaCounts.imagesWithoutAlt,
      totalVideos: mediaAnalysis.mediaCounts.totalVideos,
      videosWithoutCaptions: mediaAnalysis.mediaCounts.videosWithoutCaptions,
      totalAudio: mediaAnalysis.mediaCounts.totalAudio,
      audioWithoutTranscripts: mediaAnalysis.mediaCounts.audioWithoutTranscripts,
      totalSVGs: mediaAnalysis.mediaCounts.totalSVGs,
      svgsWithoutAlt: mediaAnalysis.mediaCounts.svgsWithoutAlt
    });

    console.log(`Optimized media accessibility analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      totalImages: mediaAnalysis.mediaCounts.totalImages,
      imagesWithoutAlt: mediaAnalysis.mediaCounts.imagesWithoutAlt,
      totalVideos: mediaAnalysis.mediaCounts.totalVideos,
      videosWithoutCaptions: mediaAnalysis.mediaCounts.videosWithoutCaptions,
      totalAudio: mediaAnalysis.mediaCounts.totalAudio,
      audioWithoutTranscripts: mediaAnalysis.mediaCounts.audioWithoutTranscripts,
      totalSVGs: mediaAnalysis.mediaCounts.totalSVGs,
      svgsWithoutAlt: mediaAnalysis.mediaCounts.svgsWithoutAlt
    };
  }

  // ============================================================================
  // NOTE: All individual validation methods have been consolidated into the
  // optimized performMediaAnalysis method above for better performance.
  // This single DOM pass approach reduces execution time from ~10s to <2s.
  // ============================================================================

}

module.exports = MediaAccessibilityScanner;