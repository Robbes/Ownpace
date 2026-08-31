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
 * One block of the operator section, ending where the NEXT one begins.
 *
 * Slicing to the operator take-back instead looks equivalent and is not: these
 * blocks are siblings under one `if`, so the last slice quietly grows to
 * swallow whatever is added after it. Not hypothetical — the boundary block
 * landing behind the decline block turned an anchored-sweep assertion red on
 * somebody else's correctly anchored sweep, and a test that goes red for a
 * reason its message does not describe is worse than one that never ran.
 */
const operatorBlock = (marker: string): string => {
  // The BANNER, not the words. A bare `indexOf` on the title finds the
  // sentence in the block's own prose 895 characters earlier, which was
  // harmless while every slice ran to the take-back and stopped being harmless
  // the moment one of them ended at the next banner instead.
  const banner = `# ---------- ${marker}`;
  const at = smoke.indexOf(banner);
  if (at < 0) return '';
  const revoked = smoke.indexOf('DELETE FROM platform_operator WHERE user_id', at);
  const next = smoke.indexOf('# ---------- ', at + banner.length);
  return smoke.slice(at, next > -1 && next < revoked ? next : revoked);
};

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
  const block = operatorBlock('THE QUEUE THEY CAME FOR');

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
  const block = operatorBlock('THE OTHER DECISION, AND THE MAIL THAT DOES OR DOES NOT GO');

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

describe('the same buttons, pressed by somebody who is not an operator', () => {
  /**
   * Every other block in this file is a positive: an operator presses, the
   * product answers, the gate reads the answer. The property all of them rest
   * on is the negative — and the support views make it a single point of
   * failure on purpose.
   *
   * They bypass row security, because an operator has no tenant and a view
   * honouring the tenant policy would be useless to them. So there is no
   * second net: one `EXISTS (SELECT 1 FROM platform_operator WHERE user_id =
   * app.current_user)` per view is the whole boundary. Drop it, re-create a
   * view without it, or own it wrongly, and every customer's metadata is
   * served to anybody who can sign in — with every positive above still green.
   *
   * `support-views.unit.test.ts` proves this against PGlite. What it cannot
   * prove is that THE DEPLOYMENT matches the fixture, which is the only thing
   * this block is for.
   */
  const block = operatorBlock('THE SAME BUTTONS, PRESSED BY SOMEBODY WHO IS NOT AN OPERATOR');

  it('found the block', () => {
    expect(block.length).toBeGreaterThan(500);
  });

  it('asks with a MEMBER of the organisation, not a stranger', () => {
    // The strongest available instrument, and the choice is the test. A
    // support route that quietly fell back to tenant scope answers 200 to a
    // member — and a gate that only ever asked about organisations the caller
    // has nothing to do with would call that a boundary holding.
    expect(block).toContain('$API/api/support/tenants/${APPLY_TENANT}" "$TOK_R"');
    expect(block).toContain('FROM tenant_member');
    expect(block).toContain('$b_member" = "1"');
    expect(block).toContain('$b_isop" = "0"');
  });

  it('refuses to draw any conclusion when the instrument is wrong', () => {
    // Every refusal below reads as a pass if the caller were an operator with
    // no membership: 404 everywhere, nothing written. So the precondition
    // gates the body rather than merely reporting beside it.
    const asked = [
      ...block.matchAll(/if \[ "\$b_isop" = "0" \] && \[ "\$b_member" = "1" \]; then/g),
    ];
    // Twice: once to say what it found, once to decide whether to go on. One
    // occurrence means the precondition is a print statement.
    expect(asked, 'the precondition is reported and then not acted on').toHaveLength(2);
    const body = block.indexOf('gen_random_uuid()');
    expect(body, 'the body runs whatever the precondition said').toBeGreaterThan(asked[1]!.index!);
  });

  it('puts a positive control in front of the refusals', () => {
    // A 404 proves nothing if the route answers 404 to everybody. A mis-typed
    // path, a dropped view, a stack that never wired this surface at all would
    // each read as a boundary holding.
    const control = block.indexOf('"$OP_TOKEN")');
    const refusal = block.indexOf('"$TOK_R")');
    expect(control, 'nothing establishes the route works at all').toBeGreaterThan(-1);
    expect(refusal, 'the refusal is measured before its control').toBeGreaterThan(control);
  });

  it('compares the two refusals, not just their status codes', () => {
    // The route's own comment promises a non-operator cannot tell whether an
    // id exists. That promise is kept by two answers being indistinguishable,
    // which is a comparison — a pair of 404s says nothing about the bodies.
    expect(block).toContain('gen_random_uuid()');
    expect(block, 'an invented id nobody proved was invented').toContain('FROM tenant WHERE id =');
    expect(block).toMatch(/\[ "\$b_real_body" = "\$b_fake_body" \]/);
  });

  it('proves the audit log was not written, not merely that the route said no', () => {
    // `/opened` exists to write a row, and it is asked here about a membership
    // that genuinely exists. A route that recorded first and checked afterwards
    // would leave a row claiming a non-operator read somebody's account — and
    // the 404 in the reply would look exactly the same.
    expect(block).toContain('b_reads_before');
    expect(block).toContain('b_reads_after');
    expect(block).toMatch(/\[ "\$b_reads_after" = "\$b_reads_before" \]/);
  });

  it('asks the queue while there is something in it', () => {
    // "No rows" and "no such row" are the same answer to somebody who cannot
    // see any. The knock therefore comes first, and the operator's own count
    // is read at the same moment as the refusal.
    const knock = block.indexOf('POST "${API}/api/access-requests"');
    const theirs = block.indexOf('b_sees="$(queue_len "$TOK_R")"');
    expect(knock, 'nothing is knocked, so an empty queue would pass').toBeGreaterThan(-1);
    expect(theirs).toBeGreaterThan(knock);
    expect(block, 'the operator is not asked, so an empty queue still passes').toMatch(
      /\[ "\$b_op_sees" -ge 1 \]/,
    );
  });

  it('reads the refused decision back out of the DATABASE', () => {
    // The one failure a reply cannot show. A decline that went through and
    // then answered 404 tells an applicant no, in the name of somebody who was
    // never given that button — and the status code would be the expected one.
    expect(block).toContain('/decline" "$TOK_R"');
    expect(block).toContain('SELECT state FROM access_request');
    expect(block).toMatch(/\[ "\$b_after" = "open" \]/);
  });
});

describe('the decision that was already made', () => {
  /**
   * Two operators on the same queue, or one who clicked twice on a slow
   * connection. Both routes check `state != 'open'` inside the transaction
   * that would otherwise write — the only place the check means anything —
   * and both answer 409.
   *
   * The status code is the least of it. Granting twice makes a second
   * organisation with one person owning both; declining twice mails somebody a
   * refusal they have already read; granting something declined turns a no
   * into an organisation. And a decision is a RECORD, not a state:
   * `decided_by`, `decided_at` and `decision_note` say who said it and why. A
   * second press that quietly re-stamped them would write the first operator
   * out of the queue's history while the state stayed exactly right.
   */
  const block = operatorBlock('THE DECISION THAT WAS ALREADY MADE');

  it('found the block', () => {
    expect(block.length).toBeGreaterThan(500);
  });

  it('presses both buttons on a decided row, in both directions', () => {
    // Four presses, not two. A route that guarded only its own repeat would
    // pass a test that only pressed the same button twice.
    expect(block).toMatch(/\$\{dn_id\}\/decline/);
    expect(block).toMatch(/\$\{dn_id\}\/grant/);
    expect(block).toMatch(/\$\{dy_id\}\/grant/);
    expect(block).toMatch(/\$\{dy_id\}\/decline/);
  });

  it('proves the RECORD did not move, not only the state', () => {
    // Read before and compared after, as one string. Asserting the state alone
    // passes a second press that re-stamps who decided it — the state was
    // already right, and stays right.
    expect(block).toContain('dn_was');
    expect(block).toContain('dn_now');
    expect(block).toContain('decided_by');
    expect(block).toContain('decision_note');
    expect(block).toContain('decided_at');
    expect(block).toMatch(/\[ "\$dn_now" = "\$dn_was" \]/);
  });

  it('counts the second mail rather than trusting the 409', () => {
    // The 409 says the route refused. It does not say the mailer was never
    // reached — and being told twice that you were refused is the part the
    // applicant experiences.
    expect(block).toContain('mail_to_count "$DECIDED_NO"');
    expect(block).toMatch(/\[ "\$dn_mail2" = "\$dn_mail" \]/);
    expect(block).toMatch(/\[ "\$dy_mail2" = "\$dy_mail" \]/);
  });

  it('waits for the FIRST mail, so the second one\'s absence means something', () => {
    // Same shape as the decline block: a "no further mail" assertion passes on
    // a dead pipe unless a mail demonstrably went through the same pipe first.
    const firstWait = block.indexOf('mail_to_count "$DECIDED_NO"');
    const secondRead = block.indexOf('dn_mail2="$(mail_to_count');
    expect(firstWait).toBeGreaterThan(-1);
    expect(secondRead, 'the second count is read before the first has landed').toBeGreaterThan(
      firstWait,
    );
    expect(block, 'nothing waits for the first mail at all').toMatch(
      /for _ in \$\(seq 1 20\); do[\s\S]{0,200}mail_to_count "\$DECIDED_NO"/,
    );
  });

  it('proves no organisation appeared behind the refused grant', () => {
    // The 409 the route gives here names exactly this: "either create a second
    // organisation or lose the first". Counting is what checks it.
    expect(block).toContain('dn_tenants_before');
    expect(block).toContain('dn_tenants_after');
    expect(block).toMatch(/\[ "\$dn_tenants_after" = "\$dn_tenants_before" \]/);
  });

  it('proves the granted organisation SURVIVED the refused decline', () => {
    // The opposite failure, and the worse one: a decline that landed on a
    // granted request leaves an organisation with nobody as its owner, or
    // tells somebody their access was refused after they were let in.
    expect(block).toContain('dy_still');
    expect(block).toMatch(/role = 'owner' AND status = 'invited'/);
    expect(block).toMatch(/\[ "\$dy_still" = "1\/1" \]/);
    expect(block).toMatch(/\[ "\$dy_state" = "granted" \]/);
  });

  it('names its dependency on the decline block instead of assuming it', () => {
    // `mail_to_count` is defined in a sibling block. A missing function in
    // bash is an empty answer, and an empty answer is exactly what this block
    // would read as "no second mail was sent" — the failure direction that
    // passes.
    expect(block).toContain('declare -F mail_to_count');
    expect(block, 'a missing helper that cannot fail the run').toMatch(
      /declare -F mail_to_count[\s\S]{0,200}fail=1/,
    );
  });
});

describe('how far an operator can walk, and what the log says at each step', () => {
  /**
   * Three levels, and deliberately no fourth: organisations, one organisation
   * with its sections, one migration with its domains — and it stops, because
   * a screen that lists ITEMS is a screen that shows subject lines. That is
   * the metadata boundary, and it is the kind of promise that erodes one
   * convenient field at a time.
   *
   * Each level writes a `support_read` row, and the row is the point. This
   * surface bypasses tenant row security, so the log is the only record of
   * what somebody with that power actually looked at — and two details in it
   * are invisible from the screen either way: the list records a NULL tenant
   * because there is no organisation to name, and a 404 records nothing at
   * all, because an id guessed wrong is not a read of anybody's data.
   */
  const block = operatorBlock('HOW FAR AN OPERATOR CAN WALK, AND WHAT THE LOG SAYS AT EACH STEP');

  it('found the block', () => {
    expect(block.length).toBeGreaterThan(500);
  });

  it('walks all three levels, and the screen that is not about a customer', () => {
    expect(block).toContain('$API/api/support/tenants" "$OP_TOKEN"');
    expect(block).toContain('$API/api/support/tenants/${APPLY_TENANT}" "$OP_TOKEN"');
    expect(block).toContain('$API/api/support/migrations/${APPLY_MAPPING}" "$OP_TOKEN"');
    expect(block).toContain('$API/api/support/retained-invoices" "$OP_TOKEN"');
  });

  it('counts the log as a DELTA, never as a total', () => {
    // The boundary block above already reads one organisation as its control,
    // so a total of 1 was never the right expectation — and pinning one breaks
    // the moment any other block looks at anything.
    expect(block).toContain('delta_ok()');
    expect(block).toMatch(/\[ "\$\(\( \$2 - \$1 \)\)" = "1" \]/);
    expect(block, 'a total, which another block reading anything would break').not.toMatch(
      /reads_of [a-z_]+ [^\n]*\)" = "1"/,
    );
  });

  it('pins the NULL tenant on the two screens that have none', () => {
    // A list read attributed to one organisation is a read in that customer's
    // history that never happened.
    expect(block).toContain("reads_of tenants 'tenant_id IS NULL'");
    expect(block).toContain("reads_of retained_invoices 'tenant_id IS NULL'");
  });

  it('proves a 404 writes nothing', () => {
    expect(block).toContain('gen_random_uuid()');
    expect(block).toMatch(/\[ "\$l2_miss_after" = "\$l2_miss_before" \]/);
    expect(block).toMatch(/\[ "\$\{l2_miss%% \*\}" = "404" \]/);
  });

  it('asks for every section by presence, not by length', () => {
    // An empty connections list is a true answer for an organisation with
    // none. A MISSING key is a screen with a hole in it, and a length check
    // cannot tell those apart.
    expect(block).toMatch(/map\(\. != null\) \| all/);
    expect(block).toContain('.tenant, .connections, .migrations, .invoices, .members, .usage');
  });

  it('proves there is no fourth level with a REAL item key', () => {
    // The only convincing version of "it does not show items" is that a string
    // identifying one is absent from the answer. And an empty key would match
    // everything, so the block refuses rather than reporting a pass.
    expect(block).toContain('SELECT natural_key FROM item');
    expect(block).toMatch(/case "\$l3_body" in\s*\n\s*\*"\$l4_key"\*\)/);
    expect(block, 'an empty key would match every answer').toMatch(
      /\[ \$\{#l4_key\} -lt 8 \][\s\S]{0,400}fail=1/,
    );
  });

  it('reads the log for the migration against the migration\'s OWN organisation', () => {
    // The route takes only a mapping id and reads the tenant back from the
    // view. There is no path for an operator to name who a read is attributed
    // to, and this is where that would show up if one appeared.
    expect(block).toContain('reads_of migration "tenant_id = \'${APPLY_TENANT}\'"');
  });
});
