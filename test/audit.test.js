import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explainAudit } from '../checks/audit.js';

const report = JSON.parse(readFileSync(new URL('./fixtures/reports/npm-audit.json', import.meta.url), 'utf8'));

test('a clean audit passes', () => {
  const result = explainAudit({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } });
  assert.equal(result.ok, true);
});

test('a vulnerable dependency never fails the check: each package is a warning naming it and the fix', () => {
  const result = explainAudit(report);
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
  const minimist = result.warnings.find((w) => w.includes('`minimist`'));
  assert.match(minimist, /critical/);
  assert.match(minimist, /Prototype Pollution/);
  assert.match(minimist, /1\.2\.8/);
});

test('high and critical findings are one medium flag for the assessor, so the app gets a review', () => {
  const { flags } = explainAudit(report);
  const medium = flags.filter((f) => f.severity === 'medium');
  assert.equal(medium.length, 1);
  assert.equal(medium[0].id, 'dependency-audit');
  assert.match(medium[0].detail, /`minimist` \(critical\)/);
  assert.match(medium[0].detail, /`lodash` \(high\)/);
  assert.ok(flags.every((f) => f.severity !== 'high'));
});

test('moderate and low findings are a warning and a low flag', () => {
  const moderate = {
    vulnerabilities: {
      'left-pad': { name: 'left-pad', severity: 'moderate', via: [{ title: 'Slow padding', severity: 'moderate' }], fixAvailable: false },
    },
  };
  const result = explainAudit(moderate);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /`left-pad`/);
  assert.deepEqual(result.flags.map((f) => f.severity), ['low']);
});

test('a clean audit leaves no flags', () => {
  assert.deepEqual(explainAudit({ vulnerabilities: {} }).flags, []);
});

test('a vulnerability with no fix says so', () => {
  const noFix = {
    vulnerabilities: {
      'old-lib': { name: 'old-lib', severity: 'high', via: [{ title: 'Bad thing', severity: 'high' }], fixAvailable: false },
    },
  };
  const result = explainAudit(noFix);
  assert.match(result.warnings[0], /no fixed version/);
  assert.match(result.flags[0].detail, /`old-lib` \(high, no fix yet\)/);
});

test('a package flagged only through another package names that package', () => {
  const transitive = {
    vulnerabilities: {
      parent: { name: 'parent', severity: 'high', via: ['child'], fixAvailable: true },
      child: { name: 'child', severity: 'high', via: [{ title: 'Child issue', severity: 'high' }], fixAvailable: true },
    },
  };
  const parent = explainAudit(transitive).warnings.find((w) => w.includes('`parent`'));
  assert.match(parent, /`child`/);
});
