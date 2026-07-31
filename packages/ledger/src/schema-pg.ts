// Drizzle schema for PostgreSQL — matches the canonical DDL in migrations/0001_baseline.sql.
// See ADR-0016 (ledger schema v1).

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  bigint,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ========================= Tenancy & connections =========================

export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: text('status', { enum: ['active', 'suspended', 'deleting'] })
    .notNull()
    .default('active'),
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const connection = pgTable(
  'connection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['source', 'target'] }).notNull(),
    kind: text('kind', {
      enum: [
        'o365',
        'soverin',
        'nextcloud',
        'proton',
        'imap',
        'caldav',
        'carddav',
        'webdav',
        'selfhosted_mail',
        // JMAP is the primary target protocol (Stalwart / La Suite / mosa.cloud).
        // The DB CHECK (0001_baseline.sql) already allows it; keep the TS enum in sync.
        'jmap',
      ],
    }).notNull(),
    displayName: text('display_name').notNull(),
    config: jsonb('config').notNull().default({}),
    secretRef: text('secret_ref'),
    status: text('status', { enum: ['connected', 'error', 'revoked'] })
      .notNull()
      .default('connected'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ix_connection_tenant').on(t.tenantId)],
);

// ========================= Mailboxes & mappings =========================

export const mailbox = pgTable(
  'mailbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    kind: text('kind', { enum: ['user', 'shared', 'archive', 'resource'] })
      .notNull()
      .default('user'),
    primaryAddress: text('primary_address'),
    displayName: text('display_name'),
    quotaBytes: bigint('quota_bytes', { mode: 'bigint' }),
    status: text('status', { enum: ['active', 'deleted_source', 'disabled'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_mailbox_tenant').on(t.tenantId),
    uniqueIndex('uk_mailbox_connection_external').on(t.connectionId, t.externalId),
  ],
);

export const mailboxMapping = pgTable(
  'mailbox_mapping',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    sourceMailboxId: uuid('source_mailbox_id')
      .notNull()
      .references(() => mailbox.id, { onDelete: 'cascade' }),
    targetMailboxId: uuid('target_mailbox_id').references(() => mailbox.id, {
      onDelete: 'set null',
    }),
    pattern: text('pattern', { enum: ['shared_s', 'distribution_d'] }),
    mode: text('mode', {
      enum: ['mirror', 'bidirectional', 'one_time', 'asymmetric'],
    })
      .notNull()
      .default('mirror'),
    status: text('status', {
      enum: ['active', 'paused', 'cutover', 'done'],
    })
      .notNull()
      .default('active'),
    // User-facing name + optional cron schedule (migration 0013).
    name: text('name'),
    schedule: text('schedule'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_mapping_tenant').on(t.tenantId),
    uniqueIndex('uk_mapping_source_target').on(t.sourceMailboxId, t.targetMailboxId),
  ],
);

// ========================= Scope & collection mapping =========================

export const scopeSelection = pgTable(
  'scope_selection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => mailboxMapping.id, { onDelete: 'cascade' }),
    domain: text('domain', { enum: ['email', 'calendar', 'contact', 'file'] }).notNull(),
    included: boolean('included').notNull().default(true),
    filters: jsonb('filters').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uk_scope_mapping_domain').on(t.mappingId, t.domain)],
);

export const collectionMapping = pgTable(
  'collection_mapping',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => mailboxMapping.id, { onDelete: 'cascade' }),
    domain: text('domain', { enum: ['email', 'calendar', 'contact', 'file'] }).notNull(),
    sourceCollection: text('source_collection').notNull(),
    targetCollection: text('target_collection').notNull(),
    specialUse: text('special_use', {
      enum: [
        '\\Inbox',
        '\\Sent',
        '\\Drafts',
        '\\Junk',
        '\\Trash',
        '\\Archive',
      ],
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uk_collection_mapping').on(t.mappingId, t.domain, t.sourceCollection),
  ],
);

// ========================= The idempotency ledger =========================

export const item = pgTable(
  'item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => mailboxMapping.id, { onDelete: 'cascade' }),
    domain: text('domain', { enum: ['email', 'calendar', 'contact', 'file'] }).notNull(),
    collection: text('collection').notNull(),
    naturalKey: text('natural_key').notNull(),
    naturalKeyHash: text('natural_key_hash').notNull(), // Using text for hex hash
    contentHash: text('content_hash'),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }),
    sourceRef: jsonb('source_ref').notNull().default({}),
    targetRef: jsonb('target_ref').notNull().default({}),
    status: text('status', {
      enum: [
        'pending',
        'copied',
        'updated',
        // Already on the target under our natural key; nothing was written.
        // See migration 0017.
        'adopted',
        'skipped',
        'failed',
        // The owner saw a parked failure and chose to migrate without the
        // item. Terminal: never retried, never reported as an open problem,
        // and excluded from verification's "missing on target". See migration
        // 0021.
        'left_behind',
        'deleted_source',
        'tombstoned',
      ],
    })
      .notNull()
      .default('pending'),
    // The source's own version marker (a DAV ETag) for the item AS WE LAST
    // COPIED IT. Compared for equality on a later pass so an item edited on
    // the source during shadow gets re-copied rather than skipped forever.
    // NULL = not known: rows written before migration 0020, and any source
    // that offers no version. See migration 0020.
    sourceVersion: text('source_version'),
    // The TARGET's own version marker (an ETag) for the copy AS WE LAST WROTE
    // IT. Compared before any rewrite: if the target no longer reports this,
    // someone has edited our copy and it is not ours to replace any more.
    // NULL = not known (rows predating 0023, or a server that returns no ETag
    // on PUT) and never blocks a write. See migration 0023.
    targetVersion: text('target_version'),
    // The SOURCE's own handle for this item — a DAV href. The bridge from an
    // RFC 6578 removal report (which carries only the href) back to the item it
    // used to be. NULL = not recorded. Its own column rather than a field inside
    // `source_ref`, which stays the untouched grab-bag it has always been; see
    // migration 0025 for why a jsonb path expression was the wrong tool.
    sourceRefHref: text('source_ref_href'),
    // How many CONSECUTIVE complete scans have failed to find this item on the
    // source. Reset to 0 the moment it reappears. A single absent listing is
    // not evidence of deletion — see migration 0024.
    absentPasses: integer('absent_passes').notNull().default(0),
    // When the SOURCE first told us this item was gone — an RFC 6578
    // `sync-collection` removal report. NULL = it has told us nothing, which is
    // the case for mail and files always (neither has such a report) and for
    // every DAV item the server has not mentioned. Evidence of a different KIND
    // from `absent_passes` above, not a stronger degree of it: this needs no
    // corroboration, absence always does. See migration 0026.
    deletionReportedAt: timestamp('deletion_reported_at', { withTimezone: true }),
    // When a copy of this item was first found in the owner's BIN on the source —
    // a collection whose RFC 6154 role is `\Trash`. The source system's own
    // record that the person deleted it, and the only deletion evidence mail has.
    // A different claim from `deletion_reported_at` above, which says the object
    // is gone: this one says the owner binned it and it is still there. See
    // migration 0027.
    deletionTrashedAt: timestamp('deletion_trashed_at', { withTimezone: true }),
    // When the owner decided to keep the target's copy of an item the source no
    // longer has. NULL = still open.
    deletionAcknowledgedAt: timestamp('deletion_acknowledged_at', { withTimezone: true }),
    // When this tool REMOVED the target's copy, following the owner's decision.
    // The audit trail for the only destructive operation in the product, and what
    // distinguishes an applied decision from a `keep` — both close the queue
    // entry, only one took something away. Always alongside `status:
    // 'tombstoned'`. See migration 0028.
    deletionAppliedAt: timestamp('deletion_applied_at', { withTimezone: true }),
    // Where the SOURCE lists this item now, when that is no longer the
    // collection we copied it from. NULL = not moved. `collection` above keeps
    // pointing at where the TARGET's copy actually is, so the two together say
    // "we put it here, the source has since put it there". See migration 0022.
    movedToCollection: text('moved_to_collection'),
    // When the owner saw the move and chose to leave the target's layout
    // alone. NULL = still waiting on a decision. Cleared if the item moves
    // again somewhere else: a decision about one layout is not consent to
    // every future one.
    moveAcknowledgedAt: timestamp('move_acknowledged_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uk_item_tenant_mapping_natural_key_hash').on(
      t.tenantId,
      t.mappingId,
      t.naturalKeyHash,
    ),
    index('ix_item_status').on(t.tenantId, t.mappingId, t.status),
    index('ix_item_collection').on(t.tenantId, t.mappingId, t.domain, t.collection),
    index('ix_item_content').on(t.contentHash),
    // Partial in the migration (WHERE moved_to_collection IS NOT NULL), which
    // Drizzle cannot express here; declared so the column is indexed in the
    // model too. See 0022.
    index('ix_item_moved').on(t.tenantId, t.mappingId, t.domain),
    // Partial in the migration (WHERE absent_passes > 0). See 0024.
    index('ix_item_absent').on(t.tenantId, t.mappingId, t.domain),
    // Partial in the migration (WHERE source_ref_href IS NOT NULL). See 0025.
    index('ix_item_source_ref').on(t.tenantId, t.mappingId, t.domain, t.sourceRefHref),
  ],
);

// ========================= Sync checkpoints =========================

export const syncCheckpoint = pgTable(
  'sync_checkpoint',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => mailboxMapping.id, { onDelete: 'cascade' }),
    domain: text('domain', { enum: ['email', 'calendar', 'contact', 'file'] }).notNull(),
    collection: text('collection').notNull(),
    sourceToken: jsonb('source_token').notNull().default({}),
    lastFullScanAt: timestamp('last_full_scan_at', { withTimezone: true }),
    lastDeltaAt: timestamp('last_delta_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uk_checkpoint_mapping_domain_collection').on(
      t.mappingId,
      t.domain,
      t.collection,
    ),
  ],
);

// ========================= Runs / orchestration =========================

export const run = pgTable(
  'run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id').references(() => mailboxMapping.id, {
      onDelete: 'set null',
    }),
    kind: text('kind', {
      enum: ['initial_copy', 'incremental', 'cutover', 'verify', 'discovery', 'backup'],
    }).notNull(),
    trigger: text('trigger', { enum: ['schedule', 'manual', 'event'] })
      .notNull()
      .default('schedule'),
    status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'] })
      .notNull()
      .default('queued'),
    orchestratorRef: text('orchestrator_ref'),
    stats: jsonb('stats').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_run_tenant').on(t.tenantId, t.createdAt),
    index('ix_run_mapping').on(t.mappingId, t.createdAt),
  ],
);

export const runEvent = pgTable(
  'run_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
    level: text('level', { enum: ['debug', 'info', 'warn', 'error'] })
      .notNull()
      .default('info'),
    message: text('message').notNull(),
    detail: jsonb('detail'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ix_run_event_run').on(t.runId, t.at)],
);

// ========================= Discovery / decision queue =========================

export const decision = pgTable(
  'decision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id').references(() => mailboxMapping.id, {
      onDelete: 'cascade',
    }),
    category: text('category', {
      enum: [
        'new_mailbox',
        'deleted_mailbox',
        'quota',
        'shared_address_pattern',
        'offboarding',
        'alias_removed',
        'new_domain',
        'rules_detected',
        'target_drift',
        'other',
      ],
    }).notNull(),
    summary: text('summary').notNull(),
    detail: jsonb('detail').notNull().default({}),
    proposedDefault: text('proposed_default'),
    status: text('status', { enum: ['pending', 'resolved', 'auto_resolved', 'dismissed'] })
      .notNull()
      .default('pending'),
    resolution: jsonb('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
  },
  (t) => [
    index('ix_decision_pending').on(t.tenantId, t.status).where(sql`status = 'pending'`),
  ],
);

export const policyPreset = pgTable(
  'policy_preset',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    action: text('action', { enum: ['auto', 'ask'] }).notNull().default('ask'),
    params: jsonb('params').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uk_policy_preset_tenant_category').on(t.tenantId, t.category)],
);

// ========================= Verification & cutover =========================

export const verification = pgTable(
  'verification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => mailboxMapping.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => run.id, { onDelete: 'set null' }),
    domain: text('domain', { enum: ['email', 'calendar', 'contact', 'file'] }).notNull(),
    collection: text('collection'),
    sourceCount: bigint('source_count', { mode: 'bigint' }),
    targetCount: bigint('target_count', { mode: 'bigint' }),
    sourceBytes: bigint('source_bytes', { mode: 'bigint' }),
    targetBytes: bigint('target_bytes', { mode: 'bigint' }),
    checksumSampled: integer('checksum_sampled').default(0),
    checksumMismatches: integer('checksum_mismatches').default(0),
    // Five, matching DataTypeVerificationStatus (0003 widened the CHECK).
    // 'skipped' and 'not_verifiable' both mean NOBODY CHECKED, for different
    // reasons — persisting either as 'fail' was the shortcut workplan 0017
    // named as the one not to take.
    status: text('status', {
      enum: ['pass', 'warn', 'fail', 'skipped', 'not_verifiable'],
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ix_verif_mapping').on(t.mappingId, t.createdAt)],
);

/**
 * A verification RUN — the managed half of the contract's start + poll pair
 * (workplan 0017 T3, `0003_verification_fits_the_contract.sql`).
 *
 * `verification` above holds per-domain results; this holds the run itself:
 * running since when, finished when, failed why, and the whole wire-shaped
 * report as jsonb so `GET .../verify/report` serves what the run produced
 * rather than a reassembly that can drift. The appliance deliberately keeps
 * its report in memory instead — the contract documents that asymmetry.
 */
export const verificationRun = pgTable(
  'verification_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    mappingId: uuid('mapping_id').notNull().references(() => mailboxMapping.id),
    state: text('state', { enum: ['running', 'done', 'failed'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
    report: jsonb('report'),
  },
  (t) => [index('verification_run_mapping_started_idx').on(t.tenantId, t.mappingId, t.startedAt)],
);

export const cutover = pgTable(
  'cutover',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id').references(() => mailboxMapping.id, {
      onDelete: 'cascade',
    }),
    state: text('state', {
      enum: [
        'not_started',
        'verifying',
        'gated',
        'switched',
        'grace',
        'done',
        'rolled_back',
      ],
    })
      .notNull()
      .default('not_started'),
    gatePassed: boolean('gate_passed').notNull().default(false),
    mxSwitchedAt: timestamp('mx_switched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

// ========================= Cutover State Machine (persistent) =========================

export const cutoverState = pgTable(
  'cutover_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => mailboxMapping.id, { onDelete: 'cascade' }),
    state: text('state', {
      enum: [
        'PREPARING',
        'READY_FOR_CUTOVER',
        'APPROVED',
        'CUTOVER_IN_PROGRESS',
        'GRACE_PERIOD',
        'COMPLETED',
        'FAILED',
        'ROLLED_BACK',
      ],
    })
      .notNull()
      .default('PREPARING'),
    phase: text('phase', {
      enum: ['verification', 'approval', 'cutover', 'grace', 'completion', 'rollback'],
    })
      .notNull()
      .default('verification'),
    verificationStatus: text('verification_status', {
      enum: ['pending', 'pass', 'fail', 'warn', 'skipped'],
    })
      .notNull()
      .default('pending'),
    verificationReport: jsonb('verification_report').notNull().default({}),
    gracePeriodHours: integer('grace_period_hours').notNull().default(72),
    gracePeriodStartedAt: timestamp('grace_period_started_at', { withTimezone: true }),
    gracePeriodCompletedAt: timestamp('grace_period_completed_at', { withTimezone: true }),
    targetMailServer: text('target_mail_server'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uk_cutover_state_mapping').on(t.tenantId, t.mappingId),
    index('ix_cutover_state_tenant').on(t.tenantId),
    index('ix_cutover_state_mapping').on(t.mappingId),
  ],
);

export const cutoverEvent = pgTable(
  'cutover_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => mailboxMapping.id, { onDelete: 'cascade' }),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    fromState: text('from_state', {
      enum: [
        'PREPARING',
        'READY_FOR_CUTOVER',
        'APPROVED',
        'CUTOVER_IN_PROGRESS',
        'GRACE_PERIOD',
        'COMPLETED',
        'FAILED',
        'ROLLED_BACK',
      ],
    }), // nullable - null for initialization events
    toState: text('to_state', {
      enum: [
        'PREPARING',
        'READY_FOR_CUTOVER',
        'APPROVED',
        'CUTOVER_IN_PROGRESS',
        'GRACE_PERIOD',
        'COMPLETED',
        'FAILED',
        'ROLLED_BACK',
      ],
    }).notNull(),
    triggeredBy: text('triggered_by').notNull(),
    reason: text('reason'),
    eventType: text('event_type', { enum: ['CUTOVER_INITIALIZED', 'STATE_TRANSITION'] }).notNull().default('STATE_TRANSITION'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => [
    index('ix_cutover_event_mapping').on(t.mappingId, t.timestamp),
    index('ix_cutover_event_tenant').on(t.tenantId, t.timestamp),
  ],
);

// ========================= Optional backup target =========================

export const backupTarget = pgTable(
  'backup_target',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id').references(() => mailboxMapping.id, {
      onDelete: 'cascade',
    }),
    kind: text('kind', { enum: ['s3', 'webdav', 'local'] }).notNull(),
    config: jsonb('config').notNull().default({}),
    secretRef: text('secret_ref'),
    enabled: boolean('enabled').notNull().default(false),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

// ========================= Audit =========================

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    actor: text('actor'),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: uuid('entity_id'),
    detail: jsonb('detail'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ix_audit_tenant').on(t.tenantId, t.at)],
);

// ========================= Cursors table (for CursorStore) =========================

export const cursor = pgTable(
  'cursor',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => mailboxMapping.id, { onDelete: 'cascade' }),
    folderPath: text('folder_path').notNull(),
    cursorValue: text('cursor_value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uk_cursor_tenant_mapping_folder').on(
      t.tenantId,
      t.mappingId,
      t.folderPath,
    ),
  ],
);

// ========================= Migration Status =========================

export const migrationStatus = pgTable(
  'migration_status',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => mailboxMapping.id, { onDelete: 'cascade' }),
    domain: text('domain', { enum: ['email', 'calendar', 'contact', 'file'] }).notNull(),
    state: text('state', {
      enum: ['pending', 'in_progress', 'completed', 'failed', 'skipped'],
    })
      .notNull()
      .default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    /**
     * Where the last completed pass spent its wall time (see PassMetrics).
     * Counts and durations only — never folder names or addresses.
     */
    lastPassMetrics: jsonb('last_pass_metrics'),
  },
  (t) => [
    uniqueIndex('uk_migration_status_tenant_mapping_domain').on(
      t.tenantId,
      t.mappingId,
      t.domain,
    ),
    index('ix_migration_status_tenant_mapping').on(t.tenantId, t.mappingId),
    index('ix_migration_status_state').on(t.state),
  ],
);

// Pre-sync discovery counts per domain (workplan 0013 T2). One row per (tenant, mapping, domain);
// re-discovery overwrites. Counts are a point-in-time snapshot shown before the owner green-lights.
export const migrationDiscovery = pgTable(
  'migration_discovery',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => mailboxMapping.id, { onDelete: 'cascade' }),
    domain: text('domain', { enum: ['email', 'calendar', 'contact', 'file'] }).notNull(),
    collections: integer('collections').notNull().default(0),
    items: integer('items').notNull().default(0),
    bytes: bigint('bytes', { mode: 'number' }),
    perCollection: jsonb('per_collection'),
    // Nullable on purpose: null = "this run predates the column and did not
    // look", which is a different claim from 0 = "there were none".
    generatedIdItems: integer('generated_id_items'),
    // What the DESTINATION already holds. Nullable on purpose: null means "not
    // enumerated", which is a different claim from 0, "empty". See 0018.
    targetExisting: integer('target_existing'),
    targetColliding: integer('target_colliding'),
    lastError: text('last_error'),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uk_migration_discovery_tenant_mapping_domain').on(
      t.tenantId,
      t.mappingId,
      t.domain,
    ),
    index('ix_migration_discovery_tenant_mapping').on(t.tenantId, t.mappingId),
  ],
);

// ========================= Tenant Members =========================

export const tenantMember = pgTable(
  'tenant_member',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    role: text('role', { enum: ['owner', 'admin', 'member', 'viewer'] }).notNull().default('member'),
    status: text('status', { enum: ['active', 'invited', 'suspended', 'removed'] })
      .notNull()
      .default('active'),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_tenant_member_tenant').on(t.tenantId),
    index('ix_tenant_member_user').on(t.userId),
    uniqueIndex('uk_tenant_member').on(t.tenantId, t.userId),
  ],
);

// ========================= Usage Metrics (for billing) =========================

export const usageMetric = pgTable(
  'usage_metric',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    periodStart: text('period_start').notNull(), // Using text for date
    periodEnd: text('period_end').notNull(),
    metricType: text('metric_type', {
      enum: ['storage', 'egress', 'compute', 'api_calls'],
    }).notNull(),
    resource: text('resource'),
    quantity: text('quantity').notNull(), // Using text for numeric
    unit: text('unit').notNull(),
    unitPrice: text('unit_price').notNull(),
    totalCost: text('total_cost').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_usage_tenant_period').on(t.tenantId, t.periodStart),
    index('ix_usage_period_type').on(t.periodStart, t.metricType),
    uniqueIndex('uk_usage_metric').on(t.tenantId, t.periodStart, t.metricType, t.resource),
  ],
);

// ========================= Billing Invoices =========================

export const invoice = pgTable(
  'invoice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    status: text('status', {
      enum: ['draft', 'sent', 'paid', 'overdue', 'void'],
    })
      .notNull()
      .default('draft'),
    subtotal: text('subtotal').notNull(),
    taxRate: text('tax_rate').notNull(),
    taxAmount: text('tax_amount').notNull(),
    total: text('total').notNull(),
    currency: text('currency').notNull().default('EUR'),
    paymentMethod: text('payment_method'),
    paymentId: text('payment_id'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    dueDate: text('due_date'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_invoice_tenant').on(t.tenantId, t.periodStart),
    index('ix_invoice_status').on(t.status, t.periodStart),
    uniqueIndex('uk_invoice_tenant_period').on(t.tenantId, t.periodStart),
  ],
);

// ========================= Payment Methods =========================

export const paymentMethod = pgTable(
  'payment_method',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mollieId: text('mollie_id').notNull().unique(),
    type: text('type').notNull(),
    brand: text('brand'),
    lastFour: text('last_four'),
    expiryMonth: integer('expiry_month'),
    expiryYear: integer('expiry_year'),
    isDefault: boolean('is_default').notNull().default(false),
    status: text('status', { enum: ['active', 'expired', 'revoked'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ix_payment_method_tenant').on(t.tenantId)],
);
