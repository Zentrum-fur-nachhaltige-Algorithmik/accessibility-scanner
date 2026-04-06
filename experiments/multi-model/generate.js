#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Config ──────────────────────────────────────────────────────────────────

const MODELS = [
  'google/gemini-3.1-flash-lite-preview',
  'google/gemma-4-31b-it',
  'qwen/qwen3.6-plus:free',
  'minimax/minimax-m2.7',
  'moonshotai/kimi-k2.5',
  'z-ai/glm-5-turbo',
];

const MATRIX = [
  { tech: 'html',    css: 'tailwind', page: 'form' },
  { tech: 'react',   css: 'tailwind', page: 'form' },
  { tech: 'vue',     css: 'tailwind', page: 'form' },
  { tech: 'svelte',  css: 'tailwind', page: 'form' },
  { tech: 'angular', css: 'tailwind', page: 'form' },
];

const ROOT = path.resolve(__dirname, '../..');
const SKILL_DIR = path.join(ROOT, '.claude/skills/a11y-code');
const OUTPUT_DIR = path.join(__dirname, 'generated');
const METADATA_DIR = path.join(__dirname, 'metadata');

const MAX_TOKENS = 16384;
const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 2;

// ── Load .env ───────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) throw new Error('.env file not found at ' + envPath);
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

// ── Skill Loader ────────────────────────────────────────────────────────────

function stripFrontmatter(md) {
  const match = md.match(/^---\n[\s\S]*?\n---\n/);
  return match ? md.slice(match[0].length).trim() : md.trim();
}

function loadSkillContent(tech) {
  const skillMd = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const commonPatterns = fs.readFileSync(path.join(SKILL_DIR, 'references/common-patterns.md'), 'utf8');

  let content = stripFrontmatter(skillMd) + '\n\n---\n\n' + commonPatterns;

  // Framework-specific references
  if (tech === 'react') {
    const reactMd = fs.readFileSync(path.join(SKILL_DIR, 'references/react.md'), 'utf8');
    content += '\n\n---\n\n' + reactMd;
  } else if (tech === 'vue') {
    const vueMd = fs.readFileSync(path.join(SKILL_DIR, 'references/vue.md'), 'utf8');
    content += '\n\n---\n\n' + vueMd;
  }

  return content;
}

// ── Prompt Builder ──────────────────────────────────────────────────────────

const TECH_DESCRIPTIONS = {
  html:    'Pure HTML (no framework)',
  react:   'React 18 via CDN (unpkg: react + react-dom + babel standalone)',
  vue:     'Vue 3 via CDN (unpkg)',
  svelte:  'Compiled Svelte output — vanilla JS with reactive patterns',
  angular: 'Compiled Angular output — vanilla JS with Angular-like patterns',
};

const PAGE_DESCRIPTIONS = {
  form: 'Contact/registration form with: name, email, phone, company, message textarea, dropdown (e.g. department or subject), checkbox for terms, submit button. Include proper validation with error states, required field indicators, and success feedback.',
};

function buildUserPrompt({ tech, css, page }) {
  return `Generate a single, self-contained HTML file for a **${page}** page.

**Technology:** ${TECH_DESCRIPTIONS[tech]}
**CSS Framework:** ${css === 'tailwind' ? 'Tailwind CSS via CDN (cdn.tailwindcss.com)' : css === 'bootstrap' ? 'Bootstrap 5 via CDN (cdn.jsdelivr.net)' : 'Vanilla CSS in a <style> tag'}

**Page requirements:**
${PAGE_DESCRIPTIONS[page]}

**Technical requirements:**
- The file must be completely self-contained (all HTML, CSS, and JS inline)
- Must work standalone when opened directly in a browser
- Must be fully accessible following WCAG 2.2 AA
- Include proper semantic HTML, ARIA attributes, keyboard navigation, focus management
- Include a skip link, proper heading hierarchy, landmarks (header, nav, main, footer)
- All form inputs must have visible labels, proper error handling, and autocomplete attributes

**Output:** Return ONLY the HTML file content. No explanations, no markdown fences — just the raw HTML starting with <!DOCTYPE html>.`;
}

// ── OpenRouter API ──────────────────────────────────────────────────────────

function callOpenRouter(model, systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: MAX_TOKENS,
    });

    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://github.com/a11y-experiment',
        'X-Title': 'a11y-skill-experiment',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(`API error: ${json.error.message || JSON.stringify(json.error)}`));
            return;
          }
          const content = json.choices?.[0]?.message?.content;
          if (!content) {
            reject(new Error(`No content in response: ${data.slice(0, 500)}`));
            return;
          }
          resolve({
            content,
            promptTokens: json.usage?.prompt_tokens || 0,
            completionTokens: json.usage?.completion_tokens || 0,
          });
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}\nBody: ${data.slice(0, 500)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callWithRetry(model, systemPrompt, userPrompt) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callOpenRouter(model, systemPrompt, userPrompt);
    } catch (err) {
      const isRetryable = /429|5\d\d|ECONNRESET|ETIMEDOUT/.test(err.message);
      if (!isRetryable || attempt === MAX_RETRIES) throw err;
      const delay = RETRY_DELAY_MS * (attempt + 1);
      console.log(`  ⚠ Attempt ${attempt + 1} failed (${err.message.slice(0, 80)}), retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ── HTML Extraction ─────────────────────────────────────────────────────────

function extractHTML(content) {
  // Strip markdown code fences if present
  const fenceMatch = content.match(/```(?:html)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // If it starts with <!DOCTYPE or <html, use as-is
  const trimmed = content.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<!doctype')) {
    return trimmed;
  }

  // Try to find HTML block anywhere in content
  const htmlMatch = content.match(/(<!DOCTYPE[\s\S]*<\/html>)/i);
  if (htmlMatch) return htmlMatch[1].trim();

  // Return raw content — let validation catch issues
  return trimmed;
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateHTML(html) {
  const issues = [];
  if (!/<!DOCTYPE\s+html/i.test(html)) issues.push('missing DOCTYPE');
  if (!/<\/html>/i.test(html)) issues.push('missing closing </html>');
  if (html.length < 1000) issues.push(`suspiciously small (${html.length} chars)`);
  if (!/<html[^>]*lang=/i.test(html)) issues.push('missing lang attribute');
  return issues;
}

// ── Model Slug ──────────────────────────────────────────────────────────────

function modelSlug(modelId) {
  // google/gemini-3.1-flash-lite-preview -> gemini-3.1-flash-lite
  // qwen/qwen3.6-plus:free -> qwen3.6-plus
  return modelId
    .replace(/^[^/]+\//, '')   // remove provider prefix
    .replace(/:.*$/, '')       // remove :variant suffix
    .replace(/-preview$/, ''); // remove -preview suffix
}

// ── Orchestrator ────────────────────────────────────────────────────────────

async function main() {
  loadEnv();

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not set in .env');
  }

  // Allow filtering models via CLI arg
  const filterModel = process.argv[2];
  const models = filterModel
    ? MODELS.filter(m => m.includes(filterModel) || modelSlug(m).includes(filterModel))
    : MODELS;

  if (filterModel && models.length === 0) {
    throw new Error(`No model matching "${filterModel}". Available: ${MODELS.map(modelSlug).join(', ')}`);
  }

  console.log(`\n=== Multi-Model A11y Experiment ===`);
  console.log(`Models: ${models.length} | Pages per model: ${MATRIX.length} | Total: ${models.length * MATRIX.length}\n`);

  const allResults = [];

  for (const model of models) {
    const slug = modelSlug(model);
    console.log(`\n── ${model} (${slug}) ──`);

    const modelMeta = {
      model,
      slug,
      timestamp: new Date().toISOString(),
      pages: [],
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      errors: [],
    };

    for (const combo of MATRIX) {
      const { tech, css, page } = combo;
      const label = `${tech}-${css}/${page}`;
      process.stdout.write(`  ${label}... `);

      const outDir = path.join(OUTPUT_DIR, slug, `${tech}-${css}`);
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${page}.html`);

      try {
        const systemPrompt = loadSkillContent(tech);
        const userPrompt = buildUserPrompt(combo);
        const startTime = Date.now();

        const result = await callWithRetry(model, systemPrompt, userPrompt);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        const html = extractHTML(result.content);
        const issues = validateHTML(html);

        fs.writeFileSync(outFile, html, 'utf8');

        const pageResult = {
          tech, css, page,
          file: path.relative(__dirname, outFile),
          size: html.length,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          elapsed: parseFloat(elapsed),
          validationIssues: issues,
        };

        modelMeta.pages.push(pageResult);
        modelMeta.totalPromptTokens += result.promptTokens;
        modelMeta.totalCompletionTokens += result.completionTokens;

        const status = issues.length > 0 ? `⚠ ${issues.join(', ')}` : '✓';
        console.log(`${status} (${html.length} chars, ${result.promptTokens}+${result.completionTokens} tokens, ${elapsed}s)`);

      } catch (err) {
        const errMsg = err.message.slice(0, 200);
        console.log(`✗ ERROR: ${errMsg}`);
        modelMeta.errors.push({ tech, css, page, error: errMsg });
        modelMeta.pages.push({ tech, css, page, file: null, error: errMsg });
      }
    }

    // Write per-model metadata
    fs.writeFileSync(
      path.join(METADATA_DIR, `${slug}.json`),
      JSON.stringify(modelMeta, null, 2),
      'utf8'
    );

    allResults.push(modelMeta);
  }

  // ── Write summary ───────────────────────────────────────────────────────

  const summary = generateSummary(allResults);
  fs.writeFileSync(path.join(__dirname, 'generation-summary.md'), summary, 'utf8');
  console.log(`\n✓ Summary written to generation-summary.md`);
  console.log(`✓ Metadata written to metadata/\n`);
}

function generateSummary(results) {
  const lines = [
    '# Multi-Model A11y Experiment — Generation Summary',
    '',
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    `**Models:** ${results.length}`,
    `**Pages per model:** ${MATRIX.length}`,
    `**System prompt:** SKILL.md + common-patterns.md + framework-specific refs (no wcag2.2.md)`,
    '',
    '## Results',
    '',
    '| Model | Pages OK | Errors | Prompt Tokens | Completion Tokens | Validation Issues |',
    '|-------|----------|--------|---------------|-------------------|-------------------|',
  ];

  for (const r of results) {
    const ok = r.pages.filter(p => !p.error).length;
    const issues = r.pages.filter(p => p.validationIssues?.length > 0).length;
    lines.push(
      `| ${r.slug} | ${ok}/${MATRIX.length} | ${r.errors.length} | ${r.totalPromptTokens.toLocaleString()} | ${r.totalCompletionTokens.toLocaleString()} | ${issues} |`
    );
  }

  lines.push('');
  lines.push('## Per-Model Details');

  for (const r of results) {
    lines.push('', `### ${r.slug}`, '');
    lines.push('| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |');
    lines.push('|---------------|------|-----------------|------|--------|');
    for (const p of r.pages) {
      if (p.error) {
        lines.push(`| ${p.tech}-${p.css}/${p.page} | ERROR | — | — | ${p.error.slice(0, 60)} |`);
      } else {
        const issues = p.validationIssues?.length ? p.validationIssues.join(', ') : '—';
        lines.push(`| ${p.tech}-${p.css}/${p.page} | ${(p.size / 1024).toFixed(1)}KB | ${p.promptTokens}+${p.completionTokens} | ${p.elapsed}s | ${issues} |`);
      }
    }

    if (r.errors.length > 0) {
      lines.push('', '**Errors:**');
      for (const e of r.errors) {
        lines.push(`- ${e.tech}-${e.css}/${e.page}: ${e.error}`);
      }
    }
  }

  lines.push('', '## Next Steps', '', '1. Review generated HTML files in `generated/`');
  lines.push('2. Run scanner: adapt `scan-experiment.js` or create `scan.js` wrapper');
  lines.push('3. Compare results against Haiku baseline in `../haiku-a11y/results/`');

  return lines.join('\n');
}

// ── Run ─────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
