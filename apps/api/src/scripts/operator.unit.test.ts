// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The appointment that went to nobody.
 *
 * On 2026-08-31 the owner ran `operator.sh add` with the whole ID token in the
 * place of the subject — an easy mistake, because the three documented steps
 * are "sign in, read `userId` from /api/me, appoint it" and the token is what
 * you are holding at step two. The row was written, `operator:list` showed it,
 * and the script reported "may now read the access queue and grant requests".
 *
 * Nothing downstream was wrong: `isPlatformOperator` matched no subject,
 * `/api/me` answered `operator: false`, and the nav correctly hid Access
 * requests and Support. An afternoon went into reading a menu that was telling
 * the truth — because the one message that was false had already been printed.
 *
 * What is pinned here is that the refusal happens BEFORE anything is written,
 * and that it hands back the command the operator actually meant.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { subjectRefusal } from './operator.ts';

/** A token shaped exactly like the one that caused this, with a throwaway sub. */
const token = (payload: Record<string, unknown>): string => {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url').replace(/=+$/, '');
  return `${b64({ alg: 'RS256', kid: '1', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJl`;
};

describe('a subject that is not a subject', () => {
  it('refuses a token, and writes nothing', () => {
    const refusal = subjectRefusal(token({ sub: '387847603254984715', iss: 'https://id.test' }));
    expect(refusal).not.toBeNull();
    expect(refusal).toContain('that is a TOKEN, not a subject');
    // The promise the caller depends on: `add` checks before the INSERT, so a
    // refused appointment leaves no row to find later and wonder about.
    expect(refusal).toContain('NOTHING WAS WRITTEN');
  });

  it('hands back the subject from inside it, and the command to run', () => {
    // The answer IS inside the mistake. A refusal that only names the error
    // sends somebody back to /api/me for a value they already had in hand.
    const refusal = subjectRefusal(token({ sub: '387847603254984715' }));
    expect(refusal).toContain('387847603254984715');
    expect(refusal).toContain(
      './deploy/compose/operator.sh add 387847603254984715 <email> [note]',
    );
  });

  it('still refuses a token whose middle is not readable, without the shortcut', () => {
    // Token-shaped and undecodable is not a reason to accept it.
    const refusal = subjectRefusal('eyJhbGciOiJSUzI1NiJ9.bm90LWpzb24.sig');
    expect(refusal).toContain('that is a TOKEN, not a subject');
    expect(refusal).toContain('Read the subject from /api/me');
  });

  it('refuses anything far too long to be an identifier', () => {
    // The catch-all for a paste that went wrong in some other way — a header,
    // a whole curl line. Issuers mint short opaque ids.
    const refusal = subjectRefusal('x'.repeat(201));
    expect(refusal).toContain('201 characters');
    expect(refusal).toContain('NOTHING WAS WRITTEN');
  });

  it('accepts the subjects issuers actually mint', () => {
    // AND THIS IS THE HALF THAT MATTERS MOST. A guard that refused a real
    // subject would lock the owner out of their own deployment, and there is no
    // route to appoint one — it is this script or nothing (0093 T6). Zitadel
    // mints digits; other issuers mint uuids or opaque strings with dots in
    // them, and none of those may be caught by the token shape.
    for (const subject of [
      '387847603254984715',
      'e29b41d4-a716-446655440000',
      'auth0|5f8a2b1c9d',
      'user.name@issuer',
      'a'.repeat(200),
    ]) {
      expect(subjectRefusal(subject), `refused a real subject: ${subject}`).toBeNull();
    }
  });
});

/**
 * AND IT STILL RUNS WHEN IT IS RUN.
 *
 * Making this module importable meant gating `main()` behind an argv check, and
 * a gate that is wrong in the other direction is worse than the bug it was
 * added for: `operator.sh` would exit 0 having done nothing, and an owner would
 * appoint themselves into silence with no error to read at all.
 *
 * So the script is executed the way `operator.sh` executes it and asked to
 * refuse. Reaching the DATABASE_URL refusal proves `main()` ran — nothing else
 * in this file can produce it.
 */
describe('the script still executes when executed', () => {
  it('reaches its own refusal rather than exiting silently', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const r = spawnSync(process.execPath, [join(here, 'operator.ts'), 'list'], {
      encoding: 'utf8',
      // Deliberately without a connection: the refusal IS the proof of life,
      // and it costs no database to ask for.
      env: { ...process.env, DATABASE_URL: '', SEED_DATABASE_URL: '' },
      cwd: join(here, '..', '..'),
    });
    expect(
      `${r.stdout}${r.stderr}`,
      'the script produced no refusal — main() did not run.\n\n' +
        'The argv gate that makes this module importable has stopped matching\n' +
        'how operator.sh invokes it, so appointing an operator now exits 0 and\n' +
        'writes nothing, with no error anywhere.',
    ).toContain('DATABASE_URL');
    expect(r.status, 'a refusal must be a non-zero exit').not.toBe(0);
  });
});
