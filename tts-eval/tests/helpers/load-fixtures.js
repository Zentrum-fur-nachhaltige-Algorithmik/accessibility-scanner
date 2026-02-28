import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '..', 'fixtures');

export function loadTexFixture(name) {
  const filePath = path.join(fixturesDir, 'tex-snippets', `${name}.tex`);
  return fs.readFileSync(filePath, 'utf-8');
}

export function loadOcrSample(name) {
  const filePath = path.join(fixturesDir, 'ocr-samples', `${name}.md`);
  return fs.readFileSync(filePath, 'utf-8');
}

export function loadExpectedMathml(name) {
  const filePath = path.join(fixturesDir, 'expected-mathml', `${name}-expected.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function loadOcrResultSample() {
  const filePath = path.join(fixturesDir, 'ocr-result-sample.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function loadGtSample() {
  const filePath = path.join(fixturesDir, 'gt-sample.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
