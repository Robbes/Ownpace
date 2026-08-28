// Copyright 2026 The Ownpace authors (Apache-2.0)
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
  doublePrecision,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ========================= Tenancy & connections =========================

export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: text('status', { enum: ['active', 'suspended', 'closed', 'deleting'] })
    .notNull()
    .default('active'),
  settings: jsonb('settings').notNull().default({}),
  // `status` KEEPS its `closed` and `deleting` values: what state a tenant is
  // in is a fact about the tenant, and a CHECK constraint listing a value no
  // appliance ever writes costs it nothing.
  //
  // The DATES that used to sit here — closed_at, purge_after, closed_by — and
  // the agreed `pricing` do not (ADR-0036). Both are promises made to a
  // CUSTOMER: the window they chose before we delete them, and the prices they
  // signed up at. They live in `tenant_closure` and `tenant_pricing`, in
  // @openmig/managed, where absence of a row means "not closed" and "nothing
  // agreed" rather than a nullable column whose NULL had to be documented.
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
        // Google Drive as a file SOURCE (workplan 0042 T5). Underscored to match
        // the rest of this column; a mapping file spells the same provider
        // `google-drive`. Allowed by the CHECK since 0008.
        'google_drive',
        // Gmail as a mail SOURCE (workplan 0044). Its own kind, not `imap`,
        // because the credential shape differs: a Google OAuth client + refresh
        // token, not a password or static token. Allowed by the CHECK since 0012.
        'gmail',
        // Google Calendar / Contacts as SOURCES (workplan 0045). Their own
        // kinds, not caldav/carddav, for gmail's reason: the credential shape
        // is a Google OAuth client, and the kind routes the builder to it.
        // Allowed by the CHECK since 0015.
        'google_calendar',
        'google_contacts',
        // Dropbox as a file SOURCE (workplan 0055). Allowed by the CHECK
        // since 0018; the credential shape is Dropbox's own OAuth trio.
        'dropbox',
        // Box as a file SOURCE (workplan 0056). Allowed by the CHECK since
        // 0019; client id + secret only (Client Credentials Grant — Box
        // rotates refresh tokens, so none is stored), subject on the config.
        'box',
        // One Google ACCOUNT rather than one Google API (workplan 0106 T3b,
        // the owner's decision of 2026-08-27). Several faces from one row, on
        // the `soverin` precedent: which faces it serves lives in
        // PROVIDER_ACCOUNT_DOMAINS, not in a fork here. Allowed by the CHECK
        // since 0034.
        //
        // The four single-purpose Google kinds above STAY and cohabit — mail
        // and files wait on Google's restricted-scope assessment, so a person
        // migrating a mailbox still uses `gmail` today.
        'google',
      ],
    }).notNull(),
    displayName: text('display_name').notNull(),
    config: jsonb('config').notNull().default({}),
    secretRef: text('secret_ref'),
    status: text('status', { enum: ['connected', 'error', 'revoked'] })
      .notNull()
      .default('connected'),
    // What this account can CARRY, per domain, measured at the last test
    // (workplan 0106 T0): an AccountQualification blob — {mail, calendar,
    // contact, file} each yes|no|unknown with a sentence, plus the folded-in
    // scheduling verdict. NULL means never qualified (an older row, or a kind
    // qualification does not cover yet) — absence of measurement, never "no".
    // Deliberately NOT part of `config`: config is what the person TYPED,
    // this is what the provider ANSWERED, and blurring intent with
    // measurement is how a stale answer gets re-saved as a choice.
    qualification: jsonb('qualification'),
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
    // apply's gate 1 (0017 T4). DEFAULT FALSE: a mapping can remove nothing
    // from the target until somebody turns this on for it, deliberately.
    allowApplyDeletions: boolean('allow_apply_deletions').notNull().default(false),
    // ADR-0031 (accepted 2026-08-16): apply open RELOCATIONS unattended at the
    // end of each file pass. DEFAULT FALSE for the same reason — and it runs
    // with nobody looking, so four extra gates stand in front of every item.
    // Migration 0014.
    autoApplyRelocations: boolean('auto_apply_relocations').notNull().default(false),
    // NULL = merge into the account root (the default; owner decision
    // 2026-08-16). See migration 0011 and MappingConfig.targetFolderPrefix.
    targetFolderPrefix: text('target_folder_prefix'),
    /**
     * Per-mapping overrides of a SHARED connection's config (migration 0021).
     *
     * The connection answers "as whom do we sign in"; the mapping answers
     * "whose data, and where" — a Box subject, a Drive root folder, a Dropbox
     * root path. NULL means nothing to override, which is every mapping whose
     * connection is not shared. Merged override-over-connection at build time.
     */
    sourceConfigOverride: jsonb('source_config_override'),
    targetConfigOverride: jsonb('target_config_override'),
    /**
     * Credentials belonging to THIS mapping alone (migration 0032, ADR-0035
     * decision 4) — in practice the refresh token the migrated person granted
     * through their own link.
     *
     * `source_config_override`'s sibling and the same merge rule, because the
     * question is the same one: a shared connection cannot answer something
     * that is true of one mapping only. Here the split is by OWNER rather than
     * by scope — the client id and secret are the account owner's, configured
     * once on the connection; the refresh token is the migrated person's, and
     * writing it onto the connection would hand every other mapping on that
     * connection the reach of one person's account.
     *
     * `text`, not `jsonb`, like `connection.secret_ref`: the same
     * `EncryptedSecret` JSON, deliberately opaque to SQL so nothing can query
     * inside a credential.
     */
    sourceSecretRef: text('source_secret_ref'),
    /**
     * The mapping's throttle choice (migration 0017) — same shape and same
     * shared parser as the appliance's `throttleConfig`. NULL = no throttling.
     */
    throttleConfig: jsonb('throttle_config'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_mapping_tenant').on(t.tenantId),
    /**
     * A source/target pair may repeat only under a DIFFERENT target folder
     * prefix (migration 0022, owner decision 2026-08-18): two mappings writing
     * the same items into the same place would double everything in the
     * target. `COALESCE(…, '')` is load-bearing — NULL means "merge into the
     * account root", which is the default answer, and under Postgres's
     * NULLS DISTINCT two merges between the same pair would BOTH be accepted.
     */
    uniqueIndex('uk_mapping_source_target_prefix').on(
      t.sourceMailboxId,
      t.targetMailboxId,
      sql`(COALESCE(${t.targetFolderPrefix}, ''))`,
    ),
  ],
);

/**
 * A migrator's bearer link to one mapping — migration 0031, workplan 0108 T1,
 * ADR-0035's *"owners sign in; migrated people get links, not accounts"*.
 *
 * Declared here WITH the migration rather than after it: `rate_budget` shipped
 * invisible to the ORM and the gap took an integration test to notice, and a
 * table nothing typed can see is one nothing can join, assert on, or notice
 * the loss of.
 *
 * `secretHash` is a hash and never the secret. `usedAt` is spent at the grant,
 * not at the open. `expiresAt` is the owner's choice at issue time; `revokedAt`
 * is their kill switch. See the migration for why each of those is the way it
 * is, and for the two policies that do different jobs.
 */
export const mappingLink = pgTable(
  'mapping_link',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => mailboxMapping.id, { onDelete: 'cascade' }),
    /** `'grant'` supplies a credential; `'view'` reserves ADR-0035's second lifetime. */
    purpose: text('purpose', { enum: ['grant', 'view'] }).notNull(),
    secretHash: text('secret_hash').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('mapping_link_mapping_idx').on(t.mappingId, t.createdAt)],
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

/**
 * The lifecycle of one PATH — `(mapping, domain)` — which is the unit ADR-0014
 * bills and the grain at which paths must be able to end one at a time
 * (workplan 0109 T1, migration 0035).
 *
 * A SIBLING of `scope_selection` rather than columns on it: the owner's
 * decision of 2026-08-27, because the sync job reads that row on every pass to
 * decide scope, and T2 wants the month's peak, which means history a separate
 * table can carry append-only without disturbing it.
 *
 * **ABSENT MEANS `ready`.** A path with no row here is configured and has never
 * run — free, holding no slot, which is ADR-0014's own column default. It is
 * also the safe direction: an absent row can never over-bill, only under-claim.
 *
 * In the LEDGER chain deliberately (0109 T7): the lifecycle is the PRODUCT's
 * and billing is a reader of it. An appliance owner has the same need to cut
 * over mail while calendar keeps running, and putting this in the managed chain
 * would make that a paid feature by accident.
 */
export const pathLifecycle = pgTable(
  'path_lifecycle',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => mailboxMapping.id, { onDelete: 'cascade' }),
    domain: text('domain', { enum: ['email', 'calendar', 'contact', 'file'] }).notNull(),
    /**
     * ADR-0014's four plus `ready`, which `mailbox_mapping.status` never had.
     * `paused` STILL HOLDS A SLOT — it is reserved capacity, and the pricing
     * page says so; only `cutover`/`done` release one.
     */
    state: text('state', { enum: ['ready', 'active', 'paused', 'cutover', 'done'] })
      .notNull()
      .default('ready'),
    /** When this path FIRST took a slot. Never overwritten by a later one:
     *  "has this ever run" is a different question from "is it running". */
    firstActivatedAt: timestamp('first_activated_at', { withTimezone: true }),
    /** When it released one. NULL while it still holds a slot. */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The same key `scope_selection` is unique on, because it is the same
    // identity: one lifecycle per path.
    uniqueIndex('uk_path_lifecycle_mapping_domain').on(t.mappingId, t.domain),
    index('ix_path_lifecycle_tenant_state').on(t.tenantId, t.state),
  ],
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
    // The natural key the source lists this item under NOW, when the move
    // changed the key itself — a file moved or renamed, correlated by content
    // hash (ADR-0030, migration 0009). NULL for every mail and calendar move,
    // where the key survives the move, and that difference is the whole point:
    // an `apply` may remove the old copy only when this says where the new one
    // is.
    movedToNaturalKeyHash: text('moved_to_natural_key_hash'),
    // When the move above was RECORDED (migration 0013). Re-stamped when the
    // destination changes — a move somewhere new is a new report — and cleared
    // with the move. What lets the queue say how long a report has sat, and
    // what ADR-0031's survived-a-pass gate reads before auto-applying.
    movedRecordedAt: timestamp('moved_recorded_at', { withTimezone: true }),
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
    /**
     * The detector's stable identifier for WHAT this decision is about (a
     * mailbox address, a group id) — what makes re-raising idempotent via the
     * partial unique index below (migration 0005, 0028 T1). Nullable: a
     * category with no natural subject stays legal, just uncovered.
     */
    subjectKey: text('subject_key'),
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
    uniqueIndex('uk_decision_pending_subject')
      .on(t.tenantId, t.category, t.subjectKey)
      .where(sql`status = 'pending' AND subject_key IS NOT NULL`),
  ],
);

/**
 * A shared address discovered on the source (workplan 0027 T1).
 *
 * The table is ledger v1's; the columns below the member list are migration
 * 0006's, added when discovery finally gave it a writer. `pattern` is §14.1's
 * question — a shared MAILBOX (a store to copy, Pattern S) or a distribution
 * LIST (a definition to recreate, Pattern D) — and it is NULLABLE because
 * "discovered but not classifiable from what the directory said" is a real
 * state that belongs in the `shared_address_pattern` decision queue rather
 * than in a guess.
 */
export const groupDef = pgTable(
  'group_def',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    sourceConnectionId: uuid('source_connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    address: text('address').notNull(),
    /** Graph's group id — the identity that survives a rename. */
    sourceGroupId: text('source_group_id'),
    /** What an operator confirming a migration actually reads. */
    displayName: text('display_name'),
    pattern: text('pattern', { enum: ['shared_s', 'distribution_d'] }),
    members: jsonb('members').notNull().default([]),
    /**
     * Whether `members` is the answer or the absence of one. An empty list is
     * a legitimate finding AND what a failed member read leaves behind; since
     * Pattern D recreates a group from exactly this list, the two must not
     * look alike (migration 0006, hard rule 9).
     */
    membersKnown: boolean('members_known').notNull().default(true),
    targetGroupRef: text('target_group_ref'),
    status: text('status', { enum: ['pending', 'created', 'error'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_group_tenant').on(t.tenantId),
    // Rule 1: discovery re-runs, and a second row for the same group would
    // make "which member list is current" depend on read order.
    uniqueIndex('uk_group_def_source_address').on(t.tenantId, t.sourceConnectionId, t.address),
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

/**
 * One `apply` request's outcome, for the managed edition's poller (0017 T4).
 *
 * The route evaluates the ledger-side gates synchronously and refuses on the
 * request; only a PERMITTED removal gets a receipt and a job. The job lands
 * the outcome here: applied (with how final that was), refused (by a gate
 * only the target could answer — capability, or the owner edited our copy),
 * or failed. The appliance answers synchronously and has no such table.
 */
export const applyReceipt = pgTable(
  'apply_receipt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    mappingId: uuid('mapping_id').notNull().references(() => mailboxMapping.id),
    naturalKeyHash: text('natural_key_hash').notNull(),
    // Which destructive action this receipt records. One item can be in BOTH
    // queues at once (renamed, then the new name deleted), so a receipt must
    // say which question it answers — see migration 0010.
    action: text('action', { enum: ['deletion', 'relocation'] }).notNull().default('deletion'),
    state: text('state', { enum: ['queued', 'applied', 'refused', 'failed'] }).notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    kind: text('kind'),
    code: text('code'),
    reason: text('reason'),
  },
  (t) => [
    index('apply_receipt_item_idx').on(t.tenantId, t.mappingId, t.naturalKeyHash, t.requestedAt),
  ],
);

/**
 * The sharing queue's rows (ADR-0032, workplan 0052) — a grant discovered by
 * the §14.2 inventory, held as a CHECKLIST item instead of only a rendered
 * report line. `grantHash` is the grant's identity across rescans, so an
 * owner's decision is never reset to open by looking again. No FK on
 * mappingId, mirroring `item`: the appliance's mappings are config-born.
 */
/**
 * Provider setup checklist state (workplan 0061, migration 0020).
 *
 * State only — the steps are defined in `@openmig/shared`'s `provider-setup`
 * and keyed by `stepKey`, so wording and ordering change in code without a
 * data migration. Per TENANT: a Box app is created once for the organisation,
 * and the point of persisting this is that a colleague can pick it up.
 */
export const setupStep = pgTable(
  'setup_step',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    side: text('side', { enum: ['source', 'target'] }).notNull(),
    provider: text('provider').notNull(),
    stepKey: text('step_key').notNull(),
    state: text('state', { enum: ['open', 'done', 'skipped'] })
      .notNull()
      .default('open'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uk_setup_step_identity').on(t.tenantId, t.side, t.provider, t.stepKey)],
);

export const shareGrant = pgTable(
  'share_grant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    mappingId: uuid('mapping_id').notNull(),
    grantHash: text('grant_hash').notNull(),
    subject: text('subject').notNull(),
    onLabel: text('on_label').notNull(),
    grantee: text('grantee'),
    role: text('role').notNull(),
    viaLink: boolean('via_link').notNull().default(false),
    raw: text('raw').notNull(),
    verdict: text('verdict', { enum: ['clean', 'manual'] }).notNull(),
    verdictTarget: text('verdict_target').notNull(),
    state: text('state', { enum: ['open', 'applied', 'done_manual', 'skipped'] })
      .notNull()
      .default('open'),
    stateReason: text('state_reason'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uk_share_grant_identity').on(t.tenantId, t.mappingId, t.grantHash)],
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
     * What KIND of failure `last_error` was — one of six (workplan 0110 T3,
     * migration 0033). Beside the prose, never instead of it: `last_error`
     * stays verbatim because it is the precise answer, and this is the
     * ACTIONABLE one, for the customer first.
     *
     * Safe where `last_error` is not. This carries no address, no folder name
     * and no subject, which is what lets 0110's metadata-only operator views
     * say why a migration stopped at all.
     *
     * NULL = nothing has failed. `'unknown'` = something failed and we could
     * not classify it. A screen must not conflate those.
     */
    lastErrorCategory: text('last_error_category'),
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

// `tenant_member` used to be declared here. Accounts are a managed concept —
// the appliance is single-user and its HTTP surface has no login at all — so it
// moved to `@openmig/managed` with the rest of the boundary (ADR-0036).


// The billing tables — `usage_metric`, `invoice`, `payment_method` — used to be
// declared here. They moved to `@openmig/managed`'s `schema-managed.ts` when the
// edition boundary was drawn (ADR-0036): every appliance imports this module, and
// a schema is a list of things the code that loads it is allowed to name.
//
// The TABLES did not move — they are still created by `0001_baseline.sql` and are
// still there, empty, on an appliance. Only the declaration did.

/**
 * The token bucket every process shares, per (tenant, provider) — migration
 * 0024, workplan 0082 T5.
 *
 * Added here in 0083 because the migration shipped without it: `PgRateBudget`
 * issues raw SQL, so nothing typed ever referenced the table and its absence
 * from the schema was invisible until an integration test tried to read the
 * balance it had just spent. A table the ORM cannot see is one nothing else
 * can join, assert on, or notice the loss of.
 */
export const rateBudget = pgTable(
  'rate_budget',
  {
    tenantId: uuid('tenant_id').notNull(),
    provider: text('provider').notNull(),
    /** Fractional: a short gap at 10/s refills 0.4 of a token, not zero. */
    tokens: doublePrecision('tokens').notNull(),
    refilledAt: timestamp('refilled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.provider] })],
);

/**
 * The daily byte meter beside the token bucket — migration 0030, workplan
 * 0090 T2. Declared with the migration rather than after it, because
 * `rate_budget` shipped invisible to the ORM and the gap took an integration
 * test to notice (see the comment above).
 *
 * Counted on fetch, never on write, and never joined with billing: ADR-0014
 * counts each item's FIRST copy, this counts what the provider actually sent,
 * re-fetches included. Two meters, deliberately.
 */
export const byteBudget = pgTable(
  'byte_budget',
  {
    tenantId: uuid('tenant_id').notNull(),
    provider: text('provider').notNull(),
    /** Start of the fixed 24-hour window, anchored at the first byte after a reset. */
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
    /** Whole bytes — counted, never fractional. */
    spentBytes: bigint('spent_bytes', { mode: 'bigint' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.provider] })],
);

// `erasure_record` used to be declared here. It is the receipt WE produce for a
// customer as their processor, and it moved to `@openmig/managed` (ADR-0036).
// The appliance produces no receipt: its operator IS the customer, and a
// receipt we generate proves nothing to them they did not already know.

