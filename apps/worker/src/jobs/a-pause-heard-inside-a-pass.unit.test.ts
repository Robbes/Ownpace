// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAUSE HEARD INSIDE A PASS, NOT ONLY BETWEEN ITS DATA TYPES (2026-09-29):
 * the managed pass's half.
 *
 * The owner pressed Pause while a file pass was writing into a Nextcloud
 * target, and the writes went on for most of an hour. The pass re-read its
 * migration before each data type (`passStepBefore`), and not inside one: a
 * comment said each data type's pass "already stops itself at its own
 * deadline", which is fifty minutes. So the loop is now handed the same
 * question to ask from inside (`whyItStops`, in core), and this runner is
 * where it comes from: `whyThisDataTypeStops`, which is `passStepBefore`'s
 * answer, said as the one reason the loop needs or null.
 *
 * Run here against real rows on PGlite, as its neighbour
 * `a-closed-organisation-gets-no-pass` runs `passStepBefore`, so each of the
 * four doors that stop a pass is proven to reach it: Pause, a grant taken
 * back, a closed organisation, and a data type its owner stopped. The same
 * read under row security, as the worker's own role, is in
 * `a-pause-nobody-could-press.integration.test.ts`.
 *
 * And the runner itself, read as text as its neighbours read it (it is a
 * Trigger.dev task and opens its pools at import): every data type's pass is
 * handed the question, and a data type stopped mid-pass is not called
 * completed.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { createPgliteDb, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { asMappingId, asTenantId } from '@openmig/shared';
import { passStepBefore, whyThisDataTypeStops } from './stopping-a-pass.ts';

// UUID family 0e290e29-…, unused elsewhere in the repo.
const TENANT = asTenantId('0e290e29-e29b-41d4-a716-446655440001');
const CONNECTION = '0e290e29-e29b-41d4-a716-446655440002';
const SOURCE_MAILBOX = '0e290e29-e29b-41d4-a716-446655440003';
const TARGET_MAILBOX = '0e290e29-e29b-41d4-a716-446655440004';
const MAPPING = asMappingId('0e290e29-e29b-41d4-a716-446655440005');

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

const pool = () => driver as unknown as Pool;
const why = (domain: string) => whyThisDataTypeStops(pool(), TENANT, MAPPING, domain);

/** The migration and its two data types back where every case starts: active, open, running. */
async function reset(): Promise<void> {
  await query(`UPDATE tenant SET status = 'active' WHERE id = $1`, [TENANT]);
  await query(`UPDATE mailbox_mapping SET status = 'active', grant_withdrawn_at = NULL WHERE id = $1`, [MAPPING]);
  await query(`UPDATE path_lifecycle SET state = 'active', stopped_at = NULL WHERE mapping_id = $1`, [MAPPING]);
}

beforeAll(async () => {
  driver = (await createPgliteDb({})).driver;
  await runMigrations({ driver, logger: () => {} });

  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'pausing', 'active')`, [TENANT]);
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
       VALUES ($1, $2, $3, $4, 'a@example.test')`,
      [id, TENANT, CONNECTION, ext],
    );
  }
  await query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern)
     VALUES ($1, $2, $3, $4, 'active', 'mirror', 'shared_s')`,
    [MAPPING, TENANT, SOURCE_MAILBOX, TARGET_MAILBOX],
  );
  for (const domain of ['email', 'file']) {
    await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
      TENANT,
      MAPPING,
      domain,
    ]);
    await query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1, $2, $3, 'active', now())`,
      [TENANT, MAPPING, domain],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the question a running pass is handed, answered from real rows', () => {
  it('lets the pass go on while nothing has changed', async () => {
    await reset();
    expect(await why('file')).toBeNull();
    expect(await why('email')).toBeNull();
  });

  it('stops it when the owner pressed Pause', async () => {
    await reset();
    await query(`UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1`, [MAPPING]);
    await query(`UPDATE path_lifecycle SET state = 'paused' WHERE mapping_id = $1`, [MAPPING]);
    try {
      expect(await why('file')).toBe('no_longer_runs');
    } finally {
      await reset();
    }
  });

  it('stops it when the person being migrated took their grant back (0108 T8 (c))', async () => {
    await reset();
    await query(`UPDATE mailbox_mapping SET grant_withdrawn_at = now() WHERE id = $1`, [MAPPING]);
    try {
      expect(await why('file')).toBe('grant_withdrawn');
    } finally {
      await reset();
    }
  });

  it('stops it when the organisation was closed (0085 T2)', async () => {
    await reset();
    await query(`UPDATE tenant SET status = 'closed' WHERE id = $1`, [TENANT]);
    try {
      expect(await why('file')).toBe('organisation_closed');
    } finally {
      await reset();
    }
  });

  it('stops this data type alone when its owner stopped it (0128 T4)', async () => {
    await reset();
    await query(`UPDATE path_lifecycle SET stopped_at = now() WHERE mapping_id = $1 AND domain = 'file'`, [MAPPING]);
    try {
      expect(await why('file')).toBe('stopped_by_its_owner');
      expect(await why('email')).toBeNull();
    } finally {
      await reset();
    }
  });

  it('is exactly the answer the pass gets between data types', async () => {
    // One reading of the lifecycle, asked from two places: a second one here
    // would be the thing `stopping-a-pass.ts` exists to refuse.
    await reset();
    await query(`UPDATE mailbox_mapping SET grant_withdrawn_at = now() WHERE id = $1`, [MAPPING]);
    try {
      expect(await passStepBefore(pool(), TENANT, MAPPING, 'file')).toEqual({ halt: 'grant_withdrawn' });
      expect(await why('file')).toBe('grant_withdrawn');
    } finally {
      await reset();
    }
    expect(await passStepBefore(pool(), TENANT, MAPPING, 'file')).toEqual({ run: true });
    expect(await why('file')).toBeNull();
  });
});

/** Comments are prose about code, not code (see `a-domain-the-dispatchers-forgot`). */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('the runner hands every data type the question', () => {
  const src = code(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'run-delta-sync.ts'), 'utf8'));
  const loop = src.slice(src.indexOf('for (const domain of domains) {'));

  it('builds it per data type, beside the deadline, from the same answer as the between-types read', () => {
    expect(loop).toMatch(
      // And, on managed outside the alpha, the data ceiling's question (0109 T6).
      /const passStops[^=]*=\s*\{\s*deadline: typeDeadline,\s*whyItStops: \(\) => whyThisDataTypeStops\(pool, tenantId, mappingId, domain\),?\s*(\.\.\.\(ceiling \? \{ firstCopyAllowed: firstCopyGate\(ceiling\) \} : \{\}\),?\s*)?\}/,
    );
  });

  it('a data type stopped mid-pass is a pause, not a completion', () => {
    // The first branch of `pause` reads the stop, so `if (!pause)` never
    // reaches `markCompleted` for it.
    expect(loop).toMatch(/const pause = result\.haltPause\s*\?/);
    expect(loop).toMatch(/stopped: 'halt' as const, haltedBecause: result\.haltPause\.reason/);
  });
});
