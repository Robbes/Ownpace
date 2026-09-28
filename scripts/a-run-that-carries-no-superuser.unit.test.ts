// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RUN THAT CARRIES THE OWNER'S CONNECTION STRING (workplan 0138 T3).
 *
 * `deploy/compose/set-task-env.sh` uploads the environment every Trigger.dev
 * task run receives. Trigger.dev stores variables per ENVIRONMENT, not per
 * task, so whatever this script uploads, every run of every task holds.
 *
 * Until 0138 T3 step 1 it uploaded three database URLs. One of them,
 * `DIRECT_DATABASE_URL`, was the database owner's credential, straight to
 * `postgres:5432`, past the pooler. It came in with the pooler (2026-08-18),
 * beside the API's own direct URL for the migration advisory lock, although no
 * task runs migrations; `docs/rls-guide.md` §2 later described it as the tasks'
 * migration connection. `runMigrations` is called by the API, the appliance and
 * the seed. The owner is a superuser on this stack, and Postgres applies no row
 * security to a superuser, so every run held a credential that reads past every
 * policy and can run programs on the database server, for nothing.
 *
 * `DATABASE_URL` is the owner's credential as well, through the pooler. Since
 * T1's second step (2026-09-28) the per-tenant tasks read tenant data as
 * `app_user` (`APP_DATABASE_URL`) and read this one only for the audit key's
 * pool of one (`task-pools.ts`), the three jobs split in two read their list
 * of organisations with it and each organisation as `app_user` (T2), and the
 * three jobs that span organisations whole still connect with it. It goes in
 * T3 step 2, once those jobs, the list and that key's pool have a role of
 * their own. Until then it is the one exception below, on
 * a list that may only shrink.
 *
 * WHAT IS CHECKED. The upload block is read whole, and a part of it this cannot
 * read is a failure, not a skip: every line of the `variables` literal and of
 * the optional list, every `process.env` read, every use of `variables` and
 * every `envvars` call must have a shape it knows. The first version skipped a
 * line it could not parse, so `DIRECT_DATABASE_URL: … || ""`, or the old line
 * with a comment after it, came back without a sound. Each value is then traced
 * through the script's assignments, as deep as they go, and one that reaches
 * `$POSTGRES_USER` or `$POSTGRES_PASSWORD`, braced or not, is the owner's
 * whatever it is called. `set -a` exports all of `.env` to the node process, so
 * a read this cannot name is a read it cannot judge. The last block puts back
 * each way review found around the first version, and expects it caught.
 *
 * WHAT IS NOT. A value `.env` itself holds under a name that says nothing: the
 * optional list's NAMES are checked, the values in `.env` are not. And the
 * store. Removing a variable from this script does not remove it from the
 * store, because `envvars.upload` sends only the variables it is given. A plane
 * that held `DIRECT_DATABASE_URL` keeps it until somebody deletes it once,
 * which `docs/managed-bring-up.md` ("Updating a running deployment") writes
 * down as the operator's step. No test here can see a running stack's store.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = readFileSync(join(REPO_ROOT, 'deploy/compose/set-task-env.sh'), 'utf8');

/**
 * The owner-composed variables the upload may still carry, each with the step
 * that removes it. It may only shrink: T3 step 2 empties it, and its PR deletes
 * the exception from the test below.
 */
const OWNER_URL_UNTIL_T3_STEP_2: Record<string, string> = {
  DATABASE_URL:
    'the three jobs that span organisations whole connect with it, the three split jobs read their ' +
    "list of organisations with it (0138 T2), and every task reads it for the audit key's pool of " +
    'one, their tenant data being on APP_DATABASE_URL since 0138 T1 step 2 and T2; T3 step 2 gives ' +
    'all three a role that is not a superuser, and then this goes',
};

/**
 * The database URLs the upload may carry, by the name a task reads, each with
 * the variable the script hands node. T3 step 2 adds its system role's URL
 * here, under a name 0138 T4 reads as a database URL, and takes DATABASE_URL
 * out.
 */
const DATABASE_URL_UPLOADS: Record<string, string> = {
  DATABASE_URL: 'TASK_DATABASE_URL',
  APP_DATABASE_URL: 'TASK_APP_DATABASE_URL',
};

/** What the node block reads to know where to upload. None of it is uploaded. */
const CONTROL = ['TRIGGER_PROJECT_REF', 'TRIGGER_ENV', 'FORCE_REWRITE'];

/**
 * The names 0138 T4 counts as a database URL: the pattern of its `IS_DB_URL`,
 * written out again rather than imported, because importing from a test file
 * runs every case in it. A URL uploaded under another name is one T4 could not
 * see a job read. The first case below checks that the two still agree.
 */
const DB_URL_NAME = /^(?:[A-Z][A-Z0-9]*_)*DATABASE_URL$/;
const T4_GUARD = 'scripts/a-pass-that-opened-the-owners-pool.unit.test.ts';

/** A value that reaches the owner's user or password, braced or not. */
const OWNER = /\$\{?POSTGRES_(?:USER|PASSWORD)\b/;
/** A name that says it holds a database credential. */
const CREDENTIAL_NAME = /DATABASE_URL$|^POSTGRES_|^PG[A-Z]+$|^DB_/;
const POSTGRES_URL = /postgres(?:ql)?:\/\//;

type Rule = 'shape' | 'traced' | 'direct' | 'owner' | 'ratchet' | 'credential' | 'url-name';

interface Reading {
  required: Array<{ name: string; source: string }>;
  optional: string[];
  /** Everything a variable's value is made of in the script, however deep. */
  composition: (name: string) => string;
  findings: Array<{ rule: Rule; message: string }>;
}

/** The shapes `variables` may be used in, each exactly once. */
const VARIABLES_USES = [
  /const variables = \{/g,
  /if \(value\) variables\[name\] = value;/g,
  /Object\.keys\(variables\)/g,
  /envvars\.upload\(ref, slug, \{ variables, override: true \}\)/g,
];

/** Read a set-task-env.sh and say what it uploads and what is wrong with that. */
function read(script: string): Reading {
  const findings: Reading['findings'] = [];
  const flag = (rule: Rule, message: string) => findings.push({ rule, message });

  // Executable lines only. A `#` line in the shell and a `//` line in the node
  // block quote code without running it; a comment after code on the same line
  // stays, and counts.
  const code = script
    .split('\n')
    .filter((l) => !/^\s*(?:#|\/\/)/.test(l))
    .join('\n');

  const runs = code.match(/\bnode\s+(?:-e|--eval|-p|--print)\b/g) ?? [];
  if (runs.length !== 1) flag('shape', `the script runs node inline ${runs.length} times; this reads one upload block`);
  const start = code.indexOf("node -e '");
  const end = start === -1 ? -1 : code.indexOf("\n'", start);
  const block = end === -1 ? '' : code.slice(start + "node -e '".length, end);
  const shell = end === -1 ? code : code.slice(0, start) + code.slice(end);
  if (!block) flag('shape', "no `node -e '…'` upload block found");
  if (/\benvvars\b/.test(shell)) flag('shape', 'envvars is used outside the upload block');

  // The `variables` literal: every line an entry this can read.
  const literals = [...block.matchAll(/const variables = \{([\s\S]*?)\};/g)];
  if (literals.length !== 1) flag('shape', `expected one \`const variables = {…};\`, found ${literals.length}`);
  const required: Reading['required'] = [];
  for (const line of (literals[0]?.[1] ?? '').split('\n')) {
    if (!line.trim()) continue;
    const entry = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*process\.env\.([A-Z][A-Z0-9_]*)\s*,?\s*$/.exec(line);
    if (entry) required.push({ name: entry[1]!, source: entry[2]! });
    else
      flag(
        'shape',
        `a line of \`variables\` this cannot read: ${line.trim()}\n` +
          'Write each entry as NAME: process.env.SOURCE, and put a comment on a line of its own.',
      );
  }

  // The optional loop: its exact shape, and a list of quoted names only.
  const loops = [
    ...block.matchAll(
      /for \(const name of \[([\s\S]*?)\]\) \{\n\s*const value = process\.env\[name\];\n\s*if \(value\) variables\[name\] = value;\n\s*\}/g,
    ),
  ];
  if (loops.length !== 1) flag('shape', `expected one optional loop of the shape this reads, found ${loops.length}`);
  const optional: string[] = [];
  for (const line of (loops[0]?.[1] ?? '').split('\n')) {
    const rest = line.replace(/"([A-Z][A-Z0-9_]*)"/g, (_, name: string) => {
      optional.push(name);
      return '';
    });
    if (rest.replace(/[\s,]/g, '')) flag('shape', `a line of the optional list this cannot read: ${line.trim()}`);
  }

  // Every read of process.env in the block, named.
  const reads: string[] = [];
  let dynamic = 0;
  for (const m of block.matchAll(/process\.env\b(?:\.([A-Za-z_]\w*)|\[\s*(["'`])([A-Za-z_]\w*)\2\s*\]|(\[\s*name\s*\]))?/g)) {
    const name = m[1] ?? m[3];
    if (name) reads.push(name);
    else if (m[4]) dynamic += 1;
    else flag('shape', `a read of process.env this cannot name: …${block.slice(m.index, m.index + 60)}`);
  }
  if (dynamic !== loops.length) flag('shape', `process.env[name] is read ${dynamic} times; the optional loop is the one place`);
  const known = new Set([...required.map((u) => u.source), ...optional, ...CONTROL]);
  for (const name of reads) {
    if (!known.has(name))
      flag(
        'shape',
        `process.env.${name} is read in the upload block and is neither an upload's source, an optional name,\n` +
          `nor one of ${CONTROL.join(', ')}. Upload it through \`variables\` or the optional list, where it is judged.`,
      );
  }

  // Every use of `variables`, and every envvars call.
  const uses = block.match(/\bvariables\b/g)?.length ?? 0;
  const shaped = VARIABLES_USES.map((re) => block.match(re)?.length ?? 0);
  if (uses !== VARIABLES_USES.length || shaped.some((n) => n !== 1)) {
    const lines = block.split('\n').filter((l) => /\bvariables\b/.test(l));
    flag('shape', `\`variables\` is used in a way this cannot judge:\n${lines.map((l) => `  ${l.trim()}`).join('\n')}`);
  }
  for (const m of block.matchAll(/\benvvars\b(?:\.(\w+))?/g)) {
    if (m[1] === undefined ? !block.startsWith('const { envvars } = require("@trigger.dev/sdk")', m.index - 8) : !['upload', 'list', 'del'].includes(m[1]))
      flag('shape', `an envvars use other than require, upload, list and del: …${block.slice(m.index, m.index + 60)}`);
  }

  // Where each value comes from.
  const handed = (source: string) => new RegExp(`^\\s*${source}="([^"]*)"\\s*\\\\$`, 'm').exec(shell)?.[1];
  const assigned = (name: string) =>
    [
      ...shell.matchAll(
        new RegExp(`^\\s*(?:(?:export|local|readonly|declare(?:\\s+-\\w+)*)\\s+)?${name}=(.*?)\\s*\\\\?$`, 'gm'),
      ),
    ].map((m) => m[1]!);
  const composition = (name: string, seen = new Set<string>()): string => {
    if (seen.has(name)) return '';
    seen.add(name);
    let text = `$${name}`;
    for (const value of assigned(name)) {
      text += `\n${value}`;
      for (const ref of value.matchAll(/\$\{?!?([A-Za-z_]\w*)/g)) text += `\n${composition(ref[1]!, seen)}`;
    }
    return text;
  };

  for (const { name, source } of required) {
    if (handed(source) === undefined)
      flag('traced', `${name} is uploaded from process.env.${source}, and no ${source}="…" \\ line hands it to node`);
  }

  if (code.includes('DIRECT_DATABASE_URL'))
    flag(
      'direct',
      'set-task-env.sh names DIRECT_DATABASE_URL again. It is the database owner,\n' +
        'straight to Postgres past the pooler, and no task reads it: the tasks do not run\n' +
        'migrations (the API, the appliance and the seed do). Every run of every task would\n' +
        'hold it, because Trigger.dev stores variables per environment.',
    );

  const ownerSources = new Set(required.filter((u) => u.name in OWNER_URL_UNTIL_T3_STEP_2).map((u) => u.source));
  for (const name of new Set([...reads, ...optional])) {
    if (OWNER.test(composition(name)) && !ownerSources.has(name))
      flag(
        'owner',
        `process.env.${name} is made from $POSTGRES_USER or $POSTGRES_PASSWORD: the database owner, a\n` +
          'superuser on this stack, whom row security never binds. Every run of every task would hold it.\n' +
          'Upload the application role (APP_DB_USER) instead, or, for a job that spans\n' +
          'organisations, the role 0138 T3 step 2 creates.',
      );
  }
  for (const name of Object.keys(OWNER_URL_UNTIL_T3_STEP_2)) {
    const upload = required.find((u) => u.name === name);
    if (!upload || !OWNER.test(composition(upload.source)))
      flag(
        'ratchet',
        `${name} is no longer uploaded as the owner. If that is 0138 T3 step 2, delete it\n` +
          'from OWNER_URL_UNTIL_T3_STEP_2: the list only shrinks.',
      );
  }

  for (const name of optional) {
    if (CREDENTIAL_NAME.test(name))
      flag('credential', `${name}, in the optional list, would carry a database credential from .env into every run`);
  }
  for (const { name, source } of required) {
    if (DATABASE_URL_UPLOADS[name] === source) continue;
    if (CREDENTIAL_NAME.test(name) || CREDENTIAL_NAME.test(source))
      flag(
        'credential',
        `${name} (from ${source}) would carry a database credential into every run. The database URLs\n` +
          'the upload may carry are DATABASE_URL_UPLOADS, each from its own TASK_ variable.',
      );
  }

  for (const { name, source } of [...required, ...optional.map((n) => ({ name: n, source: n }))]) {
    if (POSTGRES_URL.test(composition(source)) && !DB_URL_NAME.test(name))
      flag(
        'url-name',
        `${name} carries a postgres:// URL under a name 0138 T4 does not read as a database URL,\n` +
          'so a job reading it would open a pool no guard sees. Name it …DATABASE_URL.',
      );
  }

  return { required, optional, composition, findings };
}

const REAL = read(SCRIPT);
const found = (rule: Rule) => REAL.findings.filter((f) => f.rule === rule).map((f) => f.message);

describe('a task run carries no owner connection it does not need', () => {
  it('found the upload and traced it, rather than checking nothing', () => {
    // If the shape of the script changes, this goes red instead of every case
    // below passing over an empty list.
    const names = REAL.required.map((u) => u.name);
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('APP_DATABASE_URL');
    expect(names).toContain('SECRET_ENCRYPTION_KEY');
    expect(REAL.optional).toContain('SMTP_HOST');
    // The tracing works on a value it must find: the application role's URL is
    // composed here from APP_DB_USER. The cases at the end show the owner test
    // finding what it must.
    expect(REAL.composition('TASK_APP_DATABASE_URL')).toContain('${APP_DB_USER');
    // And T4 still counts the same names as a database URL.
    expect(readFileSync(join(REPO_ROOT, T4_GUARD), 'utf8')).toContain(DB_URL_NAME.source);
  });

  it('reads the whole upload block, with nothing in it of a shape it cannot judge', () => {
    expect(found('shape'), found('shape').join('\n\n')).toEqual([]);
  });

  it('traces every uploaded variable to where it is composed', () => {
    // A variable this cannot trace is one it cannot judge. Red, not a pass.
    expect(found('traced'), found('traced').join('\n')).toEqual([]);
  });

  it('uploads no DIRECT_DATABASE_URL, which no task reads (0138 T3 step 1)', () => {
    expect(found('direct'), found('direct').join('\n')).toEqual([]);
  });

  it('uploads no owner-composed value but the one T3 step 2 removes', () => {
    expect(found('owner'), found('owner').join('\n\n')).toEqual([]);
    expect(found('ratchet'), found('ratchet').join('\n')).toEqual([]);
  });

  it('passes no database credential through under a name of its own', () => {
    // The optional list uploads whatever `.env` holds under each name, and a
    // required entry can hand node any variable. The owner's password or a URL
    // there would reach every run without being composed where the case above
    // looks.
    expect(found('credential'), found('credential').join('\n')).toEqual([]);
  });

  it('uploads a database URL only under a name 0138 T4 reads as one', () => {
    expect(found('url-name'), found('url-name').join('\n')).toEqual([]);
  });
});

/** Insert `add` after the first line that starts with `at`. */
const afterLine = (at: string, add: string) => (s: string) => {
  const i = s.indexOf(at);
  if (i === -1) return s;
  const eol = s.indexOf('\n', i) + 1;
  return s.slice(0, eol) + add + '\n' + s.slice(eol);
};
const compose = (...steps: Array<(s: string) => string>) => (s: string) => steps.reduce((acc, f) => f(acc), s);

/** A line of the script's own, a prefix in front of `node -e`, an entry in `variables`. */
const ASSIGN = (add: string) => afterLine('TASK_APP_DATABASE_URL="postgresql://', add);
const PREFIX = (add: string) => afterLine('  TASK_APP_DATABASE_URL="$TASK_APP_DATABASE_URL" \\', add);
const ENTRY = (add: string) => afterLine('    SECRET_ENCRYPTION_KEY: process.env.SECRET_ENCRYPTION_KEY,', add);
const AFTER_LITERAL = (add: string) => (s: string) =>
  s.replace('SECRET_ENCRYPTION_KEY: process.env.SECRET_ENCRYPTION_KEY,\n  };\n', (m) => `${m}${add}\n`);
const DIRECT =
  'TASK_DIRECT_DATABASE_URL="postgresql://${POSTGRES_USER:-openmigrate}:${POSTGRES_PASSWORD:-openmigrate_password}@postgres:5432/${POSTGRES_DB:-openmigrate}"';
const HAND_DIRECT = PREFIX('  TASK_DIRECT_DATABASE_URL="$TASK_DIRECT_DATABASE_URL" \\');
const OWNER_PREFIX = PREFIX('  TASK_OWNER="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}" \\');
const optionalAlso = (add: string) => (s: string) => s.replace('"LOG_LEVEL",\n', `"LOG_LEVEL", ${add},\n`);

const MIGRATION_URL = (assign: string) =>
  compose(
    ASSIGN(assign),
    PREFIX('  TASK_MIGRATION_URL="$TASK_MIGRATION_URL" \\'),
    ENTRY('    MIGRATION_URL: process.env.TASK_MIGRATION_URL,'),
  );

const COMES_BACK: Array<[string, (s: string) => string, Rule[]]> = [
  [
    'the direct URL, as it was',
    compose(ASSIGN(DIRECT), HAND_DIRECT, ENTRY('    DIRECT_DATABASE_URL: process.env.TASK_DIRECT_DATABASE_URL,')),
    ['direct', 'owner'],
  ],
  [
    'the direct URL with a comment after it',
    compose(
      ASSIGN(DIRECT),
      HAND_DIRECT,
      ENTRY('    DIRECT_DATABASE_URL: process.env.TASK_DIRECT_DATABASE_URL, // migrations'),
    ),
    ['shape', 'direct'],
  ],
  [
    'the direct URL or an empty string',
    compose(ASSIGN(DIRECT), HAND_DIRECT, ENTRY('    DIRECT_DATABASE_URL: process.env.TASK_DIRECT_DATABASE_URL || "",')),
    ['shape', 'direct'],
  ],
  [
    'the direct URL written into variables after the literal',
    compose(
      ASSIGN(DIRECT),
      HAND_DIRECT,
      AFTER_LITERAL('  variables.DIRECT_DATABASE_URL = process.env.TASK_DIRECT_DATABASE_URL;'),
    ),
    ['shape', 'direct', 'owner'],
  ],
  [
    'the owner composed in the prefix, written in under another name',
    compose(OWNER_PREFIX, AFTER_LITERAL('  variables.MIGRATION_URL = process.env.TASK_OWNER;')),
    ['shape', 'owner'],
  ],
  [
    'the owner with an unbraced $POSTGRES_USER, under another name',
    MIGRATION_URL('TASK_MIGRATION_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB"'),
    ['owner', 'url-name'],
  ],
  [
    'the owner two assignments deep',
    MIGRATION_URL(
      'OWNER_USER="${POSTGRES_USER:-openmigrate}"\nTASK_MIGRATION_URL="postgresql://${OWNER_USER}:x@postgres:5432/y"',
    ),
    ['owner'],
  ],
  [
    "the owner's password as a required upload",
    compose(PREFIX('  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \\'), ENTRY('    PGPASSWORD: process.env.POSTGRES_PASSWORD,')),
    ['credential', 'owner'],
  ],
  ["the owner's password in the optional list", optionalAlso('"POSTGRES_PASSWORD"'), ['credential', 'owner']],
  ['a name in the optional list that is not a quoted string', optionalAlso('extra'), ['shape']],
  [
    'a database URL under a name T4 does not read as one',
    compose(
      ASSIGN('TASK_SYSTEM_URL="postgresql://${SYSTEM_DB_USER:-system}:${SYSTEM_DB_PASSWORD:-x}@pgbouncer:6432/db"'),
      PREFIX('  TASK_SYSTEM_URL="$TASK_SYSTEM_URL" \\'),
      ENTRY('    SYSTEM_URL: process.env.TASK_SYSTEM_URL,'),
    ),
    ['url-name'],
  ],
  [
    'DATABASE_URL composed from another role, its entry kept',
    (s) => s.replace('TASK_DATABASE_URL="postgresql://${POSTGRES_USER:-openmigrate}:${POSTGRES_PASSWORD', 'TASK_DATABASE_URL="postgresql://${APP_DB_USER:-app_user}:${APP_DB_PASSWORD'),
    ['ratchet'],
  ],
  [
    'an envvars call other than upload, list and del',
    compose(
      OWNER_PREFIX,
      AFTER_LITERAL('  await envvars.create(ref, slug, { name: "MIGRATIONS", value: process.env.TASK_OWNER });'),
    ),
    ['shape', 'owner'],
  ],
  ['process.env destructured', compose(OWNER_PREFIX, AFTER_LITERAL('  const { TASK_OWNER } = process.env;')), ['shape']],
  [
    'a second node block that uploads',
    (s) =>
      s.replace(
        'echo "[set-task-env] done.',
        `node -e '\nrequire("@trigger.dev/sdk").envvars.upload(process.env.TRIGGER_PROJECT_REF, "prod", { variables: {} });\n'\necho "[set-task-env] done.`,
      ),
    ['shape'],
  ],
];

describe('each way back that review found around the first version is caught', () => {
  it.each(COMES_BACK)('%s', (_label, mutate, rules) => {
    const mutated = mutate(SCRIPT);
    expect(mutated, 'the mutation no longer applies to the script: update its anchor').not.toBe(SCRIPT);
    const raised = new Set(read(mutated).findings.map((f) => f.rule));
    for (const rule of rules) expect([...raised], `expected the ${rule} rule to fire`).toContain(rule);
  });
});
