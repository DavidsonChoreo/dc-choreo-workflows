// Runs one check at an app's root, as CI does: `node checks/cli.js <check>`.
// Each problem becomes an error annotation and each warning a warning
// annotation, on the file it's about, and both go into the job summary.
// Exits 1 when the check finds a problem.

import { existsSync, readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { parseDocument } from 'yaml';
import { checkPassport } from './passport.js';
import { checkLicense } from './license.js';
import { checkTier } from './tier.js';
import { checkFiles, checkCodeowners } from './files.js';
import { explainSecrets } from './secrets.js';
import { explainAudit } from './audit.js';
import { checkIndexing } from './indexing.js';
import { scanHttp, scanCors, explainAxe } from './code.js';
import { newDependencies, checkRegistry, checkAutoMerge, checkEndOfLife, runtimesOf, explainUnused } from './dependencies.js';

const CHECKS = {
  passport: { title: 'Passport', run: runPassport },
  license: { title: 'License', run: runLicense },
  tier: { title: 'Tier', run: runTier },
  files: { title: 'Governance files', run: runFiles },
  secrets: { title: 'Secrets', run: runSecrets },
  'build-plan': { title: 'Build', run: runBuildPlan },
  audit: { title: 'Dependencies', run: runAudit },
  indexing: { title: 'Indexing', run: runIndexing },
  dependencies: { title: 'Dependencies', run: runDependencies },
  unused: { title: 'Dependencies', run: runUnused },
  code: { title: 'Code', run: runCode },
  accessibility: { title: 'Accessibility', run: runAccessibility },
};


function runPassport() {
  const file = 'PASSPORT.yml';
  if (!existsSync(file)) {
    return {
      file,
      problems: ['This repository has no PASSPORT.yml at its root. Every Choreo app needs one: ask the Choreo plugin to write it, or contact Platform Engineering.'],
      warnings: [],
    };
  }
  const result = checkPassport(readFileSync(file, 'utf8'));
  return { file, problems: result.problems.map((p) => p.message), warnings: [] };
}

function runLicense() {
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'].find((path) => existsSync(path));
  const passport = readPassport();
  if (passport.problem) return { file: 'PASSPORT.yml', problems: [passport.problem], warnings: [] };
  const result = checkLicense({
    licenseText: file ? readFileSync(file, 'utf8') : null,
    passportLicense: passport.value.license,
  });
  return { file: file ?? 'PASSPORT.yml', ...result };
}

function runTier() {
  const passport = readPassport();
  if (passport.problem) return { file: 'PASSPORT.yml', problems: [passport.problem], warnings: [] };
  const containerfile = ['Containerfile', 'Dockerfile'].find((path) => existsSync(path));
  const result = checkTier({
    tier: passport.value.profile?.tier,
    paths: listFiles('.'),
    containerfile: containerfile ? readFileSync(containerfile, 'utf8') : null,
  });
  return { file: containerfile ?? 'PASSPORT.yml', ...result };
}

function runFiles() {
  const hashes = JSON.parse(readFileSync(new URL('../canonical/hashes.json', import.meta.url), 'utf8'));
  const files = Object.fromEntries(
    ['AGENTS.md', 'CLAUDE.md'].map((path) => [path, existsSync(path) ? readFileSync(path, 'utf8') : null]),
  );
  const governed = checkFiles({ files, hashes });
  const problems = governed.problems.map((message) => ({
    message,
    file: Object.keys(files).find((path) => message.includes(`\`${path}\``)) ?? 'AGENTS.md',
  }));

  // GitHub reads the first CODEOWNERS it finds, in this order.
  const codeownersPath = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'].find((path) => existsSync(path));
  const codeowners = checkCodeowners(codeownersPath ? readFileSync(codeownersPath, 'utf8') : null);
  problems.push(...codeowners.problems.map((message) => ({ message, file: codeownersPath ?? '.github/CODEOWNERS' })));

  return { file: 'AGENTS.md', problems, warnings: [] };
}

// Explains the gitleaks report the secrets job wrote to $GITLEAKS_REPORT.
function runSecrets() {
  const path = process.env.GITLEAKS_REPORT ?? 'gitleaks-report.json';
  if (!existsSync(path)) {
    return { file: 'PASSPORT.yml', problems: ['The secret scan produced no report, so the history couldn\'t be checked. Re-run the checks; if it happens again, ask Platform Engineering.'], warnings: [] };
  }
  return { file: 'PASSPORT.yml', ...explainSecrets(JSON.parse(readFileSync(path, 'utf8'))) };
}

// Decides whether the build job builds: paved-road Nuxt apps do, and need a
// lockfile. Other stacks are skipped with a warning until their checks exist.
// Writes build=true|false to $GITHUB_OUTPUT.
function runBuildPlan() {
  const passport = readPassport();
  if (passport.problem) return plan(false, { file: 'PASSPORT.yml', problems: [passport.problem], warnings: [] });
  const { road, stack } = passport.value;
  if (road !== 'paved' || stack !== 'nuxt') {
    return plan(false, {
      file: 'PASSPORT.yml',
      problems: [],
      warnings: ['This app is off the paved road, so CI doesn\'t build it yet. Platform Engineering checks the build by hand at the publish request.'],
    });
  }
  if (!existsSync('package.json')) {
    return plan(false, {
      file: 'PASSPORT.yml',
      problems: ['The passport says this is a paved-road Nuxt app, but there is no package.json, so it can\'t be built. Restore package.json, or correct `road` and `stack` in the passport.'],
      warnings: [],
    });
  }
  if (!existsSync('package-lock.json')) {
    return plan(false, {
      file: 'package.json',
      problems: ['There is no package-lock.json. It pins the exact version of every dependency, so the app builds the same way every time. Run `npm install` and commit package-lock.json.'],
      warnings: [],
    });
  }
  return plan(true, { file: 'package.json', problems: [], warnings: [] });
}

function plan(build, result) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `build=${build}\n`);
  return result;
}

function runAudit() {
  const npm = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
  let report;
  try {
    report = JSON.parse(npm.stdout);
  } catch {
    return { file: 'package-lock.json', problems: ['`npm audit` couldn\'t run, so the dependencies weren\'t checked for known vulnerabilities. Re-run the checks; if it happens again, ask Platform Engineering.'], warnings: [] };
  }
  return { file: 'package-lock.json', ...explainAudit(report) };
}

// New dependencies on the registry, auto-merge in workflows, and runtimes
// past end of life. Needs no install. $BASE_PACKAGE_JSON names the base
// branch's package.json on a pull request; without it every dependency is new.
async function runDependencies() {
  const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
  const packageJson = read('package.json') ? JSON.parse(read('package.json')) : null;
  const base = process.env.BASE_PACKAGE_JSON && existsSync(process.env.BASE_PACKAGE_JSON)
    ? JSON.parse(readFileSync(process.env.BASE_PACKAGE_JSON, 'utf8'))
    : null;
  const now = new Date();
  const results = [];

  const lookups = await Promise.all(newDependencies(base, packageJson).map(lookUpPackage));
  results.push(tag('package.json', checkRegistry(lookups.filter(Boolean), now)));
  const unreachable = lookups.filter((l) => l === null).length;
  if (unreachable) results.push({ problems: [], warnings: [`The npm registry couldn't be reached for ${unreachable} new ${unreachable === 1 ? 'dependency' : 'dependencies'}, so ${unreachable === 1 ? 'it wasn\'t' : 'they weren\'t'} checked. Re-run the checks.`] });

  const workflowDir = '.github/workflows';
  const workflows = existsSync(workflowDir)
    ? listFiles(workflowDir).filter((p) => /\.ya?ml$/.test(p)).map((p) => ({ path: `${workflowDir}/${p}`, text: readFileSync(join(workflowDir, p), 'utf8') }))
    : [];
  results.push(checkAutoMerge(workflows));

  const runtimes = runtimesOf({ packageJson, nvmrc: read('.nvmrc'), containerfile: read('Containerfile') ?? read('Dockerfile') });
  if (runtimes.length > 0) {
    try {
      const products = [...new Set(runtimes.map((r) => r.product))];
      const cycles = Object.fromEntries(await Promise.all(products.map(async (product) => {
        const response = await fetch(`https://endoflife.date/api/${product}.json`);
        if (!response.ok) throw new Error(String(response.status));
        return [product, await response.json()];
      })));
      results.push(tag('package.json', checkEndOfLife(runtimes, cycles, now)));
    } catch {
      results.push({ problems: [], warnings: ['endoflife.date couldn\'t be reached, so the runtime versions weren\'t checked for end of life. Re-run the checks.'] });
    }
  }

  return { file: 'package.json', problems: results.flatMap((r) => r.problems), warnings: results.flatMap((r) => r.warnings) };
}

// Explains the knip report the build job wrote to $KNIP_REPORT.
function runUnused() {
  const path = process.env.KNIP_REPORT ?? 'knip-report.json';
  if (!existsSync(path)) return { file: 'package.json', problems: [], warnings: ['The unused-dependency scan produced no report, so it was skipped.'] };
  return { file: 'package.json', ...explainUnused(JSON.parse(readFileSync(path, 'utf8'))) };
}

// Plain http:// calls and CORS open to any website, in source and config.
const SOURCE = /\.(m?[jt]sx?|c[jt]s|vue|py|json|ya?ml|html|toml)$/;
const NOT_SOURCE = new Set(['node_modules', '.git', '.output', '.nuxt', 'dist', '.venv', '__pycache__']);
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']);

function runCode() {
  const files = listFiles('.', NOT_SOURCE)
    .filter((path) => SOURCE.test(path) && !LOCKFILES.has(path.split('/').pop()))
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  const results = [scanHttp(files), scanCors(files)];
  return { file: 'PASSPORT.yml', problems: results.flatMap((r) => r.problems), warnings: [] };
}

// WCAG 2.0 AA on the built site: up to 25 pages of a Pages site, or a
// container app's home page, in Chrome, with axe's wcag2a and wcag2aa rules.
const MAX_PAGES = 25;

async function runAccessibility() {
  const passport = readPassport();
  if (passport.problem) return { file: 'PASSPORT.yml', problems: [passport.problem], warnings: [] };
  const skip = (why) => ({ file: 'PASSPORT.yml', problems: [], warnings: [`${why} The accessibility check (WCAG 2.0 AA) didn't run here; it runs again at the publish request.`] });

  let site;
  if (existsSync('.output/server/index.mjs') && passport.value.profile?.tier === 'container') {
    site = await startServer('.output/server/index.mjs');
    if (!site) return skip('The app didn\'t start in CI.');
    site.pages = ['/'];
  } else if (existsSync('.output/public')) {
    site = await serveStatic('.output/public');
    site.pages = listFiles('.output/public').filter((p) => p.endsWith('.html')).slice(0, MAX_PAGES)
      .map((p) => `/${p}`.replace(/index\.html$/, ''));
  } else {
    return { file: 'PASSPORT.yml', problems: ['The build left no `.output` directory, so accessibility couldn\'t be checked. The paved road builds into `.output`; check the build script.'], warnings: [] };
  }

  try {
    const { chromium } = await import('playwright-core');
    let browser;
    try {
      browser = await chromium.launch({ channel: 'chrome' });
    } catch {
      return skip('No Chrome was available to load the pages.');
    }
    const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
    const results = [];
    try {
      const page = await browser.newPage();
      for (const path of site.pages) {
        await page.goto(site.base + path, { waitUntil: 'load' });
        await page.addScriptTag({ content: axeSource });
        const result = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
        results.push({ page: path, result });
      }
    } finally {
      await browser.close();
    }
    return { file: 'PASSPORT.yml', ...explainAxe(results) };
  } finally {
    site.stop();
  }
}

// Serves a directory of static files on a free local port.
async function serveStatic(root) {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(root, path);
    if (!file.startsWith(join(root)) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, stop: () => server.close() };
}

// Starts a built server and waits up to 20 seconds for it to answer.
async function startServer(entry) {
  const port = String(40000 + Math.floor(Math.random() * 20000));
  const child = spawn(process.execPath, [entry], { env: { ...process.env, PORT: port, NITRO_PORT: port }, stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const base = `http://127.0.0.1:${port}`;
  for (let waited = 0; waited < 20000 && !exited; waited += 250) {
    try {
      await fetch(base + '/');
      return { base, stop: () => child.kill() };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  child.kill();
  return null;
}

// One package's registry facts: { name, exists, created }, or null when the
// registry can't be reached.
async function lookUpPackage(name) {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (response.status === 404) return { name, exists: false };
    if (!response.ok) return null;
    const { time } = await response.json();
    return { name, exists: true, created: time?.created };
  } catch {
    return null;
  }
}

// Gives string problems a file, so they're annotated where they belong.
function tag(file, result) {
  return { ...result, problems: result.problems.map((message) => (typeof message === 'string' ? { message, file } : message)) };
}

// Reads the built site from .output: static pages for a Pages site, or the
// running server's home page for a container app.
async function runIndexing() {
  const passport = readPassport();
  if (passport.problem) return { file: 'PASSPORT.yml', problems: [passport.problem], warnings: [] };
  const indexable = passport.value.indexable === true;

  if (existsSync('.output/server/index.mjs') && passport.value.profile?.tier === 'container') {
    const served = await serve('.output/server/index.mjs');
    if (!served) {
      return {
        file: 'PASSPORT.yml',
        problems: [],
        warnings: ['The app didn\'t start in CI, so its indexing couldn\'t be checked here; it may need settings only the real environment has. The assessor checks it at the publish request.'],
      };
    }
    return {
      file: 'PASSPORT.yml',
      ...checkIndexing({ indexable, pages: [{ path: '/', html: served.html }], robotsTxt: served.robotsTxt, hasSitemap: served.hasSitemap, headers: served.headers }),
    };
  }

  const root = '.output/public';
  if (!existsSync(root)) {
    return { file: 'PASSPORT.yml', problems: ['The build left no `.output` directory, so the pages couldn\'t be checked. The paved road builds into `.output`; check the build script.'], warnings: [] };
  }
  const pages = listFiles(root).filter((path) => path.endsWith('.html'))
    .map((path) => ({ path, html: readFileSync(join(root, path), 'utf8') }));
  return {
    file: 'PASSPORT.yml',
    ...checkIndexing({
      indexable,
      pages,
      robotsTxt: existsSync(join(root, 'robots.txt')) ? readFileSync(join(root, 'robots.txt'), 'utf8') : null,
      hasSitemap: existsSync(join(root, 'sitemap.xml')),
    }),
  };
}

// Fetches a running container app's home page, headers, robots.txt and
// whether it has a sitemap, or null when it doesn't start.
async function serve(entry) {
  const site = await startServer(entry);
  if (!site) return null;
  try {
    const home = await fetch(site.base + '/');
    const robots = await fetch(site.base + '/robots.txt');
    const sitemap = await fetch(site.base + '/sitemap.xml');
    return {
      html: await home.text(),
      headers: Object.fromEntries(home.headers),
      robotsTxt: robots.ok ? await robots.text() : null,
      hasSitemap: sitemap.ok,
    };
  } finally {
    site.stop();
  }
}

// The license and tier checks read the passport too. They need only that it
// parses; the passport check reports anything else wrong with it.
function readPassport() {
  if (!existsSync('PASSPORT.yml')) {
    return { problem: 'This check reads PASSPORT.yml, and the repository has none. Fix the passport check first.' };
  }
  const doc = parseDocument(readFileSync('PASSPORT.yml', 'utf8'), { schema: 'yaml-1.1' });
  const value = doc.errors.length === 0 ? doc.toJS() : null;
  if (value === null || typeof value !== 'object') {
    return { problem: 'This check reads PASSPORT.yml, which can\'t be read. Fix the passport check first.' };
  }
  return { value };
}

// Every file under the app's root, as repository paths, skipping
// dependencies and git's own files.
function listFiles(root, skip = new Set(['.git', 'node_modules'])) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(root, path).split('\\').join('/'));
    }
  };
  walk(root);
  return out;
}

function report(title, file, problems, warnings) {
  for (const problem of problems) {
    const { message, file: at = file, line } = typeof problem === 'string' ? { message: problem } : problem;
    console.log(`::error file=${at}${line ? `,line=${line}` : ''},title=${title}::${escape(message)}`);
  }
  for (const message of warnings) console.log(`::warning file=${file},title=${title}::${escape(message)}`);

  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const heading = problems.length === 0
    ? `### ${title} check passed${warnings.length ? `, with ${count(warnings.length, 'warning')}` : ''}`
    : `### ${title} check found ${count(problems.length, 'problem')}`;
  const text = (problem) => (typeof problem === 'string' ? problem : problem.message);
  const lines = [...problems.map((p) => `- ${text(p)}`), ...warnings.map((m) => `- Warning: ${m}`)];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${heading}\n\n${lines.join('\n')}\n`);
}

// GitHub workflow commands end at a newline, so these characters are encoded.
function escape(text) {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

// Runs last, once every constant above exists.
const name = process.argv[2];
const check = CHECKS[name];
if (!check) {
  console.error(`usage: node checks/cli.js <${Object.keys(CHECKS).join('|')}>`);
  process.exit(2);
}

const { file, problems, warnings } = await check.run();
report(check.title, file, problems, warnings);
process.exitCode = problems.length > 0 ? 1 : 0;
