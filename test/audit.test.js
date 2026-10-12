import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explainAudit } from '../checks/audit.js';

const report = JSON.parse(readFileSync(new URL('./fixtures/reports/npm-audit.json', import.meta.url), 'utf8'));

test('a clean audit passes', () => {
  const result = explainAudit({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } });
  assert.equal(result.ok, true);
});

test('each high or critical package is one problem, naming the package and the fix', () => {
  const result = explainAudit(report);
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 2);
  const minimist = result.problems.find((p) => p.includes('`minimist`'));
  assert.match(minimist, /critical/);
  assert.match(minimist, /Prototype Pollution/);
  assert.match(minimist, /1\.2\.8/);
});

test('moderate and low findings pass with a warning', () => {
  const moderate = {
    vulnerabilities: {
      'left-pad': { name: 'left-pad', severity: 'moderate', via: [{ title: 'Slow padding', severity: 'moderate' }], fixAvailable: false },
    },
  };
  const result = explainAudit(moderate);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /`left-pad`/);
});

test('a vulnerability with no fix says so', () => {
  const noFix = {
    vulnerabilities: {
      'old-lib': { name: 'old-lib', severity: 'high', via: [{ title: 'Bad thing', severity: 'high' }], fixAvailable: false },
    },
  };
  assert.match(explainAudit(noFix).problems[0], /no fixed version/);
});

test('a package flagged only through another package names that package', () => {
  const transitive = {
    vulnerabilities: {
      parent: { name: 'parent', severity: 'high', via: ['child'], fixAvailable: true },
      child: { name: 'child', severity: 'high', via: [{ title: 'Child issue', severity: 'high' }], fixAvailable: true },
    },
  };
  const parent = explainAudit(transitive).problems.find((p) => p.includes('`parent`'));
  assert.match(parent, /`child`/);
});
