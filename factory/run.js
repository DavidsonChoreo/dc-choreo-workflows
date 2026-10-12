// Runs the app factory from the workflow's inputs: INPUT_GITHUB_USERNAME,
// INPUT_DAVIDSON_EMAIL and INPUT_REPOSITORY, with GITHUB_TOKEN from the
// davidson-choreo-factory app. Writes what it did to the job summary.

import { appendFileSync } from 'node:fs';
import { validateInputs, runFactory } from './factory.js';

const org = process.env.CHOREO_ORG ?? 'DavidsonChoreo';
const inputs = {
  github_username: process.env.INPUT_GITHUB_USERNAME?.trim(),
  davidson_email: process.env.INPUT_DAVIDSON_EMAIL?.trim(),
  repository: process.env.INPUT_REPOSITORY?.trim() || '',
};

const summarize = (heading, lines) => {
  const text = `### ${heading}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(text);
};

const errors = validateInputs(inputs);
if (errors.length > 0) {
  summarize('App factory: nothing done, the inputs need fixing', errors);
  process.exit(1);
}

async function github(method, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

try {
  summarize(`App factory: ${inputs.github_username}`, await runFactory({ org, github, inputs }));
} catch (error) {
  summarize(`App factory: stopped for ${inputs.github_username}`, [error.message, 'Steps before this one are done; rerunning is safe.']);
  process.exitCode = 1;
}
