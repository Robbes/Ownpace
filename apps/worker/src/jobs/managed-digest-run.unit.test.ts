// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The managed digest loop (workplan 0030 T4).
 *
 * This loop sends email to other people's customers, and nearly every rule in
 * it is a rule about NOT sending, or about not sending the wrong thing to the
 * wrong people. So it is tested here in milliseconds rather than left to a
 * hope that the integration suite happens to cover it.
 *
 * The reads are fakes on purpose: what is under test is the DECISIONS —
 * whose day it is, who is asked, what a failed read means, and what happens
 * when one tenant's mail server is down. What the queries themselves return
 * is the ledger's business and the ledger's tests.
 */

import { describe, it, expect, vi } from 'vitest';
import { runDigest, type DigestDeps } from './managed-digest-run';

const MONDAY = 1;
const THURSDAY = 4;

/** A tenant with one active mapping and one item waiting in the moves queue. */
function deps(overrides: Partial<DigestDeps> = {}): DigestDeps & { sent: SentMail[] } {
  const sent: SentMail[] = [];
  const base: DigestDeps & { sent: SentMail[] } = {
    sent,
    weekday: MONDAY,
    listTenants: async () => [
      { id: 't-1', name: 'Acme BV', settings: { notifications: { digest: 'daily', locale: 'en' } } },
    ],
    listRecipients: async () => ['owner@acme.nl'],
    listMappings: async () => [{ id: 'm-1', status: 'active' }],
    listDeletions: async () => [],
    listMoves: async () => [{}],
    listFailures: async () => [],
    countPendingDecisions: async () => 0,
    send: async (to, locale, message) => {
      sent.push({ to: [...to], locale, message });
    },
    warn: () => {},
    error: () => {},
    ...overrides,
  };
  return base;
}

interface SentMail {
  readonly to: string[];
  readonly locale: string;
  readonly message: { subject: string; body: string };
}

describe('whose day it is', () => {
  it('sends to a daily tenant on any day', async () => {
    const d = deps({ weekday: THURSDAY });
    const summary = await runDigest(d);
    expect(summary.sent).toBe(1);
  });

  it('skips a weekly tenant on a Thursday and sends on Monday', async () => {
    const weekly = {
      id: 't-1',
      name: 'Acme BV',
      settings: { notifications: { digest: 'weekly', locale: 'en' } },
    };
    const thursday = deps({ weekday: THURSDAY, listTenants: async () => [weekly] });
    expect(await runDigest(thursday)).toMatchObject({ sent: 0, notDue: 1 });

    const monday = deps({ weekday: MONDAY, listTenants: async () => [weekly] });
    expect(await runDigest(monday)).toMatchObject({ sent: 1, notDue: 0 });
  });

  it('never reads a queue for a tenant that is not due', async () => {
    // Not just "does not send": a tenant who turned the summary off should
    // not have their ledger walked every morning either.
    const listMappings = vi.fn(async () => []);
    const d = deps({
      listTenants: async () => [
        { id: 't-1', name: 'Off BV', settings: { notifications: { digest: 'off' } } },
      ],
      listMappings,
    });
    await runDigest(d);
    expect(listMappings).not.toHaveBeenCalled();
  });
});

describe('who is asked', () => {
  it('sends to every active owner and admin', async () => {
    const d = deps({ listRecipients: async () => ['owner@acme.nl', 'admin@acme.nl'] });
    await runDigest(d);
    expect(d.sent[0]?.to).toEqual(['owner@acme.nl', 'admin@acme.nl']);
  });

  it('says so LOUDLY when a due tenant has nobody to tell', async () => {
    const warn = vi.fn();
    const d = deps({ listRecipients: async () => [], warn });
    const summary = await runDigest(d);

    expect(summary).toMatchObject({ sent: 0, noRecipients: 1 });
    // A tenant whose last owner was removed is an operator problem, not a
    // quiet no-op that nobody ever hears about.
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('no active owner or admin');
    expect(d.sent).toHaveLength(0);
  });

  it('sends in the tenant’s own language', async () => {
    const d = deps({
      listTenants: async () => [
        { id: 't-1', name: 'Acme BV', settings: { notifications: { digest: 'daily', locale: 'nl' } } },
      ],
    });
    await runDigest(d);
    expect(d.sent[0]?.locale).toBe('nl');
    expect(d.sent[0]?.message.subject).toContain('aandacht');
  });
});

describe('nothing waiting means no email', () => {
  it('sends nothing when every queue is empty', async () => {
    const d = deps({ listMoves: async () => [] });
    const summary = await runDigest(d);

    // Silence IS the signal. A daily "all clear" trains its reader to delete
    // the channel unopened, taking the one that mattered with it.
    expect(summary).toMatchObject({ sent: 0, quiet: 1 });
    expect(d.sent).toHaveLength(0);
  });

  it('does not count a finished migration as waiting', async () => {
    const d = deps({ listMappings: async () => [{ id: 'm-1', status: 'done' }] });
    const summary = await runDigest(d);
    expect(summary).toMatchObject({ sent: 0, quiet: 1 });
  });

  it('never reads the queues of a finished migration', async () => {
    const listMoves = vi.fn(async () => []);
    const d = deps({ listMappings: async () => [{ id: 'm-1', status: 'done' }], listMoves });
    await runDigest(d);
    expect(listMoves).not.toHaveBeenCalled();
  });
});

describe('a blind spot is never a zero (hard rule 9)', () => {
  it('sends even when every count is zero, naming what could not be read', async () => {
    const d = deps({
      listMoves: async () => {
        throw new Error('connection terminated unexpectedly');
      },
      listDeletions: async () => [],
    });
    const summary = await runDigest(d);

    expect(summary.sent).toBe(1);
    // The database's own words, verbatim: "I found nothing" and "I could not
    // look" must not arrive as the same email.
    expect(d.sent[0]?.message.body).toContain('connection terminated unexpectedly');
    expect(d.sent[0]?.message.body).toContain('the moves queue');
  });

  it('treats an unreadable decision queue the same way', async () => {
    const d = deps({
      listMoves: async () => [],
      countPendingDecisions: async () => {
        throw new Error('permission denied for table decision');
      },
    });
    const summary = await runDigest(d);

    expect(summary.sent).toBe(1);
    expect(d.sent[0]?.message.body).toContain('permission denied for table decision');
  });

  it('carries on with the other queues after one read fails', async () => {
    const d = deps({
      listDeletions: async () => {
        throw new Error('boom');
      },
      listMoves: async () => [{}, {}],
    });
    await runDigest(d);
    // The moves that COULD be read are still counted; a failure in one queue
    // does not blank the mapping.
    expect(d.sent[0]?.message.body).toContain('2');
    expect(d.sent[0]?.message.body).toContain('boom');
  });
});

describe('tenants are separate', () => {
  it('counts a pending decision once per tenant, not once per mapping', async () => {
    const countPendingDecisions = vi.fn(async () => 3);
    const d = deps({
      listMappings: async () => [
        { id: 'm-1', status: 'active' },
        { id: 'm-2', status: 'active' },
      ],
      countPendingDecisions,
    });
    await runDigest(d);

    // Once per TENANT: a new mailbox belongs to no mapping yet, and two
    // mappings each claiming the same three decisions would report six.
    expect(countPendingDecisions).toHaveBeenCalledTimes(1);
    expect(d.sent[0]?.message.body).not.toContain('6');
  });

  it('gives each tenant its own email, read with its own credentials', async () => {
    const d = deps({
      listTenants: async () => [
        { id: 't-1', name: 'A', settings: { notifications: { digest: 'daily', locale: 'en' } } },
        { id: 't-2', name: 'B', settings: { notifications: { digest: 'daily', locale: 'nl' } } },
      ],
      listRecipients: async (tenantId) => [`owner@${tenantId}.nl`],
    });
    const summary = await runDigest(d);

    expect(summary.sent).toBe(2);
    expect(d.sent[0]?.to).toEqual(['owner@t-1.nl']);
    expect(d.sent[1]?.to).toEqual(['owner@t-2.nl']);
    expect(d.sent[1]?.locale).toBe('nl');
  });

  it('keeps going — and does not count a refused send as sent', async () => {
    const error = vi.fn();
    const d = deps({
      listTenants: async () => [
        { id: 't-1', name: 'A', settings: { notifications: { digest: 'daily' } } },
        { id: 't-2', name: 'B', settings: { notifications: { digest: 'daily' } } },
      ],
      send: async (to) => {
        if (to[0]?.includes('t-1')) throw new Error('550 relay denied');
        return;
      },
      listRecipients: async (tenantId) => [`owner@${tenantId}.nl`],
      error,
    });
    const summary = await runDigest(d);

    // One tenant's mail server refusing must not cost the other tenant its
    // digest, and the failure is stated rather than counted as a success.
    expect(summary).toMatchObject({ tenants: 2, sent: 1, failed: 1 });
    expect(error).toHaveBeenCalledOnce();
  });

  it('reports a tenant with no mappings as quiet, not as sent', async () => {
    const d = deps({ listMappings: async () => [] });
    expect(await runDigest(d)).toMatchObject({ sent: 0, quiet: 1 });
  });
});

describe('a decision with nowhere to go', () => {
  // CHANGED DELIBERATELY, 0043 T4. This block used to assert that a decision
  // belonging to a tenant with no live mapping was written to the OPERATOR'S
  // LOG — 0030 T4's own recorded hole, and honest about being one. The log is
  // not where the person who has to answer the decision is looking, so the
  // digest grew a tenant-level section and the decision is now EMAILED.
  //
  // The old assertions are replaced rather than deleted: the property they
  // protected — a pending decision must not vanish — is stronger here, because
  // reaching the owner is a higher bar than reaching a log file.

  it('is EMAILED to the tenant, not merely logged', async () => {
    const warn = vi.fn();
    const sends: Array<{ to: readonly string[]; body: string }> = [];
    const d = deps({
      listMappings: async () => [{ id: 'm-1', status: 'done' }],
      countPendingDecisions: async () => 2,
      warn,
      send: async (to, _locale, message) => {
        sends.push({ to, body: message.body });
      },
    });
    const summary = await runDigest(d);

    expect(summary, 'the tenant is sent to, not counted as quiet').toMatchObject({
      sent: 1,
      quiet: 0,
    });
    expect(sends).toHaveLength(1);
    // The count reaches the reader, under a heading that is not a migration.
    expect(sends[0]!.body).toContain('2');
    expect(sends[0]!.body).toContain('Your organisation');
    // And it does NOT invent a mapping row nobody can open — the thing 0030 T4
    // refused to do, and the reason it left the hole open instead.
    expect(sends[0]!.body).not.toContain('m-1');
  });

  it('carries a decision-queue blind spot to the tenant too', async () => {
    // "I could not look" must not be reported as "nothing is waiting" — the
    // rule the whole channel is built on (rule 9), now honoured on this path.
    const sends: string[] = [];
    const d = deps({
      listMappings: async () => [{ id: 'm-1', status: 'done' }],
      countPendingDecisions: async () => {
        throw new Error('decision table unreachable');
      },
      send: async (_to, _locale, message) => {
        sends.push(message.body);
      },
    });
    const summary = await runDigest(d);

    expect(summary).toMatchObject({ sent: 1 });
    expect(sends[0]).toContain('decision table unreachable');
  });

  it('stays quiet when there is genuinely nothing pending', async () => {
    const warn = vi.fn();
    const d = deps({
      listMappings: async () => [{ id: 'm-1', status: 'done' }],
      countPendingDecisions: async () => 0,
      warn,
    });
    await runDigest(d);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('an unreadable preference', () => {
  it('falls back to the default rather than to silence', async () => {
    // Weekly by default, so this Monday run sends. A hand-edited row must not
    // be why somebody stops hearing about their own migration.
    const d = deps({
      weekday: MONDAY,
      listTenants: async () => [
        { id: 't-1', name: 'Acme BV', settings: { notifications: { digest: 'fortnightly' } } },
      ],
    });
    expect(await runDigest(d)).toMatchObject({ sent: 1 });
  });
});
