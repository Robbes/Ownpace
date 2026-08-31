// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What the managed gate actually asks the running stack for.
 *
 * ## The question that produced this file
 *
 * "Does the gate cover all the relevant paths?" — and the answer, found by
 * grepping both gates, was that four route families the product ships, sells
 * and renders screens for had never once been requested from a live stack:
 *
 *   /api/shared-addresses   the Pattern D list runbook
 *   /api/permissions        who can see what, and what happens to it
 *   /api/billing            usage, and the invoices built from it
 *   /api/ready              the readiness probe added precisely to be asked
 *
 * plus offboarding — `close` and `reopen` on a tenant, the path that starts and
 * stops somebody's erasure clock, shipped with integration tests and nothing
 * that ever ran it against RLS and a real row.
 *
 * ## And the drift guard, because a list of what is covered goes stale
 *
 * The same shape as `MOUNTS` (0096), the `pull_request` filters (0097), the
 * pre-flight env list (0098) and the bring-up service list (0099): a
 * hand-maintained list nobody updates. So the set of route families is DERIVED
 * from `index.ts`, and every one of them must either be requested by the smoke
 * or carry a written reason for not being. Adding a route family without
 * deciding which fails here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string): string => readFileSync(REPO + path, 'utf8');

const smoke = read('deploy/compose/smoke-managed.sh');
const index = read('apps/api/src/index.ts');

/**
 * Route families the smoke deliberately does NOT ask for, and why. A reason is
 * required: "not covered" with no sentence beside it is how a gap becomes
 * permanent by nobody noticing it.
 */
const NOT_ASKED: Record<string, string> = {
  '/api/access-requests':
    'granting one sends a real email to a real address. Covered by ' +
    'access-requests.integration.test.ts, which does not.',
  '/api/scope-manifest':
    'a static description of the scopes each provider needs. Nothing about it ' +
    'can be true on a laptop and false on the Spark.',
  '/api/setup':
    'the first-run path. A stack this gate can talk to is past it by ' +
    'definition, so asking would prove the opposite of what it looks like.',
  '/api/connections':
    'every connection this gate uses is written by the demo seed, encrypted ' +
    'with the stack\'s own key. Exercising the route means writing credentials ' +
    'from a script, and hard rule 3 says no.',
  '/api/decisions':
    'needs a drift decision to exist, which needs a source that produced one. ' +
    'Manufacturing it would test the fixture.',
  '/api/billing/webhooks':
    'a payment provider\'s signed callback. Forging one proves the signature ' +
    'check can be fooled, which is worse than no coverage.',
  '/api/grant':
    'the migrator\'s consent flow. Reaching it needs a link issued against a ' +
    'source connection carrying a real Google client id and secret, written ' +
    'from a script — hard rule 3 says no — and the flow it starts ends at ' +
    'Google\'s own consent screen, which no gate can press. Covered by ' +
    'routes/grant.unit.test.ts, which runs the whole flow against a real ' +
    'database with only Google\'s token endpoint replaced.',
};

describe('every route family is either asked for or accounted for', () => {
  // `m[1]` is `string | undefined` to the compiler and never undefined in
  // fact — the group is not optional. Filtered rather than asserted, because a
  // pattern that stops matching should shrink this list and trip the vacuity
  // guard below, not throw somewhere unrelated.
  const mounted = [...index.matchAll(/app\.use\(\s*'(\/api[^']*)'/g)]
    .map((m) => m[1])
    .filter((p): p is string => p !== undefined);

  it('read the real files', () => {
    // Vacuity guard: an empty mount list makes every case below pass.
    expect(mounted.length).toBeGreaterThan(8);
    expect(smoke.length).toBeGreaterThan(2000);
  });

  it('leaves no route family undecided', () => {
    const undecided = mounted.filter(
      (prefix) => !smoke.includes(prefix) && !(prefix in NOT_ASKED),
    );
    expect(
      undecided,
      'mounted in index.ts, never asked for by the gate, and no reason written down',
    ).toEqual([]);
  });

  it('does not carry reasons for families that no longer exist', () => {
    // The other direction of the same drift: a route family gets removed and
    // its excuse outlives it, so the list slowly stops describing anything.
    const stale = Object.keys(NOT_ASKED).filter((prefix) => !mounted.includes(prefix));
    expect(stale, 'excused in this file but not mounted anywhere').toEqual([]);
  });

  it('asks for the five that had never been asked for', () => {
    for (const path of [
      '/api/ready',
      '/api/shared-addresses',
      '/api/shared-addresses/runbook',
      '/api/permissions/report',
      '/api/billing/usage',
      '/api/billing/invoices',
    ]) {
      expect(smoke, `${path} is not requested anywhere in the smoke`).toContain(path);
    }
  });
});

describe('the reports are asserted, not merely fetched', () => {
  const reports = smoke.slice(smoke.indexOf('note "reports nothing had ever opened"'));

  it('fails on a 200 that carries the wrong shape', () => {
    // The failure mode this replaces is a check that greps for HTTP 200 and
    // calls it coverage. `serverFault` answers 500, but a route that quietly
    // stopped returning a key answers 200 with the key missing.
    expect(reports).toMatch(/\[ -z "\$value" \] \|\| \[ "\$value" = "null" \]/);
    expect(reports).toContain('fail=1');
  });

  it('checks markdown for a HEADING, not for a length', () => {
    // An error page is also several hundred bytes, and `serverFault` renders
    // JSON that would sail past a size check.
    expect(reports).toContain('## Before you start');
    expect(reports).toContain('# Who can see what, and what happens to it');
    expect(reports, 'a length check would pass an error page').not.toMatch(
      /\$\{#body\} -(gt|ge)/,
    );
  });

  it('pins the one answer that may only be `up`', () => {
    // A count of 0 addresses is a true answer and must pass. A database that
    // is down is not, and the same helper cannot treat them alike.
    expect(reports).toMatch(/report_json "readiness \(database\)".*'\.database' up/);
  });

  it('does not pin the sign-in half, which has a known cause reported elsewhere', () => {
    // ZITADEL_EXTERNALDOMAIN is still `localhost` on the runner; the identity
    // section says so precisely. Reporting the same outage twice makes the
    // second report noise, and noise is what gets muted.
    expect(reports).not.toMatch(/'\.signIn' up/);
  });
});

describe('offboarding is exercised where it can be undone', () => {
  const closing = smoke.slice(
    smoke.indexOf('note "closing a tenant, and changing your mind"'),
    smoke.indexOf('# Clean up after itself'),
  );

  it('runs on the throwaway tenant, not on a demo one', () => {
    // T1 is the tenant the invitation section creates, accepts (so the subject
    // is an active owner, which requireRole('owner') wants) and deletes a few
    // lines later. Closing a demo tenant would quiesce the migrations the rest
    // of this gate depends on.
    expect(closing).toContain('/api/tenants/${T1}/close');
    expect(closing).toContain('/api/tenants/${T1}/reopen');
    expect(closing, 'never the tenants the gate itself measures').not.toContain(
      '$APPLY_TENANT/close',
    );
  });

  it('asserts the closure ROW, not the response', () => {
    // A 200 describing a closure nothing recorded is the exact shape of green
    // this script exists to catch — and the closure row is what the purge job
    // actually reads.
    expect(closing).toMatch(/SELECT count\(\*\) FROM tenant_closure/);
  });

  it('checks the erasure window is a window', () => {
    // purge_after before closed_at would erase immediately, which is the one
    // way this path becomes quietly destructive (ADR-0024, hard rule 2).
    expect(closing).toContain('purge_after > closed_at');
  });

  it('checks that reopening STOPS the clock', () => {
    // A reopen that leaves the row behind is a tenant that gets erased on
    // schedule having been reopened — the failure nobody sees until the date.
    expect(closing).toMatch(/closure rows after reopen/);
    expect(closing).toMatch(/erasure clock is still running/);
  });
});

describe('the decision the operator role exists for', () => {
  /**
   * Before this, the gate proved an operator could hold a session and READ the
   * tenant list. Nothing pressed grant.
   *
   * That is not a small gap. Granting is the only path by which this product
   * acquires a customer — three writes in one transaction, a tenant, an owner
   * invitation and the request marked granted — and a stack that cannot do it
   * cannot be sold to anybody. It was covered against PGlite and against
   * Testcontainers, and never once against the real stack, through PgBouncer,
   * with a subject a real issuer minted. Every one of those seams is exactly
   * where this system's defects have actually lived.
   */
  const block = smoke.slice(
    smoke.indexOf('THE QUEUE THEY CAME FOR'),
    smoke.indexOf("DELETE FROM platform_operator WHERE user_id"),
  );

  it('found the block, so the rest of this file is not vacuous', () => {
    expect(block.length).toBeGreaterThan(500);
  });

  it('reads the queue THROUGH the route, not out of the database', () => {
    // The row being there proves the knock. Only the route proves the decision
    // surface — `operator_may_read` answering a connection that has no tenant.
    expect(block).toMatch(/http GET "\$API\/api\/access-requests" "\$OP_TOKEN"/);
    expect(block, 'the queue is read but its answer is never used').toContain('req_id');
  });

  it('presses grant, and reads what it created out of the DATABASE', () => {
    // A route that answered 201 and wrote nothing would satisfy every check
    // that only reads the reply.
    expect(block).toMatch(/access-requests\/\$\{req_id\}\/grant/);
    expect(block).toContain('FROM tenant WHERE id');
    expect(block).toContain('FROM tenant_member WHERE tenant_id');
    expect(block).toContain("state = 'granted'");
  });

  it('expects an INVITATION, not a member', () => {
    // The person has no subject until they sign in, so the owner row is a
    // `pending:` placeholder that `claimInvitations` replaces on arrival.
    // Asserting `active` here would demand somebody who has not been asked yet
    // — and would have hidden the support deep-link defect of 2026-08-31,
    // which was precisely that these rows are not accounts.
    expect(block).toContain("status = 'invited'");
    expect(block).toContain("user_id LIKE 'pending:%'");
    expect(block, 'a granted owner is not active until they arrive').not.toContain("status = 'active'");
  });

  it('asserts the three writes TOGETHER, because they are one fact', () => {
    // A tenant nobody asked for, or a request pointing at an organisation that
    // does not exist, are both worse than a failure. One comparison, so a
    // partial transaction cannot pass two lines out of three.
    expect(block).toContain('1/1/1');
  });

  it('asks the duplicate knock both ways, which pull against each other', () => {
    // The answer must be identical — a public endpoint that distinguishes a
    // known address from a new one is an enumeration oracle — and the row
    // count must not be. A check on either alone passes the bug.
    expect(block).toMatch(/\[ "\$gk2" = "\$gk" \]/);
    expect(block).toContain("state = 'open'");
    expect(block).toMatch(/open_rows.*=.*"1"|"\$open_rows" = "1"/);
  });

  it('runs while the operator is appointed, and before the appointment is taken back', () => {
    // `platform_operator` is inserted over the owner connection and removed in
    // the same block. A grant attempted outside that window answers 404 —
    // invisible and absent being the same answer — which would look like a
    // broken route rather than a test in the wrong place.
    const appointed = smoke.indexOf('INSERT INTO platform_operator');
    const queue = smoke.indexOf('THE QUEUE THEY CAME FOR');
    const revoked = smoke.indexOf("DELETE FROM platform_operator WHERE user_id");
    expect(appointed).toBeLessThan(queue);
    expect(queue).toBeLessThan(revoked);
  });
});
