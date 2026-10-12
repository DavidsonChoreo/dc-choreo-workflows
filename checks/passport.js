// The passport check: PASSPORT.yml against the version 1 schema, plus the one
// rule JSON Schema can't express. Every message is written for the builder,
// not the validator: which field, what's wrong, and how to fix it.

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseDocument } from 'yaml';

const schema = JSON.parse(
  readFileSync(new URL('../schemas/passport/v1.schema.json', import.meta.url), 'utf8'),
);

// strictTypes off: the frozen schema's conditional rules leave out `type`,
// which is valid JSON Schema but makes Ajv warn on every run.
const ajv = new Ajv2020({ allErrors: true, verbose: true, strictTypes: false });
addFormats(ajv);
ajv.addKeyword('x-ready-call-fields');
const validate = ajv.compile(schema);

export function checkPassport(text) {
  if (!text.trim()) {
    return fail(null, 'PASSPORT.yml is empty. It has to describe the app; the plugin writes one for you.');
  }

  // YAML 1.1 reads an unquoted 2026-10-12 as a date, as most YAML tools do,
  // so the check catches it before another tool does.
  const doc = parseDocument(text, { schema: 'yaml-1.1' });
  if (doc.errors.length > 0) {
    const line = doc.errors[0].linePos?.[0]?.line ?? '?';
    return fail(null, `PASSPORT.yml isn't valid YAML at line ${line}. Check the indentation, quotes and brackets on that line.`);
  }

  const passport = doc.toJS();
  if (passport === null || typeof passport !== 'object' || Array.isArray(passport)) {
    return fail(null, 'PASSPORT.yml has to be a list of fields, such as `app: my-app`, one per line.');
  }

  const problems = [];
  if (!validate(passport)) {
    const seen = new Set();
    for (const error of validate.errors) {
      const problem = explain(error);
      if (problem && !seen.has(problem.field)) {
        seen.add(problem.field);
        problems.push(problem);
      }
    }
  }
  problems.push(...businessOwnerRule(passport));

  return { ok: problems.length === 0, problems };
}

function fail(field, message) {
  return { ok: false, problems: [{ field, message }] };
}

function businessOwnerRule(passport) {
  const owner = passport.business_owner?.email?.toLowerCase();
  const builders = (Array.isArray(passport.app_owners) ? passport.app_owners : [])
    .map((person) => person?.email?.toLowerCase());
  if (owner && builders.includes(owner)) {
    return [{
      field: 'business_owner',
      message: `\`business_owner\` (${passport.business_owner.email}) is also one of the \`app_owners\`. The business owner has to be someone other than the app owners: the person accountable for the app outside the build, such as a department head.`,
    }];
  }
  return [];
}

// One validator error becomes one message, or null when another error on the
// same field explains it better.
function explain(error) {
  const field = toField(error.instancePath);
  const rule = ruleDescription(error.schemaPath);

  // "A branch failed" wrappers; the branch's own error carries the detail.
  if (error.keyword === 'if') return null;

  // A field with more than one allowed shape: describe the field, not each shape.
  if (error.schemaPath.includes('/oneOf/')) return null;
  if (error.keyword === 'oneOf') {
    return { field, message: `\`${field}\` isn't in a form the passport accepts. ${describe(field)}` };
  }

  switch (error.keyword) {
    case 'required': {
      const missing = join(field, error.params.missingProperty);
      return { field: missing, message: `\`${missing}\` is missing. ${describe(missing)}` };
    }
    case 'additionalProperties': {
      const extra = join(field, error.params.additionalProperty);
      return { field: extra, message: `\`${extra}\` isn't a passport field. Remove it, or check the spelling against the passport schema.` };
    }
    case 'enum':
    case 'const': {
      const allowed = error.keyword === 'enum' ? error.params.allowedValues : [error.params.allowedValue];
      const choices = allowed.length > 1 ? `one of: ${allowed.join(', ')}` : JSON.stringify(allowed[0]);
      return { field, message: `\`${field}\` is ${JSON.stringify(error.data)}, but it has to be ${choices}.${rule ? ` ${rule}` : ''}` };
    }
    case 'type': {
      if (error.data instanceof Date) {
        const key = field.split('.').pop();
        const day = error.data.toISOString().slice(0, 10);
        return { field, message: `\`${field}\` needs quotes around the date. Write it as ${key}: "${day}".` };
      }
      return { field, message: `\`${field}\` should be ${article(error.params.type)}. ${describe(field)}` };
    }
    case 'pattern':
    case 'format': {
      if (field.endsWith('email')) {
        return { field, message: `\`${field}\` has to be a davidson.edu address.` };
      }
      if (error.parentSchema?.format === 'date') {
        return { field, message: `\`${field}\` has to be a date written as "YYYY-MM-DD", in quotes.` };
      }
      return { field, message: `\`${field}\` isn't in the right form. ${describe(field)}` };
    }
    case 'minItems':
    case 'maxItems': {
      const { limit } = error.params;
      const entries = `${limit} ${limit === 1 ? 'entry' : 'entries'}`;
      const bound = error.keyword === 'minItems' ? `needs at least ${entries}`
        : limit === 0 ? 'has to be empty' : `can have at most ${entries}`;
      return { field, message: `\`${field}\` ${bound}. ${rule ?? describe(field)}` };
    }
    case 'minLength':
      return { field, message: `\`${field}\` is too short. ${describe(field)}` };
    case 'uniqueItems':
      return { field, message: `\`${field}\` lists the same entry twice.` };
    default:
      return { field, message: `\`${field}\` isn't valid. ${rule ?? describe(field)}` };
  }
}

// "/profile/tier" -> "profile.tier"; "/app_owners/0/email" -> "app_owners[0].email"
function toField(instancePath) {
  return instancePath
    .split('/')
    .slice(1)
    .reduce((path, part) => (/^\d+$/.test(part) ? `${path}[${part}]` : path ? `${path}.${part}` : part), '');
}

function join(parent, child) {
  return parent ? `${parent}.${child}` : child;
}

function article(type) {
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

// The description of the conditional rule an error came from, such as
// "A container app defines at least one Entra app role."
function ruleDescription(schemaPath) {
  const match = schemaPath.match(/^#\/allOf\/(\d+)\//);
  return match ? schema.allOf[Number(match[1])].description : null;
}

// The schema's own description of a field, following $refs into $defs.
function describe(field) {
  let node = schema;
  for (const part of field.replace(/\[\d+\]/g, '.items').split('.')) {
    node = resolve(node);
    node = part === 'items' ? node?.items : node?.properties?.[part];
  }
  return node?.description ?? resolve(node)?.description ?? '';
}

function resolve(node) {
  const ref = node?.$ref;
  return ref ? schema.$defs[ref.replace('#/$defs/', '')] : node;
}
