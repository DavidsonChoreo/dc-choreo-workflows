import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleReport } from '../assessor/report.js';
import { loadControlMap } from '../checks/control-map.js';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const rubric = parse(readFileSync(new URL('../rubrics/security.yml', import.meta.url), 'utf8'));

const map = loadControlMap();
const ALL_CHECKS = ['passport', 'license', 'tier', 'files', 'secrets', 'dependencies', 'code', 'build-plan', 'audit', 'unused', 'build', 'indexing', 'accessibility'];
const passing = ALL_CHECKS.map((check) => ({ check, problems: [], warnings: [] }));

const base = {
  app: 'academic-deadlines',
  passportSha: 'a'.repeat(64),
  commit: 'b'.repeat(40),
  runUrl: 'https://github.com/DavidsonChoreo/dc-choreo-workflows/actions/runs/1',
  tier: 'container',
  map,
  rubric,
  checkResults: passing,
  // Campus-unbranded: the classification whose Comms step auto-completes.
  passport: { audience_scope: 'internal', brand: 'unbranded', indexable: false, custom_domain: null },
};

// Claude's judgments: every flag control on the tier met, no flags.
function cleanJudgments(tier = 'container') {
  const controls = map.controls
    .filter((c) => c.scope === 'app' && c.met_by[tier] === 'flag')
    .map((c) => ({ id: c.id, status: 'met', evidence: `Looked at it: fine for ${c.id}.` }));
  return { summary: 'A campus app for add and drop deadlines.', flags: [], comms_flags: [], controls };
}

const control = (report, id) => report.sections.security.controls.find((c) => c.id === id);

test('a clean app: every check passes, controls are filled in, and the report validates', () => {
  const report = assembleReport({ ...base, judgments: cleanJudgments() });
  assert.equal(report.report, 1);
  assert.equal(report.checks.length, ALL_CHECKS.length);
  assert.ok(report.checks.every((c) => c.result === 'pass'));
  assert.equal(control(report, '4.8').status, 'met');          // platform
  assert.equal(control(report, '1.13').status, 'met');         // check: license
  assert.equal(control(report, '4.3').status, 'met');          // flag, judged met
  assert.equal(control(report, '5.1.4').status, 'pending');    // attested
  assert.equal(control(report, '5.3.5').status, 'n/a');        // n/a on container
  assert.equal(control(report, '9.1'), undefined);             // process: not in reports
  assert.equal(report.sections.security.recommendation, 'approve');
});

test('platform says review until its rubric exists, so the report says review', () => {
  const report = assembleReport({ ...base, judgments: cleanJudgments() });
  assert.equal(report.sections.comms.recommendation, 'approve');
  assert.equal(report.sections.platform.recommendation, 'review');
  assert.equal(report.recommendation, 'review');
});

// The Comms step, by classification (College Communications' cheat sheet) and
// the extra triggers in pipeline.md: indexable, a custom domain, any flag.
const comms = (passport, { tier = 'container', judgments = cleanJudgments(tier) } = {}) =>
  assembleReport({ ...base, tier, passport: { ...base.passport, ...passport }, judgments }).sections.comms.recommendation;

test('Comms routing: campus-unbranded and public-unbranded auto-complete, public-branded always reviews', () => {
  assert.equal(comms({ audience_scope: 'internal', brand: 'unbranded' }), 'approve');
  assert.equal(comms({ audience_scope: 'external', brand: 'unbranded' }, { tier: 'pages' }), 'approve');
  assert.equal(comms({ audience_scope: 'external', brand: 'branded' }, { tier: 'pages' }), 'review');
});

test('Comms routing: campus-branded auto-completes behind SSO, reviews on a public Pages URL', () => {
  assert.equal(comms({ audience_scope: 'internal', brand: 'branded' }), 'approve');
  assert.equal(comms({ audience_scope: 'internal', brand: 'branded' }, { tier: 'pages' }), 'review');
});

test('Comms routing: indexable or a custom domain means review, whatever the classification', () => {
  assert.equal(comms({ audience_scope: 'external', brand: 'unbranded', indexable: true }, { tier: 'pages' }), 'review');
  assert.equal(comms({ custom_domain: 'hours.example.org' }), 'review');
});

test('Comms flags go in the Comms section, ask for review, and never block, even marked high', () => {
  const judgments = { ...cleanJudgments(), comms_flags: [{ id: 'brand-marks', severity: 'high', detail: 'The seal is in the header.', evidence: 'public/seal.png' }] };
  const report = assembleReport({ ...base, judgments });
  assert.deepEqual(report.sections.comms.flags.map((f) => f.id), ['brand-marks']);
  assert.equal(report.sections.comms.recommendation, 'review');
  assert.equal(report.sections.security.flags.length, 0);
  assert.notEqual(report.recommendation, 'block');
});

test('Comms reviews by hand when the assessor declined', () => {
  assert.equal(comms({}, { judgments: { refused: true } }), 'review');
});

test('a failed check fails its controls and blocks', () => {
  const checkResults = passing.map((r) => (r.check === 'license' ? { check: 'license', problems: ['No LICENSE file.'], warnings: [] } : r));
  const report = assembleReport({ ...base, checkResults, judgments: cleanJudgments() });
  assert.equal(report.checks.find((c) => c.id === 'license').result, 'fail');
  assert.match(report.checks.find((c) => c.id === 'license').evidence, /No LICENSE file/);
  assert.equal(control(report, '1.13').status, 'not-met');
  assert.equal(report.sections.security.recommendation, 'block');
  assert.equal(report.recommendation, 'block');
});

test('a skipped check leaves its controls pending and the section at review', () => {
  const checkResults = passing.map((r) => (r.check === 'accessibility' ? { check: 'accessibility', skipped: true, reason: 'No Chrome.' } : r));
  const report = assembleReport({ ...base, checkResults, judgments: cleanJudgments() });
  assert.equal(report.checks.find((c) => c.id === 'accessibility').result, 'skipped');
  assert.equal(control(report, '5.10.1').status, 'pending');
  assert.equal(report.sections.security.recommendation, 'review');
});

test('a high-severity flag blocks; a medium one asks for review; a low one does neither', () => {
  const flag = (severity) => ({ id: 'injection', severity, detail: 'Notes are rendered with v-html.', evidence: 'components/Note.vue, line 12.' });
  const at = (severity) => assembleReport({ ...base, judgments: { ...cleanJudgments(), flags: [flag(severity)] } }).sections.security.recommendation;
  assert.equal(at('high'), 'block');
  assert.equal(at('medium'), 'review');
  assert.equal(at('low'), 'approve');
});

// A flag control Claude marks not met takes the severity of the rubric
// item's flag: high blocks, medium (or no flag at all) asks for review, and
// low leaves the decision to the reviewers without holding the app up.
function notMet(id, flags) {
  const judgments = cleanJudgments();
  judgments.controls = judgments.controls.map((c) => (c.id === id ? { ...c, status: 'not-met', evidence: 'The gap is here.' } : c));
  judgments.flags = flags;
  return assembleReport({ ...base, judgments });
}
const flagged = (id, severity) => ({ id, severity, detail: 'What is wrong and how to fix it.', evidence: 'some/file.ts, line 3.' });

test('a flag control not met with a high flag blocks', () => {
  const report = notMet('4.3', [flagged('client-side-authorization', 'high')]);
  assert.equal(control(report, '4.3').status, 'not-met');
  assert.equal(report.sections.security.recommendation, 'block');
});

test('a flag control not met with a medium flag, or with no flag, asks for review', () => {
  assert.equal(notMet('5.4.3', [flagged('rate-limiting', 'medium')]).sections.security.recommendation, 'review');
  assert.equal(notMet('4.3', []).sections.security.recommendation, 'review');
});

test('a flag control not met with only a low flag does not hold the app up', () => {
  const report = notMet('5.11.11', [flagged('api-review', 'low')]);
  assert.equal(control(report, '5.11.11').status, 'not-met');
  assert.equal(report.sections.security.flags.length, 1);
  assert.equal(report.sections.security.recommendation, 'approve');
});

test('the highest flag on a control decides it', () => {
  // 5.4.6 is judged by unapproved-service; a high and a low flag on it means block.
  const report = notMet('5.4.6', [flagged('unapproved-service', 'low'), flagged('unapproved-service', 'high')]);
  assert.equal(report.sections.security.recommendation, 'block');
});

test('a flag control the assessor did not judge is pending, and the section says review', () => {
  const judgments = cleanJudgments();
  judgments.controls = judgments.controls.filter((c) => c.id !== '4.2');
  const report = assembleReport({ ...base, judgments });
  assert.equal(control(report, '4.2').status, 'pending');
  assert.match(control(report, '4.2').evidence, /didn't judge/);
  assert.equal(report.sections.security.recommendation, 'review');
});

test('a refused assessment leaves every flag control pending and says why', () => {
  const report = assembleReport({ ...base, judgments: { refused: true } });
  assert.equal(control(report, '4.3').status, 'pending');
  assert.match(report.summary, /couldn't judge/);
  assert.equal(report.sections.security.recommendation, 'review');
});

test('a Pages site gets the Pages column of the map', () => {
  const report = assembleReport({ ...base, tier: 'pages', judgments: cleanJudgments('pages') });
  assert.equal(control(report, '4.8').status, 'n/a');
  assert.equal(control(report, '5.5.2').status, 'met');
});

test('judgments for controls that are not flag controls on the tier are ignored', () => {
  const judgments = cleanJudgments();
  judgments.controls.push({ id: '4.8', status: 'not-met', evidence: 'should be ignored' });
  assert.equal(control(assembleReport({ ...base, judgments }), '4.8').status, 'met');
});

test('a report that would not validate throws instead of being written', () => {
  assert.throws(() => assembleReport({ ...base, app: 'Not A Slug', judgments: cleanJudgments() }), /report schema/);
});

const alert = (severity) => ({ id: 'alert-dependabot', severity, detail: `Dependabot has 1 open ${severity}-severity alert.`, evidence: 'https://github.com/DavidsonChoreo/academic-deadlines/security/dependabot' });

test("open alerts join the security flags after Claude's, and a high one blocks", () => {
  const judgments = cleanJudgments();
  judgments.flags.push({ id: 'injection', severity: 'low', detail: 'A string-built query.', evidence: 'server/db.ts, line 3' });
  const report = assembleReport({ ...base, judgments, extraFlags: [alert('high')] });
  assert.deepEqual(report.sections.security.flags.map((f) => f.id), ['injection', 'alert-dependabot']);
  assert.equal(report.sections.security.recommendation, 'block');
  assert.equal(report.recommendation, 'block');
});

test('a low alert stays in the report without holding the app up', () => {
  const report = assembleReport({ ...base, judgments: cleanJudgments(), extraFlags: [alert('low')] });
  assert.equal(report.sections.security.flags.length, 1);
  assert.equal(report.sections.security.recommendation, 'approve');
});

test('alerts stay in the report when the assessor declined', () => {
  const report = assembleReport({ ...base, judgments: { refused: true }, extraFlags: [alert('medium')] });
  assert.deepEqual(report.sections.security.flags.map((f) => f.id), ['alert-dependabot']);
});

test('a vulnerable dependency asks for review and never blocks (decision 39)', async () => {
  const { explainAudit } = await import('../checks/audit.js');
  const audit = explainAudit({
    vulnerabilities: {
      'node-forge': { name: 'node-forge', severity: 'high', via: [{ title: 'Signature forgery', severity: 'high' }], fixAvailable: false },
      'simple-git': { name: 'simple-git', severity: 'critical', via: [{ title: 'Command injection', severity: 'critical' }], fixAvailable: true },
    },
  });
  const checkResults = passing.map((r) => (r.check === 'audit' ? { check: 'audit', ...audit } : r));
  const report = assembleReport({ ...base, checkResults, judgments: cleanJudgments(), extraFlags: audit.flags });
  assert.equal(report.checks.find((c) => c.id === 'audit').result, 'pass');
  assert.deepEqual(report.sections.security.flags.map((f) => [f.id, f.severity]), [['dependency-audit', 'medium']]);
  assert.equal(report.sections.security.recommendation, 'review');
  assert.equal(report.recommendation, 'review');
});
