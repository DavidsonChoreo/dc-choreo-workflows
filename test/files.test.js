import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFiles, hashOf } from '../checks/files.js';

const agents = '# Agent instructions\n\nRead the passport first.\n';
const claude = '@AGENTS.md\n';
const hashes = {
  'AGENTS.md': [{ sha256: hashOf(agents), from: 'test' }],
  'CLAUDE.md': [{ sha256: hashOf(claude), from: 'test' }],
};

test('canonical copies pass', () => {
  const result = checkFiles({ files: { 'AGENTS.md': agents, 'CLAUDE.md': claude }, hashes });
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('any released version passes, not only the newest', () => {
  const older = '# Agent instructions\n\nOlder rules.\n';
  const both = { ...hashes, 'AGENTS.md': [...hashes['AGENTS.md'], { sha256: hashOf(older), from: 'older' }] };
  const result = checkFiles({ files: { 'AGENTS.md': older, 'CLAUDE.md': claude }, hashes: both });
  assert.equal(result.ok, true);
});

test('an edited file fails and says where the builder\'s notes belong', () => {
  const result = checkFiles({ files: { 'AGENTS.md': agents + 'My own rule.\n', 'CLAUDE.md': claude }, hashes });
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /`AGENTS.md` has been edited/);
  assert.match(result.problems[0], /BUILDER\.md/);
});

test('a missing file fails', () => {
  const result = checkFiles({ files: { 'AGENTS.md': agents, 'CLAUDE.md': null }, hashes });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /`CLAUDE.md` is missing/);
});

test('Windows line endings are not an edit', () => {
  const result = checkFiles({
    files: { 'AGENTS.md': agents.replaceAll('\n', '\r\n'), 'CLAUDE.md': claude.replaceAll('\n', '\r\n') },
    hashes,
  });
  assert.equal(result.ok, true);
});

test('an edited deploy stub fails and says to ask PE for a different deploy', () => {
  const stub = 'name: deploy\n';
  const result = checkFiles({
    files: { '.github/workflows/deploy.yml': stub + 'jobs: {}\n' },
    hashes: { '.github/workflows/deploy.yml': [{ sha256: hashOf(stub), from: 'test' }] },
  });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /`\.github\/workflows\/deploy\.yml` has been edited/);
  assert.match(result.problems[0], /ask Platform Engineering/);
  assert.doesNotMatch(result.problems[0], /update command/);
  assert.doesNotMatch(result.problems[0], /BUILDER\.md/);
});

import { checkCodeowners } from '../checks/files.js';

const team = '@DavidsonChoreo/platform-engineering';
const canonical = `# Platform Engineering approves every change to these files.\n/PASSPORT.yml ${team}\n/AGENTS.md ${team}\n/CLAUDE.md ${team}\n/.github/workflows/ ${team}\n`;

test('codeowners: the canonical lines pass', () => {
  assert.equal(checkCodeowners(canonical).ok, true);
});

test('codeowners: a builder can add owners for their own files', () => {
  const result = checkCodeowners(`/src/ @someone\n${canonical}`);
  assert.equal(result.ok, true, result.problems.join('\n'));
});

test('codeowners: no CODEOWNERS file fails', () => {
  const result = checkCodeowners(null);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /CODEOWNERS/);
});

test('codeowners: a governed file without the team fails, naming it', () => {
  const result = checkCodeowners(canonical.replace(`/CLAUDE.md ${team}\n`, ''));
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /`CLAUDE.md`/);
});

test('codeowners: a later catch-all line that drops the team fails, since the last match wins', () => {
  const result = checkCodeowners(`${canonical}* @someone\n`);
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 4);
  assert.match(result.problems[0], /last/);
});

test('codeowners: a later catch-all that keeps the team passes', () => {
  assert.equal(checkCodeowners(`${canonical}* @someone ${team}\n`).ok, true);
});

test('codeowners: patterns without a leading slash count too', () => {
  assert.equal(checkCodeowners(canonical.replaceAll('/PASSPORT', 'PASSPORT')).ok, true);
});

test('codeowners: without the workflows line fails, naming the folder and the line to add', () => {
  const result = checkCodeowners(canonical.replace(`/.github/workflows/ ${team}\n`, ''));
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /`\.github\/workflows\/`/);
  assert.match(result.problems[0], new RegExp(`/\\.github/workflows/ ${team}`));
});

test('codeowners: the workflows folder can be written several ways', () => {
  for (const pattern of ['.github/workflows/', '/.github/workflows', '/.github/workflows/**', '/.github/workflows/*', '/.github/']) {
    const text = canonical.replace(`/.github/workflows/ ${team}`, `${pattern} ${team}`);
    assert.equal(checkCodeowners(text).ok, true, pattern);
  }
});

test('codeowners: a later line giving one workflow to someone else fails', () => {
  const result = checkCodeowners(`${canonical}/.github/workflows/ci.yml @someone\n`);
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /`\/\.github\/workflows\/ci\.yml @someone`/);
});

test("codeowners: a builder's line for one workflow above PE's block is overridden, so passes", () => {
  assert.equal(checkCodeowners(`/.github/workflows/ci.yml @someone\n${canonical}`).ok, true);
});

test('codeowners: a later line for one workflow that keeps the team passes', () => {
  assert.equal(checkCodeowners(`${canonical}/.github/workflows/ci.yml @someone ${team}\n`).ok, true);
});
