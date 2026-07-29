// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Self-host appliance entrypoint (workplan 0010 T2).
 *
 * On startup: apply ledger migrations (advisory-locked) → load the mapping
 * configs from a directory → ensure each mapping's DB records exist and kick off
 * a read-only, body-free pre-sync discovery pass (workplan 0013 T7) → schedule
 * only mappings already 'active' with the in-process croner scheduler
 * (single-flight, so an overrunning pass never overlaps itself). A paused (draft)
 * mapping waits for the operator to green-light it on the confirm page (`GET /`,
 * `POST /mappings/:id/start`). Also serves `GET /healthz`, `GET /status`, `GET /verify`,
 * `GET /scope-manifest`, and `GET /discovery` on localhost. Graceful shutdown
 * stops the schedules, lets in-flight passes settle, and closes the server.
 *
 * Single-tenant, no managed dependencies: this file (and its transitive imports)
 * must never pull in Trigger.dev, billing, or RLS — self-host loads none of it
 * (hard rule 5). It reuses the worker's `runAllDomains` (shared, not forked).
 */

import { createServer, type Server, type ServerResponse, type IncomingMessage } from 'node:http';
import { runMigrations, createPgDb, PgMigrationStatusStore, PgDiscoveryStore, PgLedger, PgCursorStore, RunStore, withTenant } from '@openmig/ledger';
// Import the in-process scheduler directly (NOT the package index, which
// re-exports the Trigger.dev client) so self-host never loads managed code —
// hard rule 5.
import { InProcessScheduler } from '@openmig/scheduler/in-process';
import { runAllDomains, discoverAllDomains, verifyMapping } from '@openmig/worker/orchestration';
import { SCOPE_MANIFEST, MAX_ITEM_ATTEMPTS, DELETION_CONFIRMATIONS } from '@openmig/shared';
import type { TenantId, MappingId, ScheduleHandle, DiscoveryRecord, FailureAction } from '@openmig/shared';
import { loadConfigDir, type LoadedMapping } from './config-dir';
import { buildStatusReport, type MappingStatusInput } from './status';
import { renderConfirmPage, type MappingConfirmView } from './confirm-page';
import { startTransition } from './lifecycle';
import { log } from '@openmig/shared';
import { renderMetrics, METRICS_CONTENT_TYPE } from '@openmig/shared';

const DEFAULT_CONFIG_DIR = '/data/config';
const DEFAULT_SCHEDULE = '*/15 * * * *'; // every 15 minutes if a mapping omits one

// UUID generation for selfhost (deterministic based on input for idempotency)
function uuidFromString(seed: string): string {
  const hash = Buffer.from(seed).toString('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Ensure all necessary database records exist for a mapping.
 * Creates connection, mailbox, and mailbox_mapping records if they don't exist.
 * This is needed because migration_status has FK constraints on mailbox_mapping.
 * 
 * NOTE: The client passed in should already have app.current_tenant set.
 */
async function ensureMappingRecords(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  tenantId: string,
  mailboxMappingId: string,
  sourceUser: string,
  targetUser: string,
) {
  log.debug(`[selfhost] ensuring mapping records for ${mailboxMappingId}...`);
  
    // 1. Ensure connection records exist (source and target)
    const sourceConnectionId = uuidFromString(`${tenantId}:source:imap`);
    const targetConnectionId = uuidFromString(`${tenantId}:target:jmap`);

    // Insert source connection (ignore if exists)
    await client.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [sourceConnectionId, tenantId, 'source', 'imap', 'Source IMAP', JSON.stringify({ type: 'imap', host: 'stalwart', port: 143, security: 'none' }), 'connected']
    );
    log.debug(`[selfhost] ensured source connection ${sourceConnectionId}`);

    // Insert target connection (ignore if exists)
    await client.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [targetConnectionId, tenantId, 'target', 'jmap', 'Target JMAP', JSON.stringify({ type: 'jmap', host: 'stalwart', port: 8080, security: 'none' }), 'connected']
    );
    log.debug(`[selfhost] ensured target connection ${targetConnectionId}`);

    // 2. Ensure mailbox records exist (source and target)
    const sourceMailboxId = uuidFromString(`${tenantId}:mailbox:source:${sourceUser}`);
    const targetMailboxId = uuidFromString(`${tenantId}:mailbox:target:${targetUser}`);

    // Insert source mailbox (ignore if exists)
    await client.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [sourceMailboxId, tenantId, sourceConnectionId, sourceUser, 'user', sourceUser, sourceUser, 'active']
    );
    log.debug(`[selfhost] ensured source mailbox ${sourceMailboxId}`);

    // Insert target mailbox (ignore if exists)
    await client.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [targetMailboxId, tenantId, targetConnectionId, targetUser, 'user', targetUser, targetUser, 'active']
    );
    log.debug(`[selfhost] ensured target mailbox ${targetMailboxId}`);

    // 3. Ensure mailbox_mapping record exists (ignore if exists)
    await client.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      // 0013 T7: created PAUSED (draft) — only scheduled after the operator confirms at GET /.
      [mailboxMappingId, tenantId, sourceMailboxId, targetMailboxId, 'mirror', 'paused']
    );
    log.debug(`[selfhost] ensured mailbox_mapping ${mailboxMappingId}`);
}

export interface SelfhostOptions {
  readonly databaseUrl?: string;
  readonly configDir?: string;
  readonly port?: number;
  readonly host?: string;
}

export interface SelfhostHandle {
  readonly port: number;
  stop(): Promise<void>;
}

/** Start the appliance. Returns a handle for graceful shutdown (used by tests too). */
export async function start(options: SelfhostOptions = {}): Promise<SelfhostHandle> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const configDir = options.configDir ?? process.env.CONFIG_DIR ?? DEFAULT_CONFIG_DIR;
  const port = options.port ?? Number(process.env.PORT ?? 8080);
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';

  // 1. Self-migrate under the advisory lock (refuses to start if DB is newer).
  log.info('[selfhost] applying migrations…');
  await runMigrations({ connectionString: databaseUrl });

  // 2. Load and validate the mapping configs.
  const mappings = loadConfigDir(configDir);
  log.info(`[selfhost] loaded ${mappings.length} mapping(s) from ${configDir}`);

  // 3. Wire the status store + scheduler.
  const db = createPgDb(databaseUrl);
  const statusStore = new PgMigrationStatusStore(db);
  const discoveryStore = new PgDiscoveryStore(db);
  // The failure queue's two reads and two writes (§11.2's "actions required").
  const ledger = new PgLedger(db);
  const cursorStore = new PgCursorStore(db);
  const scheduler = new InProcessScheduler();
  const handles: ScheduleHandle[] = [];
  // config mappingIds currently scheduled (only 'active' mappings run — 0013 T7).
  const scheduled = new Set<string>();

  // Helper to run a function with tenant context set for RLS
  const withTenantContext = async <T>(
    tenantId: string,
    fn: (client: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<T>
  ): Promise<T> => {
    const client = await db.$pool.connect();
    try {
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
      return await fn(client);
    } finally {
      client.release();
    }
  };

  // Ensure the tenant + connection/mailbox/mailbox_mapping records for a mapping (idempotent).
  // migration_status and migration_discovery both FK mailbox_mapping, so this must run before
  // either a sync pass or a discovery pass.
  const ensureRecordsFor = async (m: LoadedMapping) => {
    await withTenantContext(m.config.tenantId as string, async (client) => {
      // Ensure tenant exists before running (idempotent)
      await client.query(
        `INSERT INTO tenant (id, name, status, settings)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [m.config.tenantId, `Tenant ${m.config.tenantId.slice(0, 8)}`, 'active', '{}']
      );
      // Ensure all necessary database records exist (connection, mailbox, mailbox_mapping)
      const sourceUser = m.config.source.type === 'imap-oauth2' ? m.config.source.user : 'unknown';
      const targetUser = m.config.target.type === 'jmap' ? m.config.target.user : 'unknown';
      await ensureMappingRecords(
        client,
        m.config.tenantId as string,
        m.mailboxMappingId,
        sourceUser,
        targetUser,
      );
    });
  };

  // Read the current mailbox_mapping status ('paused' | 'active' | 'cutover' | 'done').
  const mappingStatus = async (m: LoadedMapping): Promise<string> =>
    withTenantContext(m.config.tenantId as string, async (client) => {
      const { rows } = await client.query(
        `SELECT status FROM mailbox_mapping WHERE id = $1`,
        [m.mailboxMappingId],
      );
      const row = rows[0] as { status?: string } | undefined;
      return row?.status ?? 'paused';
    });

  const runMapping = (m: LoadedMapping) => async () => {
    try {
      log.info(`[selfhost] ${m.config.mappingId}: starting pass...`);
      await ensureRecordsFor(m);

      // Use the mailbox_mapping ID (not the config mappingId) for migration_status
      const configWithCorrectMappingId = {
        ...m.config,
        mappingId: m.mailboxMappingId,
      };

      log.info(`[selfhost] ${m.config.mappingId}: running domains...`);

      // One `run` row per pass so /status and the run history reflect what
      // actually executed. Opened before the pass so a crash leaves a `running`
      // row rather than no trace. Bookkeeping is best-effort throughout: it must
      // never abort the sync it describes.
      const tenantId = configWithCorrectMappingId.tenantId as TenantId;
      const mappingId = configWithCorrectMappingId.mappingId as MappingId;
      let runId: string | null = null;
      try {
        runId = await withTenant(db.$pool, tenantId, async (tdb) =>
          new RunStore(tdb).startRun({ tenantId, mappingId, kind: 'incremental', trigger: 'schedule' }),
        );
      } catch (err) {
        log.error(`[selfhost] ${m.config.mappingId}: failed to open run row:`, err instanceof Error ? err.message : err);
      }

      const results = await runAllDomains(configWithCorrectMappingId, statusStore);
      const created = results.reduce((n, r) => n + r.created, 0);

      if (runId) {
        const id = runId;
        const failures = results.filter((r) => r.error);
        try {
          await withTenant(db.$pool, tenantId, async (tdb) => {
            const runs = new RunStore(tdb);
            for (const r of results) {
              // Failures carry the real message verbatim (hard rule 9).
              if (r.error) {
                await runs.logEvent(tenantId, id, 'error', `${r.domain} sync failed: ${r.error}`, { domain: r.domain });
              } else {
                await runs.logEvent(tenantId, id, 'info',
                  `${r.domain}: ${r.created} created, ${r.skipped} skipped`,
                  { domain: r.domain, created: r.created, skipped: r.skipped });
              }
            }
            await runs.finishRun(id, failures.length > 0 && failures.length === results.length ? 'failed' : 'succeeded', {
              itemsProcessed: results.reduce((n, r) => n + r.created + r.skipped, 0),
              errors: failures.length,
            });
          });
        } catch (err) {
          log.error(`[selfhost] ${m.config.mappingId}: failed to close run row:`, err instanceof Error ? err.message : err);
        }
      }

      log.info(`[selfhost] ${m.config.mappingId}: pass complete (${created} created)`);
    } catch (err) {
      // Surface, never swallow (hard rule 9). The scheduler keeps running.
      log.error(`[selfhost] ${m.config.mappingId}: pass failed:`, err instanceof Error ? err.message : err);
    }
  };

  // Schedule a mapping's recurring sync (idempotent — guards the `scheduled` set so an
  // operator confirming twice never double-schedules).
  const scheduleMapping = (m: LoadedMapping) => {
    if (scheduled.has(m.config.mappingId)) return;
    const cron = m.config.schedule?.cron ?? DEFAULT_SCHEDULE;
    handles.push(scheduler.schedule(m.config.mappingId, cron, runMapping(m)));
    scheduled.add(m.config.mappingId);
    log.info(`[selfhost] scheduled ${m.config.mappingId} (${cron})`);
  };

  // Startup: ensure records, fire read-only discovery in the background, and schedule
  // only mappings that are already 'active'. Paused (draft) mappings wait for the operator
  // to confirm on the page (0013 T7).
  for (const m of mappings) {
    await ensureRecordsFor(m);

    const configWithCorrectMappingId = { ...m.config, mappingId: m.mailboxMappingId };
    // Best-effort, non-blocking: discovery counts populate as the source is scanned.
    void discoverAllDomains(
      configWithCorrectMappingId,
      discoveryStore,
      m.config.tenantId as TenantId,
      m.mailboxMappingId as MappingId,
    ).catch((err) => {
      log.error(
        `[selfhost] ${m.config.mappingId}: discovery failed:`,
        err instanceof Error ? err.message : err,
      );
    });

    const status = await mappingStatus(m);
    if (status === 'active') {
      scheduleMapping(m);
    } else {
      log.info(`[selfhost] ${m.config.mappingId} is '${status}' — awaiting confirm at /`);
    }
  }

  // Build the per-mapping confirm views (status + discovery counts) for the page/JSON routes.
  const buildViews = async (): Promise<MappingConfirmView[]> => {
    const views: MappingConfirmView[] = [];
    for (const m of mappings) {
      const status = await mappingStatus(m);
      const domains = await discoveryStore.getDiscovery(
        m.config.tenantId as TenantId,
        m.mailboxMappingId as MappingId,
      );
      views.push({ mappingId: m.config.mappingId, status, domains });
    }
    return views;
  };

  // 4. Local status/health + confirm server.
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
        const views = await buildViews();
        const html = renderConfirmPage({ mappings: views, manifest: SCOPE_MANIFEST });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (req.method === 'GET' && req.url === '/healthz') {
        return sendJson(res, 200, { status: 'ok' });
      }
      // Prometheus scrape target (§18 names Grafana/LGTM; §19 wants per-tenant
      // dashboards). Plain text, not JSON, and deliberately unauthenticated in
      // the same way /healthz is: the appliance binds to localhost by default
      // (SELFHOST_BIND), and the body carries counts and durations only — no
      // addresses, no folder names (§17).
      if (req.method === 'GET' && req.url === '/metrics') {
        res.writeHead(200, { 'content-type': METRICS_CONTENT_TYPE });
        res.end(renderMetrics());
        return;
      }
      if (req.method === 'GET' && req.url === '/scope-manifest') {
        return sendJson(res, 200, SCOPE_MANIFEST);
      }
      if (req.method === 'GET' && req.url === '/status') {
        const inputs: MappingStatusInput[] = [];
        for (const m of mappings) {
          const statuses = await statusStore.getStatus(
            m.config.tenantId as TenantId,
            m.mailboxMappingId as MappingId,
          );
          // Counted here rather than left to /failures, because /status is what
          // anyone watching a migration actually polls. A run with items stuck
          // in the queue must not look identical to one with none.
          const failures = await ledger.listFailures(
            m.config.tenantId as TenantId,
            m.mailboxMappingId as MappingId,
          );
          inputs.push({ mappingId: m.config.mappingId, statuses, failures });
        }
        return sendJson(res, 200, buildStatusReport(inputs));
      }
      // The §20 verification gate. Without this a self-host operator has no way
      // to run it at all: the managed edition reaches it through the cutover
      // job, and neither edition's UI does. Read-only — it counts and samples,
      // it never writes to the target or advances any cutover state.
      if (req.method === 'GET' && req.url === '/verify') {
        const reports: Record<string, unknown> = {};
        for (const m of mappings) {
          reports[m.config.mappingId] = await verifyMapping({
            ...m.config,
            mappingId: m.mailboxMappingId,
          } as typeof m.config);
        }
        return sendJson(res, 200, reports);
      }
      // The failure queue: what could not be migrated, why, and how many times
      // we tried. This is the INSIGHT half of §11.2's decision queue — the
      // actions are the two POSTs below.
      //
      // Deliberately keyed by natural-key HASH rather than the natural key. A
      // file's natural key is its path, which §17 treats as personal data, and
      // this body may be piped into a ticket or a chat. The hash is all the
      // two actions need.
      if (req.method === 'GET' && req.url === '/failures') {
        const out: Record<string, unknown> = {};
        for (const m of mappings) {
          const failures = await ledger.listFailures(
            m.config.tenantId as TenantId,
            m.mailboxMappingId as MappingId,
          );
          out[m.config.mappingId] = {
            // Split rather than left for the reader to filter: they are
            // different situations. One is still being worked on; the other is
            // waiting on a person and will otherwise never move.
            needsDecision: failures.filter((f) => f.needsDecision),
            retrying: failures.filter((f) => !f.needsDecision),
            howToResolve: {
              retry:
                `POST /mappings/{mappingId}/failures/{naturalKeyHash}/retry — the cause is ` +
                `fixed; try again on the next pass. Also clears this mapping's cursors so the ` +
                `item is certain to be listed again.`,
              accept:
                `POST /mappings/{mappingId}/failures/{naturalKeyHash}/accept — migrate ` +
                `without it. Permanent: the item stops being retried and stops counting as ` +
                `missing at the verification gate.`,
              doNothing:
                `Items under "retrying" need no action — they are attempted again on every ` +
                `pass until ${MAX_ITEM_ATTEMPTS} attempts, then move to "needsDecision".`,
            },
          };
        }
        return sendJson(res, 200, out);
      }
      // The move queue: items the owner relocated on the SOURCE after the
      // migration started, which the target has not followed. The other half of
      // §11.2's decision queue — /failures is "could not be copied", this is
      // "copied, but the source has since put it somewhere else".
      //
      // Nothing here has been acted on. §11.1 leaves topology to the owner, and
      // making the target match would mean removing the copy from where it
      // currently sits — the delete half of a move, which hard rule 2 forbids
      // outright. So the queue is insight plus one decision: leave it.
      //
      // `from`/`to` ARE folder paths, unlike everything keyed by hash above.
      // They have to be: "12 items moved" that cannot say where is not a queue
      // anyone can act on. §17 keeps paths out of METRIC labels, which is a
      // different store with different retention; this is the operator's own
      // status surface, the same place `lastError` already goes.
      if (req.method === 'GET' && req.url === '/moves') {
        const out: Record<string, unknown> = {};
        for (const m of mappings) {
          const all = await ledger.listMoves(
            m.config.tenantId as TenantId,
            m.mailboxMappingId as MappingId,
          );
          out[m.config.mappingId] = {
            // Split, as with failures: one still wants a person, the other has
            // already had one.
            open: all.filter((mv) => !mv.acknowledgedAt),
            acknowledged: all.filter((mv) => mv.acknowledgedAt),
            whatThisMeans:
              'The item is on the target under "from". The source now lists it under "to". ' +
              'Nothing was written, copied or deleted on either side.',
            howToResolve: {
              keep:
                `POST /mappings/{mappingId}/moves/{naturalKeyHash}/keep — the target's layout ` +
                `is fine as it is; stop reporting this one. Reversible only in the sense that ` +
                `moving the item somewhere else again reopens it.`,
              byHand:
                'To make the target match, move the item there yourself in the target system, ' +
                'then keep. Applying a move automatically would have to delete the copy that ' +
                'is there now, which this tool never does on its own (hard rule 2).',
              doNothing:
                'A move that is put back on the source disappears from this list by itself on ' +
                'the next pass.',
            },
          };
        }
        return sendJson(res, 200, out);
      }
      // The deletions queue: items the SOURCE no longer has, which the target
      // still holds. The third arm of §11.2's decision queue — /failures is
      // "could not be copied", /moves is "the source put it somewhere else",
      // this is "the source no longer has it at all".
      //
      // NOTHING HERE HAS BEEN REMOVED, and nothing will be without a separate,
      // explicitly destructive action that does not exist yet. §11.1 says
      // deletions are never auto-propagated and hard rule 2 forbids the tool
      // deleting on its own; neither says the owner may not decide.
      //
      // `confirmed` is the number to read. An absence seen once has innocent
      // explanations — a folder briefly missing from discovery, a throttled
      // listing, a connector having a bad ten minutes — so an item is watched
      // until it has vanished from several CONSECUTIVE complete scans before
      // anyone is asked about it.
      if (req.method === 'GET' && req.url === '/deletions') {
        const out: Record<string, unknown> = {};
        for (const m of mappings) {
          const all = await ledger.listDeletions(
            m.config.tenantId as TenantId,
            m.mailboxMappingId as MappingId,
          );
          out[m.config.mappingId] = {
            confirmed: all.filter((d) => d.confirmed && !d.acknowledgedAt),
            // Not yet worth acting on, shown so the queue is not a black box.
            watching: all.filter((d) => !d.confirmed && !d.acknowledgedAt),
            acknowledged: all.filter((d) => d.acknowledgedAt),
            whatThisMeans:
              'The item is on the target. The source has stopped listing it, for ' +
              `${DELETION_CONFIRMATIONS} or more consecutive complete scans. Nothing has been ` +
              'removed from either side.',
            howToResolve: {
              keep:
                `POST /mappings/{mappingId}/deletions/{naturalKeyHash}/keep — you are happy ` +
                `for the new system to keep its copy; stop reporting this one. This is the ` +
                `usual answer: the target becoming a fuller archive than the shrinking source ` +
                `is a feature, not a fault.`,
              byHand:
                'To remove it from the target, delete it there yourself, then keep. This tool ' +
                'never deletes on a target (hard rule 2).',
              doNothing:
                'An item that reappears on the source drops off this list by itself, and its ' +
                'count resets — a run of absences has to be consecutive to mean anything.',
            },
          };
        }
        return sendJson(res, 200, out);
      }
      const deletionMatch =
        req.method === 'POST' && req.url
          ? /^\/mappings\/([^/]+)\/deletions\/([^/]+)\/(keep)$/.exec(req.url)
          : null;
      if (deletionMatch) {
        await drain(req);
        const id = decodeURIComponent(deletionMatch[1]!);
        const hash = decodeURIComponent(deletionMatch[2]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });

        const applied = await ledger.resolveDeletion(
          m.config.tenantId as TenantId,
          m.mailboxMappingId as MappingId,
          hash,
          'keep',
        );
        // False means there is no CONFIRMED, open absence under that key — it
        // came back, it is still only being watched, or someone already decided.
        if (!applied) {
          return sendJson(res, 404, {
            error: 'no confirmed, open disappearance under that natural key',
            hint:
              'It may have reappeared on the source, already been acknowledged, or not yet ' +
              `been missing for ${DELETION_CONFIRMATIONS} consecutive scans.`,
          });
        }

        log.info(
          `[selfhost] ${m.config.mappingId}: operator chose 'keep' for vanished item ${hash.slice(0, 12)}`,
        );
        return sendJson(res, 200, {
          status: 'ok',
          action: 'keep',
          naturalKeyHash: hash,
          effect:
            "Acknowledged. The target keeps its copy and this stops being reported unless the " +
            'item reappears on the source and vanishes again.',
        });
      }
      const moveMatch =
        req.method === 'POST' && req.url
          ? /^\/mappings\/([^/]+)\/moves\/([^/]+)\/(keep)$/.exec(req.url)
          : null;
      if (moveMatch) {
        await drain(req);
        const id = decodeURIComponent(moveMatch[1]!);
        const hash = decodeURIComponent(moveMatch[2]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });

        const applied = await ledger.resolveMove(
          m.config.tenantId as TenantId,
          m.mailboxMappingId as MappingId,
          hash,
          'keep',
        );
        // False means no OPEN move under that key — it was moved back on the
        // source, or someone already decided. Saying "not found" beats
        // reporting a decision that did not happen.
        if (!applied) {
          return sendJson(res, 404, {
            error: 'no open move under that natural key',
            hint: 'It may have been moved back on the source, or already been acknowledged.',
          });
        }

        log.info(`[selfhost] ${m.config.mappingId}: operator chose 'keep' for moved item ${hash.slice(0, 12)}`);
        return sendJson(res, 200, {
          status: 'ok',
          action: 'keep',
          naturalKeyHash: hash,
          effect:
            'Acknowledged. Nothing changed on the source or the target; this move stops being ' +
            'reported unless the item moves somewhere else again.',
        });
      }
      const failureMatch =
        req.method === 'POST' && req.url
          ? /^\/mappings\/([^/]+)\/failures\/([^/]+)\/(retry|accept)$/.exec(req.url)
          : null;
      if (failureMatch) {
        await drain(req);
        const id = decodeURIComponent(failureMatch[1]!);
        const hash = decodeURIComponent(failureMatch[2]!);
        const action = failureMatch[3] as FailureAction;
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });

        const applied = await ledger.resolveFailure(
          m.config.tenantId as TenantId,
          m.mailboxMappingId as MappingId,
          hash,
          action,
        );
        // False means there is no FAILED row under that key — it succeeded in
        // the meantime, or someone already decided. Saying "not found" beats
        // reporting a decision that did not happen.
        if (!applied) {
          return sendJson(res, 404, {
            error: 'no unresolved failure under that natural key',
            hint: 'It may have succeeded on a later pass, or already been retried or accepted.',
          });
        }

        if (action === 'retry') {
          // A parked item does not hold the cursor back, so by now the source
          // may not be listing it as changed. Cursors are non-authoritative
          // (ADR-0020): dropping them costs one full, still-idempotent re-scan
          // and guarantees the item is put back in front of the loop.
          await cursorStore.clear(m.config.tenantId as TenantId, m.mailboxMappingId as MappingId);
        }

        log.info(`[selfhost] ${m.config.mappingId}: operator chose '${action}' for item ${hash.slice(0, 12)}`);
        return sendJson(res, 200, {
          status: 'ok',
          action,
          naturalKeyHash: hash,
          effect:
            action === 'retry'
              ? 'Attempts reset and cursors cleared; the next scheduled pass will try again.'
              : 'Left behind for good: no further retries, and excluded from the verification gate.',
        });
      }
      if (req.method === 'GET' && req.url === '/discovery') {
        const out: Record<string, DiscoveryRecord[]> = {};
        for (const m of mappings) {
          out[m.config.mappingId] = await discoveryStore.getDiscovery(
            m.config.tenantId as TenantId,
            m.mailboxMappingId as MappingId,
          );
        }
        return sendJson(res, 200, out);
      }
      const startMatch = req.method === 'POST' && req.url ? /^\/mappings\/([^/]+)\/start$/.exec(req.url) : null;
      if (startMatch) {
        await drain(req);
        const id = decodeURIComponent(startMatch[1]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });

        const status = await mappingStatus(m);
        const transition = startTransition(status);
        if ('conflict' in transition) {
          return sendJson(res, 409, { error: transition.conflict });
        }
        if (transition.activate) {
          await withTenantContext(m.config.tenantId as string, async (client) => {
            await client.query(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [m.mailboxMappingId]);
          });
          log.info(`[selfhost] ${m.config.mappingId}: activated by operator`);
        }
        scheduleMapping(m);
        // Redirect back to the confirm page (Post/Redirect/Get).
        res.writeHead(303, { location: '/' });
        res.end();
        return;
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      // Log it, with the stack, before answering. A failing request used to
      // leave NOTHING in the container logs: the message went into the response
      // body and nowhere else, so the diagnostics artifact — the only thing we
      // get back from a self-hosted run — showed a healthy-looking appliance
      // next to a bare 500. Hard rule 9: the cause has to survive somewhere.
      //
      // The stack stays server-side. Error messages already cross the wire and
      // that is enough to act on; stacks carry filesystem layout, and driver
      // errors can quote a connection string, neither of which belongs in an
      // HTTP body (workplan 0010 T4, secret hygiene).
      log.error(`[selfhost] ${req.method} ${req.url} failed:`, err);
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : 'internal error',
      });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const boundPort = (server.address() as { port: number }).port;
  log.info(`[selfhost] status server on http://${host}:${boundPort}`);

  return {
    port: boundPort,
    stop: () => shutdown(server, handles, db),
  };
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Consume and discard a request body (the start form POSTs no fields we need). */
function drain(req: IncomingMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    req.on('data', () => {});
    req.on('end', () => resolve());
    req.on('error', reject);
  });
}

async function shutdown(
  server: Server,
  handles: readonly ScheduleHandle[],
  db: { close: () => Promise<void> },
): Promise<void> {
  // Stop scheduling new passes; single-flight means no pass overlaps, so any
  // in-flight pass runs to completion (persisting its cursors) before we exit.
  for (const h of handles) h.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
}

// CLI entrypoint (skipped when imported by tests).
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === `file://${invokedPath}`) {
  start()
    .then((handle) => {
      const graceful = () => {
        log.info('[selfhost] shutting down…');
        handle.stop().then(() => process.exit(0)).catch(() => process.exit(1));
      };
      process.on('SIGTERM', graceful);
      process.on('SIGINT', graceful);
    })
    .catch((err) => {
      log.error('[selfhost] failed to start:', err);
      process.exit(1);
    });
}
