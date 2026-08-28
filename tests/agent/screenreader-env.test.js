import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const ScreenReaderEnv = require('../../src/agent/screenreader-env');

/**
 * Opens `test-sites/agent/<file>` with a started ScreenReaderEnv and runs `fn`.
 * The page and the env are always torn down.
 */
async function withEnv(file, options, fn) {
  const page = await getPage(`${getBaseUrl()}/agent/${file}`);
  const env = new ScreenReaderEnv(page, options);
  try {
    await env.start();
    return await fn(env, page);
  } finally {
    try {
      await env.stop();
    } catch {
      /* ignore */
    }
    await page.close();
  }
}

/** Runs a list of commands and returns all observations. */
async function runAll(env, cmds) {
  const out = [];
  for (const cmd of cmds) out.push(await env.step(cmd));
  return out;
}

const ruleIds = (findings) => findings.map((f) => f.ruleId).sort();

describe('ScreenReaderEnv', () => {
  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  describe('lifecycle', () => {
    it('starts the virtual screen reader at the document', async () => {
      await withEnv('good-modal.html', {}, async (env) => {
        expect(env.stepCount).toBe(0);
        expect(env.trace).toEqual([]);
        expect(env.recentPhrases).toEqual(['document']);
      });
    }, 60000);

    it('rejects step() before start()', async () => {
      const page = await getPage(`${getBaseUrl()}/agent/good-modal.html`);
      const env = new ScreenReaderEnv(page);
      await expect(env.step({ type: 'next' })).rejects.toThrow('before start()');
      await page.close();
    }, 60000);
  });

  describe('reading commands', () => {
    it('next / prev walk the reading order and are reversible', async () => {
      await withEnv('bad-icon-buttons.html', {}, async (env) => {
        const a = await env.step({ type: 'next' });
        const b = await env.step({ type: 'next' });
        expect(a.phrase).toBe('banner');
        expect(b.phrase).toContain('heading');
        const back = await env.step({ type: 'prev' });
        expect(back.phrase).toBe(a.phrase);
        expect(env.stepCount).toBe(3);
      });
    }, 60000);

    it('tab / shiftTab move real keyboard focus', async () => {
      await withEnv('good-modal.html', {}, async (env) => {
        const first = await env.step({ type: 'tab' });
        expect(first.focus).toEqual({
          role: 'button',
          name: 'Open settings',
          selector: '#open',
        });
        expect(first.phrase).toBe('button, Open settings');

        const second = await env.step({ type: 'tab' });
        expect(second.focus.selector).toBe('#after-link');

        const back = await env.step({ type: 'shiftTab' });
        expect(back.focus.selector).toBe('#open');
      });
    }, 60000);

    it('done is recorded without changing the page', async () => {
      await withEnv('good-modal.html', {}, async (env) => {
        await env.step({ type: 'next' });
        const obs = await env.step({ type: 'done' });
        expect(obs.error).toBeUndefined();
        expect(obs.urlChanged).toBe(false);
        expect(env.trace[env.trace.length - 1].cmd.type).toBe('done');
      });
    }, 60000);

    it('observations carry the full documented shape', async () => {
      await withEnv('good-status-form.html', {}, async (env) => {
        const obs = await env.step({ type: 'next' });
        expect(Object.keys(obs).sort()).toEqual(
          [
            'announcements',
            'budgetLeft',
            'focus',
            'phrase',
            'rotor',
            'step',
            'url',
            'urlChanged',
          ].sort()
        );
        expect(typeof obs.phrase).toBe('string');
        expect(Array.isArray(obs.announcements)).toBe(true);
        expect(obs.rotor).toBeNull();
        expect(obs.url).toContain('good-status-form.html');
      });
    }, 60000);
  });

  describe('rotor lists and jumpTo', () => {
    it('returns headings, landmarks, links and form fields', async () => {
      await withEnv('good-status-form.html', {}, async (env) => {
        const headings = await env.step({ type: 'headings' });
        expect(headings.rotor.kind).toBe('headings');
        expect(headings.rotor.items.length).toBe(1);
        expect(headings.rotor.items[0]).toMatchObject({ index: 0 });
        expect(headings.rotor.items[0].phrase).toContain('Contact form');

        const landmarks = await env.step({ type: 'landmarks' });
        expect(landmarks.rotor.kind).toBe('landmarks');
        expect(landmarks.rotor.items.map((i) => i.selector)).toEqual(
          expect.arrayContaining(['html > body > header', 'html > body > main'])
        );

        const fields = await env.step({ type: 'formFields' });
        expect(fields.rotor.items.map((i) => i.selector)).toEqual(['#msg']);

        const links = await env.step({ type: 'links' });
        expect(links.rotor.kind).toBe('links');
        expect(links.rotor.items).toEqual([]);
      });
    }, 60000);

    it('lists links and jumps the cursor onto one', async () => {
      await withEnv('nav-source.html', {}, async (env) => {
        const links = await env.step({ type: 'links' });
        expect(links.rotor.items).toEqual([
          { index: 0, phrase: 'link, Go to the target page', selector: '#go' },
        ]);
        const jumped = await env.step({ type: 'jumpTo', arg: 0 });
        expect(jumped.phrase).toBe('link, Go to the target page');
        expect(jumped.error).toBeUndefined();
      });
    }, 60000);

    it('reports an out-of-range jumpTo and a jumpTo without a rotor list', async () => {
      await withEnv('nav-source.html', {}, async (env) => {
        const noList = await env.step({ type: 'jumpTo', arg: 0 });
        expect(noList.error).toMatch(/preceding rotor command/);

        await env.step({ type: 'links' });
        const bad = await env.step({ type: 'jumpTo', arg: 7 });
        expect(bad.error).toMatch(/out of range/);
        expect(env.stepCount).toBe(3);
      });
    }, 60000);
  });

  describe('rotor stepping (NVDA quick navigation)', () => {
    it('steps through headings in reading order and wraps around', async () => {
      await withEnv('generic-home.html', {}, async (env) => {
        const h1 = await env.step({ type: 'nextHeading' });
        expect(h1.phrase).toBe('heading, Welcome to the Mini Site, level 1');
        const h2 = await env.step({ type: 'nextHeading' });
        expect(h2.phrase).toBe('heading, Send us a message, level 2');
        // Only two headings on the page -> the third step wraps to the first.
        const wrapped = await env.step({ type: 'nextHeading' });
        expect(wrapped.phrase).toBe(h1.phrase);
        const back = await env.step({ type: 'prevHeading' });
        expect(back.phrase).toBe(h2.phrase);
        expect(env.stepCount).toBe(4);
        for (const obs of [h1, h2, wrapped, back]) expect(obs.error).toBeUndefined();
      });
    }, 60000);

    it('steps through links, form fields and landmarks', async () => {
      await withEnv('generic-home.html', {}, async (env) => {
        const link = await env.step({ type: 'nextLink' });
        expect(link.phrase).toBe('link, Log in');
        expect(await env.step({ type: 'nextLink' }).then((o) => o.phrase)).toBe('link, Home');
        expect(await env.step({ type: 'prevLink' }).then((o) => o.phrase)).toBe('link, Log in');

        const field = await env.step({ type: 'nextFormField' });
        expect(field.phrase).toBe('searchbox, Search the site');
        const nextField = await env.step({ type: 'nextFormField' });
        expect(nextField.phrase).toBe('textbox, Name');

        const landmark = await env.step({ type: 'nextLandmark' });
        expect(landmark.error).toBeUndefined();
        // A landmark, never the "end of ..." boundary of the enclosing one.
        expect(landmark.phrase).not.toMatch(/^end of/i);
      });
    }, 60000);

    it('steps only onto elements the matching rotor list also contains', async () => {
      await withEnv('generic-home.html', {}, async (env) => {
        const rotor = await env.step({ type: 'headings' });
        const listed = rotor.rotor.items.map((i) => i.phrase);
        const first = await env.step({ type: 'nextHeading' });
        const second = await env.step({ type: 'nextHeading' });
        expect(listed).toContain(first.phrase);
        expect(listed).toContain(second.phrase);
      });
    }, 60000);

    it('reports "no <kind>" when the document has none, and still costs a step', async () => {
      await withEnv('good-status-form.html', {}, async (env) => {
        const noLink = await env.step({ type: 'nextLink' });
        expect(noLink.error).toBe('no link');
        expect(noLink.step).toBe(1);
        expect(env.stepCount).toBe(1);

        const noLinkBack = await env.step({ type: 'prevLink' });
        expect(noLinkBack.error).toBe('no link');
        expect(env.stepCount).toBe(2);

        // The kinds that do exist here still work.
        expect(await env.step({ type: 'nextHeading' }).then((o) => o.error)).toBeUndefined();
        expect(await env.step({ type: 'nextFormField' }).then((o) => o.error)).toBeUndefined();
      });
    }, 60000);

    it('leaves the cursor untouched when there is no such element', async () => {
      await withEnv('good-status-form.html', {}, async (env) => {
        const before = await env.step({ type: 'nextHeading' });
        const failed = await env.step({ type: 'nextLink' });
        expect(failed.error).toBe('no link');
        expect(failed.phrase).toBe(before.phrase);
      });
    }, 60000);

    it('does not disturb the rotor list a later jumpTo uses', async () => {
      await withEnv('generic-home.html', {}, async (env) => {
        const links = await env.step({ type: 'links' });
        const target = links.rotor.items[2];
        await env.step({ type: 'nextHeading' });
        const jumped = await env.step({ type: 'jumpTo', arg: target.index });
        expect(jumped.error).toBeUndefined();
        expect(jumped.phrase).toBe(target.phrase);
      });
    }, 60000);
  });

  describe('repeat (free command)', () => {
    it('re-emits the last phrase without consuming a step or budget', async () => {
      await withEnv('generic-home.html', { maxSteps: 3 }, async (env) => {
        const heard = await env.step({ type: 'nextHeading' });
        expect(env.stepCount).toBe(1);
        expect(env.budgetLeft).toBe(2);

        const again = await env.step({ type: 'repeat' });
        expect(again.free).toBe(true);
        expect(again.phrase).toBe(heard.phrase);
        expect(again.error).toBeUndefined();
        expect(again.step).toBe(1);
        expect(again.budgetLeft).toBe(2);
        expect(env.stepCount).toBe(1);
      });
    }, 60000);

    it('records a trace entry flagged free:true and keeps the phrase memory clean', async () => {
      await withEnv('generic-home.html', {}, async (env) => {
        await env.step({ type: 'nextHeading' });
        const before = env.recentPhrases.slice();
        await env.step({ type: 'repeat' });
        await env.step({ type: 'repeat' });
        expect(env.recentPhrases).toEqual(before);
        expect(env.trace).toHaveLength(3);
        expect(env.trace.filter((e) => e.free === true)).toHaveLength(2);
        expect(env.trace[1].cmd).toEqual({ type: 'repeat', arg: undefined });
        expect(env.trace[1].step).toBe(1);
        expect(env.trace[1].domChanged).toBe(false);
      });
    }, 60000);

    it('still works once the step budget is exhausted', async () => {
      await withEnv('generic-home.html', { maxSteps: 1 }, async (env) => {
        const heard = await env.step({ type: 'nextHeading' });
        const refused = await env.step({ type: 'next' });
        expect(refused.error).toBe('step budget exhausted');

        const again = await env.step({ type: 'repeat' });
        expect(again.free).toBe(true);
        expect(again.phrase).toBe(heard.phrase);
      });
    }, 60000);
  });

  describe('typing and activation', () => {
    it('types into the field under the cursor', async () => {
      await withEnv('good-status-form.html', {}, async (env, page) => {
        await env.step({ type: 'formFields' });
        await env.step({ type: 'jumpTo', arg: 0 });
        const typed = await env.step({ type: 'type', arg: 'hello there' });
        expect(typed.error).toBeUndefined();
        expect(typed.phrase).toContain('hello there');
        expect(await page.$eval('#msg', (el) => el.value)).toBe('hello there');
      });
    }, 60000);

    it('refuses to type when the cursor is not on a text field', async () => {
      await withEnv('good-status-form.html', {}, async (env) => {
        await env.step({ type: 'headings' });
        await env.step({ type: 'jumpTo', arg: 0 });
        const typed = await env.step({ type: 'type', arg: 'nope' });
        expect(typed.error).toMatch(/not on a text field/);
      });
    }, 60000);

    it('activate on a link navigates and the env re-injects itself', async () => {
      await withEnv('nav-source.html', {}, async (env, page) => {
        await env.step({ type: 'links' });
        await env.step({ type: 'jumpTo', arg: 0 });
        const nav = await env.step({ type: 'activate' });

        expect(nav.urlChanged).toBe(true);
        expect(nav.url).toContain('nav-target.html');
        expect(page.url()).toContain('nav-target.html');
        // cursor re-attached at document start on the new page
        expect(nav.phrase).toBe('document');

        const after = await env.step({ type: 'next' });
        expect(after.phrase).toBe('banner');
        const heading = await env.step({ type: 'next' });
        expect(heading.phrase).toContain('Target page');
      });
    }, 60000);

    it('announces the document title after activating a link to another page', async () => {
      await withEnv('nav-source.html', {}, async (env) => {
        await env.step({ type: 'links' });
        await env.step({ type: 'jumpTo', arg: 0 });
        const nav = await env.step({ type: 'activate' });

        expect(nav.urlChanged).toBe(true);
        expect(nav.announcements[0]).toBe('page loaded: Target page');
        // The announcement rides on the same observation and costs no extra step.
        expect(nav.step).toBe(3);
        expect(env.stepCount).toBe(3);
      });
    }, 60000);

    it('reports live-region announcements after submitting an accessible form', async () => {
      await withEnv('good-status-form.html', {}, async (env) => {
        await env.step({ type: 'formFields' });
        await env.step({ type: 'jumpTo', arg: 0 });
        await env.step({ type: 'type', arg: 'hello' });
        await env.step({ type: 'tab' });
        const submitted = await env.step({ type: 'activate' });
        expect(submitted.announcements).toContain('Thank you, your message was sent.');
      });
    }, 60000);

    it('reports no announcement when the form updates silently', async () => {
      await withEnv('bad-status-form.html', {}, async (env) => {
        await env.step({ type: 'formFields' });
        await env.step({ type: 'jumpTo', arg: 0 });
        await env.step({ type: 'type', arg: 'hello' });
        await env.step({ type: 'tab' });
        const submitted = await env.step({ type: 'activate' });
        expect(submitted.announcements).toEqual([]);
      });
    }, 60000);

    it('escape closes an accessible dialog and returns focus to the trigger', async () => {
      await withEnv('good-modal.html', {}, async (env) => {
        await env.step({ type: 'tab' });
        const opened = await env.step({ type: 'activate' });
        expect(opened.focus.selector).toBe('#nickname');
        const closed = await env.step({ type: 'escape' });
        expect(closed.focus.selector).toBe('#open');
      });
    }, 60000);
  });

  describe('step counting and budget', () => {
    it('counts every command, including invalid ones, and tracks budgetLeft', async () => {
      await withEnv('bad-icon-buttons.html', { maxSteps: 4 }, async (env) => {
        const a = await env.step({ type: 'next' });
        expect(a.step).toBe(1);
        expect(a.budgetLeft).toBe(3);

        const bogus = await env.step({ type: 'not-a-command' });
        expect(bogus.error).toMatch(/unknown command/);
        expect(bogus.step).toBe(2);
        expect(env.stepCount).toBe(2);

        const jump = await env.step({ type: 'jumpTo', arg: 3 });
        expect(jump.error).toBeTruthy();
        expect(env.stepCount).toBe(3);

        await env.step({ type: 'next' });
        expect(env.budgetLeft).toBe(0);

        const refused = await env.step({ type: 'next' });
        expect(refused.error).toBe('step budget exhausted');
        expect(env.stepCount).toBe(4); // refused commands are not executed
      });
    }, 60000);

    it('records a trace entry per step with before/after and timing', async () => {
      await withEnv('good-modal.html', {}, async (env) => {
        await env.step({ type: 'tab' });
        await env.step({ type: 'activate' });
        expect(env.trace).toHaveLength(2);
        const entry = env.trace[1];
        expect(entry.step).toBe(2);
        expect(entry.cmd).toEqual({ type: 'activate', arg: undefined });
        expect(entry.obsBefore).toMatchObject({
          phrase: 'button, Open settings',
          focusSelector: '#open',
        });
        expect(entry.obsBefore.url).toContain('good-modal.html');
        expect(entry.obsAfter.phrase).toBe('textbox, Nickname');
        expect(entry.domChanged).toBe(true);
        expect(typeof entry.durationMs).toBe('number');
      });
    }, 60000);

    it('caps the phrase memory at phraseWindow', async () => {
      await withEnv('bad-icon-buttons.html', { phraseWindow: 3 }, async (env) => {
        await runAll(env, [{ type: 'next' }, { type: 'next' }, { type: 'next' }, { type: 'next' }]);
        expect(env.recentPhrases).toHaveLength(3);
        expect(env.recentPhrases[2]).toBe(env.trace[3].obsAfter.phrase);
      });
    }, 60000);
  });

  describe('deriveFindings', () => {
    it('finds nothing on the accessible modal', async () => {
      await withEnv('good-modal.html', {}, async (env) => {
        await runAll(env, [
          { type: 'tab' },
          { type: 'activate' },
          { type: 'tab' },
          { type: 'tab' },
          { type: 'tab' },
          { type: 'escape' },
        ]);
        expect(env.deriveFindings()).toEqual([]);
      });
    }, 60000);

    it('escape-does-not-close and focus-lost on the broken modal', async () => {
      await withEnv('bad-modal.html', {}, async (env) => {
        await runAll(env, [
          { type: 'tab' },
          { type: 'activate' }, // opens the dialog, focus lands on "Close dialog"
          { type: 'escape' }, // ignored by the page
          { type: 'activate' }, // closes the dialog and blurs
        ]);
        const ids = ruleIds(env.deriveFindings());
        expect(ids).toContain('escape-does-not-close');
        expect(ids).toContain('focus-lost');
      });
    }, 60000);

    it('dialog-not-trapped on the broken modal', async () => {
      await withEnv('bad-modal.html', {}, async (env) => {
        await runAll(env, [
          { type: 'tab' },
          { type: 'activate' }, // focus inside the dialog
          { type: 'tab' }, // walks straight out of it
        ]);
        const findings = env.deriveFindings();
        expect(ruleIds(findings)).toContain('dialog-not-trapped');
        const f = findings.find((x) => x.ruleId === 'dialog-not-trapped');
        expect(f.nodes[0].selector).toBe('#dialog');
        expect(f.wcagCriteria).toEqual(['2.4.3']);
      });
    }, 60000);

    it('unannounced-change on the silent form but not on the announcing one', async () => {
      const bad = await withEnv('bad-status-form.html', {}, async (env) => {
        await runAll(env, [
          { type: 'formFields' },
          { type: 'jumpTo', arg: 0 },
          { type: 'type', arg: 'hello' },
          { type: 'tab' },
          { type: 'activate' },
        ]);
        return env.deriveFindings();
      });
      expect(ruleIds(bad)).toContain('unannounced-change');

      const good = await withEnv('good-status-form.html', {}, async (env) => {
        await runAll(env, [
          { type: 'formFields' },
          { type: 'jumpTo', arg: 0 },
          { type: 'type', arg: 'hello' },
          { type: 'tab' },
          { type: 'activate' },
        ]);
        return env.deriveFindings();
      });
      expect(ruleIds(good)).not.toContain('unannounced-change');
    }, 120000);

    it('unnamed-control-used on unnamed icon buttons but not on named ones', async () => {
      const bad = await withEnv('bad-icon-buttons.html', {}, async (env) => {
        await runAll(env, [{ type: 'tab' }, { type: 'activate' }]);
        return env.deriveFindings();
      });
      const unnamed = bad.find((f) => f.ruleId === 'unnamed-control-used');
      expect(unnamed).toBeTruthy();
      expect(unnamed.nodes[0].selector).toBe('#b1');
      expect(unnamed.nodes[0].phrase).toBe('button');

      const good = await withEnv('good-modal.html', {}, async (env) => {
        await runAll(env, [{ type: 'tab' }, { type: 'activate' }]);
        return env.deriveFindings();
      });
      expect(ruleIds(good)).not.toContain('unnamed-control-used');
    }, 120000);

    it('activation-no-effect: the dead button is flagged, the live one is not', async () => {
      const dead = await withEnv('activation-no-effect.html', {}, async (env) => {
        await env.step({ type: 'tab' }); // focus lands on the dead button
        const act = await env.step({ type: 'activate' });
        expect(act.urlChanged).toBe(false);
        expect(act.announcements).toEqual([]);
        expect(act.newPage).toBeUndefined();
        return env.deriveFindings();
      });
      const f = dead.find((x) => x.ruleId === 'activation-no-effect');
      expect(f).toBeTruthy();
      expect(f.nodes[0].selector).toBe('#dead-button');
      expect(f.type).toBe('activation-no-effect');
      expect(f.wcagCriteria).toEqual(['4.1.2', '3.2.2']);
      expect(f.description).toMatch(/no perceivable result/);

      const live = await withEnv('activation-no-effect.html', {}, async (env) => {
        await runAll(env, [{ type: 'tab' }, { type: 'tab' }, { type: 'tab' }]);
        await env.step({ type: 'activate' }); // the button that fills in the phone number
        return env.deriveFindings();
      });
      expect(ruleIds(live)).not.toContain('activation-no-effect');
    }, 120000);

    it('announces a link that opens a new window and does not call that a dead control', async () => {
      await withEnv('activation-no-effect.html', {}, async (env, page) => {
        await env.step({ type: 'links' });
        await env.step({ type: 'jumpTo', arg: 0 });
        const act = await env.step({ type: 'activate' });

        expect(act.newPage).toBeTruthy();
        expect(act.newPage.url).toContain('generic-thanks.html');
        expect(act.announcements.some((a) => /^opens in new window: /.test(a))).toBe(true);
        // The measurement stays on the original page and the popup is closed again.
        expect(act.urlChanged).toBe(false);
        expect(page.url()).toContain('activation-no-effect.html');
        expect(env.trace.at(-1).obsAfter.newPage.url).toContain('generic-thanks.html');
        expect(ruleIds(env.deriveFindings())).not.toContain('activation-no-effect');
      });
    }, 120000);

    it('produces findings shaped like scanner violations', async () => {
      const findings = await withEnv('bad-icon-buttons.html', {}, async (env) => {
        await runAll(env, [{ type: 'tab' }, { type: 'activate' }]);
        return env.deriveFindings();
      });
      const {
        normalizeSeverity,
        severityWeight,
        isHardViolation,
        ruleKey,
      } = require('../../src/core/severity');
      expect(findings.length).toBeGreaterThan(0);
      for (const f of findings) {
        expect(f.scannerId).toBe('sr-agent-env');
        expect(typeof f.ruleId).toBe('string');
        expect(f.type).toBe(f.ruleId);
        expect(typeof f.description).toBe('string');
        expect(Array.isArray(f.nodes)).toBe(true);
        expect(f.helpUrl).toMatch(/^https:\/\/www\.w3\.org\//);
        expect(Array.isArray(f.wcagCriteria)).toBe(true);
        expect(['critical', 'serious', 'moderate', 'minor', 'best-practice', 'info']).toContain(
          normalizeSeverity(f)
        );
        expect(ruleKey(f)).toBe(f.ruleId);
        expect(isHardViolation(f)).toBe(true);
        expect(severityWeight(f)).toBeGreaterThan(0);
      }
    }, 60000);
  });

  describe('reading fragmentation', () => {
    it('flags a single line of text that is spoken as several phrases', async () => {
      const report = await withEnv('reading-fragmentation.html', {}, async (env) =>
        env.checkReadingFragmentation()
      );
      const byId = new Map(report.elements.map((e) => [e.selector, e]));
      const heading = byId.get('#fragmented-heading');
      expect(heading.count).toBe(5);
      expect(heading.flagged).toBe(true);
      expect(heading.phrases).toEqual([
        'Information gem.',
        '§ 5',
        'ECG undOffenlegung gem.',
        '§ 25',
        'MedienG',
      ]);
      expect(byId.get('#fragmented-paragraph').flagged).toBe(true);
    }, 60000);

    it('leaves clean blocks and a heading that merely contains a link alone', async () => {
      const report = await withEnv('reading-fragmentation.html', {}, async (env) =>
        env.checkReadingFragmentation()
      );
      const flagged = report.elements.filter((e) => e.flagged).map((e) => e.selector);
      expect(flagged).toEqual(['#fragmented-heading', '#fragmented-paragraph']);
      // The clean paragraph is one phrase; the link inside <h3> is a node by design.
      const byId = new Map(report.elements.map((e) => [e.selector, e]));
      expect(byId.get('#clean-paragraph').count).toBe(1);
      expect(byId.has('#heading-with-link')).toBe(true);
      expect(byId.get('#heading-with-link').count).toBe(1);
      // Boundary phrases ("paragraph", "end of heading, ...") never count.
      expect(report.elements.every((e) => !e.phrases.some((p) => /^end of/.test(p)))).toBe(true);
    }, 60000);

    it('reports it as a finding with the fragmented phrases as the example', async () => {
      const findings = await withEnv('reading-fragmentation.html', {}, async (env) => {
        await env.checkReadingFragmentation();
        return env.deriveFindings();
      });
      const frag = findings.filter((f) => f.ruleId === 'reading-fragmentation');
      expect(frag.length).toBe(2);
      expect(frag[0].wcagCriteria).toEqual(['1.3.1', '1.3.2']);
      expect(frag[0].severity).toBe('moderate');
      expect(frag[0].scannerId).toBe('sr-agent-env');
      expect(frag[0].type).toBe('reading-fragmentation');
      expect(frag[0].description).toContain('"Information gem." / "§ 5"');
      expect(frag[0].nodes[0].selector).toBe('#fragmented-heading');
      expect(frag[0].meta.fragments).toBe(5);
    }, 60000);

    it('reports nothing on a page whose text is spoken as whole blocks', async () => {
      const findings = await withEnv('generic-contact.html', {}, async (env) => {
        await env.checkReadingFragmentation();
        return env.deriveFindings();
      });
      expect(findings.filter((f) => f.ruleId === 'reading-fragmentation')).toEqual([]);
    }, 60000);

    it('caches the analysis per URL', async () => {
      await withEnv('reading-fragmentation.html', {}, async (env, page) => {
        const a = await env.checkReadingFragmentation();
        const spy = [];
        const original = page.evaluate.bind(page);
        page.evaluate = (...args) => {
          spy.push(1);
          return original(...args);
        };
        const b = await env.checkReadingFragmentation();
        expect(b).toBe(a);
        expect(spy.length).toBe(0);
      });
    }, 60000);
  });

  describe('fragmentationFindings (page level)', () => {
    const { fragmentationFindings } = require('../../src/agent/screenreader-env');

    it('adds a page-level finding when the whole page averages >= 2.5 phrases', () => {
      const findings = fragmentationFindings({
        url: 'http://x/',
        elementCount: 12,
        fragmentCount: 36,
        ratio: 3,
        pageFlagged: true,
        elements: [
          { selector: '#a', tag: 'p', count: 4, phrases: ['a', 'b', 'c', 'd'], flagged: false },
          { selector: '#b', tag: 'p', count: 3, phrases: ['e', 'f', 'g'], flagged: false },
        ],
      });
      expect(findings.length).toBe(1);
      expect(findings[0].meta.scope).toBe('page');
      expect(findings[0].description).toContain('3.0 per element');
      expect(findings[0].nodes.map((n) => n.selector)).toEqual(['#a', '#b']);
    });

    it('reports at most five elements of one page', () => {
      const elements = Array.from({ length: 9 }, (_, i) => ({
        selector: `#e${i}`,
        tag: 'p',
        count: 3,
        phrases: ['a', 'b', 'c'],
        flagged: true,
      }));
      const findings = fragmentationFindings({
        url: 'http://x/',
        elementCount: 9,
        fragmentCount: 27,
        ratio: 3,
        pageFlagged: false,
        elements,
      });
      expect(findings.length).toBe(5);
    });

    it('returns nothing for a clean page', () => {
      expect(
        fragmentationFindings({ url: 'http://x/', elements: [], pageFlagged: false, ratio: 0 })
      ).toEqual([]);
    });
  });
});
