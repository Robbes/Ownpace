// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RUN THAT READ ON AFTER THE CLOSE (workplan 0139 T7; terms briefing,
 * precondition B; `site/legal/README.md`, *Nothing uses your access after
 * closing*).
 *
 * Since #1320 nothing new starts for a closed organisation: the tick starts no
 * pass, a pass under way stops before its next data type, and the builders of
 * every reader refuse. What was left was work ALREADY RUNNING when the account
 * closed. The close asks the orchestrator to cancel only the runs whose row
 * names the orchestrator's run, and only a sync pass records one. So:
 *
 *  - a verification (the owner's Finish check, and a cutover's gate) built one
 *    reader per data type before the close and then listed every target to
 *    the end, five listings per data type;
 *  - a confirmation built its readers before the close and then read every
 *    item's bytes off the target to the end;
 *  - a discovery listed every collection of the data type it was on.
 *
 * Each now asks whether its organisation is still open between its steps, on
 * the ledger, as the pass does: a verification before each read of a target,
 * a confirmation before each data type and before each item it asks the
 * target about, a discovery before each collection it lists. This file runs
 * the jobs' own code over a real ledger (PGlite) with the targets and sources
 * stood in, closes the organisation WHILE a target or source is being read,
 * and holds each run to one rule: **no read begins after the close.** The
 * read in flight when the close lands is allowed to finish; nothing after it
 * starts.
 *
 * It failed before the change: after the close, the verification went on to
 * list the mail target four more times and the file target five, the
 * confirmation read every remaining item and closed its run as succeeded, and
 * the discovery listed the two collections it had not reached.
 *
 * The addresses are invented.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { createPgliteDb, runMigrations, type LedgerDriver } from '@openmig/ledger';
import {
  ACCOUNT_CLOSED,
  asMappingId,
  asTenantId,
  fileNaturalKeyHash,
  isCredentialRefusal,
  naturalKeyHash,
  type DiscoveryDomain,
  type TargetEntry,
  type TargetReindexer,
} from '@openmig/shared';

// UUID family 0139c7a0-…, unused elsewhere in the repo.
const P = '0139c7a0-e29b-41d4-a716-4466554400';
const TENANT = asTenantId(`${P}01`);
const CONNECTION = `${P}02`;
const SOURCE_MAILBOX = `${P}03`;
const TARGET_MAILBOX = `${P}04`;
const MAPPING = asMappingId(`${P}05`);

/** Three items per data type, in the ledger and on the stand-in target alike. */
const KEYS: Readonly<Record<'email' | 'file', readonly string[]>> = {
  email: ['<one@example.test>', '<two@example.test>', '<three@example.test>'],
  file: ['/a.txt', '/b.txt', '/c.txt'],
};
const HASH_OF: Readonly<Record<'email' | 'file', (key: string) => string>> = {
  email: naturalKeyHash,
  file: fileNaturalKeyHash,
};
/** A whole-bytes hash, the same on both sides, so a read answers `match`. */
const contentOf = (key: string): string => Buffer.from(key).toString('hex').padEnd(64, '0').slice(0, 64);

let driver: LedgerDriver;

/** One statement, on a connection taken and given back (PGlite has one). */
async function query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<R>(text, params)).rows;
  } finally {
    conn.release();
  }
}

/** Set the organisation's status, as the close and the reopen do. */
const organisation = (status: 'active' | 'closed') =>
  query(`UPDATE tenant SET status = $2 WHERE id = $1`, [TENANT, status]);

/**
 * Every read of an account this file stands in for, in order, and whether it
 * began after the close. `closeOn` names the read DURING which the close lands.
 */
interface Read {
  readonly what: string;
  readonly afterTheClose: boolean;
}
let reads: Read[] = [];
let closed = false;
let closeOn: string | undefined;

/** A read begins: note it, and close the organisation if this is the one. */
async function reading(what: string): Promise<void> {
  reads.push({ what, afterTheClose: closed });
  if (what === closeOn && !closed) {
    await organisation('closed');
    closed = true;
  }
}

const readsAfterTheClose = (): string[] => reads.filter((r) => r.afterTheClose).map((r) => r.what);

/** What the stand-in target holds for one data type. */
function entriesOf(domain: 'email' | 'file'): TargetEntry[] {
  return KEYS[domain].map((key, i) => ({
    naturalKey: key,
    targetId: `${domain}-${i}`,
    mailboxId: domain === 'email' ? 'INBOX' : '/',
    sizeBytes: 10,
  }));
}

/** The verification's reader of one target: each listing is one read of the account. */
function verificationTarget(domain: 'email' | 'file'): TargetReindexer {
  let listings = 0;
  return {
    async *listEntries(): AsyncIterable<TargetEntry> {
      listings += 1;
      await reading(`${domain} listing ${listings}`);
      for (const entry of entriesOf(domain)) yield entry;
    },
  } as TargetReindexer;
}

/** The confirmation's target: listed once when its reader is built, then read per item. */
function confirmationTarget(domain: 'email' | 'file'): TargetReindexer {
  let hashed = 0;
  return {
    async *listEntries(): AsyncIterable<TargetEntry> {
      for (const entry of entriesOf(domain)) yield entry;
    },
    async contentHashFor(entry: TargetEntry): Promise<string> {
      hashed += 1;
      await reading(`${domain} item ${hashed}`);
      return contentOf(entry.naturalKey);
    },
  } as TargetReindexer;
}

// The verification's targets are built by `buildTargetReindexers` from the
// stored access; here they are the stand-ins above, and nothing else changes.
vi.mock('@openmig/orchestration/build-reindexers', async (original) => ({
  ...(await original<typeof import('@openmig/orchestration/build-reindexers')>()),
  buildTargetReindexers: () =>
    Promise.resolve({
      reindexers: { mail: verificationTarget('email'), files: verificationTarget('file') },
      close: () => Promise.resolve(),
    }),
}));

// The verification counts the ledger's items through a reader on node-postgres
// (`tenantScopedDb`), which PGlite cannot serve; here it answers from the same
// three keys per data type. The organisation's status is still read from the
// ledger itself, which is the question under test.
vi.mock('@openmig/ledger', async (original) => ({
  ...(await original<typeof import('@openmig/ledger')>()),
  createLedgerVerificationReader: () => ({
    countItems: (_t: string, _m: string, domain: string) => Promise.resolve(KEYS[domain as 'email' | 'file']?.length ?? 0),
    totalSizeBytes: () => Promise.resolve(0),
    getSamples: () => Promise.resolve([]),
    getAllNaturalKeyHashes: (_t: string, _m: string, domain: string) =>
      Promise.resolve((KEYS[domain as 'email' | 'file'] ?? []).map((k) => HASH_OF[domain as 'email' | 'file'](k))),
    close: () => Promise.resolve(),
  }),
}));

// A discovery's source is built by `buildDomainDepsFromMapping` from the
// stored access; here it is a mailbox of three folders, each listing one read.
vi.mock('@openmig/orchestration/build-deps-from-mapping', async (original) => ({
  ...(await original<typeof import('@openmig/orchestration/build-deps-from-mapping')>()),
  buildDomainDepsFromMapping: () =>
    Promise.resolve({
      source: {
        listFolders: () =>
          Promise.resolve([
            { path: 'INBOX', name: 'INBOX' },
            { path: 'Archive', name: 'Archive' },
            { path: 'Sent', name: 'Sent' },
          ]),
        listSince: async (folder: { path: string }) => {
          await reading(`folder ${folder.path}`);
          return { items: [{ size: 10 }, { size: 20 }], nextCursor: {} };
        },
      },
      close: () => Promise.resolve(),
    }),
}));

// The jobs open their pools at import (openTaskPools) and refuse without
// either URL. Nothing here connects through them: every function below is
// handed the PGlite driver.
process.env.APP_DATABASE_URL ??= 'postgres://unused:unused@close.test.invalid/none';
process.env.DATABASE_URL ??= 'postgres://unused:unused@close.test.invalid/none';

const { runCutoverGate } = await import('./cutover-gate.ts');
const { buildTask } = await import('./run-discovery.ts');
const { runConfirmationOver } = await import('@openmig/orchestration/run-confirmation-pass');

const pool = () => driver as unknown as Pool;

/** The close's own refusal, and not some other error that happened to stop the run. */
function theCloseRefused(error: unknown): boolean {
  return isCredentialRefusal(error) && error.refusal.code === ACCOUNT_CLOSED;
}

/** What a run threw, or null when it did not. */
async function thrownBy(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
    return null;
  } catch (error) {
    return error;
  }
}

beforeAll(async () => {
  driver = (await createPgliteDb({})).driver;
  await runMigrations({ driver, logger: () => {} });

  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'closing', 'active')`, [TENANT]);
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
     VALUES ($1, $2, 'source', 'imap', 'fixture', 'connected', '{}'::jsonb)`,
    [CONNECTION, TENANT],
  );
  for (const [id, ext] of [
    [SOURCE_MAILBOX, 'src'],
    [TARGET_MAILBOX, 'dst'],
  ] as const) {
    await query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
       VALUES ($1, $2, $3, $4, 'someone@example.test')`,
      [id, TENANT, CONNECTION, ext],
    );
  }
  await query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode)
     VALUES ($1, $2, $3, $4, 'active', 'mirror')`,
    [MAPPING, TENANT, SOURCE_MAILBOX, TARGET_MAILBOX],
  );
  for (const domain of ['email', 'file'] as const) {
    await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
      TENANT,
      MAPPING,
      domain,
    ]);
    for (const key of KEYS[domain]) {
      await query(
        `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash,
                           content_hash, status, item_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'copied', $8)`,
        [TENANT, MAPPING, domain, domain === 'email' ? 'INBOX' : '/', key, HASH_OF[domain](key), contentOf(key), domain === 'email' ? 'mail' : 'file'],
      );
    }
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  reads = [];
  closed = false;
  closeOn = undefined;
  await organisation('active');
  await query(`UPDATE item SET confirmed_answer = NULL, confirmed_at = NULL WHERE mapping_id = $1`, [MAPPING]);
  await query(`DELETE FROM run WHERE mapping_id = $1`, [MAPPING]);
});

describe('a verification running when the organisation is closed', () => {
  it('reads every target while the organisation is open, so the cases below mean something', async () => {
    const result = await runCutoverGate(pool(), TENANT, MAPPING);
    expect(result.mail.status).not.toBe('SKIPPED');
    expect(result.files.status).not.toBe('SKIPPED');
    expect(reads.some((r) => r.what.startsWith('email listing'))).toBe(true);
    expect(reads.some((r) => r.what.startsWith('file listing'))).toBe(true);
  });

  it('begins no read after the close, lands no verdict, and says the close stopped it', async () => {
    // The close lands while the mail target is listed for the first time.
    closeOn = 'email listing 1';
    const error = await thrownBy(runCutoverGate(pool(), TENANT, MAPPING));
    expect(readsAfterTheClose()).toEqual([]);
    expect(reads.map((r) => r.what)).toEqual(['email listing 1']);
    expect(theCloseRefused(error)).toBe(true);
  });

  it('stops between data types too: the file target is never listed', async () => {
    // Five listings of the mail target make its data type; the close lands in
    // the last of them, so the next read would be the FILE target's.
    closeOn = 'email listing 5';
    const error = await thrownBy(runCutoverGate(pool(), TENANT, MAPPING));
    expect(readsAfterTheClose()).toEqual([]);
    expect(reads.some((r) => r.what.startsWith('file'))).toBe(false);
    expect(theCloseRefused(error)).toBe(true);
  });

  it('the verification the owner starts asks the same question as the gate', () => {
    // `run-verification` builds the same deps as `runCutoverGate`, written out
    // beside it; it must hand them the same check.
    const here = import.meta.dirname;
    for (const file of ['run-verification.ts', 'cutover-gate.ts']) {
      const code = readFileSync(join(here, file), 'utf8');
      expect(code, `${file} does not hand the verification the close's check`).toMatch(
        /createRealVerificationDeps\(\{[\s\S]*?organisationIsOpen: organisationStillOpen\(pool, tenantId\),[\s\S]*?\}\)/,
      );
    }
  });
});

describe('a confirmation running when the organisation is closed', () => {
  const confirm = () =>
    runConfirmationOver({
      source: driver,
      tenantId: TENANT,
      mappingId: MAPPING,
      open: (domain: DiscoveryDomain) => {
        if (domain !== 'email' && domain !== 'file') return Promise.reject(new Error(`no ${domain} target`));
        return Promise.resolve({ target: confirmationTarget(domain), close: () => Promise.resolve() });
      },
      wanted: ['email', 'file'],
      trigger: 'manual',
    });

  const runRow = async (runId: string) =>
    (await query<{ status: string; stats: Record<string, unknown> }>(`SELECT status, stats FROM run WHERE id = $1`, [runId]))[0]!;

  const confirmedItems = async (): Promise<number> =>
    Number(
      (
        await query<{ n: string }>(
          `SELECT count(*)::text AS n FROM item WHERE mapping_id = $1 AND confirmed_answer IS NOT NULL`,
          [MAPPING],
        )
      )[0]!.n,
    );

  it('reads every item while the organisation is open', async () => {
    const result = await confirm();
    expect(reads).toHaveLength(6);
    expect((await runRow(result.runId)).status).toBe('succeeded');
  });

  it('begins no read after a close in the middle of a data type, and records why it stopped', async () => {
    closeOn = 'email item 2';
    const result = await confirm();
    expect(readsAfterTheClose()).toEqual([]);
    expect(reads.map((r) => r.what)).toEqual(['email item 1', 'email item 2']);
    const row = await runRow(result.runId);
    // Not a failure and not a finished pass: the run was cancelled by the close.
    expect(row.status).toBe('cancelled');
    expect(row.stats).toMatchObject({ stoppedBecause: 'organisation_closed', stoppedBefore: 'email' });
    // What was confirmed before the close stays confirmed (the pass's rule 3).
    expect(await confirmedItems()).toBe(2);
  });

  it('stops between data types too: no file item is read', async () => {
    closeOn = 'email item 3';
    const result = await confirm();
    expect(readsAfterTheClose()).toEqual([]);
    expect(reads.some((r) => r.what.startsWith('file'))).toBe(false);
    const row = await runRow(result.runId);
    expect(row.status).toBe('cancelled');
    expect(row.stats).toMatchObject({ stoppedBecause: 'organisation_closed', stoppedBefore: 'file' });
    expect(await confirmedItems()).toBe(3);
  });
});

describe('a discovery running when the organisation is closed', () => {
  it('lists every collection while the organisation is open', async () => {
    const counted = await buildTask(pool(), TENANT, MAPPING, 'email').run();
    expect(counted.collections).toBe(3);
    expect(reads.map((r) => r.what)).toEqual(['folder INBOX', 'folder Archive', 'folder Sent']);
  });

  it('begins no listing after the close, and counts nothing it did not finish', async () => {
    closeOn = 'folder INBOX';
    const error = await thrownBy(buildTask(pool(), TENANT, MAPPING, 'email').run());
    expect(readsAfterTheClose()).toEqual([]);
    expect(reads.map((r) => r.what)).toEqual(['folder INBOX']);
    // Refused with the close's own sentence, which discovery records as this
    // data type's error: no partial count stands in for the whole.
    expect(theCloseRefused(error)).toBe(true);
  });
});
