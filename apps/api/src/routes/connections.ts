// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Connections as things you can SEE and RE-TEST (workplan 0062).
 *
 * `connection` rows have existed since the baseline, but nothing ever showed
 * them: creating a mapping silently inserted two — `"<name> (source)"` and
 * `"<name> (target)"` — and that was the last anyone heard of them. So a
 * credential could expire and the only way to find out was a failing pass, a
 * second mapping against the same tenant meant pasting the same three secrets
 * again, and nothing could answer "is this still good?" without running a
 * migration.
 *
 * `GET /api/connections` — what exists, what it is for, and how many mappings
 * depend on it.
 * `POST /api/connections/:id/test` — probe it NOW, through the same builders a
 * sync pass uses, and record what came back.
 *
 * SECRETS NEVER COME BACK OUT. The list returns names, kinds and states; the
 * only thing that touches decrypted credentials is the probe, and all it
 * returns is the provider's own verdict.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { eq, and, inArray, sql } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { log } from '@openmig/shared';
import { SecretStore } from '@openmig/core/secret-store';
import {
  probeSourceConnection,
  probeTargetConnection,
} from '@openmig/orchestration/probe-connection';
import { authenticate, getDbPool, withTenantDb } from '../middleware/auth';
import type { AuthenticatedRequest } from '../types/api';

const router = Router();

let _pool: ReturnType<typeof getDbPool> | null = null;
function pool() {
  if (!_pool) _pool = getDbPool();
  return _pool;
}

/** Target kinds `probeTargetConnection` knows how to reach. */
const TARGET_KINDS = ['jmap', 'imap', 'caldav', 'carddav', 'webdav'] as const;
type TargetKind = (typeof TARGET_KINDS)[number];

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.tenantId) {
      return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    }
    const tenantId = req.tenantId;
    const rows = await withTenantDb(tenantId, pool(), async (db) => {
      const connections = await db
        .select({
          id: schema.connection.id,
          role: schema.connection.role,
          kind: schema.connection.kind,
          displayName: schema.connection.displayName,
          status: schema.connection.status,
          createdAt: schema.connection.createdAt,
        })
        .from(schema.connection)
        .where(eq(schema.connection.tenantId, tenantId));

      if (connections.length === 0) return [];

      // How many mappings depend on each connection. The link is
      // mailbox_mapping → mailbox → connection, so this counts through the
      // mailboxes — the number that says whether re-testing this matters.
      const usage = await db
        .select({
          connectionId: schema.mailbox.connectionId,
          used: sql<number>`count(*)::int`,
        })
        .from(schema.mailbox)
        .where(
          inArray(
            schema.mailbox.connectionId,
            connections.map((c) => c.id),
          ),
        )
        .groupBy(schema.mailbox.connectionId);
      const usedBy = new Map(usage.map((u) => [u.connectionId, u.used]));

      return connections.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        usedByMailboxes: usedBy.get(c.id) ?? 0,
      }));
    });
    res.json({ connections: rows });
  } catch (error) {
    log.error('[api] listing connections failed:', error);
    res.status(500).json({ error: 'list_failed', reason: String(error) });
  }
});

router.post('/:id/test', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.tenantId) {
      return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    }
    const tenantId = req.tenantId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return void res.status(400).json({ error: 'invalid_path', reason: 'id is required' });

    const found = await withTenantDb(tenantId, pool(), (db) =>
      db
        .select()
        .from(schema.connection)
        .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId))),
    );
    const row = found[0];
    if (!row) {
      return void res.status(404).json({ error: 'not_found', reason: 'No such connection.' });
    }

    // A connection with no stored secret cannot be probed — say which it is
    // rather than reporting a credential failure it did not have.
    if (!row.secretRef) {
      return void res.json({
        ok: false,
        reason:
          'This connection has no stored credentials, so there is nothing to test. It was ' +
          'created before credentials were saved, or they were cleared.',
      });
    }

    const creds = SecretStore.decryptCredentials(row.secretRef);
    const config = (row.config ?? {}) as Record<string, unknown>;
    const result =
      row.role === 'target'
        ? await probeTargetConnection(
            (TARGET_KINDS as ReadonlyArray<string>).includes(row.kind)
              ? (row.kind as TargetKind)
              : 'webdav',
            config,
            creds,
          )
        : await probeSourceConnection(row.kind, config, creds);

    // Record what the probe found, so the list says what was last true rather
    // than what was true when the connection was created.
    await withTenantDb(tenantId, pool(), (db) =>
      db
        .update(schema.connection)
        .set({ status: result.ok ? 'connected' : 'error', updatedAt: new Date() })
        .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId))),
    );

    res.json(result);
  } catch (error) {
    log.error('[api] testing a connection failed:', error);
    res.status(500).json({ error: 'test_failed', reason: String(error) });
  }
});

export default router;
