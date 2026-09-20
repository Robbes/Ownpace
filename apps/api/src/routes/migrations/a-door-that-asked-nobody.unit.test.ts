// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOOR THAT ASKED NOBODY (ADR-0049, workplan 0101 T7).
 *
 * `PUT /api/migrations/:mappingId` accepted every status its schema named and
 * wrote it. `cutover` -> `active` went through here while `POST …/start`
 * refused it with the same predicate the appliance uses; `done` -> `paused`
 * went through while the rollback, the finish and Start all treat `done` as
 * terminal; `active` -> `done` skipped the unresolved-failures rule that
 * `POST …/finish` exists to apply. The table the route now asks lives in
 * `@openmig/shared` and has its own test; THIS one is a source-level guard in
 * the shape of `a-setting-the-route-dropped-in-silence`, for the same reason:
 * the mistake it prevents is an OMISSION. A handler that stopped asking
 * returns exactly what one that asks returns, for every body that is allowed —
 * which is every body the web sends today.
 *
 * The integration test beside this one drives the real route on Postgres.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf-8');

/** The PUT handler's text, from its route registration to the next one. */
const PUT = (() => {
  const at = SOURCE.indexOf("router.put(\n  '/:mappingId',");
  expect(at).toBeGreaterThan(-1);
  const next = SOURCE.indexOf('\nrouter.', at + 1);
  return SOURCE.slice(at, next === -1 ? undefined : next);
})();

describe('the update route asks the lifecycle before it writes', () => {
  it('asks shared, on the status read inside the same transaction', () => {
    expect(PUT).toContain('updateTransition(previousStatus, updateData.status)');
    // Inside the transaction, AFTER the in-transaction read of the current
    // status and BEFORE the write — a decision made on a status read outside
    // it could be made against a row that moved in between.
    const readAt = PUT.indexOf('const previousStatus = updateData.status');
    const askAt = PUT.indexOf('updateTransition(previousStatus, updateData.status)');
    const writeAt = PUT.indexOf('.update(schema.mailboxMapping)');
    expect(readAt).toBeGreaterThan(-1);
    expect(askAt).toBeGreaterThan(readAt);
    expect(writeAt).toBeGreaterThan(askAt);
  });

  it('answers 409 lifecycle_refused with the stable code and the hint that names the door', () => {
    expect(PUT).toMatch(/status\(409\)[\s\S]{0,120}lifecycle_refused/);
    const refusal = PUT.slice(PUT.indexOf("error: 'lifecycle_refused'"), PUT.indexOf("error: 'lifecycle_refused'") + 400);
    for (const field of ['message: outcome.refused.refuse', 'hint: outcome.refused.hint', 'code: outcome.refused.code']) {
      expect(refusal).toContain(field);
    }
  });

  it('returns out of the transaction on a refusal, so nothing is written', () => {
    // The refusal is a `return` before the update, not a check after it.
    const askAt = PUT.indexOf('updateTransition(previousStatus, updateData.status)');
    const writeAt = PUT.indexOf('.update(schema.mailboxMapping)');
    expect(PUT.slice(askAt, writeAt)).toContain("return { kind: 'refused', refused: transition");
  });

  it('still does not record a PATCH that restates the status — a request, not a transition', () => {
    // `updateTransition` answers `alreadySo` for from === to, and the route
    // keeps treating that as it did: the row is written (updatedAt), nothing
    // is recorded and no path moves. The helper drops the from === to record
    // itself, and this pins that the route did not grow a second opinion.
    expect(PUT).toContain('if (previousStatus !== updateData.status)');
  });
});
