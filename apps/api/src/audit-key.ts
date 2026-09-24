// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The audit export's pseudonym key, for a route that serves the lines (workplan
 * 0129 T4, the managed download).
 *
 * The key is the owner's alone (ledger migration 0062): the request path
 * connects as `app_user` and may not read it. So `index.ts` hands this module
 * the same owner's connection it gives the stream's sink, a pool of one on the
 * address its migrations use, and the download reads the key through it. The
 * same key, so a person is the same pseudonym in a downloaded line as in the
 * line the process printed when the event was recorded.
 */

import { deploymentKeyFor, type LedgerDriver } from '@openmig/ledger';
import { AUDIT_PSEUDONYM_PURPOSE } from '@openmig/shared';

let driver: LedgerDriver | undefined;
let key: Promise<Uint8Array> | undefined;

/** The owner's connection the key is read on; set once, at start-up. */
export function setAuditKeyDriver(next: LedgerDriver | undefined): void {
  driver = next;
  key = undefined;
}

/**
 * This deployment's pseudonym key, read once and kept. A read that fails is
 * not kept, so the next download asks again rather than failing for ever.
 */
export function auditPseudonymKey(): Promise<Uint8Array> {
  if (!driver) {
    return Promise.reject(
      new Error("the audit key's connection is not set: the API sets it once its migrations have run"),
    );
  }
  key ??= deploymentKeyFor(driver, AUDIT_PSEUDONYM_PURPOSE).catch((error: unknown) => {
    key = undefined;
    throw error;
  });
  return key;
}
