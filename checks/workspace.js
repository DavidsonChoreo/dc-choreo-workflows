// The workspace check, run at the publish request: what the app factory
// sets up when a builder uses it, confirmed for builders who didn't
// (projects/active/choreo/workspace-design.md in platform-engineering).
// Platform Engineering completes anything missing as part of the publish
// request, so each message says so: the builder has nothing to do.

const ORG = 'DavidsonChoreo';
const TEAM = 'platform-engineering';
const WRITE = new Set(['push', 'maintain', 'admin']);
const PE_FIXES = 'Platform Engineering completes this as part of your publish request.';

// `teamPermission` is the PE team's permission on the repository, or null.
// `productOwnerEmail` is the repository's `product-owner-email` property: a
// comma-separated list of contacts copied from the passport, which has to
// include the passport's business owner (pipeline.md, "Claims, facts, cache").
export function checkWorkspace({ repository, teamPermission, productOwnerEmail, businessOwnerEmail }) {
  const problems = [];

  if (!repository.startsWith(`${ORG}/`)) {
    problems.push(`The repository \`${repository}\` isn't in the ${ORG} organization, where Choreo apps are hosted. ${PE_FIXES}`);
  }
  if (!WRITE.has(teamPermission)) {
    problems.push(`The \`${TEAM}\` team doesn't have write access to this repository, so CODEOWNERS can't require Platform Engineering's approval for passport changes. ${PE_FIXES}`);
  }
  if (!productOwnerEmail) {
    problems.push(`The repository has no \`product-owner-email\` property, which renewal reminders and oversight use to reach the business owner. ${PE_FIXES}`);
  } else if (businessOwnerEmail && !contacts(productOwnerEmail).includes(businessOwnerEmail.toLowerCase())) {
    problems.push(`The repository's \`product-owner-email\` is ${productOwnerEmail}, which leaves out the passport's business owner, ${businessOwnerEmail}. ${PE_FIXES}`);
  }

  return { ok: problems.length === 0, problems, warnings: [] };
}

function contacts(list) {
  return list.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
}
