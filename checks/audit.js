// The audit check explains `npm audit --json`. High and critical
// vulnerabilities fail; moderate and low pass with a warning
// (pipeline.md, deterministic checks: "npm audit clean of high and critical").

const BLOCKING = new Set(['high', 'critical']);

export function explainAudit(report) {
  const problems = [];
  const warnings = [];

  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    const advisories = entry.via.filter((via) => typeof via === 'object');
    const through = entry.via.filter((via) => typeof via === 'string');
    const what = advisories.length > 0
      ? advisories.map((a) => a.title).join('; ')
      : `it depends on ${through.map((dep) => `\`${dep}\``).join(', ')}, which has one`;
    const fix = entry.fixAvailable === false
      ? 'There is no fixed version yet; ask Platform Engineering what to do.'
      : typeof entry.fixAvailable === 'object' && entry.fixAvailable.name === name
        ? `Update it to ${entry.fixAvailable.version} or later, with \`npm audit fix\`.`
        : 'Run `npm audit fix` to update it.';
    const message = `\`${name}\` has a ${entry.severity}-severity vulnerability: ${what}. ${fix}`;
    (BLOCKING.has(entry.severity) ? problems : warnings).push(message);
  }

  return { ok: problems.length === 0, problems, warnings };
}
