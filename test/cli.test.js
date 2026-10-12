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
  '.github/CODEOWNERS': readFileSync(fixture('../canonical/CODEOWNERS'), 'utf8'),
};

// Runs one check in a fresh directory, the way CI runs it at an app's root.
function run(check, files = goodApp, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'choreo-'));
  for (const [path, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const summary = join(dir, '.summary.md');
  writeFileSync(summary, '');
  const output = join(dir, '.output.txt');
  writeFileSync(output, '');
  const result = spawnSync(process.execPath, [cli, check], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, ...resolveEnv(env, dir) },
  });
  const lines = result.stdout.split('\n');
  return {
    ...result,
    errors: lines.filter((line) => line.startsWith('::error ')),
    warnings: lines.filter((line) => line.startsWith('::warning ')),
    summary: readFileSync(summary, 'utf8'),
    output: readFileSync(output, 'utf8'),
  };
}

// Env values may name a file inside the app's directory with {dir}.
function resolveEnv(env, dir) {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.replace('{dir}', dir)]));
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

const gitleaksReport = readFileSync(fixture('./fixtures/reports/gitleaks.json'), 'utf8');

test('secrets: a clean report passes', () => {
  const result = run('secrets', { ...goodApp, '.gitleaks.json': '[]' }, { GITLEAKS_REPORT: '{dir}/.gitleaks.json' });
  assert.equal(result.status, 0, result.stdout);
});

test('secrets: each secret is an annotation on its own file and line', () => {
  const result = run('secrets', { ...goodApp, '.gitleaks.json': gitleaksReport }, { GITLEAKS_REPORT: '{dir}/.gitleaks.json' });
  assert.equal(result.status, 1);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /^::error file=config\.js,line=1,title=Secrets::/);
  assert.match(result.errors[1], /^::error file=server\/api\/slate\.ts,line=12,title=Secrets::/);
});

test('secrets: a missing report fails rather than passing silently', () => {
  const result = run('secrets', goodApp, { GITLEAKS_REPORT: '{dir}/nowhere.json' });
  assert.equal(result.status, 1);
});

const buildable = {
  ...goodApp,
  'package.json': JSON.stringify({ name: 'app', private: true, scripts: { build: 'node build.js' } }),
  'package-lock.json': JSON.stringify({ name: 'app', lockfileVersion: 3, requires: true, packages: { '': { name: 'app' } } }),
};

test('build-plan: a paved Nuxt app with a lockfile is built', () => {
  const result = run('build-plan', buildable);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.output, /^build=true$/m);
});

test('build-plan: a paved app without a lockfile fails', () => {
  const result = run('build-plan', { ...buildable, 'package-lock.json': null });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /package-lock\.json/);
  assert.match(result.output, /^build=false$/m);
});

test('build-plan: a paved Nuxt app without package.json fails, saying so', () => {
  const result = run('build-plan', { ...buildable, 'package.json': null });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /package\.json/);
  assert.doesNotMatch(result.errors[0], /off the paved road/);
  assert.match(result.output, /^build=false$/m);
});

test('build-plan: an app off the paved road is skipped with a warning', () => {
  const result = run('build-plan', {
    ...buildable,
    'PASSPORT.yml': passport.replace('road: paved', 'road: non-paved').replace('stack: nuxt', 'stack: other'),
  });
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.warnings.length, 1);
  assert.match(result.output, /^build=false$/m);
});

const pagesPassport = readFileSync(fixture('../examples/passport/library-hours.yml'), 'utf8');
const html = (head) => `<!DOCTYPE html><html><head>${head}</head><body></body></html>`;

test('indexing: a built Pages site is read from .output/public', () => {
  const result = run('indexing', {
    ...goodApp,
    'PASSPORT.yml': pagesPassport,
    '.output/public/index.html': html(''),
    '.output/public/robots.txt': 'User-agent: *\nAllow: /\n',
    '.output/public/sitemap.xml': '<urlset/>',
  });
  assert.equal(result.status, 0, result.stdout);
});

test('indexing: a non-indexable built page without noindex fails', () => {
  const result = run('indexing', {
    ...goodApp,
    'PASSPORT.yml': pagesPassport.replace('indexable: true', 'indexable: false'),
    '.output/public/index.html': html(''),
  });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /title=Indexing::/);
});

test('indexing: a container app is started and its home page checked', () => {
  const server = `
    import { createServer } from 'node:http';
    createServer((req, res) => {
      res.setHeader('X-Robots-Tag', 'noindex');
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><head><meta name="robots" content="noindex"></head></html>');
    }).listen(process.env.PORT);
  `;
  const result = run('indexing', { ...goodApp, '.output/server/index.mjs': server });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('indexing: a container app that won\'t start is a warning, not a failure', () => {
  const result = run('indexing', { ...goodApp, '.output/server/index.mjs': 'process.exit(1);\n' });
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /start/);
});

test('indexing: no build output fails', () => {
  const result = run('indexing', goodApp);
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /\.output/);
});

test('files: a missing CODEOWNERS fails', () => {
  const result = run('files', without('.github/CODEOWNERS'));
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /CODEOWNERS/);
});

test('files: CODEOWNERS at the root is found as well as in .github', () => {
  const result = run('files', { ...without('.github/CODEOWNERS'), CODEOWNERS: goodApp['.github/CODEOWNERS'] });
  assert.equal(result.status, 0, result.stdout);
});

test('files: a CODEOWNERS that drops the team is annotated on CODEOWNERS', () => {
  const result = run('files', { ...goodApp, '.github/CODEOWNERS': goodApp['.github/CODEOWNERS'] + '* @someone\n' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /^::error file=\.github\/CODEOWNERS,/);
});
