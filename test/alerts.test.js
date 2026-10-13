import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAlerts } from '../assessor/alerts.js';

const REPO = 'DavidsonChoreo/academic-deadlines';

// A stand-in for the GitHub API: each kind of alert answers with a status
// and a body, as fetch would.
function fakeGitHub({ code = [200, []], dependabot = [200, []], secrets = [200, []] } = {}) {
  const calls = [];
  const github = async (path) => {
    calls.push(path);
    const [status, data] = path.includes('/code-scanning/') ? code
      : path.includes('/dependabot/') ? dependabot
        : path.includes('/secret-scanning/') ? secrets
          : (() => { throw new Error(`unexpected call: ${path}`); })();
    return { status, data };
  };
  return { github, calls };
}

const dependabotAlert = (name, severity, summary, patched = '2.0.0') => ({
  state: 'open',
  dependency: { package: { ecosystem: 'npm', name }, manifest_path: 'package-lock.json' },
  security_advisory: { severity, summary },
  security_vulnerability: { first_patched_version: patched ? { identifier: patched } : null },
});

const codeAlert = (rule, { security, severity = 'warning', path = 'server/api/notes.post.ts', line = 14 } = {}) => ({
  state: 'open',
  rule: { id: rule, description: `Rule ${rule}`, security_severity_level: security, severity },
  most_recent_instance: { location: { path, start_line: line } },
});

test('no open alerts means no flags, and asks only for open alerts', async () => {
  const { github, calls } = fakeGitHub();
  assert.deepEqual(await collectAlerts({ repository: REPO, github }), []);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((p) => p.startsWith(`/repos/${REPO}/`) && p.includes('state=open')));
});

test('Dependabot alerts are medium at worst: critical and high are one medium flag, the rest low', async () => {
  const { github } = fakeGitHub({
    dependabot: [200, [
      dependabotAlert('lodash', 'critical', 'Prototype pollution', '4.17.21'),
      dependabotAlert('axios', 'high', 'Server-side request forgery', '1.8.2'),
      dependabotAlert('nanoid', 'medium', 'Predictable results', '3.3.8'),
      dependabotAlert('ms', 'low', 'Inefficient regular expression', null),
    ]],
  });
  const flags = await collectAlerts({ repository: REPO, github });
  assert.deepEqual(flags.map((f) => [f.id, f.severity]), [
    ['alert-dependabot', 'medium'],
    ['alert-dependabot', 'low'],
  ]);
  const worst = flags[0];
  assert.match(worst.detail, /2 open high- or critical-severity alerts/);
  assert.match(worst.detail, /`lodash`.*Prototype pollution.*4\.17\.21/);
  assert.match(worst.detail, /`axios`/);
  assert.match(flags[1].detail, /`nanoid`/);
  assert.match(flags[1].detail, /no fixed version yet/i);
  assert.equal(worst.evidence, `https://github.com/${REPO}/security/dependabot`);
});

test('CodeQL alerts are medium at worst, by the security severity, and name the file and line', async () => {
  const { github } = fakeGitHub({
    code: [200, [
      codeAlert('js/reflected-xss', { security: 'high' }),
      codeAlert('js/unused-local-variable', { severity: 'note', path: 'app.vue', line: 3 }),
      codeAlert('js/sql-injection', { severity: 'error' }),
    ]],
  });
  const flags = await collectAlerts({ repository: REPO, github });
  assert.deepEqual(flags.map((f) => [f.id, f.severity]), [
    ['alert-code-scanning', 'medium'],
    ['alert-code-scanning', 'low'],
  ]);
  assert.match(flags[0].detail, /2 open serious alerts/);
  assert.match(flags[0].detail, /js\/reflected-xss.*server\/api\/notes\.post\.ts, line 14/);
  assert.match(flags[0].detail, /js\/sql-injection/);
  assert.match(flags[1].detail, /app\.vue, line 3/);
  assert.equal(flags[0].evidence, `https://github.com/${REPO}/security/code-scanning`);
});

test('an open secret-scanning alert is always high, and never quotes the secret', async () => {
  const { github } = fakeGitHub({
    secrets: [200, [{ state: 'open', secret_type_display_name: 'GitHub Personal Access Token', secret: 'ghp_notarealtoken0000000000000000000000' }]],
  });
  const [flag, ...rest] = await collectAlerts({ repository: REPO, github });
  assert.equal(rest.length, 0);
  assert.equal(flag.id, 'alert-secret-scanning');
  assert.equal(flag.severity, 'high');
  assert.match(flag.detail, /GitHub Personal Access Token/);
  assert.match(flag.detail, /Platform Engineering/);
  assert.doesNotMatch(JSON.stringify(flag), /ghp_/);
});

test("alerts that can't be read leave a low flag saying which, and don't stop the others", async () => {
  const { github } = fakeGitHub({
    code: [404, { message: 'no analysis found' }],
    dependabot: [200, [dependabotAlert('axios', 'high', 'SSRF')]],
    secrets: [403, { message: 'Resource not accessible by integration' }],
  });
  const flags = await collectAlerts({ repository: REPO, github });
  assert.deepEqual(flags.map((f) => [f.id, f.severity]), [
    ['alert-dependabot', 'medium'],
    ['alerts-unreadable', 'low'],
  ]);
  assert.match(flags[1].detail, /CodeQL/);
  assert.match(flags[1].detail, /secret scanning/);
  assert.doesNotMatch(flags[1].detail, /Dependabot/);
});

test('a full first page says there may be more', async () => {
  const many = Array.from({ length: 100 }, (_, i) => dependabotAlert(`pkg-${i}`, 'low', 'Something'));
  const { github } = fakeGitHub({ dependabot: [200, many] });
  const [flag] = await collectAlerts({ repository: REPO, github });
  assert.match(flag.detail, /100 or more/);
});
