// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Migration Management Routes
 * 
 * CRUD operations for migrations, sync triggers, and run history.
 * Integrates with Trigger.dev for job orchestration.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { authenticate, getDbPool, withTenantDb } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../types/api';
import { eq, and } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgMigrationStatusStore, PgLedger, RunStore } from '@openmig/ledger';
import { buildDomainStatusReports } from '@openmig/shared';
import { SecretStore } from '@openmig/core/secret-store';
import { getTriggerClient } from '@openmig/scheduler';
import type { DiscoveryDomain, TenantId, MappingId } from '@openmig/shared';
import { resolveSyncJob, resolveCutoverJob } from './job-resolution';
// The §11.2 decision queues and the decisions on them (ADR-0026). Mounted on
// this same router so they sit under /api/migrations/:mappingId/... alongside
// discovery and start, which is where the appliance's equivalents live too.
import operatingRoutes from './operating-routes';
import { log, DISTRIBUTION_D_NOT_A_MAPPING } from '@openmig/shared';

/** Take the first row of a RETURNING result or fail loudly (no silent nulls). */
function firstOrThrow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`failed to create ${what}`);
  }
  return row;
}

/** Map the web source type to a connection.kind (protocol-based). */
function sourceKindFor(sourceType: 'imap' | 'oauth2' | 'graph'): 'imap' | 'o365' {
  return sourceType === 'imap' ? 'imap' : 'o365';
}

// The run wire shape and its mapper live in @openmig/ledger (`toRunReport`)
// so the appliance cannot grow a second, slightly different one — see
// RunStore.listRunsWithEvents.

const router = Router();

router.use('/', operatingRoutes);

// Global pool - created once and reused
let _dbPool: ReturnType<typeof getDbPool> | null = null;
function getSharedPool() {
  if (!_dbPool) {
    _dbPool = getDbPool();
  }
  return _dbPool;
}

// Schema validation
/**
 * Exported for the retraction guard (`sync-mode.unit.test.ts`).
 *
 * The mode enum below is the whole of what rows 7 and 8's retraction amounts
 * to in code. Nothing else refuses a withdrawn mode, so nothing else can be
 * asserted against — and a schema nothing tests is one careless widening away
 * from accepting `bidirectional` again in silence.
 */
export const CreateMappingSchema = z.object({
  name: z.string().min(1).max(255),
  sourceType: z.enum(['imap', 'oauth2', 'graph']),
  targetType: z.enum(['jmap', 'imap', 'caldav', 'carddav', 'webdav']),
  sourceConfig: z.object({
    host: z.string(),
    port: z.number(),
    username: z.string(),
    password: z.string().optional(),
    useSsl: z.boolean().default(true),
  }),
  targetConfig: z.object({
    host: z.string(),
    port: z.number(),
    username: z.string(),
    password: z.string(),
    useSsl: z.boolean().default(true),
  }),
  syncConfig: z.object({
    domains: z.array(z.enum(['email', 'calendar', 'contact', 'file'])).default(['email']),
    schedule: z.string().optional(), // Cron expression
  }).default({ domains: ['email'] }),
  // Mapping-specific fields (for mailbox_mapping table)
  status: z.enum(['active', 'paused', 'cutover', 'done']).optional(),
  /**
   * The sync mode. **One value, because one is all the engine implements.**
   *
   * `bidirectional` and `asymmetric` were RETRACTED 2026-08-03 (owner decision,
   * 0026 T3 row 7; SAD §11 carries the note): writing changes back to the
   * source would mean modifying the system being migrated away from.
   *
   * `one_time` went the same way on 2026-08-05, for a different and simpler
   * reason. Tracing consumers for that retraction turned up the fact that
   * **nothing anywhere branches on `mode` at all** — it is written on create,
   * echoed back on read, and never acted upon. So `one_time` was as
   * unimplemented as the two withdrawn modes, minus their hard-rule-2
   * argument: "run once and stop" writes nothing to the source, it simply does
   * not exist. Accepting it told an operator their migration would stop after
   * one pass, and it would have gone on mirroring indefinitely.
   *
   * It is refused rather than silently ignored, and refused as NOT BUILT
   * rather than as withdrawn, because the two are different promises: this one
   * could be built, and the message says so instead of closing the door.
   *
   * All three stay in the DATABASE enum. Existing rows may carry them and hard
   * rule 2 does not delete a customer's data to tidy a type; what changes is
   * that the API no longer pretends to honour a mode it does not implement.
   */
  mode: z
    .enum(['mirror'], {
      message:
        "sync mode must be 'mirror', which is the only mode this engine " +
        'implements. `bidirectional` and `asymmetric` were withdrawn on ' +
        '2026-08-03: writing changes back to the source would mean modifying ' +
        'the system being migrated away from, which this tool does not do — ' +
        'changes made on the target during shadow are surfaced as decisions ' +
        'instead. `one_time` is NOT WITHDRAWN but NOT BUILT: nothing stops a ' +
        'mapping after one pass today, so accepting it would promise a ' +
        'migration that ends when it would in fact keep mirroring.',
    })
    .optional(),
  // §14.1's two patterns are both legal in the LEDGER — `group_def` records
  // that an address IS a distribution list — but only one of them can be a
  // MAPPING (workplan 0027 T3). The appliance refuses the other at startup;
  // refusing it here too is ADR-0026's one contract, and without it a managed
  // tenant could create a mapping that copies nothing and reports success.
  pattern: z
    .enum(['shared_s', 'distribution_d'])
    .refine((p) => p !== 'distribution_d', { message: DISTRIBUTION_D_NOT_A_MAPPING })
    .optional(),
});

const UpdateMappingSchema = CreateMappingSchema.partial();

const TriggerSyncSchema = z.object({
  type: z.enum(['full', 'delta']).optional(),
  mode: z.string().optional(), // Accept legacy 'mode' field for tests
  forceFullScan: z.boolean().default(false),
}).passthrough(); // Allow additional fields

// No gracePeriodHours: the cutover task prepares and verifies, then stops at
// READY_FOR_CUTOVER for operator approval. It does not execute the cutover and
// does not start a grace period, so accepting a grace-period setting here would
// be accepting a knob that turns nothing.
const TriggerCutoverSchema = z.object({
  skipFinalSync: z.boolean().default(false),
  skipVerification: z.boolean().default(false),
  pattern: z.string().optional(), // Accept legacy 'pattern' field for tests
}).passthrough(); // Allow additional fields

/**
 * GET /api/mappings
 * 
 * List all mappings for the current tenant
 */
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;

    if (!tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant ID not found in authentication context',
      });
      return;
    }

    const pool = getSharedPool();

    // One tenant-scoped read for everything the list needs. The old mapper
    // hardcoded sourceType 'imap' / targetType 'jmap' (misreporting the
    // wizard's choices), sent tenant_id in snake case, and omitted the domains
    // and lastSyncAt entirely — the client schema could never parse a single
    // row (0033 T1). The real kinds live on the connection rows, reached via
    // each mapping's mailboxes; domains live in scope_selection; lastSyncAt is
    // the newest domain completion, same definition as GET /:mappingId.
    const { mappings, mailboxes, connections, scopeRows, statusRows } = await withTenantDb(
      tenantId,
      pool,
      async (db) => {
        const mappings = await db
          .select()
          .from(schema.mailboxMapping)
          .where(eq(schema.mailboxMapping.tenantId, tenantId));
        if (mappings.length === 0) {
          return { mappings, mailboxes: [], connections: [], scopeRows: [], statusRows: [] };
        }
        const [mailboxes, connections, scopeRows, statusRows] = await Promise.all([
          db
            .select({ id: schema.mailbox.id, connectionId: schema.mailbox.connectionId })
            .from(schema.mailbox)
            .where(eq(schema.mailbox.tenantId, tenantId)),
          db
            .select({ id: schema.connection.id, kind: schema.connection.kind })
            .from(schema.connection)
            .where(eq(schema.connection.tenantId, tenantId)),
          db
            .select({
              mappingId: schema.scopeSelection.mappingId,
              domain: schema.scopeSelection.domain,
            })
            .from(schema.scopeSelection)
            .where(
              and(
                eq(schema.scopeSelection.tenantId, tenantId),
                eq(schema.scopeSelection.included, true),
              ),
            )
            .orderBy(schema.scopeSelection.domain),
          db
            .select({
              mappingId: schema.migrationStatus.mappingId,
              completedAt: schema.migrationStatus.completedAt,
            })
            .from(schema.migrationStatus)
            .where(eq(schema.migrationStatus.tenantId, tenantId)),
        ]);
        return { mappings, mailboxes, connections, scopeRows, statusRows };
      },
    );

    const kindByConnection = new Map(connections.map((c) => [c.id, c.kind]));
    const kindByMailbox = new Map(
      mailboxes.map((mb) => [mb.id, kindByConnection.get(mb.connectionId)]),
    );
    const domainsByMapping = new Map<string, string[]>();
    for (const row of scopeRows) {
      const list = domainsByMapping.get(row.mappingId) ?? [];
      list.push(row.domain);
      domainsByMapping.set(row.mappingId, list);
    }
    const lastSyncByMapping = new Map<string, string>();
    for (const row of statusRows) {
      if (!row.completedAt) continue;
      const iso = row.completedAt.toISOString();
      const prev = lastSyncByMapping.get(row.mappingId);
      if (!prev || iso > prev) lastSyncByMapping.set(row.mappingId, iso);
    }

    res.json({
      mappings: mappings.map((m) => ({
        id: m.id,
        tenantId,
        name: m.name ?? m.mode, // real name (falls back to mode for legacy rows)
        sourceType: kindByMailbox.get(m.sourceMailboxId) ?? 'unknown',
        // targetMailboxId is nullable in the schema (a mapping can exist
        // before its target mailbox does) — that is one honest 'unknown'.
        targetType:
          (m.targetMailboxId ? kindByMailbox.get(m.targetMailboxId) : undefined) ?? 'unknown',
        status: m.status,
        mode: m.mode,
        pattern: m.pattern,
        domains: domainsByMapping.get(m.id) ?? [],
        lastSyncAt: lastSyncByMapping.get(m.id),
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
    });
  } catch (error) {
    log.error('Error listing mappings:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to list mappings',
    });
  }
});

/**
 * POST /api/mappings
 * 
 * Create a new migration mapping
 */
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tenantId } = req;
    const body = CreateMappingSchema.parse(req.body);

    if (!tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant ID not found in authentication context',
      });
      return;
    }

    // Persist the full chain in one tenant-scoped transaction (RLS-enforced):
    // source + target connection (with ENCRYPTED credentials), a mailbox per
    // connection, the mailbox_mapping, and one scope_selection row per domain.
    const created = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      // Never store plaintext secrets — encrypt via SecretStore. secret_ref is a
      // text column read back by decryptCredentials(string) → parseEncryptedSecret,
      // which expects the inner EncryptedSecret ({v,n,t,c}) JSON, so store `.encrypted`.
      const sourceSecret = JSON.stringify(
        SecretStore.encryptCredentials({
          username: body.sourceConfig.username,
          ...(body.sourceConfig.password ? { password: body.sourceConfig.password } : {}),
        }).encrypted,
      );
      const targetSecret = JSON.stringify(
        SecretStore.encryptCredentials({
          username: body.targetConfig.username,
          password: body.targetConfig.password,
        }).encrypted,
      );

      const sourceConn = firstOrThrow(
        await db
          .insert(schema.connection)
          .values({
            tenantId,
            role: 'source',
            kind: sourceKindFor(body.sourceType),
            displayName: `${body.name} (source)`,
            config: { host: body.sourceConfig.host, port: body.sourceConfig.port, useSsl: body.sourceConfig.useSsl },
            secretRef: sourceSecret,
          })
          .returning({ id: schema.connection.id }),
        'source connection',
      );

      const targetConn = firstOrThrow(
        await db
          .insert(schema.connection)
          .values({
            tenantId,
            role: 'target',
            // targetType values (jmap/imap/caldav/carddav/webdav) are all valid connection kinds.
            kind: body.targetType,
            displayName: `${body.name} (target)`,
            config: { host: body.targetConfig.host, port: body.targetConfig.port, useSsl: body.targetConfig.useSsl },
            secretRef: targetSecret,
          })
          .returning({ id: schema.connection.id }),
        'target connection',
      );

      const sourceMailbox = firstOrThrow(
        await db
          .insert(schema.mailbox)
          .values({ tenantId, connectionId: sourceConn.id, kind: 'user', externalId: 'primary', primaryAddress: body.sourceConfig.username })
          .returning({ id: schema.mailbox.id }),
        'source mailbox',
      );

      const targetMailbox = firstOrThrow(
        await db
          .insert(schema.mailbox)
          .values({ tenantId, connectionId: targetConn.id, kind: 'user', externalId: 'primary', primaryAddress: body.targetConfig.username })
          .returning({ id: schema.mailbox.id }),
        'target mailbox',
      );

      const mapping = firstOrThrow(
        await db
          .insert(schema.mailboxMapping)
          .values({
            tenantId,
            sourceMailboxId: sourceMailbox.id,
            targetMailboxId: targetMailbox.id,
            mode: body.mode ?? 'mirror',
            // 0013 T5: new mappings land PAUSED (draft) — the owner reviews the discovery
            // counts + scope manifest and clicks "Start migration" (POST …/start) to activate.
            status: body.status ?? 'paused',
            pattern: body.pattern,
            name: body.name,
            schedule: body.syncConfig.schedule,
          })
          .returning(),
        'mapping',
      );

      if (body.syncConfig.domains.length > 0) {
        await db.insert(schema.scopeSelection).values(
          body.syncConfig.domains.map((domain) => ({ tenantId, mappingId: mapping.id, domain, included: true })),
        );
      }

      return mapping;
    });

    res.status(201).json({
      id: created.id,
      tenantId,
      name: created.name,
      sourceType: body.sourceType,
      targetType: body.targetType,
      status: created.status,
      mode: created.mode,
      pattern: created.pattern ?? undefined,
      syncConfig: { domains: body.syncConfig.domains, schedule: created.schedule ?? undefined },
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Validation error',
        details: error.issues,
      });
    } else {
      log.error('Error creating mapping:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to create mapping',
      });
    }
  }
});

/**
 * GET /api/mappings/:mappingId
 * 
 * Get mapping details
 */
router.get('/:mappingId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const mappingId = req.params.mappingId;
    if (!mappingId || Array.isArray(mappingId)) {
      res.status(400).json({ error: "mappingId is required" });
      return;
    }
    const tenantId = req.tenantId;

    if (!tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant ID not found in authentication context',
      });
      return;
    }


    const pool = getSharedPool();

    // Query the mapping + its real source/target connections + scope selection +
    // ledger-derived per-domain status, all RLS-enforced under one tenant context.
    // Previously this handler returned hardcoded placeholder data (imap.example.com,
    // a fixed lastSyncAt, domains: ['email']) regardless of the mapping's actual
    // config or sync state — this is the real fix, not a Docker/environment issue.
    const { mapping, sourceConn, targetConn, scopeRows, domainStatus, failures } = await withTenantDb(
      tenantId,
      pool,
      async (db) => {
        const mappings = await db
          .select()
          .from(schema.mailboxMapping)
          .where(
            and(
              eq(schema.mailboxMapping.id, mappingId),
              eq(schema.mailboxMapping.tenantId, tenantId)
            )
          );
        const mapping = mappings[0];
        if (!mapping) {
          return { mapping: null, sourceConn: null, targetConn: null, scopeRows: [], domainStatus: [], failures: [] };
        }

        const [sourceRows, targetRows, scopeRows, domainStatus, failures] = await Promise.all([
          db
            .select()
            .from(schema.connection)
            .where(and(eq(schema.connection.tenantId, tenantId), eq(schema.connection.role, 'source'))),
          db
            .select()
            .from(schema.connection)
            .where(and(eq(schema.connection.tenantId, tenantId), eq(schema.connection.role, 'target'))),
          db
            .select()
            .from(schema.scopeSelection)
            .where(
              and(
                eq(schema.scopeSelection.tenantId, tenantId),
                eq(schema.scopeSelection.mappingId, mappingId),
                eq(schema.scopeSelection.included, true),
              ),
            )
            .orderBy(schema.scopeSelection.domain),
          new PgMigrationStatusStore(db).getStatus(tenantId as TenantId, mappingId as MappingId),
          // The failure queue feeds the attention counts — same derivation as
          // the appliance's /status (see buildDomainStatusReports).
          new PgLedger(db).listFailures(tenantId as TenantId, mappingId as MappingId),
        ]);

        return {
          mapping,
          sourceConn: sourceRows[0] ?? null,
          targetConn: targetRows[0] ?? null,
          scopeRows,
          domainStatus,
          failures,
        };
      },
    );

    if (!mapping) {
      res.status(404).json({
        error: 'Not found',
        message: 'Mapping not found',
      });
      return;
    }

    // lastSyncAt: the most recent domain completion, if any have completed yet.
    const completedTimestamps = domainStatus
      .map((s) => s.completedAt)
      .filter((v): v is string => typeof v === 'string');
    const lastSyncAt = completedTimestamps.length > 0
      ? completedTimestamps.sort().at(-1)
      : undefined;

    // Config is real: host/port/useSsl come straight from the connection's non-secret
    // config JSON. username is NOT in that JSON, though — create-mapping stores it
    // encrypted alongside the password (SecretStore.encryptCredentials({ username,
    // password })), so it has to be decrypted to surface it here. password itself
    // stays masked — never return the real secret, even though it's technically
    // available server-side for a sync pass.
    const usernameFor = (conn: typeof sourceConn): string | undefined => {
      if (!conn?.secretRef) return undefined;
      try {
        return SecretStore.decryptCredentials(conn.secretRef).username;
      } catch {
        return undefined;
      }
    };

    res.json({
      id: mapping.id,
      tenantId,
      name: mapping.name ?? mapping.mode,
      sourceType: sourceConn?.kind ?? 'unknown',
      targetType: targetConn?.kind ?? 'unknown',
      sourceConfig: {
        ...(sourceConn?.config as Record<string, unknown> ?? {}),
        username: usernameFor(sourceConn),
        password: '***',
      },
      targetConfig: {
        ...(targetConn?.config as Record<string, unknown> ?? {}),
        username: usernameFor(targetConn),
        password: '***',
      },
      syncConfig: {
        domains: scopeRows.map((r) => r.domain),
        schedule: mapping.schedule ?? undefined,
      },
      status: mapping.status,
      mode: mapping.mode,
      pattern: mapping.pattern,
      // DomainStatusReport rows — the SAME shape the appliance's /status
      // serves (ADR-0026: shared shapes), with itemsRetrying and
      // itemsNeedingDecision derived from the failure queue and completedAt
      // renamed lastSyncedAt. Raw MigrationStatus rows lacked both counts,
      // so the hub's progress strip would have silently never shown a
      // retrying count on this edition (0033 T5).
      domainStatus: buildDomainStatusReports(domainStatus, failures),
      lastSyncAt,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
    });
  } catch (error) {
    log.error('Error getting mapping:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to get mapping',
    });
  }
});

/**
 * PUT /api/mappings/:mappingId
 * 
 * Update mapping configuration
 */
router.put(
  '/:mappingId',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const mappingId = req.params.mappingId;
      if (!mappingId || Array.isArray(mappingId)) {
        res.status(400).json({ error: "mappingId is required" });
        return;
      }
      const body = UpdateMappingSchema.parse(req.body);
      const tenantId = req.tenantId;

      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }


      const pool = getSharedPool();

      // Update mapping in database with RLS enforcement via withTenantDb
      // Note: mailbox_mapping has limited fields - we only update what's available
      const updateData: Partial<typeof schema.mailboxMapping.$inferInsert> = {};
      
      // Only update fields that exist in mailbox_mapping table
      // Note: body comes from UpdateMappingSchema which is partial of CreateMappingSchema
      // The actual mailbox_mapping fields are: id, tenant_id, source_mailbox_id, target_mailbox_id, 
      // status, mode, pattern, created_at, updated_at
      // So we need to check for these specific fields
      if ('status' in body && body.status) {
        updateData.status = body.status as 'active' | 'paused' | 'cutover' | 'done';
      }
      if ('mode' in body && body.mode) {
        // Narrowed to what the engine implements; the schema above refuses the
        // retracted modes with the reason, so nothing unsupported reaches here.
        updateData.mode = body.mode as 'mirror';
      }
      if ('pattern' in body && body.pattern) {
        updateData.pattern = body.pattern as 'shared_s' | 'distribution_d' | undefined;
      }
      // Note: name, sourceType, targetType, sourceConfig, targetConfig, syncConfig
      // are not direct fields of mailbox_mapping - they would require updating
      // related tables (mailbox, connection, scope_selection, collection_mapping)

      const [updated] = await withTenantDb(tenantId, pool, async (db) => {
        return await db
          .update(schema.mailboxMapping)
          .set(updateData)
          .where(
            and(
              eq(schema.mailboxMapping.id, mappingId),
              eq(schema.mailboxMapping.tenantId, tenantId)
            )
          )
          .returning();
      });

      if (!updated) {
        res.status(404).json({
          error: 'Not found',
          message: 'Mapping not found',
        });
        return;
      }

      res.json({
        id: updated.id,
        ...body,
        updatedAt: updated.updatedAt,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        log.error('Error updating mapping:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to update mapping',
        });
      }
    }
  }
);

/**
 * DELETE /api/mappings/:mappingId
 * 
 * Delete a mapping
 */
router.delete(
  '/:mappingId',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const mappingId = req.params.mappingId;
      if (!mappingId || Array.isArray(mappingId)) {
        res.status(400).json({ error: "mappingId is required" });
        return;
      }
      const tenantId = req.tenantId;

      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }


      const pool = getSharedPool();

      // Delete mapping from database with RLS enforcement via withTenantDb
      const [deleted] = await withTenantDb(tenantId, pool, async (db) => {
        return await db
          .delete(schema.mailboxMapping)
          .where(
            and(
              eq(schema.mailboxMapping.id, mappingId),
              eq(schema.mailboxMapping.tenantId, tenantId)
            )
          )
          .returning();
      });

      if (!deleted) {
        res.status(404).json({
          error: 'Not found',
          message: 'Mapping not found',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Mapping deleted successfully',
      });
    } catch (error) {
      log.error('Error deleting mapping:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to delete mapping',
      });
    }
  }
);

/**
 * POST /api/mappings/:mappingId/sync
 * 
 * Trigger a sync for a mapping
 */
router.post(
  '/:mappingId/sync',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mappingId } = req.params;
      if (!mappingId || Array.isArray(mappingId)) {
        res.status(400).json({ error: "mappingId is required" });
        return;
      }
      const body = TriggerSyncSchema.parse(req.body);
      const tenantId = req.tenantId;

      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }

      // Verify mapping exists and belongs to tenant (RLS enforced via withTenantDb)
      const pool = getSharedPool();
      const mappings = await withTenantDb(tenantId, pool, async (db) => {
        return await db
          .select()
          .from(schema.mailboxMapping)
          .where(
            and(
              eq(schema.mailboxMapping.id, mappingId),
              eq(schema.mailboxMapping.tenantId, tenantId)
            )
          );
      });

      if (mappings.length === 0) {
        res.status(404).json({
          error: 'Not found',
          message: 'Mapping not found',
        });
        return;
      }

      // 0013 T5: a paused (draft) mapping must not sync until the owner green-lights it
      // via POST …/start. Refuse rather than silently kicking off a pass.
      if (mappings[0]?.status === 'paused') {
        res.status(409).json({
          error: 'Conflict',
          message: 'Mapping is paused — review the discovery counts and start it first (POST /start).',
        });
        return;
      }

      // Enqueue the real Trigger.dev task with an id-only, tenant-scoped payload
      // (the mapping was just verified to belong to this tenant above).
      const { taskId, payload } = resolveSyncJob(tenantId, mappingId, body);
      const run = await getTriggerClient().tasks.trigger(taskId, payload, {
        tags: [`tenant:${tenantId}`, `mapping:${mappingId}`],
      });

      res.status(202).json({
        success: true,
        runId: run.id,
        jobType: taskId,
        triggeredAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        log.error('Error triggering sync:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to trigger sync',
        });
      }
    }
  }
);

/**
 * POST /api/mappings/:mappingId/cutover
 * 
 * Trigger cutover for a mapping
 */
router.post(
  '/:mappingId/cutover',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mappingId } = req.params;
      if (!mappingId || Array.isArray(mappingId)) {
        res.status(400).json({ error: "mappingId is required" });
        return;
      }
      const body = TriggerCutoverSchema.parse(req.body);
      const tenantId = req.tenantId;

      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }

      // Verify mapping exists and belongs to tenant (RLS enforced via withTenantDb)
      const pool = getSharedPool();
      const mappings = await withTenantDb(tenantId, pool, async (db) => {
        return await db
          .select()
          .from(schema.mailboxMapping)
          .where(
            and(
              eq(schema.mailboxMapping.id, mappingId),
              eq(schema.mailboxMapping.tenantId, tenantId)
            )
          );
      });

      if (mappings.length === 0) {
        res.status(404).json({
          error: 'Not found',
          message: 'Mapping not found',
        });
        return;
      }

      // Enqueue the real Trigger.dev cutover task (id-only, tenant-scoped payload).
      const { taskId, payload } = resolveCutoverJob(tenantId, mappingId, body);
      const run = await getTriggerClient().tasks.trigger(taskId, payload, {
        tags: [`tenant:${tenantId}`, `mapping:${mappingId}`, 'type:cutover'],
      });

      res.status(202).json({
        success: true,
        runId: run.id,
        triggeredAt: new Date().toISOString(),
        // What was actually enqueued. This used to return a gracePeriodEnd
        // computed from the request, which reads as "the cutover is running and
        // its grace period ends at T" — nothing had run yet, and the task never
        // executes the cutover or starts a grace period.
        enqueued: 'cutover-preparation',
        nextStep: 'On a PASSing verification the mapping becomes READY_FOR_CUTOVER and waits for operator approval.',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        log.error('Error triggering cutover:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to trigger cutover',
        });
      }
    }
  }
);

/**
 * GET /api/migrations/:mappingId/runs
 *
 * Run history for a mapping, newest first, events inline — the shared
 * `RunReport` contract from @openmig/shared, produced by the ledger's own
 * reader so both editions serve one shape (see RunStore.listRunsWithEvents).
 *
 * The per-run detail route (`/runs/:runId`) that used to sit beside this was
 * DELETED with the 2026-08-09 row-23 decision: events arrive with the list,
 * and a second route with no reader is surface waiting to drift.
 */
router.get(
  '/:mappingId/runs',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const mappingId = req.params.mappingId;
      if (!mappingId || Array.isArray(mappingId)) {
        res.status(400).json({ error: "mappingId is required" });
        return;
      }
      const tenantId = req.tenantId;

      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }

      const pool = getSharedPool();
      const runs = await withTenantDb(tenantId, pool, async (db) =>
        new RunStore(db).listRunsWithEvents(tenantId as TenantId, mappingId as MappingId),
      );

      res.json({ runs });
    } catch (error) {
      log.error('Error listing runs:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to list runs',
      });
    }
  }
);

/** Load a mapping and confirm it belongs to the tenant (RLS-enforced). Returns null if not found. */
async function loadMapping(
  tenantId: string,
  mappingId: string,
): Promise<typeof schema.mailboxMapping.$inferSelect | null> {
  const rows = await withTenantDb(tenantId, getSharedPool(), (db) =>
    db
      .select()
      .from(schema.mailboxMapping)
      .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId))),
  );
  return rows[0] ?? null;
}

const DiscoverSchema = z.object({
  domains: z.array(z.enum(['email', 'calendar', 'contact', 'file'])).optional(),
});

/**
 * POST /api/migrations/:mappingId/discover (0013 T4)
 * Enqueue the read-only discovery job. Counts are written to migration_discovery; poll GET …/discovery.
 */
router.post('/:mappingId/discover', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mappingId } = req.params;
    const tenantId = req.tenantId;
    if (!mappingId || Array.isArray(mappingId)) return void res.status(400).json({ error: 'mappingId is required' });
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });

    const body = DiscoverSchema.parse(req.body ?? {});
    const mapping = await loadMapping(tenantId, mappingId);
    if (!mapping) return void res.status(404).json({ error: 'Not found', message: 'Mapping not found' });

    const domains: DiscoveryDomain[] = body.domains ?? ['email', 'calendar', 'contact', 'file'];
    const run = await getTriggerClient().tasks.trigger(
      'run-discovery',
      { tenantId, mappingId, domains },
      { tags: [`tenant:${tenantId}`, `mapping:${mappingId}`] },
    );
    res.status(202).json({ success: true, runId: run.id, jobType: 'run-discovery', triggeredAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.issues });
    } else {
      log.error('Error triggering discovery:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to trigger discovery' });
    }
  }
});

/**
 * GET /api/migrations/:mappingId/discovery (0013 T4)
 * Return the stored per-domain discovery counts. `discovered` is false until the first pass lands.
 */
router.get('/:mappingId/discovery', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mappingId } = req.params;
    const tenantId = req.tenantId;
    if (!mappingId || Array.isArray(mappingId)) return void res.status(400).json({ error: 'mappingId is required' });
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });

    const mapping = await loadMapping(tenantId, mappingId);
    if (!mapping) return void res.status(404).json({ error: 'Not found', message: 'Mapping not found' });

    const domains = await withTenantDb(tenantId, getSharedPool(), (db) =>
      new schema.PgDiscoveryStore(db).getDiscovery(tenantId as TenantId, mappingId as MappingId),
    );
    res.json({ mappingId, discovered: domains.length > 0, domains });
  } catch (error) {
    log.error('Error reading discovery:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to read discovery' });
  }
});

/**
 * POST /api/migrations/:mappingId/start (0013 T5)
 * The green light: flip a paused (draft) mapping to active so the scheduler picks it up.
 * Idempotent for an already-active mapping; 409 once it has moved on to cutover/done.
 */
router.post('/:mappingId/start', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mappingId } = req.params;
    const tenantId = req.tenantId;
    if (!mappingId || Array.isArray(mappingId)) return void res.status(400).json({ error: 'mappingId is required' });
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });

    const mapping = await loadMapping(tenantId, mappingId);
    if (!mapping) return void res.status(404).json({ error: 'Not found', message: 'Mapping not found' });

    if (mapping.status === 'cutover' || mapping.status === 'done') {
      return void res.status(409).json({ error: 'Conflict', message: `Cannot start a mapping in '${mapping.status}' state` });
    }
    if (mapping.status !== 'active') {
      await withTenantDb(tenantId, getSharedPool(), (db) =>
        db
          .update(schema.mailboxMapping)
          .set({ status: 'active', updatedAt: new Date() })
          .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId))),
      );
    }
    res.json({ id: mappingId, status: 'active' });
  } catch (error) {
    log.error('Error starting mapping:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to start mapping' });
  }
});

export default router;
