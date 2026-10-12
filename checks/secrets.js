// The secrets check explains a gitleaks report of the full git history.
// A secret in any commit counts, even one deleted later: the history goes
// public with the repository. Platform Engineering works with the builder to
// rotate the secret and rewrite the history before the app is deployed
// (pipeline.md, decision 35). Messages never carry the secret, which gitleaks
// redacts, or the commit's author.

const ACRONYMS = new Set(['aws', 'api', 'gcp', 'jwt', 'pat', 'ssh', 'pgp', 'rsa', 'oauth', 'url', 'id', 'sas']);

export function explainSecrets(findings) {
  // One secret seen in several commits is one problem, reported at its first commit.
  const bySecret = new Map();
  for (const finding of [...findings].sort((a, b) => a.Date.localeCompare(b.Date))) {
    const key = `${finding.File}:${finding.RuleID}:${finding.StartLine}`;
    if (!bySecret.has(key)) bySecret.set(key, finding);
  }

  const problems = [...bySecret.values()].map((finding) => ({
    file: finding.File,
    line: finding.StartLine,
    message: `What looks like ${describe(finding.RuleID)} was committed to \`${finding.File}\` at line ${finding.StartLine}, in commit ${finding.Commit.slice(0, 7)}. Deleting it now isn't enough: it stays in the git history, and the history goes public with the repository. Don't use it again. Platform Engineering will work with you to rotate the secret and rewrite the history before the app is deployed.`,
  }));

  return { ok: problems.length === 0, problems, warnings: [] };
}

// "aws-access-token" -> "an AWS access token". An acronym is read letter by
// letter, so its article follows how its first letter sounds.
function describe(ruleId) {
  const words = ruleId.split('-').map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word));
  const phrase = words.join(' ');
  const vowelSound = ACRONYMS.has(ruleId.split('-')[0]) ? /^[AEFHILMNORSX]/.test(phrase) : /^[aeiou]/i.test(phrase);
  return `${vowelSound ? 'an' : 'a'} ${phrase}`;
}
