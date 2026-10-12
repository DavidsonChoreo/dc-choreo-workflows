import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explainSecrets } from '../checks/secrets.js';

const findings = JSON.parse(readFileSync(new URL('./fixtures/reports/gitleaks.json', import.meta.url), 'utf8'));

test('no findings passes', () => {
  assert.deepEqual(explainSecrets([]), { ok: true, problems: [], warnings: [] });
});

test('the same secret in several commits is one problem', () => {
  const { problems } = explainSecrets(findings);
  // The fixture holds one AWS key seen in two commits, and one API key.
  assert.equal(problems.length, 2);
});

test('each problem points at the file and line', () => {
  const [first, second] = explainSecrets(findings).problems;
  assert.equal(first.file, 'config.js');
  assert.equal(first.line, 1);
  assert.equal(second.file, 'server/api/slate.ts');
  assert.equal(second.line, 12);
});

test('the message explains history, rotation and that PE will help', () => {
  const [{ message }] = explainSecrets(findings).problems;
  assert.match(message, /history/);
  assert.match(message, /rotate/);
  assert.match(message, /Platform Engineering/);
  assert.match(message, /ed577b1/);
});

test('messages never include the secret, the author or their email', () => {
  for (const { message } of explainSecrets(findings).problems) {
    assert.doesNotMatch(message, /AKIA|REDACTED|Test Author|tauthor@davidson\.edu/);
  }
});
