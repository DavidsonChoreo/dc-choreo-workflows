import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { identifyLicense, checkLicense } from '../checks/license.js';

const text = (name) => readFileSync(new URL(`./fixtures/licenses/${name}.txt`, import.meta.url), 'utf8');

test('each standard license text is identified', () => {
  assert.equal(identifyLicense(text('Apache-2.0')), 'Apache-2.0');
  assert.equal(identifyLicense(text('Apache-2.0-github')), 'Apache-2.0');
  assert.equal(identifyLicense(text('MIT')), 'MIT');
  assert.equal(identifyLicense(text('BSD-3-Clause')), 'BSD-3-Clause');
  assert.equal(identifyLicense(text('GPL-3.0')), 'GPL-3.0');
  assert.equal(identifyLicense(text('AGPL-3.0')), 'AGPL-3.0');
  assert.equal(identifyLicense(text('LGPL-3.0')), 'LGPL-3.0');
});

test('a license it does not know is not guessed', () => {
  assert.equal(identifyLicense(text('BSD-2-Clause')), null);
  assert.equal(identifyLicense('All rights reserved.'), null);
});

test('an allowed license matching the passport passes', () => {
  const result = checkLicense({ licenseText: text('MIT'), passportLicense: 'MIT' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.warnings, []);
});

test('no license file fails, and says why it matters', () => {
  const result = checkLicense({ licenseText: null, passportLicense: 'Apache-2.0' });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /no LICENSE file/);
  assert.match(result.problems[0], /public/);
});

test('a license that disagrees with the passport fails, naming both', () => {
  const result = checkLicense({ licenseText: text('MIT'), passportLicense: 'Apache-2.0' });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /MIT/);
  assert.match(result.problems[0], /Apache-2.0/);
});

test('a copyleft license passes with a warning for review', () => {
  const result = checkLicense({ licenseText: text('GPL-3.0'), passportLicense: 'GPL-3.0' });
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /GPL-3.0/);
  assert.match(result.warnings[0], /review/);
});

test('an unrecognized license passes with a warning when the passport names no allowed license', () => {
  const result = checkLicense({ licenseText: text('BSD-2-Clause'), passportLicense: 'BSD-2-Clause' });
  assert.equal(result.ok, true);
  assert.match(result.warnings[0], /review/);
});

test('an unrecognized file fails when the passport claims an allowed license', () => {
  const result = checkLicense({ licenseText: 'All rights reserved.', passportLicense: 'Apache-2.0' });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /doesn't read as Apache-2.0/);
});
