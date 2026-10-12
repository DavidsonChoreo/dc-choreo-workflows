import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { parse } from 'yaml';
import { collectSources, judgmentsSchema, buildRequest, runAssessment, MODEL } from '../assessor/assess.js';
import { loadControlMap } from '../checks/control-map.js';

const map = loadControlMap();
const rubric = parse(readFileSync(new URL('../rubrics/security.yml', import.meta.url), 'utf8'));
const passport = readFileSync(new URL('../examples/passport/academic-deadlines.yml', import.meta.url), 'utf8');

function app(files) {
  const dir = mkdtempSync(join(tmpdir(), 'assess-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

test('sources: app files are read; dependencies, build output, lockfiles and binaries are not', () => {
  const dir = app({
    'app.vue': '<template><main /></template>',
    'server/api/x.ts': 'export default () => 1;',
    'node_modules/a/index.js': 'x',
    '.output/public/index.html': 'x',
    'package-lock.json': '{}',
    'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
  });
  const { files, skipped } = collectSources(dir);
  assert.deepEqual(files.map((f) => f.path).sort(), ['app.vue', 'server/api/x.ts']);
  assert.ok(skipped.includes('logo.png'));
});

test('sources: an app too big for one review stops with a message, never truncated', () => {
  const dir = app({ 'a.ts': 'x'.repeat(5000) });
  assert.throws(() => collectSources(dir, { maxChars: 1000 }), /too large/);
});

test('the judgments schema lists only this tier\'s rubric items and flag controls', () => {
  const pages = judgmentsSchema({ tier: 'pages', rubric, map, llm: false });
  const flagIds = pages.properties.flags.items.properties.id.enum;
  const controlIds = pages.properties.controls.items.properties.id.enum;
  assert.ok(flagIds.includes('injection'));
  assert.ok(!flagIds.includes('record-level-security'));
  assert.ok(controlIds.includes('5.5.2'));
  assert.ok(!controlIds.includes('5.5.1'));
});

test('the prompt-injection item is only offered when the passport has an LLM', () => {
  const ids = (llm) => judgmentsSchema({ tier: 'container', rubric, map, llm }).properties.flags.items.properties.id.enum;
  assert.ok(!ids(false).includes('prompt-injection'));
  assert.ok(ids(true).includes('prompt-injection'));
});

test('the judgments schema uses only what structured outputs support', () => {
  const text = JSON.stringify(judgmentsSchema({ tier: 'container', rubric, map, llm: true }));
  assert.doesNotMatch(text, /minLength|maxLength|minimum|maximum|"if"|"pattern"/);
  assert.doesNotMatch(text, /"additionalProperties":true/);
});

const request = (overrides = {}) => buildRequest({
  tier: 'container', rubric, map, passportText: passport,
  checkResults: [{ check: 'passport', problems: [], warnings: [] }],
  sources: { files: [{ path: 'app.vue', text: '<template />' }], skipped: [] },
  ...overrides,
});

test('the request: Opus 5.5, low effort, fallbacks on, structured output, streaming-sized', () => {
  const r = request();
  assert.equal(r.model, MODEL);
  assert.equal(MODEL, 'claude-opus-5-5');
  assert.equal(r.output_config.effort, 'low');
  assert.equal(r.output_config.format.type, 'json_schema');
  assert.equal(r.fallbacks, 'default');
  assert.deepEqual(r.betas, ['server-side-fallback-2026-07-01']);
  assert.ok(r.max_tokens >= 32000);
});

test('the system prompt is cached and identical for any two apps on the same tier', () => {
  const a = request();
  const b = request({ passportText: passport.replace('academic-deadlines', 'other-app'), sources: { files: [{ path: 'x.ts', text: '1' }], skipped: [] } });
  assert.deepEqual(a.system, b.system);
  assert.deepEqual(a.system.at(-1).cache_control, { type: 'ephemeral' });
  assert.match(a.system.map((s) => s.text).join('\n'), /record-level-security/);
});

test('the app itself goes in the user message: passport, checks and every file with its path', () => {
  const text = request().messages[0].content.map((c) => c.text).join('\n');
  assert.match(text, /academic-deadlines/);
  assert.match(text, /=== app\.vue ===/);
  assert.match(text, /passport/);
});

// A stand-in client: returns `message` from the stream's finalMessage().
const client = (message) => ({ beta: { messages: { stream: () => ({ finalMessage: async () => message }) } } });
const judgments = { summary: 'Fine.', flags: [], controls: [{ id: '4.3', status: 'met', evidence: 'server/api/x.ts checks the role.' }] };
const message = (text, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text }] });

test('a normal response becomes judgments', async () => {
  const result = await runAssessment({ client: client(message(JSON.stringify(judgments))), request: request() });
  assert.deepEqual(result, judgments);
});

test('a refusal becomes { refused: true }', async () => {
  const result = await runAssessment({ client: client({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }), request: request() });
  assert.deepEqual(result, { refused: true });
});

test('a response cut off at max_tokens fails loudly', async () => {
  await assert.rejects(runAssessment({ client: client(message('{"summary":', 'max_tokens')), request: request() }), /max_tokens/);
});

test('judgments that do not fit the schema fail loudly', async () => {
  const bad = { ...judgments, controls: [{ id: '4.3', status: 'maybe', evidence: '' }] };
  await assert.rejects(runAssessment({ client: client(message(JSON.stringify(bad))), request: request() }), /schema/);
});
