// Runs the passport check at an app's root, as CI does: each problem becomes a
// GitHub annotation on PASSPORT.yml and a line in the job summary.

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { checkPassport } from './passport.js';

const file = 'PASSPORT.yml';

const { ok, problems } = existsSync(file)
  ? checkPassport(readFileSync(file, 'utf8'))
  : {
    ok: false,
    problems: [{
      field: null,
      message: 'This repository has no PASSPORT.yml at its root. Every Choreo app needs one: ask the Choreo plugin to write it, or contact Platform Engineering.',
    }],
  };

for (const { message } of problems) {
  console.log(`::error file=${file},title=Passport::${escape(message)}`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = ok
    ? '### Passport check passed\n'
    : `### Passport check found ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}\n\n${problems.map((p) => `- ${p.message}`).join('\n')}\n`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

process.exitCode = ok ? 0 : 1;

// GitHub workflow commands end at a newline, so these characters are encoded.
function escape(text) {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}
