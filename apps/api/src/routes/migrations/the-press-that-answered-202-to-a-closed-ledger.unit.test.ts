// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The press that answered 202 to a closed ledger.
 *
 * `POST /api/migrations/:mappingId/cutover` enqueued the preparation without
 * reading `cutover_state`. So a press on a cutover under way, or on a
 * finished ledger, was accepted with "on a PASSing verification the mapping
 * becomes READY_FOR_CUTOVER" — a promise the job broke minutes later, in a
 * Trigger.dev run nobody was watching — and a press on an APPROVED cutover
 * revoked the approval with a 202 that said nothing about it.
 *
 * This guard reads the route's source and pins the door: it asks
 * `prepareTransition` (the job's own rule) BEFORE it enqueues, answers 409
 * `cutover_refused` with the reason on a refusal, and says on a 202 what the
 * job will do. Source-level, like the guard ADR-0049 left on the update door:
 * the ordering is the property, and a mock cannot see order.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf-8');

const POST = (() => {
  const at = SOURCE.indexOf("router.post(\n  '/:mappingId/cutover',");
  expect(at).toBeGreaterThan(-1);
  const next = SOURCE.indexOf('\nrouter.', at + 1);
  return SOURCE.slice(at, next === -1 ? undefined : next);
})();

describe('the cutover door asks the ledger before it enqueues', () => {
  it('asks prepareTransition on the ledger it read, and only after the mapping was found to be the tenant\'s', () => {
    const mappingCheckAt = POST.indexOf("message: 'Mapping not found'");
    const readAt = POST.indexOf('loadCutoverState(');
    const askAt = POST.indexOf('prepareTransition(');
    expect(mappingCheckAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(mappingCheckAt);
    expect(askAt).toBeGreaterThan(readAt);
  });

  it('asks BEFORE anything is enqueued', () => {
    const askAt = POST.indexOf('prepareTransition(');
    const resolveAt = POST.indexOf('resolveCutoverJob(');
    const enqueueAt = POST.indexOf('.tasks.trigger(');
    expect(askAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeGreaterThan(askAt);
    expect(enqueueAt).toBeGreaterThan(askAt);
  });

  it('answers 409 cutover_refused with the reason, the hint, the stable code and the state', () => {
    expect(POST).toMatch(/status\(409\)[\s\S]{0,80}error: 'cutover_refused'/);
    const refusal = POST.slice(POST.indexOf("error: 'cutover_refused'"), POST.indexOf("error: 'cutover_refused'") + 300);
    for (const field of ['message: decision.refuse', 'hint: decision.hint', 'code: decision.code', 'state: decision.from']) {
      expect(refusal).toContain(field);
    }
  });

  it('returns on a refusal, so nothing is enqueued', () => {
    const refusalAt = POST.indexOf("error: 'cutover_refused'");
    const returnAt = POST.indexOf('return;', refusalAt);
    const enqueueAt = POST.indexOf('.tasks.trigger(');
    expect(returnAt).toBeGreaterThan(refusalAt);
    expect(returnAt).toBeLessThan(enqueueAt);
  });

  it('says on the 202 what the job will do: from where, whether it resets to PREPARING, whether an approval is revoked', () => {
    const accepted = POST.slice(POST.indexOf('status(202)'));
    expect(accepted).toContain('preparation,');
    for (const field of ['resetsToPreparing: decision.resetFirst', "revokesApproval: decision.from === 'APPROVED'"]) {
      expect(POST).toContain(field);
    }
  });

  it('reads the ledger through the tenant-scoped database, not a bare pool', () => {
    const read = POST.slice(POST.indexOf('withTenantDb(tenantId, pool, async (db) => {\n        const cutoverStore'));
    expect(read).toContain('new CutoverStore(db)');
  });
});
