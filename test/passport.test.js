import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPassport } from '../checks/passport.js';

const example = readFileSync(new URL('../examples/passport/academic-deadlines.yml', import.meta.url), 'utf8');

// Swap one line of the valid example, so each test changes exactly one thing.
function variant(from, to) {
  assert.ok(example.includes(from), `example no longer contains: ${from}`);
  return example.replace(from, to);
}

function fieldsOf(result) {
  return result.problems.map((p) => p.field);
}

test('both examples pass', () => {
  for (const name of ['academic-deadlines', 'library-hours']) {
    const text = readFileSync(new URL(`../examples/passport/${name}.yml`, import.meta.url), 'utf8');
    const result = checkPassport(text);
    assert.deepEqual(result.problems, [], name);
    assert.equal(result.ok, true, name);
  }
});

test('a business owner who is also an app owner fails', () => {
  const result = checkPassport(
    variant(
      'business_owner: { name: Morgan Example, email: moexample@davidson.edu }',
      'business_owner: { name: Dana Example, email: daexample@davidson.edu }',
    ),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(fieldsOf(result), ['business_owner']);
  assert.match(result.problems[0].message, /someone other than the app owners/);
});

test('the business-owner rule ignores the case of the email address', () => {
  const result = checkPassport(
    variant(
      'business_owner: { name: Morgan Example, email: moexample@davidson.edu }',
      'business_owner: { name: Dana Example, email: DAExample@davidson.edu }',
    ),
  );
  assert.deepEqual(fieldsOf(result), ['business_owner']);
});

test('a missing field is named, with what it is for', () => {
  const result = checkPassport(variant('department: Registrar\'s Office\n', ''));
  assert.deepEqual(fieldsOf(result), ['department']);
  assert.match(result.problems[0].message, /`department` is missing/);
  assert.match(result.problems[0].message, /The department the app belongs to/);
});

test('an unquoted date says to add quotes', () => {
  const result = checkPassport(variant('created: "2026-10-12"', 'created: 2026-10-12'));
  assert.deepEqual(fieldsOf(result), ['created']);
  assert.match(result.problems[0].message, /quotes/);
  assert.match(result.problems[0].message, /created: "2026-10-12"/);
});

test('a value outside the allowed list names the allowed values', () => {
  const result = checkPassport(variant('  tier: container', '  tier: swa'));
  assert.deepEqual(fieldsOf(result), ['profile.tier']);
  assert.match(result.problems[0].message, /`profile.tier` is "swa"/);
  assert.match(result.problems[0].message, /pages, container/);
});

test('an unknown field is called out by name', () => {
  const result = checkPassport(example + 'colour: blue\n');
  assert.deepEqual(fieldsOf(result), ['colour']);
  assert.match(result.problems[0].message, /`colour` isn't a passport field/);
});

test('an email outside davidson.edu is explained', () => {
  const result = checkPassport(
    variant('incident_contact: { name: Dana Example, email: daexample@davidson.edu }',
      'incident_contact: { name: Dana Example, email: dana@gmail.com }'),
  );
  assert.deepEqual(fieldsOf(result), ['incident_contact.email']);
  assert.match(result.problems[0].message, /davidson\.edu address/);
});

test('breaking a tier rule quotes the rule', () => {
  const result = checkPassport(variant('roles: [viewer, registrar]', 'roles: []'));
  assert.deepEqual(fieldsOf(result), ['roles']);
  assert.match(result.problems[0].message, /A container app defines at least one Entra app role/);
});

test('a list that must be empty says so', () => {
  const pages = readFileSync(new URL('../examples/passport/library-hours.yml', import.meta.url), 'utf8');
  assert.match(pages, /roles: \[\]/);
  const result = checkPassport(pages.replace('roles: []', 'roles: [admin]'));
  assert.deepEqual(fieldsOf(result), ['roles']);
  assert.match(result.problems[0].message, /`roles` has to be empty/);
});

test('a field with two allowed shapes says what it is for', () => {
  const result = checkPassport(variant('llm: null', 'llm: anthropic'));
  assert.deepEqual(fieldsOf(result), ['llm']);
  assert.match(result.problems[0].message, /The LLM provider the app calls, or null/);
});

test('YAML that cannot be read points at the line', () => {
  const result = checkPassport('passport: 1\napp: [unclosed\n');
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].field, null);
  assert.match(result.problems[0].message, /line \d+/);
});

test('an empty file says the passport is empty', () => {
  const result = checkPassport('');
  assert.equal(result.ok, false);
  assert.match(result.problems[0].message, /empty/);
});

test('messages never pass raw validator wording through', () => {
  const broken = variant('  tier: container', '  tier: swa')
    .replace('department: Registrar\'s Office\n', '') + 'colour: blue\n';
  for (const { message } of checkPassport(broken).problems) {
    assert.doesNotMatch(message, /must have required property|must be equal to one of|must NOT have additional/);
  }
});
