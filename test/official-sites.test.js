import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

const schema = JSON.parse(readFileSync(new URL('../schemas/official-sites/v1.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const list = parse(readFileSync(new URL('../official-sites.yml', import.meta.url), 'utf8'), { schema: 'yaml-1.1' });

const site = { name: 'Example', url: 'https://example.davidson.edu/', purpose: 'Something official', owner: 'Some Office' };
const withSites = (...sites) => ({ ...list, sites });

test('official-sites.yml validates', () => {
  assert.equal(validate(list), true, JSON.stringify(validate.errors, null, 1));
});

test('every site name is unique', () => {
  const names = list.sites.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
});

test('the main college website is on the list', () => {
  assert.ok(list.sites.some((s) => s.url === 'https://www.davidson.edu/'));
});

test('Ad Astra replaces EMS', () => {
  const adAstra = list.sites.find((s) => s.url === 'https://adastra.davidson.edu/');
  assert.ok(adAstra);
  assert.deepEqual(adAstra.replaces, ['ems.davidson.edu']);
});

test('the schema rejects a site without a purpose', () => {
  const { purpose, ...noPurpose } = site;
  assert.equal(validate(withSites(noPurpose)), false);
});

test('the schema rejects a URL that is not https', () => {
  assert.equal(validate(withSites({ ...site, url: 'http://example.davidson.edu/' })), false);
});

test('the schema allows a platform with no single URL', () => {
  assert.equal(validate(withSites({ ...site, url: null })), true, JSON.stringify(validate.errors));
});

test('the schema rejects an unknown field', () => {
  assert.equal(validate(withSites({ ...site, colour: 'red' })), false);
});
