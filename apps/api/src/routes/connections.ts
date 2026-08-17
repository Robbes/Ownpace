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
import { z } from 'zod';
import { credentialFieldsFor, wizardTypeForConnectionKind } from '@openmig/shared';
import { authenticate, getDbPool, withTenantDb } from '../middleware/auth';
import type { AuthenticatedRequest } from '../types/api';
// The SHAPE builders stay the create route's, deliberately: what a connection
// stores must match what a sync pass reads, and one authority for that is the
// whole point of workplan 0063's descriptor only describing INPUTS.
import {
  CreateMappingBase,
  sourceConnectionConfig,
  sourceCredentialRecord,
  sourceKindFor,
  targetConnectionConfig,
} from './migrations/index';

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

const AddSchema = z.object({
  role: z.enum(['source', 'target']),
  type: z.string().min(1),
  displayName: z.string().min(1).max(255),
  /** Field key → what the person typed. Which keys are expected comes from
   *  the shared descriptor, so a form and this route cannot disagree. */
  values: z.record(z.string(), z.string()),
});

/**
 * Add a connection on its own, without creating a mapping (workplan 0063).
 *
 * PROBED BEFORE IT IS STORED, and stored either way with the outcome on
 * `status`: a credential that does not work yet is worth keeping (somebody is
 * mid-setup and an admin has not authorised the app), but it must not look
 * healthy. The provider's own words come back so the person can act on them.
 */
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.tenantId) {
      return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    }
    const tenantId = req.tenantId;
    const parsed = AddSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({
        error: 'invalid_body',
        reason: 'Send { role, type, displayName, values }.',
      });
    }
    const { role, type, displayName, values } = parsed.data;

    const fields = credentialFieldsFor(role, type);
    if (fields.length === 0) {
      return void res.status(400).json({
        error: 'unknown_type',
        reason: `'${type}' is not a ${role} this product connects to.`,
      });
    }
    const missing = fields.filter((f) => f.required && !values[f.key]?.trim()).map((f) => f.key);
    if (missing.length > 0) {
      return void res.status(400).json({
        error: 'missing_fields',
        reason: `Still needed: ${missing.join(', ')}.`,
      });
    }

    // Through the SAME zod object the create route validates, so a value this
    // accepts is one create would accept — port coerced because a form sends
    // strings and the schema wants a number.
    const shaped = { ...values, ...(values.port ? { port: Number(values.port) } : {}) };
    const configShape =
      role === 'source' ? CreateMappingBase.shape.sourceConfig : CreateMappingBase.shape.targetConfig;
    const checked = configShape.safeParse(shaped);
    if (!checked.success) {
      return void res.status(400).json({
        error: 'invalid_values',
        reason: checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' '),
      });
    }

    const half = checked.data as never;
    const config =
      role === 'source'
        ? sourceConnectionConfig({ sourceType: type as never, sourceConfig: half })
        : targetConnectionConfig({ targetConfig: half } as never);
    const creds =
      role === 'source'
        ? sourceCredentialRecord({ sourceType: type as never, sourceConfig: half })
        : { username: values.username ?? '', password: values.password ?? '' };

    const probe =
      role === 'target'
        ? await probeTargetConnection(
            (TARGET_KINDS as ReadonlyArray<string>).includes(type) ? (type as TargetKind) : 'webdav',
            config,
            creds as Record<string, string>,
          )
        : await probeSourceConnection(
            sourceKindFor(type as never),
            config,
            creds as Record<string, string>,
          );

    const kind = role === 'source' ? sourceKindFor(type as never) : type;
    const inserted = await withTenantDb(tenantId, pool(), (db) =>
      db
        .insert(schema.connection)
        .values({
          tenantId,
          role,
          kind: kind as never,
          displayName,
          config,
          secretRef: JSON.stringify(
            SecretStore.encryptCredentials(creds as Record<string, string>).encrypted,
          ),
          status: probe.ok ? 'connected' : 'error',
        })
        .returning({ id: schema.connection.id }),
    );

    res.status(201).json({ id: inserted[0]!.id, ...probe });
  } catch (error) {
    log.error('[api] adding a connection failed:', error);
    res.status(500).json({ error: 'add_failed', reason: String(error) });
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

/**
 * Replace a connection's credentials in place (workplan 0065).
 *
 * The add route minus the insert. It exists because credentials EXPIRE — a
 * rotated Box secret, a revoked Google refresh token — and without it the only
 * repair was creating a new connection and a new mapping, abandoning the
 * ledger history that made the old one useful.
 *
 * The row keeps its id, so every mapping pointing at it keeps working. What
 * changes is the secret and, if the probe now succeeds, the status. The new
 * credentials are PROBED BEFORE they replace the old ones, and a failure
 * leaves the old ones in place: half-rotating a working connection into a
 * broken one because somebody pasted the wrong value is worse than refusing.
 */
router.put('/:id/credentials', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.tenantId) {
      return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    }
    const tenantId = req.tenantId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return void res.status(400).json({ error: 'invalid_path', reason: 'id is required' });

    const parsed = z.object({ values: z.record(z.string(), z.string()) }).safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ error: 'invalid_body', reason: 'Send { values }.' });
    }

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

    // By wizard type, not by kind — the descriptor is keyed the wizard's way.
    const type = wizardTypeForConnectionKind(row.kind);
    const fields = credentialFieldsFor(row.role, type);
    const missing = parsed.data.values
      ? fields.filter((f) => f.required && !parsed.data.values[f.key]?.trim()).map((f) => f.key)
      : [];
    if (missing.length > 0) {
      return void res.status(400).json({
        error: 'missing_fields',
        reason: `Still needed: ${missing.join(', ')}.`,
      });
    }

    const values = parsed.data.values;
    const shaped = { ...values, ...(values.port ? { port: Number(values.port) } : {}) };
    const configShape =
      row.role === 'source' ? CreateMappingBase.shape.sourceConfig : CreateMappingBase.shape.targetConfig;
    const checked = configShape.safeParse(shaped);
    if (!checked.success) {
      return void res.status(400).json({
        error: 'invalid_values',
        reason: checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' '),
      });
    }

    const half = checked.data as never;
    const creds =
      row.role === 'source'
        ? sourceCredentialRecord({ sourceType: type as never, sourceConfig: half })
        : { username: values.username ?? '', password: values.password ?? '' };

    // The CONFIG is deliberately left alone: rotation replaces a secret, not
    // where the migration is rooted. Changing both here would let a rotation
    // silently re-point a mapping at a different folder.
    const probe =
      row.role === 'target'
        ? await probeTargetConnection(
            (TARGET_KINDS as ReadonlyArray<string>).includes(row.kind)
              ? (row.kind as TargetKind)
              : 'webdav',
            (row.config ?? {}) as Record<string, unknown>,
            creds as Record<string, string>,
          )
        : await probeSourceConnection(
            row.kind,
            (row.config ?? {}) as Record<string, unknown>,
            creds as Record<string, string>,
          );

    if (!probe.ok) {
      // The old credentials stay. Every mapping on this connection keeps
      // whatever it had, which may well still be working.
      return void res.status(200).json({ ...probe, rotated: false });
    }

    await withTenantDb(tenantId, pool(), (db) =>
      db
        .update(schema.connection)
        .set({
          secretRef: JSON.stringify(
            SecretStore.encryptCredentials(creds as Record<string, string>).encrypted,
          ),
          status: 'connected',
          updatedAt: new Date(),
        })
        .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId))),
    );

    res.json({ ...probe, rotated: true });
  } catch (error) {
    log.error('[api] rotating credentials failed:', error);
    res.status(500).json({ error: 'rotate_failed', reason: String(error) });
  }
});

export default router;
