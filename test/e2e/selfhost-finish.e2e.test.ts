// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// The end of a migration, against the real appliance.
//
// `POST /mappings/{id}/finish` is the terminal action of the whole product and
// the last operating endpoint with no e2e coverage. It is not destructive —
// nothing is added to or removed from either side — but it is *irreversible
// from the UI*: the mapping stops being scheduled, so copying stops and so does
// drift, deletion and move reporting. "What is on the target now is what stays."
//
// ## Why this file runs LAST, and alone
//
// Finishing unschedules the mapping. Every other gate needs it scheduled. So
// this cannot share a `pnpm test:e2e` invocation with anything — vitest gives
// no ordering guarantee across files — and e2e.yml runs it as its own step
// after the apply-deletion gate.
//
// ## Why the workflow re-plants a poison file first
//
// The interesting half of finish is the REFUSAL: §11.2 says a migration must
// not be quietly closed over items that are still awaiting a decision, because
// that turns "still working on it" into "this is what you got" without anyone
// saying so. Proving the refusal needs an item in that state, and by the time
// this step runs the restart-resume gate has already accepted the original one.
// So the workflow plants a second poison file and waits for a pass to fail it.
//
// The `?force=true` branch — finishing anyway, and reporting `leftUnmigrated`
// as the number that says what the customer did not get — is deliberately NOT
// exercised here. It is a pure decision in `finishTransition` with unit
// coverage, and taking it would consume the one mapping this stack has, at the
// cost of the path an operator actually walks.

import { describe, it, expect, beforeAll } from 'vitest';

const PORT = process.env.SELFHOST_PORT || '8081';
const BIND = process.env.SELFHOST_BIND || '127.0.0.1';
const BASE = `http://${BIND}:${PORT}`;
const WAIT_MS = Number(process.env.E2E_WAIT_MS || 200_000);

/** The config mappingId, which is what the HTTP surface is keyed by. */
const MAPPING = process.env.E2E_MAPPING_ID || '11111111-1111-4111-8111-111111111111';

interface Failure {
  readonly naturalKeyHash: string;
  readonly needsDecision?: boolean;
}
interface FailuresQueue {
  readonly migrationStatus: string;
  readonly reportingClosed?: string;
  readonly needsDecision: Failure[];
}

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, init);
  return { status: res.status, body: (await res.json()) as T };
}

async function statusOf(mappingId: string): Promise<string | undefined> {
  const { body } = await json<{ mappings: Array<{ mappingId: string; migrationStatus: string }> }>(
    '/status',
  );
  return body.mappings.find((m) => m.mappingId === mappingId)?.migrationStatus;
}

/** Poll until at least one failure is awaiting a decision, or give up loudly. */
async function waitForUnresolved(): Promise<Failure[]> {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const { body } = await json<Record<string, FailuresQueue>>('/failures');
    const seen = body[MAPPING]?.needsDecision ?? [];
    if (seen.length > 0) return seen;
    if (Date.now() > until) {
      throw new Error(
        `no failure is awaiting a decision after ${WAIT_MS}ms, so the refusal below ` +
          `would pass vacuously. The workflow plants a second poison file before this ` +
          `step — check that step, and that a pass has run since.\n` +
          `NOTE: "awaiting a decision" needs MAX_ITEM_ATTEMPTS (5) failed attempts, not ` +
          `one. The plant step drives five explicit passes for exactly this reason; if ` +
          `it was changed back to one, this wait is left depending on the every-minute ` +
          `cron delivering four more inside ${WAIT_MS}ms — which fits only three.`,
      );
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

let unresolvedCount = 0;

beforeAll(async () => {
  unresolvedCount = (await waitForUnresolved()).length;
}, 240_000);

describe('finishing a migration', () => {
  it('refuses while an item is still awaiting a decision, and says how many', async () => {
    // The whole point of the gate. A migration closed over an open decision is
    // a customer told "this is what you got" by omission.
    const { status, body } = await json<{ error: string; hint?: string }>(
      `/mappings/${encodeURIComponent(MAPPING)}/finish`,
      { method: 'POST' },
    );
    expect(status).toBe(409);
    expect(body.error).toMatch(new RegExp(`${unresolvedCount} item\\(s\\)`));
    expect(body.error).toMatch(/awaiting a decision/i);
    // And it must point at the way out, or an operator is simply stuck.
    expect(`${body.error} ${body.hint ?? ''}`).toMatch(/force|accept|decide|resolve/i);
  }, 60_000);

  it('still syncs — a refused finish changed nothing', async () => {
    expect(await statusOf(MAPPING)).toBe('active');
  }, 30_000);

  it('accepts once the queue is clear, and says what it did', async () => {
    // Resolve every outstanding decision the honest way: accept them, which
    // records them as knowingly left behind rather than pretending they copied.
    for (const f of await waitForUnresolved()) {
      const { status } = await json(
        `/mappings/${encodeURIComponent(MAPPING)}/failures/${encodeURIComponent(f.naturalKeyHash)}/accept`,
        { method: 'POST' },
      );
      expect(status, `accepting ${f.naturalKeyHash.slice(0, 12)}`).toBe(200);
    }

    const { status, body } = await json<{
      status: string;
      action: string;
      mappingId?: string;
      leftUnmigrated?: number;
      effect: string;
      ifYouNeedToResume?: string;
    }>(`/mappings/${encodeURIComponent(MAPPING)}/finish`, { method: 'POST' });

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', action: 'finish', mappingId: MAPPING });
    // No `leftUnmigrated`: the queue was cleared by DECISION, not stepped over.
    // Reporting a count here would say the customer lost items they did not.
    expect(body.leftUnmigrated).toBeUndefined();
    // The prose is the contract (ADR-0026) — it is what tells an owner that
    // nothing moved on either side, which is the part people get wrong.
    expect(body.effect).toMatch(/no longer syncs/i);
    expect(body.effect).toMatch(/nothing was added to or removed from the target/i);
    expect(body.ifYouNeedToResume).toBeTruthy();
  }, 120_000);

  it('actually stopped the migration, rather than answering as if it had', async () => {
    // The assertion that separates "returned 200" from "did the thing".
    expect(await statusOf(MAPPING)).toBe('done');
  }, 30_000);

  it('closes the queues rather than leaving them nagging', async () => {
    // A finished migration keeps its history and stops asking for decisions.
    for (const path of ['/failures', '/moves', '/deletions']) {
      const { body } = await json<Record<string, FailuresQueue>>(path);
      expect(body[MAPPING]?.migrationStatus, path).toBe('done');
      expect(body[MAPPING]?.reportingClosed, path).toBeTruthy();
    }
  }, 30_000);

  it('is idempotent, and says so rather than pretending it did work again', async () => {
    const { status, body } = await json<{ alreadyDone?: boolean; effect: string }>(
      `/mappings/${encodeURIComponent(MAPPING)}/finish`,
      { method: 'POST' },
    );
    expect(status).toBe(200);
    expect(body.alreadyDone).toBe(true);
    expect(body.effect).toMatch(/already finished/i);
  }, 30_000);
});
