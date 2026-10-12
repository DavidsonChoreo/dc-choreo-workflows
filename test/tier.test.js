import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTier } from '../checks/tier.js';

const digest = 'sha256:' + 'a'.repeat(64);

const goodContainerfile = `
FROM node:22-slim@${digest} AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM node:22-slim@${digest}
WORKDIR /app
COPY --from=build /app/.output .output
USER node
HEALTHCHECK CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1))"
CMD ["node", ".output/server/index.mjs"]
`;

const container = (containerfile, paths = ['Containerfile', 'app.vue']) =>
  checkTier({ tier: 'container', paths, containerfile });

test('a Pages site without server code passes', () => {
  const result = checkTier({ tier: 'pages', paths: ['app.vue', 'pages/index.vue'], containerfile: null });
  assert.equal(result.ok, true);
});

test('a Pages site with a server directory fails', () => {
  const result = checkTier({ tier: 'pages', paths: ['app.vue', 'server/api/hello.ts'], containerfile: null });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /`server\/`/);
  assert.match(result.problems[0], /Pages/);
});

test('a well-formed container app passes', () => {
  const result = container(goodContainerfile);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('a container app without a Containerfile fails', () => {
  const result = checkTier({ tier: 'container', paths: ['app.vue'], containerfile: null });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /Containerfile/);
});

test('a base image pinned by tag only fails', () => {
  const result = container(goodContainerfile.replaceAll(`@${digest}`, ''));
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /node:22-slim/);
  assert.match(result.problems[0], /sha256/);
});

test('a build stage referenced by name needs no digest', () => {
  const result = container(goodContainerfile.replace('FROM node:22-slim@' + digest + '\n', 'FROM build\n'));
  assert.equal(result.ok, true, result.problems.join('\n'));
});

test('a final stage running as root fails', () => {
  const result = container(goodContainerfile.replace('USER node', 'USER root'));
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /root/);
});

test('a final stage with no USER fails', () => {
  const result = container(goodContainerfile.replace('USER node\n', ''));
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /USER/);
});

test('a USER set only in an earlier stage does not count', () => {
  const moved = goodContainerfile.replace('USER node\n', '').replace('WORKDIR /app\nCOPY . .', 'WORKDIR /app\nUSER node\nCOPY . .');
  const result = container(moved);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /USER/);
});

test('a container app without a healthcheck fails', () => {
  const result = container(goodContainerfile.replace(/HEALTHCHECK.*\n/, ''));
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /HEALTHCHECK/);
});

test('HEALTHCHECK NONE counts as no healthcheck', () => {
  const result = container(goodContainerfile.replace(/HEALTHCHECK.*\n/, 'HEALTHCHECK NONE\n'));
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /HEALTHCHECK/);
});

test('a Dockerfile is accepted in place of a Containerfile', () => {
  const result = container(goodContainerfile, ['Dockerfile', 'app.vue']);
  assert.equal(result.ok, true);
});
