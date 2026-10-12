// Runs one check at an app's root, as CI does: `node checks/cli.js <check>`.
// Each problem becomes an error annotation and each warning a warning
// annotation, on the file it's about, and both go into the job summary.
// Exits 1 when the check finds a problem.

import { existsSync, readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { checkPassport } from './passport.js';
import { checkLicense } from './license.js';
import { checkTier } from './tier.js';
import { checkFiles } from './files.js';

const CHECKS = {
  passport: { title: 'Passport', run: runPassport },
  license: { title: 'License', run: runLicense },
  tier: { title: 'Tier', run: runTier },
  files: { title: 'Governance files', run: runFiles },
};

const name = process.argv[2];
const check = CHECKS[name];
if (!check) {
  console.error(`usage: node checks/cli.js <${Object.keys(CHECKS).join('|')}>`);
  process.exit(2);
}

const { file, problems, warnings } = check.run();
report(check.title, file, problems, warnings);
process.exitCode = problems.length > 0 ? 1 : 0;

function runPassport() {
  const file = 'PASSPORT.yml';
  if (!existsSync(file)) {
    return {
      file,
      problems: ['This repository has no PASSPORT.yml at its root. Every Choreo app needs one: ask the Choreo plugin to write it, or contact Platform Engineering.'],
      warnings: [],
    };
  }
  const result = checkPassport(readFileSync(file, 'utf8'));
  return { file, problems: result.problems.map((p) => p.message), warnings: [] };
}

function runLicense() {
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'].find((path) => existsSync(path));
  const passport = readPassport();
  if (passport.problem) return { file: 'PASSPORT.yml', problems: [passport.problem], warnings: [] };
  const result = checkLicense({
    licenseText: file ? readFileSync(file, 'utf8') : null,
    passportLicense: passport.value.license,
  });
  return { file: file ?? 'PASSPORT.yml', ...result };
}

function runTier() {
  const passport = readPassport();
  if (passport.problem) return { file: 'PASSPORT.yml', problems: [passport.problem], warnings: [] };
  const containerfile = ['Containerfile', 'Dockerfile'].find((path) => existsSync(path));
  const result = checkTier({
    tier: passport.value.profile?.tier,
    paths: listFiles('.'),
    containerfile: containerfile ? readFileSync(containerfile, 'utf8') : null,
  });
  return { file: containerfile ?? 'PASSPORT.yml', ...result };
}

function runFiles() {
  const hashes = JSON.parse(readFileSync(new URL('../canonical/hashes.json', import.meta.url), 'utf8'));
  const files = Object.fromEntries(
    ['AGENTS.md', 'CLAUDE.md'].map((path) => [path, existsSync(path) ? readFileSync(path, 'utf8') : null]),
  );
  const result = checkFiles({ files, hashes });
  const edited = Object.keys(files).find((path) => result.problems.some((p) => p.includes(`\`${path}\``)));
  return { file: edited ?? 'AGENTS.md', ...result };
}

// The license and tier checks read the passport too. They need only that it
// parses; the passport check reports anything else wrong with it.
function readPassport() {
  if (!existsSync('PASSPORT.yml')) {
    return { problem: 'This check reads PASSPORT.yml, and the repository has none. Fix the passport check first.' };
  }
  const doc = parseDocument(readFileSync('PASSPORT.yml', 'utf8'), { schema: 'yaml-1.1' });
  const value = doc.errors.length === 0 ? doc.toJS() : null;
  if (value === null || typeof value !== 'object') {
    return { problem: 'This check reads PASSPORT.yml, which can\'t be read. Fix the passport check first.' };
  }
  return { value };
}

// Every file under the app's root, as repository paths, skipping
// dependencies and git's own files.
function listFiles(root) {
  const skip = new Set(['.git', 'node_modules']);
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(root, path).split('\\').join('/'));
    }
  };
  walk(root);
  return out;
}

function report(title, file, problems, warnings) {
  for (const message of problems) console.log(`::error file=${file},title=${title}::${escape(message)}`);
  for (const message of warnings) console.log(`::warning file=${file},title=${title}::${escape(message)}`);

  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const heading = problems.length === 0
    ? `### ${title} check passed${warnings.length ? `, with ${count(warnings.length, 'warning')}` : ''}`
    : `### ${title} check found ${count(problems.length, 'problem')}`;
  const lines = [...problems.map((m) => `- ${m}`), ...warnings.map((m) => `- Warning: ${m}`)];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${heading}\n\n${lines.join('\n')}\n`);
}

// GitHub workflow commands end at a newline, so these characters are encoded.
function escape(text) {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}
