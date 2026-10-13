import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { parse } from 'yaml';
import { collectSources, judgmentsSchema, buildRequest, runAssessment, assessWithDocuments, MODEL } from '../assessor/assess.js';
import { loadControlMap } from '../checks/control-map.js';

const map = loadControlMap();
const rubric = parse(readFileSync(new URL('../rubrics/security.yml', import.meta.url), 'utf8'));
const passport = readFileSync(new URL('../examples/passport/academic-deadlines.yml', import.meta.url), 'utf8');
// External, branded and indexable, where academic-deadlines is internal, unbranded and not.
const publicPassport = readFileSync(new URL('../examples/passport/library-hours.yml', import.meta.url), 'utf8');

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

test('Comms flags: brand marks only on an unbranded app, search competition only on an indexable one', () => {
  const ids = (text, tier) => request({ passportText: text, tier }).output_config.format.schema.properties.comms_flags.items.properties.id.enum;
  const internal = ids(passport, 'container');
  assert.ok(internal.includes('brand-marks'));
  assert.ok(!internal.includes('search-competition'));
  assert.ok(internal.includes('official-site-overlap') && internal.includes('audience-mismatch'));
  const external = ids(publicPassport, 'pages');
  assert.ok(external.includes('search-competition'));
  assert.ok(!external.includes('brand-marks'));
});

test('the system prompt carries the Comms rubric and the official sites, and still caches across apps', () => {
  const a = request({ passportText: passport });
  const b = request({ passportText: publicPassport });
  assert.deepEqual(a.system, b.system);
  const text = a.system.map((s) => s.text).join('\n');
  assert.match(text, /official-site-overlap/);
  assert.match(text, /WildcatSync/);
  assert.match(text, /https:\/\/catalog\.davidson\.edu\//);
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

test('history leads go in the user message: path, commit, line, and whether the file is still there', () => {
  const history = {
    files: [{ path: 'data/roster.csv', kind: 'data', present: false, commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' }],
    leads: [{ pattern: 'davidson-id', path: 'seed.js', commit: 'b'.repeat(40), line: 3, present: true, text: 'id: 800123456' }],
    totalLeads: 1,
  };
  const text = request({ history }).messages[0].content.map((c) => c.text ?? '').join('\n');
  assert.match(text, /data\/roster\.csv.*only in history.*a1b2c3d/);
  assert.match(text, /seed\.js, line 3.*Davidson ID/);
});

test('documents follow their label, in the user message, after the files', () => {
  const block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERg==' } };
  const documents = [{ path: 'reports/final.pdf', present: false, commit: 'c'.repeat(40), block }];
  const content = request({ documents }).messages[0].content;
  const at = content.findIndex((c) => c.type === 'document');
  assert.ok(at > 0);
  assert.deepEqual(content[at], block);
  assert.match(content[at - 1].text, /reports\/final\.pdf.*only in history.*ccccccc/);
});

test('the system prompt says how to judge history and documents', () => {
  const text = request().system.map((s) => s.text).join('\n');
  assert.match(text, /files that are only in the history still go public/i);
  assert.match(text, /the page number/i);
});

// A stand-in client: returns `message` from the stream's finalMessage().
const client = (message) => ({ beta: { messages: { stream: () => ({ finalMessage: async () => message }) } } });
const judgments = { summary: 'Fine.', flags: [], comms_flags: [], controls: [{ id: '4.3', status: 'met', evidence: 'server/api/x.ts checks the role.' }] };
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

import { completeJudgments } from '../assessor/assess.js';

test('with no LLM in the passport, the LLM-only controls are met from the passport, not left pending', () => {
  const done = completeJudgments({ summary: 's', flags: [], controls: [] }, { rubric, llm: false });
  const c = done.controls.find((x) => x.id === '5.5.4');
  assert.equal(c.status, 'met');
  assert.match(c.evidence, /no LLM/);
});

test('with an LLM, nothing is filled in: Claude has to judge those controls', () => {
  const done = completeJudgments({ summary: 's', flags: [], controls: [] }, { rubric, llm: true });
  assert.equal(done.controls.find((x) => x.id === '5.5.4'), undefined);
});

test('a refusal is left alone', () => {
  assert.deepEqual(completeJudgments({ refused: true }, { rubric, llm: false }), { refused: true });
});

// A client that rejects any request carrying a document whose data is 'BAD',
// the way the API answers an invalid PDF, and otherwise returns judgments.
function rejectingClient() {
  const sent = [];
  const stream = (req) => ({
    finalMessage: async () => {
      sent.push(req);
      const at = req.messages[0].content.findIndex((c) => c.source?.data === 'BAD');
      if (at >= 0) {
        const err = new Error(`400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.0.content.${at}.pdf.source.base64.data: The PDF specified was not valid."}}`);
        err.status = 400;
        throw err;
      }
      return message(JSON.stringify(judgments));
    },
  });
  return { client: { beta: { messages: { stream } } }, sent };
}

const doc = (path, data) => ({ path, present: true, commit: 'd'.repeat(40), block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } });

test('a document the API rejects is dropped and listed unread, and the review goes ahead', async () => {
  const { client, sent } = rejectingClient();
  const documents = [doc('good.pdf', 'JVBERg=='), doc('broken.pdf', 'BAD')];
  const result = await assessWithDocuments({ client, documents, build: (docs) => request({ documents: docs }) });
  assert.deepEqual(result.judgments, judgments);
  assert.deepEqual(result.unread.map((u) => [u.path, u.reason]), [['broken.pdf', "the Claude API couldn't read it"]]);
  assert.equal(sent.length, 2);
  assert.ok(sent[1].messages[0].content.some((c) => c.source?.data === 'JVBERg=='));
});

test('any other API error still fails loudly', async () => {
  const client = { beta: { messages: { stream: () => ({ finalMessage: async () => { const e = new Error('500 overloaded'); e.status = 500; throw e; } }) } } };
  await assert.rejects(assessWithDocuments({ client, documents: [], build: (docs) => request({ documents: docs }) }), /overloaded/);
});
