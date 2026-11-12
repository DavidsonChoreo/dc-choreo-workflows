// The deploy workflow's plan job: the app's name from its passport, and its short Azure name from the repository's
// `azure-name` custom property. The step's own script runs under bash, as GitHub runs it, with stand-ins for `yq`
// (the passport) and `gh` (the property API, filtered through the real jq).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const workflowPath = new URL('../.github/workflows/deploy.yml', import.meta.url);
const workflow = parse(readFileSync(workflowPath, 'utf8'));
const plan = workflow.jobs.plan;
const step = plan.steps.find((s) => s.id === 'passport');
const hasJq = spawnSync('jq', ['--version']).status === 0;

function bin() {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-bin-'));
  const yamlPath = createRequire(import.meta.url).resolve('yaml');
  writeFileSync(join(dir, 'yq'), `#!/usr/bin/env node
// yq -r '.a.b // ""' FILE
const { parse } = require(${JSON.stringify(yamlPath)});
const [, , flag, expr, file] = process.argv;
if (flag !== '-r') process.exit(2);
let value = parse(require('fs').readFileSync(file, 'utf8'));
for (const key of expr.replace(/\\s*\\/\\/\\s*""\\s*$/, '').split('.').filter(Boolean)) value = value?.[key];
process.stdout.write((value ?? '') + '\\n');
`);
  writeFileSync(join(dir, 'gh'), `#!/usr/bin/env bash
# gh api PATH --jq EXPR
[ "$1" = api ] && [ "$3" = --jq ] || exit 2
echo "$2" >> "$FAKE_GH_LOG"
if [ -n "\${FAKE_GH_FAIL:-}" ]; then echo "HTTP 404: Not Found" >&2; exit 1; fi
printf '%s' "$FAKE_PROPERTIES" | jq -r "$4"
`);
  chmodSync(join(dir, 'yq'), 0o755);
  chmodSync(join(dir, 'gh'), 0o755);
  return dir;
}
const binDir = bin();

function passport(app, tier = 'container') {
  return `version: 1\napp: ${app}\nprofile:\n  tier: ${tier}\n`;
}

function run({ app, properties = [], fail = false, containerfile = true, tier }) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-plan-'));
  const work = join(dir, 'work');
  mkdirSync(work);
  writeFileSync(join(work, 'PASSPORT.yml'), passport(app, tier));
  if (containerfile) writeFileSync(join(work, 'Containerfile'), 'FROM scratch\n');
  const output = join(dir, 'output');
  const log = join(dir, 'gh.log');
  writeFileSync(output, '');
  // As GitHub runs a `run:` step: bash --noprofile --norc -eo pipefail.
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run], {
    cwd: work,
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      GITHUB_OUTPUT: output,
      GITHUB_REPOSITORY: 'DavidsonChoreo/room-requests',
      GH_TOKEN: 'not-a-token',
      FAKE_GH_LOG: log,
      FAKE_PROPERTIES: JSON.stringify(properties),
      ...(fail ? { FAKE_GH_FAIL: '1' } : {}),
    },
  });
  const outputs = Object.fromEntries(
    readFileSync(output, 'utf8').split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, outputs, calls };
}

const prop = (value) => [
  { property_name: 'lifecycle', value: 'hosted' },
  { property_name: 'azure-name', value },
];

test('the plan job exposes the app and its short Azure name', () => {
  assert.equal(plan.outputs.app, '${{ steps.passport.outputs.app }}');
  assert.equal(plan.outputs['azure-name'], '${{ steps.passport.outputs.azure-name }}');
  assert.equal(step.env?.GH_TOKEN, '${{ github.token }}');
});

test('the deploy job names the container app by the short name, and the rest by the app', () => {
  const deploy = workflow.jobs.deploy;
  assert.equal(deploy.env.AZURE_NAME, '${{ needs.plan.outputs.azure-name }}');
  assert.equal(deploy.env.APP, '${{ needs.plan.outputs.app }}');
  const scripts = deploy.steps.map((s) => s.run ?? '').join('\n');
  assert.doesNotMatch(scripts, /dc-\$APP-app/);
  assert.match(scripts, /--name "dc-\$AZURE_NAME-app"/);
  assert.match(scripts, /"dc-\$APP-rg"/);
  assert.match(scripts, /\$APP\/\$APP@\$DIGEST/);
});

test('the deploy stub\'s inputs are unchanged', () => {
  assert.deepEqual(Object.keys(workflow.on.workflow_call.inputs), ['client-id', 'tenant-id', 'subscription-id', 'registry']);
});

test('without the property, the short name is the app, so apps hosted today deploy unchanged', { skip: !hasJq && 'no jq' }, () => {
  const r = run({ app: 'room-requests', properties: [{ property_name: 'lifecycle', value: 'hosted' }] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.outputs, { app: 'room-requests', 'azure-name': 'room-requests' });
  assert.deepEqual(r.calls, ['repos/DavidsonChoreo/room-requests/properties/values']);
});

test('an empty property falls back to the app too', { skip: !hasJq && 'no jq' }, () => {
  for (const value of [null, '']) {
    const r = run({ app: 'room-requests', properties: prop(value) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.outputs['azure-name'], 'room-requests');
  }
});

test('a long app deploys under the short name from the property', { skip: !hasJq && 'no jq' }, () => {
  const app = 'office-of-the-registrar-course-scheduling-assistant';
  const r = run({ app, properties: prop('office-of-the-regi') });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.outputs, { app, 'azure-name': 'office-of-the-regi' });
});

test('the app may be 63 characters, and one character', { skip: !hasJq && 'no jq' }, () => {
  const long = 'a'.repeat(63);
  assert.equal(run({ app: long, properties: prop('a'.repeat(18)) }).status, 0);
  assert.equal(run({ app: 'a' }).status, 0);
  assert.equal(run({ app: '9lives' }).status, 0);
});

test('an app that isn\'t a slug fails, in plain words', { skip: !hasJq && 'no jq' }, () => {
  for (const app of ['a'.repeat(64), 'Room-Requests', '-rooms', 'rooms-', 'room_requests']) {
    const r = run({ app, properties: prop('rooms') });
    assert.notEqual(r.status, 0, app);
    assert.match(r.stdout, /::error file=PASSPORT\.yml::The passport's `app`/);
    assert.match(r.stdout, /Platform Engineering/);
  }
});

test('a long app with no short name fails and says why', { skip: !hasJq && 'no jq' }, () => {
  const r = run({ app: 'office-of-the-registrar-scheduling' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /`azure-name`/);
  assert.match(r.stdout, /18 characters/);
  assert.match(r.stdout, /Platform Engineering/);
});

test('a short name that isn\'t valid fails and names the property', { skip: !hasJq && 'no jq' }, () => {
  for (const value of ['a'.repeat(19), 'rooms-', '-rooms', 'room--requests', 'Rooms', 'room_requests']) {
    const r = run({ app: 'room-requests', properties: prop(value) });
    assert.notEqual(r.status, 0, value);
    assert.match(r.stdout, /`azure-name`/, value);
    assert.match(r.stdout, /Platform Engineering/);
  }
});

test('when the property can\'t be read, the deploy stops and says so', { skip: !hasJq && 'no jq' }, () => {
  const r = run({ app: 'room-requests', fail: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /::error::/);
  assert.match(r.stdout, /custom properties/);
});

test('the tier and Containerfile checks still hold', { skip: !hasJq && 'no jq' }, () => {
  assert.notEqual(run({ app: 'rooms', tier: 'pages' }).status, 0);
  assert.notEqual(run({ app: 'rooms', containerfile: false }).status, 0);
});
