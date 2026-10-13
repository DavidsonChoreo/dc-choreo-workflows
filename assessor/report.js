// Assembles report.json from what the publish request found: the
// deterministic checks' results, the control map, and Claude's judgments.
// Claude never writes the report itself; this code does, and the result has
// to validate against the frozen report schema or nothing is written.

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { controlsFor } from '../checks/control-map.js';

const reportSchema = JSON.parse(readFileSync(new URL('../schemas/report/v1.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
addFormats(ajv);
const validate = ajv.compile(reportSchema);

// checkResults: { check, problems, warnings } per check, or { check, skipped, reason }.
// judgments: { summary, flags, controls: [{ id, status, evidence }] }, or { refused: true }.
// extraFlags: flags code found, not Claude: GitHub's open alerts (alerts.js) and
// documents it couldn't read (documents.js). Kept even when Claude declined.
// passport: the parsed passport; Comms' routing reads its classification.
export function assembleReport({ app, passportSha, commit, runUrl, tier, map, rubric, checkResults, judgments, passport, extraFlags = [] }) {
  const results = new Map(checkResults.map((r) => [r.check, r]));
  const checks = checkResults.map(reportCheck);
  const how = new Map(map.controls.map((c) => [c.id, c]));
  const judged = new Map(judgments.refused ? [] : (judgments.controls ?? []).map((j) => [j.id, j]));

  const controls = controlsFor(map, tier).map(({ id, met_by }) => {
    switch (met_by) {
      case 'n/a':
        return { id, met_by, status: 'n/a', evidence: `Doesn't apply to a ${tier === 'pages' ? 'Pages site' : 'container app'}.` };
      case 'platform':
        return { id, met_by, status: 'met', evidence: how.get(id).how };
      case 'attested':
        return { id, met_by, status: 'pending', evidence: 'The builder confirms it on the ready-call form.' };
      case 'check':
        return { id, met_by, ...fromChecks(how.get(id).checks, results) };
      default: {
        const judgment = judged.get(id);
        if (judgment) return { id, met_by, status: judgment.status, evidence: judgment.evidence };
        const why = judgments.refused ? 'The assessor declined to judge this app' : "The assessor didn't judge this item";
        return { id, met_by, status: 'pending', evidence: `${why}; Information Security reviews it by hand.` };
      }
    }
  });

  const flags = [...(judgments.refused ? [] : judgments.flags ?? []), ...extraFlags];
  const security = { controls, flags, recommendation: securityRecommendation(controls, flags, rubric) };
  const commsFlags = judgments.refused ? [] : judgments.comms_flags ?? [];
  // Screenshots go to Comms as Kuali attachments, not links here (#89).
  const comms = { flags: commsFlags, screenshots: [], recommendation: commsRecommendation({ tier, passport, flags: commsFlags, refused: judgments.refused }) };
  // The PE rubric isn't built yet, so a person reviews that section.
  const platform = { flags: [], recommendation: 'review' };

  const summary = judgments.refused
    ? 'The assessor couldn\'t judge this app: the model declined the request. The deterministic checks ran as usual; Information Security reviews the code by hand.'
    : judgments.summary;

  const report = {
    report: 1,
    app,
    passport_sha: passportSha,
    commit,
    run_url: runUrl,
    summary,
    checks,
    sections: { security, comms, platform },
    recommendation: overall(checks, [security, comms, platform]),
  };

  if (!validate(report)) {
    throw new Error(`The assembled report doesn't match the report schema: ${ajv.errorsText(validate.errors)}`);
  }
  return report;
}

function reportCheck(result) {
  if (result.skipped) return { id: result.check, result: 'skipped', evidence: result.reason ?? 'Skipped.' };
  if (result.problems.length > 0) return { id: result.check, result: 'fail', evidence: result.problems.join(' ') };
  const warned = result.warnings.length > 0 ? ` Warnings: ${result.warnings.join(' ')}` : '';
  return { id: result.check, result: 'pass', evidence: `Passed.${warned}` };
}

// A control met by checks is not met when any of them failed, pending when
// any didn't run, and met when all passed.
function fromChecks(names, results) {
  const found = names.map((name) => [name, results.get(name)]);
  const failed = found.filter(([, r]) => r && !r.skipped && r.problems.length > 0).map(([n]) => n);
  const missing = found.filter(([, r]) => !r || r.skipped).map(([n]) => n);
  if (failed.length > 0) return { status: 'not-met', evidence: `Failed: the ${failed.join(' and ')} check.` };
  if (missing.length > 0) return { status: 'pending', evidence: `Didn't run: the ${missing.join(' and ')} check.` };
  return { status: 'met', evidence: `Passed: the ${names.join(' and ')} check.` };
}

// Block on a high flag or a control a failed check left not met. A control
// Claude marks not met takes the severity of the highest flag raised by a
// rubric item that judges it: high blocks, medium asks for review, low stays
// in the report for the reviewers without holding the app up, and none at
// all asks for review. Review too on a medium flag or a pending check.
// Attested items don't count: the ready-call form collects them.
const RANK = { low: 1, medium: 2, high: 3 };

function securityRecommendation(controls, flags, rubric) {
  // The highest severity among flags from the rubric items that judge `id`, or null.
  const severityOf = (id) => {
    const items = new Set(rubric.items.filter((i) => i.controls.includes(id)).map((i) => i.id));
    const severities = flags.filter((f) => items.has(f.id)).map((f) => f.severity);
    return severities.sort((a, b) => RANK[b] - RANK[a])[0] ?? null;
  };
  const judgedNotMet = controls.filter((c) => c.met_by === 'flag' && c.status === 'not-met').map((c) => severityOf(c.id));

  if (flags.some((f) => f.severity === 'high')) return 'block';
  if (controls.some((c) => c.met_by === 'check' && c.status === 'not-met')) return 'block';
  if (judgedNotMet.some((s) => s === 'high')) return 'block';
  if (flags.some((f) => f.severity === 'medium')) return 'review';
  if (judgedNotMet.some((s) => s === null || s === 'medium')) return 'review';
  if (controls.some((c) => c.status === 'pending' && c.met_by !== 'attested')) return 'review';
  return 'approve';
}

// Whether College Communications reviews, from the classification (Comms'
// Site Passport cheat sheet) and pipeline.md's triggers: public-branded always;
// campus-branded only on the Pages tier, where its URL is public; anything
// indexable or on a custom domain; and any Comms flag, or no judgment at all.
// Otherwise their step auto-completes. Comms flags ask for review and never block.
function commsRecommendation({ tier, passport, flags, refused }) {
  const { audience_scope: audience, brand, indexable, custom_domain: domain } = passport;
  if (refused || flags.length > 0) return 'review';
  if (brand === 'branded' && (audience === 'external' || tier === 'pages')) return 'review';
  if (indexable === true || domain) return 'review';
  return 'approve';
}

// The schema's rule: a failed check or a section saying block means block,
// a section saying review means review, otherwise approve.
function overall(checks, sections) {
  if (checks.some((c) => c.result === 'fail') || sections.some((s) => s.recommendation === 'block')) return 'block';
  if (sections.some((s) => s.recommendation === 'review')) return 'review';
  return 'approve';
}
