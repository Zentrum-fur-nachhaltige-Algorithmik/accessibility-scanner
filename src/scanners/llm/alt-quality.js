/**
 * LLM Alt-Text Quality Scanner
 * Covers 1.1.1 Non-text Content (Level A): the quality of existing alt text.
 * Hands the LLM each image's alt together with the context a human reviewer
 * would use (filename, nearby heading, figcaption, link text, size, role).
 */

const LLMBaseScanner = require('./base');
const { analyzeCompat } = require('./analyze-compat');

const MAX_IMAGES = 30;

class LLMAltQualityScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super(
      'llm-alt-quality',
      {
        wcagCriteria: ['1.1.1'],
        wcagPrinciple: 'perceivable',
      },
      llmClient
    );
  }

  async scan(page, options = {}) {
    const images = await this._collectImages(page);

    if (images.length === 0) {
      return {
        scannerId: this.id,
        passed: true,
        violations: [],
        summary: {
          totalIssues: 0,
          criteriaChecked: ['1.1.1'],
          skipped: 'no images with an alt attribute to assess',
          imagesInspected: 0,
        },
      };
    }

    const prompt = `${PROMPT}

## Measured images on THIS page

${JSON.stringify(images, null, 1)}

Return violations as JSON.`;

    const { violations: raw, ctx } = await analyzeCompat(this, page, prompt);
    const violations = this.convertViolations(raw);

    return {
      scannerId: this.id,
      passed: violations.length === 0,
      violations,
      summary: {
        totalIssues: violations.length,
        llmModel: ctx.llmModel || 'unknown',
        criteriaChecked: ['1.1.1'],
        imagesInspected: images.length,
        analyzedFraction: ctx.analyzedFraction,
        chunkCount: ctx.chunkCount,
        truncated: ctx.truncated,
      },
    };
  }

  /**
   * Gather each image together with the context a human would use to judge its
   * alt text. Images WITHOUT an alt attribute are excluded: that is axe-core's
   * finding.
   */
  async _collectImages(page, max = MAX_IMAGES) {
    return page.evaluate((limit) => {
      function nearestHeading(el) {
        let cur = el;
        while (cur && cur !== document.body) {
          let sib = cur.previousElementSibling;
          while (sib) {
            if (/^H[1-6]$/.test(sib.tagName)) return sib.textContent.trim().slice(0, 90);
            const inner = sib.querySelector && sib.querySelector('h1,h2,h3,h4,h5,h6');
            if (inner) return inner.textContent.trim().slice(0, 90);
            sib = sib.previousElementSibling;
          }
          cur = cur.parentElement;
        }
        return null;
      }

      function surroundingText(el) {
        const p = el.closest('figure, p, li, td, th, section, article, div');
        if (!p) return null;
        const t = (p.textContent || '').replace(/\s+/g, ' ').trim();
        return t ? t.slice(0, 260) : null;
      }

      const out = [];
      // Anything the author treated as an image AND gave a text alternative to.
      // `[alt]:not(img)` is deliberate: real pages (and this project's own
      // fixtures) carry image alternatives on <div>/<span> placeholders with a
      // CSS background image. That the alt sits on the wrong element is a
      // different defect, owned by other scanners; here those elements are
      // simply images whose alt TEXT still has to be judged.
      const imgs = [
        ...document.querySelectorAll(
          'img[alt], area[alt], input[type="image"][alt], [role="img"], svg[role="img"], [alt]:not(img):not(area):not(input)'
        ),
      ];

      const NATIVE_IMAGE_TAGS = [
        'img',
        'svg',
        'area',
        'input',
        'picture',
        'canvas',
        'object',
        'embed',
      ];

      for (const el of imgs) {
        if (out.length >= limit) break;

        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (el.getAttribute('aria-hidden') === 'true') continue;

        const tag = el.tagName.toLowerCase();

        // On a real image element the alt attribute names it; elsewhere the
        // author's alternative may live in aria-label or an <svg><title>.
        const svgTitle = el.querySelector && el.querySelector('title');
        const alt =
          NATIVE_IMAGE_TAGS.includes(tag) && el.hasAttribute('alt')
            ? el.getAttribute('alt')
            : el.getAttribute('aria-label') ||
              (svgTitle ? svgTitle.textContent : null) ||
              el.getAttribute('alt');
        if (alt === null || alt === undefined) continue;

        const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
        const filename = src
          ? decodeURIComponent(src.split('?')[0].split('/').pop() || '').slice(0, 60)
          : null;

        const link = el.closest('a[href]');
        const rect = el.getBoundingClientRect();
        const fig = el.closest('figure');

        out.push({
          selector: el.id
            ? `#${el.id}`
            : filename
              ? `${tag}[src$="${filename.slice(-24)}"]`
              : `${tag}[alt="${String(alt).slice(0, 40)}"]`,
          tag,
          alt: alt,
          altIsEmpty: alt.trim().length === 0,
          filename,
          renderedSize: { w: Math.round(rect.width), h: Math.round(rect.height) },
          insideLink: Boolean(link),
          linkHref: link ? (link.getAttribute('href') || '').slice(0, 120) : null,
          linkHasOtherText: link
            ? (link.textContent || '').replace(/\s+/g, ' ').trim().length > 0
            : false,
          figcaption:
            fig && fig.querySelector('figcaption')
              ? fig.querySelector('figcaption').textContent.trim().slice(0, 160)
              : null,
          title: el.getAttribute('title'),
          longdesc: el.getAttribute('longdesc') || el.getAttribute('aria-describedby') || null,
          nearestHeading: nearestHeading(el),
          surroundingText: surroundingText(el),
          role: el.getAttribute('role'),
          className: typeof el.className === 'string' ? el.className.slice(0, 60) : null,
        });
      }

      return out;
    }, max);
  }
}

const PROMPT = `Check the alt text QUALITY of the images below against WCAG 2.2 criterion 1.1.1 (Non-text Content, Level A).

Another tool already checks whether an alt attribute EXISTS. Your job is the part it cannot do: judge whether the alternative text actually serves the same purpose as the image for someone who cannot see it.

Flag an image ONLY when one of these specific, evidenced failures applies:

1. **Alt is the filename or a file-like string.** The "alt" value equals or closely matches "filename", or looks like a filename/asset id (e.g. "IMG_2043.JPG", "hero-banner-2x.png", "unnamed", "download", "Screenshot 2024-11-03 at 10.22.11"). Cite the alt and the filename.
2. **Alt is a placeholder or a bare generic noun** that conveys nothing: "image", "photo", "picture", "graphic", "Bild", "Foto", "Grafik", "Abbildung", "banner", "icon", "spacer", "thumbnail", used alone, with no further description. A bare "logo" counts too. Cite the alt.
3. **Alt duplicates adjacent visible text verbatim**: the alt is (nearly) identical to "figcaption", "nearestHeading" or the link's own text, so a screen-reader user hears the same sentence twice. Cite both strings.
4. **An image that is the ONLY content of a link has an empty or meaningless alt**: "insideLink" is true, "linkHasOtherText" is false, and "alt" is empty or one of the generic values above, so the link has no usable purpose. Cite "linkHref".
5. **A complex informative image is described by a single short phrase with no long description available.** Only when the evidence really points at a chart/diagram/map/infographic: "filename", "className", "figcaption", "nearestHeading" or "surroundingText" says so (e.g. "diagramm", "chart", "grafik-statistik", "infografik", "Abb. 3"), AND "alt" is under about 60 characters AND "longdesc" is null. Cite all three.
6. **Alt text that is keyword stuffing or marketing copy** rather than a description: a comma/pipe-separated keyword list, or a string repeating the practice/product name several times. Cite the alt.

Examples that are NOT violations (do NOT flag these):
- \`altIsEmpty: true\` on a decorative image that is NOT the only content of a link: an empty alt is the CORRECT way to hide decoration. Never flag an empty alt on its own.
- Small icons (renderedSize under roughly 32×32) that sit next to their own visible text label: the icon is decorative reinforcement.
- Alt text that is short but sufficient for a simple photo ("Dr. Maria Huber im Behandlungsraum", "Praxiseingang mit Rampe").
- Alt text starting with "Bild von …" / "Foto von …" / "Image of …": mildly redundant, but the information is there. Not a failure.
- Alt text in German, or in any language other than English. Judge the MEANING, not the language.
- Alt text that differs in wording from the caption while adding genuinely different information.
- A logo whose alt names the organisation ("Ordination Dr. Huber"): that is correct, not generic.
- Any image whose alt you simply find stylistically weak. "Could be better" is not a WCAG failure.
- Missing alt attributes entirely: those are not in your list and are reported elsewhere. Never report a missing alt.
- The element's TAG. Judge the alt text only. Some pages carry image alternatives on \`<div>\`/\`<span>\` placeholders rather than \`<img>\`; that is a different defect, reported elsewhere, and is never your finding.

Note on sizes: \`<area>\` elements inside an image map always report a rendered size of 0×0. Never treat that as "too small to matter": judge them by their alt text like any other image.

Report at most 10 violations. If there are more, report the 10 most severe and say so in the summary: a long response risks being truncated and lost entirely.

CRITICAL: every violation you report must quote the exact measured values it rests on (the alt string, and the filename / figcaption / linkHref / size that makes it a failure) and name which of the six numbered failures applies. If you cannot quote that evidence, do not report it. Err strongly on the side of NOT flagging: a page full of adequate-but-plain alt text is compliant.

Use criterion "1.1.1" and set "selector" to the image's measured "selector" value.`;

module.exports = LLMAltQualityScanner;
