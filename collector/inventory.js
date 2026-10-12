// The Choreo app inventory, stage 1 of the oversight collector
// (DavidsonCollege/platform-engineering#91): one entry per app in the org,
// from its passport and its custom properties, and an index of them all.
// Incubating apps are listed too: their existence and these facts are
// public, their code stays private. Platform repositories, sandboxes and
// archived repositories aren't apps and are skipped.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { checkPassport } from '../checks/passport.js';

export function buildEntry({ repo, lifecycle, passportText }) {
  const base = { app: repo.name, repository: repo.full_name, lifecycle };
  if (passportText === null) {
    return { ...base, passport: 'missing', ...(repo.description ? { purpose: repo.description } : {}) };
  }

  const doc = parseDocument(passportText, { schema: 'yaml-1.1' });
  const passport = doc.errors.length === 0 ? doc.toJS() : null;
  if (passport === null || typeof passport !== 'object') {
    return { ...base, passport: 'invalid', ...(repo.description ? { purpose: repo.description } : {}) };
  }

  const entry = {
    ...base,
    passport: checkPassport(passportText).ok ? 'valid' : 'invalid',
    tier: passport.profile?.tier,
    department: passport.department,
    app_owners: passport.app_owners,
    business_owner: passport.business_owner,
    purpose: passport.purpose,
    created: dateText(passport.created),
    review: dateText(passport.review),
  };
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
}

// The index: one short line per app, so a reader that wants every app opens one file.
export function buildIndex(entries, generated) {
  const fields = ['app', 'repository', 'lifecycle', 'tier', 'department', 'app_owners', 'purpose', 'passport'];
  const apps = [...entries]
    .sort((a, b) => a.app.localeCompare(b.app, 'en', { sensitivity: 'base' }))
    .map((entry) => Object.fromEntries(fields.filter((f) => entry[f] !== undefined).map((f) => [f, entry[f]])));
  return { inventory: 1, generated, apps };
}

// Reads the org through `github(path)`, which returns parsed JSON, or for a
// PASSPORT.yml contents path the file's text, or null when it doesn't exist.
export async function collect({ org, github }) {
  const repos = await allPages(github, `/orgs/${org}/repos?type=all`);
  const values = await allPages(github, `/orgs/${org}/properties/values`);
  const lifecycles = new Map(values.map((v) => [
    v.repository_name,
    v.properties.find((p) => p.property_name === 'lifecycle')?.value ?? null,
  ]));

  const apps = repos.filter((repo) => {
    const lifecycle = lifecycles.get(repo.name);
    return !repo.archived && !repo.topics.includes('sandbox') && lifecycle !== 'platform' && lifecycle !== 'archived';
  });

  const entries = [];
  for (const repo of apps) {
    const passportText = await github(`/repos/${org}/${repo.name}/contents/PASSPORT.yml`);
    entries.push(buildEntry({ repo, lifecycle: lifecycles.get(repo.name) ?? 'incubating', passportText }));
  }
  return entries.sort((a, b) => a.app.localeCompare(b.app, 'en', { sensitivity: 'base' }));
}

async function allPages(github, path) {
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await github(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!batch || batch.length === 0) return all;
    all.push(...batch);
  }
}

// A date the YAML read as a Date object goes back to YYYY-MM-DD.
function dateText(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

// Writes inventory/<app>.json for each app and inventory/index.json under
// `root`, and removes the file of any app that's no longer listed. Each app's
// file holds its `app` block; the full snapshot adds the other blocks later.
export function writeInventory(root, entries, generated) {
  const dir = join(root, 'inventory');
  mkdirSync(dir, { recursive: true });
  const keep = new Set(['index.json', ...entries.map((entry) => `${entry.app}.json`)]);
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.json') && !keep.has(file)) rmSync(join(dir, file));
  }
  for (const entry of entries) {
    writeFileSync(join(dir, `${entry.app}.json`), `${JSON.stringify({ inventory: 1, app: entry }, null, 2)}\n`);
  }
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify(buildIndex(entries, generated), null, 2)}\n`);
}
