// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHERE A PASS WRITES A SOVERIN MAILBOX'S CALENDARS, CONTACTS AND TASKS
 * (workplan 0175 §5.4, D6 (a)).
 *
 * The DAV writers read the root that answered, and the login, from the record
 * the Test kept (`qualification.soverin`), not from the boxes the form
 * pre-filled. A row tested before 0175 has no record: its next pass measures
 * the kind once, before its DAV faces, and remembers it on the row, so the
 * passes after it read it. A row whose kind is `unknown` is written where it
 * was tested (`config.host`), as every Soverin row was before; the DAV faces
 * then fail or pass in the server's own words, never on a guess.
 *
 * A switch between personal and Suite is not followed (the maintainer,
 * 2026-11-25): a pass does not measure a row that already has a kind. Testing
 * the account again measures it again.
 */

import type { Pool } from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import { connection as connectionTable, withTenant } from '@openmig/ledger';
import {
  davConfigOf,
  davLoginOf,
  signsInToDavApart,
  soverinRecordOf,
  SUITE_LOGIN_KEYS,
  type SoverinRecord,
} from '@openmig/shared';

/** The target row as `loadDomainConnections` reads it, with its stored record. */
export interface PassTarget {
  readonly kind: string;
  readonly id: string;
  readonly config: Record<string, unknown>;
  readonly creds: Record<string, string>;
  readonly qualification: unknown;
}

export interface SoverinPassDeps {
  /** B, measured whole (`measureSoverinKind`). */
  readonly measure: (
    config: Readonly<Record<string, unknown>>,
    login: { readonly username: string; readonly password: string },
  ) => Promise<SoverinRecord>;
  /** Keep the record on the row, beside the faces its Test measured. */
  readonly remember: (record: SoverinRecord) => Promise<void>;
}

/**
 * The target a DAV face of this pass is built from: for a `soverin` row, the
 * config and login its kind names, measured first if it has none; for any
 * other kind, the row as it is.
 */
export async function soverinTargetForPass<T extends PassTarget>(target: T, deps: SoverinPassDeps): Promise<T> {
  if (!signsInToDavApart(target.kind)) return target;
  let qualification: unknown = target.qualification;
  if (!soverinRecordOf(qualification)) {
    // Measured with the mailbox login: a row with no record has never been
    // found to be Suite, and the personal server is what it was tested on.
    const record = await deps.measure(target.config, davLoginOf(target.kind, undefined, target.creds));
    await deps.remember(record);
    qualification = { ...(typeof qualification === 'object' && qualification !== null ? qualification : {}), soverin: record };
  }
  const login = davLoginOf(target.kind, qualification, target.creds);
  if (!login.username || !login.password) {
    const missing = SUITE_LOGIN_KEYS.filter((key) => !target.creds[key]);
    throw new Error(
      `This Soverin mailbox's calendars and contacts are on Soverin Suite, which signs in with a Suite app ` +
        `password, and this account stores none (${missing.join(', ')} missing). Add the Suite login to the ` +
        'account, then run the migration again.',
    );
  }
  return {
    ...target,
    config: davConfigOf(target.kind, target.config, qualification),
    creds: { ...target.creds, username: login.username, password: login.password },
    qualification,
  };
}

/**
 * A Soverin row's measured kind, kept on the row beside the faces its last
 * Test measured (workplan 0175 D6 (a)). Only on a row that HAS such a record:
 * a row never tested has nothing to sit beside, and its next Test writes the
 * whole record. A record already there is left as it is: the first pass to
 * measure wins, and a pass racing it measured the same server.
 */
export async function rememberSoverinKind(
  pool: Pool,
  tenantId: string,
  connectionId: string,
  record: SoverinRecord,
): Promise<void> {
  await withTenant(pool, tenantId, (txDb) =>
    txDb
      .update(connectionTable)
      .set({
        qualification: sql`${connectionTable.qualification} || jsonb_build_object('soverin', ${JSON.stringify(record)}::jsonb)`,
      })
      .where(
        and(
          eq(connectionTable.id, connectionId),
          eq(connectionTable.tenantId, tenantId),
          sql`${connectionTable.qualification} is not null`,
          sql`not (${connectionTable.qualification} ? 'soverin')`,
        ),
      ),
  );
}
