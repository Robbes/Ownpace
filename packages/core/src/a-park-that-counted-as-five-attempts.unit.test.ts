// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FLAG STORED IN A COUNTER IS READ BACK AS A COUNT, AND THE SCREEN PRINTS IT.
 *
 * Live, 2026-09-14. The owner's Failures page showed `5 tries` against a Google
 * Doc under `nativeFilePolicy="refuse"`, and `6 tries` on two rows beside it —
 * above `MAX_ITEM_ATTEMPTS`, so not a count of anything. Every one of those
 * items had been attempted ONCE.
 *
 * `attempt_count` was doing two jobs. Parking — "a person must decide this,
 * stop retrying it" — was implemented by writing the ceiling into the counter
 * (`attempt_count = MAX_ITEM_ATTEMPTS` on insert, `GREATEST(count + 1, MAX)`
 * on update), and `needsDecision` was derived back out of it. The mechanism
 * worked. What it could not do is tell the truth, because the screen renders
 * that number verbatim: a policy refusal the loop deliberately parks on FIRST
 * sight — `domain-sync.ts` says so in as many words, "a policy that answers the
 * same way every time is not something to try five times" — arrived in front of
 * the owner as five attempts against their Google account that never happened.
 *
 * Migration 0046 separates them. These are over `MemoryLedger`, the mirror
 * `PgLedger` is written against; the Postgres half of the same contract is
 * pinned in `packages/ledger/src/a-parked-row-is-not-a-tall-count.integration.test.ts`.
 *
 * The last block is a Dropbox Paper doc (workplan 0150 T6 (a)), through the
 * real sync loop: the owner's met the other route, five attempts and then a
 * wait, because nothing said it was a decision.
 */

import { describe, it, expect } from 'vitest';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';
import { classifyKnownItem } from './domain-sync.ts';
import { runFileSync } from './dav-sync.ts';
import {
  asMappingId,
  asTenantId,
  MAX_ITEM_ATTEMPTS,
  type FileFolder,
  type LedgerRecord,
  type RawFileItem,
  type UpsertResult,
} from '@openmig/shared';
import { DropboxFileSource, type DropboxEntry, type DropboxTransport } from '@openmig/connectors';

const TENANT = asTenantId('11111111-1111-4111-8111-111111111111' as never);
const MAPPING = asMappingId('33333333-3333-4333-8333-333333333333' as never);

function record(over: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash: 'h1',
    contentHash: 'c1',
    targetId: '',
    createdAt: new Date().toISOString(),
    sizeBytes: 0,
    status: 'failed',
    ...over,
  } as LedgerRecord;
}

const POLICY_REFUSAL =
  '"Voorbeeldtekst.docx" is a Google document and has no file to copy.';

describe('a parked item was tried once, and says so', () => {
  it('counts ONE attempt, not the ceiling', async () => {
    // THE HEADLINE. Before this, a park wrote MAX_ITEM_ATTEMPTS into the count
    // and the Failures page printed it as "5 tries".
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    const row = await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });

    expect(row.attemptCount).toBe(1);
    expect(row.attemptCount).not.toBe(MAX_ITEM_ATTEMPTS);
  });

  it('records the park as its own fact', async () => {
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    const row = await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });

    expect(row.parkedAt).toBeDefined();
  });

  it('still waits on a person, on one attempt', async () => {
    // The behaviour the old encoding bought, kept: `needsDecision` no longer
    // reads a count, so parking at 1 attempt still takes the item out of the
    // automatic lane.
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });

    const [failure] = await ledger.listFailures(TENANT, MAPPING);
    expect(failure?.attempts).toBe(1);
    expect(failure?.needsDecision).toBe(true);
    expect(failure?.parkedAt).toBeDefined();
  });

  it('never walks past the ceiling when parked again', async () => {
    // `GREATEST(count + 1, MAX)` on an already-parked row gave 6, then 7 — a
    // number that is neither attempts nor parked-ness. Two of those were on
    // the owner's screen.
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });
    const again = await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });

    expect(again.attemptCount).toBe(2);
    expect(again.attemptCount).toBeLessThan(MAX_ITEM_ATTEMPTS);
  });

  it('keeps the FIRST park time when parked again', async () => {
    // "Waiting since" is the question an operator asks of a parked row, and
    // re-stamping it on every pass would answer "since a moment ago" forever.
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    const first = await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });
    const again = await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });

    expect(again.parkedAt).toBe(first.parkedAt);
  });
});

describe('an ordinary failure is untouched', () => {
  it('counts up one at a time and is not parked', async () => {
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    await ledger.recordFailure(r, 'ECONNRESET');
    const second = await ledger.recordFailure(r, 'ECONNRESET');

    expect(second.attemptCount).toBe(2);
    expect(second.parkedAt).toBeUndefined();
  });

  it('still waits on a person once its attempts run out', async () => {
    // The OTHER route to needsDecision, and the one where the count is the
    // truth and worth printing.
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    for (let i = 0; i < MAX_ITEM_ATTEMPTS; i++) await ledger.recordFailure(r, 'ECONNRESET');

    const [failure] = await ledger.listFailures(TENANT, MAPPING);
    expect(failure?.attempts).toBe(MAX_ITEM_ATTEMPTS);
    expect(failure?.needsDecision).toBe(true);
    expect(failure?.parkedAt).toBeUndefined();
  });
});

describe('a retry un-parks as well as zeroing', () => {
  it('clears the park, so the next pass fetches the item again', async () => {
    // A row left parked would be skipped however low its count went — which is
    // the same "fix that unparked nothing" shape, one layer down.
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });

    expect(await ledger.resolveFailure(TENANT, MAPPING, 'h1', 'retry')).toBe(true);

    const [failure] = await ledger.listFailures(TENANT, MAPPING);
    expect(failure?.attempts).toBe(0);
    expect(failure?.needsDecision).toBe(false);
    expect(failure?.parkedAt).toBeUndefined();
  });

  it('clears it for a whole group too', async () => {
    const ledger = new MemoryLedger();
    for (const n of [1, 2]) {
      const r = record({ naturalKeyHash: `g${n}` });
      await ledger.recordIfAbsent(r);
      await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });
    }

    expect(
      await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', { errorContains: 'Google' }),
    ).toBe(2);

    for (const f of await ledger.listFailures(TENANT, MAPPING)) {
      expect(f.needsDecision).toBe(false);
      expect(f.parkedAt).toBeUndefined();
    }
  });
});

describe('the sync loop skips a parked item without consulting its count', () => {
  it('calls a parked row needs-decision on ONE attempt', () => {
    // Without this the loop would fetch the item four more times, against a
    // policy that answers the same way every pass — the waste `park` exists to
    // prevent, and which the old ceiling-write bought by accident.
    expect(
      classifyKnownItem(
        { status: 'failed', attemptCount: 1, parkedAt: new Date().toISOString() },
        undefined,
        undefined,
      ),
    ).toBe('needs-decision');
  });

  it('still retries an ordinary failure that has attempts left', () => {
    expect(classifyKnownItem({ status: 'failed', attemptCount: 1 }, undefined, undefined)).toBe(
      'retry-failed',
    );
  });

  it('still stops an ordinary failure at the ceiling', () => {
    expect(
      classifyKnownItem(
        { status: 'failed', attemptCount: MAX_ITEM_ATTEMPTS },
        undefined,
        undefined,
      ),
    ).toBe('needs-decision');
  });
});

describe('a Dropbox Paper doc is parked on its first attempt (workplan 0150 T6 (a))', () => {
  // THE OWNER'S CASE, 2026-09-25 to 2026-09-28. A `.paper` in a Dropbox
  // migration read `source_refused` at five attempts, waiting on a person and
  // never parked: `files/download` refused it with 409 `unsupported_file`, and
  // that came back as a bare error, so the loop counted it as the world
  // failing, five times, and toward the pass's 25 in a row.

  /**
   * A Dropbox with one folder, listed as given. A download hands over three
   * bytes, except of a file it lists as not downloadable, which it refuses as
   * it refused the owner's: 409 `unsupported_file`.
   */
  function dropbox(entries: DropboxEntry[]) {
    const downloads: string[] = [];
    const transport: DropboxTransport = async (url, init) => {
      let refused = false;
      if (url.endsWith('/files/download')) {
        const id = JSON.parse(init.headers['Dropbox-API-Arg'] ?? '{}').path as string;
        downloads.push(id);
        refused = entries.some((e) => e.id === id && e.is_downloadable === false);
      }
      return {
        ok: !refused,
        status: refused ? 409 : 200,
        json: async () => ({ entries, cursor: 'end', has_more: false }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
        text: async () =>
          refused ? '{"error":{".tag":"unsupported_file"},"error_summary":"unsupported_file/"}' : '',
      };
    };
    return {
      source: new DropboxFileSource(transport, {
        apiBaseUrl: 'https://api.test/2',
        contentBaseUrl: 'https://content.test/2',
      }),
      downloads,
    };
  }

  const file = (name: string, over: Partial<DropboxEntry> = {}): DropboxEntry => ({
    '.tag': 'file',
    id: `id:${name}`,
    name,
    path_display: `/${name}`,
    size: 100,
    server_modified: '2026-09-25T10:00:00Z',
    content_hash: `hash-${name}`,
    ...over,
  });
  const paper = (name: string): DropboxEntry =>
    file(name, { is_downloadable: false, export_info: { export_as: 'markdown' } });

  function memoryTarget() {
    const written: string[] = [];
    return {
      written,
      ensureDirectory: async (folder: FileFolder) => `t/${folder.path || 'root'}`,
      upsertFile: async (parentId: string, raw: RawFileItem): Promise<UpsertResult> => {
        written.push(raw.item.path);
        return { targetId: `${parentId}:${raw.item.path}`, created: true };
      },
      findFileByNaturalKey: async () => undefined,
    };
  }

  async function pass(source: DropboxFileSource, ledger: MemoryLedger) {
    const target = memoryTarget();
    // One at a time, so "in a row" means the listing's order.
    const result = await runFileSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target,
      ledger,
      cursors: new MemoryCursorStore(),
      concurrency: 1,
      sourceIsAuthorityOnExistence: true,
    });
    return { result, written: target.written };
  }

  it('parks it on one attempt, stating policy_refused, and copies the rest', async () => {
    const { source, downloads } = dropbox([paper('Notes.paper'), file('letter.pdf')]);
    const ledger = new MemoryLedger();
    const { result, written } = await pass(source, ledger);

    expect(written).toEqual(['letter.pdf']);
    expect(downloads).toEqual(['id:letter.pdf']);
    expect(result.needsDecision).toBe(1);
    const failures = await ledger.listFailures(TENANT, MAPPING, 'file');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ category: 'policy_refused', attempts: 1, needsDecision: true });
    expect(failures[0]?.parkedAt).toBeDefined();
    expect(failures[0]?.lastError).toContain('"Notes.paper" is a Dropbox Paper doc: it has no file to copy');
  });

  it('is not tried again on the next pass', async () => {
    const { source, downloads } = dropbox([paper('Notes.paper'), file('letter.pdf')]);
    const ledger = new MemoryLedger();
    await pass(source, ledger);
    await pass(source, ledger);

    // The second pass downloads nothing: the file is already copied, and the
    // Paper doc waits on a person.
    expect(downloads).toEqual(['id:letter.pdf']);
    const [failure] = await ledger.listFailures(TENANT, MAPPING, 'file');
    expect(failure?.attempts).toBe(1);
  });

  it('never stops a pass, however many there are: thirty Paper docs, then a file', async () => {
    // Twenty-five failures in a row stop a pass, and a refusal that counted
    // would stop this one before the file listed after them.
    const papers = Array.from({ length: 30 }, (_, i) => paper(`Doc ${String(i).padStart(2, '0')}.paper`));
    const { source } = dropbox([...papers, file('zz-after-them.pdf')]);
    const ledger = new MemoryLedger();
    const { result, written } = await pass(source, ledger);

    expect(written).toEqual(['zz-after-them.pdf']);
    expect(result.needsDecision).toBe(30);
    const failures = await ledger.listFailures(TENANT, MAPPING, 'file');
    expect(failures).toHaveLength(30);
    expect(failures.every((f) => f.parkedAt !== undefined && f.attempts === 1)).toBe(true);
  });
});
