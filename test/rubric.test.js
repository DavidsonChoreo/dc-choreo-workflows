import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { loadControlMap } from '../checks/control-map.js';

const rubric = parse(readFileSync(new URL('../rubrics/security.yml', import.meta.url), 'utf8'));
const map = loadControlMap();
const byId = new Map(map.controls.map((c) => [c.id, c]));

test('every rubric item is well formed, with a unique flag id', () => {
  const ids = rubric.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of rubric.items) {
    assert.match(item.id, /^[a-z0-9][a-z0-9-]*$/, item.id);
    assert.ok(['low', 'medium', 'high'].includes(item.severity), item.id);
    assert.ok(item.look_for.length > 40, item.id);
    assert.ok(item.tiers.every((t) => ['pages', 'container'].includes(t)), item.id);
    assert.ok(item.when === undefined || item.when === 'llm', item.id);
  }
});

// An item judges, for an app's tier, only its controls that are `flag` on that
// tier: injection covers XSS on a Pages site, but not SQL injection.
test('every control a rubric item names is a flag control on at least one of its tiers', () => {
  for (const item of rubric.items) {
    for (const id of item.controls) {
      const control = byId.get(id);
      assert.ok(control, `${item.id} names ${id}, which isn't in the control map`);
      assert.ok(item.tiers.some((tier) => control.met_by?.[tier] === 'flag'), `${item.id}: control ${id} is flag on none of ${item.tiers}`);
    }
  }
});

test('every flag control in the map is judged by some rubric item on each tier', () => {
  for (const control of map.controls.filter((c) => c.scope === 'app')) {
    for (const tier of ['pages', 'container']) {
      if (control.met_by[tier] !== 'flag') continue;
      const covered = rubric.items.some((i) => i.controls.includes(control.id) && i.tiers.includes(tier));
      assert.ok(covered, `control ${control.id} is met_by flag on ${tier} but no rubric item judges it there`);
    }
  }
});

const comms = parse(readFileSync(new URL('../rubrics/comms.yml', import.meta.url), 'utf8'));

test('the Comms rubric is well formed: unique ids, apart from security\'s, medium, and conditions it understands', () => {
  const ids = comms.items.map((i) => i.id);
  assert.equal(comms.rubric, 'comms');
  assert.equal(new Set(ids).size, ids.length);
  for (const item of comms.items) {
    assert.match(item.id, /^[a-z0-9][a-z0-9-]*$/, item.id);
    assert.ok(!rubric.items.some((s) => s.id === item.id), `${item.id} is also a security item`);
    assert.equal(item.severity, 'medium', item.id);
    assert.ok(item.look_for.length > 40, item.id);
    assert.ok(item.tiers.every((t) => ['pages', 'container'].includes(t)), item.id);
    assert.ok([undefined, 'unbranded', 'indexable'].includes(item.when), item.id);
  }
  assert.deepEqual(ids.sort(), ['audience-mismatch', 'brand-marks', 'official-site-overlap', 'search-competition']);
});
