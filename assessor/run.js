// Runs the assessor: `node assessor/run.js <app dir> <results dir> <report path>`.
// Reads the app, its passport and the checks' results, asks Claude for its
// judgments, assembles report.json, and writes a readable summary to the job.
// Needs ANTHROPIC_API_KEY.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { parse, parseDocument } from 'yaml';
import { loadControlMap } from '../checks/control-map.js';
import { collectSources, buildRequest, runAssessment, completeJudgments, hasLlm } from './assess.js';
import { assembleReport } from './report.js';

// The checks the publish request runs, in report order. One with no result
// file didn't run: an earlier step stopped it, or the app's stack skips it.
const CHECKS = ['passport', 'license', 'tier', 'files', 'secrets', 'dependencies', 'code', 'build-plan', 'audit', 'unused', 'build', 'indexing', 'accessibility', 'workspace'];

const [appDir, resultsDir, reportPath] = process.argv.slice(2);
if (!appDir || !resultsDir || !reportPath) {
  console.error('usage: node assessor/run.js <app dir> <results dir> <report path>');
  process.exit(2);
}

const passportPath = join(appDir, 'PASSPORT.yml');
const passportBytes = existsSync(passportPath) ? readFileSync(passportPath) : null;
const passportDoc = passportBytes && parseDocument(passportBytes.toString('utf8'), { schema: 'yaml-1.1' });
const passport = passportDoc && passportDoc.errors.length === 0 ? passportDoc.toJS() : null;
if (!passport?.app || !['pages', 'container'].includes(passport.profile?.tier)) {
  stop('The assessor needs a readable passport with an `app` name and a `profile.tier` of pages or container. Fix the passport check first; no report was written.');
}

const checkResults = CHECKS.flatMap((check) => {
  const file = join(resultsDir, `${check}.json`);
  if (existsSync(file)) return [JSON.parse(readFileSync(file, 'utf8'))];
  // The workspace check only runs at the publish request; leave it out elsewhere.
  if (check === 'workspace') return [];
  return [{ check, skipped: true, reason: "Didn't run: an earlier step stopped it, or this app's stack skips it." }];
});

const map = loadControlMap();
const rubric = parse(readFileSync(new URL('../rubrics/security.yml', import.meta.url), 'utf8'));
const tier = passport.profile.tier;
const request = buildRequest({
  tier, rubric, map,
  passportText: passportBytes.toString('utf8'),
  checkResults,
  sources: collectSources(appDir),
});

const client = new Anthropic();
const judgments = completeJudgments(await runAssessment({ client, request }), { rubric, llm: hasLlm(passportBytes.toString('utf8')) });

const report = assembleReport({
  app: passport.app,
  passportSha: createHash('sha256').update(passportBytes).digest('hex'),
  commit: execFileSync('git', ['-C', appDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runUrl: `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  tier, map, rubric, checkResults, judgments,
});
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
// Claude's raw judgments, kept beside the report so a change to the
// assembly rules can be replayed on past runs without calling the model.
writeFileSync(join(dirname(reportPath), 'judgments.json'), `${JSON.stringify(judgments, null, 2)}\n`);
summarize(report);
console.log(`Report written to ${reportPath}: ${report.recommendation}.`);

function summarize({ app, recommendation, summary, checks, sections }) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const { security } = sections;
  const count = (status) => security.controls.filter((c) => c.status === status).length;
  const lines = [
    `## Assessor report: ${app}`,
    '',
    `**Recommendation: ${recommendation}.** Security says ${security.recommendation}; Comms and Platform Engineering review by hand until their rubrics exist.`,
    '',
    summary,
    '',
    `Checks: ${checks.filter((c) => c.result === 'pass').length} passed, ${checks.filter((c) => c.result === 'fail').length} failed, ${checks.filter((c) => c.result === 'skipped').length} skipped.`,
    `Controls: ${count('met')} met, ${count('not-met')} not met, ${count('pending')} pending, ${count('n/a')} not applicable.`,
    '',
  ];
  if (security.flags.length > 0) {
    lines.push('| Flag | Severity | Detail | Evidence |', '|---|---|---|---|');
    for (const f of security.flags) lines.push(`| ${f.id} | ${f.severity} | ${f.detail.replaceAll('|', '\\|')} | ${f.evidence.replaceAll('|', '\\|')} |`);
    lines.push('');
  }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

function stop(message) {
  console.log(`::error title=Assessor::${message}`);
  process.exit(1);
}
