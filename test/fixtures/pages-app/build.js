// Stands in for `nuxt generate` in the build check's self-test: writes the
// static output an indexable Pages site would have.
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('.output/public/about', { recursive: true });
const page = '<!DOCTYPE html><html><head><title>Library hours</title></head><body></body></html>';
writeFileSync('.output/public/index.html', page);
writeFileSync('.output/public/about/index.html', page);
writeFileSync('.output/public/robots.txt', 'User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n');
writeFileSync('.output/public/sitemap.xml', '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>\n');
