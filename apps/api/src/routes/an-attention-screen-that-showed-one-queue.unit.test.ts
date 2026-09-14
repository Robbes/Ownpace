// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ATTENTION SCREEN THAT SHOWED ONE QUEUE OUT OF FIVE.
 *
 * The tab is labelled "Attention" (`nav.decisions`) and renders
 * `/api/decisions` — the drift queue — and nothing else. So an owner whose
 * weekly digest opened with
 *
 *     Migration: Gmail to Nextcloud
 *       - 34 items that could not be copied
 *
 * clicked the tab it pointed at and found it empty (owner report,
 * 2026-09-14). Neither half was broken on its own: the digest counted five
 * queues, the page read one, and nothing connected them.
 *
 * `GET /api/attention` is the read the page was missing, and the property
 * that matters is not "it returns numbers" — it is that the numbers are the
 * DIGEST's. Both call `summariseQueues`, so these tests pin the rules that
 * function applies, at the shape the route hands the screen:
 *
 *   - a failure still inside its retry budget is the machine's problem and is
 *     NOT counted; one that gave up is;
 *   - a deletion still being watched has not been established as real yet, so
 *     it is not waiting on anybody;
 *   - a `done` migration is skipped entirely — a finished migration keeps its
 *     history and stops nagging;
 *   - a queue that could not be READ is a blind spot carrying the reason, and
 *     the migration stays on screen because of it. "I found nothing" and "I
 *     could not look" arriving as the same empty page is how somebody decides
 *     a migration is finished when it is not.
 *
 * Tested through `summariseQueues` and `wantsAttention` rather than through
 * express, because those are what the route delegates to and what the digest
 * shares — a test of the wiring would pass while the counting drifted, which
 * is exactly the failure above.
 */

import { describe, it, expect } from 'vitest';
import {
  summariseQueues,
  wantsAttention,
  reportsToDigest,
  type DeletionRow,
  type MoveRow,
  type FailureRow,
  type QueueReads,
} from '@openmig/shared';
import {
  ATTENTION_MAPPINGS_SQL,
  collectTenantAttention,
  type AttentionReaders,
} from './attention.ts';

const MAPPING = { id: '0cc9a844-4075-4d65-a562-374df8299b77', name: 'Gmail to Nextcloud' };

function reads(over: Partial<QueueReads> = {}): QueueReads {
  return {
    deletions: [],
    moves: [],
    failures: [],
    pendingDecisions: 0,
    status: 'active',
    autoApplied: 0,
    sharingOpen: 0,
    blindSpots: [],
    ...over,
  };
}

const failure = (needsDecision: boolean): FailureRow => ({ needsDecision }) as FailureRow;
const deletion = (confirmed: boolean, acknowledgedAt?: string): DeletionRow =>
  ({ confirmed, ...(acknowledgedAt ? { acknowledgedAt } : {}) }) as DeletionRow;
const move = (acknowledgedAt?: string): MoveRow =>
  ({ ...(acknowledgedAt ? { acknowledgedAt } : {}) }) as MoveRow;

describe('the line the owner was looking for', () => {
  it('counts the failures that gave up, which is what the digest said', () => {
    // The reported shape: 34 waiting, on a migration whose Attention tab was
    // empty. One line, named, with the number the email carried.
    const m = summariseQueues(
      MAPPING,
      reads({ failures: Array.from({ length: 34 }, () => failure(true)) }),
    );
    expect(m.failuresWaiting).toBe(34);
    expect(m.name).toBe('Gmail to Nextcloud');
    expect(wantsAttention(m)).toBe(true);
  });

  it('does NOT count a failure still being retried', () => {
    // Still inside its budget: the tool is working on it and wants nobody.
    // Counting these would put a migration on an attention screen for
    // something nobody can help with, every fifteen minutes.
    const m = summariseQueues(MAPPING, reads({ failures: [failure(false), failure(false)] }));
    expect(m.failuresWaiting).toBe(0);
    expect(wantsAttention(m)).toBe(false);
  });

  it('counts a confirmed, unacknowledged deletion and no other kind', () => {
    const m = summariseQueues(
      MAPPING,
      reads({
        deletions: [
          deletion(true), // waiting
          deletion(false), // still being watched — not established as real
          deletion(true, '2026-09-01T00:00:00Z'), // already answered
        ],
      }),
    );
    expect(m.deletionsWaiting).toBe(1);
  });

  it('counts an unacknowledged move and no other kind', () => {
    const m = summariseQueues(MAPPING, reads({ moves: [move(), move('2026-09-01T00:00:00Z')] }));
    expect(m.movesWaiting).toBe(1);
  });

  it('says a verified migration is ready for its owner to finish', () => {
    expect(summariseQueues(MAPPING, reads({ status: 'cutover' })).readyForCutover).toBe(true);
    expect(summariseQueues(MAPPING, reads({ status: 'active' })).readyForCutover).toBe(false);
  });

  it('counts one tenant-wide decision ONCE, not once per migration', () => {
    // The route hands `pendingDecisions` to the first reportable mapping and
    // zero to the rest. A decision about a new mailbox belongs to no mapping,
    // so two migrations each claiming it would double it on the screen.
    const first = summariseQueues(MAPPING, reads({ pendingDecisions: 2 }));
    const second = summariseQueues({ id: 'other' }, reads({ pendingDecisions: 0 }));
    expect(first.pendingDecisions + second.pendingDecisions).toBe(2);
  });
});

describe('what the screen must NOT show', () => {
  it('omits a finished migration before it reads a single queue', () => {
    // `reportsToDigest` is the rule, and the route applies it BEFORE the
    // reads — four queries less per finished migration as well as no line.
    expect(reportsToDigest('done')).toBe(false);
    expect(reportsToDigest('active')).toBe(true);
    expect(reportsToDigest('cutover')).toBe(true);
    expect(reportsToDigest(undefined)).toBe(true);
  });

  it('leaves a quiet migration off, unless the caller asks for all of them', () => {
    // The default is the digest's rule. `?all=true` exists so a screen can
    // say "these four are quiet" rather than implying they do not exist.
    const quiet = summariseQueues(MAPPING, reads());
    expect(wantsAttention(quiet)).toBe(false);
  });

  it('does not let auto-applied removals put a migration on the screen', () => {
    // The route reports `autoApplied: 0` deliberately — it is news the digest
    // bounds by the window since the last one, and a page has no window. A
    // migration whose only news is "3 old copies removed automatically" would
    // otherwise sit on an attention screen for ever, asking for nothing.
    const asTheRouteReportsIt = summariseQueues(MAPPING, reads({ autoApplied: 0 }));
    expect(wantsAttention(asTheRouteReportsIt)).toBe(false);
    // …and the proof that the zero is doing work: unzeroed, it would show.
    expect(wantsAttention(summariseQueues(MAPPING, reads({ autoApplied: 3 })))).toBe(true);
  });
});

describe('a queue that could not be read is not an empty queue', () => {
  it('keeps the migration on screen, carrying the reason verbatim', () => {
    const m = summariseQueues(
      MAPPING,
      reads({ blindSpots: ['the failures queue: connection terminated unexpectedly'] }),
    );
    expect(m.blindSpots).toEqual(['the failures queue: connection terminated unexpectedly']);
    // Nothing is waiting as far as the counts go — and it still shows, because
    // the counts are not trustworthy. An empty page here would say "you are
    // done" about a queue nobody managed to look at.
    expect(m.failuresWaiting).toBe(0);
    expect(wantsAttention(m)).toBe(true);
  });
});

describe('the query names the column the digest forgot', () => {
  it('selects `name`, so the screen can label a migration the way its owner does', () => {
    // The digest shipped with `SELECT id, status` and printed a UUID at every
    // owner for want of this column (#946). Pinned rather than trusted,
    // because a route's own tests would stay green while every label on the
    // screen went back to a UUID.
    expect(ATTENTION_MAPPINGS_SQL).toContain('name');
    expect(ATTENTION_MAPPINGS_SQL).toContain('status');
    expect(ATTENTION_MAPPINGS_SQL).toContain('tenant_id = $1');
  });
});

describe('the collector, on the rules a screen full of migrations depends on', () => {
  const readers = (over: Partial<AttentionReaders> = {}): AttentionReaders => ({
    deletions: async () => [],
    moves: async () => [],
    failures: async () => [],
    sharingOpen: async () => 0,
    pendingDecisions: async () => 0,
    ...over,
  });

  const row = (id: string, status = 'active', name: string | null = null) => ({ id, name, status });

  it('asks the decision queue ONCE across three migrations', async () => {
    // The bug this forbids: three migrations, one drift decision, and a
    // screen that says three. Counted once, on the first that reports.
    let asked = 0;
    const out = await collectTenantAttention(
      [row('a'), row('b'), row('c')],
      readers({
        pendingDecisions: async () => {
          asked++;
          return 2;
        },
      }),
    );
    expect(asked).toBe(1);
    expect(out.map((m) => m.pendingDecisions)).toEqual([2, 0, 0]);
  });

  it('skips a finished migration WITHOUT reading any of its queues', async () => {
    const touched: string[] = [];
    const out = await collectTenantAttention(
      [row('done-one', 'done'), row('live-one', 'active')],
      readers({
        failures: async (id) => {
          touched.push(id);
          return [];
        },
      }),
    );
    expect(out.map((m) => m.mappingId)).toEqual(['live-one']);
    expect(touched, 'a finished migration must cost four queries less, not four more').toEqual([
      'live-one',
    ]);
  });

  it('turns a read that THREW into a blind spot, naming the queue and the reason', async () => {
    const out = await collectTenantAttention(
      [row('m')],
      readers({
        failures: async () => {
          throw new Error('connection terminated unexpectedly');
        },
      }),
    );
    expect(out[0]?.blindSpots).toEqual([
      'the failures queue: connection terminated unexpectedly',
    ]);
    // And the other queues were still read — one broken queue must not take
    // the rest of the migration's counts down with it.
    expect(out[0]?.failuresWaiting).toBe(0);
    expect(wantsAttention(out[0]!)).toBe(true);
  });

  it('keeps going after one migration is unreadable, rather than losing the rest', async () => {
    const out = await collectTenantAttention(
      [row('broken'), row('fine')],
      readers({
        moves: async (id) => {
          if (id === 'broken') throw new Error('no');
          return [move()];
        },
      }),
    );
    expect(out).toHaveLength(2);
    expect(out[1]?.movesWaiting).toBe(1);
  });

  it('reports autoApplied as zero whatever else it found', async () => {
    const out = await collectTenantAttention([row('m')], readers());
    expect(out[0]?.autoApplied).toBe(0);
  });

  it('carries the name through, so the screen can label it as its owner does', async () => {
    const out = await collectTenantAttention([row('m', 'active', 'Gmail to Nextcloud')], readers());
    expect(out[0]?.name).toBe('Gmail to Nextcloud');
  });
});
