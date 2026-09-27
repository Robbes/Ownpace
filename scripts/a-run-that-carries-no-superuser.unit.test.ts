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
 * `postgres:5432`, past the pooler. No task read it. It was there because a
 * table in `docs/rls-guide.md` said the tasks run migrations at boot, and they
 * never have: `runMigrations` is called by the API, the appliance and the seed.
 * The owner is a superuser on this stack, and Postgres applies no row security
 * to a superuser, so every run held a credential that reads past every policy
 * and can run programs on the database server, for nothing.
 *
 * `DATABASE_URL` is the owner's credential as well, through the pooler, and
 * that one every task reads today. It goes in T3 step 2, once T1 has moved the
 * per-tenant tasks to `app_user` and T2's jobs have a role of their own. Until
 * then it is the one exception below, on a list that may only shrink.
 *
 * WHAT IS CHECKED: the upload itself, traced back to where each value is
 * composed. A value built from `${POSTGRES_USER` is the owner's. The variable's
 * NAME is not trusted: the direct URL re-added under another name is the same
 * credential, and this catches it by what it is made of.
 *
 * WHAT IS NOT: the store. Removing a variable from this script does not remove
 * it from the store, because `envvars.upload` sends only the variables it is
 * given. A plane that held `DIRECT_DATABASE_URL` keeps it until somebody
 * deletes it once, which `docs/managed-bring-up.md` ("Updating a running
 * deployment") writes down as the operator's step. No test here can see a
 * running stack's store.
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
export const OWNER_URL_UNTIL_T3_STEP_2: Record<string, string> = {
  DATABASE_URL:
    'every task reads it today (0138 §1); T1 moves the per-tenant tasks to APP_DATABASE_URL, ' +
    'T2 and T3 step 2 give the cross-tenant jobs a role that is not a superuser, and then this goes',
};

/** The embedded `node -e '…'` block that performs the upload. */
function uploadBlock(): string {
  const start = SCRIPT.indexOf("node -e '");
  if (start === -1) return '';
  return SCRIPT.slice(start + "node -e '".length, SCRIPT.indexOf("\n'", start));
}

/** `NAME: process.env.SOURCE` in the `variables` object: always uploaded. */
function requiredUploads(): Array<{ name: string; source: string }> {
  const object = /const variables = \{([\s\S]*?)\};/.exec(uploadBlock())?.[1] ?? '';
  return [...object.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*process\.env\.([A-Z][A-Z0-9_]*)\s*,?\s*$/gm)].map(
    (m) => ({ name: m[1]!, source: m[2]! }),
  );
}

/** The quoted names in the optional list: uploaded from `.env` when set. */
function optionalUploads(): string[] {
  const block = uploadBlock();
  const from = block.indexOf('for (const name of [');
  const to = block.indexOf(']) {', from);
  if (from === -1 || to === -1) return [];
  const list = block
    .slice(from, to)
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  return [...list.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]!);
}

/** Executable lines only: a comment that quotes a composition is not one. */
const CODE = SCRIPT.split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/**
 * What the node process receives as SOURCE, from the `SOURCE="…" \` prefix in
 * front of `node -e`, and what that expands to: the script's own assignment
 * when the prefix names one, or the prefix itself when it comes from `.env`.
 */
function composition(source: string): string | undefined {
  const prefix = new RegExp(`^\\s*${source}="([^"]*)"\\s*\\\\$`, 'm').exec(CODE)?.[1];
  if (prefix === undefined) return undefined;
  const named = /^\$\{?([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}?$/.exec(prefix)?.[1];
  if (!named) return prefix;
  const assigned = new RegExp(`^${named}="(.*)"\\s*$`, 'm').exec(CODE)?.[1];
  return assigned ?? prefix;
}

const isOwnerComposed = (value: string) => value.includes('${POSTGRES_USER');

describe('a task run carries no owner connection it does not need', () => {
  const required = requiredUploads();

  it('found the upload and traced it, rather than checking nothing', () => {
    // If the shape of the script changes, this goes red instead of every case
    // below passing over an empty list.
    const names = required.map((u) => u.name);
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('APP_DATABASE_URL');
    expect(names).toContain('SECRET_ENCRYPTION_KEY');
    expect(optionalUploads()).toContain('SMTP_HOST');
    // The tracing works on a value it must find: the application role's URL is
    // composed in this script from APP_DB_USER.
    const app = required.find((u) => u.name === 'APP_DATABASE_URL')!;
    expect(composition(app.source)).toContain('${APP_DB_USER');
  });

  it('traces every uploaded variable to where it is composed', () => {
    // A variable this cannot trace is one it cannot judge. Red, not a pass.
    for (const { name, source } of required) {
      expect(
        composition(source),
        `${name} is uploaded from process.env.${source}, and no ${source}="…" line hands it to node`,
      ).toBeDefined();
    }
  });

  it('uploads no DIRECT_DATABASE_URL, which no task reads (0138 T3 step 1)', () => {
    const names = [...required.map((u) => u.name), ...optionalUploads()];
    expect(
      names,
      'set-task-env.sh uploads DIRECT_DATABASE_URL again. It is the database owner,\n' +
        'straight to Postgres past the pooler, and no task reads it: the tasks do not run\n' +
        'migrations (the API, the appliance and the seed do). Every run of every task would\n' +
        'hold it, because Trigger.dev stores variables per environment.',
    ).not.toContain('DIRECT_DATABASE_URL');
  });

  it('uploads no owner-composed value but the one T3 step 2 removes', () => {
    const owner = required
      .filter(({ source }) => isOwnerComposed(composition(source) ?? ''))
      .map((u) => u.name)
      .sort();
    const known = Object.keys(OWNER_URL_UNTIL_T3_STEP_2).sort();
    for (const name of owner) {
      expect(
        known,
        `${name} is composed from \${POSTGRES_USER}: the database owner, a superuser on\n` +
          'this stack, whom row security never binds. Every run of every task would hold it.\n' +
          'Upload the application role (APP_DB_USER) instead, or, for a job that spans\n' +
          'organisations, the role 0138 T3 step 2 creates.',
      ).toContain(name);
    }
    for (const name of known) {
      expect(
        owner,
        `${name} is no longer composed as the owner. If that is 0138 T3 step 2, delete it\n` +
          'from OWNER_URL_UNTIL_T3_STEP_2: the list only shrinks.',
      ).toContain(name);
    }
  });

  it('passes no database credential through from .env', () => {
    // The optional list uploads whatever `.env` holds under each name. The
    // owner's password or a URL there would reach every run without being
    // composed here, where the test above looks.
    for (const name of optionalUploads()) {
      expect(name, `${name} would carry a database credential into every run`).not.toMatch(
        /DATABASE_URL$|^POSTGRES_|^PG[A-Z]+$|^DB_/,
      );
    }
  });
});
