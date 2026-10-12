# dc-choreo-workflows

Shared CI for Choreo, the app hosting platform run by Davidson College Technology & Innovation's Platform Engineering team. Every repository Choreo hosts runs the checks and the deploy workflow kept here.

This repository is public on purpose. GitHub runs a required workflow only on repositories whose visibility matches it, and Choreo's hosted repositories are public.

## Contents

| Path | What it is |
|---|---|
| `schemas/passport/v1.schema.json` | The passport: `PASSPORT.yml` at the root of every hosted repository, holding the owner's claims about the app |
| `schemas/report/v1.schema.json` | The assessor's report, which Information Security, College Communications and Platform Engineering each approve from |
| `examples/` | A valid example of each |

The required checks, the reusable deploy workflow, the rubrics and the official-sites list arrive here as the build goes on.

## Working with the schemas

- **Dates are quoted strings.** YAML reads an unquoted `2026-10-12` as a date object, which fails the schema. Write `created: "2026-10-12"`.
- **Fields that re-run the ready call** are listed in the passport schema's `x-ready-call-fields`. A validator in strict mode, such as Ajv, needs that keyword allowed.
- **One passport rule lives outside the schema.** The business owner can't also be an app owner. JSON Schema can't compare two fields, so the passport check enforces it.
- **The passport hash** in a report is the SHA-256 of `PASSPORT.yml`'s bytes.
- **Control IDs** in a report's security section are item numbers from Information Security's review standard, such as `4.3` for server-side authorization or `5.1.4` for testing that a lower role can't act as a higher one. Platform Engineering numbers the items in its copy of the standard.

## Changes

Every change needs a pull request and an approving review. A new schema version gets a new file, and a published version never changes.
