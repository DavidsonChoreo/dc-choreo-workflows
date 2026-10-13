import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newDependencies, checkRegistry, checkAutoMerge, checkEndOfLife, runtimesOf, explainUnused, sourceOf, checkSources } from '../checks/dependencies.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/reports/${name}`, import.meta.url), 'utf8'));
const cycles = { nodejs: fixture('eol-nodejs.json'), python: fixture('eol-python.json') };
const today = new Date('2026-10-12T00:00:00Z');

test('new dependencies are those added since the base, in either list', () => {
  const base = { dependencies: { nuxt: '4.1.0' }, devDependencies: { vitest: '3.0.0' } };
  const head = { dependencies: { nuxt: '4.1.0', 'left-pad': '1.3.0' }, devDependencies: { vitest: '3.0.0', 'new-dev': '1.0.0' } };
  assert.deepEqual(newDependencies(base, head), ['left-pad', 'new-dev']);
});

test('with no base, every dependency is new', () => {
  assert.deepEqual(newDependencies(null, { dependencies: { a: '1' }, devDependencies: { b: '1' } }), ['a', 'b']);
});

test('a dependency missing from the registry fails, naming it', () => {
  const result = checkRegistry([{ name: 'nuxt-auth-helperz', exists: false }], today);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /`nuxt-auth-helperz`/);
  assert.match(result.problems[0], /doesn't exist/);
});

test('a dependency first published in the last 30 days passes with a warning', () => {
  const result = checkRegistry([{ name: 'shiny', exists: true, created: '2026-10-01T00:00:00Z' }], today);
  assert.equal(result.ok, true);
  assert.match(result.warnings[0], /`shiny`/);
  assert.match(result.warnings[0], /11 days/);
});

test('an established dependency passes quietly', () => {
  const result = checkRegistry([{ name: 'nuxt', exists: true, created: '2016-10-26T00:00:00Z' }], today);
  assert.deepEqual(result, { ok: true, problems: [], warnings: [] });
});

const LAYER = 'https://github.com/DavidsonCollege/dc-choreo-scaffold/releases/download/v0.2.0/davidson-choreo-layer-0.2.0.tgz';

test('a dependency\'s source: the npm registry, Platform Engineering\'s own releases, or somewhere else', () => {
  for (const spec of ['^4.1.0', '1.2.3', 'latest', '>=2 <3', 'npm:left-pad@1.3.0', '*']) assert.equal(sourceOf(spec), 'registry', spec);
  assert.equal(sourceOf(LAYER), 'davidson');
  for (const spec of ['https://example.org/pkg-1.0.0.tgz', 'https://github.com/someone/dc-choreo-scaffold/releases/download/v1/x.tgz', 'github:someone/pkg', 'someone/pkg', 'git+https://github.com/someone/pkg.git', 'file:../pkg', 'link:../pkg']) {
    assert.equal(sourceOf(spec), 'outside', spec);
  }
});

test('Platform Engineering\'s own packages are trusted without an npm lookup', () => {
  const { lookUp, problems } = checkSources([{ name: '@davidson/choreo-layer', spec: LAYER }, { name: 'nuxt', spec: '^4.1.0' }]);
  assert.deepEqual(lookUp, ['nuxt']);
  assert.deepEqual(problems, []);
});

test('a package from outside npm fails, saying where it comes from rather than that it doesn\'t exist', () => {
  const { lookUp, problems } = checkSources([{ name: 'helper', spec: 'https://example.org/helper-1.0.0.tgz' }]);
  assert.deepEqual(lookUp, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /`helper` comes from https:\/\/example\.org\/helper-1\.0\.0\.tgz, not the npm registry/);
  assert.doesNotMatch(problems[0], /doesn't exist/);
});

test('an npm alias is looked up by the package it points to', () => {
  assert.deepEqual(checkSources([{ name: 'pad', spec: 'npm:left-pad@1.3.0' }]).lookUp, ['left-pad']);
});

test('a workflow that auto-merges pull requests fails', () => {
  const result = checkAutoMerge([{ path: '.github/workflows/dependabot.yml', text: 'run: gh pr merge --auto --squash "$PR_URL"' }]);
  assert.equal(result.ok, false);
  assert.match(result.problems[0].message, /auto-merge/);
  assert.equal(result.problems[0].file, '.github/workflows/dependabot.yml');
});

test('known auto-merge actions fail too', () => {
  for (const uses of ['pascalgn/automerge-action@v0.16.4', 'peter-evans/enable-pull-request-automerge@v3', 'ahmadnassri/action-dependabot-auto-merge@v2']) {
    assert.equal(checkAutoMerge([{ path: 'w.yml', text: `- uses: ${uses}` }]).ok, false, uses);
  }
});

test('ordinary workflows pass', () => {
  assert.equal(checkAutoMerge([{ path: 'w.yml', text: 'run: gh pr merge 12 --squash' }]).ok, true);
});

test('runtimes are read from engines, .nvmrc and the Containerfile', () => {
  const runtimes = runtimesOf({
    packageJson: { engines: { node: '>=22' } },
    nvmrc: 'v24.3.0\n',
    containerfile: `FROM node:22-slim@sha256:${'a'.repeat(64)} AS build\nFROM python:3.12-slim@sha256:${'b'.repeat(64)}\n`,
  });
  assert.deepEqual(runtimes, [
    { product: 'nodejs', cycle: '22', source: 'package.json engines' },
    { product: 'nodejs', cycle: '24', source: '.nvmrc' },
    { product: 'nodejs', cycle: '22', source: 'Containerfile' },
    { product: 'python', cycle: '3.12', source: 'Containerfile' },
  ]);
});

test('an end-of-life runtime fails', () => {
  const result = checkEndOfLife([{ product: 'nodejs', cycle: '20', source: 'Containerfile' }], cycles, today);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /Node\.js 20/);
  assert.match(result.problems[0], /Containerfile/);
});

test('a runtime reaching end of life within 90 days warns', () => {
  const soon = new Date('2027-02-15T00:00:00Z');
  const result = checkEndOfLife([{ product: 'nodejs', cycle: '22', source: '.nvmrc' }], cycles, soon);
  assert.equal(result.ok, true);
  assert.match(result.warnings[0], /Node\.js 22/);
  assert.match(result.warnings[0], /2027-04-30/);
});

test('a supported runtime passes, and an odd-numbered Node release with eol false passes', () => {
  const result = checkEndOfLife([{ product: 'nodejs', cycle: '24', source: '.nvmrc' }, { product: 'python', cycle: '3.13', source: 'Containerfile' }], cycles, today);
  assert.deepEqual(result, { ok: true, problems: [], warnings: [] });
});

test('a version endoflife.date doesn\'t know is a warning, not a guess', () => {
  const result = checkEndOfLife([{ product: 'nodejs', cycle: '99', source: '.nvmrc' }], cycles, today);
  assert.equal(result.ok, true);
  assert.match(result.warnings[0], /99/);
});

test('unused dependencies from knip become warnings', () => {
  const knip = { issues: [{ file: 'package.json', dependencies: [{ name: 'lodash' }], devDependencies: [{ name: 'jest' }] }] };
  const result = explainUnused(knip);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /`lodash`/);
});
