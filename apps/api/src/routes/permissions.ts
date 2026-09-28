// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * GET /api/permissions/report — the §14.2 inventory (workplan 0029 T1/T3/T4).
 *
 * Markdown, like the Pattern D runbook and for the same reason: it is a
 * document a person works through before a cutover, most of it on systems
 * this tool does not touch. Derived on every read rather than stored — a
 * permission granted this morning should be in the report this afternoon,
 * and a snapshot somebody has to remember to refresh is a snapshot that goes
 * stale precisely when it matters.
 *
 * READ-ONLY BY CONSTRUCTION. §14.2's apply step is deferred by owner decision
 * (workplan 0029), so this route reads Graph and returns text; there is no
 * write path here to get wrong.
 *
 * Until the source connection holds application permissions, the report is all
 * blind spots, honestly. That is the correct behaviour, and it becomes a real
 * inventory with no further code.
 *
 * The two scans this route composes have different standing (owner decision,
 * 2026-08-04). `Calendars.Read` is consented, so calendar sharing is a live
 * finding as soon as the connection carries application permissions.
 * `Files.Read.All` is not, and deliberately: an Exchange Application Access
 * Policy cannot narrow it, so it would grant read over every file in the
 * tenant. The drive section is therefore a STATED blind spot by default,
 * behind `GRAPH_FILES_READ_CONSENTED` for a deployment that decided otherwise.
 *
 * READ AS `app_user`, IN THE CALLER'S ORGANISATION (workplan 0138 T6). Until
 * 2026-09-28 this file opened its own pool on `DATABASE_URL`, which is the
 * database owner on managed and a superuser: row security never bound it, and
 * each query's own `tenant_id = $1` was the only thing between one organisation
 * and another. `resolveMappingMailbox` joined `mailbox` by id alone, so a
 * mapping whose `source_mailbox_id` named another organisation's mailbox read
 * that organisation's address. Every read here now runs inside `withTenant` on
 * `getDbPool()`, the request path's `app_user` pool, and the policies filter it
 * whatever its own WHERE says. The WHERE clauses stay, and that join now asks
 * for the mapping's own organisation too: where `getDbPool()` falls back to
 * `DATABASE_URL` (no `APP_DATABASE_URL`), they are still the only filter.
 * `a-report-under-row-security.integration.test.ts` holds the report to it, and
 * `scripts/a-route-that-opened-the-owners-pool.unit.test.ts` fails if a route
 * reads a database URL of its own again.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { sql } from 'drizzle-orm';
import { withTenant, type PgDatabase } from '@openmig/ledger';
import { authenticate, getDbPool } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import {
  googleMailboxDelegationNotRead,
  log,
  permissionsNotDiscoverable,
  resolveGoogleClient,
  type PermissionListing,
} from '@openmig/shared';
import { tenantFetch } from '@openmig/shared/reachable-host';
import {
  createTokenProvider,
  directoryAvailability,
  driveSharingAvailability,
  mailboxDelegations,
  resolveUserDriveId,
  scanCalendarPermissions,
  scanDrivePermissions,
  scanNextcloudShares,
  type HttpClient,
} from '@openmig/connectors';
import { runPermissionInventory } from '@openmig/core';
import { SecretStore } from '@openmig/core/secret-store';
import {
  buildGoogleDriveSourceFrom,
  STORED_GOOGLE_CREDENTIAL_NAMES,
} from '@openmig/orchestration/drive-source-factory';
import {
  connectionKindsWithFace,
  directorySourceOf,
  microsoftSourceKinds,
} from '@openmig/orchestration/source-face-builders';
import { measureTargetScheduling } from '@openmig/orchestration/target-scheduling';
import {
  qualificationReportLines,
  qualifyAccount,
} from '@openmig/orchestration/account-qualification';
import { davUrl } from '@openmig/orchestration/dav-endpoint';
import { serverFault } from '../server-fault.ts';
import { probeAnswers } from '../probe-answer.ts';
import { refusedOverTestLimit } from '../probe-limit.ts';
import { refusedAsClosed } from '../closed-organisation.ts';

const router = Router();

// One client for Graph and for the organisation's own Nextcloud. The second is
// a host a tenant gave us, so both go through the rule (0136 T1); Graph's
// address is public and passes it.
const httpClient: HttpClient = {
  async request({ url, method, headers }) {
    const res = await tenantFetch(url, { method, headers });
    return { status: res.status, body: await res.text(), headers: {} };
  },
};

// The request path's pool, built on first use as the other routes build theirs:
// `getDbPool()` throws when neither URL is set, so calling it at import would
// fail every importer that never asks for a report.
let _pool: ReturnType<typeof getDbPool> | null = null;
function pool(): ReturnType<typeof getDbPool> {
  if (!_pool) _pool = getDbPool();
  return _pool;
}

/**
 * Run `fn` in the caller's organisation, on the request path's pool.
 *
 * The ledger's `withTenant`, which `withTenantDb` in `auth.ts` wraps: one
 * transaction with `app.current_tenant` set, so on `app_user` the policies
 * filter every statement in it. Nothing slow happens inside: the scans and the
 * target's measurement run after the rows are read, outside the transaction.
 */
function inTenant<T>(tenantId: string, fn: (db: PgDatabase) => Promise<T>): Promise<T> {
  return withTenant(pool(), tenantId, fn);
}

/** The rows of one statement, typed as the caller reads them. */
async function rowsOf<R>(db: PgDatabase, query: ReturnType<typeof sql>): Promise<R[]> {
  return (await db.execute(query)).rows as R[];
}

/**
 * The report for one mailbox.
 *
 * Per mailbox rather than per tenant: permissions are held on somebody's
 * calendars and somebody's files, and a report that merged a whole tenant's
 * into one document would be unreadable at exactly the moment it is needed.
 */
router.get('/report', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
      return;
    }
    // Either the address directly, or a mapping to resolve it from. The
    // second is what the UI uses: a screen knows which migration the
    // operator is looking at, not which mailbox is behind it, and asking
    // somebody to retype their own address is a way to get it wrong.
    const asked = typeof req.query.mailbox === 'string' ? req.query.mailbox.trim() : '';
    const mappingId = typeof req.query.mappingId === 'string' ? req.query.mappingId.trim() : '';
    let mailbox = asked;

    if (mailbox === '' && mappingId !== '') {
      mailbox = (await resolveMappingMailbox(tenantId, mappingId)) ?? '';
      if (mailbox === '') {
        // A mapping whose source address the ledger never recorded cannot be
        // inventoried, and saying which is missing beats a bare 400 (rule 9).
        res.status(409).json({
          error: 'Conflict',
          message:
            'This migration does not record which mailbox it reads, so its permissions ' +
            'cannot be inventoried. Ask for a mailbox directly: ?mailbox=someone@example.com',
        });
        return;
      }
    }

    if (mailbox === '') {
      res.status(400).json({
        error: 'Bad Request',
        message:
          'a mailbox is required: GET /api/permissions/report?mailbox=someone@example.com ' +
          '(or ?mappingId=… to resolve it from a migration)',
      });
      return;
    }

    // The report reads the source and measures the destination with their
    // stored access, so a closed organisation gets none (0085 T2). Asked in
    // the caller's organisation, on the same pool as every read here.
    if (await refusedAsClosed(res, tenantId, pool())) return;

    // The report measures the organisation's own DAV target again, at the
    // address somebody typed: one test against the member's limit (0136 T3).
    if (refusedOverTestLimit(req, res)) return;

    const scans = await tenantInventoryScans(tenantId, mailbox);


    // The target's side of the story (0105 T0): measured live at report
    // time, same derive-on-every-read philosophy as the scans. Undefined for
    // a tenant with no DAV target — the section then does not appear.
    const measureTargetConduct = await tenantTargetConduct(tenantId);

    const markdown = await runPermissionInventory({
      mappingLabel: mailbox,
      generatedOn: new Date().toISOString().slice(0, 10),
      // Always in the report, and now worded for the tenant's own source —
      // see `tenantInventoryScans`.
      delegationReason: scans.delegationReason,
      // BOTH scans are always passed, even when nothing can be read. An
      // omitted dep falls back to the pass's generic "no reader is
      // configured", and these two are not unconfigured — each has a specific
      // reason a reader can act on, and they are different reasons.
      scanCalendars: scans.scanCalendars,
      scanDrive: scans.scanDrive,
      ...(measureTargetConduct ? { measureTargetConduct } : {}),
      error: (m, err) => log.error(m, err instanceof Error ? err.message : err),
    });

    res.type('text/markdown; charset=utf-8').send(markdown);
  } catch (error) {
    serverFault(res, 'report_failed', 'rendering the permission report', error);
  }
});

type Available = Extract<ReturnType<typeof directoryAvailability>, { ok: true }>;

/**
 * WHY AN `o365` SOURCE'S SHARING WAS NOT READ, for the person on the Finish
 * page (workplan 0141 T11). The reason `directoryAvailability` gives names this
 * stack's `OAUTH2_*` settings, and is written for an operator. What is true for
 * a tester is that this deployment reads a directory with its own settings,
 * never with the registration the customer stored on the connection.
 */
export const O365_NOT_READ_WITH_ITS_OWN_REGISTRATION =
  "this deployment does not yet read a directory with the organisation's own app registration, " +
  'so sharing on this Microsoft 365 source was not read. Note it by hand before cutover';

function graphToken(available: Available, graphTenantId: string): () => Promise<string> {
  const provider = createTokenProvider({
    tokenEndpoint: `https://login.microsoftonline.com/${graphTenantId}/oauth2/v2.0/token`,
    clientId: available.clientId,
    clientSecret: available.clientSecret,
    tenantId: graphTenantId,
    scope: 'https://graph.microsoft.com/.default',
  });
  return async () => (await provider.getToken()).accessToken;
}

/**
 * The mailbox behind a mapping, when it recorded one — the same resolution
 * the report route uses, exported so the sharing queue's rescan (ADR-0032)
 * asks the identical question and refuses with the identical sentence.
 */
export async function resolveMappingMailbox(
  tenantId: string,
  mappingId: string,
): Promise<string | undefined> {
  // The mailbox must be the mapping's own organisation's, not merely the one
  // `source_mailbox_id` names. Under row security another organisation's
  // mailbox is not there to join; on the owner's connection, which
  // `getDbPool()` falls back to without `APP_DATABASE_URL`, this is the filter.
  const rows = await inTenant(tenantId, (db) =>
    rowsOf<{ primary_address: string | null }>(
      db,
      sql`SELECT mb.primary_address
       FROM mailbox_mapping mm
       JOIN mailbox mb ON mb.id = mm.source_mailbox_id AND mb.tenant_id = mm.tenant_id
      WHERE mm.tenant_id = ${tenantId} AND mm.id = ${mappingId}`,
    ),
  );
  const address = rows[0]?.primary_address?.trim() ?? '';
  return address === '' ? undefined : address;
}

/**
 * What the tenant's TARGET will do with what a migration writes (0105 T0) —
 * the scheduling verdict, measured on the connected DAV target the way the
 * scans resolve the source. Returns undefined when no such target is
 * connected: a mail-only tenant gets no section rather than a vacuous one.
 * carddav is excluded — an address-book target has no scheduling to measure.
 */
async function tenantTargetConduct(
  tenantId: string,
): Promise<(() => Promise<readonly string[]>) | undefined> {
  const rows = await inTenant(tenantId, (db) =>
    rowsOf<{ secret_ref: string | null; config: unknown; kind: string }>(
      db,
      sql`SELECT secret_ref, config, kind FROM connection
      WHERE tenant_id = ${tenantId} AND role = 'target' AND kind IN ('caldav', 'nextcloud', 'webdav') LIMIT 1`,
    ),
  );
  const target = rows[0];
  if (!target) return undefined;
  return async () => {
    const config = (target.config ?? {}) as Record<string, unknown> & {
      credentials?: Record<string, string>;
    };
    const creds = target.secret_ref
      ? SecretStore.decryptCredentials(target.secret_ref)
      : (config.credentials ?? {});
    // The full qualification when the kind supports it (0106 T0): which
    // object types this account answered for, with the scheduling verdict
    // folded into the calendar face it belongs to.
    const qualification = await qualifyAccount(target.kind, config, {
      username: creds.username ?? '',
      password: creds.password ?? '',
    });
    // The target's address is one the organisation typed, so a face it
    // refused is said from its parts, as on the Test button (0136 T3).
    if (qualification) {
      return qualificationReportLines(
        probeAnswers('reporting permissions', tenantId).qualification(qualification),
      );
    }
    const verdict = await measureTargetScheduling(
      davUrl(config),
      creds.username ?? '',
      creds.password ?? '',
    );
    return [verdict.sentence];
  };
}

/**
 * The two §14.2 scans for one tenant's mailbox, resolved from what the tenant
 * actually connected (workplan 0029 T1/T5) — used by the report route above
 * AND by the sharing queue's rescan (ADR-0032), so the queue can never know
 * more or less than the report.
 *
 * A Google Drive source's outbound shares are readable with the Drive scope
 * the connection already holds — no extra consent decision, unlike
 * `Files.Read.All`. A tenant carrying BOTH an o365 and a google-drive source
 * gets the Drive answer for the file section (its files are the ones
 * migrating through this tool) and the Graph answer for calendars.
 */
export async function tenantInventoryScans(
  tenantId: string,
  mailbox: string,
): Promise<{
  scanCalendars: () => Promise<PermissionListing>;
  scanDrive: () => Promise<PermissionListing>;
  /**
   * Mailbox delegation, unread, worded for THIS tenant's source. Carried here
   * rather than called inline by each consumer so the report and the sharing
   * checklist cannot say different things about the same account.
   */
  delegationReason: string;
}> {
  // The three lookups, in one transaction in the caller's organisation.
  const { microsoftRows, driveRows, davRows } = await inTenant(tenantId, async (db) => ({
    // EVERY MICROSOFT KIND, not `o365` alone (workplan 0141 T11). A tenant whose
    // source was a Microsoft account found nothing here, and its calendar section
    // said the tenant had no Microsoft 365 source connection.
    microsoftRows: await rowsOf<{ kind: string; config: unknown }>(
      db,
      sql`SELECT kind, config FROM connection
      WHERE tenant_id = ${tenantId} AND role = 'source' AND kind = ANY(${sql.param([...microsoftSourceKinds()])}::text[])`,
    ),
    // EVERY STORED KIND WHOSE FILE FACE IS THE DRIVE CONNECTOR — asked of the
    // table that decides it, because the literal this line used to carry was
    // not a `connection.kind` at all.
    //
    // THE DEFECT (the owner, 2026-09-17: the Sharing page found no Google
    // sharings on a live migration full of them). This query read
    // `kind = 'google-drive'`, and that value cannot appear in the column: the
    // CHECK constraint migration 0008 added spells it `google_drive`, and the
    // hyphen is the WIZARD's word for the same provider. So the lookup matched
    // nothing for anybody, ever — not the `google` ACCOUNT kind the owner was
    // running, and not the legacy Drive connection it was written for. The scan
    // below never ran, and the page printed a not-discoverable sentence written
    // for a different source, which reads as "nothing is shared". Hard rule 9
    // forbids a blind spot to look like a finding, and this one did.
    //
    // Both halves are fixed by asking the right question: `connectionKindsWithFace`
    // reads `ACCOUNT_FACE_BUILDERS` and `SINGLE_PURPOSE_FACES`, which is where
    // `google` (the account kind, whose file face IS `google-drive`) and
    // `google_drive` (the single-purpose row) are already written down. A kind
    // that gains a Drive face is in this answer the day the table says so.
    driveRows: await rowsOf<{ secret_ref: string | null; config: unknown }>(
      db,
      sql`SELECT secret_ref, config FROM connection
      WHERE tenant_id = ${tenantId} AND role = 'source' AND kind = ANY(${sql.param([...connectionKindsWithFace('file', 'google-drive')])}::text[]) LIMIT 1`,
    ),
    // A Nextcloud (or plain-WebDAV) source: its outbound shares are one OCS GET
    // away (0104 T2). Before this, a DAV source's sharing was a blind spot with
    // a Graph-worded reason — the wrong errand entirely.
    davRows: await rowsOf<{ secret_ref: string | null; config: unknown }>(
      db,
      sql`SELECT secret_ref, config FROM connection
      WHERE tenant_id = ${tenantId} AND role = 'source' AND kind IN ('nextcloud', 'webdav') LIMIT 1`,
    ),
  }));

  const microsoftSource = directorySourceOf(microsoftRows);
  const graphTenantId = (microsoftSource?.config as { tenantId?: string } | undefined)?.tenantId;
  const available = directoryAvailability(process.env, graphTenantId, microsoftSource?.kind);
  // What a section says when Graph could not be asked. For a Microsoft source
  // it is in the tester's words: an account's delegated grant, or, for the
  // customer's own registration, that this deployment does not use it.
  const graphUnread = (reason: string): PermissionListing => ({
    kind: 'not_discoverable',
    reason: microsoftSource
      ? permissionsNotDiscoverable(
          microsoftSource.kind === 'o365' ? O365_NOT_READ_WITH_ITS_OWN_REGISTRATION : reason,
        )
      : reason,
  });
  const scanOptions = { applicationPermissions: true } as const;
  // Asked once, so every caller says the same thing about the drive section
  // whether or not the connection could have made the request anyway.
  const drive = driveSharingAvailability(process.env);

  const googleDriveConnection = driveRows[0];
  const davSourceConnection = davRows[0];

  return {
    // A Google tenant gets Google's sentence. `mailboxDelegations()` names
    // `Get-MailboxPermission` and `Get-RecipientPermission`, which are
    // Exchange Online PowerShell and will never run against a Gmail account —
    // the same wrong errand the calendar branch below already avoids. "No
    // Microsoft source" is the row, not its tenant id: a Microsoft account
    // stores none (0141 T11).
    delegationReason:
      googleDriveConnection && !microsoftSource
        ? googleMailboxDelegationNotRead()
        : (() => {
            const d = mailboxDelegations();
            // `mailboxDelegations()` is always `not_discoverable`; the
            // narrowing is the type system's, not a runtime possibility.
            return d.kind === 'not_discoverable' ? d.reason : 'not inventoried';
          })(),
    scanCalendars: async () =>
      available.ok
        ? scanCalendarPermissions(
            mailbox,
            graphToken(available, graphTenantId!),
            httpClient,
            scanOptions,
          )
        : microsoftSource
          ? graphUnread(available.reason)
          : googleDriveConnection
            ? {
                // A Google tenant would otherwise get a Graph-worded reason
                // about an app registration it never had — a wrong errand.
                kind: 'not_discoverable' as const,
                reason: permissionsNotDiscoverable(
                  'Google Calendar sharing is not yet read by this tool — the Drive scan ' +
                    'covers files only. Capture calendar sharing by hand before cutover',
                ),
              }
            : davSourceConnection
              ? {
                  // Same courtesy for a Nextcloud tenant (0104 T2): the file
                  // share scan covers files; calendar sharing stays by hand.
                  kind: 'not_discoverable' as const,
                  reason: permissionsNotDiscoverable(
                    'Nextcloud calendar sharing is not yet read by this tool — the share ' +
                      'scan covers files only. Capture calendar sharing by hand before cutover',
                  ),
                }
              : { kind: 'not_discoverable' as const, reason: available.reason },
    scanDrive: async () => {
      if (googleDriveConnection) {
        try {
          const config = (googleDriveConnection.config ?? {}) as {
            credentials?: Record<string, string>;
          };
          const creds = googleDriveConnection.secret_ref
            ? SecretStore.decryptCredentials(googleDriveConnection.secret_ref)
            : (config.credentials ?? {});
          // THE DEPLOYMENT MAY CARRY THE CLIENT (ADR-0041). An account
          // connection made through Connect with Google stores the refresh
          // token and, when the deployment has its own application, no client
          // pair at all — so handing these credentials straight to the builder
          // would refuse for a missing clientId on a connection that is
          // perfectly usable. The same resolver every other Google door uses
          // decides, and its refusal is a sentence rather than a throw.
          const client = resolveGoogleClient({
            clientId: creds['clientId'],
            clientSecret: creds['clientSecret'],
          });
          if (!client.ok) {
            return {
              kind: 'not_discoverable' as const,
              reason: permissionsNotDiscoverable(client.reason),
            };
          }
          const source = buildGoogleDriveSourceFrom(
            {},
            { ...creds, clientId: client.clientId, clientSecret: client.clientSecret },
            STORED_GOOGLE_CREDENTIAL_NAMES,
          ) as unknown as {
            listOwnedShareGrants(): Promise<PermissionListing>;
          };
          return await source.listOwnedShareGrants();
        } catch (err) {
          return {
            kind: 'not_discoverable' as const,
            reason: permissionsNotDiscoverable(
              err instanceof Error ? err.message : String(err),
            ),
          };
        }
      }
      if (davSourceConnection) {
        const config = (davSourceConnection.config ?? {}) as {
          baseUrl?: string;
          host?: string;
          port?: number;
          useSsl?: boolean;
          credentials?: Record<string, string>;
        };
        const creds = davSourceConnection.secret_ref
          ? SecretStore.decryptCredentials(davSourceConnection.secret_ref)
          : (config.credentials ?? {});
        const webdavUrl =
          config.baseUrl ??
          `${config.useSsl === false ? 'http' : 'https'}://${config.host}${config.port ? `:${config.port}` : ''}`;
        return scanNextcloudShares({
          webdavUrl,
          username: creds.username ?? '',
          password: creds.password ?? '',
          httpClient,
        });
      }
      // The consent decision answers first, because it holds whatever the
      // credentials say: a deployment without `Files.Read.All` would get a
      // 403 here, and a 403 reads as a fault to fix rather than a choice.
      if (!drive.ok) return { kind: 'not_discoverable' as const, reason: drive.reason };
      if (!available.ok) return graphUnread(available.reason);
      // `/drives/{id}` is the only addressing the sharing endpoints take, so
      // the drive id is resolved first rather than built by concatenation.
      const token = graphToken(available, graphTenantId!);
      const found = await resolveUserDriveId(mailbox, token, httpClient, scanOptions);
      if (!found.ok) return { kind: 'not_discoverable' as const, reason: found.reason };
      return scanDrivePermissions(found.id, token, httpClient, scanOptions);
    },
  };
}

export default router;
