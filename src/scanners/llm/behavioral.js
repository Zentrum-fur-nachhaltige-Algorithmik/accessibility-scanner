/**
 * LLM Behavioral Scanner
 *
 * Covers criteria about application behavior and timing:
 * - 2.2.3 No Timing (AAA)
 * - 2.2.4 Interruptions (AAA)
 * - 2.2.5 Re-authentication (AAA)
 * - 2.2.6 Timeouts (AAA)
 * - 3.2.5 Change on Request (AAA)
 * - 3.3.5 Help (AAA)
 */

const LLMBaseScanner = require('./base');

class LLMBehavioralScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super('llm-behavioral', {
      wcagCriteria: ['2.2.3', '2.2.4', '2.2.5', '2.2.6', '3.2.5', '3.3.5'],
      wcagPrinciple: 'operable',
    }, llmClient);
  }

  async scan(page, options = {}) {
    const prompt = `Check this HTML for WCAG 2.2 AAA behavioral/timing criteria.

These criteria concern RUNTIME behavior. You are looking at static HTML, so you
may only flag a violation when the HTML itself contains CONCRETE EVIDENCE of the
behavior. Absence of evidence is NEVER a violation. Never infer behavior from
external scripts you cannot see, from framework attributes, or from what a page
"probably" does.

1. **2.2.3 No Timing**: Flag ONLY on direct evidence of a time limit on user
   activity: a <meta http-equiv="refresh"> with a delay, visible countdown-timer
   markup tied to an action (e.g. "answer within 30 seconds", quiz timers), or an
   inline script that submits a form / advances content / ends a session after a
   timer. Timing that is part of real-time events (auctions, live broadcasts) or
   pure decoration (animation durations, carousels with pause controls) is NOT a
   violation.

2. **2.2.4 Interruptions**: Flag ONLY interruptions that appear without user
   action AND cannot be postponed or suppressed: an inline script that opens a
   modal/popup on load or on a timer with no dismiss/"later" control, an
   auto-refresh (meta refresh or location.reload on an interval) without user
   control. Legally required interruptions (cookie/consent banners) and
   dismissible banners are NOT violations. aria-live status regions are NOT
   interruptions.

3. **2.2.5 Re-authentication**: Flag ONLY when an inline script demonstrably
   implements inactivity logout or session expiry AND the page contains a
   multi-field data-entry form AND there is no evidence of data preservation
   (draft saving, sessionStorage/localStorage persistence, a "your data is
   saved" notice). If any of the three parts is missing, do NOT flag.

4. **2.2.6 Timeouts**: Flag ONLY when an inline script implements an inactivity
   timeout that discards user data AND there is no warning mechanism in the
   markup (no timeout-warning dialog, no aria-live warning region). A session
   script alone, without evidence of data loss, is NOT a violation.

5. **3.2.5 Change on Request**: Flag ONLY concrete auto-initiated context
   changes: <meta http-equiv="refresh"> with a URL, an inline script assigning
   window.location on load or on a timer, a form that submits on input/change
   (onchange="this.form.submit()" or an inline listener doing the same) without
   a submit button, or <select> elements that navigate onchange. Redirects or
   navigation that happen as the direct result of a user click/submit are
   user-initiated and NOT violations. target="_blank" alone is NOT a violation
   of this criterion.

6. **3.3.5 Help**: Only assess forms that are genuinely complex: five or more
   input fields, or fields requiring a specific format (dates, IDs, insurance
   numbers). Flag ONLY when such a form has NO help of any kind: no instruction
   text, no aria-describedby hints, no title/placeholder guidance, no help link
   or contact reference. Simple forms (login, search, contact forms with
   name/email/message) do NOT require context-sensitive help — never flag them.

Do NOT flag:
- Anything based on the mere presence of setTimeout/setInterval (timers are used
  for animations, debouncing, analytics — flag only when the timer's callback
  demonstrably submits, navigates, logs out, or removes user data)
- External or minified scripts whose behavior you cannot read
- Missing help links on simple pages or simple forms
- Carousels/slideshows that have visible pause/prev/next controls
- Standard analytics, tag-manager, or cookie-consent snippets

IMPORTANT: Err on the side of NOT flagging. Each violation you report must cite
the specific evidence (the tag, attribute, or inline-script fragment) in its
description. If you cannot quote concrete evidence, do not report the violation.

Return violations as JSON.`;

    const { violations: raw, summary: ctx } = await this.analyzePageChunked(page, prompt);
    const violations = this.convertViolations(raw);

    return {
      scannerId: this.id,
      passed: violations.length === 0,
      violations,
      summary: {
        totalIssues: violations.length,
        llmModel: ctx.llmModel || 'unknown',
        criteriaChecked: ['2.2.3', '2.2.4', '2.2.5', '2.2.6', '3.2.5', '3.3.5'],
        analyzedFraction: ctx.analyzedFraction,
        rawChars: ctx.rawChars,
        skeletonChars: ctx.skeletonChars,
        chunkCount: ctx.chunkCount,
        truncated: ctx.truncated,
      },
    };
  }
}

module.exports = LLMBehavioralScanner;
