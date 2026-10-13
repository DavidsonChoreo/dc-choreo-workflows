import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readScreenshots } from '../assessor/screenshots.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]);

test('screenshots become image blocks named for their page, home page first, capped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shots-'));
  for (const name of ['index.png', 'about.png', 'events-fall.png', 'notes.txt']) writeFileSync(join(dir, name), PNG);
  const shots = readScreenshots(dir, { max: 2 });
  assert.deepEqual(shots.map((s) => s.page), ['/', '/about/']);
  assert.deepEqual(shots[0].block, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } });
});

test('no directory, or none set, means no screenshots', () => {
  assert.deepEqual(readScreenshots(undefined), []);
  assert.deepEqual(readScreenshots(join(tmpdir(), 'no-such-dir-here')), []);
});

test('a screenshot over 5 MB is left out, since the API would refuse it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shots-'));
  writeFileSync(join(dir, 'index.png'), PNG);
  writeFileSync(join(dir, 'huge.png'), Buffer.alloc(5_000_001, 1));
  assert.deepEqual(readScreenshots(dir).map((s) => s.page), ['/']);
});
