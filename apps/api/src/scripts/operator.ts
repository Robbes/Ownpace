// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Appoint the people who may answer the door (workplan 0093 T6).
 *
 * **This is a script and not a route, and that is the boundary.** `app_user` —
 * the role the API connects as — is granted SELECT on `platform_operator` and
 * nothing else (migration 0005). So an operator can be asked "are you one" and
 * can never answer "and so is she": appointing is the owner's own act, made
 * over the owner connection, from the machine the database runs on.
 *
 * Usage (from the repo root):
 *
 *   ./deploy/compose/operator.sh list
 *   ./deploy/compose/operator.sh add    <subject> <email> [note]
 *   ./deploy/compose/operator.sh remove <subject>
 *
 * The wrapper composes the owner connection and asks compose for Postgres's
 * published port. Calling the underlying `pnpm --filter @openmig/api
 * operator:*` scripts directly works too, but then DATABASE_URL is yours to
 * build — and it is NOT a line in deploy/compose/.env, which is what made the
 * documented recipe fail silently until 2026-08-31.
 *
 * THE SUBJECT, NOT THE EMAIL. `<subject>` is the `sub` the identity provider
 * mints — an opaque string, not an address. There is no way to know it before
 * the person has signed in once, and there is no way to derive it from their
 * email that would not also let whoever registers that address become an
 * operator. So the sequence is: they sign in, they call `GET /api/me`, they
 * read `userId` back, and you run this with it. Three steps, none of them
 * guessing.
 *
 * Idempotent: adding somebody who is already an operator updates their email
 * and note rather than failing, so re-running after a typo is the fix.
 */

import { Pool } from 'pg';
import { log } from '@openmig/shared';

const USAGE = `Usage:
  operator:list
  operator:add <subject> <email> [note]
  operator:remove <subject>

DATABASE_URL must be the OWNER connection — app_user cannot write this table,
which is the point of it.`;

function connectionString(): string {
  const url = process.env.DATABASE_URL ?? process.env.SEED_DATABASE_URL;
  if (!url) {
    // NAMING THE VARIABLE IS NOT ENOUGH, and this refusal learned that the
    // expensive way. It used to say only "DATABASE_URL is required", and
    // docs/managed-bring-up.md §8c answered it with
    // `grep '^DATABASE_URL=' deploy/compose/.env` — a line that file has never
    // carried, because managed.yml COMPOSES the value from POSTGRES_* and
    // DB_HOST. So the remedy set it to the empty string and this threw again,
    // on a requirement the operator had just apparently met (2026-08-31).
    //
    // The seed had the same shape and the same fix (`seed-managed.sh`): a
    // wrapper that composes what a host-run script cannot inherit. Say its
    // name, because "set DATABASE_URL" sends somebody to a file that does not
    // contain it.
    throw new Error(
      'DATABASE_URL (the DB owner connection) is required.\n\n' +
        'This runs on the HOST and inherits nothing, and .env does not carry a\n' +
        'DATABASE_URL line — compose builds it from POSTGRES_* and DB_HOST. Use\n' +
        'the wrapper, which composes it and asks compose for the published port:\n' +
        '  ./deploy/compose/operator.sh list\n' +
        '  ./deploy/compose/operator.sh add <subject> <email> [note]\n' +
        '  ./deploy/compose/operator.sh remove <subject>',
    );
  }
  return url;
}

interface OperatorRow {
  user_id: string;
  email: string;
  note: string | null;
  created_at: Date;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const pool = new Pool({ connectionString: connectionString() });

  try {
    switch (command) {
      case 'list': {
        const { rows } = await pool.query<OperatorRow>(
          `SELECT user_id, email, note, created_at FROM platform_operator ORDER BY created_at`,
        );
        if (rows.length === 0) {
          // Not an error, and worth saying plainly: a deployment with no
          // operators has a queue nobody can read, which looks like a bug from
          // the outside.
          log.info('No operators. Nobody can read the access queue or grant a request.');
          break;
        }
        for (const row of rows) {
          log.info(`${row.user_id}\t${row.email}\t${row.note ?? ''}`);
        }
        break;
      }

      case 'add': {
        const [userId, email, ...noteParts] = rest;
        if (!userId || !email) throw new Error(`add needs a subject and an email.\n\n${USAGE}`);
        const note = noteParts.join(' ') || null;
        await pool.query(
          `INSERT INTO platform_operator (user_id, email, note)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, note = EXCLUDED.note`,
          [userId, email, note],
        );
        log.info(`${email} (${userId}) may now read the access queue and grant requests.`);
        break;
      }

      case 'remove': {
        const [userId] = rest;
        if (!userId) throw new Error(`remove needs a subject.\n\n${USAGE}`);
        const { rowCount } = await pool.query(`DELETE FROM platform_operator WHERE user_id = $1`, [
          userId,
        ]);
        // The distinction matters: "removed nobody" usually means the subject
        // was mistyped, and reporting it as success hides that.
        log.info(
          rowCount === 0 ? `No operator with subject ${userId}.` : `${userId} is no longer an operator.`,
        );
        break;
      }

      default:
        throw new Error(USAGE);
    }
  } finally {
    await pool.end();
  }
}

await main();
