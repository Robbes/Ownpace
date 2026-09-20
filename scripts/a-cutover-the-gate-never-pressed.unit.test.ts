// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A cutover the gate never pressed.
 *
 * Workplan 0009 T9–T11 shipped the cutover door asking the ledger (#1026),
 * the preparation job converging on a second press (#1024) and row security
 * on the two ledger tables (#1027) — every one proved on Testcontainers
 * Postgres, none of them ever pressed on a running stack. The appliance
 * cannot press it (ADR-0026: the Finish page is a checklist, not a button),
 * so the managed smoke is the one gate that can, and this file holds it to
 * what makes that press a proof rather than a request:
 *
 *   - it presses the MAIL mapping, the one the VERIFY half finds fit to cut
 *     over (the DAV mapping verifies FAIL on the long-lived stack and would
 *     land FAILED by the job's own rule);
 *   - it waits on the LEDGER, bounded, and reads the trail — not the HTTP
 *     202, which only says something was enqueued;
 *   - the second press is asserted as a CONVERGENCE (attempt 2, by the job,
 *     the first attempt kept), not as "still ready";
 *   - the refusals are asserted with their stable codes and NO run;
 *   - row security is asked of a real app_user, with and without context;
 *   - and the ledger is TAKEN BACK, because one ledger per mapping on a stack
 *     that lives from night to night is otherwise tomorrow's failure.
 *
 * The lines are read from the real script, the way the neighbouring smoke
 * guards do: a test restating them would pass while the script drifted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const smoke = readFileSync(
  fileURLToPath(new URL('../deploy/compose/smoke-managed.sh', import.meta.url)),
  'utf8',
);

const HEADER = '# ---------- the cutover door, and the job behind it';
const VERDICT = '# ---------- verdict ----------';
const BALANCE = '# ---------- balance ----------';

const start = smoke.indexOf(HEADER);
const end = smoke.indexOf(VERDICT);
const section = start > -1 && end > start ? smoke.slice(start, end) : '';

describe('the managed gate presses the cutover door', () => {
  it('read the real script, and found the section where it belongs', () => {
    // Vacuity guard: every assertion below passes against an empty string.
    expect(smoke.length).toBeGreaterThan(2000);
    expect(start, 'the cutover section is gone').toBeGreaterThan(-1);
    expect(end, 'the verdict must come after the section').toBeGreaterThan(start);
    expect(section.length).toBeGreaterThan(2000);
    // After the balance: the ledger it makes is its own to take back, and the
    // balance section must not be asked to know about it.
    expect(smoke.indexOf(BALANCE), 'the balance section is gone').toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(smoke.indexOf(BALANCE));
  });

  it('presses the MAIL mapping, and never the DAV one', () => {
    expect(section).toContain('CUTOVER_URL="$API/api/migrations/$VERIFY_MAPPING/cutover"');
    expect(section, 'the DAV mapping verifies FAIL on the long-lived stack').not.toContain(
      'APPLY_MAPPING',
    );
  });

  it('waits on the ledger, bounded, and reads the trail when it did not land', () => {
    expect(section).toContain('SELECT state FROM cutover_state WHERE $CUTOVER_WHERE');
    expect(section).toMatch(/while \[ \$i -lt "\$SYNC_POLLS" \]/);
    expect(section).toContain('ledger_trail');
    // The 202 is not the proof. It is pinned for what it SAYS, and the ledger
    // is what is waited on.
    expect(section).toContain('[ "$prep" = "cutover-preparation null false false" ]');
  });

  it('asserts the second press as a convergence, attempt 2 by the job, on the trail', () => {
    expect(section).toContain('[ "$prep" = "READY_FOR_CUTOVER true false" ]');
    expect(section).toContain(
      "from_state='READY_FOR_CUTOVER' AND to_state='PREPARING' AND metadata->>'retriedBy'='trigger-job' AND metadata->>'attempt'='2'",
    );
    expect(section).toContain("to_state='READY_FOR_CUTOVER' AND metadata->>'attempt'='2'");
    expect(section).toContain('[ "$ready_entries" = "2" ]');
  });

  it('asserts both refusals with their stable codes and no run', () => {
    expect(section).toContain('"CUTOVER_IN_PROGRESS under_way" "COMPLETED closed"');
    expect(section).toContain('[ "$CUT_CODE" != "409" ]');
    expect(section).toContain('[ "$got" = "cutover_refused $fx_code $fx_state no-run" ]');
    // And the ledger must be exactly as the fixture left it.
    expect(section).toContain('[ "$after" = "$before" ] && [ "$st" = "$fx_state" ]');
  });

  it('asks row security of a real app_user, blind without context and scoped with it', () => {
    expect(section).toMatch(/SET ROLE app_user; SELECT count\(\*\) FROM cutover_state"/);
    expect(section).toMatch(/SET ROLE app_user; SELECT count\(\*\) FROM cutover_event"/);
    expect(section).toContain('[ "$blind_state" = "0" ] && [ "$blind_events" = "0" ]');
    expect(section).toContain("SELECT set_config('app.current_tenant','$VERIFY_TENANT',true)");
    expect(section).toContain('[ "$scoped_state" = "1" ]');
  });

  it('takes the ledger back — both tables — after the fixtures, and proves it gone', () => {
    const takeBack = section.indexOf('ledger_take_back() {');
    expect(takeBack).toBeGreaterThan(-1);
    const body = section.slice(takeBack, section.indexOf('}', takeBack));
    expect(body).toContain('DELETE FROM cutover_event WHERE $CUTOVER_WHERE');
    expect(body).toContain('DELETE FROM cutover_state WHERE $CUTOVER_WHERE');
    const fixtures = section.indexOf('"CUTOVER_IN_PROGRESS under_way"');
    const lastCall = section.lastIndexOf('\nledger_take_back\n');
    expect(lastCall, 'the take-back must be called at top level, after the fixtures').toBeGreaterThan(fixtures);
    expect(section).toContain('[ "$left_state" = "0" ] && [ "$left_events" = "0" ]');
    expect(section).toMatch(/fail_at "the cutover ledger was not taken back/);
    // And a leftover from an aborted run is cleared BEFORE the first press.
    const leftover = section.indexOf('leftover="$(ledger_state)"');
    const firstPress = section.indexOf('cutover_press "no ledger yet"');
    expect(leftover).toBeGreaterThan(-1);
    expect(firstPress).toBeGreaterThan(leftover);
  });

  it('never fails the run without saying why', () => {
    const calls = section.match(/fail_at\b[^\n]*/g) ?? [];
    expect(calls.length).toBeGreaterThan(12);
    for (const call of calls) {
      expect(call, `a bare fail_at says nothing: ${call}`).toMatch(/^fail_at "/);
    }
    expect(section).not.toMatch(/\bfail=1\b/);
  });
});
