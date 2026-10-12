import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleReport } from '../assessor/report.js';
import { loadControlMap } from '../checks/control-map.js';

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
  checkResults: passing,
};

// Claude's judgments: every flag control on the tier met, no flags.
function cleanJudgments(tier = 'container') {
  const controls = map.controls
    .filter((c) => c.scope === 'app' && c.met_by[tier] === 'flag')
    .map((c) => ({ id: c.id, status: 'met', evidence: `Looked at it: fine for ${c.id}.` }));
  return { summary: 'A campus app for add and drop deadlines.', flags: [], controls };
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

test('comms and platform say review until their rubrics exist, so the report says review', () => {
  const report = assembleReport({ ...base, judgments: cleanJudgments() });
  assert.equal(report.sections.comms.recommendation, 'review');
  assert.equal(report.sections.platform.recommendation, 'review');
  assert.equal(report.recommendation, 'review');
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

test('a flag control judged not met blocks', () => {
  const judgments = cleanJudgments();
  judgments.controls = judgments.controls.map((c) => (c.id === '4.3' ? { ...c, status: 'not-met', evidence: 'server/api/x.post.ts has no role check.' } : c));
  const report = assembleReport({ ...base, judgments });
  assert.equal(control(report, '4.3').status, 'not-met');
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
