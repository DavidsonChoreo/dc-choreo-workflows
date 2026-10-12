// Collects the inventory from the GitHub API and writes it under the
// directory given as the first argument: `node collector/run.js <dir>`.
// Needs GITHUB_TOKEN, a token that can read every repository in the org
// (the choreo-reader app's installation token) and its custom properties.

import { collect, writeInventory } from './inventory.js';

const org = process.env.CHOREO_ORG ?? 'DavidsonChoreo';
const root = process.argv[2];
const token = process.env.GITHUB_TOKEN;
if (!root || !token) {
  console.error('usage: GITHUB_TOKEN=... node collector/run.js <output directory>');
  process.exit(2);
}

async function github(path) {
  const raw = path.endsWith('/contents/PASSPORT.yml');
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API ${path}: ${response.status} ${await response.text()}`);
  return raw ? response.text() : response.json();
}

const entries = await collect({ org, github });
writeInventory(root, entries, new Date().toISOString());
console.log(`Inventory: ${entries.length} apps written to ${root}/inventory`);
