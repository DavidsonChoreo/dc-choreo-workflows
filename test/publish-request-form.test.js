import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

// The publish-request issue form. dc-choreo-factory's intake reads it at v1
// and finds each answer by its field id, so the ids and titles are a contract;
// the labels and help text are free to change.
const form = parse(readFileSync(new URL('../canonical/publish-request.yml', import.meta.url), 'utf8'));
const fields = form.body.filter((f) => f.type === 'textarea');
const byId = Object.fromEntries(fields.map((f) => [f.id, f]));

test('the form opens issues titled "Publish request", the title the intake searches for', () => {
  assert.equal(form.title, 'Publish request');
});

test('the intake\'s three answers are there, by id, each with a label', () => {
  assert.deepEqual(Object.keys(byId).sort(), ['audience', 'notes', 'summary']);
  for (const f of fields) assert.ok(f.attributes.label?.trim(), f.id);
  assert.equal(new Set(fields.map((f) => f.attributes.label)).size, 3, 'labels are distinct, so headings are');
});

test('what the app does and who uses it are required; notes are optional', () => {
  assert.equal(byId.summary.validations?.required, true);
  assert.equal(byId.audience.validations?.required, true);
  assert.notEqual(byId.notes.validations?.required, true);
});
