// The control map: how each item in Information Security's review standard
// is met by a Choreo app. The assessor starts the report's security section
// from controlsFor(), then fills in each item's status and evidence.

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const TIERS = new Set(['pages', 'container']);

export function loadControlMap() {
  return parse(readFileSync(new URL('../control-map.yml', import.meta.url), 'utf8'));
}

// The app-scoped items for one tier, as { id, met_by } report entries.
// Process items are the same for every app, so they stay in the map.
export function controlsFor(map, tier) {
  if (!TIERS.has(tier)) throw new Error(`The control map has no tier "${tier}"; it knows ${[...TIERS].join(' and ')}.`);
  return map.controls
    .filter((control) => control.scope === 'app')
    .map((control) => ({ id: control.id, met_by: control.met_by[tier] }));
}
