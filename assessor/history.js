// The history pass: everything the repository has ever held, since all of it
// goes public at the visibility flip, not just the files at the assessed
// commit. It lists documents, images and data files from every commit, and
// finds patterns that look like personal data or internal details in every
// version of every text file. Deterministic and cheap; what it finds goes to
// Claude as leads, and Claude judges them under real-data-in-repository.

import { execFileSync, spawnSync } from 'node:child_process';
import { NOT_SOURCE, LOCKFILES } from './assess.js';

// Each pattern is a lead, not a finding: Claude decides whether the match is
// real data. Davidson IDs are nine digits starting with 8 or 9.
export const PATTERNS = [
  { id: 'ssn', name: 'Social Security number', regex: String.raw`\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b` },
  { id: 'davidson-id', name: 'Davidson ID number', regex: String.raw`\b[89]\d{8}\b` },
  { id: 'davidson-email', name: 'Davidson email address', regex: String.raw`\b[A-Za-z0-9._%+-]+@davidson\.edu\b`, flags: 'i' },
  { id: 'private-ip', name: 'private IP address', regex: String.raw`\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b` },
  { id: 'internal-hostname', name: 'internal hostname', regex: String.raw`\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:ad|int|internal|corp|local|lan)\.davidson\.edu\b`, flags: 'i' },
];

const KINDS = {
  pdf: ['pdf'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  office: ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'odp', 'ods'],
  data: ['csv', 'tsv', 'sql', 'sqlite', 'sqlite3', 'db', 'log', 'har', 'eml', 'msg', 'pst', 'mbox', 'bak', 'dump', 'parquet', 'jsonl'],
};
const KIND_OF = new Map(Object.entries(KINDS).flatMap(([kind, exts]) => exts.map((e) => [e, kind])));
const MAX_TEXT = 1_000_000;
const EXCERPT = 200;

const kindOf = (path) => KIND_OF.get(path.split('.').at(-1).toLowerCase()) ?? null;
const skipped = (path) => path.split('/').some((part) => NOT_SOURCE.has(part)) || LOCKFILES.has(path.split('/').at(-1));

// Returns { files, leads, totalLeads }. files: documents, images, Office and
// data files from every commit, one per version, with `present` true when that
// version is the one at HEAD. leads: pattern matches by path, commit and line.
export function scanHistory(root, { maxLeads = 100 } = {}) {
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

  const atHead = new Map();
  for (const line of git('ls-tree', '-r', 'HEAD').split('\n').filter(Boolean)) {
    const [meta, path] = line.split('\t');
    atHead.set(path, meta.split(' ')[2]);
  }

  // Every version of every file, in the order commits made them: blob -> { path, commit }.
  const versions = new Map();
  let commit = null;
  for (const line of git('log', '--all', '--reverse', '--no-renames', '--raw', '--no-abbrev', '--format=commit %H').split('\n')) {
    if (line.startsWith('commit ')) { commit = line.slice(7); continue; }
    if (!line.startsWith(':')) continue;
    const [meta, path] = line.split('\t');
    const [, , , blob, status] = meta.split(' ');
    if (status === 'D' || skipped(path) || versions.has(blob)) continue;
    versions.set(blob, { path, commit, present: false });
  }
  // A version still at HEAD, under any path, is named by its path there.
  for (const [path, blob] of atHead) {
    const v = versions.get(blob);
    if (v && !v.present) Object.assign(v, { path, present: true });
  }

  const files = [];
  const text = [];
  for (const [blob, v] of versions) {
    const kind = kindOf(v.path);
    if (kind) files.push({ ...v, blob, kind });
    if (kind !== 'pdf' && kind !== 'image' && kind !== 'office') text.push(blob);
  }

  const known = new Set((atHead.has('PASSPORT.yml') ? git('show', 'HEAD:PASSPORT.yml') : '').toLowerCase().match(/[a-z0-9._%+-]+@davidson\.edu/g) ?? []);
  const leads = [];
  for (const [blob, content] of readBlobs(root, text)) {
    const v = versions.get(blob);
    content.split('\n').forEach((line, i) => {
      for (const p of PATTERNS) {
        for (const m of line.matchAll(new RegExp(p.regex, `g${p.flags ?? ''}`))) {
          if (p.id === 'davidson-email' && known.has(m[0].toLowerCase())) continue;
          leads.push({ pattern: p.id, path: v.path, commit: v.commit, present: v.present, line: i + 1, text: excerpt(line, m.index) });
          break;
        }
      }
    });
  }

  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), leads: leads.slice(0, maxLeads), totalLeads: leads.length };
}

// Reads text blobs in one `git cat-file --batch`, skipping binary and oversized ones.
function readBlobs(root, blobs) {
  if (blobs.length === 0) return [];
  const run = (args, input) => spawnSync('git', ['-C', root, 'cat-file', ...args], { input, maxBuffer: 1024 * 1024 * 1024 });
  const sizes = run(['--batch-check'], `${blobs.join('\n')}\n`).stdout.toString().split('\n').filter(Boolean)
    .map((l) => l.split(' ')).filter(([, type, size]) => type === 'blob' && Number(size) <= MAX_TEXT).map(([sha]) => sha);
  if (sizes.length === 0) return [];
  const out = run(['--batch'], `${sizes.join('\n')}\n`).stdout;
  const result = [];
  let at = 0;
  while (at < out.length) {
    const eol = out.indexOf(0x0a, at);
    const [sha, , size] = out.subarray(at, eol).toString().split(' ');
    const body = out.subarray(eol + 1, eol + 1 + Number(size));
    if (!body.includes(0)) result.push([sha, body.toString('utf8')]);
    at = eol + 1 + Number(size) + 1;
  }
  return result;
}

function excerpt(line, index) {
  if (line.length <= EXCERPT) return line.trim();
  const start = Math.max(0, Math.min(index - EXCERPT / 2, line.length - EXCERPT));
  return line.slice(start, start + EXCERPT).trim();
}
