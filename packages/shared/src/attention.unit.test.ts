// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The digest counts what the screens count (workplan 0030 T3).
 *
 * These tests exist because of a specific failure: a summary that says four
 * things are waiting, pointing at a queue that shows three. The owner goes
 * looking for the fourth, does not find it, and stops trusting the email —
 * at which point the whole channel is worth nothing. So the filters are
 * pinned here as the same expressions the queue endpoints use.
 *
 * The other half is hard rule 9: a queue that could not be read must not
 * become a zero. `wantsAttention` then sends on the blind spot alone, so
 * "I could not look" never arrives as silence.
 */

import { describe, it, expect } from 'vitest';
import {
  wantsAttention,
  summariseQueues,
  reportsToDigest,
  type QueueReads,
} from './notifications.ts';

const EMPTY: QueueReads = {
  deletions: [],
  moves: [],
  failures: [],
  pendingDecisions: 0,
  status: 'shadow',
  blindSpots: [],
};

describe('what counts as waiting on a person', () => {
  it('counts a confirmed, unacknowledged deletion', () => {
    const summary = summariseQueues('m', {
      ...EMPTY,
      deletions: [{ confirmed: true }],
    });
    expect(summary.deletionsWaiting).toBe(1);
  });

  it('does NOT count a deletion still being watched', () => {
    // Unconfirmed means the ledger has not established the source item is
    // really gone. Reporting it would ask the owner to decide about something
    // that may simply not have synced yet.
    const summary = summariseQueues('m', {
      ...EMPTY,
      deletions: [{ confirmed: false }],
    });
    expect(summary.deletionsWaiting).toBe(0);
  });

  it('does NOT count a deletion that was already answered', () => {
    const summary = summariseQueues('m', {
      ...EMPTY,
      deletions: [{ confirmed: true, acknowledgedAt: '2026-08-01T10:00:00Z' }],
    });
    expect(summary.deletionsWaiting).toBe(0);
  });

  it('counts unacknowledged moves only', () => {
    const summary = summariseQueues('m', {
      ...EMPTY,
      moves: [{}, { acknowledgedAt: '2026-08-01T10:00:00Z' }, {}],
    });
    expect(summary.movesWaiting).toBe(2);
  });

  it('counts only failures that gave up retrying', () => {
    // A failure still inside its retry budget is the machine's problem. The
    // owner hears about it when the machine has run out of ideas.
    const summary = summariseQueues('m', {
      ...EMPTY,
      failures: [{ needsDecision: true }, { needsDecision: false }, { needsDecision: true }],
    });
    expect(summary.failuresWaiting).toBe(2);
  });

  it('carries the tenant-level decision count through unchanged', () => {
    expect(summariseQueues('m', { ...EMPTY, pendingDecisions: 3 }).pendingDecisions).toBe(3);
  });

  it('flags a mapping sitting in cutover, and no other status', () => {
    expect(summariseQueues('m', { ...EMPTY, status: 'cutover' }).readyForCutover).toBe(true);
    expect(summariseQueues('m', { ...EMPTY, status: 'shadow' }).readyForCutover).toBe(false);
    expect(summariseQueues('m', { ...EMPTY, status: undefined }).readyForCutover).toBe(false);
  });

  it('is quiet when a mapping is genuinely quiet', () => {
    expect(wantsAttention(summariseQueues('m', EMPTY))).toBe(false);
  });
});

describe('a blind spot is not a zero (hard rule 9)', () => {
  it('keeps the server’s own words rather than a count', () => {
    const summary = summariseQueues('m', {
      ...EMPTY,
      blindSpots: ['the moves queue: connection terminated unexpectedly'],
    });
    expect(summary.blindSpots).toEqual(['the moves queue: connection terminated unexpectedly']);
  });

  it('makes an otherwise empty mapping worth an email', () => {
    // Every count is zero. Without the blind spot this mapping would be left
    // out of the digest entirely, and the owner would read "nothing needs
    // attention" from a summary that could not look.
    const blind = summariseQueues('m', { ...EMPTY, blindSpots: ['the decision queue: timeout'] });
    expect(wantsAttention(blind)).toBe(true);
  });

  it('omits the field entirely when everything could be read', () => {
    // Absent rather than an empty array: `wantsAttention` and the renderer
    // both branch on presence, and an empty array that reads as "there were
    // blind spots" would send a daily email about nothing.
    expect(summariseQueues('m', EMPTY).blindSpots).toBeUndefined();
  });
});

describe('a finished migration stops nagging', () => {
  it('leaves a done mapping out of the digest', () => {
    expect(reportsToDigest('done')).toBe(false);
  });

  it('keeps reporting every other state, including one it could not read', () => {
    for (const status of ['shadow', 'cutover', 'active', 'paused', undefined]) {
      // Unknown status is deliberately NOT treated as done: the mapping whose
      // status could not be read is exactly the one worth mentioning.
      expect(reportsToDigest(status)).toBe(true);
    }
  });
});
