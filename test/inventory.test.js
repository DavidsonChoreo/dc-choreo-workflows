import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEntry, buildIndex, collect } from '../collector/inventory.js';

const passport = readFileSync(new URL('../examples/passport/academic-deadlines.yml', import.meta.url), 'utf8');

const repo = (name, extra = {}) => ({ name, full_name: `DavidsonChoreo/${name}`, topics: [], archived: false, description: null, ...extra });

test('a hosted app gets its facts from the passport, owners included', () => {
  const entry = buildEntry({ repo: repo('academic-deadlines'), lifecycle: 'hosted', passportText: passport });
  assert.deepEqual(entry, {
    app: 'academic-deadlines',
    repository: 'DavidsonChoreo/academic-deadlines',
    lifecycle: 'hosted',
    passport: 'valid',
    tier: 'container',
    department: "Registrar's Office",
    app_owners: [{ name: 'Dana Example', email: 'daexample@davidson.edu' }],
    business_owner: { name: 'Morgan Example', email: 'moexample@davidson.edu' },
    purpose: 'Shows students and advisers the add, drop and withdrawal deadlines that apply to each course section, and lets the Registrar\'s Office post exceptions.\n',
    created: '2026-10-12',
    review: '2027-10-12',
  });
});

test('an incubating app lists its business owner but not its builders', () => {
  const entry = buildEntry({ repo: repo('academic-deadlines'), lifecycle: 'incubating', passportText: passport });
  assert.equal(entry.app_owners, undefined);
  assert.deepEqual(entry.business_owner, { name: 'Morgan Example', email: 'moexample@davidson.edu' });
  assert.equal(entry.department, "Registrar's Office");
  assert.doesNotMatch(JSON.stringify(entry), /daexample|Dana Example/);
});

test('an invalid passport on an incubating app still hides its builders', () => {
  const broken = passport.replace('  tier: container', '  tier: swa');
  const entry = buildEntry({ repo: repo('academic-deadlines'), lifecycle: 'incubating', passportText: broken });
  assert.equal(entry.app_owners, undefined);
});

test('an app without a passport is still listed, from its repository', () => {
  const entry = buildEntry({ repo: repo('campus-occupancy', { description: 'Who is where' }), lifecycle: 'incubating', passportText: null });
  assert.deepEqual(entry, {
    app: 'campus-occupancy',
    repository: 'DavidsonChoreo/campus-occupancy',
    lifecycle: 'incubating',
    passport: 'missing',
    purpose: 'Who is where',
  });
});

test('a passport that fails the schema is marked invalid but keeps what it says', () => {
  const broken = passport.replace('  tier: container', '  tier: swa');
  const entry = buildEntry({ repo: repo('academic-deadlines'), lifecycle: 'incubating', passportText: broken });
  assert.equal(entry.passport, 'invalid');
  assert.equal(entry.tier, 'swa');
  assert.equal(entry.department, "Registrar's Office");
});

test('a passport that is not YAML is marked invalid and listed from the repository', () => {
  const entry = buildEntry({ repo: repo('x'), lifecycle: 'incubating', passportText: 'app: [unclosed\n' });
  assert.equal(entry.passport, 'invalid');
  assert.equal(entry.app, 'x');
});

test('the index has one short line per app, sorted by name', () => {
  const entries = [
    buildEntry({ repo: repo('zeta'), lifecycle: 'hosted', passportText: null }),
    buildEntry({ repo: repo('academic-deadlines'), lifecycle: 'incubating', passportText: passport }),
  ];
  const index = buildIndex(entries, '2026-10-12T06:00:00Z');
  assert.equal(index.inventory, 1);
  assert.equal(index.generated, '2026-10-12T06:00:00Z');
  assert.deepEqual(index.apps.map((a) => a.app), ['academic-deadlines', 'zeta']);
  assert.deepEqual(Object.keys(index.apps[0]), ['app', 'repository', 'lifecycle', 'tier', 'department', 'business_owner', 'purpose', 'passport']);
});

// A stand-in for the GitHub API, answering only the calls collect() makes.
function fakeGitHub({ repos, properties, passports }) {
  return async (path) => {
    if (path.startsWith('/orgs/DavidsonChoreo/repos')) return /[?&]page=1$/.test(path) ? repos : [];
    if (path.startsWith('/orgs/DavidsonChoreo/properties/values')) return /[?&]page=1$/.test(path) ? properties : [];
    const match = path.match(/^\/repos\/DavidsonChoreo\/([^/]+)\/contents\/PASSPORT\.yml$/);
    if (match) return passports[match[1]] ?? null;
    throw new Error(`unexpected call: ${path}`);
  };
}

const lifecycle = (name, value) => ({ repository_name: name, properties: [{ property_name: 'lifecycle', value }] });

test('collect lists apps and skips platform repositories, sandboxes and archived repositories', async () => {
  const github = fakeGitHub({
    repos: [
      repo('academic-deadlines'),
      repo('dc-choreo-workflows'),
      repo('choreo-checks-sandbox', { topics: ['sandbox'] }),
      repo('old-thing', { archived: true }),
      repo('AssemblyViz'),
    ],
    properties: [
      lifecycle('academic-deadlines', 'incubating'),
      lifecycle('dc-choreo-workflows', 'platform'),
      lifecycle('choreo-checks-sandbox', 'incubating'),
      lifecycle('old-thing', 'archived'),
      lifecycle('AssemblyViz', 'hosted'),
    ],
    passports: { 'academic-deadlines': passport },
  });
  const entries = await collect({ org: 'DavidsonChoreo', github });
  assert.deepEqual(entries.map((e) => [e.app, e.lifecycle, e.passport]), [
    ['academic-deadlines', 'incubating', 'valid'],
    ['AssemblyViz', 'hosted', 'missing'],
  ]);
});

import { mkdtempSync, writeFileSync as write, readdirSync, readFileSync as read, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeInventory } from '../collector/inventory.js';

test('writeInventory writes one file per app and the index, and removes apps that are gone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inventory-'));
  mkdirSync(join(dir, 'inventory'));
  write(join(dir, 'inventory', 'deleted-app.json'), '{}');
  const entries = [buildEntry({ repo: repo('academic-deadlines'), lifecycle: 'incubating', passportText: passport })];
  writeInventory(dir, entries, '2026-10-12T06:00:00Z');
  assert.deepEqual(readdirSync(join(dir, 'inventory')).sort(), ['academic-deadlines.json', 'index.json']);
  const written = JSON.parse(read(join(dir, 'inventory', 'academic-deadlines.json'), 'utf8'));
  assert.equal(written.inventory, 1);
  assert.equal(written.app.department, "Registrar's Office");
  assert.ok(read(join(dir, 'inventory', 'index.json'), 'utf8').endsWith('\n'));
});
