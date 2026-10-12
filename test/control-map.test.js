import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { loadControlMap, controlsFor } from '../checks/control-map.js';

const schema = JSON.parse(readFileSync(new URL('../schemas/control-map/v1.schema.json', import.meta.url), 'utf8'));
const reportSchema = JSON.parse(readFileSync(new URL('../schemas/report/v1.schema.json', import.meta.url), 'utf8'));
const map = parse(readFileSync(new URL('../control-map.yml', import.meta.url), 'utf8'));
const standardIds = readFileSync(new URL('./fixtures/standard-ids.txt', import.meta.url), 'utf8').trim().split('\n');

test('control-map.yml validates', () => {
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  assert.equal(validate(map), true, JSON.stringify(validate.errors, null, 1));
});

test('every item in the standard is mapped exactly once, in order', () => {
  assert.deepEqual(map.controls.map((c) => c.id), standardIds);
});

test('every id fits the report schema\'s control id', () => {
  const pattern = new RegExp(reportSchema.$defs.id.pattern);
  for (const { id } of map.controls) assert.match(id, pattern);
});

test('the schema rejects a process item with met_by, and an app item without it', () => {
  const validate = new Ajv2020().compile(schema);
  const base = { control_map: 1, standard: 'the numbered copy', controls: [] };
  assert.equal(validate({ ...base, controls: [{ id: '1.1', summary: 'x', scope: 'process', how: 'y', met_by: { pages: 'check', container: 'check' } }] }), false);
  assert.equal(validate({ ...base, controls: [{ id: '1.1', summary: 'x', scope: 'app', how: 'y' }] }), false);
});

test('controlsFor gives a tier its app items as report entries, leaving out process items', () => {
  const pages = controlsFor(loadControlMap(), 'pages');
  assert.equal(pages.length, map.controls.filter((c) => c.scope === 'app').length);
  assert.deepEqual(pages.find((c) => c.id === '4.7'), { id: '4.7', met_by: 'n/a' });
  assert.deepEqual(controlsFor(loadControlMap(), 'container').find((c) => c.id === '4.7'), { id: '4.7', met_by: 'platform' });
  assert.equal(pages.find((c) => c.id === '9.1'), undefined);
});

test('controlsFor refuses a tier the map doesn\'t know', () => {
  assert.throws(() => controlsFor(loadControlMap(), 'swa'), /swa/);
});

import { renderControlMap } from '../scripts/control-map-doc.js';

test('docs/control-map.md is up to date with control-map.yml', () => {
  const page = readFileSync(new URL('../docs/control-map.md', import.meta.url), 'utf8');
  assert.equal(page, renderControlMap(loadControlMap()), 'Run `npm run control-map-doc` and commit the result.');
});
