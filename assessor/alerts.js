// The open alerts GitHub already holds for an app: CodeQL, Dependabot and
// secret scanning. They become security flags in report.json, one per kind
// and severity, so the reviewers see them next to Claude's. A secret is
// always high: it's fixed with PE before deploy (pipeline.md, decision 35).
// A vulnerable dependency is medium at worst (decision 39).
// Hosted apps are public and have all three; a private repository usually
// has none, which leaves a low flag saying so.

import { dependencySeverity } from '../checks/audit.js';

const PER_PAGE = 100;
const ORDER = ['high', 'medium', 'low'];

const KINDS = [
  { id: 'alert-code-scanning', name: 'CodeQL', path: 'code-scanning', describe: describeCode, severity: codeSeverity },
  { id: 'alert-dependabot', name: 'Dependabot', path: 'dependabot', describe: describeDependency, severity: (a) => dependencySeverity(a.security_advisory?.severity), levels: { medium: 'high- or critical', low: 'moderate- or low' } },
  { id: 'alert-secret-scanning', name: 'secret scanning', path: 'secret-scanning', describe: describeSecret, severity: () => 'high' },
];

// github(path) answers { status, data }. Returns report flags.
export async function collectAlerts({ repository, github }) {
  const flags = [];
  const unreadable = [];
  for (const kind of KINDS) {
    const { status, data } = await github(`/repos/${repository}/${kind.path}/alerts?state=open&per_page=${PER_PAGE}`);
    if (status !== 200 || !Array.isArray(data)) {
      unreadable.push(kind.name);
      continue;
    }
    flags.push(...flagsFor(kind, data, repository));
  }
  if (unreadable.length > 0) {
    flags.push({
      id: 'alerts-unreadable',
      severity: 'low',
      detail: `The assessor couldn't read this repository's ${unreadable.join(' or ')} alerts. A private repository usually has none; for a public one, Information Security looks at its Security tab.`,
      evidence: `https://github.com/${repository}/security`,
    });
  }
  return flags;
}

function flagsFor(kind, alerts, repository) {
  const more = alerts.length >= PER_PAGE;
  return ORDER.flatMap((severity) => {
    const found = alerts.filter((a) => kind.severity(a) === severity);
    if (found.length === 0) return [];
    const count = more ? `${found.length} or more` : `${found.length}`;
    const what = kind.id === 'alert-secret-scanning'
      ? `GitHub found ${count} secret${found.length === 1 ? '' : 's'} still open: ${found.map(describeSecret).join('; ')}. Platform Engineering rotates ${found.length === 1 ? 'it' : 'them'} with you and cleans the history before the app deploys.`
      : `${kind.name} has ${count} open ${kind.levels?.[severity] ?? severity}-severity alert${found.length === 1 ? '' : 's'}: ${found.map(kind.describe).join('; ')}.`;
    return [{ id: kind.id, severity, detail: what, evidence: `https://github.com/${repository}/security/${kind.path}` }];
  });
}

function advisorySeverity(level) {
  if (level === 'critical' || level === 'high') return 'high';
  if (level === 'medium' || level === 'moderate') return 'medium';
  return 'low';
}

// CodeQL's security severity when the rule has one; otherwise an error is
// medium and a warning or note is low.
function codeSeverity(alert) {
  const level = alert.rule?.security_severity_level;
  if (level) return advisorySeverity(level);
  return alert.rule?.severity === 'error' ? 'medium' : 'low';
}

function describeCode(alert) {
  const where = alert.most_recent_instance?.location;
  const at = where?.path ? ` in ${where.path}${where.start_line ? `, line ${where.start_line}` : ''}` : '';
  return `${alert.rule?.description ?? 'a finding'} (${alert.rule?.id})${at}`;
}

function describeDependency(alert) {
  const name = alert.dependency?.package?.name ?? 'a package';
  const fixed = alert.security_vulnerability?.first_patched_version?.identifier;
  const fix = fixed ? `update it to ${fixed} or later` : 'there is no fixed version yet, so ask Platform Engineering';
  return `\`${name}\`, ${alert.security_advisory?.summary ?? 'a known vulnerability'} (${fix})`;
}

// Names the kind of secret only, never the secret itself.
function describeSecret(alert) {
  return `a ${alert.secret_type_display_name ?? alert.secret_type ?? 'secret'}`;
}
