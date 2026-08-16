// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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
 */

import { Router } from 'express';
import type { Response } from 'express';
import { authenticate } from '../middleware/auth';
import type { AuthenticatedRequest } from '../types/api';
import { log, permissionsNotDiscoverable, type PermissionListing } from '@openmig/shared';
import {
  createTokenProvider,
  directoryAvailability,
  driveSharingAvailability,
  mailboxDelegations,
  resolveUserDriveId,
  scanCalendarPermissions,
  scanDrivePermissions,
  type HttpClient,
} from '@openmig/connectors';
import { runPermissionInventory } from '@openmig/core';
import { SecretStore } from '@openmig/core/secret-store';
import {
  buildGoogleDriveSourceFrom,
  STORED_GOOGLE_CREDENTIAL_NAMES,
} from '@openmig/orchestration/drive-source-factory';
import { Pool } from 'pg';

const router = Router();

const httpClient: HttpClient = {
  async request({ url, method, headers }) {
    const res = await fetch(url, { method, headers });
    return { status: res.status, body: await res.text(), headers: {} };
  },
};

let _pool: Pool | null = null;
function pool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
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
      const { rows: found } = await pool().query<{ primary_address: string | null }>(
        `SELECT mb.primary_address
           FROM mailbox_mapping mm
           JOIN mailbox mb ON mb.id = mm.source_mailbox_id
          WHERE mm.tenant_id = $1 AND mm.id = $2`,
        [tenantId, mappingId],
      );
      mailbox = found[0]?.primary_address?.trim() ?? '';
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

    const { rows } = await pool().query<{ config: unknown }>(
      `SELECT config FROM connection
        WHERE tenant_id = $1 AND role = 'source' AND kind = 'o365' LIMIT 1`,
      [tenantId],
    );
    const graphTenantId = (rows[0]?.config as { tenantId?: string } | undefined)?.tenantId;
    const available = directoryAvailability(process.env, graphTenantId);

    // A Google Drive source (workplan 0029, the Google half): its outbound
    // shares are readable with the Drive scope the connection already holds —
    // no extra consent decision, unlike Files.Read.All. When the tenant's
    // file source is Drive, the drive section scans Drive; a tenant carrying
    // BOTH an o365 and a google-drive source gets the Drive answer for the
    // file section (its files are the ones migrating through this tool) and
    // the Graph answer for calendars.
    const { rows: driveRows } = await pool().query<{ secret_ref: string | null; config: unknown }>(
      `SELECT secret_ref, config FROM connection
        WHERE tenant_id = $1 AND role = 'source' AND kind = 'google-drive' LIMIT 1`,
      [tenantId],
    );
    const googleDriveConnection = driveRows[0];

    // The delegation sentence is always in the report; the scans are only
    // attempted when the connection can actually make them.
    const delegation = mailboxDelegations();
    const scanOptions = { applicationPermissions: true } as const;
    // Asked once, so the report says the same thing about the drive section
    // whether or not the connection could have made the request anyway.
    const drive = driveSharingAvailability(process.env);

    const markdown = await runPermissionInventory({
      mappingLabel: mailbox,
      generatedOn: new Date().toISOString().slice(0, 10),
      // `mailboxDelegations()` is always `not_discoverable`; the narrowing is
      // the type system's, not a runtime possibility.
      delegationReason:
        delegation.kind === 'not_discoverable' ? delegation.reason : 'not inventoried',
      // BOTH scans are always passed, even when nothing can be read. An
      // omitted dep falls back to the pass's generic "no reader is
      // configured", and these two are not unconfigured — each has a specific
      // reason a reader can act on, and they are different reasons.
      scanCalendars: async () =>
        available.ok
          ? scanCalendarPermissions(
              mailbox,
              graphToken(available, graphTenantId!),
              httpClient,
              scanOptions,
            )
          : googleDriveConnection && !graphTenantId
            ? {
                // A Google tenant would otherwise get a Graph-worded reason
                // about an app registration it never had — a wrong errand.
                kind: 'not_discoverable' as const,
                reason: permissionsNotDiscoverable(
                  'Google Calendar sharing is not yet read by this tool — the Drive scan ' +
                    'covers files only. Capture calendar sharing by hand before cutover',
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
            const source = buildGoogleDriveSourceFrom(
              {},
              creds,
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
        // The consent decision answers first, because it holds whatever the
        // credentials say: a deployment without `Files.Read.All` would get a
        // 403 here, and a 403 reads as a fault to fix rather than a choice.
        if (!drive.ok) return { kind: 'not_discoverable' as const, reason: drive.reason };
        if (!available.ok)
          return { kind: 'not_discoverable' as const, reason: available.reason };
        // `/drives/{id}` is the only addressing the sharing endpoints take, so
        // the drive id is resolved first rather than built by concatenation.
        const token = graphToken(available, graphTenantId!);
        const found = await resolveUserDriveId(mailbox, token, httpClient, scanOptions);
        if (!found.ok) return { kind: 'not_discoverable' as const, reason: found.reason };
        return scanDrivePermissions(found.id, token, httpClient, scanOptions);
      },
      error: (m, err) => log.error(m, err instanceof Error ? err.message : err),
    });

    res.type('text/markdown; charset=utf-8').send(markdown);
  } catch (error) {
    log.error('Error rendering the permission report:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to render the permission report',
    });
  }
});

type Available = Extract<ReturnType<typeof directoryAvailability>, { ok: true }>;

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

export default router;
