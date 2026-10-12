// The tier check: the code matches the hosting tier the passport names.
// A Pages site has no server code. A container app has a Containerfile whose
// base images are pinned by digest, whose final stage runs as a non-root
// user, and which declares a healthcheck (pipeline.md, deterministic checks).

export function checkTier({ tier, paths, containerfile }) {
  const problems = [];

  if (tier === 'pages') {
    if (paths.some((path) => path.startsWith('server/'))) {
      problems.push('This is a Pages site, which has no server, but the repository has a `server/` directory. Move that code out, or ask Platform Engineering about a container app instead.');
    }
  }

  if (tier === 'container') {
    if (containerfile === null) {
      problems.push('A container app needs a Containerfile (or Dockerfile) at the repository root. The package writes one; restore it, or ask Platform Engineering.');
    } else {
      problems.push(...checkContainerfile(containerfile));
    }
  }

  return { ok: problems.length === 0, problems, warnings: [] };
}

function checkContainerfile(text) {
  const problems = [];
  const stages = parseStages(text);
  const names = new Set(stages.map((stage) => stage.name).filter(Boolean));

  for (const { image } of stages) {
    if (image === 'scratch' || names.has(image)) continue;
    if (!/@sha256:[a-f0-9]{64}$/.test(image)) {
      problems.push(`The base image \`${image}\` isn't pinned by digest. A tag can be moved to a different image; a digest can't. Write it as \`${image.split('@')[0]}@sha256:...\`.`);
    }
  }

  const final = stages.at(-1);
  const user = final?.instructions.filter(([op]) => op === 'USER').at(-1)?.[1];
  if (!user) {
    problems.push('The final stage of the Containerfile has no USER instruction, so the app would run as root. Add `USER node` (or another non-root user) to the final stage.');
  } else if (/^(root|0)(:.*)?$/.test(user)) {
    problems.push(`The Containerfile's final stage runs as \`${user}\`, which is root. Switch to a non-root user, such as \`USER node\`.`);
  }

  const healthcheck = final?.instructions.filter(([op]) => op === 'HEALTHCHECK').at(-1)?.[1];
  if (!healthcheck || /^NONE\b/i.test(healthcheck)) {
    problems.push('The Containerfile has no HEALTHCHECK, so the platform can\'t tell when the app has stopped answering. Add one that calls the app\'s health endpoint.');
  }

  return problems;
}

// Splits a Containerfile into stages: each FROM's image, its alias, and the
// instructions under it. Line continuations are joined; comments are dropped.
function parseStages(text) {
  const lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const stages = [];
  for (const line of lines) {
    const [, op, rest = ''] = line.match(/^(\S+)\s*(.*)$/);
    if (op.toUpperCase() === 'FROM') {
      const words = rest.split(/\s+/).filter((word) => !word.startsWith('--'));
      const as = words.findIndex((word) => word.toUpperCase() === 'AS');
      stages.push({ image: words[0], name: as >= 0 ? words[as + 1] : null, instructions: [] });
    } else if (stages.length > 0) {
      stages.at(-1).instructions.push([op.toUpperCase(), rest]);
    }
  }
  return stages;
}
