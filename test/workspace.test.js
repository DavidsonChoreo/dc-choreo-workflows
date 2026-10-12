import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorkspace } from '../checks/workspace.js';

const ready = {
  repository: 'DavidsonChoreo/academic-deadlines',
  teamPermission: 'maintain',
  productOwnerEmail: 'moexample@davidson.edu',
  businessOwnerEmail: 'moexample@davidson.edu',
};

test('a workspace with every piece passes', () => {
  assert.deepEqual(checkWorkspace(ready), { ok: true, problems: [], warnings: [] });
});

test('write, maintain and admin all count as team write access', () => {
  for (const teamPermission of ['push', 'maintain', 'admin']) {
    assert.equal(checkWorkspace({ ...ready, teamPermission }).ok, true, teamPermission);
  }
});

test('a repository outside DavidsonChoreo fails', () => {
  const result = checkWorkspace({ ...ready, repository: 'dana-example/academic-deadlines' });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /DavidsonChoreo/);
});

test('no PE team access fails, explaining CODEOWNERS needs it', () => {
  for (const teamPermission of [null, 'pull', 'triage']) {
    const result = checkWorkspace({ ...ready, teamPermission });
    assert.equal(result.ok, false, String(teamPermission));
    assert.match(result.problems[0], /CODEOWNERS/);
  }
});

test('a missing product-owner-email fails', () => {
  const result = checkWorkspace({ ...ready, productOwnerEmail: null });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /product-owner-email/);
});

test('a list of contacts that includes the business owner passes', () => {
  const list = 'raramanujan@davidson.edu, telim@davidson.edu, moexample@davidson.edu';
  assert.equal(checkWorkspace({ ...ready, productOwnerEmail: list }).ok, true);
});

test('a product-owner-email that leaves out the business owner fails, naming both', () => {
  const result = checkWorkspace({ ...ready, productOwnerEmail: 'daexample@davidson.edu' });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /daexample@davidson\.edu/);
  assert.match(result.problems[0], /moexample@davidson\.edu/);
});

test('emails compare without regard to case', () => {
  assert.equal(checkWorkspace({ ...ready, productOwnerEmail: 'MOExample@davidson.edu' }).ok, true);
});

test('every problem says PE completes it at the publish request', () => {
  const result = checkWorkspace({ repository: 'someone/x', teamPermission: null, productOwnerEmail: null, businessOwnerEmail: 'a@davidson.edu' });
  assert.equal(result.problems.length, 3);
  for (const problem of result.problems) assert.match(problem, /Platform Engineering/);
});
