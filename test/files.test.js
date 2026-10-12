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
