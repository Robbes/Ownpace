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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cannotSeeAcrossOrganisationsRefusal,
  leaveRefusal,
  leavesNobodyBehind,
  notAnOperatorRefusal,
  subjectRefusal,
  type LeaveFacts,
} from './operator.ts';

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

/**
 * THE MEMBERSHIP AN OPERATOR COULD NOT LEAVE.
 *
 * The owner pressed the enrolment button on their own deployment on 2026-09-01
 * and became the sole owner of an organisation, permanently: the product
 * refuses `Cannot remove yourself from the tenant`, and refuses again with
 * `Cannot remove the last owner`. Both are the right answer to a customer, and
 * neither had an answer for platform staff who had joined something to look at
 * it. "One button I clicked, in weird Dutch, makes me an owner for ever."
 *
 * `leave` is that answer, and what is pinned here is that it stayed narrow.
 * The guards below are the whole of what makes a machine-level removal
 * defensible, and each one is the difference between taking back your own
 * access and quietly emptying somebody else's organisation.
 */
describe('leaving an organisation without stranding it', () => {
  const facts = (over: Partial<LeaveFacts> = {}): LeaveFacts => ({
    tenantName: 'Acme Families',
    role: 'owner',
    otherMembers: 0,
    otherOwners: 0,
    liveMappings: 0,
    ...over,
  });

  it('lets the sole member of a finished organisation go', () => {
    // THE CASE IT WAS ASKED FOR. Nobody is left behind because there is nobody,
    // and nothing is running. A guard that refused this would make the whole
    // sub-command useless for the residue every gate run leaves.
    expect(leaveRefusal(facts())).toBeNull();
    expect(leavesNobodyBehind(facts())).toBe(true);
  });

  it('refuses while a migration is unfinished, and says how many', () => {
    const refusal = leaveRefusal(facts({ liveMappings: 3 }));
    expect(refusal).toContain('Acme Families has 3 unfinished migrations');
    expect(refusal).toContain('NOTHING WAS REMOVED');
  });

  it('counts one migration in the singular', () => {
    // `::int` in the query is what makes this true: node-pg hands `count(*)`
    // back as the STRING '1', and `'1' === 1` is false — so every organisation
    // with exactly one unfinished migration would read "1 unfinished
    // migrations", on the case somebody is most likely to be staring at.
    expect(leaveRefusal(facts({ liveMappings: 1 }))).toContain('1 unfinished migration.');
  });

  it('refuses to leave other people without an owner, and says how many', () => {
    const refusal = leaveRefusal(facts({ otherMembers: 4, otherOwners: 0 }));
    expect(refusal).toContain('Acme Families has 4 other members, and you are its only owner');
    // The remedy, not just the refusal: promote somebody, then leave.
    expect(refusal).toContain('PATCH /api/tenants/<tenant-id>/members/<member-id>');
    expect(refusal).toContain('NOTHING WAS REMOVED');
  });

  it('allows it once another active owner remains', () => {
    // The guard is about the ORGANISATION being left without an owner, never
    // about who is asking — so a second owner is the whole of the fix.
    expect(leaveRefusal(facts({ otherMembers: 4, otherOwners: 1 }))).toBeNull();
    expect(leavesNobodyBehind(facts({ otherMembers: 4 }))).toBe(false);
  });

  it('lets a non-owner walk out of a full organisation', () => {
    // Nothing is stranded: the owners are still owners. Refusing here would be
    // a rule about tidiness wearing a safety rule's clothes.
    expect(leaveRefusal(facts({ role: 'member', otherMembers: 9, otherOwners: 2 }))).toBeNull();
  });

  it('names the migration first when both are true', () => {
    // ORDER IS THE POINT. A sole owner of a busy organisation is refused for
    // the running migration — the reason they are least likely to have
    // considered — rather than for the members, which they can see.
    const refusal = leaveRefusal(facts({ otherMembers: 2, liveMappings: 1 }));
    expect(refusal).toContain('unfinished migration');
    expect(refusal).not.toContain('only owner');
  });

  it('refuses to be pointed at somebody who is not platform staff', () => {
    // THE GUARD THAT PROTECTS THE PERSON RATHER THAN THE ORGANISATION. Every
    // other check here asks what the organisation loses; this one asks whether
    // a removal nobody consented to may be made at all. Without it, the same
    // three words remove any customer from any organisation with no owner
    // pressing anything and no record of a decision.
    const refusal = notAnOperatorRefusal('387847603254984715');
    expect(refusal).toContain('is not a platform operator');
    expect(refusal).toContain('DELETE /api/tenants/<tenant-id>/members/<member-id>');
    expect(refusal).toContain('./deploy/compose/operator.sh add 387847603254984715');
    expect(refusal).toContain('NOTHING WAS REMOVED');
  });
});

/**
 * AND `platform_operator` IS NEVER TOUCHED.
 *
 * The request was "stay operator, but remove me from all organisations", and a
 * command that helpfully did both would be the exact opposite of the
 * separation ADR-0042 draws — appointment and membership are two facts, and
 * this repository keeps them in two tables so that one can be given up without
 * the other. It is worth a test because the failure would be silent and
 * one-way: an operator who unappointed themselves cannot appoint themselves
 * back, since only an operator connection at the machine can write that table.
 */
describe('leaving is not resigning', () => {
  const SOURCE = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'operator.ts'),
    'utf8',
  );

  /** The `leave` case, from its label to the next one. */
  const leaveCase = (): string => {
    const from = SOURCE.indexOf("case 'leave': {");
    expect(from, "the `leave` case is gone — this guard is now checking nothing").toBeGreaterThan(0);
    const to = SOURCE.indexOf('      default:', from);
    return SOURCE.slice(from, to);
  };

  it('never writes platform_operator while leaving', () => {
    const body = leaveCase();
    expect(body).not.toMatch(/INSERT INTO platform_operator/i);
    expect(body).not.toMatch(/DELETE FROM platform_operator/i);
    expect(body).not.toMatch(/UPDATE platform_operator/i);
    // It does READ it — that is the guard above — and reading is the only
    // thing it may do with that table.
    expect(body).toContain('SELECT 1 FROM platform_operator WHERE user_id = $1');
  });

  it('says so out loud, every time', () => {
    // A person running this is by definition wondering whether they just gave
    // up more than they meant to, and the answer costs one line.
    expect(leaveCase()).toContain('is still a platform operator');
  });

  it('writes the audit row in the same transaction as the delete', () => {
    // A log that can fail independently of the thing it logs has holes exactly
    // where somebody would want them — `mapping-status-audit.ts`'s reason, and
    // the reason a removal made over the owner connection must not be able to
    // happen quietly.
    const from = SOURCE.indexOf('async function removeMembership(');
    expect(from, 'removeMembership is gone').toBeGreaterThan(0);
    const body = SOURCE.slice(from, SOURCE.indexOf('\n}\n', from));
    const order = ['BEGIN', 'INSERT INTO audit_log', 'DELETE FROM tenant_member', 'COMMIT'];
    let at = 0;
    for (const step of order) {
      const next = body.indexOf(step, at);
      expect(next, `${step} is missing or out of order in removeMembership`).toBeGreaterThan(-1);
      at = next;
    }
    expect(body, 'a failed removal must roll the audit row back with it').toContain('ROLLBACK');
    // And the count is checked BEFORE the commit: reporting a removal that
    // removed nothing is the failure this whole file was written about.
    expect(body.indexOf('rowCount !== 1')).toBeLessThan(body.indexOf("'COMMIT'"));
  });
});

/**
 * AND THE ANSWER IS NOT EMPTY FOR THE WRONG REASON.
 *
 * Both membership commands open by asking which organisations one subject is
 * in — a question that spans all of them, against three tables that all carry
 * FORCE ROW LEVEL SECURITY keyed on `app.current_tenant`. A connection those
 * policies apply to gets zero rows, and zero rows is not an error: the command
 * would print "is in no organisation" and "nothing to remove", confidently,
 * about somebody who owns four.
 *
 * The same shape as the probe `the-check-postgres-never-made.unit.test.ts`
 * exists for — `psql -h 127.0.0.1` that pg_hba answers with `trust`, so it
 * passes on any password. A check whose success cannot fail is not a check.
 */
describe('a listing that could not be empty for the wrong reason', () => {
  const SOURCE = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'operator.ts'),
    'utf8',
  );

  it('names the connection it needs, not just the one it has', () => {
    const refusal = cannotSeeAcrossOrganisationsRefusal('app_user');
    expect(refusal).toContain('connected as app_user');
    expect(refusal).toContain('./deploy/compose/operator.sh memberships <subject>');
    expect(refusal).toContain('NOTHING WAS READ AND NOTHING WAS REMOVED');
  });

  it('is asked before either command reads anything', () => {
    // ORDER IS THE WHOLE GUARD. Checked after the read, it would be a fact
    // reported beside an answer already printed.
    for (const verb of ["case 'memberships': {", "case 'leave': {"]) {
      const from = SOURCE.indexOf(verb);
      expect(from, `${verb} is gone`).toBeGreaterThan(0);
      const body = SOURCE.slice(from, SOURCE.indexOf('        break;\n      }', from));
      const check = body.indexOf('requireCrossTenantSight(pool)');
      const read = body.indexOf('loadMemberships(pool');
      expect(check, `${verb} no longer checks that it can see across tenants`).toBeGreaterThan(-1);
      expect(read, `${verb} no longer reads memberships`).toBeGreaterThan(-1);
      expect(check, `${verb} reads memberships before checking it can see them`).toBeLessThan(read);
    }
  });

  it('asks the database rather than assuming the owner is a superuser', () => {
    // `rolsuper OR rolbypassrls` is the real predicate. Anything softer —
    // "the wrapper composes the owner connection, so it must be fine" — is the
    // assumption this guard replaces.
    expect(SOURCE).toContain('(rolsuper OR rolbypassrls) AS bypasses');
  });
});
