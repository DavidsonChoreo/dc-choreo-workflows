// Runs one check at an app's root, as CI does: `node checks/cli.js <check>`.
// Each problem becomes an error annotation and each warning a warning
// annotation, on the file it's about, and both go into the job summary.
// Exits 1 when the check finds a problem.

import { existsSync, readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import { checkPassport } from './passport.js';
import { checkLicense } from './license.js';
import { checkTier } from './tier.js';
import { checkFiles } from './files.js';
import { explainSecrets } from './secrets.js';
import { explainAudit } from './audit.js';
import { checkIndexing } from './indexing.js';

const CHECKS = {
  passport: { title: 'Passport', run: runPassport },
  license: { title: 'License', run: runLicense },
  tier: { title: 'Tier', run: runTier },
  files: { title: 'Governance files', run: runFiles },
  secrets: { title: 'Secrets', run: runSecrets },
  'build-plan': { title: 'Build', run: runBuildPlan },
  audit: { title: 'Dependencies', run: runAudit },
  indexing: { title: 'Indexing', run: runIndexing },
};

const name = process.argv[2];
const check = CHECKS[name];
if (!check) {
  console.error(`usage: node checks/cli.js <${Object.keys(CHECKS).join('|')}>`);
  process.exit(2);
}

const { file, problems, warnings } = await check.run();
report(check.title, file, problems, warnings);
process.exitCode = problems.length > 0 ? 1 : 0;

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
  const result = checkFiles({ files, hashes });
  const edited = Object.keys(files).find((path) => result.problems.some((p) => p.includes(`\`${path}\``)));
  return { file: edited ?? 'AGENTS.md', ...result };
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

// Starts the built server, waits up to 20 seconds for it to answer, and
// returns its home page, headers, robots.txt and whether it has a sitemap.
// Returns null when it never answers or exits first.
async function serve(entry) {
  const port = String(40000 + Math.floor(Math.random() * 20000));
  const server = spawn(process.execPath, [entry], { env: { ...process.env, PORT: port, NITRO_PORT: port }, stdio: 'ignore' });
  let exited = false;
  server.on('exit', () => { exited = true; });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let waited = 0; waited < 20000 && !exited; waited += 250) {
      try {
        const home = await fetch(base + '/');
        const robots = await fetch(base + '/robots.txt');
        const sitemap = await fetch(base + '/sitemap.xml');
        return {
          html: await home.text(),
          headers: Object.fromEntries(home.headers),
          robotsTxt: robots.ok ? await robots.text() : null,
          hasSitemap: sitemap.ok,
        };
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return null;
  } finally {
    server.kill();
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
function listFiles(root) {
  const skip = new Set(['.git', 'node_modules']);
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
