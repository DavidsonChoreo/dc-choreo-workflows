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

import { checkCodeowners } from '../checks/files.js';

const team = '@DavidsonChoreo/platform-engineering';
const canonical = `# Platform Engineering approves every change to these files.\n/PASSPORT.yml ${team}\n/AGENTS.md ${team}\n/CLAUDE.md ${team}\n`;

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
  assert.equal(result.problems.length, 3);
  assert.match(result.problems[0], /last/);
});

test('codeowners: a later catch-all that keeps the team passes', () => {
  assert.equal(checkCodeowners(`${canonical}* @someone ${team}\n`).ok, true);
});

test('codeowners: patterns without a leading slash count too', () => {
  assert.equal(checkCodeowners(canonical.replaceAll('/PASSPORT', 'PASSPORT')).ok, true);
});
