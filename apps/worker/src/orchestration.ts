// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Multi-domain sync orchestration, shared by the worker CLI and the self-host
 * entrypoint (workplan 0010 T2 — "extract/share it, don't fork it"). Runs each
 * enabled domain (mail via runShadowPass; calendar/contact/file via the DAV
 * runners) with per-domain migration_status tracking. Domain failures are
 * recorded and do not block the other domains.
 *
 * Importing this module has no side effects (unlike index.ts, which is the CLI
 * entrypoint and calls main()).
 */

import type {
  MappingConfig,
  MigrationStatusStore,
  DiscoveryStore,
  DiscoveryDomain,
  TenantId,
  MappingId,
} from '@openmig/shared';
import {
  runShadowPass,
  runCalendarSync,
  runContactSync,
  runFileSync,
  discoverSource,
  discoverTarget,
  type CountableTarget,
  runVerification,
  createRealVerificationDeps,
  type VerificationResult,
} from '@openmig/core';
import { createLedgerVerificationReader } from '@openmig/ledger';
import {
  naturalKeyHash,
  calendarNaturalKeyHash,
  contactNaturalKeyHash,
  fileNaturalKeyHash,
} from '@openmig/shared';
import type { TargetReindexer } from '@openmig/shared';
import { buildDeps, buildDomainDeps } from './build-deps';
import { discoverDomains, type DomainDiscoveryTask, type DomainDiscoveryOutcome } from './discovery';
import { log, metrics as registry, MAX_ITEM_ATTEMPTS, type PassMetrics } from '@openmig/shared';

/**
 * Feed one completed pass into the Prometheus registry (§19 dashboards).
 *
 * Labels are tenant/mapping ids and the fixed domain name ONLY. §17 treats
 * addresses and folder names as personal data, and a metrics store has
 * different retention and access than the ledger — `assertOpaqueLabel` in
 * metrics.ts refuses anything that looks like either.
 */
function recordPassMetrics(
  tenantId: string,
  mappingId: string,
  domain: SyncDomain,
  outcome: DomainSyncResult,
): void {
  const labels = { tenant: tenantId, mapping: mappingId, domain };
  registry.itemsMigrated.inc({ ...labels, outcome: 'created' }, outcome.created);
  registry.itemsMigrated.inc({ ...labels, outcome: 'adopted' }, outcome.adopted);
  registry.itemsMigrated.inc({ ...labels, outcome: 'skipped' }, outcome.skipped);
  // Its own outcome label rather than folded into 'created': a rewrite is the
  // only thing this tool does that overwrites anything, so it has to be
  // countable on its own in §19's dashboards.
  registry.itemsMigrated.inc({ ...labels, outcome: 'updated' }, outcome.updated ?? 0);
  registry.itemsFailed.inc(labels, outcome.failed);
  // Parked failures are a GAUGE, not a counter: the question is "how many are
  // waiting for me right now", and it goes down when someone acts. Counted
  // per domain only — never per item, since the natural key of a file is a
  // path and §17 keeps those out of a metrics store.
  registry.itemsNeedingDecision.set(labels, outcome.needsDecision ?? 0);

  const m: PassMetrics | undefined = outcome.metrics;
  if (!m) return;
  registry.passDuration.observe(labels, m.wallMs / 1000);
  registry.passOverlap.set(labels, Number(m.overlap.toFixed(3)));
  if (m.items > 0) {
    registry.itemDuration.observe({ ...labels, phase: 'source_fetch' }, m.sourceFetchMs / m.items / 1000);
    registry.itemDuration.observe({ ...labels, phase: 'target_write' }, m.targetWriteMs / m.items / 1000);
  }
}

export interface DomainSyncResult {
  domain: 'email' | 'calendar' | 'contact' | 'file';
  scanned: number;
  created: number;
  skipped: number;
  /** Already on the target under our natural key; not written. */
  adopted: number;
  /**
   * Rewritten because the source version moved on after we copied them — the
   * shadow-sync update path (§11.1). Absent for mail, whose messages are
   * immutable and which therefore has nothing to update.
   */
  updated?: number;
  /**
   * Changed on the source but left alone because the target copy is the
   * CUSTOMER'S (adopted), not ours. A real source/target divergence, and the
   * only place it is visible.
   */
  changedButAdopted?: number;
  failed: number;
  /** Failures that have run out of automatic retries and need an owner decision. */
  needsDecision?: number;
  /** Items the owner accepted leaving behind. */
  leftBehind?: number;
  /**
   * Items the source now shows in a different collection from the one they were
   * copied into. Never acted on — §11.1 gives the owner authority over where
   * things live. A count only: the folder paths stay on the status surface.
   */
  moved?: number;
  /**
   * Rewrites the target refused because our copy had been edited there. The
   * source change was NOT applied and the item is now treated as the owner's.
   */
  conflicted?: number;
  error?: string;
  /** Where this pass's wall time went; absent for a domain that did not run. */
  metrics?: PassMetrics;
}

export type SyncDomain = 'email' | 'calendar' | 'contact' | 'file';

/**
 * The hostnames a source or target config talks to, for lane grouping.
 *
 * Unrecognised shapes return nothing, which is the safe answer: a domain whose
 * hosts we cannot name shares a lane with everything, so it runs sequentially
 * exactly as it always did.
 */
function endpointHost(endpoint: unknown): string | undefined {
  const e = endpoint as { url?: string; baseUrl?: string; host?: string };
  const raw = e?.url ?? e?.baseUrl;
  if (raw) {
    try {
      return new URL(raw).host;
    } catch {
      return undefined;
    }
  }
  return e?.host;
}

/**
 * Split domains into lanes that may safely run at the same time.
 *
 * Domains ran strictly one after another: email, then calendar, then contacts,
 * then files. Run #38 spent 939 seconds that way, and for most of it three of
 * the four servers involved were idle.
 *
 * They are not, however, independent of each other. Calendar, contacts and
 * files typically land on ONE server — a Nextcloud whose default SQLite is a
 * single-writer database that genuinely returns "database is locked" under
 * concurrent writes (that is why `requestWithRetry` exists). Running those
 * three at once is how you turn a slow migration into a failing one, which is
 * the lesson run #37 already charged us for once.
 *
 * So: two domains may overlap only if they touch NO host in common. Domains
 * sharing any host — source or target — collapse into one lane and stay
 * sequential within it; lanes run in parallel. On the usual mail-plus-DAV
 * shape that yields two lanes, and the total is the longer of the two rather
 * than the sum of everything.
 *
 * Order within a lane is preserved, so behaviour with a single lane is
 * byte-for-byte what it was.
 */
export function planDomainLanes(
  config: MappingConfig,
  domains: ReadonlyArray<SyncDomain>,
): SyncDomain[][] {
  const configFor: Record<SyncDomain, { source?: unknown; target?: unknown } | undefined> = {
    email: config.domains?.mail,
    calendar: config.domains?.calendar,
    contact: config.domains?.contacts,
    file: config.domains?.files,
  };

  // host -> index of the lane that already claimed it.
  const laneOfHost = new Map<string, number>();
  const lanes: SyncDomain[][] = [];

  for (const domain of domains) {
    const domainConfig = configFor[domain];
    const hosts = [
      endpointHost(domainConfig?.source ?? config.source),
      endpointHost(domainConfig?.target ?? config.target),
    ].filter((h): h is string => h !== undefined);

    // A domain we cannot place by host joins the first lane, keeping the old
    // fully-sequential behaviour rather than guessing it is isolated. When it
    // is the first domain there is no lane yet, so open one.
    if (hosts.length === 0 && lanes.length === 0) {
      lanes.push([]);
    }
    const claimed =
      hosts.length === 0
        ? [0]
        : hosts.map((h) => laneOfHost.get(h)).filter((i): i is number => i !== undefined);
    const unique = [...new Set(claimed)].sort((a, b) => a - b);

    let lane: number;
    if (unique.length === 0) {
      lane = lanes.length;
      lanes.push([]);
    } else {
      // Shares hosts with more than one existing lane: merge them, because
      // running either alongside the other would put concurrent load on a
      // server that a lane boundary was supposed to protect.
      lane = unique[0]!;
      for (const other of unique.slice(1).reverse()) {
        lanes[lane]!.push(...lanes[other]!);
        lanes.splice(other, 1);
        for (const [host, idx] of laneOfHost) {
          if (idx === other) laneOfHost.set(host, lane);
          else if (idx > other) laneOfHost.set(host, idx - 1);
        }
      }
    }

    lanes[lane]!.push(domain);
    for (const host of hosts) laneOfHost.set(host, lane);
  }

  // Merging appends one lane's domains after another's, which can leave a
  // merged lane out of the caller's order. Any order within a lane is correct
  // — they are sequential either way — but a stable one keeps the "running N
  // lanes" log line readable and the tests deterministic.
  const rank = new Map(domains.map((d, i) => [d, i]));
  for (const lane of lanes) {
    lane.sort((a, b) => rank.get(a)! - rank.get(b)!);
  }

  return lanes.filter((l) => l.length > 0);
}

/** Run all enabled domains for one mapping config, with status tracking. */
export async function runAllDomains(
  config: MappingConfig,
  statusStore: MigrationStatusStore,
): Promise<DomainSyncResult[]> {
  const results: DomainSyncResult[] = [];
  const domains: Array<{ name: SyncDomain; enabled: boolean }> = [
    { name: 'email', enabled: config.domains?.mail?.enabled ?? false },
    { name: 'calendar', enabled: config.domains?.calendar?.enabled ?? false },
    { name: 'contact', enabled: config.domains?.contacts?.enabled ?? false },
    { name: 'file', enabled: config.domains?.files?.enabled ?? false },
  ];

  // Backward compatibility: a config with no domains block but an IMAP source
  // runs mail only.
  const hasDomainConfig = config.domains && Object.values(config.domains).some((d) => d?.enabled);
  const runMailOnly = !hasDomainConfig && config.source.type === 'imap-oauth2';
  if (runMailOnly) {
    domains[0]!.enabled = true;
  }

  const tenantId = config.tenantId as TenantId;
  const mappingId = config.mappingId as MappingId;

  // Every domain gets a status row and a decision, enabled or not, before any
  // work starts — so a caller polling status never sees a domain that simply
  // is not there yet.
  for (const { name: domain, enabled } of domains) {
    await statusStore.initDomainStatus(tenantId, mappingId, domain);
    if (!enabled) {
      await statusStore.markSkipped(tenantId, mappingId, domain);
      results.push({ domain, scanned: 0, created: 0, skipped: 0, adopted: 0, failed: 0 });
    }
  }

  const lanes = planDomainLanes(
    config,
    domains.filter((d) => d.enabled).map((d) => d.name),
  );
  if (lanes.length > 1) {
    log.info(
      `[Worker] running ${lanes.length} domain lanes in parallel: ` +
        lanes.map((l) => l.join('+')).join(' | '),
    );
  }

  const runLane = async (lane: ReadonlyArray<SyncDomain>): Promise<void> => {
    for (const domain of lane) {
      await runOneDomain(domain);
    }
  };

  async function runOneDomain(domain: SyncDomain): Promise<void> {
    await statusStore.markInProgress(tenantId, mappingId, domain);

    // Collected per domain rather than read back off the end of the shared
    // array: with lanes in flight at once, `results[results.length - 1]` is no
    // longer this domain's result.
    let outcome: DomainSyncResult | undefined;

    try {
      // Each builder opens a Postgres pool; always release it after the pass
      // (finally) so a long-running scheduler never leaks a pool per domain.
      if (domain === 'email') {
        const deps = await buildDeps(config);
        try {
          const result = await runShadowPass(deps);
          outcome = { domain, scanned: result.scanned, created: result.created, skipped: result.skipped, adopted: result.adopted ?? 0, moved: result.moved ?? 0, failed: 0 };
          // Said out loud, every pass. Quietly not copying someone's Deleted
          // Items is the same class of failure as quietly copying it, and this
          // is the only place the choice becomes visible during a run.
          if (result.excludedCollections?.length) {
            log.info(
              `[Worker] ${domain}: left behind ${result.excludedCollections.join(' and ')} ` +
                '— configured via excludeSpecialUse (default: trash, junk). Set it to [] to ' +
                'migrate those folders too.',
            );
          }
        } finally {
          await deps.close();
        }
      } else if (domain === 'calendar') {
        const deps = buildDomainDeps(config, 'calendar');
        try {
          const result = await runCalendarSync(deps);
          outcome = {
            domain,
            scanned: result.scanned,
            created: result.created,
            skipped: result.skipped,
            adopted: result.adopted,
            updated: result.updated,
            changedButAdopted: result.changedButAdopted,
            failed: result.failed,
            needsDecision: result.needsDecision,
            leftBehind: result.leftBehind,
            moved: result.moved,
            conflicted: result.conflicted,
          };
        } finally {
          await deps.close();
        }
      } else if (domain === 'contact') {
        const deps = buildDomainDeps(config, 'contact');
        try {
          const result = await runContactSync(deps);
          outcome = {
            domain,
            scanned: result.scanned,
            created: result.created,
            skipped: result.skipped,
            adopted: result.adopted,
            updated: result.updated,
            changedButAdopted: result.changedButAdopted,
            failed: result.failed,
            needsDecision: result.needsDecision,
            leftBehind: result.leftBehind,
            moved: result.moved,
            conflicted: result.conflicted,
          };
        } finally {
          await deps.close();
        }
      } else {
        const deps = buildDomainDeps(config, 'file');
        try {
          const result = await runFileSync(deps);
          outcome = {
            domain,
            scanned: result.scanned,
            created: result.created,
            skipped: result.skipped,
            adopted: result.adopted,
            updated: result.updated,
            changedButAdopted: result.changedButAdopted,
            failed: result.failed,
            needsDecision: result.needsDecision,
            leftBehind: result.leftBehind,
            moved: result.moved,
            conflicted: result.conflicted,
          };
        } finally {
          await deps.close();
        }
      }

      results.push(outcome);
      await statusStore.markCompleted(tenantId, mappingId, domain, outcome.metrics);
      recordPassMetrics(tenantId, mappingId, domain, outcome);
      // `adopted` is reported alongside the rest: a pass that created nothing
      // because the destination already held the data reads very differently
      // from one that created nothing because we had already migrated it.
      log.info(
        `[Worker] ${domain} sync complete: scanned=${outcome.scanned}, created=${outcome.created}, ` +
          `updated=${outcome.updated ?? 0}, adopted=${outcome.adopted}, skipped=${outcome.skipped}`,
      );
      // Only when there is something to say. These are items the source
      // changed and we deliberately did NOT change on the target, which is a
      // decision about the customer's own data (§11.2) — never a silence.
      // The decision queue (§11.2). Loud, because these are the items that will
      // NOT be at the target when the owner cuts over unless someone acts.
      if (outcome.needsDecision) {
        log.warn(
          `[Worker] ${domain}: ${outcome.needsDecision} item(s) have failed ` +
            `${MAX_ITEM_ATTEMPTS} times and are no longer being retried. Review them at ` +
            'GET /failures, then either retry (once the cause is fixed) or accept ' +
            'leaving them behind. Until then they count as missing on the target and ' +
            'the §20 verification gate will say so.',
        );
      }
      if (outcome.leftBehind) {
        log.info(
          `[Worker] ${domain}: ${outcome.leftBehind} item(s) skipped — previously accepted ` +
            'as left behind by the owner.',
        );
      }
      if (outcome.changedButAdopted) {
        log.warn(
          `[Worker] ${domain}: ${outcome.changedButAdopted} item(s) changed on the source but ` +
            'were left as the destination already had them (adopted, never written by us). ' +
            'Non-destructive by hard rule 2; the owner decides whether to replace them.',
        );
      }
      if (outcome.conflicted) {
        log.warn(
          `[Worker] ${domain}: ${outcome.conflicted} item(s) changed on the source, but the ` +
            'copies on the target had been edited since we wrote them — someone is already ' +
            'working in the new system. Their versions were left untouched (hard rule 2) and ' +
            'those items will not be overwritten again. The source change was NOT applied.',
        );
      }
      if (outcome.moved) {
        log.warn(
          `[Worker] ${domain}: ${outcome.moved} item(s) are now in a different source ` +
            'collection than the one they were copied into — someone reorganised the source ' +
            'after the migration started. Nothing was moved, copied or deleted on the target: ' +
            'the delete half of a move is forbidden outright (hard rule 2) and §11.1 leaves ' +
            'topology to the owner. For files the old copy is still there under its old path, ' +
            'so the target now holds both. Reorganise the target by hand, or leave it and cut ' +
            'over knowing the layout differs.',
        );
      }
    } catch (err) {
      const error = err as Error;
      log.error(`[Worker] ${domain} sync failed: ${error.message}`);
      await statusStore.markFailed(tenantId, mappingId, domain, error.message);
      results.push({ domain, scanned: 0, created: 0, skipped: 0, adopted: 0, failed: 1, error: error.message });
      // Continue to the next domain — one domain's failure must not block others.
    }
  }

  // A lane that throws must not cancel the others: each lane already swallows
  // per-domain failures, so a rejection here would be a bug rather than a
  // migration outcome — but `allSettled` keeps one from hiding the rest.
  const settled = await Promise.allSettled(lanes.map(runLane));
  for (const s of settled) {
    if (s.status === 'rejected') {
      log.error(`[Worker] domain lane failed unexpectedly: ${String(s.reason)}`);
    }
  }

  // Report in the fixed domain order, not in the order lanes happened to
  // finish. Callers rendered this list as-is, and a summary whose rows move
  // around between runs is a worse report even though the numbers are right.
  const order = domains.map((d) => d.name);
  results.sort((a, b) => order.indexOf(a.domain) - order.indexOf(b.domain));

  return results;
}

/** Best-effort per-item byte size from a listing item (mail/file carry `.size`). */
function itemBytes(item: unknown): number | undefined {
  const o = item as { size?: number; item?: { size?: number } };
  return typeof o.size === 'number' ? o.size : o.item?.size;
}

/**
 * Config-driven pre-sync discovery (workplan 0013 T7, self-host path). Counts each enabled domain's
 * source (read-only, body-free) and persists via {@link DiscoveryStore}. Mirrors runAllDomains'
 * config-driven deps building; reuses the shared `discoverDomains` orchestration. Trigger.dev-free.
 */
export async function discoverAllDomains(
  config: MappingConfig,
  store: DiscoveryStore,
  tenantId: TenantId,
  mappingId: MappingId,
): Promise<DomainDiscoveryOutcome[]> {
  const hasDomainConfig = config.domains && Object.values(config.domains).some((d) => d?.enabled);
  const runMailOnly = !hasDomainConfig && config.source.type === 'imap-oauth2';

  type Opened = { source: unknown; target: unknown; close: () => Promise<void> };
  const enabled: Array<{ domain: DiscoveryDomain; open: () => Promise<Opened> }> = [];
  if (config.domains?.mail?.enabled || runMailOnly) {
    enabled.push({ domain: 'email', open: async () => { const d = await buildDeps(config); return { source: d.source, target: d.target, close: d.close }; } });
  }
  if (config.domains?.calendar?.enabled) {
    enabled.push({ domain: 'calendar', open: async () => { const d = buildDomainDeps(config, 'calendar'); return { source: d.source, target: d.target, close: d.close }; } });
  }
  if (config.domains?.contacts?.enabled) {
    enabled.push({ domain: 'contact', open: async () => { const d = buildDomainDeps(config, 'contact'); return { source: d.source, target: d.target, close: d.close }; } });
  }
  if (config.domains?.files?.enabled) {
    enabled.push({ domain: 'file', open: async () => { const d = buildDomainDeps(config, 'file'); return { source: d.source, target: d.target, close: d.close }; } });
  }

  const tasks: DomainDiscoveryTask[] = enabled.map(({ domain, open }) => ({
    domain,
    run: async () => {
      const opened = await open();
      try {
        // Only retain source keys when there is a target that can actually be
        // enumerated — the set costs one hash per source item, and paying that
        // for a target we cannot read would buy nothing.
        const reindexer = asCountableTarget(opened.target);
        const sourceKeys = reindexer ? new Set<string>() : undefined;

        const discovery = await discoverSource(
          opened.source as Parameters<typeof discoverSource>[0],
          {
            itemBytes,
            ...(sourceKeys
              ? {
                  onNaturalKey: (item: unknown) => {
                    const hash = sourceKeyHash(domain, item);
                    if (hash) sourceKeys.add(hash);
                    return hash;
                  },
                }
              : {}),
          },
        );

        if (!reindexer || !sourceKeys) return discovery;

        // Best-effort: a destination we cannot enumerate leaves these counts
        // ABSENT rather than zero. Zero would read as "the destination is
        // empty", which is a claim, and the wrong one (hard rule 9).
        try {
          const { targetExisting, targetColliding } = await discoverTarget(
            reindexer,
            sourceKeys,
            (key) => targetKeyHash(domain, key),
          );
          return { ...discovery, targetExisting, targetColliding };
        } catch (err) {
          log.warn(
            `[discovery] could not enumerate the ${domain} destination: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
          return discovery;
        }
      } finally {
        await opened.close();
      }
    },
  }));

  return discoverDomains(tasks, store, tenantId, mappingId);
}

/** A target that can enumerate itself, or undefined when it cannot. */
function asCountableTarget(target: unknown): CountableTarget | undefined {
  const candidate = target as { listEntries?: unknown };
  return typeof candidate?.listEntries === 'function' ? (target as CountableTarget) : undefined;
}

/** Hash a SOURCE listing item's natural key the way the ledger will store it. */
function sourceKeyHash(domain: DiscoveryDomain, item: unknown): string | undefined {
  switch (domain) {
    case 'email': {
      // Absent for mail with no Message-ID. Those get a key derived from their
      // own bytes at sync time, and discovery never reads bodies — so they
      // cannot be matched against the destination here, and are left out rather
      // than guessed at.
      const id = (item as { messageId?: string }).messageId;
      return id ? naturalKeyHash(id) : undefined;
    }
    case 'calendar': {
      const uid = extractIcalUid((item as { icalendar?: string }).icalendar);
      return uid ? calendarNaturalKeyHash(uid) : undefined;
    }
    case 'contact': {
      const uid = extractVcardUid((item as { vcard?: string }).vcard);
      return uid ? contactNaturalKeyHash(uid) : undefined;
    }
    case 'file': {
      const path = (item as { item?: { path?: string } }).item?.path;
      return path ? fileNaturalKeyHash(path) : undefined;
    }
  }
}

/** Hash a TARGET entry's raw natural key into the same space. */
function targetKeyHash(domain: DiscoveryDomain, rawKey: string): string {
  switch (domain) {
    case 'email':
      return naturalKeyHash(rawKey);
    case 'calendar':
      return calendarNaturalKeyHash(rawKey);
    case 'contact':
      return contactNaturalKeyHash(rawKey);
    case 'file':
      return fileNaturalKeyHash(rawKey);
  }
}

/** First `UID:` value in an iCalendar object, unfolded. */
function extractIcalUid(icalendar?: string): string | undefined {
  return firstUid(icalendar);
}

/** First `UID:` value in a vCard, unfolded. */
function extractVcardUid(vcard?: string): string | undefined {
  return firstUid(vcard);
}

function firstUid(text?: string): string | undefined {
  if (!text) return undefined;
  // Unfold first (RFC 5545 §3.1 / RFC 6350 §3.2): a long UID may be split
  // across lines, and reading only the first physical line would truncate it
  // into a key that matches nothing.
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const match = /^UID:(.*)$/im.exec(unfolded);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/**
 * Run the §20 verification gate for one mapping, against its real targets.
 *
 * Shared by the self-host appliance's `GET /verify` (workplan 0010 T2 —
 * "extract/share it, don't fork it"), which is the only way a self-host
 * operator can run the gate at all: the managed edition reaches it through the
 * cutover job, and neither edition's UI does.
 *
 * Reindexers are per-domain, each reading its OWN target. Handing one target to
 * every domain is how calendar/contact/file rows once came to be compared
 * against a listing of mailboxes, making every item look missing. A domain
 * whose target cannot enumerate itself is left out of the map, and
 * `runVerification` reports it honestly rather than inventing numbers.
 */
export async function verifyMapping(config: MappingConfig): Promise<VerificationResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required to run verification');
  }

  const tenantId = config.tenantId as TenantId;
  const mappingId = config.mappingId as MappingId;

  const reindexers: Partial<Record<'mail' | 'calendar' | 'contacts' | 'files', TargetReindexer>> = {};
  const closers: Array<() => Promise<void>> = [];

  const collect = async (
    key: 'mail' | 'calendar' | 'contacts' | 'files',
    open: () => Promise<{ target: unknown; close: () => Promise<void> }>,
  ): Promise<void> => {
    let opened: { target: unknown; close: () => Promise<void> };
    try {
      opened = await open();
    } catch (err) {
      log.warn(
        `[verify] no ${key} target for ${config.mappingId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    const candidate = opened.target as { listEntries?: unknown };
    if (typeof candidate?.listEntries !== 'function') {
      await opened.close();
      return;
    }
    reindexers[key] = candidate as TargetReindexer;
    closers.push(() => opened.close());
  };

  if (config.domains?.mail?.enabled ?? config.source.type === 'imap-oauth2') {
    await collect('mail', async () => {
      const d = await buildDeps(config);
      return { target: d.target, close: d.close };
    });
  }
  if (config.domains?.calendar?.enabled) {
    await collect('calendar', async () => {
      const d = buildDomainDeps(config, 'calendar');
      return { target: d.target, close: d.close };
    });
  }
  if (config.domains?.contacts?.enabled) {
    await collect('contacts', async () => {
      const d = buildDomainDeps(config, 'contact');
      return { target: d.target, close: d.close };
    });
  }
  if (config.domains?.files?.enabled) {
    await collect('files', async () => {
      const d = buildDomainDeps(config, 'file');
      return { target: d.target, close: d.close };
    });
  }

  // Owns its own pool (see createLedgerVerificationReader) — closed below.
  const verificationReader = createLedgerVerificationReader({ connectionString: databaseUrl });

  try {
    return await runVerification(
      createRealVerificationDeps({
        tenantId,
        mappingId,
        config: {
          checksumSamplePercentage: 5,
          minSampleSize: 10,
          maxSampleSize: 1000,
          requiredMatchPercentage: 0.99,
          maxDiscrepancyPercentage: 0.01,
          // Only what this mapping actually syncs. A domain switched off here
          // reports SKIPPED; one that is on but unreadable reports
          // NOT_VERIFIABLE and blocks — neither is silently passed.
          verifyMail: config.domains?.mail?.enabled ?? config.source.type === 'imap-oauth2',
          verifyCalendar: config.domains?.calendar?.enabled ?? false,
          verifyContacts: config.domains?.contacts?.enabled ?? false,
          verifyFiles: config.domains?.files?.enabled ?? false,
        },
        verificationReader,
        targetReindexers: reindexers,
      }),
    );
  } finally {
    // Release everything, and never throw from here: a failed pool release must
    // not replace the verification result (or the real error) the caller came
    // for. Reported, not swallowed.
    const settled = await Promise.allSettled([
      verificationReader.close(),
      ...closers.map((c) => c()),
    ]);
    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        log.warn('[verify] failed to release a connection:', outcome.reason);
      }
    }
  }
}
