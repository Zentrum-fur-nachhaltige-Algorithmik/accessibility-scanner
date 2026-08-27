/**
 * LLM Sensory Characteristics Scanner
 *
 * Covers:
 * - 1.3.3 Sensory Characteristics (Level A)
 *
 * Detects instructions that rely SOLELY on shape, color, size,
 * visual location, orientation, or sound to convey information.
 */

const LLMBaseScanner = require('./base');

class LLMSensoryCharacteristicsScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super('llm-sensory-characteristics', {
      wcagCriteria: ['1.3.3'],
      wcagPrinciple: 'perceivable',
    }, llmClient);
  }

  async scan(page, options = {}) {
    const prompt = `Check this HTML for WCAG 2.2 criterion 1.3.3 (Sensory Characteristics, Level A).

This criterion requires that instructions for understanding or operating content do NOT rely SOLELY on sensory characteristics such as shape, color, size, visual location, orientation, or sound.

Flag an instruction ONLY if ALL of the following are true:
1. It is an actual instruction telling the user to do something or find something.
2. It identifies the target EXCLUSIVELY by a sensory property (shape, color, size, visual location, orientation, or sound) with NO textual label, name, or role that a non-sighted user could use.
3. There is no adjacent text label, aria-label, or programmatic name that disambiguates the reference.

Examples of violations:
- "Click the round button" (shape only, no name given)
- "The red text indicates errors" (color only, no icon or text label)
- "Use the menu on the left" (location only, menu not named)
- "Press the larger button to continue" (size only, no label)

Examples that are NOT violations (do NOT flag these):
- "Click the Submit button (round, green)" — name IS provided alongside visual cue
- "Error messages are shown in red text with a warning icon and the word 'Error'" — multiple cues
- "Use the Account Settings link in the navigation menu" — element is named
- "The sidebar labeled 'Quick Actions' on the right" — name provided alongside location
- Decorative or informational text that is NOT an instruction (e.g., "The sky is blue")
- Standard UI labels like "Click Submit" or "Press Cancel" — these reference the element by name

CRITICAL: Only flag actual instructions that would leave a non-visual user unable to identify the referenced element. If any textual identifier (name, label, role) accompanies the sensory reference, it is NOT a violation. Err on the side of NOT flagging.

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
        criteriaChecked: ['1.3.3'],
        analyzedFraction: ctx.analyzedFraction,
        rawChars: ctx.rawChars,
        skeletonChars: ctx.skeletonChars,
        chunkCount: ctx.chunkCount,
        truncated: ctx.truncated,
      },
    };
  }
}

module.exports = LLMSensoryCharacteristicsScanner;
