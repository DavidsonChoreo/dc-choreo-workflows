// The governance-file check: AGENTS.md and CLAUDE.md are Platform
// Engineering's, and every app carries a released copy of each. A copy
// passes when it matches the hash of any released version in
// canonical/hashes.json, so apps on an older package version still pass.

import { createHash } from 'node:crypto';

// Line endings are normalized first, so a Windows checkout isn't an edit.
export function hashOf(text) {
  return createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
}

export function checkFiles({ files, hashes }) {
  const problems = [];

  for (const [path, text] of Object.entries(files)) {
    if (text === null) {
      problems.push(`\`${path}\` is missing. Platform Engineering owns it, and every Choreo app carries it. Restore it with the package's update command, or ask Platform Engineering.`);
      continue;
    }
    const known = (hashes[path] ?? []).map((entry) => entry.sha256);
    if (!known.includes(hashOf(text))) {
      problems.push(`\`${path}\` has been edited. Platform Engineering owns it, so restore it with the package's update command. Your own notes for this repository belong in \`BUILDER.md\`.`);
    }
  }

  return { ok: problems.length === 0, problems, warnings: [] };
}
