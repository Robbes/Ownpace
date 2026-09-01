// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The managed gate takes back what it added.
 *
 * ## What this is guarding against, which was happening every night
 *
 * `smoke-managed.sh`'s prepare phase seeds SIX DAV resources into the demo
 * source with `--fresh`, a real sync copies them into the demo target, and the
 * apply half spends exactly one. Nothing ever removed the other eleven. The
 * gate runs nightly against a long-lived stack — and it MEASURES those same two
 * accounts — so it was changing the thing it measures, one run at a time. The
 * same shape as run #20's fixture exhaustion, running the other way.
 *
 * ## The unit that stays truthful
 *
 * Source object, target copy and ledger row go TOGETHER, and the order and the
 * condition both matter:
 *
 *   ledger row alone  destroys the record of objects that still exist
 *   objects alone     leaves the ledger describing things that are gone, and
 *                     `pick_disposable` hands a later run an item whose target
 *                     vanished — a failure with no visible cause
 *
 * So the ledger delete is CONDITIONAL on the objects having actually gone, not
 * merely sequenced after it. A test for that is the point of this file: putting
 * the delete last reads the same and is not the same.
 *
 * ## And the one row that survives
 *
 * The tombstone. `applyDeletion` wrote it to say a natural key was erased, and
 * `classifyKnownItem` must never re-create it (ADR-0024, hard rule 2). Net zero
 * MINUS one tombstone per run, deliberately — a cleanup that reversed it to
 * make a number come out round would be the exact trade the smoke exists to
 * refuse.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMPOSE = fileURLToPath(new URL('../deploy/compose/', import.meta.url));
const read = (name: string): string => readFileSync(COMPOSE + name, 'utf8');

const smoke = read('smoke-managed.sh');
const seeder = read('seed-demo-dav-content.sh');
const balance = smoke.slice(smoke.indexOf('# ---------- balance ----------'));

describe('the seeder can take a seeded set back', () => {
  it('read the real scripts', () => {
    // Vacuity guard: every assertion below passes against an empty string.
    expect(smoke.length).toBeGreaterThan(2000);
    expect(seeder.length).toBeGreaterThan(2000);
    expect(balance, 'smoke-managed.sh has no balance section at all').toContain('--remove');
  });

  it('requires the tag, and does not invent one', () => {
    // A `--fresh` default is a new timestamp, which is harmless. A `--remove`
    // default is a DELETE against a guess — and if it fell back to SEED_DAV_TAG
    // left over in the environment, it would take away a set somebody is still
    // using. A delete that chooses its own target is not a delete anyone should
    // write (hard rule 2).
    const arm = /--remove\)([\s\S]*?);;/.exec(seeder)?.[1] ?? '';
    expect(arm, 'the --remove arm disappeared').toContain('REMOVE_ONLY=1');
    expect(arm, '--remove must take the tag as an argument').toContain('TAG="${2:-}"');
    expect(arm, '--remove must refuse without one').toMatch(/\[ -n "\$TAG" \] \|\| fail/);
    expect(arm, 'no fallback may reach --remove').not.toContain('SEED_DAV_TAG');
  });

  it('treats an already-absent resource as success, and any other status as failure', () => {
    // Idempotency (hard rule 1): a re-run, or a seed that half-failed, has to
    // converge rather than refuse. Everything else must stop — a removal that
    // reports success it did not achieve is worse than one that fails.
    const block = balanceBlockOf(seeder);
    expect(block, '404 must count as gone').toMatch(/204\|200\|404/);
    expect(block, 'any other status must refuse').toMatch(/\*\)\s*fail /);
  });

  it('proves the removal instead of trusting six status codes', () => {
    const block = balanceBlockOf(seeder);
    expect(block).toContain('count "$CAL"');
    expect(block).toMatch(/still present after removal/);
  });

  it('defines count() above every caller, which is the bug that was there', () => {
    // Bash defines a function when execution REACHES it. `count()` lived beside
    // the verification at the bottom of the file, and `--remove` — which runs
    // near the top and verifies its own work — called it from above: `count:
    // command not found`, AFTER the deletes had already happened.
    const lines = seeder.split('\n');
    const defined = lines.findIndex((l) => l.startsWith('count() {'));
    const firstCall = lines.findIndex((l) => /\$\(count "/.test(l));
    expect(defined, 'count() is gone').toBeGreaterThan(-1);
    expect(firstCall, 'nothing calls count()').toBeGreaterThan(-1);
    expect(
      defined,
      `count() is defined on line ${defined + 1} and first called on line ${firstCall + 1}`,
    ).toBeLessThan(firstCall);
  });
});

// The removal arm of the seeder: from the REMOVE_ONLY branch to the exit that
// ends it. Sliced rather than read whole, so the assertions above cannot be
// satisfied by text somewhere else in the file.
function balanceBlockOf(script: string): string {
  const start = script.indexOf('if [ "$REMOVE_ONLY" = "1" ]; then\n  # WHY THIS EXISTS');
  return start === -1 ? '' : script.slice(start, script.indexOf('\n  exit 0\nfi', start));
}

describe('the smoke removes what it added, in the only order that stays truthful', () => {
  it('chooses the tag itself rather than parsing it back out of a log', () => {
    // The seeder's own default is minted inside a subprocess. The balance
    // section cannot take back a name it never learned, and scraping stdout for
    // it would make the log a second source of truth for one string.
    expect(smoke).toMatch(/BALANCE_TAG="smoke-\$\(date/);
    expect(smoke, '--fresh must be told the tag, not left to invent one').toContain(
      'seed-demo-dav-content.sh" --fresh "$BALANCE_TAG"',
    );
  });

  it('takes the copies out of the TARGET account, not just the source', () => {
    // The sync copies six resources into tenant B's target. Removing only the
    // source halves the leak and hides the other half.
    expect(balance).toContain('DAV_USER="$TARGET_DAV_USER"');
    expect(balance).toMatch(/DAV_PASSWORD="\$TARGET_DAV_PASSWORD"[\s\S]{0,120}--remove "\$BALANCE_TAG"/);
    // And the source, through the script's own defaults.
    expect(
      [...balance.matchAll(/--remove "\$BALANCE_TAG"/g)].length,
      'both accounts must be cleaned',
    ).toBeGreaterThanOrEqual(2);
  });

  it('deletes ledger rows only once the objects are actually gone', () => {
    // THE POINT OF THIS FILE. Sequencing the delete last reads identical to
    // guarding it and is not the same: on a failed removal, an unguarded delete
    // destroys the record of resources that are still sitting there.
    expect(balance, 'the removals must set a flag the ledger step reads').toContain(
      'objects_gone=0',
    );
    const guard = /if \[ "\$objects_gone" = "1" \]; then([\s\S]*?)\n {2}else/.exec(balance)?.[1] ?? '';
    expect(guard, 'the DELETE must sit inside the guard').toContain('DELETE FROM item');
  });

  it('never deletes the tombstone', () => {
    // ADR-0024 / hard rule 2: a tombstoned natural key is never re-created, so
    // the row that records the erasure outlives the fixture it belonged to.
    const del = /DELETE FROM item WHERE[^"]*/.exec(balance)?.[0] ?? '';
    expect(del, 'no DELETE against item at all').not.toEqual('');
    expect(del, "the tombstone must be excluded from the gate's own cleanup").toContain(
      "status <> 'tombstoned'",
    );
  });

  it('asserts the balance rather than reporting it', () => {
    // A `DELETE 0` prints and reads exactly like a delete that worked.
    expect(balance).toMatch(/left="\$\(q "SELECT count/);
    expect(balance, 'a leftover row must fail the smoke').toMatch(
      /\[ "\$\{left:-1\}" = "0" \] \|\|[\s\S]{0,200}fail=1/,
    );
  });

  it('says so when there was nothing to take back', () => {
    // Prepare only seeds when nothing eligible exists. On a run that found an
    // item already there, "balanced" must not come to mean "did nothing".
    expect(balance).toMatch(/if \[ -z "\$BALANCE_TAG" \]; then/);
    expect(balance).toMatch(/nothing to take back/);
  });
});

describe('and the organisation it grants itself, in the order the schema allows', () => {
  /**
   * The operator block now presses grant, which creates a TENANT on a
   * long-lived stack. One a night accumulates in the same database this script
   * measures — the defect this whole file exists for, in a new place.
   *
   * The ORDER is the part worth pinning, and it is not a style choice.
   * `access_request.tenant_id` references the tenant with ON DELETE RESTRICT
   * (migration 0007) and the row carries CHECK ((state = 'granted') =
   * (tenant_id IS NOT NULL)). Delete the tenant first and Postgres refuses,
   * naming a constraint on a table nobody was looking at. Requests, then
   * tenants.
   */
  const opBlock = (): string => {
    // Banner to banner. Running this to the operator take-back instead reached
    // over every sibling block added since, so an "unanchored tenant delete"
    // assertion here went red on the NEXT block's correctly anchored one. The
    // grant's own take-back sits inside this region, which is why the end is
    // the decline banner and not the next line after the grant.
    const at = smoke.indexOf('# ---------- THE QUEUE THEY CAME FOR');
    const end = smoke.indexOf('# ---------- THE OTHER DECISION', at);
    expect(at, 'the operator grant block is gone').toBeGreaterThan(-1);
    expect(end, 'the decline block no longer follows the grant block').toBeGreaterThan(at);
    return smoke.slice(at, end);
  };

  it('deletes the requests BEFORE the tenants, both times', () => {
    const block = opBlock();
    const reqs = [...block.matchAll(/DELETE FROM access_request WHERE email LIKE 'smoke-grant-/g)];
    const tens = [...block.matchAll(/DELETE FROM tenant WHERE name LIKE 'Smoke Grant /g)];
    // Twice each: a stale sweep at the top for a run that died mid-block, and
    // the take-back at the bottom.
    expect(reqs).toHaveLength(2);
    expect(tens).toHaveLength(2);
    for (let i = 0; i < 2; i += 1) {
      expect(
        reqs[i]!.index,
        'a tenant is deleted before the request pointing at it — ON DELETE RESTRICT refuses that',
      ).toBeLessThan(tens[i]!.index!);
    }
  });

  it('asserts the balance rather than reporting it', () => {
    // The lesson the sibling case above records: a line that prints a count
    // and does not compare it is a number nobody reads.
    const block = opBlock();
    expect(block).toContain('g_left');
    expect(block).toMatch(/\[ "\$g_left" = "0\/0" \]/);
    expect(block, 'a residue count that cannot fail the run').toMatch(/taken back[\s\S]{0,400}fail=1/);
  });

  it('sweeps a previous run before it starts, not only after it ends', () => {
    // A run killed between the grant and the take-back leaves a tenant behind,
    // and the next run must not inherit it as a mystery — nor count it.
    const block = opBlock();
    const firstReq = block.indexOf('DELETE FROM access_request');
    const knock = block.indexOf('/api/access-requests');
    expect(firstReq).toBeGreaterThan(-1);
    expect(firstReq, 'the stale sweep runs after the gate has already knocked').toBeLessThan(knock);
  });

  it('names what it creates, so the sweep can find it and nothing else', () => {
    // Both patterns are anchored to a prefix this gate owns. A sweep on
    // `DELETE FROM tenant` with a looser predicate is a demo stack away from
    // deleting a customer.
    const block = opBlock();
    expect(block).toContain("GRANT_EMAIL=\"smoke-grant-${SMOKE_MAIL_RUN}@smoke.local\"");
    expect(block).toContain('GRANT_ORG="Smoke Grant ${SMOKE_MAIL_RUN}"');
    expect(block, 'an unanchored tenant delete').not.toMatch(/DELETE FROM tenant(?! WHERE name LIKE 'Smoke Grant )/);
  });
});

describe('and the refusals it files, which no grant deletes for it', () => {
  /**
   * The decline block knocks on the public front door twice per run and then
   * says no to both. Those rows carry no tenant, so the ON DELETE RESTRICT
   * ordering above does not apply to them — but they accumulate exactly the
   * same way, and in the queue an operator READS. Two junk rows a night is a
   * queue nobody trusts within a month.
   *
   * They are also the one thing here the product itself will not clean up:
   * `access_request` has no DELETE grant for any application role, on purpose
   * (a refusal must not be made to disappear). The sweep therefore runs as the
   * gate's own database user, and it has to be anchored to a prefix that
   * cannot match a real applicant.
   */
  const declineBlock = (): string => {
    // Ends at the NEXT banner, not at the operator take-back. These blocks are
    // siblings under one `if`, so a slice running to the take-back grows to
    // swallow whatever is added after it — and the anchored-sweep assertion
    // below then goes red on somebody else's correctly anchored sweep, with a
    // message describing a defect that is not there.
    const banner = '# ---------- THE OTHER DECISION';
    const at = smoke.indexOf(banner);
    expect(at, 'the decline block is gone').toBeGreaterThan(-1);
    const revoked = smoke.indexOf('DELETE FROM platform_operator WHERE user_id', at);
    const next = smoke.indexOf('# ---------- ', at + banner.length);
    const end = next > -1 && next < revoked ? next : revoked;
    expect(end, 'the operator take-back moved above the decline block').toBeGreaterThan(at);
    return smoke.slice(at, end);
  };

  it('sweeps before it knocks and again after it is done', () => {
    const block = declineBlock();
    const sweeps = [...block.matchAll(/DELETE FROM access_request WHERE email LIKE 'smoke-decline-%/g)];
    // Same two as the grant block, for the same reason: a run killed between
    // the knock and the take-back must not hand the next one a mystery row.
    expect(sweeps, 'a stale sweep at the top and a take-back at the bottom').toHaveLength(2);
    const knock = block.indexOf('/api/access-requests');
    expect(sweeps[0]!.index, 'the stale sweep runs after the gate has knocked').toBeLessThan(knock);
  });

  it('anchors the sweep to a prefix a real applicant cannot have', () => {
    const block = declineBlock();
    expect(block).toContain('DECLINE_LOUD="smoke-decline-loud-${SMOKE_MAIL_RUN}@smoke.local"');
    expect(block).toContain('DECLINE_QUIET="smoke-decline-quiet-${SMOKE_MAIL_RUN}@smoke.local"');
    expect(
      block,
      'an access_request delete this gate does not own — one loose predicate reaches the real queue',
    ).not.toMatch(/DELETE FROM access_request(?! WHERE email LIKE 'smoke-decline-%)/);
  });

  it('asserts the balance rather than reporting it', () => {
    const block = declineBlock();
    expect(block).toContain('d_left');
    expect(block).toMatch(/\[ "\$d_left" = "0" \]/);
    expect(block, 'a residue count that cannot fail the run').toMatch(/NOT taken back[\s\S]{0,200}fail=1/);
  });
});

describe('and the knock the boundary block files to have something to refuse', () => {
  /**
   * One request per run, created only so the refusals have a real open row to
   * be refused about — "no rows" and "no such row" are the same answer to
   * somebody who cannot see any. It lands in the same queue an operator reads,
   * and the product will not remove it for them: `access_request` has no
   * DELETE grant for any application role, on purpose.
   */
  const boundaryBlock = (): string => {
    const banner = '# ---------- THE SAME BUTTONS';
    const at = smoke.indexOf(banner);
    expect(at, 'the boundary block is gone').toBeGreaterThan(-1);
    const revoked = smoke.indexOf('DELETE FROM platform_operator WHERE user_id', at);
    const next = smoke.indexOf('# ---------- ', at + banner.length);
    return smoke.slice(at, next > -1 && next < revoked ? next : revoked);
  };

  it('sweeps before it knocks and again after it is done', () => {
    const block = boundaryBlock();
    const sweeps = [...block.matchAll(/DELETE FROM access_request WHERE email LIKE 'smoke-boundary-%/g)];
    expect(sweeps, 'a stale sweep at the top and a take-back at the bottom').toHaveLength(2);
    const knock = block.indexOf('POST "${API}/api/access-requests"');
    expect(sweeps[0]!.index, 'the stale sweep runs after the gate has knocked').toBeLessThan(knock);
  });

  it('anchors the sweep to a prefix a real applicant cannot have', () => {
    const block = boundaryBlock();
    expect(block).toContain('BOUNDARY_EMAIL="smoke-boundary-${SMOKE_MAIL_RUN}@smoke.local"');
    expect(
      block,
      'an access_request delete this block does not own',
    ).not.toMatch(/DELETE FROM access_request(?! WHERE email LIKE 'smoke-boundary-%)/);
  });

  it('asserts the balance rather than reporting it', () => {
    const block = boundaryBlock();
    expect(block).toContain('b_left');
    expect(block).toMatch(/\[ "\$b_left" = "0" \]/);
    expect(block, 'a residue count that cannot fail the run').toMatch(/NOT taken back[\s\S]{0,200}fail=1/);
  });

  it('creates nothing else — no tenant, no operator, no membership', () => {
    // The boundary block asks what a non-operator CANNOT do. If any of it
    // succeeded it would leave exactly these behind, so their absence here is
    // both a cleanliness property and a second reading of the same assertions.
    const block = boundaryBlock();
    expect(block).not.toMatch(/INSERT INTO tenant\b/);
    expect(block).not.toMatch(/INSERT INTO platform_operator/);
    expect(block).not.toMatch(/INSERT INTO tenant_member/);
  });
});

describe('and the two requests it decides twice', () => {
  /**
   * One knock is declined and then pressed again; the other is granted and
   * then pressed the other way. The second creates an ORGANISATION, so this
   * block has the same ordering obligation as the grant block above —
   * `access_request.tenant_id` is ON DELETE RESTRICT, so requests go first —
   * and the same reason to be anchored: the sweep runs as the gate's own
   * database user, which is the one hand that can delete a refusal.
   */
  const decidedBlock = (): string => {
    const banner = '# ---------- THE DECISION THAT WAS ALREADY MADE';
    const at = smoke.indexOf(banner);
    expect(at, 'the twice-decided block is gone').toBeGreaterThan(-1);
    const revoked = smoke.indexOf('DELETE FROM platform_operator WHERE user_id', at);
    const next = smoke.indexOf('# ---------- ', at + banner.length);
    return smoke.slice(at, next > -1 && next < revoked ? next : revoked);
  };

  it('deletes the requests BEFORE the tenants, both times', () => {
    const block = decidedBlock();
    const reqs = [...block.matchAll(/DELETE FROM access_request WHERE email LIKE 'smoke-decided-/g)];
    const tens = [...block.matchAll(/DELETE FROM tenant WHERE name LIKE 'Smoke Decided /g)];
    expect(reqs, 'a stale sweep at the top and a take-back at the bottom').toHaveLength(2);
    expect(tens).toHaveLength(2);
    for (let i = 0; i < 2; i += 1) {
      expect(
        reqs[i]!.index,
        'a tenant is deleted before the request pointing at it — ON DELETE RESTRICT refuses that',
      ).toBeLessThan(tens[i]!.index!);
    }
  });

  it('anchors both sweeps to names this block owns', () => {
    const block = decidedBlock();
    expect(block).toContain('DECIDED_NO="smoke-decided-no-${SMOKE_MAIL_RUN}@smoke.local"');
    expect(block).toContain('DECIDED_YES="smoke-decided-yes-${SMOKE_MAIL_RUN}@smoke.local"');
    expect(block).toContain('DECIDED_ORG="Smoke Decided ${SMOKE_MAIL_RUN}"');
    expect(block, 'an unanchored tenant delete').not.toMatch(
      /DELETE FROM tenant(?! WHERE name LIKE 'Smoke Decided )/,
    );
    expect(block, 'an access_request delete this block does not own').not.toMatch(
      /DELETE FROM access_request(?! WHERE email LIKE 'smoke-decided-)/,
    );
  });

  it('asserts the balance rather than reporting it', () => {
    const block = decidedBlock();
    expect(block).toContain('dd_left');
    expect(block).toMatch(/\[ "\$dd_left" = "0\/0" \]/);
    expect(block, 'a residue count that cannot fail the run').toMatch(/NOT taken back[\s\S]{0,200}fail=1/);
  });

  it('sweeps a previous run before it knocks, not only after it ends', () => {
    const block = decidedBlock();
    const firstSweep = block.indexOf('DELETE FROM access_request');
    const knock = block.indexOf('knock_open "$DECIDED_NO"');
    expect(firstSweep).toBeGreaterThan(-1);
    expect(firstSweep, 'the stale sweep runs after the gate has knocked').toBeLessThan(knock);
  });
});
