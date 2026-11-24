// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * FINISH'S TWO CHECKS, on managed (workplan 0171 §7, T10):
 *
 *   GET  /api/migrations/:mappingId/finish/addresses   the addresses at the old
 *        provider that deliver into this mailbox (§7.2)
 *   POST /api/migrations/:mappingId/finish/mx-check    MX for the mailbox's
 *        domain, read into one line (§7.3, D8 (a))
 *
 * READ-ONLY, both: a Graph or Gmail GET and three DNS-over-HTTPS questions.
 * Nothing is stored (§8). The check is a POST because a person presses it and
 * it is paced, one per ten seconds per migration; it changes nothing.
 *
 * Read as `app_user` in the caller's organisation (workplan 0138 T6), on the
 * request path's pool, as `permissions.ts` reads; the WHERE clauses name the
 * organisation too, for a deployment without `APP_DATABASE_URL`.
 *
 * The appliance serves the same two answers from its mapping file
 * (`apps/selfhost/src/index.ts`), through the same `finish-checks.ts`.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { sql } from 'drizzle-orm';
import { withTenant, type PgDatabase } from '@openmig/ledger';
import { MxCheckPace } from '@openmig/shared';
import { tenantFetch } from '@openmig/shared/reachable-host';
import type { HttpClient } from '@openmig/connectors';
import { SecretStore } from '@openmig/core/secret-store';
import { sourceCredentialsFor } from '@openmig/orchestration/build-deps-from-mapping';
import { googleSourceKinds, microsoftSourceKinds } from '@openmig/orchestration/source-face-builders';
import { STORED_GRAPH_FIELD_NAMING } from '@openmig/orchestration/graph-domain-source-factory';
import {
  checkMx,
  finishAddresses,
  mailHostOfTarget,
  readReceivingAddresses,
  type AddressFamily,
  type AddressSource,
} from '@openmig/orchestration/finish-checks';
import { authenticate, getDbPool } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import { serverFault } from '../../server-fault.ts';
import { refusedAsClosed } from '../../closed-organisation.ts';

const router = Router();

let _pool: ReturnType<typeof getDbPool> | null = null;
function pool(): ReturnType<typeof getDbPool> {
  if (!_pool) _pool = getDbPool();
  return _pool;
}

// Graph's and Gmail's addresses are public; through the rule all the same
// (0136 T1), as every route's outbound request goes.
const http: HttpClient = {
  async request({ url, method, headers }) {
    const res = await tenantFetch(url, { method, headers });
    return { status: res.status, body: await res.text(), headers: {} };
  },
};

const pace = new MxCheckPace();

/** One migration's source and destination, as the two checks read them. */
interface FinishRow {
  readonly address: string | null;
  readonly source_kind: string | null;
  readonly source_config: unknown;
  readonly source_secret_ref: string | null;
  readonly source_override: unknown;
  readonly mapping_secret_ref: string | null;
  readonly grant_withdrawn_at: Date | string | null;
  readonly target_kind: string | null;
  readonly target_config: unknown;
  readonly target_override: unknown;
}

async function finishRowOf(tenantId: string, mappingId: string): Promise<FinishRow | undefined> {
  return withTenant(pool(), tenantId, async (db: PgDatabase) => {
    const rows = await db.execute(
      sql`SELECT smb.primary_address AS address,
             sc.kind AS source_kind, sc.config AS source_config, sc.secret_ref AS source_secret_ref,
             mm.source_config_override AS source_override, mm.source_secret_ref AS mapping_secret_ref,
             mm.grant_withdrawn_at,
             tc.kind AS target_kind, tc.config AS target_config, mm.target_config_override AS target_override
       FROM mailbox_mapping mm
       LEFT JOIN mailbox smb ON smb.id = mm.source_mailbox_id AND smb.tenant_id = mm.tenant_id
       LEFT JOIN connection sc ON sc.id = smb.connection_id AND sc.tenant_id = mm.tenant_id
       LEFT JOIN mailbox tmb ON tmb.id = mm.target_mailbox_id AND tmb.tenant_id = mm.tenant_id
       LEFT JOIN connection tc ON tc.id = tmb.connection_id AND tc.tenant_id = mm.tenant_id
      WHERE mm.tenant_id = ${tenantId} AND mm.id = ${mappingId}`,
    );
    return rows.rows[0] as FinishRow | undefined;
  });
}

/** Which old provider the source is. */
export function familyOf(kind: string | null): AddressFamily {
  if (kind === null) return 'other';
  if (microsoftSourceKinds().includes(kind)) return 'microsoft';
  if (googleSourceKinds().includes(kind)) return 'google';
  return 'other';
}

function merged(config: unknown, override: unknown): Record<string, unknown> {
  return { ...((config ?? {}) as object), ...((override ?? {}) as object) } as Record<string, unknown>;
}

/** The source as `readReceivingAddresses` takes it, with the credentials a pass would use. */
function addressSourceOf(row: FinishRow): AddressSource {
  const family = familyOf(row.source_kind);
  if (family === 'other' || row.source_kind === null) return { family: 'other' };
  const config = merged(row.source_config, row.source_override);
  const stored = row.source_secret_ref
    ? SecretStore.decryptCredentials(row.source_secret_ref)
    : (((config as { credentials?: Record<string, string> }).credentials) ?? {});
  const creds = sourceCredentialsFor(row.source_kind, 'source', stored, row.mapping_secret_ref);
  if (family === 'microsoft') {
    const tenant = typeof config.tenantId === 'string' && config.tenantId !== '' ? config.tenantId : 'common';
    return { family, tenantId: tenant, creds, naming: STORED_GRAPH_FIELD_NAMING };
  }
  return { family, creds };
}

function idsOf(req: AuthenticatedRequest, res: Response): { tenantId: string; mappingId: string } | null {
  const { mappingId } = req.params;
  const tenantId = req.tenantId;
  if (!mappingId || Array.isArray(mappingId)) {
    res.status(400).json({ error: 'mappingId is required' });
    return null;
  }
  if (!tenantId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    return null;
  }
  return { tenantId, mappingId };
}

router.get('/:mappingId/finish/addresses', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ids = idsOf(req, res);
    if (!ids) return;
    // Both read with the access the organisation gave, so a closed one is
    // refused first, as the permission report is (0085 T2).
    if (await refusedAsClosed(res, ids.tenantId, pool())) return;
    const row = await finishRowOf(ids.tenantId, ids.mappingId);
    if (!row) return void res.status(404).json({ error: 'Not found', message: 'Mapping not found' });
    const address = row.address?.trim() || undefined;
    res.json(
      await finishAddresses(address, async () => {
        const source = addressSourceOf(row);
        // A withdrawn grant reads nothing (0108): the person reconnects first.
        if (row.grant_withdrawn_at !== null && source.family !== 'other') {
          return { state: 'not_read', provider: source.family === 'microsoft' ? 'Microsoft' : 'Google', why: 'reconnect' };
        }
        return readReceivingAddresses(source, address!, http);
      }),
    );
  } catch (error) {
    serverFault(res, 'finish_addresses_failed', 'reading the addresses that receive mail', error);
  }
});

router.post('/:mappingId/finish/mx-check', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ids = idsOf(req, res);
    if (!ids) return;
    // Both read with the access the organisation gave, so a closed one is
    // refused first, as the permission report is (0085 T2).
    if (await refusedAsClosed(res, ids.tenantId, pool())) return;
    const row = await finishRowOf(ids.tenantId, ids.mappingId);
    if (!row) return void res.status(404).json({ error: 'Not found', message: 'Mapping not found' });
    const wait = pace.take(`${ids.tenantId}:${ids.mappingId}`);
    if (wait > 0) {
      res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
      return void res.status(429).json({ error: 'mx_check_paced', retryAfterMs: wait });
    }
    const target = merged(row.target_config, row.target_override);
    res.json(
      await checkMx({
        address: row.address?.trim() || undefined,
        family: familyOf(row.source_kind),
        destinationKind: row.target_kind ?? '',
        destinationMailHost: mailHostOfTarget(target),
      }),
    );
  } catch (error) {
    serverFault(res, 'mx_check_failed', 'checking MX', error);
  }
});

export default router;
