// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Sync now, pressed at the machine, for live's pass check (workplan 0132 T9;
 * `deploy/compose/live-pass-check.sh`).
 *
 * **A script and not a route, because nobody signs in at the machine.** *Sync
 * now* is behind `authenticate`, which wants a token the identity provider
 * signed (`middleware/auth.ts`), and minting one on live, or a user and a
 * membership to mint it for, is not something a check may do. So the shell
 * runs this inside the api container, which has the API's own environment,
 * and it presses the button's own code.
 *
 * **As `app_user`, under row security.** The pool is `getDbPool()`'s, the
 * API's, and this refuses to start without `APP_DATABASE_URL`: `getDbPool()`
 * would otherwise fall back to `DATABASE_URL`, the owner, whom row security
 * never binds. The migration is read under `withTenantDb`, as the route reads
 * it, so a migration of another organisation is not found.
 *
 * **Only through `pressSyncNow`** (`routes/migrations/sync-now.ts`): the
 * route's gates and its one enqueue, moved there unchanged, so the pass starts
 * exactly as the button starts it. A closed organisation, a paused migration,
 * a withdrawn grant, Free's pace and the hold refuse it here as they refuse the
 * button, and the body is empty, as the button's is, so `final` never skips
 * Free's pace.
 *
 * **It records no visit.** A visit is a person checking (`visits.ts`): it
 * brings an automatic migration back to hourly for 14 days. This is a machine
 * checking a release, so the owner's migration keeps its cadence (the owner,
 * 2026-10-28).
 *
 * Usage, inside the api container (live-pass-check.sh runs it, with Node by its
 * absolute path):
 *
 *   node apps/api/src/scripts/live-pass.ts <organisation-id> <migration-id>
 *
 * It prints one line and exits:
 *
 *   started<TAB><run id>                  0, the orchestrator's run id
 *   refused<TAB><status><TAB><code>       4, nothing enqueued
 *
 * and 2 for arguments that are not two ids, or without `APP_DATABASE_URL`; 1
 * when the press failed, saying only the error's code or name on stderr, never
 * its message, which can carry an internal address.
 */

import type { Pool } from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDbPool } from '../middleware/auth.ts';
import { pressSyncNow } from '../routes/migrations/sync-now.ts';
import type { Answerable } from '../types/api.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USAGE = '[live-pass] usage: node apps/api/src/scripts/live-pass.ts <organisation-id> <migration-id>';

/** The organisation and the migration, or null unless argv is exactly those two ids. */
function idsOf(argv: readonly string[]): { readonly tenantId: string; readonly mappingId: string } | null {
  if (argv.length !== 2) return null;
  const [tenantId, mappingId] = argv as readonly [string, string];
  return UUID.test(tenantId) && UUID.test(mappingId) ? { tenantId, mappingId } : null;
}

/**
 * The refusal's code, for the shell to say: `not_found`, `paused` (the one
 * refusal whose `error` is the generic `Conflict`), or the code the door
 * answered with when it is one (`platform_held`, `account_closed`,
 * `grant_withdrawn`, `free_pace`). Anything else is `refused`.
 */
function refusalCode(status: number, body: unknown): string {
  if (status === 404) return 'not_found';
  const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  if (status === 409 && error === 'Conflict') return 'paused';
  return typeof error === 'string' && /^[a-z_]+$/.test(error) ? error : 'refused';
}

/** What a failure is called, never what it says: its code, else its name. */
function failureName(error: unknown): string {
  const { code, name } = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    name?: unknown;
  };
  if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) return code;
  if (typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return name;
  return 'unknown';
}

/**
 * Press *Sync now* on one migration of one organisation. `write` gets the one
 * line the shell reads, `warn` what a person reads. 0 started, 4 refused, 2
 * usage, 1 the press failed.
 */
export async function press(
  argv: readonly string[],
  pool: Pool,
  write: (line: string) => void,
  warn: (line: string) => void,
): Promise<0 | 1 | 2 | 4> {
  const ids = idsOf(argv);
  if (!ids) {
    warn(USAGE);
    return 2;
  }
  const { tenantId, mappingId } = ids;

  // What the door answered, kept instead of sent.
  let answered: { status: number; body: unknown } | undefined;
  const recorder: Answerable = {
    status: (code) => ({
      json: (body) => {
        answered = { status: code, body };
        return undefined;
      },
    }),
  };

  let pressed: Awaited<ReturnType<typeof pressSyncNow>>;
  try {
    pressed = await pressSyncNow(recorder, tenantId, mappingId, {}, pool);
  } catch (error) {
    warn(`[live-pass] the press failed: ${failureName(error)}`);
    return 1;
  }
  if (pressed) {
    write(`started\t${pressed.run.id}`);
    return 0;
  }
  if (!answered) {
    // A refusal that wrote nothing is no answer to report as one.
    warn('[live-pass] the press failed: Sync now refused and answered nothing');
    return 1;
  }
  write(`refused\t${answered.status}\t${refusalCode(answered.status, answered.body)}`);
  return 4;
}

/**
 * The script: the arguments first, then `APP_DATABASE_URL`, both before any
 * pool is built, then one press on the API's own pool.
 */
export async function main(argv: readonly string[] = process.argv.slice(2), env = process.env): Promise<number> {
  const warn = (line: string) => void process.stderr.write(`${line}\n`);
  if (!idsOf(argv)) {
    warn(USAGE);
    return 2;
  }
  if (!env.APP_DATABASE_URL) {
    warn('[live-pass] APP_DATABASE_URL is not set: the gates must run as app_user, under row security');
    return 2;
  }
  const pool = getDbPool();
  try {
    return await press(argv, pool, (line) => void process.stdout.write(`${line}\n`), warn);
  } finally {
    await pool.end();
  }
}

/**
 * Run when run, not when imported, as `operator.ts` does. `process.exit`, since
 * the orchestrator's client may keep the process alive once the line is out;
 * stdout to a pipe is written synchronously on Linux, so the line is not lost.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) process.exit(await main());
