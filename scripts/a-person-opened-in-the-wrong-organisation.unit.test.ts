// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SEARCH THAT FINDS ONE PERSON IN TWO ORGANISATIONS, AND A GATE THAT OPENED
 * WHICHEVER ROW POSTGRES HAPPENED TO RETURN FIRST.
 *
 * E2E (managed) #184 went red on main with:
 *
 *   opening the person: HTTP 404, support_read person rows = 0, expected 204 and 1
 *
 * Nothing in that run's two merges touched `apps/` or `packages/` — they were a
 * bring-up script, docs and unit tests — and the same assertion had passed the
 * night before. It was not a regression. It was a coin flip that had been in
 * the gate since the block was written, finally landing tails.
 *
 * ## The three facts that make it one
 *
 *  1. The block DELIBERATELY grants twice for one address, because the search
 *     crossing organisations is the property it exists to prove.
 *  2. Granting writes `pending:${randomUUID()}` into `tenant_member`
 *     (`access-requests.ts`) — the person has no subject until they sign in. So
 *     the two rows carry the SAME email and DIFFERENT user_ids.
 *  3. `GET /api/support/people` orders by `m.email`. Two rows, one email: the
 *     ORDER BY cannot break that tie, and Postgres may return either first.
 *
 * Selecting the user on the address alone and then POSTing it against the FIRST
 * organisation's id therefore names a pair that exists only half the time.
 *
 * ## Why this is a gate defect and not a product one
 *
 * The 404 was correct. `(first organisation, second organisation's user)` is
 * not a person anybody can open, and the route said so. What was wrong is the
 * question the gate asked.
 *
 * It also made the NEGATIVE check next to it pass for the wrong reason: "a
 * non-operator cannot open a person" is satisfied by a 404, and a pair that
 * does not exist returns 404 whoever asks. A vacuous pass is the failure mode
 * this repository cares most about, so the fix is worth pinning rather than
 * just making.
 *
 * The expression is EXTRACTED FROM THE REAL SCRIPT and RUN against both
 * orderings, because the property is "picks this organisation's row whatever
 * order the rows arrive in" — which reading the source cannot demonstrate.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SMOKE = join(REPO_ROOT, 'deploy/compose/smoke-managed.sh');
const source = readFileSync(SMOKE, 'utf8');

/** The `found_user` selection, lifted out of the gate exactly as it runs. */
function selectionFilter(): string {
  const m = /found_user="\$\(jq -r[^']*'([^']+)'/.exec(source);
  expect(m, 'the found_user selection was not found in smoke-managed.sh').not.toBeNull();
  return m![1]!;
}

const EMAIL = 'smoke-grant-42@smoke.local';
const FIRST = '11111111-1111-1111-1111-111111111111';
const SECOND = '22222222-2222-2222-2222-222222222222';

/** One row per organisation, same person, different pending subjects. */
const inFirst = { email: EMAIL, tenant_id: FIRST, user_id: 'pending:aaaa' };
const inSecond = { email: EMAIL, tenant_id: SECOND, user_id: 'pending:bbbb' };
// Somebody else entirely, matching neither the address nor the organisation.
const stranger = { email: 'someone-else@smoke.local', tenant_id: FIRST, user_id: 'pending:cccc' };

function runFilter(people: unknown[]): string {
  return execFileSync(
    'jq',
    ['-r', '--arg', 'e', EMAIL, '--arg', 't', FIRST, selectionFilter()],
    { input: JSON.stringify({ people }), encoding: 'utf8' },
  ).trim();
}

describe('the gate opens the person in the organisation it is asking about', () => {
  it("picks this organisation's user when its row comes FIRST", () => {
    expect(runFilter([inFirst, inSecond])).toBe('pending:aaaa');
  });

  it("picks this organisation's user when its row comes SECOND — the tails case", () => {
    // THE HEADLINE. This is the ordering that took E2E (managed) #184 red, and
    // the ordering nothing in the query pins: `ORDER BY m.email` over two rows
    // carrying one email settles nothing.
    expect(runFilter([inSecond, inFirst])).toBe('pending:aaaa');
  });

  it('ignores a different person who happens to share the organisation', () => {
    expect(runFilter([stranger, inSecond, inFirst])).toBe('pending:aaaa');
  });

  it('answers empty rather than a wrong id when this organisation has no row', () => {
    // The caller guards on `-n "$found_user"` and reports "nobody to open".
    // Answering `null` here would POST the literal string "null" at the route.
    expect(runFilter([inSecond, stranger])).toBe('');
    expect(runFilter([])).toBe('');
  });

  it('the POST that follows is scoped to the SAME organisation it selected from', () => {
    // The pair is the whole point: selecting on the tenant and then posting to
    // a different one would reintroduce the bug with extra steps.
    expect(source).toMatch(
      /found_user="\$\(jq -r[\s\S]{0,400}?--arg t "\$new_tenant"[\s\S]{0,400}?\$\{new_tenant\}\/\$\{found_user\}\/opened/,
    );
  });
});
