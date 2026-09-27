// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ANNOUNCEMENT OF THE SHARES CARRIED BY HAND, ONE WAVE PER DATA TYPE, ON
 * THE APPLIANCE (workplan 0104 T3; 0128 T5, slice 6, the owner's D8), on the
 * real appliance on PGlite.
 *
 * Nothing cut over, the press is refused, naming both data types. Its
 * calendars cut over on their own while its files keep running: the press
 * announces the calendars' shares carried by hand, and leaves the files',
 * counted, for their own cutover. Each data type is announced once, and
 * mailed again only on purpose.
 *
 * The mail channel is on, and its transport is this file's: what is under test
 * is who is told what, and when.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteDriver } from '@openmig/ledger';
import { notCutOverToAnnounceReason } from '@openmig/core';

/** Every mail the channel was handed. */
const SENT: Array<{ to: readonly string[]; subject: string; body: string }> = [];
vi.mock('@openmig/connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/connectors')>();
  return {
    ...actual,
    smtpTransport: () => async (message: { to: readonly string[]; subject: string; body: string }) => {
      SENT.push(message);
    },
  };
});

import { start, type SelfhostHandle } from './index.ts';
import { mappingSeed, uuidFromString } from './config-dir.ts';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
const CHANNEL = { SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', NOTIFY_FROM: 'ownpace@example.invalid', NOTIFY_TO: 'ops@example.invalid' };
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  for (const key of Object.keys(CHANNEL)) delete process.env[key];
});

// UUID family 0128fe00-…, unused elsewhere in the repo.
const TENANT = '0128fe00-e29b-41d4-a716-446655440001';
const MAPPING = '0128fe00-e29b-41d4-a716-446655440002';
const ROW = uuidFromString(mappingSeed(TENANT, MAPPING));
const NOTE = 'It all lives on the new server now.';

const side = (type: 'caldav' | 'webdav', user: string) => ({
  type,
  url: 'http://127.0.0.1:1/remote.php/dav',
  user,
  auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
});
const domain = (type: 'caldav' | 'webdav') => ({
  enabled: true,
  source: side(type, 'source'),
  target: side(type, 'target'),
});

/** Calendars and files, both on. */
function configDir(): string {
  const dir = tempDir('ownpace-announce-cfg-');
  writeFileSync(
    join(dir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: side('caldav', 'source'),
      target: side('caldav', 'target'),
      domains: { calendar: domain('caldav'), files: domain('webdav') },
    }),
  );
  return dir;
}

async function boot(cfg: string, dataDir: string): Promise<{ handle: SelfhostHandle; base: string }> {
  const handle = await start({ persistence: 'pglite', pgliteDataDir: dataDir, configDir: cfg, port: 0, host: '127.0.0.1' });
  return { handle, base: `http://127.0.0.1:${handle.port}` };
}

async function asTheDatabase(dataDir: string, text: string, params: unknown[] = []) {
  const driver = pgliteDriver({ dataDir });
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as Array<Record<string, unknown>>;
  } finally {
    conn.release();
    await driver.end();
  }
}

/** The migration's phases, written as a cutover of one data type leaves them. */
async function phases(dataDir: string, status: string, calendar: string, file: string): Promise<void> {
  await asTheDatabase(dataDir, `UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [ROW, status]);
  await asTheDatabase(dataDir, `UPDATE path_lifecycle SET state = $2 WHERE mapping_id = $1 AND domain = 'calendar'`, [
    ROW,
    calendar,
  ]);
  await asTheDatabase(dataDir, `UPDATE path_lifecycle SET state = $2 WHERE mapping_id = $1 AND domain = 'file'`, [
    ROW,
    file,
  ]);
}

async function announce(base: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/mappings/${MAPPING}/sharing/announce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: NOTE, ...body }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Boot, press, and stop again: the database is the test's between boots. */
async function whileBooted<T>(cfg: string, dataDir: string, work: (base: string) => Promise<T>): Promise<T> {
  const booted = await boot(cfg, dataDir);
  try {
    return await work(booted.base);
  } finally {
    await booted.handle.stop();
  }
}

describe('each data type’s shares carried by hand, announced once, at its own cutover, on the appliance', () => {
  it('none cut over: refused; the calendars’ wave, then the files’, each once; mailed again only on purpose', async () => {
    Object.assign(process.env, CHANNEL);
    const cfg = configDir();
    const dataDir = tempDir('ownpace-announce-db-');
    await whileBooted(cfg, dataDir, async (base) => {
      expect((await fetch(`${base}/mappings/${MAPPING}/start`, { method: 'POST' })).status).toBe(200);
    });
    // Carried over by hand: a calendar and a file to one person, a file to another.
    for (const [n, subject, on, grantee] of [
      [11, 'calendar', 'Team planning', 'cas@example.invalid'],
      [12, 'drive_item', 'Projects/budget.xlsx', 'cas@example.invalid'],
      [13, 'drive_item', 'Projects/plan.odt', 'anna@example.invalid'],
    ] as const) {
      await asTheDatabase(
        dataDir,
        `INSERT INTO share_grant (id, tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, raw, verdict,
           verdict_target, state, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'read', '{}', 'clean', 'a Nextcloud share', 'done_manual', 'operator', now())`,
        [`0128fe00-e29b-41d4-a716-4466554400${n}`, TENANT, ROW, `hash-${n}`, subject, on, grantee],
      );
    }

    const early = await whileBooted(cfg, dataDir, (base) => announce(base));
    expect(early).toEqual({
      status: 409,
      body: { error: 'not_cut_over', reason: notCutOverToAnnounceReason(['calendar', 'drive_item']) },
    });
    expect(SENT).toEqual([]);

    // Calendars cut over on their own; the files still run.
    await phases(dataDir, 'active', 'cutover', 'active');
    await whileBooted(cfg, dataDir, async (base) => {
      const calendars = await announce(base);
      expect(calendars.status).toBe(200);
      expect(calendars.body).toMatchObject({ sent: ['cas@example.invalid'], waitingForCutover: 2, alreadyAnnounced: 0 });
      expect(SENT.map((m) => [m.to, m.body.includes('Team planning'), m.body.includes('budget')])).toEqual([
        [['cas@example.invalid'], true, false],
      ]);
      expect((await announce(base)).body.error).toBe('already_announced');
    });

    // The files cut over too.
    await phases(dataDir, 'cutover', 'cutover', 'cutover');
    SENT.length = 0;
    await whileBooted(cfg, dataDir, async (base) => {
      const files = await announce(base);
      expect(files.status).toBe(200);
      expect(files.body).toMatchObject({
        sent: ['anna@example.invalid', 'cas@example.invalid'],
        waitingForCutover: 0,
        alreadyAnnounced: 1,
        resend: false,
      });
      expect(SENT.every((m) => !m.body.includes('Team planning'))).toBe(true);
      expect((await announce(base)).body.error).toBe('already_announced');

      SENT.length = 0;
      const resent = await announce(base, { confirmResend: true });
      expect(resent.body).toMatchObject({ resend: true, sent: ['anna@example.invalid', 'cas@example.invalid'] });
      expect(SENT).toHaveLength(2);
    });

    const audit = await asTheDatabase(
      dataDir,
      `SELECT detail FROM audit_log WHERE action = 'share.announce' ORDER BY at`,
    );
    expect(audit.map((r) => [...((r.detail as { subjects: string[] }).subjects)].sort())).toEqual([
      ['calendar'],
      ['drive_item'],
      ['calendar', 'drive_item'],
    ]);
  }, 180_000);
});
