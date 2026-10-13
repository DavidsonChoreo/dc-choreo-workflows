import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scanHistory } from '../assessor/history.js';
import { prepareDocuments, unreadFlag } from '../assessor/documents.js';

function repo(steps) {
  const dir = mkdtempSync(join(tmpdir(), 'documents-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  for (const files of steps) {
    for (const [path, content] of Object.entries(files)) {
      const full = join(dir, path);
      if (content === null) { rmSync(full); continue; }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    git('add', '-A');
    git('commit', '-q', '-m', 'step');
  }
  return dir;
}

const PDF = Buffer.from('%PDF-1.4\n\0a small pdf');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
// Distinct bytes, so git keeps distinct blobs.
const pdf = (n) => Buffer.from(`%PDF-1.4\n\0pdf ${n}`);
const png = (n) => Buffer.concat([PNG, Buffer.from(String(n))]);
const onePage = () => 1;
const noConvert = () => { throw new Error('should not convert'); };

function prepare(dir, options = {}) {
  return prepareDocuments(dir, scanHistory(dir).files, { convert: noConvert, pageCount: onePage, ...options });
}

test('a PDF is read from git as a base64 document block, labelled with its path', () => {
  const dir = repo([{ 'reports/final.pdf': PDF }]);
  const { documents, unread } = prepare(dir);
  assert.equal(unread.length, 0);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].path, 'reports/final.pdf');
  assert.equal(documents[0].present, true);
  assert.deepEqual(documents[0].block, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF.toString('base64') } });
});

test('a file only in history is read from the commit that had it', () => {
  const dir = repo([{ 'old.pdf': PDF }, { 'old.pdf': null }]);
  const [doc] = prepare(dir).documents;
  assert.equal(doc.present, false);
  assert.match(doc.commit, /^[0-9a-f]{40}$/);
  assert.equal(doc.block.source.data, PDF.toString('base64'));
});

test('images become image blocks with their media type', () => {
  const dir = repo([{ 'poster.png': png(1), 'photo.JPG': png(2) }]);
  const types = prepare(dir).documents.map((d) => [d.path, d.block.type, d.block.source.media_type]);
  assert.deepEqual(types, [['photo.JPG', 'image', 'image/jpeg'], ['poster.png', 'image', 'image/png']]);
});

test('Office files are converted to PDF; one that will not convert is listed as unread', () => {
  const dir = repo([{ 'slides.pptx': 'PK\0slides', 'broken.docx': 'PK\0broken' }]);
  const convert = (bytes, ext) => (bytes.includes('broken') ? null : Buffer.from(`%PDF converted ${ext}`));
  const { documents, unread } = prepare(dir, { convert });
  assert.deepEqual(documents.map((d) => [d.path, d.block.source.media_type]), [['slides.pptx', 'application/pdf']]);
  assert.match(Buffer.from(documents[0].block.source.data, 'base64').toString(), /converted pptx/);
  assert.deepEqual(unread.map((u) => [u.path, u.reason]), [['broken.docx', "couldn't be converted to PDF"]]);
});

test('current files come before history-only ones, so the cap falls on history first', () => {
  const dir = repo([{ 'a-old.pdf': pdf(1) }, { 'a-old.pdf': null, 'z-now.pdf': pdf(2) }]);
  const { documents, unread } = prepare(dir, { maxPages: 1 });
  assert.deepEqual(documents.map((d) => d.path), ['z-now.pdf']);
  assert.deepEqual(unread.map((u) => [u.path, u.reason]), [['a-old.pdf', 'over the 1-page limit for one review']]);
});

test('the image cap and the size caps', () => {
  const dir = repo([{ 'a.png': png(1), 'b.png': png(2), 'big.png': Buffer.alloc(6_000_000, 1) }]);
  const { documents, unread } = prepare(dir, { maxImages: 1 });
  assert.deepEqual(documents.map((d) => d.path), ['a.png']);
  assert.deepEqual(unread.map((u) => [u.path, u.reason]), [
    ['b.png', 'over the 1-image limit for one review'],
    ['big.png', 'larger than 5 MB'],
  ]);
  const total = prepare(repo([{ 'a.pdf': pdf(1), 'b.pdf': pdf(2) }]), { maxBytes: pdf(1).length + 1 });
  assert.deepEqual(total.unread.map((u) => [u.path, u.reason]), [['b.pdf', 'over the size limit for one review']]);
});

test('the same file at two commits is read once per version', () => {
  const dir = repo([{ 'r.pdf': PDF }, { 'r.pdf': Buffer.from('%PDF-1.4\n\0second') }]);
  assert.equal(prepare(dir).documents.length, 2);
});

test('unread files become one medium flag that names them, so a person opens them', () => {
  assert.equal(unreadFlag([]), null);
  const flag = unreadFlag([
    { path: 'reports/big.pdf', present: true, reason: 'over the 100-page limit for one review' },
    { path: 'old/notes.docx', present: false, commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', reason: "couldn't be converted to PDF" },
  ]);
  assert.equal(flag.id, 'documents-unread');
  assert.equal(flag.severity, 'medium');
  assert.match(flag.detail, /reports\/big\.pdf \(over the 100-page limit/);
  assert.match(flag.detail, /old\/notes\.docx, only in history at a1b2c3d/);
  assert.match(flag.detail, /open/i);
});
