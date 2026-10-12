// The app factory (projects/active/choreo/workspace-design.md in
// platform-engineering): invites a builder to the org and, given a
// repository name, creates a private incubating repository with everything
// the publish request will look for. Every step is skipped when it's
// already done, so a rerun after a partial failure is safe, and an existing
// repository's lifecycle is never changed.

const TEAM = 'platform-engineering';
const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

export function validateInputs({ github_username, davidson_email, repository }) {
  const errors = [];
  if (!USERNAME.test(github_username ?? '')) errors.push(`"${github_username}" isn't a GitHub username.`);
  if (!/^[A-Za-z0-9._%+-]+@davidson\.edu$/.test(davidson_email ?? '')) errors.push(`"${davidson_email}" isn't a davidson.edu email address.`);
  if (repository && !SLUG.test(repository)) errors.push(`"${repository}" isn't a repository name: use lowercase letters, numbers and hyphens.`);
  return errors;
}

// `github(method, path, body)` returns { status, data }. Returns the
// summary lines for the job summary.
export async function runFactory({ org, github, inputs }) {
  const { github_username: username, davidson_email: email, repository } = inputs;
  const summary = [];

  // 1. Invite, unless already a member or invited.
  const membership = await github('GET', `/orgs/${org}/memberships/${username}`);
  if (membership.status === 200 && membership.data.state === 'active') {
    summary.push(`${username} is already a member of ${org}.`);
  } else {
    const pending = await allPages(github, `/orgs/${org}/invitations`);
    if (membership.status === 200 || pending.some((i) => i.login?.toLowerCase() === username.toLowerCase())) {
      summary.push(`${username} is already invited to ${org}.`);
    } else {
      const user = await github('GET', `/users/${username}`);
      if (user.status === 404) throw new Error(`There's no GitHub account named ${username}. Check the username with the builder.`);
      await expect(github('POST', `/orgs/${org}/invitations`, { invitee_id: user.data.id, role: 'direct_member' }), 201, 'send the invitation');
      summary.push(`Invited ${username} to ${org}.`);
    }
  }

  if (!repository) return summary;

  // 2. Create the repository, unless it exists.
  const full = `${org}/${repository}`;
  const existing = await github('GET', `/repos/${full}`);
  const created = existing.status === 404;
  if (created) {
    await expect(github('POST', `/orgs/${org}/repos`, { name: repository, visibility: 'private', private: true, auto_init: false }), 201, 'create the repository');
    summary.push(`Created ${full}, private.`);
  } else {
    summary.push(`${full} already exists, so it wasn't created.`);
  }

  // 3. Properties: lifecycle only on a new repository; the builder's email
  //    added to product-owner-email's contacts if it isn't there.
  const values = created ? [] : (await github('GET', `/repos/${full}/properties/values`)).data ?? [];
  const current = values.find((p) => p.property_name === 'product-owner-email')?.value ?? '';
  const contacts = current.split(',').map((c) => c.trim()).filter(Boolean);
  const changes = [];
  if (created) changes.push({ property_name: 'lifecycle', value: 'incubating' });
  if (!contacts.some((c) => c.toLowerCase() === email.toLowerCase())) {
    changes.push({ property_name: 'product-owner-email', value: [...contacts, email].join(', ') });
  }
  if (changes.length > 0) {
    await expect(github('PATCH', `/repos/${full}/properties/values`, { properties: changes }), 204, 'set the repository properties');
    summary.push(`Set ${changes.map((c) => `${c.property_name} to ${c.value}`).join(' and ')}.`);
  }

  // 4. The PE team gets maintain, so CODEOWNERS takes effect.
  await expect(github('PUT', `/orgs/${org}/teams/${TEAM}/repos/${full}`, { permission: 'maintain' }), 204, `give ${TEAM} maintain`);
  summary.push(`Gave ${TEAM} maintain on ${full}.`);

  return summary;
}

async function expect(call, status, what) {
  const response = await call;
  if (response.status !== status) throw new Error(`Couldn't ${what}: GitHub answered ${response.status}.`);
  return response;
}

async function allPages(github, path) {
  const all = [];
  for (let page = 1; ; page++) {
    const { data } = await github('GET', `${path}?per_page=100&page=${page}`);
    if (!data || data.length === 0) return all;
    all.push(...data);
    if (data.length < 100) return all;
  }
}
