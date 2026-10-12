// The code checks (pipeline.md, deterministic checks): plain http:// calls,
// CORS open to any website, and WCAG 2.1 AA accessibility, which Davidson is
// bound to and which blocks (decision 36).

// http:// addresses that aren't calls: the machine itself, and the XML and
// JSON Schema namespace names that are http:// by definition.
const ALLOWED_HTTP = /^http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|(www\.)?w3\.org|json-schema\.org|(www\.)?sitemaps\.org|schemas\.xmlsoap\.org|schemas\.microsoft\.com|schemas\.openxmlformats\.org|purl\.org)([:/'"`\s]|$)/i;

// `files` is { path, text } for each source and config file.
export function scanHttp(files) {
  const problems = [];
  for (const { path, text } of files) {
    text.split('\n').forEach((line, index) => {
      const urls = line.match(/http:\/\/[^\s'"`<>)]+/g) ?? [];
      const offending = urls.filter((url) => !ALLOWED_HTTP.test(url));
      if (offending.length > 0) {
        problems.push({
          file: path,
          line: index + 1,
          message: `\`${offending[0]}\` uses plain http://, so anything sent or received can be read or changed on the way. Use https:// instead.`,
        });
      }
    });
  }
  return { ok: problems.length === 0, problems, warnings: [] };
}

const OPEN_CORS = [
  /['"]Access-Control-Allow-Origin['"]\s*[,:]\s*['"]\*['"]/i,
  /\bcors\s*\(\s*\)/,
  /\bcors\s*\(\s*\{[^}]*\borigin\s*:\s*(['"]\*['"]|true\b)/,
  /\bcors\s*:\s*true\b/,
  /\ballow_origins\s*=\s*\[\s*['"]\*['"]/,
  /\bCORS\s*\(\s*app\s*\)/,
];

export function scanCors(files) {
  const problems = [];
  for (const { path, text } of files) {
    text.split('\n').forEach((line, index) => {
      if (OPEN_CORS.some((pattern) => pattern.test(line))) {
        problems.push({
          file: path,
          line: index + 1,
          message: 'This lets any website call the app from a visitor\'s browser, and read what it gets back. Name the origins that need access, such as `https://www.davidson.edu`, or remove CORS if only the app itself calls its API.',
        });
      }
    });
  }
  return { ok: problems.length === 0, problems, warnings: [] };
}

// `pages` is { page, result } per page, where result is axe's, run with the
// WCAG 2.0 and 2.1 A and AA rules. Every violation fails; what axe can't decide alone
// is one warning for a person to check.
export function explainAxe(pages) {
  const byRule = new Map();
  const undecided = new Set();
  for (const { page, result } of pages) {
    for (const violation of result.violations) {
      const entry = byRule.get(violation.id) ?? { violation, pages: [], elements: 0 };
      entry.pages.push(page);
      entry.elements += violation.nodes.length;
      byRule.set(violation.id, entry);
    }
    for (const item of result.incomplete) undecided.add(item.id);
  }

  const problems = [...byRule.values()].map(({ violation, pages: where, elements }) =>
    `Accessibility (WCAG 2.1 AA): ${violation.help}. Found on ${elements} ${elements === 1 ? 'element' : 'elements'}, on ${where.map((p) => `\`${p}\``).join(', ')}. How to fix it: ${violation.helpUrl}`);
  const warnings = undecided.size > 0
    ? [`Some accessibility rules need a person to check, because a tool can't decide them alone: ${[...undecided].join(', ')}. Check these by hand before publishing.`]
    : [];
  return { ok: problems.length === 0, problems, warnings };
}
