// The assessor's call to Claude: it reads an app's passport, check results
// and source against the security rubric, and returns judgments only, which
// report.js assembles into report.json. One model, named here; effort low to
// start (pipeline.md, model selection), with the A/B against medium to come.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse, stringify } from 'yaml';

export const MODEL = 'claude-opus-5-5';
const EFFORT = 'low';
const MAX_TOKENS = 64000;
// About 700,000 tokens of source: what fits in one request with room for the
// prompt and the answer. A bigger app needs a different approach, not a cut.
const MAX_CHARS = 2_500_000;

const load = (path) => parse(readFileSync(new URL(path, import.meta.url), 'utf8'), { schema: 'yaml-1.1' });
// College Communications' rubric and the official sites it protects.
const COMMS = load('../rubrics/comms.yml');
const SITES = load('../official-sites.yml');

export const NOT_SOURCE = new Set(['node_modules', '.git', '.output', '.nuxt', 'dist', '.venv', '__pycache__', 'coverage']);
export const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'uv.lock']);

// Every text file in the app, by repository path. Binary files are skipped
// and listed; nothing is truncated.
export function collectSources(root, { maxChars = MAX_CHARS } = {}) {
  const files = [];
  const skipped = [];
  let total = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (NOT_SOURCE.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const rel = relative(root, path).split('\\').join('/');
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.isFile() || LOCKFILES.has(entry.name)) continue;
      const bytes = readFileSync(path);
      if (bytes.includes(0) || statSync(path).size > 1_000_000) { skipped.push(rel); continue; }
      const text = bytes.toString('utf8');
      total += text.length;
      if (total > maxChars) {
        throw new Error(`This app is too large for one assessment (over ${maxChars.toLocaleString('en-US')} characters of source). Platform Engineering reviews it by hand, and the assessor needs a different approach for apps this size.`);
      }
      files.push({ path: rel, text });
    }
  };
  walk(root);
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), skipped: skipped.sort() };
}

// The rubric items that apply to this app: its tier, and the LLM item only
// when the passport says the app calls one.
function itemsFor({ tier, rubric, llm }) {
  return rubric.items.filter((item) => item.tiers.includes(tier) && (item.when !== 'llm' || llm));
}

// The Comms items that apply: this tier, brand marks only when unbranded, and
// search competition only when indexable.
function commsItemsFor({ tier, comms, brand, indexable }) {
  return comms.items.filter((item) => item.tiers.includes(tier)
    && (item.when !== 'unbranded' || brand === 'unbranded')
    && (item.when !== 'indexable' || indexable === true));
}

const flagItems = (ids) => ({
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'severity', 'detail', 'evidence'],
    properties: {
      id: { enum: ids },
      severity: { enum: ['low', 'medium', 'high'] },
      detail: { type: 'string' },
      evidence: { type: 'string' },
    },
  },
});

function flagControlsFor({ tier, map }) {
  return map.controls.filter((c) => c.scope === 'app' && c.met_by[tier] === 'flag');
}

// What Claude returns. Only what structured outputs support: no length or
// pattern limits, no conditionals, additionalProperties false everywhere.
export function judgmentsSchema({ tier, rubric, map, llm, comms = COMMS, brand, indexable }) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'flags', 'comms_flags', 'controls'],
    properties: {
      summary: { type: 'string', description: 'One paragraph for the reviewers: what the app is, what data it handles, and what they should know.' },
      flags: flagItems(itemsFor({ tier, rubric, llm }).map((i) => i.id)),
      comms_flags: flagItems(commsItemsFor({ tier, comms, brand, indexable }).map((i) => i.id)),
      controls: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'status', 'evidence'],
          properties: {
            id: { enum: flagControlsFor({ tier, map }).map((c) => c.id) },
            status: { enum: ['met', 'not-met'] },
            evidence: { type: 'string' },
          },
        },
      },
    },
  };
}

// The stable part of the prompt: the same for every app on a tier, so it's
// cached. Everything that varies goes in the user message.
function systemPrompt({ tier, rubric, map, comms, sites }) {
  const items = rubric.items.filter((i) => i.tiers.includes(tier));
  const commsItems = comms.items.filter((i) => i.tiers.includes(tier));
  const official = sites.sites.map(({ name, url, purpose }) => ({ name, url, purpose }));
  const controls = flagControlsFor({ tier, map }).map(({ id, summary, how }) => ({ id, summary, how }));
  const where = tier === 'pages' ? 'a static GitHub Pages site holding only Public data, with no login and no server' : 'an Azure container app behind Davidson SSO';
  return [
    {
      type: 'text',
      text: `You review apps for Davidson College's Choreo platform before Information Security, College Communications and Platform Engineering decide whether to publish them. Davidson staff and students build these apps, mostly with AI coding tools, and most aren't professional developers. This app is ${where}.

Your job is to judge the app's code against the security rubric below, to decide each control listed below as met or not-met, and to judge it against College Communications' rubric, which protects the College's brand and its place in search. Deterministic checks (the passport, license, secrets, dependencies, build, indexing and accessibility) have already run; their results are in the request, and you don't repeat them.

How to judge:
- Raise a flag only for a problem you can point to. Evidence names the file and line, such as "server/api/notes.post.ts, line 14". A flag's detail says what's wrong and how to fix it, in plain words a non-developer can act on.
- Severity follows the definitions in the rubric: high is reserved for egregious missteps that are already harm, such as personal data disclosed or regulated data mishandled. Use the item's severity unless the evidence clearly warrants another by those definitions; say why in the detail when you change it.
- Decide every control listed. "met" needs evidence of what meets it; "not-met" needs evidence of the gap, and usually goes with a flag. A control that the app has nothing to do with (say, webhook signatures in an app with no webhooks) is met, with evidence saying why it doesn't arise.
- The prompt-injection item applies only when the passport's llm is set; judge it then and not otherwise.
- Never quote a secret, a credential, real personal data, or an internal hostname in your output, even when you're flagging it: say where it is and what kind of thing it is.
- The repository goes public with its whole history, and files that are only in the history still go public. The request lists leads from a scan of every commit (files and lines that look like personal data or internal details) and includes the documents and images from any commit; judge them under real-data-in-repository. A lead is only a place to look: a nine-digit number may be a constant, and an address may be the app's own contact. For a document, the evidence names the file and the page number; for something only in the history, it names the file and the commit, such as "data/roster.csv, removed but still in history at a1b2c3d". The fix for anything in the history is Platform Engineering rewriting it with the builder before the repository goes public.
- Comms flags go in comms_flags, not flags. The brand-marks item applies only when the passport's brand is unbranded, and search-competition only when indexable is true; judge them then and not otherwise. A Comms flag's detail tells the builder what to change, or that Comms will look.
- The summary is one paragraph for the three reviewers: what the app does and for whom, what data it touches, and the most important things to look at.`,
    },
    {
      type: 'text',
      text: `Severities:\n\n${stringify(rubric.severities)}\nSecurity rubric:\n\n${stringify(items)}\nControls to decide:\n\n${stringify(controls)}\nCollege Communications rubric:\n\n${stringify(commsItems)}\nOfficial College sites:\n\n${stringify(official)}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

const NAMES = { ssn: 'Social Security number', 'davidson-id': 'Davidson ID number', 'davidson-email': 'Davidson email address', 'private-ip': 'private IP address', 'internal-hostname': 'internal hostname' };
const where = ({ present, commit }) => (present ? 'in the current files' : `only in history, at ${commit.slice(0, 7)}`);

function historyText({ files = [], leads = [], totalLeads = 0 } = {}) {
  const listed = files.map((f) => `- ${f.path} (${f.kind}, ${where(f)})`).join('\n') || '- none';
  const found = leads.map((l) => `- ${l.path}, line ${l.line} (${where(l)}): looks like a ${NAMES[l.pattern]}: ${l.text}`).join('\n') || '- none';
  const more = totalLeads > leads.length ? `\n(${totalLeads} leads in all; the first ${leads.length} are shown.)` : '';
  return `From a scan of every commit in the repository's history.\n\nDocuments, images, Office and data files:\n${listed}\n\nLeads:\n${found}${more}`;
}

function userMessage({ passportText, checkResults, sources, history, documents = [], screenshots = [] }) {
  const checks = checkResults.map((r) => {
    if (r.skipped) return `- ${r.check}: skipped (${r.reason ?? 'no reason given'})`;
    if (r.problems.length > 0) return `- ${r.check}: failed: ${r.problems.join(' ')}`;
    return `- ${r.check}: passed${r.warnings.length ? `, with warnings: ${r.warnings.join(' ')}` : ''}`;
  }).join('\n');
  const skipped = sources.skipped.length ? `\n\nBinary or oversized files not shown: ${sources.skipped.join(', ')}.` : '';
  const files = sources.files.map((f) => `=== ${f.path} ===\n${f.text}`).join('\n\n');
  return [
    { type: 'text', text: `The app's passport (PASSPORT.yml):\n\n${passportText}` },
    { type: 'text', text: `Deterministic check results:\n\n${checks}${skipped}` },
    { type: 'text', text: `The app's files (${sources.files.length}):\n\n${files}` },
    { type: 'text', text: historyText(history) },
    ...documents.flatMap((d) => [{ type: 'text', text: `=== ${d.path} (${where(d)}) ===` }, d.block]),
    ...screenshots.flatMap((s) => [{ type: 'text', text: `=== Screenshot of the built app: ${s.page} ===` }, s.block]),
  ];
}

// Whether the passport says the app calls an LLM: `llm` set to anything but null.
export function hasLlm(passportText) {
  return /^llm:\s*(?!null\s*$)\S/m.test(passportText);
}

export function buildRequest({ tier, rubric, map, passportText, checkResults, sources, history, documents, screenshots, comms = COMMS, sites = SITES }) {
  const llm = hasLlm(passportText);
  const { brand, indexable } = parse(passportText, { schema: 'yaml-1.1' }) ?? {};
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // On a safety decline, the API re-runs the request on a fallback model
    // chosen by the decline's category, instead of returning the refusal.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: systemPrompt({ tier, rubric, map, comms, sites }),
    messages: [{ role: 'user', content: userMessage({ passportText, checkResults, sources, history, documents, screenshots }) }],
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: judgmentsSchema({ tier, rubric, map, llm, comms, brand, indexable }) },
    },
  };
}

// Controls judged only by `when: llm` rubric items are met from the passport
// when the app calls no LLM: that's a fact, not a judgment, so Claude isn't
// asked about them.
export function completeJudgments(judgments, { rubric, llm }) {
  if (judgments.refused || llm) return judgments;
  const judged = new Set(judgments.controls.map((c) => c.id));
  const llmOnly = rubric.items.filter((i) => i.when === 'llm').flatMap((i) => i.controls)
    .filter((id) => !judged.has(id) && !rubric.items.some((i) => i.when !== 'llm' && i.controls.includes(id)));
  const facts = llmOnly.map((id) => ({ id, status: 'met', evidence: "The passport's llm is null: the app calls no LLM, so this doesn't arise." }));
  return { ...judgments, controls: [...judgments.controls, ...facts] };
}

// Streams the request, so a long review can't hit an HTTP timeout, and
// returns the judgments, or { refused: true } when every model declined.
export async function runAssessment({ client, request }) {
  const message = await client.beta.messages.stream(request).finalMessage();
  const u = message.usage ?? {};
  console.log(`Tokens: ${u.input_tokens ?? 0} input, ${u.cache_read_input_tokens ?? 0} read from cache, ${u.cache_creation_input_tokens ?? 0} written to cache, ${u.output_tokens ?? 0} output. Model: ${message.model ?? request.model}.`);
  if (message.stop_reason === 'refusal') return { refused: true };
  if (message.stop_reason === 'max_tokens') {
    throw new Error(`The assessment was cut off at max_tokens (${request.max_tokens}); its judgments are incomplete, so no report was written.`);
  }
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const judgments = JSON.parse(text);
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(request.output_config.format.schema);
  if (!validate(judgments)) {
    throw new Error(`The assessor's judgments don't match their schema: ${JSON.stringify(validate.errors)}`);
  }
  return judgments;
}

// Runs the review with the documents, dropping any the API says it can't read
// (a malformed PDF in an old commit, say) and trying again, so one bad file
// leaves a person to open it instead of stopping the review. A rejected
// request isn't charged. build(documents) returns the request.
export async function assessWithDocuments({ client, documents, build }) {
  let kept = [...documents];
  const unread = [];
  for (;;) {
    const request = build(kept);
    try {
      return { request, judgments: await runAssessment({ client, request }), unread };
    } catch (err) {
      const at = err.status === 400 && Number(String(err.message).match(/messages\.0\.content\.(\d+)\.(?:pdf|image)/)?.[1]);
      const rejected = Number.isInteger(at) && kept.find((d) => d.block === request.messages[0].content[at]);
      if (!rejected) throw err;
      console.log(`The Claude API couldn't read ${rejected.path}; reviewing without it.`);
      kept = kept.filter((d) => d !== rejected);
      unread.push({ path: rejected.path, commit: rejected.commit, present: rejected.present, reason: "the Claude API couldn't read it" });
    }
  }
}
