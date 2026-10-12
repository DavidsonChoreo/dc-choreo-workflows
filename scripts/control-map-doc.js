// Writes docs/control-map.md from control-map.yml, for Information Security
// to review the mapping without reading YAML. `npm run control-map-doc`; a
// test fails when the page is out of date.

import { writeFileSync } from 'node:fs';
import { loadControlMap } from '../checks/control-map.js';

const SECTIONS = {
  1: 'App registration (passport fields)', 3: 'Data understanding and classification', 4: 'Tier-1 security gate',
  5: 'Pre-deployment technical review', 6: 'Repository and code publication', 7: 'Data lifecycle and decommissioning',
  8: 'Regulatory considerations', 9: 'Pre-deployment approval and sign-off', 10: 'Post-launch monitoring, testing and recertification',
};

export function renderControlMap(map) {
  const cell = (text) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
  const app = map.controls.filter((c) => c.scope === 'app');
  const count = (tier, how) => app.filter((c) => c.met_by[tier] === how).length;
  const lines = [
    '# Control map',
    '',
    '<!-- Generated from control-map.yml by scripts/control-map-doc.js. Edit the YAML, then run `npm run control-map-doc`. -->',
    '',
    `How each item in Information Security's review standard is met by a Choreo app. Source: ${map.standard}.`,
    '',
    `${map.controls.length} items: ${app.length} depend on the app and appear in every assessor report; ${map.controls.length - app.length} are met by the same pipeline step for every app and are recorded here only.`,
    '',
    '| Met by | What it means | Pages | Container |',
    '|---|---|---|---|',
    ...[
      ['platform', 'The hosting module or the shared layer provides it'],
      ['check', 'A blocking CI check confirms it'],
      ['flag', 'The assessor judges it, with evidence'],
      ['attested', 'The builder confirms it at the ready call'],
      ['n/a', "Doesn't apply to the tier"],
    ].map(([how, meaning]) => `| ${how} | ${meaning} | ${count('pages', how)} | ${count('container', how)} |`),
    '',
  ];

  const precedence = map.controls.filter((c) => c.precedence);
  lines.push('## Where a Choreo decision takes precedence', '');
  for (const c of precedence) lines.push(`- **${c.id}** ${cell(c.summary)}: ${cell(c.precedence)}`);
  lines.push('');

  const gaps = map.controls.filter((c) => c.gap);
  lines.push('## Not fully met yet', '');
  for (const c of gaps) lines.push(`- **${c.id}** ${cell(c.summary)}: ${cell(c.gap)}`);
  lines.push('');

  for (const [number, title] of Object.entries(SECTIONS)) {
    const items = map.controls.filter((c) => c.id.split('.')[0] === number);
    if (items.length === 0) continue;
    lines.push(`## ${number}. ${title}`, '', '| Item | Pages | Container | How it is met |', '|---|---|---|---|');
    for (const c of items) {
      const [pages, container] = c.scope === 'app' ? [c.met_by.pages, c.met_by.container] : ['process', 'process'];
      const notes = [c.precedence && `**Precedence:** ${c.precedence}`, c.gap && `**Gap:** ${c.gap}`].filter(Boolean).join(' ');
      lines.push(`| **${c.id}** ${cell(c.summary)} | ${pages} | ${container} | ${cell(c.how)}${notes ? ` ${cell(notes)}` : ''} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL('../docs/control-map.md', import.meta.url), renderControlMap(loadControlMap()));
}
