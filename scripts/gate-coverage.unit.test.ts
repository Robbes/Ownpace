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

describe('the refusal the operator can answer', () => {
  /**
   * The queue's second decision, and the one whose wrong answer cannot be
   * taken back: granting an address that already owns an organisation makes a
   * second one with that person as owner of both, and every later sign-in has
   * to ask them which they meant. The owner found exactly that in their own
   * queue on 2026-08-31.
   *
   * Proved against PGlite, and in the browser against a mocked API. Never
   * against the real route — where the refusal reads through
   * `support_tenant_members`, a view whose entire protection is one EXISTS
   * against `platform_operator`, on a transaction scoped to a tenant that does
   * not exist yet. That is not a shape a unit test can stand up.
   */
  const block = smoke.slice(
    smoke.indexOf('AND THE REFUSAL THE OPERATOR CAN ANSWER'),
    smoke.indexOf('TAKE IT BACK. Requests first'),
  );

  it('found the block', () => {
    expect(block.length).toBeGreaterThan(500);
  });

  it('asks AFTER a decision, which the index allows, not while one is open', () => {
    // Migration 0020 forbids two OPEN requests per address and says nothing
    // about a second ask after a decision — 0002 was right about that one.
    // Knocking again before the grant would be refused by the index and this
    // whole block would test the wrong rule.
    const grant = smoke.indexOf('granting created an organisation');
    const third = smoke.indexOf('gk3=');
    expect(grant).toBeGreaterThan(-1);
    expect(third, 'the second ask happens before the first is granted').toBeGreaterThan(grant);
  });

  it('requires the 409 to NAME the organisation, not merely to refuse', () => {
    // A bare "already owns one" sends an operator off to go and look. The
    // names are what they weigh, and `confirmWith` is how the client learns
    // what to send without carrying a copy of the route's vocabulary.
    expect(block).toContain('confirmWith');
    expect(block).toContain('alsoCreateSecondOrganisation');
    expect(block, 'the refusal is accepted without checking it names anything').toContain('named');
  });

  it('proves the refusal PROVISIONED NOTHING while refusing', () => {
    // The check runs before the insert precisely so nothing half-happens. A
    // refusal that had already created the tenant would be worse than none,
    // and a status-code assertion alone cannot tell those apart.
    expect(block).toContain('before');
    expect(block).toContain('during');
    expect(block).toContain('the refusal provisioned nothing');
  });

  it('then MEANS it, and counts the organisations either side', () => {
    // The half that had no way to be sent at all until the screen grew a
    // button. If the field does not work, the refusal is a dead end whose only
    // way past is a hand-written POST — which is where this was yesterday.
    expect(block).toMatch(/alsoCreateSecondOrganisation:true/);
    expect(block).toContain('second_tenant');
    expect(block, 'the second organisation is not distinguished from the first').toContain(
      '"$second_tenant" != "$new_tenant"',
    );
    expect(block, 'a count that is not compared').toMatch(/"\$after" = "\$\(\(before \+ 1\)\)"/);
  });

  it('refuses to do arithmetic on a count it could not read', () => {
    // `q` answers '?' when psql could not run, and `$(( ? + 1 ))` is a bash
    // syntax error: it prints noise and leaves the comparison against an empty
    // string, so an UNREADABLE count would report as a specific disagreement.
    // Sanitised to -1 first, which fails the test and shows the real value.
    expect(block).toMatch(/case "\$before" in ''\|\*\[!0-9\]\*\) before=-1/);
    expect(block).toMatch(/case "\$after" {2}in ''\|\*\[!0-9\]\*\) after=-1/);
    expect(block, 'the sanitised value is never checked, so -1 could still pass').toContain(
      '"$before" -ge 0',
    );
  });
});

describe('finding a person, and the log that says you did', () => {
  /**
   * `GET /api/support/people` crosses every organisation at once — the one
   * read on this surface not scoped to a tenant the operator already chose,
   * and so the widest question this product can be asked.
   *
   * Which makes the accountability half load-bearing rather than decorative.
   * A regression in `support_read` is invisible by construction: the screen
   * still works, the operator still sees the person, and the only thing
   * missing is the record that they looked. Nothing anywhere checked the row
   * appears.
   */
  const block = smoke.slice(
    smoke.indexOf('FINDING A PERSON, AND THE LOG THAT SAYS YOU DID'),
    smoke.indexOf('TAKE IT BACK. Requests first'),
  );

  it('found the block', () => {
    expect(block.length).toBeGreaterThan(500);
  });

  it('asks about the person this run created, not about the seed', () => {
    // Not the demo seed: the address is one this block chose, so the answer
    // comes from rows that did not exist a minute earlier — the part a fixture
    // cannot prove.
    expect(block).toContain('q=${GRANT_EMAIL}');
  });

  it('requires EVERY organisation this run created, not a count', () => {
    // MEASURED, not reasoned: this first asserted `matches = 1` and E2E
    // (managed) #104 answered `matches=2`. The block above deliberately makes
    // a SECOND organisation for the same address — that is what the override
    // is — so the person owns two by then, and the test was wrong about the
    // product rather than the other way round.
    //
    // Asking for both is stronger than asking for a number: a search that
    // returned one of them would be failing at the only job this route has,
    // and this does not go red when the block above changes how many it makes.
    expect(block).toContain('in_first');
    expect(block).toContain('in_second');
    expect(block).toContain('"$in_first" = "1"');
    expect(block).toContain('"$in_second" = "1"');
    expect(block, 'a bare count would drift with the block above it').not.toContain('"$found" = "1"');
  });

  it('checks the floor, because a blank box is not a question', () => {
    expect(block).toContain('q=a');
    expect(block).toContain('a one-character search is refused');
  });

  it('reads the LOG, with the query and the count, not just view_name', () => {
    // `view_name` alone cannot tell an operator who searched one address from
    // one who listed everybody. Keeping the query is the whole point of 0019,
    // and a check that ignored it would pass a route that logged neither.
    expect(block).toContain("view_name = 'people'");
    expect(block).toContain('query = ');
    // Against what CAME BACK, not against a constant. The column records what
    // the operator actually saw, so comparing it to the answer is the
    // assertion — and it catches a route that logs a fixed number, which a
    // hardcoded expectation here could not.
    expect(block).toContain('result_count = ${found}');
    expect(block, 'a constant would pass a route that logs a constant').not.toMatch(
      /result_count = \d/,
    );
  });

  it('treats opening a person as its own read', () => {
    // A different view_name, scoped to the tenant: "searched for an address"
    // and "opened that account" are different things to anybody reading the
    // log afterwards.
    expect(block).toContain('/opened');
    expect(block).toContain("view_name = 'person'");
    expect(block).toContain('"$code" = "204"');
  });

  it('does NOT sweep support_read, and says why', () => {
    // A gate that erased its own audit trail would be demonstrating the
    // failure the table exists to catch. The rows outlive the tenant because
    // `tenant_id` carries no foreign key (migration 0009), so the take-back
    // cannot be blocked by them either.
    expect(block, 'the gate deletes its own audit rows').not.toMatch(/DELETE FROM support_read/);
    expect(block).toContain('NOTHING SWEEPS support_read, DELIBERATELY');
  });
});

describe('the other decision, and the mail that does or does not go', () => {
  /**
   * Granting is the decision this product is FOR; declining is the one an
   * operator makes far more often. The front door is public and rate-limited
   * but still public, so junk reaches the queue and most of what arrives is
   * answered no.
   *
   * It also carries the only outward-facing act on this surface. A grant's
   * mail is a courtesy to somebody who asked; a decline's goes to an address a
   * stranger typed, and mailing a forged one means mailing an uninvolved
   * person. Which is why `notify` exists, why the client sends it explicitly,
   * and why `skipped` and `off` are different words: one is a choice a human
   * made, the other is a deployment that cannot send and hands them a manual
   * step. Collapsing them would tell an operator to go and email somebody they
   * deliberately ignored.
   */
  const block = smoke.slice(
    smoke.indexOf('THE OTHER DECISION, AND THE MAIL THAT DOES OR DOES NOT GO'),
    smoke.indexOf("DELETE FROM platform_operator WHERE user_id"),
  );

  it('found the block', () => {
    expect(block.length).toBeGreaterThan(500);
  });

  it('asks for BOTH halves, which are different decisions', () => {
    expect(block).toContain('decline_one "$DECLINE_LOUD" true');
    expect(block).toContain('decline_one "$DECLINE_QUIET" false');
  });

  it('distinguishes `sent` from `skipped`, and does not accept `off`', () => {
    // `off` and `failed` both mean nobody was told, and both mean the operator
    // is now the only person who can tell them — a different problem from a
    // refusal, and not something this gate may pass over.
    expect(block).toContain('"$d_notified" = "sent"');
    expect(block).toContain('"$qd_notified" = "skipped"');
    expect(block, 'a deployment that cannot send would pass').not.toMatch(/d_notified" = "off"/);
  });

  it('proves the quiet one by the CATCHER, not by the API\'s own word', () => {
    // The API saying `skipped` is exactly what a silently broken send would
    // also say. The only honest evidence is that no mail arrived.
    expect(block).toContain('qd_seen');
    expect(block).toContain('"${qd_seen:-1}" = "0"');
  });

  it('counts mail by RECIPIENT, never by mention', () => {
    // MEASURED, not reasoned. This block first counted `messages_count` for a
    // search on the applicant's address, and E2E (managed) #105 answered
    //
    //     declining quietly: ... notified=skipped, ..., mail in catcher=1
    //
    // with nothing having been sent to that person at all. Mailpit's search
    // matches anything that MENTIONS the address, and the knock mail to the
    // operator names the applicant — correctly, it is how they know who wrote.
    // So the count was reading the product working.
    //
    // A mention count cannot answer either half: the negative goes red on a
    // mail nobody sent, and the positive would go green on the operator's copy
    // of a refusal that never left.
    const code = block
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(code).toContain('mail_to_count()');
    expect(code).toContain('.To[]?.Address');
    expect(code, 'a mention count is back — #105 is repeatable').not.toContain('messages_count');
  });

  it('asks the negative only once a mail has actually landed', () => {
    // "Nobody was mailed" passes on a stack whose SMTP pipe is dead, and that
    // is the failure this whole block would be least likely to notice. The
    // quiet decline therefore goes FIRST and its answer is read LAST, with the
    // loud one's delivery in between as the positive control: a wrongly sent
    // quiet mail had strictly longer to arrive than the one that did.
    const quiet = block.indexOf('decline_one "$DECLINE_QUIET" false');
    const loudLanded = block.indexOf('mail_to_count "$DECLINE_LOUD"');
    const negative = block.indexOf('qd_seen="$(mail_to_count');
    expect(quiet, 'the quiet decline is gone').toBeGreaterThan(-1);
    expect(loudLanded, 'nothing waits for the loud mail any more').toBeGreaterThan(quiet);
    expect(negative, 'the negative is read before its control').toBeGreaterThan(loudLanded);
  });

  it('checks the loud one reached the APPLICANT, not the operator channel', () => {
    // The knock mail goes to NOTIFY_TO and must never reach the person; this
    // one is the opposite. The two are easy to wire the wrong way round, and
    // each wrong way is a different disclosure.
    expect(block).toContain('the refusal was addressed to the applicant');
    expect(block).toContain('.To[]?.Address');
  });

  it('reads the state from the DATABASE, not from the reply', () => {
    // A route that answered 200 and left the row open would satisfy every
    // status assertion here.
    expect(block).toContain('SELECT state FROM access_request');
    expect(block).toContain('"$d_state" = "declined"');
  });

  it('takes its requests back, and declining creates no tenant to take back', () => {
    expect(block).toMatch(/DELETE FROM access_request WHERE email LIKE 'smoke-decline-/);
    expect(block).toContain('d_left');
    expect(block, 'a residue count that cannot fail the run').toMatch(/d_left[\s\S]{0,200}fail=1/);
    // Declining provisions nothing, so there is deliberately no tenant sweep
    // here — a DELETE FROM tenant in this block would be reaching for
    // something it never created.
    expect(block).not.toMatch(/DELETE FROM tenant/);
  });
});
