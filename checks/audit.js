// The audit check explains `npm audit --json`. It never fails: a vulnerable
// dependency is a medium finding at worst, which asks for a person's review
// at the publish request, not a block (pipeline.md, decision 40). Every
// finding is a warning naming the package and the fix, and the assessor
// gets them as flags: high and critical as medium, moderate and low as low.

export function explainAudit(report) {
  const warnings = [];
  const found = [];

  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    const advisories = entry.via.filter((via) => typeof via === 'object');
    const through = entry.via.filter((via) => typeof via === 'string');
    const what = advisories.length > 0
      ? advisories.map((a) => a.title).join('; ')
      : `it depends on ${through.map((dep) => `\`${dep}\``).join(', ')}, which has one`;
    const fix = entry.fixAvailable === false
      ? 'There is no fixed version yet; Platform Engineering reviews it with you at the publish request.'
      : typeof entry.fixAvailable === 'object' && entry.fixAvailable.name === name
        ? `Update it to ${entry.fixAvailable.version} or later, with \`npm audit fix\`.`
        : 'Run `npm audit fix` to update it.';
    warnings.push(`\`${name}\` has a ${entry.severity}-severity vulnerability: ${what}. ${fix}`);
    found.push({ name, severity: entry.severity, fixed: entry.fixAvailable !== false });
  }

  return { ok: true, problems: [], warnings, flags: auditFlags(found) };
}

// Dependency findings are medium at worst: high and critical become medium,
// everything else low. Dependabot's alerts use the same rule (assessor/alerts.js).
export function dependencySeverity(level) {
  return level === 'critical' || level === 'high' ? 'medium' : 'low';
}

function auditFlags(found) {
  return ['medium', 'low'].flatMap((severity) => {
    const these = found.filter((f) => dependencySeverity(f.severity) === severity);
    if (these.length === 0) return [];
    const list = these.map((f) => `\`${f.name}\` (${f.severity}${f.fixed ? '' : ', no fix yet'})`).join(', ');
    return [{
      id: 'dependency-audit',
      severity,
      detail: `npm audit found ${these.length} vulnerable package${these.length === 1 ? '' : 's'}: ${list}. A person weighs whether any of it ships and can be reached.`,
      evidence: 'package-lock.json',
    }];
  });
}
