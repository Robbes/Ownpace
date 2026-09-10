// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A progress link opens counts and states, and nothing that names anything.
 *
 * ## The bargain this holds up
 *
 * ADR-0035 gives the migrator's link two lifetimes with two risks. The
 * credential step is short-lived and single-use; the progress page is
 * **longer-lived but revocable**, and the ADR says in one sentence what buys
 * the longer window:
 *
 * > *"…carries counts and states rather than content, which is what makes the
 * > longer window acceptable."*
 *
 * The reader of that page has no Ownpace account and no session, and the link
 * is a bearer credential: it can be forwarded, left in a chat history, or
 * opened months later on a shared machine. So `viewRowFor`
 * (`packages/shared/src/migration-view.ts`) narrows a `DomainStatusReport` to
 * the fields a stranger may see, and this is what stops that narrowing rotting.
 *
 * ## Why a `Required<>` fixture and not a list of assertions
 *
 * The dangerous change is not somebody editing `viewRowFor`. It is somebody
 * adding a field to `DomainStatusReport` — in `operating-contract.ts`, a file
 * whose author is thinking about the OWNER's progress board — and never
 * learning that a second, public reader exists. An allow-list checked at
 * runtime would still pass: the new field simply would not be copied, until the
 * day somebody "simplified" the construction into a spread.
 *
 * So the fixture below is typed `Required<DomainStatusReport>`. Adding a field
 * to the contract stops this file compiling, in all four `tsc` passes, until
 * somebody writes a value for it — which is the moment they have to decide
 * whether a stranger may see it. The runtime assertions then compare the row's
 * OWN keys against `VIEW_ROW_FIELDS`, so a spread fails on the whole set at
 * once rather than on whichever field the assertions happened to name.
 *
 * ## The two that must never cross, and why each one
 *
 * **`lastError`** is the provider's own prose, kept verbatim everywhere else
 * (ADR-0024) precisely because it is precise — and precise means an SMTP
 * rejection quoting a file name, or a Graph refusal naming the item it refused.
 * A file name is content. `lastErrorCategory` crosses in its place: a closed
 * enum, naming no object, and the half a person can act on (0110 T3).
 *
 * **`lastPass`** is where a pass spent its time. Not content and not a secret,
 * and still left out: it is an operator's diagnostic, and this page is read by
 * somebody asking whether their mail has arrived.
 *
 * Proved by breaking, 2026-09-10: spreading the report into the row, copying
 * `lastError` through, and copying `lastPass` through, each fail here.
 */

import { describe, it, expect } from 'vitest';
import {
  VIEW_ROW_FIELDS,
  viewRowFor,
  type DomainStatusReport,
  type ViewDomainRow,
} from '@openmig/shared';

/**
 * Every field the operating contract can put on one domain's row, set.
 *
 * `Required<>` is load-bearing — see the header. Values are deliberately
 * distinctive, so a field that leaks is recognisable in a failure message
 * rather than being a plausible-looking zero.
 */
const EVERY_FIELD: Required<DomainStatusReport> = {
  domain: 'email',
  state: 'in_progress',
  itemsSynced: 4211,
  itemsFailed: 3,
  bytesTransferred: 91_000_000,
  itemsRetrying: 2,
  itemsNeedingDecision: 1,
  lastSyncedAt: '2026-09-09T21:00:00.000Z',
  lastActiveAt: '2026-09-10T06:30:00.000Z',
  lastError: '550 5.7.1 rejected: /Documents/tax-return-2024.pdf',
  lastErrorCategory: 'target_refused',
  failedSide: 'target',
  lastPass: { items: 40, wallMs: 3000, sourceFetchMs: 1000, targetWriteMs: 900, ledgerMs: 50, hashMs: 20, overlap: 2.1 },
  pausedReason: { kind: 'daily-download-ceiling', provider: 'imap.gmail.com', windowResetsAt: null },
};

describe('what a progress link may open', () => {
  it('copies every field it is allowed to, and no others', () => {
    const row = viewRowFor(EVERY_FIELD);
    // The row's own keys, against the list — both directions. A missing field
    // is a page that lost a number; an extra one is the leak.
    expect(Object.keys(row).sort()).toEqual([...VIEW_ROW_FIELDS].sort());
  });

  it('never carries the provider prose, which is the field that names files', () => {
    const row = viewRowFor(EVERY_FIELD) as unknown as Record<string, unknown>;
    expect(row.lastError).toBeUndefined();
    // Not "is the key absent" but "is the VALUE anywhere in the payload":
    // a future field that quoted the message under another name would pass
    // the key check and fail this one.
    expect(JSON.stringify(row)).not.toContain('tax-return-2024');
    expect(JSON.stringify(row)).not.toContain('550 5.7.1');
  });

  it('never carries the pass timings', () => {
    const row = viewRowFor(EVERY_FIELD) as unknown as Record<string, unknown>;
    expect(row.lastPass).toBeUndefined();
  });

  it('carries the failure CATEGORY and side, which name nothing', () => {
    const row = viewRowFor(EVERY_FIELD);
    expect(row.lastErrorCategory).toBe('target_refused');
    expect(row.failedSide).toBe('target');
  });

  it('carries the pause reason, because a silent pause is worse for this reader', () => {
    const row = viewRowFor(EVERY_FIELD);
    expect(row.pausedReason).toEqual({
      kind: 'daily-download-ceiling',
      provider: 'imap.gmail.com',
      windowResetsAt: null,
    });
  });

  it('omits an absent optional rather than writing undefined beside a date', () => {
    // A deployment older than `lastActiveAt`, or a domain that has never
    // completed. `'lastSyncedAt' in row` must be false — a screen that reads
    // the key and finds `undefined` prints "undefined" beside a label.
    const bare: DomainStatusReport = {
      domain: 'calendar',
      state: 'pending',
      itemsSynced: 0,
      itemsFailed: 0,
      bytesTransferred: 0,
      itemsRetrying: 0,
      itemsNeedingDecision: 0,
    };
    const row = viewRowFor(bare);
    expect('lastSyncedAt' in row).toBe(false);
    expect('lastActiveAt' in row).toBe(false);
    expect('pausedReason' in row).toBe(false);
    expect('lastErrorCategory' in row).toBe(false);
    expect('failedSide' in row).toBe(false);
    // The counts still cross, at zero. Zero is a fact about a domain that HAS
    // a status row; the "nothing has run yet" case is the payload's `started`
    // flag and is a different claim entirely (workplan 0122 §3).
    expect(row.itemsSynced).toBe(0);
  });

  it('the allow-list is the type, not a second copy of it', () => {
    // `VIEW_ROW_FIELDS` is typed `readonly (keyof ViewDomainRow)[]`, so a
    // field renamed on the interface and not here is a compile error. This
    // asserts the other direction — that the list is COMPLETE — by naming the
    // count, which is the only part a type cannot check.
    const fields: readonly (keyof ViewDomainRow)[] = VIEW_ROW_FIELDS;
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields.length).toBe(12);
  });
});
