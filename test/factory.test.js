import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInputs, runFactory } from '../factory/factory.js';

const ORG = 'DavidsonChoreo';
const inputs = { github_username: 'dana-example', davidson_email: 'daexample@davidson.edu', repository: 'academic-deadlines' };

// A stand-in for the GitHub API: records every call and answers from `state`.
function fakeGitHub(state) {
  const calls = [];
  const github = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    if (method === 'GET' && path === '/users/dana-example') return state.userExists === false ? { status: 404 } : { status: 200, data: { id: 42, login: 'dana-example' } };
    if (method === 'GET' && path === `/orgs/${ORG}/memberships/dana-example`) return state.member ? { status: 200, data: { state: state.member } } : { status: 404 };
    if (method === 'GET' && path.startsWith(`/orgs/${ORG}/invitations`)) return { status: 200, data: state.invited ? [{ login: 'dana-example' }] : [] };
    if (method === 'POST' && path === `/orgs/${ORG}/invitations`) { state.sentInvite = body; return { status: 201, data: {} }; }
    if (method === 'GET' && path === `/repos/${ORG}/academic-deadlines`) return state.repoExists ? { status: 200, data: { name: 'academic-deadlines' } } : { status: 404 };
    if (method === 'POST' && path === `/orgs/${ORG}/repos`) { state.created = body; return { status: 201, data: {} }; }
    if (method === 'GET' && path === `/repos/${ORG}/academic-deadlines/properties/values`) return { status: 200, data: state.properties ?? [] };
    if (method === 'PATCH' && path === `/repos/${ORG}/academic-deadlines/properties/values`) { state.setProperties = body.properties; return { status: 204 }; }
    if (method === 'PUT' && path === `/orgs/${ORG}/teams/platform-engineering/repos/${ORG}/academic-deadlines`) { state.teamGrant = body; return { status: 204 }; }
    throw new Error(`unexpected call: ${method} ${path}`);
  };
  return { github, calls, state };
}

const prop = (property_name, value) => ({ property_name, value });

test('inputs: a GitHub username, a Davidson email and an optional repository slug', () => {
  assert.deepEqual(validateInputs(inputs), []);
  assert.deepEqual(validateInputs({ ...inputs, repository: '' }), []);
  assert.match(validateInputs({ ...inputs, davidson_email: 'dana@gmail.com' })[0], /davidson\.edu/);
  assert.match(validateInputs({ ...inputs, github_username: 'not a user!' })[0], /GitHub username/);
  assert.match(validateInputs({ ...inputs, repository: 'Bad Name' })[0], /repository/);
});

test('a new builder with a new repository: invited, repository created and set up', async () => {
  const { github, state } = fakeGitHub({});
  const summary = await runFactory({ org: ORG, github, inputs });
  assert.deepEqual(state.sentInvite, { invitee_id: 42, role: 'direct_member' });
  assert.equal(state.created.name, 'academic-deadlines');
  assert.equal(state.created.visibility, 'private');
  assert.deepEqual(state.setProperties, [prop('lifecycle', 'incubating'), prop('product-owner-email', 'daexample@davidson.edu')]);
  assert.deepEqual(state.teamGrant, { permission: 'maintain' });
  assert.match(summary.join('\n'), /Invited dana-example/);
  assert.match(summary.join('\n'), /Created DavidsonChoreo\/academic-deadlines/);
});

test('an existing member is not invited again', async () => {
  const { github, state } = fakeGitHub({ member: 'active' });
  const summary = await runFactory({ org: ORG, github, inputs: { ...inputs, repository: '' } });
  assert.equal(state.sentInvite, undefined);
  assert.match(summary.join('\n'), /already a member/);
});

test('a pending invitation is not sent again', async () => {
  const { github, state } = fakeGitHub({ invited: true });
  const summary = await runFactory({ org: ORG, github, inputs: { ...inputs, repository: '' } });
  assert.equal(state.sentInvite, undefined);
  assert.match(summary.join('\n'), /already invited/);
});

test('without a repository, nothing but the invitation happens', async () => {
  const { github, calls } = fakeGitHub({});
  await runFactory({ org: ORG, github, inputs: { ...inputs, repository: '' } });
  assert.ok(calls.every((call) => !call.includes('/repos')));
});

test('an existing repository is not recreated, and its lifecycle is left alone', async () => {
  const { github, state } = fakeGitHub({
    member: 'active',
    repoExists: true,
    properties: [prop('lifecycle', 'hosted'), prop('product-owner-email', 'raramanujan@davidson.edu')],
  });
  const summary = await runFactory({ org: ORG, github, inputs });
  assert.equal(state.created, undefined);
  assert.deepEqual(state.setProperties, [prop('product-owner-email', 'raramanujan@davidson.edu, daexample@davidson.edu')]);
  assert.deepEqual(state.teamGrant, { permission: 'maintain' });
  assert.match(summary.join('\n'), /already exists/);
});

test('an email already among the contacts is not added twice, and properties are left alone', async () => {
  const { github, state } = fakeGitHub({
    member: 'active',
    repoExists: true,
    properties: [prop('lifecycle', 'incubating'), prop('product-owner-email', 'DAExample@davidson.edu')],
  });
  await runFactory({ org: ORG, github, inputs });
  assert.equal(state.setProperties, undefined);
});

test('a GitHub username that does not exist stops with a clear message', async () => {
  const { github } = fakeGitHub({ userExists: false });
  await assert.rejects(runFactory({ org: ORG, github, inputs }), /no GitHub account named dana-example/);
});
