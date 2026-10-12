// The dependency checks (pipeline.md, deterministic checks):
// - every new dependency exists on the registry, and a very new one warns,
//   since an AI-invented name can be registered by someone else;
// - no workflow auto-merges pull requests, Dependabot's included;
// - no runtime is past end of life, by endoflife.date;
// - unused dependencies warn, from knip.

const DAY = 24 * 60 * 60 * 1000;
const NEW_PACKAGE_DAYS = 30;
const EOL_SOON_DAYS = 90;
const PRODUCT_NAMES = { nodejs: 'Node.js', python: 'Python' };

// Dependency names in `head` that aren't in `base`. With no base, such as at
// the publish request, every dependency is new to Choreo.
export function newDependencies(base, head) {
  const names = (pkg) => [...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})];
  const before = new Set(names(base));
  return names(head).filter((name) => !before.has(name));
}

// `lookups` is one { name, exists, created } per new dependency, from the npm registry.
export function checkRegistry(lookups, now) {
  const problems = [];
  const warnings = [];
  for (const { name, exists, created } of lookups) {
    if (!exists) {
      problems.push(`\`${name}\` doesn't exist on the npm registry. Check the spelling: AI tools sometimes suggest packages that were never published, and someone can later publish malware under that name. Remove it, or replace it with the package you meant.`);
      continue;
    }
    const age = Math.floor((now - new Date(created)) / DAY);
    if (age < NEW_PACKAGE_DAYS) {
      warnings.push(`\`${name}\` was first published ${age} ${age === 1 ? 'day' : 'days'} ago. Make sure it's the package you meant and that you trust who published it.`);
    }
  }
  return { ok: problems.length === 0, problems, warnings };
}

const AUTO_MERGE = [
  /gh\s+pr\s+merge\b[^\n]*--auto\b/,
  /enable-pull-request-automerge/,
  /automerge-action/,
  /dependabot-auto-merge/,
  /enablePullRequestAutoMerge/,
];

// `workflows` is { path, text } for each file in .github/workflows.
export function checkAutoMerge(workflows) {
  const problems = workflows
    .filter(({ text }) => AUTO_MERGE.some((pattern) => pattern.test(text)))
    .map(({ path }) => ({
      file: path,
      message: `\`${path}\` turns on auto-merge, so pull requests, Dependabot's included, can merge without anyone reading them. Remove the auto-merge step: dependency updates are merged by a person, who reads the changelog first.`,
    }));
  return { ok: problems.length === 0, problems, warnings: [] };
}

// The Node and Python versions an app runs on, from package.json `engines`,
// .nvmrc and the Containerfile's base images.
export function runtimesOf({ packageJson, nvmrc, containerfile }) {
  const runtimes = [];
  const engine = packageJson?.engines?.node?.match(/(\d+)/);
  if (engine) runtimes.push({ product: 'nodejs', cycle: engine[1], source: 'package.json engines' });
  const nvm = nvmrc?.trim().match(/^v?(\d+)/);
  if (nvm) runtimes.push({ product: 'nodejs', cycle: nvm[1], source: '.nvmrc' });
  for (const [, image, tag] of (containerfile ?? '').matchAll(/^\s*FROM\s+(?:--\S+\s+)*(?:docker\.io\/)?(?:library\/)?(node|python):([^\s@]+)/gim)) {
    const cycle = image === 'node' ? tag.match(/^(\d+)/)?.[1] : tag.match(/^(\d+\.\d+)/)?.[1];
    if (cycle) runtimes.push({ product: image === 'node' ? 'nodejs' : 'python', cycle, source: 'Containerfile' });
  }
  return runtimes;
}

// `cycles` is endoflife.date's data: { nodejs: [...], python: [...] }.
export function checkEndOfLife(runtimes, cycles, now) {
  const problems = [];
  const warnings = [];
  for (const { product, cycle, source } of runtimes) {
    const name = `${PRODUCT_NAMES[product]} ${cycle}`;
    const entry = (cycles[product] ?? []).find((c) => String(c.cycle) === cycle);
    if (!entry) {
      warnings.push(`${name} (from ${source}) isn't a release endoflife.date knows, so its support dates couldn't be checked.`);
      continue;
    }
    if (entry.eol === false || entry.eol === true) {
      if (entry.eol === true) problems.push(`${name} (from ${source}) is past end of life and no longer gets security fixes. Move to a supported release.`);
      continue;
    }
    const eol = new Date(entry.eol);
    if (eol <= now) {
      problems.push(`${name} (from ${source}) reached end of life on ${entry.eol} and no longer gets security fixes. Move to a supported release.`);
    } else if (eol - now < EOL_SOON_DAYS * DAY) {
      warnings.push(`${name} (from ${source}) reaches end of life on ${entry.eol}. Plan the move to a newer release before then.`);
    }
  }
  return { ok: problems.length === 0, problems, warnings };
}

// knip's JSON report: unused dependencies become warnings, since a tool can
// miss a dependency that's used in a way it doesn't understand.
export function explainUnused(report) {
  const warnings = [];
  for (const issue of report.issues ?? []) {
    for (const kind of ['dependencies', 'devDependencies']) {
      for (const { name } of issue[kind] ?? []) {
        warnings.push(`\`${name}\` is listed in package.json but nothing seems to use it. If it's really unused, remove it; every dependency is something to keep patched.`);
      }
    }
  }
  return { ok: true, problems: [], warnings };
}
