// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Where this process's audit lines go, and the key their pseudonyms are made
 * with (workplan 0129 T4; the owner's D4 and D5: "written to stdout", and the
 * appliance exports "only to where its owner points it").
 *
 * The line is `auditExportLine`'s (shared). This file supplies the two things
 * that need the database: the key, kept per deployment so a pseudonym is the
 * same after a restart, and a sink that writes one line per event to the
 * process's output, where a collector reads container output. Nothing is sent
 * anywhere else, on either edition.
 */

import { randomBytes } from 'node:crypto';
import {
  AUDIT_PSEUDONYM_PURPOSE,
  auditExportLine,
  pseudonymizer,
  type AuditExportSink,
} from '@openmig/shared';
import type { LedgerDriver } from './driver.ts';

/**
 * This deployment's key for a purpose (ledger migration 0062), made the first
 * time it is asked for and the same ever after.
 *
 * Read on a connection of the driver's own, as the owner: the request path has
 * no privilege on the table, and a handle that skipped the driver's queue would
 * run inside whatever transaction was open on PGlite's one connection.
 */
export async function deploymentKeyFor(driver: LedgerDriver, purpose: string): Promise<Uint8Array> {
  const conn = await driver.acquire();
  let stored: string | undefined;
  try {
    await conn.query('INSERT INTO deployment_key (purpose, key) VALUES ($1, $2) ON CONFLICT (purpose) DO NOTHING', [
      purpose,
      randomBytes(32).toString('hex'),
    ]);
    const { rows } = await conn.query<{ key: string }>('SELECT key FROM deployment_key WHERE purpose = $1', [
      purpose,
    ]);
    stored = rows[0]?.key;
  } catch (err) {
    conn.release(err as Error);
    throw err;
  }
  conn.release();
  if (!stored) throw new Error(`The ${purpose} key could not be kept`);
  return Uint8Array.from(Buffer.from(stored, 'hex'));
}

/**
 * One JSON line per audit event, on the process's output.
 *
 * The key is read the first time a line is written, not at start, so a
 * process that never records an event never asks for it; a failed read is
 * forgotten, so the next event asks again rather than every later line failing.
 */
export function auditExportOn(
  driver: LedgerDriver,
  resource: Readonly<Record<string, string>>,
  write: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
): AuditExportSink {
  let key: Promise<Uint8Array> | undefined;
  return {
    async record(event) {
      key ??= deploymentKeyFor(driver, AUDIT_PSEUDONYM_PURPOSE);
      let pseudonym;
      try {
        pseudonym = pseudonymizer(await key);
      } catch (err) {
        key = undefined;
        throw err;
      }
      write(JSON.stringify(auditExportLine(event, { pseudonym, resource })));
    },
  };
}
