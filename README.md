# dc-choreo-workflows

Shared CI for Choreo, the app hosting platform run by Davidson College Technology & Innovation's Platform Engineering team. Every repository Choreo hosts runs the checks and the deploy workflow kept here.

This repository is public on purpose. GitHub runs a required workflow only on repositories whose visibility matches it, and Choreo's hosted repositories are public.

## Contents

| Path | What it is |
|---|---|
| `schemas/passport/v1.schema.json` | The passport: `PASSPORT.yml` at the root of every hosted repository, holding the owner's claims about the app |
| `schemas/report/v1.schema.json` | The assessor's report, which Information Security, College Communications and Platform Engineering each approve from |
| `examples/` | A valid example of each |
| `checks/passport.js` | The passport check: the schema, plus the rule that the business owner isn't an app owner |
| `checks/license.js` | A `LICENSE` file that matches the passport's `license`; Apache-2.0, MIT and BSD-3-Clause pass, others pass with a warning for review |
| `checks/tier.js` | The code matches the tier: no `server/` on Pages; on a container app, a Containerfile with digest-pinned base images, a non-root final user and a healthcheck |
| `checks/files.js` | `AGENTS.md` and `CLAUDE.md` match a released canonical copy, and `CODEOWNERS` gives them and `PASSPORT.yml` to `@DavidsonChoreo/platform-engineering` |
| `checks/secrets.js` | Explains a gitleaks scan of the full history: each secret, its file, line and first commit, never its value or author |
| `checks/audit.js` | Explains `npm audit`: high and critical vulnerabilities fail, moderate and low warn |
| `checks/indexing.js` | The built site matches the passport's `indexable`: noindex on every page (and the header on a container app) or a sitemap and robots.txt |
| `checks/cli.js` | Runs one check at an app's root: `node checks/cli.js <passport\|license\|tier\|files\|secrets\|build-plan\|audit\|indexing>`. Problems become error annotations, warnings become warning annotations, and both go in the job summary |
| `canonical/hashes.json` | The SHA-256 of every released version of `AGENTS.md` and `CLAUDE.md` |
| `official-sites.yml` | The websites College Communications authorizes, which the overlap check compares new apps against. Schema in `schemas/official-sites/` |
| `canonical/CODEOWNERS` | The `CODEOWNERS` the package writes into every app, at `.github/CODEOWNERS` |
| `actions/check/` | The file checks (passport, license, tier, files) as one composite action, so a run always uses the scripts from its own version |
| `actions/secrets/` | Installs gitleaks (pinned, checksum verified), scans the full history and explains what it finds |
| `actions/build/` | For paved-road apps: `npm ci`, the audit, `npm run build`, then the indexing check on the built site. Other stacks are skipped with a warning |
| `test/` | Tests for the checks, run with `npm test`, `test/fixtures/app`, a sample container app that passes the file checks, and `test/fixtures/pages-app`, a sample Pages site that builds and passes indexing |
| `.github/workflows/checks.yml` | The reusable workflow every app calls. Each check is its own job |
| `.github/workflows/required.yml` | Calls `checks.yml` on pull requests. The `lifecycle: hosted` ruleset requires it |

The remaining checks, the reusable deploy workflow and the rubrics arrive here as the build goes on.

## Published schemas

Each schema's `$id` is its address. A published version never changes, so these URLs are stable:

- Passport, version 1: `https://raw.githubusercontent.com/DavidsonChoreo/dc-choreo-workflows/main/schemas/passport/v1.schema.json`
- Report, version 1: `https://raw.githubusercontent.com/DavidsonChoreo/dc-choreo-workflows/main/schemas/report/v1.schema.json`
- Official sites, version 1: `https://raw.githubusercontent.com/DavidsonChoreo/dc-choreo-workflows/main/schemas/official-sites/v1.schema.json`

## When the checks run

Incubating apps are private, and their builders have full autonomy: nothing runs in an incubating repository. The checks run at two points:

- **The publish request.** When a builder asks to publish, the assessor run in this repository calls `checks.yml` with the app's `repository` and `ref`, and a token that can read the private repository. This is where the real scrutiny starts.
- **Every pull request on a hosted app.** The `lifecycle: hosted` ruleset requires `required.yml`, which calls `checks.yml`. Merges into `main` need the checks to pass, and a builder can't remove a required workflow.

## Versions

Apps call `@v1`, a tag that moves forward with each compatible release, so fixes reach every app without anyone editing their repository. A change that would break apps ships as `@v2`. The workflows inside this repository also reference `@v1`, so a change to an action takes effect for apps when `v1` moves, not when it merges.


## Working with the schemas

- **Dates are quoted strings.** YAML reads an unquoted `2026-10-12` as a date object, which fails the schema. Write `created: "2026-10-12"`.
- **Fields that re-run the ready call** are listed in the passport schema's `x-ready-call-fields`. A validator in strict mode, such as Ajv, needs that keyword allowed.
- **One passport rule lives outside the schema.** The business owner can't also be an app owner. JSON Schema can't compare two fields, so the passport check (`checks/passport.js`) enforces it.
- **The passport hash** in a report is the SHA-256 of `PASSPORT.yml`'s bytes.
- **Control IDs** in a report's security section are item numbers from Information Security's review standard, such as `4.3` for server-side authorization or `5.1.4` for testing that a lower role can't act as a higher one. Platform Engineering numbers the items in its copy of the standard.

## Canonical governance files

`AGENTS.md` and `CLAUDE.md` belong to Platform Engineering, and every app carries a copy written by the package. An app passes when its copy matches **any** released version, so apps scaffolded with an older package still pass until they update.

`CODEOWNERS` is checked by what it says, not by hash, so builders can add owners for their own files. The check reads the **last** line matching each governed file, since that's the line GitHub applies, and fails when it leaves out the PE team. The team needs write access to the repository for GitHub to honor it; repository creation grants it.

When a package release changes either file, its release adds an entry to `canonical/hashes.json` in a pull request here, with the file's SHA-256 after converting line endings to `\n` and a `from` naming the release. `hashOf` in `checks/files.js` computes it.

## Working on the checks

Node 22 or later. `npm ci`, then `npm test`. Dependencies are pinned to exact versions, and CI runs the tests on every pull request.

Check messages are read by builders, most of them not developers. Each one names the field, says what's wrong, and says how to fix it, in plain words. Raw validator output never reaches a builder.

## Changes

Every change needs a pull request and an approving review. A new schema version gets a new file, and a published version never changes.
