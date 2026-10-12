// The indexing check: the built site does what the passport's `indexable`
// says (pipeline.md, "Indexing rules"). Not indexable: every page carries
// <meta name="robots" content="noindex">, a container app also sends
// X-Robots-Tag: noindex, and robots.txt never blocks crawlers, since a
// blocked crawler can't see the noindex. Indexable: no page carries noindex,
// and the site has a sitemap.xml and a robots.txt.

const LISTED = 10;

export function checkIndexing({ indexable, pages, robotsTxt, hasSitemap, headers }) {
  const problems = [];
  const flagged = pages.filter((page) => hasNoindex(page.html) !== !indexable).map((page) => page.path);

  if (!indexable) {
    if (flagged.length > 0) {
      problems.push(`The passport says this site isn't indexable, but ${list(flagged)} ${flagged.length === 1 ? 'has' : 'have'} no \`<meta name="robots" content="noindex">\`. On the paved road the layer adds it from the passport; check the layer is installed and the page uses it.`);
    }
    if (headers && !/noindex/i.test(headers['x-robots-tag'] ?? '')) {
      problems.push('The passport says this app isn\'t indexable, but it doesn\'t send an `X-Robots-Tag: noindex` header. On the paved road the layer\'s server middleware sends it; check the layer is installed.');
    }
    if (robotsTxt && blocksAll(robotsTxt)) {
      problems.push('robots.txt blocks crawlers with `Disallow: /`. That hides the noindex tag, because crawlers that can\'t read a page can\'t see it, so search engines may still list the site. Remove the `Disallow: /` and let the noindex tag do the work.');
    }
  } else {
    if (flagged.length > 0) {
      problems.push(`The passport says this site is indexable, but ${list(flagged)} ${flagged.length === 1 ? 'carries' : 'carry'} a noindex tag, so search engines will skip ${flagged.length === 1 ? 'it' : 'them'}. Remove the tag, or set \`indexable: false\` in the passport.`);
    }
    if (!hasSitemap) problems.push('The passport says this site is indexable, but it has no sitemap.xml. Add one so search engines can find every page; on the paved road the layer can generate it.');
    if (!robotsTxt) problems.push('The passport says this site is indexable, but it has no robots.txt. Add one that allows crawling and points to the sitemap.');
  }

  return { ok: problems.length === 0, problems, warnings: [] };
}

function hasNoindex(html) {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (/\bname\s*=\s*["']?robots["']?/i.test(tag) && /\bcontent\s*=\s*["'][^"']*noindex/i.test(tag)) return true;
  }
  return false;
}

function blocksAll(robotsTxt) {
  return /^\s*disallow\s*:\s*\/\s*$/im.test(robotsTxt);
}

function list(paths) {
  if (paths.length > LISTED) return `${paths.length} pages, starting with \`${paths[0]}\`,`;
  return paths.map((path) => `\`${path}\``).join(', ');
}
