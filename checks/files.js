// The governance-file check: AGENTS.md and CLAUDE.md are Platform
// Engineering's, and every app carries a released copy of each, as every
// container app does of the deploy stub. A copy passes when it matches the hash of any released version in
// canonical/hashes.json, so apps on an older package version still pass.

import { createHash } from 'node:crypto';

// Line endings are normalized first, so a Windows checkout isn't an edit.
export function hashOf(text) {
  return createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
}

export const DEPLOY_STUB = '.github/workflows/deploy.yml';

export function checkFiles({ files, hashes }) {
  const problems = [];

  for (const [path, text] of Object.entries(files)) {
    if (text === null) {
      problems.push(`\`${path}\` is missing. Platform Engineering owns it, and every Choreo app carries it. Restore it with the package's update command, or ask Platform Engineering.`);
      continue;
    }
    const known = (hashes[path] ?? []).map((entry) => entry.sha256);
    if (!known.includes(hashOf(text))) {
      problems.push(path === DEPLOY_STUB
        ? `\`${path}\` has been edited. It's the deploy stub Platform Engineering owns, and it deploys your app the way it was reviewed, so restore it with the package's update command. If your app needs to deploy differently, ask Platform Engineering.`
        : `\`${path}\` has been edited. Platform Engineering owns it, so restore it with the package's update command. Your own notes for this repository belong in \`BUILDER.md\`.`);
    }
  }

  return { ok: problems.length === 0, problems, warnings: [] };
}

// CODEOWNERS has to give PASSPORT.yml, AGENTS.md and CLAUDE.md to Platform
// Engineering, so every change to them needs PE's approval (pipeline.md,
// decision 15). In CODEOWNERS the last matching line wins, so the check reads
// the last line that matches each file. It understands exact paths and the
// catch-alls `*`, `/*` and `**`; a builder's own patterns for other paths
// don't matter to it.
export const PE_TEAM = '@DavidsonChoreo/platform-engineering';
const GOVERNED = ['PASSPORT.yml', 'AGENTS.md', 'CLAUDE.md'];
const CATCH_ALL = new Set(['*', '/*', '**', '/**']);

export function checkCodeowners(text) {
  if (text === null) {
    return {
      ok: false,
      problems: [`This repository has no CODEOWNERS file. It makes Platform Engineering's approval required for changes to ${GOVERNED.map((f) => `\`${f}\``).join(', ')}. Restore it with the package's update command.`],
      warnings: [],
    };
  }

  const rules = text.split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern, owners };
    });

  const problems = [];
  for (const file of GOVERNED) {
    const last = rules.filter(({ pattern }) => CATCH_ALL.has(pattern) || pattern.replace(/^\//, '') === file).at(-1);
    if (!last) {
      problems.push(`CODEOWNERS doesn't name an owner for \`${file}\`. Add the line \`/${file} ${PE_TEAM}\`, or restore CODEOWNERS with the package's update command.`);
    } else if (!last.owners.includes(PE_TEAM)) {
      problems.push(`In CODEOWNERS, the last line matching \`${file}\` is \`${last.pattern} ${last.owners.join(' ')}\`, which leaves out ${PE_TEAM}. The last matching line wins, so put \`/${file} ${PE_TEAM}\` after it, or add ${PE_TEAM} to that line.`);
    }
  }
  return { ok: problems.length === 0, problems, warnings: [] };
}
