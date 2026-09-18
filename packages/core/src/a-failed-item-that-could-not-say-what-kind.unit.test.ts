// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAILED ITEM SAYS WHAT KIND OF FAILURE IT WAS, AND WHICH SIDE IT CAME FROM.
 *
 * The gap the owner named on 2026-09-17: `migration_status.last_error_category`
 * has given the DOMAIN level a remedy in the customer's own language since
 * migration 0033 — *"this is an expired credential, reconnect the account"* —
 * and `item.last_error_category` did not exist at all. So a migration where one
 * domain stops explains itself, and one where nine hundred items succeed and
 * three fail shows the provider's English with no remedy in any language.
 *
 * That is backwards. A domain-level failure is rare and usually obvious. An
 * item-level one is the common case, it is what the failures queue is FOR, and
 * it is what somebody is looking at when they ask what to do.
 *
 * ## What this holds, and the one that matters
 *
 * **A source refusal and a target refusal read identically.** A 403 from a
 * Drive whose owner disabled downloading and a 403 from a read-only Nextcloud
 * folder are the same string, and no amount of matching on the wording can
 * separate them — which is the whole finding of migration 0048, one level up.
 * The pass knows, because `sided()` tags what the SOURCE closure throws and
 * what the TARGET closure throws at the closure itself, and `failureSideOf`
 * reads the tag off the thrown value.
 *
 * So the headline here is two passes that differ in NOTHING but which closure
 * throws, with byte-identical messages, landing as different categories. Get
 * that wrong and a customer is sent to audit a destination that was never sent
 * the file — which is exactly the live defect 0048 was written about.
 *
 * The rest is the contract around it: the category is derived where the prose
 * is written so the two cannot disagree, and a row that has none says so rather
 * than claiming `unknown`, which is a real classification meaning "we looked
 * and could not tell".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  setLogLevel,
  resetLogLevel,
  FAILURE_CATEGORIES,
  markNeedsDecision,
  withFailureCategory,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('be490000-e29b-41d4-a716-4466554409aa');
const MAPPING = asMappingId('be490000-e29b-41d4-a716-4466554409bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

interface Item {
  id: string;
  body: string;
}

const CARD: Item = { id: 'c0ffee00-1111-4222-8333-444455556666', body: 'BEGIN:VCARD' };
const keyOf = (id: string) => `hash:${id}`;

/**
 * THE SAME SENTENCE, thrown from one side or the other.
 *
 * Deliberately a real-shaped 403 and deliberately one string: if the two passes
 * below used different wording, this file would prove that the classifier reads
 * words, which it does and which is not the point.
 */
const REFUSAL = 'HTTP 403: The caller does not have permission';

/** One pass over one item, failing on whichever side the caller chooses. */
function onePass(ledger: MemoryLedger, fails: 'source' | 'target') {
  return runDomainSync<unknown, unknown, Item, { path: string }>({
    sourceIsAuthorityOnExistence: true,
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'contact',
    source: {},
    target: {},
    ledger,
    listFolders: async () => [{ path: 'Contacts' }],
    listSince: async () => ({ items: [CARD], nextCursor: { value: '1' } }),
    fetchRaw: async (i) => {
      if (fails === 'source') throw new Error(REFUSAL);
      return { raw: i.body, sizeBytes: i.body.length };
    },
    upsert: async (): Promise<UpsertResult> => {
      if (fails === 'target') throw new Error(REFUSAL);
      return { targetId: 't', created: true };
    },
    naturalKey: (i) => keyOf(i.id),
    contentHash: (raw) => `h:${raw as string}`,
    ensureCollection: async (f) => f.path,
  });
}

/**
 * The same pass, failing on the SOURCE with a thrown value the caller supplies.
 *
 * Separate from `onePass` because that one owns its error on purpose — the
 * headline above depends on both sides throwing one identical string, and a
 * parameter there would let a later edit weaken it without anybody noticing.
 */
function passRefusing(ledger: MemoryLedger, thrown: unknown) {
  return runDomainSync<unknown, unknown, Item, { path: string }>({
    sourceIsAuthorityOnExistence: true,
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'contact',
    source: {},
    target: {},
    ledger,
    listFolders: async () => [{ path: 'Contacts' }],
    listSince: async () => ({ items: [CARD], nextCursor: { value: '1' } }),
    fetchRaw: async () => {
      throw thrown;
    },
    upsert: async (): Promise<UpsertResult> => ({ targetId: 't', created: true }),
    naturalKey: (i) => keyOf(i.id),
    contentHash: (raw) => `h:${raw as string}`,
    ensureCollection: async (f) => f.path,
  });
}

const onlyFailure = async (ledger: MemoryLedger) => {
  const failures = await ledger.listFailures(TENANT, MAPPING);
  expect(failures).toHaveLength(1);
  return failures[0]!;
};

describe('the same refusal, from two sides', () => {
  it('reads source_refused when the SOURCE closure threw', async () => {
    const ledger = new MemoryLedger();
    await onePass(ledger, 'source');
    const failure = await onlyFailure(ledger);
    expect(failure.category).toBe('source_refused');
    // And the prose is untouched, because a category is a summary and the
    // operator still has to be able to tell a 403 from a 507.
    expect(failure.lastError).toContain(REFUSAL);
  });

  it('reads target_refused when the TARGET closure threw the IDENTICAL message', async () => {
    // THE HEADLINE. Nothing differs between these two passes but which closure
    // raises, and the message is the same string in both. A classifier reading
    // the words could not tell them apart, and the remedy it would print —
    // "check your destination for a full mailbox or a read-only folder" —
    // would send somebody to audit an account that was never written to.
    const ledger = new MemoryLedger();
    await onePass(ledger, 'target');
    const failure = await onlyFailure(ledger);
    expect(failure.category).toBe('target_refused');
    expect(failure.lastError).toContain(REFUSAL);
  });

  it('does not use the message to decide, and this is the proof', async () => {
    // Stated as its own assertion because the two above pass individually for
    // the wrong reason if they ever stop sharing a message. They share one.
    const fromSource = new MemoryLedger();
    const fromTarget = new MemoryLedger();
    await onePass(fromSource, 'source');
    await onePass(fromTarget, 'target');
    const a = await onlyFailure(fromSource);
    const b = await onlyFailure(fromTarget);
    expect(a.lastError).toBe(b.lastError);
    expect(a.category).not.toBe(b.category);
  });
});

describe('the category is written with the prose, never derived later', () => {
  it('lands on the row the first time the item fails', async () => {
    // Not on a later read, not on a second pass: one statement writes both, so
    // a screen reading the row at any moment cannot see prose with no category
    // beside it.
    const ledger = new MemoryLedger();
    await onePass(ledger, 'target');
    const row = await ledger.find(TENANT, MAPPING, 'contact', keyOf(CARD.id));
    expect(row?.lastError).toContain(REFUSAL);
    expect(row?.lastErrorCategory).toBe('target_refused');
  });

  it('is one of the categories the screens have a sentence for', async () => {
    // The vocabulary is `text` with no CHECK, so nothing in the database stops
    // a value the UI cannot render. This is what does.
    const ledger = new MemoryLedger();
    await onePass(ledger, 'source');
    const failure = await onlyFailure(ledger);
    expect(FAILURE_CATEGORIES).toContain(failure.category);
  });

  it('re-classifies on a later attempt rather than keeping the first answer', async () => {
    // An item that failed on the source and then fails on the target has a
    // different problem, and a row carrying the first category would send the
    // person to the wrong account for as long as the item kept failing.
    const ledger = new MemoryLedger();
    await onePass(ledger, 'source');
    expect((await onlyFailure(ledger)).category).toBe('source_refused');
    await onePass(ledger, 'target');
    expect((await onlyFailure(ledger)).category).toBe('target_refused');
  });
});

describe('a row with no category says so, rather than claiming one', () => {
  it('leaves it ABSENT rather than reporting unknown', async () => {
    // Every row written before migration 0049 has NULL here, and `'unknown'`
    // is a real classification — "we looked and could not tell". Reporting one
    // as the other would put a remedy under a failure nobody classified.
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'contact',
      naturalKeyHash: keyOf('older-row'),
      contentHash: 'h',
      targetId: 't',
      createdAt: new Date().toISOString(),
      sizeBytes: 0,
      status: 'failed',
      lastError: 'something a pre-0049 build wrote',
    });
    const failures = await ledger.listFailures(TENANT, MAPPING);
    const older = failures.find((f) => f.naturalKeyHash === keyOf('older-row'));
    expect(older?.lastError).toContain('pre-0049');
    expect(older?.category).toBeUndefined();
    expect('category' in (older ?? {})).toBe(false);
  });
});

/**
 * AND WHEN THE THROWER KNOWS BETTER THAN THE CLASSIFIER (workplan 0125 T4).
 *
 * Everything above is about reading a failure somebody else produced, where the
 * side is the only structural fact available. Some failures are OURS:
 * `NativeFileRefused` decides why a Google file is not going and then writes a
 * paragraph about it, and a regex over that paragraph is this codebase guessing
 * at its own output — which it did, answering `unknown` for thirty of the
 * owner's files on 2026-09-18.
 *
 * The category is stated at the throw and travels the same way the side does.
 * This is the wiring, which is the part that can silently not happen:
 * `recordFailure` takes a STRING, so anything the error itself knows has to be
 * read at the one point where the error still exists.
 */
describe('a category the throw site stated', () => {
  /** An error that names its own category, as `NativeFileRefused` does. */
  const declined = () =>
    withFailureCategory(
      'policy_refused',
      markNeedsDecision(
        new Error('"Heen-en-Weer tas" is a Google Doc and has no file to copy.'),
      ),
    );

  it('reaches the row, rather than being re-guessed from the prose', async () => {
    // THE WIRING. The message says nothing a rule matches — it is our own
    // sentence — so this row reads `unknown` the moment the pass stops reading
    // the tag off the thrown value.
    const ledger = new MemoryLedger();
    await passRefusing(ledger, declined());
    const failure = await onlyFailure(ledger);
    expect(failure.category).toBe('policy_refused');
    expect(FAILURE_CATEGORIES).toContain(failure.category);
  });

  it('keeps the prose verbatim beside it, like every other category', async () => {
    const ledger = new MemoryLedger();
    await passRefusing(ledger, declined());
    expect((await onlyFailure(ledger)).lastError).toContain('has no file to copy');
  });

  it('beats the side, which for this one would have been the wrong answer', async () => {
    // The refusal is raised inside the SOURCE closure, so `failureSideOf` says
    // `source` and the classifier's own reading of a refusal from that side is
    // `source_refused` — the category whose remedy is "accept leaving it
    // behind". For a file a setting WOULD carry, that is the wrong instruction,
    // and it is the one the owner was given.
    const ledger = new MemoryLedger();
    await passRefusing(ledger, withFailureCategory('policy_refused', new Error('403 Forbidden')));
    expect((await onlyFailure(ledger)).category).toBe('policy_refused');
  });

  it('leaves an error that states nothing exactly as it was', async () => {
    // The regression this must not cause: every provider failure in the
    // product takes the old path, and the old path is unchanged.
    const ledger = new MemoryLedger();
    await passRefusing(ledger, new Error(REFUSAL));
    expect((await onlyFailure(ledger)).category).toBe('source_refused');
  });
});
