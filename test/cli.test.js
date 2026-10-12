import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../checks/cli.js', import.meta.url));
const fixture = (path) => fileURLToPath(new URL(path, import.meta.url));
const passport = readFileSync(fixture('../examples/passport/academic-deadlines.yml'), 'utf8');
const apache = fixture('./fixtures/licenses/Apache-2.0-github.txt');

// A minimal container app that passes every check this CLI runs.
const goodApp = {
  'PASSPORT.yml': passport,
  'AGENTS.md': readFileSync(fixture('./fixtures/app/AGENTS.md'), 'utf8'),
  'CLAUDE.md': readFileSync(fixture('./fixtures/app/CLAUDE.md'), 'utf8'),
  LICENSE: readFileSync(apache, 'utf8'),
  Containerfile: `FROM node:22-slim@sha256:${'a'.repeat(64)}\nUSER node\nHEALTHCHECK CMD true\n`,
  'app.vue': '<template><main /></template>\n',
};

// Runs one check in a fresh directory, the way CI runs it at an app's root.
function run(check, files = goodApp) {
  const dir = mkdtempSync(join(tmpdir(), 'choreo-'));
  for (const [path, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const summary = join(dir, '.summary.md');
  writeFileSync(summary, '');
  const result = spawnSync(process.execPath, [cli, check], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
  });
  const lines = result.stdout.split('\n');
  return {
    ...result,
    errors: lines.filter((line) => line.startsWith('::error ')),
    warnings: lines.filter((line) => line.startsWith('::warning ')),
    summary: readFileSync(summary, 'utf8'),
  };
}

const without = (path) => ({ ...goodApp, [path]: null });

for (const check of ['passport', 'license', 'tier', 'files']) {
  test(`${check}: a good app passes`, () => {
    const result = run(check);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(result.errors, []);
    assert.match(result.summary, /passed/);
  });
}

test('passport: a missing passport fails with an annotation on PASSPORT.yml', () => {
  const result = run('passport', without('PASSPORT.yml'));
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /^::error file=PASSPORT.yml,title=Passport::.*no PASSPORT\.yml/);
});

test('passport: each problem is one annotation and one summary line', () => {
  const broken = passport.replace('  tier: container', '  tier: swa') + 'colour: blue\n';
  const result = run('passport', { ...goodApp, 'PASSPORT.yml': broken });
  assert.equal(result.status, 1);
  assert.equal(result.errors.length, 2);
  assert.match(result.summary, /`profile.tier`/);
  assert.match(result.summary, /`colour`/);
});

test('license: a missing license fails', () => {
  const result = run('license', without('LICENSE'));
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /title=License::/);
});

test('license: a copyleft license passes with a warning', () => {
  const gpl = readFileSync(fixture('./fixtures/licenses/GPL-3.0.txt'), 'utf8');
  const result = run('license', {
    ...goodApp,
    LICENSE: gpl,
    'PASSPORT.yml': passport.replace('license: Apache-2.0', 'license: GPL-3.0'),
  });
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /^::warning file=LICENSE,title=License::/);
  assert.match(result.summary, /GPL-3.0/);
});

test('license: LICENSE.md is found as well as LICENSE', () => {
  const result = run('license', { ...without('LICENSE'), 'LICENSE.md': goodApp.LICENSE });
  assert.equal(result.status, 0, result.stdout);
});

test('tier: a container app without a Containerfile fails', () => {
  const result = run('tier', without('Containerfile'));
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /title=Tier::/);
});

test('tier: node_modules is not mistaken for app code', () => {
  const pages = passport
    .replace('  tier: container', '  tier: pages')
    .replace('  audience: campus', '  audience: public')
    .replace('  data_classification: internal', '  data_classification: public')
    .replace('roles: [viewer, registrar]', 'roles: []');
  const result = run('tier', {
    ...without('Containerfile'),
    'PASSPORT.yml': pages,
    'node_modules/some-package/server/index.js': 'module.exports = {};\n',
  });
  assert.equal(result.status, 0, result.stdout);
});

test('tier: an unreadable passport is reported, not crashed on', () => {
  const result = run('tier', { ...goodApp, 'PASSPORT.yml': 'app: [unclosed\n' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /passport/i);
});

test('files: an edited AGENTS.md fails with an annotation on it', () => {
  const result = run('files', { ...goodApp, 'AGENTS.md': goodApp['AGENTS.md'] + '\nMy own rule.\n' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /^::error file=AGENTS.md,title=Governance files::/);
});

test('an unknown check name exits 2 with usage', () => {
  const result = run('nonsense');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage/i);
});
