import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scanHistory, PATTERNS } from '../assessor/history.js';

// A git repository built commit by commit: each step writes files (null
// deletes one) and commits. Returns the directory and each commit's sha.
function repo(steps) {
  const dir = mkdtempSync(join(tmpdir(), 'history-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  const commits = [];
  for (const files of steps) {
    for (const [path, content] of Object.entries(files)) {
      const full = join(dir, path);
      if (content === null) { rmSync(full); continue; }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    git('add', '-A');
    git('commit', '-q', '-m', `step ${commits.length + 1}`);
    commits.push(git('rev-parse', 'HEAD'));
  }
  return { dir, commits };
}

const PASSPORT = 'app: academic-deadlines\nbusiness_owner: Jane Doe <jadoe@davidson.edu>\n';

test('a data file committed and then deleted is still found, with the commit that added it', () => {
  const { dir, commits } = repo([
    { 'PASSPORT.yml': PASSPORT, 'data/roster.csv': 'name,id\nA Student,800123456\n' },
    { 'data/roster.csv': null },
  ]);
  const found = scanHistory(dir);
  const roster = found.files.find((f) => f.path === 'data/roster.csv');
  assert.ok(roster, 'the deleted CSV is listed');
  assert.equal(roster.present, false);
  assert.equal(roster.kind, 'data');
  assert.equal(roster.commit, commits[0]);
});

test('patterns are found in old versions of a file, not just the current one', () => {
  const { dir, commits } = repo([
    { 'PASSPORT.yml': PASSPORT, 'seed.js': 'const ssn = "123-45-6789";\n' },
    { 'seed.js': 'const ssn = "";\n' },
  ]);
  const hit = scanHistory(dir).leads.find((l) => l.pattern === 'ssn');
  assert.ok(hit);
  assert.equal(hit.path, 'seed.js');
  assert.equal(hit.commit, commits[0]);
  assert.equal(hit.line, 1);
  assert.equal(hit.present, false);
});

test('Davidson IDs: nine digits starting with 8 or 9, and nothing else', () => {
  const re = new RegExp(PATTERNS.find((p) => p.id === 'davidson-id').regex, 'g');
  assert.deepEqual('800123456 912345678 712345678 8001234567 80012345 x900000001'.match(re), ['800123456', '912345678']);
});

test('the other patterns: SSNs, Davidson addresses, private IPs, internal hostnames', () => {
  const match = (id, text) => new RegExp(PATTERNS.find((p) => p.id === id).regex, 'g').test(text);
  assert.ok(match('ssn', '123-45-6789'));
  assert.ok(!match('ssn', '000-12-3456'));
  assert.ok(match('davidson-email', 'mail stu@davidson.edu now'));
  assert.ok(match('private-ip', 'host 10.20.30.40'));
  assert.ok(match('private-ip', '192.168.1.10'));
  assert.ok(match('private-ip', '172.20.0.5'));
  assert.ok(!match('private-ip', '172.32.0.5'));
  assert.ok(!match('private-ip', '127.0.0.1'));
  assert.ok(match('internal-hostname', 'db01.ad.davidson.edu'));
  assert.ok(!match('internal-hostname', 'www.davidson.edu'));
});

test("addresses in the passport are the app's owners, not leads", () => {
  const { dir } = repo([
    { 'PASSPORT.yml': PASSPORT, 'README.md': 'Ask jadoe@davidson.edu or stu@davidson.edu.\n' },
  ]);
  const emails = scanHistory(dir).leads.filter((l) => l.pattern === 'davidson-email' && l.path === 'README.md');
  assert.equal(emails.length, 1);
  assert.match(emails[0].text, /stu@davidson\.edu/);
});

test('documents and images anywhere in history are listed for reading, Office files marked for conversion', () => {
  const { dir } = repo([
    { 'PASSPORT.yml': PASSPORT, 'reports/final.pdf': '%PDF-1.4\n\0binary', 'old/slides.pptx': 'PK\0\0zip' },
    { 'old/slides.pptx': null, 'shot.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]) },
  ]);
  const files = scanHistory(dir).files;
  const by = (p) => files.find((f) => f.path === p);
  assert.deepEqual([by('reports/final.pdf').kind, by('reports/final.pdf').present], ['pdf', true]);
  assert.deepEqual([by('old/slides.pptx').kind, by('old/slides.pptx').present], ['office', false]);
  assert.equal(by('shot.png').kind, 'image');
  assert.ok(by('reports/final.pdf').blob.match(/^[0-9a-f]{40}$/));
});

test('the same content at two paths is one version, named by its path at HEAD when it has one', () => {
  const { dir } = repo([
    { 'PASSPORT.yml': PASSPORT, 'drafts/report.pdf': '%PDF same' },
    { 'drafts/report.pdf': null, 'reports/report.pdf': '%PDF same' },
  ]);
  const pdfs = scanHistory(dir).files.filter((f) => f.kind === 'pdf');
  assert.deepEqual(pdfs.map((f) => [f.path, f.present]), [['reports/report.pdf', true]]);
});

test('dependencies, build output and lockfiles are not scanned', () => {
  const { dir } = repo([
    { 'PASSPORT.yml': PASSPORT, 'node_modules/x/data.csv': 'a', 'package-lock.json': '{"v":"912345678"}', 'dist/a.pdf': '%PDF' },
  ]);
  const found = scanHistory(dir);
  assert.deepEqual(found.files, []);
  assert.deepEqual(found.leads, []);
});

test('leads are capped, and the count says how many there were', () => {
  const lines = Array.from({ length: 300 }, (_, i) => `id ${800000000 + i}`).join('\n');
  const { dir } = repo([{ 'PASSPORT.yml': PASSPORT, 'ids.txt': lines }]);
  const found = scanHistory(dir, { maxLeads: 50 });
  assert.equal(found.leads.length, 50);
  assert.equal(found.totalLeads, 300);
});

test('lead text is trimmed to a short excerpt', () => {
  const { dir } = repo([{ 'PASSPORT.yml': PASSPORT, 'a.txt': `${'x'.repeat(500)} 123-45-6789 ${'y'.repeat(500)}` }]);
  const [lead] = scanHistory(dir).leads;
  assert.ok(lead.text.length <= 200);
  assert.match(lead.text, /123-45-6789/);
});
