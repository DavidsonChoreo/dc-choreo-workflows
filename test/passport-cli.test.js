import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../checks/passport-cli.js', import.meta.url));
const example = fileURLToPath(new URL('../examples/passport/academic-deadlines.yml', import.meta.url));

// Runs the CLI in a fresh directory, the way CI runs it at an app's root.
function run(setup) {
  const dir = mkdtempSync(join(tmpdir(), 'passport-'));
  setup?.(dir);
  const summary = join(dir, 'summary.md');
  writeFileSync(summary, '');
  const result = spawnSync(process.execPath, [cli], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
  });
  return { ...result, summary: readFileSync(summary, 'utf8') };
}

test('a valid passport exits 0', () => {
  const result = run((dir) => copyFileSync(example, join(dir, 'PASSPORT.yml')));
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('a missing passport exits 1 and says how to get one', () => {
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error file=PASSPORT.yml,title=Passport::/);
  assert.match(result.stdout, /no PASSPORT\.yml/);
});

test('each problem becomes one annotation and one summary line', () => {
  const result = run((dir) => {
    const text = readFileSync(example, 'utf8').replace('  tier: container', '  tier: swa') + 'colour: blue\n';
    writeFileSync(join(dir, 'PASSPORT.yml'), text);
  });
  assert.equal(result.status, 1);
  const annotations = result.stdout.split('\n').filter((line) => line.startsWith('::error '));
  assert.equal(annotations.length, 2);
  assert.match(result.summary, /`profile.tier`/);
  assert.match(result.summary, /`colour`/);
});

test('annotations escape newlines so a message stays on one line', () => {
  const result = run((dir) => writeFileSync(join(dir, 'PASSPORT.yml'), 'passport: 1\napp: [unclosed\n'));
  const annotations = result.stdout.split('\n').filter((line) => line.startsWith('::error '));
  assert.equal(annotations.length, 1);
});
