import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanHttp, scanCors, explainAxe } from '../checks/code.js';

const file = (path, text) => ({ path, text });

test('http: a plain http:// call fails, on its file and line', () => {
  const result = scanHttp([file('server/api/slate.ts', "const a = 1;\nconst r = await fetch('http://api.example.org/v1');\n")]);
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].file, 'server/api/slate.ts');
  assert.equal(result.problems[0].line, 2);
  assert.match(result.problems[0].message, /https/);
});

test('http: local addresses and XML namespaces are fine', () => {
  const text = [
    "fetch('http://localhost:3000/health')",
    "fetch('http://127.0.0.1:8080')",
    "const ns = 'http://www.w3.org/2000/svg';",
    '"$schema": "http://json-schema.org/draft-07/schema#"',
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>',
  ].join('\n');
  assert.deepEqual(scanHttp([file('app.vue', text)]).problems, []);
});

test('http: https passes', () => {
  assert.equal(scanHttp([file('a.ts', "fetch('https://api.example.org')")]).ok, true);
});

test('http: one problem per line, however many URLs it has', () => {
  const result = scanHttp([file('a.ts', "const x = ['http://a.example.org', 'http://b.example.org'];")]);
  assert.equal(result.problems.length, 1);
});

for (const [label, text] of [
  ['an Access-Control-Allow-Origin header of *', "setHeader(event, 'Access-Control-Allow-Origin', '*')"],
  ['cors() with no options, which allows every origin', "app.use(cors())"],
  ["cors({ origin: '*' })", "app.use(cors({ credentials: false, origin: '*' }))"],
  ['cors({ origin: true })', 'app.use(cors({ origin: true }))'],
  ['a Nuxt route rule with cors: true', "routeRules: { '/api/**': { cors: true } }"],
  ['FastAPI allow_origins=["*"]', 'app.add_middleware(CORSMiddleware, allow_origins=["*"])'],
  ['Flask CORS(app) with no options', 'CORS(app)'],
]) {
  test(`cors: ${label} fails`, () => {
    const result = scanCors([file('server/x.ts', text)]);
    assert.equal(result.ok, false, text);
    assert.match(result.problems[0].message, /any website/);
  });
}

test('cors: a named origin passes', () => {
  assert.equal(scanCors([file('x.ts', "app.use(cors({ origin: 'https://www.davidson.edu' }))")]).ok, true);
});

const axe = (violations, incomplete = []) => ({ violations, incomplete });
const violation = (id, impact, nodes = 1) => ({ id, impact, help: `${id} help`, helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}`, nodes: Array.from({ length: nodes }, () => ({})) });

test('accessibility: no violations passes', () => {
  assert.deepEqual(explainAxe([{ page: '/', result: axe([]) }]), { ok: true, problems: [], warnings: [] });
});

test('accessibility: a violation fails, whatever its impact, with how to fix it', () => {
  const result = explainAxe([{ page: '/', result: axe([violation('image-alt', 'minor', 2)]) }]);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /image-alt help/);
  assert.match(result.problems[0], /2 elements/);
  assert.match(result.problems[0], /dequeuniversity/);
  assert.match(result.problems[0], /WCAG 2\.0 AA/);
});

test('accessibility: the same rule on several pages is one problem listing them', () => {
  const result = explainAxe([
    { page: '/', result: axe([violation('color-contrast', 'serious')]) },
    { page: '/about/', result: axe([violation('color-contrast', 'serious')]) },
  ]);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /`\/`, `\/about\/`/);
});

test('accessibility: results axe cannot decide are one warning for a person to check', () => {
  const result = explainAxe([{ page: '/', result: axe([], [violation('color-contrast', 'serious', 3)]) }]);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /color-contrast/);
});
