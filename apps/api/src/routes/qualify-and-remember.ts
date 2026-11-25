// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * MEASURING A STORED ACCOUNT AGAIN, IN A MODULE OF ITS OWN (workplan 0006 §R,
 * CQ-06). Qualifying an account and remembering the answer on its row used to
 * live in `connections.ts`, beside the doors that call it. The consent that
 * connects a Cirrux Drive needs it too, and that consent is mounted by the
 * migration routes, which `connections.ts` imports for its shape builders: the
 * consent could only reach back with a lazy import, to keep the cycle from
 * biting at load time. Here it reaches neither `connections.ts` nor
 * `migrations/index.ts`, so both import it statically.
 * `no-way-back-to-the-connection-routes.unit.test.ts` keeps the cycle from
 * coming back.
 *
 * The same functions, logs, budgets and audit events as before the move; the
 * connection doors and this family share one database pool, as they did.
 */

import { eq, and } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgLedger } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { CirruxDriveApi, CirruxTokenProvider, type CirruxAccessToken } from '@openmig/connectors';
import { PgCirruxGrantStore } from '@openmig/orchestration/cirrux-grant-store';
import {
  isDropboxKind,
  isGoogleGrantKind,
  isQualifiableKind,
  qualifyAccount,
  isArchiveKind,
  qualifyArchive,
  qualifyDropbox,
  qualifyGoogleGrant,
  type AccountQualification,
  type QualifyDeps,
} from '@openmig/orchestration/account-qualification';
import {
  isMicrosoftGrantKind,
  qualifyMicrosoftAccount,
} from '@openmig/orchestration/microsoft-account-test';
import { cirruxDeploymentClient, log } from '@openmig/shared';
import type { TenantId } from '@openmig/shared';
import { getDbPool, withTenantDb } from '../middleware/auth.ts';
import { probeAnswers, type ProbeAnswers } from '../probe-answer.ts';
import { withinBudget } from './within-budget.ts';

let _pool: ReturnType<typeof getDbPool> | null = null;
/** The pool the connection doors and this family share, opened on first use. */
export function connectionsPool() {
  if (!_pool) _pool = getDbPool();
  return _pool;
}
const pool = connectionsPool;

/**
 * Qualify the account behind a connection and REMEMBER the answer
 * (workplan 0106 T0): what the last test measured, per domain, stored on the
 * row and recorded to the audit log. Runs beside the headline probe, never
 * instead of it, and NEVER fails a test — a qualification that could not be
 * taken is reported to the log and the test result stands (the probe's own
 * verdict is the thing the person asked for).
 */
/**
 * THE DOOR ANSWERS BEFORE THE BROWSER GIVES UP (2026-09-02, the owner's
 * whole-Dropbox test). The web client waits 30 s; a door probes (its own
 * deadline, `PROBE_DEADLINE_MS`), writes the row, then qualifies the account,
 * and the qualification gets what is left of this budget — never less than
 * the floor. Past it the door answers `qualificationPending` and the
 * measuring finishes on its own, into the row.
 */
export const DOOR_BUDGET_MS = 26_000;
const QUALIFICATION_FLOOR_MS = 3_000;

export async function qualifyAndRemember(
  tenantId: string,
  connectionId: string,
  kind: string,
  config: Record<string, unknown>,
  creds: Record<string, string>,
  actor: string,
  deadlineAt: number,
  /** The request's answers, so a refused face is stored said from its parts (0136 T3). */
  answers: ProbeAnswers,
  /** A Cirrux access token already in hand (the consent's), so measuring the Drive spends no refresh. */
  cirruxAccess?: CirruxAccessToken,
): Promise<AccountQualification | 'pending' | undefined> {
  // EVERY KIND THAT HAS A QUALIFIER, and this list is the whole reason the
  // dispatch below can be trusted. It is also where 0116 T7 was briefly
  // broken: `qualifyArchive` was wired into `qualifyAndRememberNow` and an
  // `archive` row still never reached it, because this guard did not name the
  // kind and returned `undefined` one function earlier. Nothing failed — the
  // connection stored fine, the probe answered fine, and the Measured line
  // simply never appeared. The unit tests called `qualifyArchive` directly and
  // were green throughout.
  //
  // That is the family this repository keeps meeting: a new kind must reach
  // every table, and the tables that GATE are the ones whose absence is
  // invisible. `smoke-managed.sh` is what turned it into a failure, by
  // measuring a Takeout on the deployed image. Since 0136 T5 the managed API
  // refuses the disk path that step used, and since 0148 T9 the gate reads
  // its Takeout from the demo Nextcloud's files (`where: "target"`) through a
  // migration's preflight instead. A connection in the destination's files
  // reaches this dispatch too, and is answered unknown with the reason: it
  // has no destination to read through until a migration names one.
  if (
    !isQualifiableKind(kind) &&
    !isGoogleGrantKind(kind) &&
    !isMicrosoftGrantKind(kind) &&
    !isDropboxKind(kind) &&
    !isArchiveKind(kind)
  ) {
    return undefined;
  }
  return withinBudget(
    qualifyAndRememberNow(tenantId, connectionId, kind, config, creds, actor, answers, cirruxAccess),
    Math.max(QUALIFICATION_FLOOR_MS, deadlineAt - Date.now()),
  );
}

/**
 * HOW A TEST REACHES A CIRRUX ACCOUNT'S DRIVE (workplan 0160 T5; ADR-0052):
 * through the account's own stored sign-in, refreshed under the ROW's lock and
 * written back there, the way a pass reaches it. Only the caller that holds
 * the row can build this, which is why the qualifier is handed it rather than
 * building it. No client on the deployment, nothing is built: the face's
 * measured no says so before anything would be asked.
 */
function cirruxQualifyDeps(
  tenantId: string,
  connectionId: string,
  kind: string,
  cirruxAccess?: CirruxAccessToken,
): QualifyDeps {
  const client = kind === 'cirrux' ? cirruxDeploymentClient() : null;
  if (!client) return {};
  return {
    cirruxDrive: () =>
      new CirruxDriveApi({
        tokens: new CirruxTokenProvider({
          clientId: client.clientId,
          store: new PgCirruxGrantStore({ pool: pool(), tenantId, connectionId }),
          ...(cirruxAccess ? { initial: cirruxAccess } : {}),
        }),
      }),
  };
}

/**
 * MEASURE A STORED ACCOUNT AGAIN, FROM ITS ROW (workplan 0160 T5). A consent
 * that adds a face to an account (*Connect Cirrux Drive*) changes what the
 * account can carry without anybody pressing Test, so it asks for what a Test
 * does after its probe: the row read and decrypted, the account qualified,
 * and the answer remembered on the row, where the Accounts page and *Where
 * does it go?* read it. The headline probe is not run again: the app password
 * did not change. With no stored credential there is nothing to measure.
 */
export async function requalifyStoredConnection(
  tenantId: string,
  connectionId: string,
  actor: string,
  cirruxAccess?: CirruxAccessToken,
): Promise<AccountQualification | 'pending' | undefined> {
  const found = await withTenantDb(tenantId, pool(), (db) =>
    db
      .select({ kind: schema.connection.kind, config: schema.connection.config, secretRef: schema.connection.secretRef })
      .from(schema.connection)
      .where(and(eq(schema.connection.id, connectionId), eq(schema.connection.tenantId, tenantId))),
  );
  const row = found[0];
  if (!row?.secretRef) return undefined;
  return qualifyAndRemember(
    tenantId,
    connectionId,
    row.kind,
    (row.config ?? {}) as Record<string, unknown>,
    SecretStore.decryptCredentials(row.secretRef),
    actor,
    Date.now() + DOOR_BUDGET_MS,
    probeAnswers('connecting an account', tenantId),
    cirruxAccess,
  );
}

async function qualifyAndRememberNow(
  tenantId: string,
  connectionId: string,
  kind: string,
  config: Record<string, unknown>,
  creds: Record<string, string>,
  actor: string,
  answers: ProbeAnswers,
  cirruxAccess?: CirruxAccessToken,
): Promise<AccountQualification | undefined> {
  try {
    // Probe-qualified for the Basic-auth families; grant-qualified for the
    // Google kinds (0106 T1a) — the token response's scope field says what
    // the grant ACTUALLY carries, never the wizard kind it was typed under.
    // AND REACHED (2026-09-02): each face the grant carries is asked as a
    // pass would ask it, from the row's own address and blob, so a switch
    // left off in the client's project shows here and not at the first
    // migration. The owner's "5 calendars and nothing about the other three".
    // AND THE DROPBOX ACCOUNT (2026-09-02): one face, its top-level count
    // and the bytes in use — the Measured line the owner asked for on Drive,
    // on the connection he tested next.
    // AND THE EXPORT ARCHIVE (workplan 0116 T7): items, bytes, folders, the
    // span the export covers and the count broken down — the whole point of
    // the archive's first slice, which is that somebody sees what their
    // export holds BEFORE anyone commits to importing 25 GB of it. It takes
    // no credentials, which is why it is the one qualifier here that is
    // passed the config alone.
    const qualification =
      (await qualifyAccount(kind, config, creds, cirruxQualifyDeps(tenantId, connectionId, kind, cirruxAccess))) ??
      (await qualifyGoogleGrant(kind, creds, {
        reach: { user: String(config.user ?? ''), config },
      })) ??
      // AND THE MICROSOFT ACCOUNT (0114 T10): the grant read for what it
      // carries, every carried face reached as a pass would, the drive's
      // quota and the message count on the Measured line — the owner's
      // first Microsoft Test read "no check exists", on a grant that worked.
      (await qualifyMicrosoftAccount(kind, config, creds)) ??
      (await qualifyDropbox(kind, config, creds)) ??
      (await qualifyArchive(kind, config));
    if (!qualification) return undefined;
    // STORED AS IT IS ANSWERED (0136 T3): a face refused at an address the
    // tester typed is said from its parts, and the row keeps that, not the
    // remote's bytes. The full text is in the log under the reference.
    const answered = answers.qualification(qualification);
    await withTenantDb(tenantId, pool(), async (db) => {
      await db
        .update(schema.connection)
        .set({ qualification: answered, updatedAt: new Date() })
        .where(
          and(eq(schema.connection.id, connectionId), eq(schema.connection.tenantId, tenantId)),
        );
      try {
        await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
          actor,
          action: 'connection.qualified',
          entity: 'connection',
          detail: {
            connectionId,
            mail: qualification.domains.mail.answer,
            calendar: qualification.domains.calendar.answer,
            contact: qualification.domains.contact.answer,
            file: qualification.domains.file.answer,
            ...(qualification.scheduling
              ? { scheduling: qualification.scheduling.capability }
              : {}),
          },
        });
      } catch (err) {
        log.error('recording the qualification failed (the row itself is updated)', err);
      }
    });
    return answered;
  } catch (err) {
    log.error('[qualify] the account could not be qualified; the test result stands', err);
    return undefined;
  }
}
