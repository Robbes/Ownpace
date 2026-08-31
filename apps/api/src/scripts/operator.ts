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
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '@openmig/shared';

const USAGE = `Usage:
  operator:list
  operator:add <subject> <email> [note]
  operator:remove <subject>

DATABASE_URL must be the OWNER connection — app_user cannot write this table,
which is the point of it.`;

/**
 * A SUBJECT IS NOT A TOKEN, and this is what it costs when nothing says so.
 *
 * `add` took whatever strings it was handed and reported success. On
 * 2026-08-31 the owner's appointment went to nobody twice, for two different
 * reasons, and neither said a word:
 *
 *  1. `operator.sh` passed `--` before the arguments and pnpm FORWARDED it, so
 *     everything shifted one place: `user_id` became the literal `--`, the
 *     subject landed in `email`, the email in `note`. Fixed in the wrapper.
 *  2. On the first attempt the value offered as the subject was the whole ID
 *     TOKEN — an easy mistake, because the documented steps are "sign in, read
 *     `userId` from /api/me, appoint it" and the token is what you are holding
 *     at step two. It went into `email`, where a 900-character credential then
 *     sat at rest.
 *
 * Both rows existed, `operator:list` showed them, and this script had said
 * "may now read the access queue and grant requests" each time.
 *
 * Every signal downstream then told the truth about a world nobody wanted:
 * `isPlatformOperator` matched nothing, `/api/me` answered `operator: false`,
 * the nav correctly hid Access requests and Support, and an afternoon went into
 * reading a menu that was right. A message asserting an outcome it has not
 * checked is the failure this repository keeps finding, and the cheapest place
 * to stop it is the moment of writing.
 *
 * IT CANNOT VALIDATE A SUBJECT IN GENERAL, and must not pretend to: there is no
 * user table on this side, deliberately (ADR-0042), and a subject is whatever
 * the issuer mints — digits here, a uuid elsewhere. What it CAN do is refuse
 * the three things a subject is definitely not: a token, an argument
 * separator, and something far too long to be an identifier.
 *
 * AND THE ANSWER IS INSIDE THE MISTAKE. A JWT carries the very subject that was
 * meant, so the refusal decodes it and prints the command to run. Nothing is
 * verified and nothing needs to be: the appointment is the owner's own act over
 * the owner connection, and this only saves them a second trip to /api/me. A
 * refusal that hands back the right command is worth ten that merely name the
 * mistake.
 *
 * A TOKEN IN THAT COLUMN IS ALSO A CREDENTIAL AT REST, which is its own reason
 * not to write one: `platform_operator` is a table of identifiers, and nothing
 * about it is protected the way a secret would be.
 */
const MAX_SUBJECT = 200;

export function subjectRefusal(subject: string): string | null {
  const parts = subject.split('.');
  if (parts.length === 3 && /^eyJ[A-Za-z0-9_-]+$/.test(parts[0]!)) {
    let sub: string | undefined;
    try {
      const body = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
      const json = JSON.parse(
        Buffer.from(body + '='.repeat((4 - (body.length % 4)) % 4), 'base64').toString('utf8'),
      ) as { sub?: unknown };
      if (typeof json.sub === 'string' && json.sub) sub = json.sub;
    } catch {
      // Token-shaped, but the middle is not JSON. Still not a subject — the
      // refusal stands, it just cannot offer the shortcut.
    }
    return (
      'that is a TOKEN, not a subject.\n\n' +
      'The subject is the `userId` in what `GET /api/me` answers; the token is\n' +
      'what you send to ask it. Appointing the token writes a row that matches\n' +
      'nobody — sign-in then reports `operator: false`, the access queue and the\n' +
      'support screens stay hidden, and nothing says why.\n\n' +
      (sub === undefined
        ? 'Read the subject from /api/me and use that.'
        : "That token's own subject is:\n\n" +
          `    ${sub}\n\n` +
          'So the command you meant is:\n\n' +
          `    ./deploy/compose/operator.sh add ${sub} <email> [note]\n\n` +
          'Read out of the token without verifying it, which is all this needs\n' +
          "to do: the appointment is your act, over the owner connection.") +
      '\n\nNOTHING WAS WRITTEN.'
    );
  }
  // A BARE `--` IS A WRAPPER BUG WEARING A SUBJECT'S CLOTHES, and it is the one
  // that actually happened. Catching it here is defence in depth: the wrapper
  // no longer sends it, and if some future caller does, the appointment fails
  // loudly instead of writing a row nobody will ever match.
  if (subject === '--') {
    return (
      'that is an argument separator, not a subject.\n\n' +
      'Something between you and this script passed `--` as the first argument,\n' +
      'so every value after it shifted one place: the subject would have gone\n' +
      'into the email column and the email into the note. pnpm forwards `--`\n' +
      'rather than consuming it — `deploy/compose/operator.sh` no longer sends\n' +
      'one, so an out-of-date copy of that script is the likely cause.' +
      '\n\nNOTHING WAS WRITTEN.'
    );
  }
  if (subject.length > MAX_SUBJECT) {
    return (
      `that is ${subject.length} characters, and a subject is not.\n\n` +
      'Issuers mint short opaque identifiers — digits, or a uuid. Something this\n' +
      'long is a token, a header, or a paste that went wrong. Read the subject\n' +
      'from what `GET /api/me` answers.\n\nNOTHING WAS WRITTEN.'
    );
  }
  return null;
}

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
        // Before the write, not after: the whole point is that no row appears.
        const refusal = subjectRefusal(userId);
        if (refusal) throw new Error(refusal);
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

/**
 * RUN WHEN RUN, not when imported.
 *
 * This was a bare `await main()`, so importing the module executed it — which
 * meant `subjectRefusal` below could not be tested without a database, and so
 * it was not tested at all. A script whose only entry point is its side effect
 * has no seam, and the bug this file now refuses shipped through exactly that
 * gap: nothing here could be exercised, so nothing here was.
 *
 * `argv[1]` is the file node was told to run. Comparing it to this module's own
 * path is the ordinary way, and it holds for `node src/scripts/operator.ts` and
 * for the pnpm script that wraps it alike.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) await main();
