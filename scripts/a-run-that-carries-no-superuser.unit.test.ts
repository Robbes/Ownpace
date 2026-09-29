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
 * `DATABASE_URL` was the owner's credential as well, through the pooler, and
 * went in T3 step 2 (2026-09-28). By then the per-tenant tasks read tenant
 * data as `app_user` (`APP_DATABASE_URL`, T1) and the digest, the drift
 * detector and group discovery each organisation's rows as `app_user` too
 * (T2), and what still read the owner's URL was the three jobs that span
 * organisations whole, the split jobs' list of organisations, and the audit
 * key's pool of one. Those connect as `ownpace_system` now, a role that is not
 * a superuser, may not create roles or databases, belongs to no role, and
 * holds `BYPASSRLS` and the grants its statements need
 * (`packages/managed/migrations/0032_a_system_role_that_is_not_the_owner.sql`),
 * under `SYSTEM_DATABASE_URL`. So no value the upload carries may be composed
 * from the owner's user or password, under any name, and neither of the names
 * the owner went up under may go up again.
 *
 * AND THE STORE FORGETS THEM. `envvars.upload` sends the variables it is given
 * and nothing else, so leaving a name out of the upload does not take it out
 * of the store: a plane that held `DIRECT_DATABASE_URL` kept it after step 1
 * until the owner deleted it by hand. Step 2 deletes both of the owner's names
 * itself, in a run of its own, `set-task-env.sh --forget-owner-names`, which
 * uploads nothing, and which the bring-up runs only after `deploy-tasks.sh`
 * has put tasks that read the system role's URL in place: a deploy that fails
 * leaves the tasks still deployed the owner's URL they read. That run refuses
 * when the list the store answers still holds either: the list, not what a
 * delete answered, is the check. The upload run deletes neither, and says so
 * when one is still stored.
 *
 * THE SCRIPT RUNS, as well as being read. The reading below judges every value
 * the upload could carry; whether a list still holding the owner's name fails
 * the run, whether the upload run deletes anything of the owner's, and whether
 * an unfit system role stops the upload, are questions about what the script
 * DOES, and a reading of them passed with the exit that makes the refusal a
 * refusal deleted (0138 T3 step 2 review). So the whole script runs in a copy
 * of its directory, against a stand-in `@trigger.dev/sdk` that records every
 * call and answers `list` with what a case says, and a stand-in `docker` that
 * answers the system role question (`db_roles_system_fit`, which the upload
 * run asks itself before its URL goes up).
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
 * a read this cannot name is a read it cannot judge. The system role's URL is
 * held to its name and to `${SYSTEM_DB_PASSWORD}`, which the script refuses to
 * go on without, with no default a password could hide in. The last block puts
 * back each way review found around the first version, and each way back to
 * the owner step 2 closed, and expects it caught.
 *
 * WHAT IS NOT. A value `.env` itself holds under a name that says nothing: the
 * optional list's NAMES are checked, the values in `.env` are not. Whether the
 * role the URL names is what the migration made it: the bring-up asks Postgres
 * that before this script runs (`db_roles_system_fit`,
 * `a-superuser-the-bring-up-would-have-uploaded`, and this script asks it
 * again). And the store itself: no test here can see a running stack's, which
 * is why the script reads it back.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = readFileSync(join(REPO_ROOT, 'deploy/compose/set-task-env.sh'), 'utf8');

/**
 * The names the database owner went up under, each with the step that stopped
 * it. The script deletes both from the store on every run, and neither may be
 * uploaded again, under any value.
 */
const OWNER_NAMES: Record<string, string> = {
  DATABASE_URL: 'T3 step 2: the jobs across organisations, their list and the audit key connect as the system role',
  DIRECT_DATABASE_URL: 'T3 step 1: no task reads it, and no task runs migrations',
};

/** The role the jobs across organisations connect as (managed migration 0032), and its password in `.env`. */
const SYSTEM_ROLE = 'ownpace_system';
const SYSTEM_PASSWORD = 'SYSTEM_DB_PASSWORD';

/**
 * The database URLs the upload may carry, by the name a task reads, each with
 * the variable the script hands node: the application role's, and since T3
 * step 2 the system role's, under a name 0138 T4 reads as a database URL.
 */
const SYSTEM_SOURCE = 'TASK_SYSTEM_DATABASE_URL';
const DATABASE_URL_UPLOADS: Record<string, string> = {
  SYSTEM_DATABASE_URL: SYSTEM_SOURCE,
  APP_DATABASE_URL: 'TASK_APP_DATABASE_URL',
};

/** What the node block reads to know where to upload. None of it is uploaded. */
const CONTROL = ['TRIGGER_PROJECT_REF', 'TRIGGER_ENV', 'FORCE_REWRITE', 'FORGET_OWNER_NAMES'];

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

type Rule = 'shape' | 'traced' | 'direct' | 'owner' | 'owner-name' | 'system' | 'deletes' | 'credential' | 'url-name';

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

  // The one place the name may stand: the list of names the script deletes.
  const ownerNamesLiteral = /^\s*const OWNER_NAMES = \[[^\]\n]*\];\s*$/m;
  if (code.replace(ownerNamesLiteral, '').includes('DIRECT_DATABASE_URL'))
    flag(
      'direct',
      'set-task-env.sh names DIRECT_DATABASE_URL again. It is the database owner,\n' +
        'straight to Postgres past the pooler, and no task reads it: the tasks do not run\n' +
        'migrations (the API, the appliance and the seed do). Every run of every task would\n' +
        'hold it, because Trigger.dev stores variables per environment. It may stand in\n' +
        'OWNER_NAMES alone, the names the script deletes from the store.',
    );

  for (const name of new Set([...reads, ...optional])) {
    if (OWNER.test(composition(name)))
      flag(
        'owner',
        `process.env.${name} is made from $POSTGRES_USER or $POSTGRES_PASSWORD: the database owner, a\n` +
          'superuser on this stack, whom row security never binds. Every run of every task would hold it.\n' +
          'Upload the application role (APP_DB_USER), or, for a job that spans organisations, the\n' +
          `system role (${SYSTEM_ROLE}, SYSTEM_DATABASE_URL), which 0138 T3 step 2 created for it.`,
      );
  }
  for (const { name } of [...required, ...optional.map((n) => ({ name: n }))]) {
    if (OWNER_NAMES[name] !== undefined)
      flag(
        'owner-name',
        `${name} is uploaded again. It is the name the database owner went up under until 0138\n` +
          `${OWNER_NAMES[name]}. No task reads it (a-pass-that-opened-the-owners-pool), and the script\n` +
          'deletes it from the store on every run: uploaded, it would be put back and deleted in one run.',
      );
  }

  // The system role's URL: uploaded, under its own name, from its own variable,
  // composed from the role's name and SYSTEM_DB_PASSWORD, which the script
  // refuses to go on without.
  const system = required.find((u) => u.name === 'SYSTEM_DATABASE_URL');
  if (!system || system.source !== SYSTEM_SOURCE)
    flag(
      'system',
      'SYSTEM_DATABASE_URL is not uploaded from TASK_SYSTEM_DATABASE_URL. The jobs that span organisations,\n' +
        "their list and the audit key's pool read it and refuse to start without it (0138 T3 step 2).",
    );
  // Its composition, not the line that hands it to node (`NAME="$NAME" \`).
  const systemAssigned = assigned(SYSTEM_SOURCE).filter(
    (value) => value !== `"$${SYSTEM_SOURCE}"`,
  );
  const systemUrl = systemAssigned.length === 1 ? systemAssigned[0]! : '';
  if (
    !POSTGRES_URL.test(systemUrl) ||
    !systemUrl.includes(`//${SYSTEM_ROLE}:\${${SYSTEM_PASSWORD}}@`) ||
    new RegExp(`\\$\\{${SYSTEM_PASSWORD}[^}]`).test(systemUrl)
  )
    flag(
      'system',
      `TASK_SYSTEM_DATABASE_URL is not postgresql://${SYSTEM_ROLE}:\${${SYSTEM_PASSWORD}}@…, assigned once: ` +
        `${systemAssigned.join(' | ') || '(not assigned)'}\n` +
        `The migration creates ${SYSTEM_ROLE} by that name, and its password is .env's ${SYSTEM_PASSWORD},\n` +
        'which the bring-up sets on the role. A default after the name would be a password written here.',
    );
  const refusal = shell.indexOf(`: "\${${SYSTEM_PASSWORD}:?`);
  const composed = shell.indexOf(`${SYSTEM_SOURCE}=`);
  if (refusal === -1 || composed === -1 || refusal > composed)
    flag(
      'system',
      `the script does not refuse an empty ${SYSTEM_PASSWORD} before it composes the system role's URL.\n` +
        'Postgres takes an empty password as none, and the URL would go up with nothing in it.',
    );

  // The owner's names, deleted from the store after the upload, and the list read back.
  const namesLiterals = [...block.matchAll(/^\s*const OWNER_NAMES = \[([^\]\n]*)\];\s*$/gm)];
  const deleted = (namesLiterals[0]?.[1] ?? '').match(/"[A-Z_]+"/g)?.map((n) => n.slice(1, -1)).sort() ?? [];
  if (namesLiterals.length !== 1 || deleted.join() !== Object.keys(OWNER_NAMES).sort().join())
    flag(
      'deletes',
      `OWNER_NAMES is not one list of ${Object.keys(OWNER_NAMES).sort().join(' and ')}: ${deleted.join(', ') || '(none)'}.\n` +
        'Leaving a name out of the upload does not take it out of the store (T3 step 1); each is deleted.',
    );
  const loop = /for \(const name of OWNER_NAMES\) \{\n\s*try \{\n\s*await envvars\.del\(ref, slug, name\);/.exec(block);
  if (!loop)
    flag('deletes', 'no `for (const name of OWNER_NAMES)` loop deletes each name with envvars.del(ref, slug, name).');
  // The list's verdict: `kept`, the owner names it still holds, and a branch
  // that fails the run when there is one. Its own block, closed at its own
  // indentation, holds the exit: an exit elsewhere (the `.catch` at the end has
  // one) is not this one.
  const kept = /^( *)const kept = names\.filter\(\(name\) => OWNER_NAMES\.includes\(name\)\);\n\1if \(kept\.length > 0\) \{\n([\s\S]*?)\n\1\}/m.exec(
    block,
  );
  const listed = block.indexOf('await envvars.list(');
  if (!kept || listed === -1 || listed > kept.index || !/^\s*process\.exit\(1\);$/m.test(kept[2]!))
    flag(
      'deletes',
      'the list the store answers after the delete is not checked for the owner names, with exit 1 in the\n' +
        '`if (kept.length > 0)` branch when one is left. A delete that answers "not found" is not proof the\n' +
        'plane never held the name (reset-trigger.sh records it once): the list is the check.',
    );

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
    expect(names).toContain('SYSTEM_DATABASE_URL');
    expect(names).toContain('APP_DATABASE_URL');
    expect(names).toContain('SECRET_ENCRYPTION_KEY');
    expect(REAL.optional).toContain('SMTP_HOST');
    // The tracing works on a value it must find: the application role's URL is
    // composed here from APP_DB_USER, the system role's from its own name and
    // password. The cases at the end show the owner test finding what it must.
    expect(REAL.composition('TASK_APP_DATABASE_URL')).toContain('${APP_DB_USER');
    expect(REAL.composition('TASK_SYSTEM_DATABASE_URL')).toContain(`${SYSTEM_ROLE}:\${${SYSTEM_PASSWORD}}@`);
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

  it('uploads no value composed from the owner, under any name (0138 T3 step 2)', () => {
    expect(found('owner'), found('owner').join('\n\n')).toEqual([]);
  });

  it('uploads nothing under a name the owner went up under, DATABASE_URL or DIRECT_DATABASE_URL', () => {
    expect(found('owner-name'), found('owner-name').join('\n\n')).toEqual([]);
  });

  it('uploads the system role\'s URL, composed from its name and SYSTEM_DB_PASSWORD, and refuses without one', () => {
    expect(found('system'), found('system').join('\n\n')).toEqual([]);
  });

  it('deletes the stored DATABASE_URL and DIRECT_DATABASE_URL, and fails on the list read back', () => {
    expect(found('deletes'), found('deletes').join('\n\n')).toEqual([]);
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
/** The system role's URL as the script composes it, and the lines that carry it. */
const SYSTEM_URL_ASSIGNED = 'TASK_SYSTEM_DATABASE_URL="postgresql://ownpace_system:${SYSTEM_DB_PASSWORD}@';
const OWNER_DATABASE_URL =
  'TASK_DATABASE_URL="postgresql://${POSTGRES_USER:-openmigrate}:${POSTGRES_PASSWORD:-openmigrate_password}@${DB_HOST:-pgbouncer}:${DB_PORT:-6432}/${POSTGRES_DB:-openmigrate}"';
/** The exit in the list's verdict, with the line before it. */
const KEPT_EXIT = '\n      process.exit(1);\n';
/** Take out the line that starts with `starting`, at the start of a line. */
const dropLine = (starting: string) => (s: string) => {
  const at = s.indexOf(`\n${starting}`);
  if (at === -1) return s;
  return s.slice(0, at) + s.slice(s.indexOf('\n', at + 1));
};
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
  // Each way back to the owner that 0138 T3 step 2 closed.
  [
    'DATABASE_URL uploaded again, the owner through the pooler, as it was before step 2',
    compose(
      ASSIGN(OWNER_DATABASE_URL),
      PREFIX('  TASK_DATABASE_URL="$TASK_DATABASE_URL" \\'),
      ENTRY('    DATABASE_URL: process.env.TASK_DATABASE_URL,'),
    ),
    ['owner', 'owner-name'],
  ],
  [
    "DATABASE_URL uploaded again, carrying the system role's URL",
    ENTRY('    DATABASE_URL: process.env.TASK_SYSTEM_DATABASE_URL,'),
    ['owner-name'],
  ],
  [
    "the system role's URL composed from the owner's user and password",
    (s) => s.replace('postgresql://ownpace_system:${SYSTEM_DB_PASSWORD}@', 'postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@'),
    ['owner', 'system'],
  ],
  [
    "the system role's URL with a password written in as its default",
    (s) => s.replace(SYSTEM_URL_ASSIGNED, SYSTEM_URL_ASSIGNED.replace('${SYSTEM_DB_PASSWORD}', '${SYSTEM_DB_PASSWORD:-system_password}')),
    ['system'],
  ],
  ['no refusal of an empty SYSTEM_DB_PASSWORD', dropLine(': "${SYSTEM_DB_PASSWORD:?'), ['system']],
  ["the system role's URL not uploaded", dropLine('    SYSTEM_DATABASE_URL: process.env.TASK_SYSTEM_DATABASE_URL,'), ['system']],
  [
    'the stored DATABASE_URL left in the store',
    (s) => s.replace('const OWNER_NAMES = ["DATABASE_URL", "DIRECT_DATABASE_URL"];', 'const OWNER_NAMES = ["DIRECT_DATABASE_URL"];'),
    ['deletes'],
  ],
  [
    'the owner names listed, and nothing deleted',
    (s) => s.replace('        await envvars.del(ref, slug, name);\n        console.log("[set-task-env] deleted", name + ": ', '        console.log("[set-task-env] would delete", name + ": '),
    ['deletes'],
  ],
  [
    'the list read back and not checked',
    (s) => s.replace('const kept = names.filter((name) => OWNER_NAMES.includes(name));', 'const kept = names.filter(() => false);'),
    ['deletes'],
  ],
  [
    'a name still stored made a warning: the exit taken out of the branch, the catch keeping its own',
    (s) => s.replace(KEPT_EXIT, '\n'),
    ['deletes'],
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

/* ------------------------------------------------------------------------ */
/* The script, run.                                                          */
/* ------------------------------------------------------------------------ */

const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

/** The system role question's fit answer, as `db_roles_system_fit` reads it (db-roles.sh). */
const FIT_ANSWER = 'f|f|f|f|t|t|0|0';

/**
 * The stand-in SDK: every call recorded as a JSON line, `list` answering the
 * names STAND_IN_LIST gives, `del` throwing when STAND_IN_DEL_THROWS is set.
 */
const SDK_STAND_IN = `
const fs = require("fs");
const log = (e) => fs.appendFileSync(process.env.STAND_IN_LOG + "/sdk", JSON.stringify(e) + "\\n");
module.exports.envvars = {
  upload: async (ref, slug, body) => {
    log({ call: "upload", names: Object.keys(body.variables).sort(), system: body.variables.SYSTEM_DATABASE_URL });
  },
  del: async (ref, slug, name) => {
    log({ call: "del", name });
    if (process.env.STAND_IN_DEL_THROWS) throw new Error("not found");
  },
  list: async () => {
    log({ call: "list" });
    return (process.env.STAND_IN_LIST || "").split(",").filter(Boolean).map((name) => ({ name }));
  },
};
`;

interface ScriptRun {
  status: number | null;
  out: string;
  sdk: Array<{ call: string; name?: string; names?: string[]; system?: string }>;
  docker: string;
  password: string;
}

/**
 * set-task-env.sh (or a changed copy of it), run from a copy of its directory
 * with the files it sources, a `.env` of generated values, the stand-in SDK
 * under apps/worker, and stand-ins for `curl` (the webapp answers) and `docker`
 * (the system role question answers STAND_IN_FIT_ANSWER, exit STAND_IN_DOCKER_EXIT).
 */
function runScript(args: string[], answers: Record<string, string> = {}, script = SCRIPT): ScriptRun {
  const root = mkdtempSync(join(tmpdir(), 'set-task-env-'));
  tempDirs.push(root);
  const compose = join(root, 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  for (const f of ['check-env-agreement.sh', 'trigger-cli-lib.sh', 'env-read.sh', 'own-addresses.sh', 'stack-kind.sh', 'db-roles.sh', 'managed.yml']) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
  }
  writeFileSync(join(compose, 'set-task-env.sh'), script);
  chmodSync(join(compose, 'set-task-env.sh'), 0o755);
  const password = randomBytes(12).toString('hex');
  writeFileSync(
    join(compose, '.env'),
    [
      'TRIGGER_PROJECT_REF=proj_stand_in',
      `TRIGGER_SECRET_KEY=tr_prod_${randomBytes(8).toString('hex')}`,
      `SECRET_ENCRYPTION_KEY=${randomBytes(16).toString('hex')}`,
      `SYSTEM_DB_PASSWORD=${password}`,
      'POSTGRES_USER=ownpace_owner',
      'POSTGRES_DB=ownpace',
      '',
    ].join('\n'),
  );
  const sdk = join(root, 'apps', 'worker', 'node_modules', '@trigger.dev', 'sdk');
  mkdirSync(sdk, { recursive: true });
  writeFileSync(join(sdk, 'package.json'), '{ "name": "@trigger.dev/sdk", "main": "index.js" }\n');
  writeFileSync(join(sdk, 'index.js'), SDK_STAND_IN);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\nexit 0\n');
  writeFileSync(
    join(bin, 'docker'),
    [
      '#!/usr/bin/env bash',
      'printf "%s\\n" "$*" >>"$STAND_IN_LOG/docker"',
      'cat >/dev/null',
      'printf "%s" "${STAND_IN_FIT_ANSWER-}"',
      'exit "${STAND_IN_DOCKER_EXIT:-0}"',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'curl'), 0o755);
  chmodSync(join(bin, 'docker'), 0o755);
  const r = spawnSync('bash', [join(compose, 'set-task-env.sh'), ...args], {
    env: {
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: root,
      STAND_IN_LOG: root,
      STAND_IN_FIT_ANSWER: FIT_ANSWER,
      ...answers,
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const logged = (f: string) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '');
  return {
    status: r.status,
    out: `${r.stdout}${r.stderr}`,
    sdk: logged('sdk')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ScriptRun['sdk'][number]),
    docker: logged('docker'),
    password,
  };
}

const ownerDeletes = (run: ScriptRun) =>
  run.sdk.filter((c) => c.call === 'del' && c.name !== undefined && OWNER_NAMES[c.name] !== undefined).map((c) => c.name);

describe('the upload run: asks about the system role, uploads its URL, and deletes nothing of the owner\'s', () => {
  it("uploads the system role's URL and the application role's, never an owner name, and leaves a stored one for the forget run", () => {
    const run = runScript([], { STAND_IN_LIST: 'APP_DATABASE_URL,DATABASE_URL,SECRET_ENCRYPTION_KEY,SYSTEM_DATABASE_URL' });
    expect(run.status, run.out).toBe(0);
    const upload = run.sdk.filter((c) => c.call === 'upload');
    expect(upload).toHaveLength(1);
    expect(upload[0]!.names).toEqual(expect.arrayContaining(['SYSTEM_DATABASE_URL', 'APP_DATABASE_URL', 'SECRET_ENCRYPTION_KEY']));
    for (const name of Object.keys(OWNER_NAMES)) expect(upload[0]!.names).not.toContain(name);
    expect(upload[0]!.system).toBe(`postgresql://${SYSTEM_ROLE}:${run.password}@pgbouncer:6432/ownpace`);
    // The tasks deployed before this one may still read it: the forget run, after the deploy, deletes it.
    expect(ownerDeletes(run)).toEqual([]);
    expect(run.out).toMatch(/still holds DATABASE_URL[\s\S]*--forget-owner-names/);
  });

  it('asks the system role question, over the socket as the owner, before anything goes up', () => {
    const run = runScript([]);
    expect(run.status, run.out).toBe(0);
    expect(run.docker).toMatch(/exec -T postgres psql .*-U ownpace_owner .*-v system_role=ownpace_system/);
  });

  it.each([
    ['a superuser', `t${FIT_ANSWER.slice(1)}`, /REFUSED[\s\S]*superuser/],
    ['a role another belongs to', `${FIT_ANSWER.slice(0, -1)}1`, /REFUSED[\s\S]*belong to it/],
    ['no role at all', '', /REFUSED[\s\S]*is not a role/],
  ])('refuses %s, and nothing is uploaded or deleted', (_label, answer, why) => {
    const run = runScript([], { STAND_IN_FIT_ANSWER: answer });
    expect(run.status, run.out).not.toBe(0);
    expect(run.out).toMatch(why);
    expect(run.sdk).toEqual([]);
  });

  it('refuses when the question could not be asked, and nothing is uploaded', () => {
    const run = runScript([], { STAND_IN_FIT_ANSWER: 'psql: error: connection to server failed', STAND_IN_DOCKER_EXIT: '2' });
    expect(run.status, run.out).not.toBe(0);
    expect(run.sdk).toEqual([]);
  });

  it('refuses an argument it does not know, before anything', () => {
    const run = runScript(['--forget-owner-name']);
    expect(run.status, run.out).not.toBe(0);
    expect(run.sdk).toEqual([]);
    expect(run.docker).toBe('');
  });
});

describe('the forget run: deletes the owner names, uploads nothing, and fails on a list that still holds one', () => {
  it('deletes both, reads the list, and passes when neither is left', () => {
    const run = runScript(['--forget-owner-names'], { STAND_IN_LIST: 'APP_DATABASE_URL,SYSTEM_DATABASE_URL' });
    expect(run.status, run.out).toBe(0);
    expect(run.sdk.map((c) => c.call)).toEqual(['del', 'del', 'list']);
    expect(ownerDeletes(run).sort()).toEqual(Object.keys(OWNER_NAMES).sort());
    // It uploads nothing, so it needs no question about the role whose URL it does not send.
    expect(run.docker).toBe('');
  });

  it('passes when a delete answers "not found" and the list agrees', () => {
    const run = runScript(['--forget-owner-names'], { STAND_IN_DEL_THROWS: '1', STAND_IN_LIST: 'SYSTEM_DATABASE_URL' });
    expect(run.status, run.out).toBe(0);
  });

  it.each(Object.keys(OWNER_NAMES).map((n) => [n]))('FAILS when the list still holds %s, whatever the delete answered', (name) => {
    const run = runScript(['--forget-owner-names'], { STAND_IN_LIST: `SYSTEM_DATABASE_URL,${name}` });
    expect(run.status, run.out).toBe(1);
    expect(run.out).toMatch(new RegExp(`FAILED: the task environment still holds ${name}`));
  });
});

describe('each way around the run that review found is seen by running it', () => {
  // Each change below, made to the script, shows in a run as the cases above
  // would see it: so each of those cases goes red on it.
  it('the exit taken out of the list check: a name still stored passes as a warning', () => {
    const mutated = SCRIPT.replace(KEPT_EXIT, '\n');
    expect(mutated, 'the mutation no longer applies to the script: update its anchor').not.toBe(SCRIPT);
    const run = runScript(['--forget-owner-names'], { STAND_IN_LIST: 'DATABASE_URL' }, mutated);
    expect(run.status, run.out).toBe(0);
  });

  it('the forget run done in the upload run too: the upload run deletes an owner name', () => {
    const mutated = SCRIPT.replace('if (process.env.FORGET_OWNER_NAMES === "1") {', 'if (true) {');
    expect(mutated).not.toBe(SCRIPT);
    const run = runScript([], {}, mutated);
    // What the upload-run case above asserts, seen failing: an owner name deleted, and nothing uploaded.
    expect(ownerDeletes(run).length).toBeGreaterThan(0);
    expect(run.sdk.filter((c) => c.call === 'upload')).toEqual([]);
  });

  it("the system role's verdict ignored: an unfit role's URL goes up", () => {
    const mutated = SCRIPT.replace('db_roles_system_fit || rc=$?', 'db_roles_system_fit || true');
    expect(mutated).not.toBe(SCRIPT);
    const run = runScript([], { STAND_IN_FIT_ANSWER: `t${FIT_ANSWER.slice(1)}` }, mutated);
    expect(run.sdk.filter((c) => c.call === 'upload')).toHaveLength(1);
  });
});
