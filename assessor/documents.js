// Documents and images for Claude to read: PDFs and images as they are, and
// Office files converted to PDF with LibreOffice, from every version the
// history pass found. Capped so an app full of scans can't run up the bill or
// overflow the request; anything left out is named in a flag, so a person
// opens it instead.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const LIMITS = { maxPages: 100, maxImages: 20, maxBytes: 15_000_000, maxImageBytes: 5_000_000 };

// files: from scanHistory. Returns { documents: [{ path, commit, present,
// block }], unread: [{ path, commit, present, reason }] }, current files first.
export function prepareDocuments(root, files, { convert = convertWithLibreOffice, pageCount = countPages, ...limits } = {}) {
  const { maxPages, maxImages, maxBytes, maxImageBytes } = { ...LIMITS, ...limits };
  const readable = files.filter((f) => f.kind === 'pdf' || f.kind === 'image' || f.kind === 'office')
    .sort((a, b) => Number(b.present) - Number(a.present) || a.path.localeCompare(b.path));
  const documents = [];
  const unread = [];
  let pages = 0;
  let images = 0;
  let bytes = 0;

  for (const file of readable) {
    const { path, commit, present } = file;
    const skip = (reason) => unread.push({ path, commit, present, reason });
    const ext = path.split('.').at(-1).toLowerCase();
    let data = execFileSync('git', ['-C', root, 'cat-file', 'blob', file.blob], { maxBuffer: 256 * 1024 * 1024 });

    if (file.kind === 'image') {
      if (data.length > maxImageBytes) { skip(`larger than ${maxImageBytes / 1_000_000} MB`); continue; }
      if (images + 1 > maxImages) { skip(`over the ${maxImages}-image limit for one review`); continue; }
      if (bytes + data.length > maxBytes) { skip('over the size limit for one review'); continue; }
      images += 1;
      bytes += data.length;
      documents.push({ path, commit, present, block: { type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[ext], data: data.toString('base64') } } });
      continue;
    }

    if (file.kind === 'office') {
      try { data = convert(data, ext); } catch { data = null; }
      if (!data) { skip("couldn't be converted to PDF"); continue; }
    }
    const count = pageCount(data);
    if (pages + count > maxPages) { skip(`over the ${maxPages}-page limit for one review`); continue; }
    if (bytes + data.length > maxBytes) { skip('over the size limit for one review'); continue; }
    pages += count;
    bytes += data.length;
    documents.push({ path, commit, present, block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') } } });
  }
  return { documents, unread };
}

// One medium flag naming every file left unread, or null.
export function unreadFlag(unread) {
  if (unread.length === 0) return null;
  const list = unread.map((u) => `${u.path}${u.present ? '' : `, only in history at ${u.commit.slice(0, 7)}`} (${u.reason})`).join('; ');
  return {
    id: 'documents-unread',
    severity: 'medium',
    detail: `The assessor couldn't read ${unread.length === 1 ? 'this file' : `these ${unread.length} files`}: ${list}. Someone needs to open ${unread.length === 1 ? 'it' : 'each one'} and confirm there's no real data, student information or internal detail in it before the repository goes public.`,
    evidence: unread.map((u) => u.path).join(', '),
  };
}

// LibreOffice's headless converter. Returns the PDF, or null.
export function convertWithLibreOffice(bytes, ext) {
  const dir = mkdtempSync(join(tmpdir(), 'convert-'));
  try {
    writeFileSync(join(dir, `in.${ext}`), bytes);
    execFileSync('soffice', ['--headless', '--norestore', `-env:UserInstallation=file://${dir}/profile`, '--convert-to', 'pdf', '--outdir', dir, join(dir, `in.${ext}`)], { stdio: 'ignore', timeout: 120_000 });
    const pdf = readdirSync(dir).find((f) => f === 'in.pdf');
    return pdf ? readFileSync(join(dir, pdf)) : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// pdfinfo's page count when it's installed, else the page objects counted in
// the file; at least 1.
export function countPages(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'pages-'));
  try {
    writeFileSync(join(dir, 'f.pdf'), bytes);
    const info = execFileSync('pdfinfo', [join(dir, 'f.pdf')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (pages > 0) return pages;
  } catch {
    // no pdfinfo, or a PDF it can't read: count instead
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return Math.max(1, (bytes.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length);
}
