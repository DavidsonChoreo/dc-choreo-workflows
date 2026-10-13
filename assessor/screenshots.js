// The screenshots the accessibility check saved (CHOREO_SCREENSHOT_DIR), as
// image blocks for Claude, so the Comms rubric judges the rendered pages and
// not only their source. Home page first; capped, since each costs tokens.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function readScreenshots(dir, { max = 10 } = {}) {
  if (!dir || !existsSync(dir)) return [];
  // Over 5 MB, the API refuses an image; the reviewers still have the file.
  return readdirSync(dir).filter((f) => f.endsWith('.png') && statSync(join(dir, f)).size <= 5_000_000)
    .sort((a, b) => (a === 'index.png' ? -1 : b === 'index.png' ? 1 : a.localeCompare(b)))
    .slice(0, max)
    .map((f) => ({
      page: f === 'index.png' ? '/' : `/${f.slice(0, -4)}/`,
      block: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: readFileSync(join(dir, f)).toString('base64') } },
    }));
}
