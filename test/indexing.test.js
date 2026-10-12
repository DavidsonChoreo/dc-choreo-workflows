import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIndexing } from '../checks/indexing.js';

const page = (head) => `<!DOCTYPE html><html><head>${head}</head><body></body></html>`;
const noindex = '<meta name="robots" content="noindex">';

test('a non-indexable site with noindex on every page passes', () => {
  const result = checkIndexing({
    indexable: false,
    pages: [{ path: 'index.html', html: page(noindex) }, { path: 'about/index.html', html: page(noindex) }],
    robotsTxt: null,
    hasSitemap: false,
  });
  assert.equal(result.ok, true);
});

test('a non-indexable page without noindex fails, naming the page', () => {
  const result = checkIndexing({
    indexable: false,
    pages: [{ path: 'index.html', html: page(noindex) }, { path: 'about/index.html', html: page('') }],
    robotsTxt: null,
    hasSitemap: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /about\/index\.html/);
  assert.match(result.problems[0], /noindex/);
});

test('noindex is found whatever the attribute order or case', () => {
  const result = checkIndexing({
    indexable: false,
    pages: [{ path: 'index.html', html: page('<META CONTENT="noindex, nofollow" NAME="Robots">') }],
    robotsTxt: null,
    hasSitemap: false,
  });
  assert.equal(result.ok, true);
});

test('many pages without noindex are summed up, not listed one by one', () => {
  const pages = Array.from({ length: 30 }, (_, i) => ({ path: `p${i}/index.html`, html: page('') }));
  const result = checkIndexing({ indexable: false, pages, robotsTxt: null, hasSitemap: false });
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /30 pages/);
});

test('a non-indexable site whose robots.txt blocks crawlers fails', () => {
  const result = checkIndexing({
    indexable: false,
    pages: [{ path: 'index.html', html: page(noindex) }],
    robotsTxt: 'User-agent: *\nDisallow: /\n',
    hasSitemap: false,
  });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /robots\.txt/);
  assert.match(result.problems[0], /can't see/);
});

test('an indexable site needs a sitemap and a robots.txt', () => {
  const result = checkIndexing({
    indexable: true,
    pages: [{ path: 'index.html', html: page('') }],
    robotsTxt: null,
    hasSitemap: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 2);
});

test('an indexable site with noindex on a page fails', () => {
  const result = checkIndexing({
    indexable: true,
    pages: [{ path: 'index.html', html: page(noindex) }],
    robotsTxt: 'User-agent: *\nAllow: /\n',
    hasSitemap: true,
  });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /index\.html/);
});

test('a container response is checked for the noindex header too', () => {
  const base = { indexable: false, pages: [{ path: '/', html: page(noindex) }], robotsTxt: null, hasSitemap: false };
  assert.equal(checkIndexing({ ...base, headers: { 'x-robots-tag': 'noindex' } }).ok, true);
  const missing = checkIndexing({ ...base, headers: {} });
  assert.equal(missing.ok, false);
  assert.match(missing.problems[0], /X-Robots-Tag/);
});
