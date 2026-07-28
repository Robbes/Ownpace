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

export interface DomainSyncResult {
  domain: 'email' | 'calendar' | 'contact' | 'file';
  scanned: number;
  created: number;
  skipped: number;
  /** Already on the target under our natural key; not written. */
  adopted: number;
  failed: number;
  error?: string;
}

/** Run all enabled domains for one mapping config, with status tracking. */
export async function runAllDomains(
  config: MappingConfig,
  statusStore: MigrationStatusStore,
): Promise<DomainSyncResult[]> {
  const results: DomainSyncResult[] = [];
  const domains: Array<{ name: 'email' | 'calendar' | 'contact' | 'file'; enabled: boolean }> = [
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

  for (const { name: domain, enabled } of domains) {
    const tenantId = config.tenantId as TenantId;
    const mappingId = config.mappingId as MappingId;

    await statusStore.initDomainStatus(tenantId, mappingId, domain);

    if (!enabled) {
      await statusStore.markSkipped(tenantId, mappingId, domain);
      results.push({ domain, scanned: 0, created: 0, skipped: 0, adopted: 0, failed: 0 });
      continue;
    }

    await statusStore.markInProgress(tenantId, mappingId, domain);

    try {
      // Each builder opens a Postgres pool; always release it after the pass
      // (finally) so a long-running scheduler never leaks a pool per domain.
      if (domain === 'email') {
        const deps = await buildDeps(config);
        try {
          const result = await runShadowPass(deps);
          results.push({ domain, scanned: result.scanned, created: result.created, skipped: result.skipped, adopted: result.adopted ?? 0, failed: 0 });
        } finally {
          await deps.close();
        }
      } else if (domain === 'calendar') {
        const deps = buildDomainDeps(config, 'calendar');
        try {
          const result = await runCalendarSync(deps);
          results.push({ domain, scanned: result.scanned, created: result.created, skipped: result.skipped, adopted: result.adopted, failed: result.failed });
        } finally {
          await deps.close();
        }
      } else if (domain === 'contact') {
        const deps = buildDomainDeps(config, 'contact');
        try {
          const result = await runContactSync(deps);
          results.push({ domain, scanned: result.scanned, created: result.created, skipped: result.skipped, adopted: result.adopted, failed: result.failed });
        } finally {
          await deps.close();
        }
      } else {
        const deps = buildDomainDeps(config, 'file');
        try {
          const result = await runFileSync(deps);
          results.push({ domain, scanned: result.scanned, created: result.created, skipped: result.skipped, adopted: result.adopted, failed: result.failed });
        } finally {
          await deps.close();
        }
      }

      await statusStore.markCompleted(tenantId, mappingId, domain);
      const last = results[results.length - 1]!;
      // `adopted` is reported alongside the rest: a pass that created nothing
      // because the destination already held the data reads very differently
      // from one that created nothing because we had already migrated it.
      console.log(
        `[Worker] ${domain} sync complete: scanned=${last.scanned}, created=${last.created}, ` +
          `adopted=${last.adopted}, skipped=${last.skipped}`,
      );
    } catch (err) {
      const error = err as Error;
      console.error(`[Worker] ${domain} sync failed: ${error.message}`);
      await statusStore.markFailed(tenantId, mappingId, domain, error.message);
      results.push({ domain, scanned: 0, created: 0, skipped: 0, adopted: 0, failed: 1, error: error.message });
      // Continue to the next domain — one domain's failure must not block others.
    }
  }

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
          console.warn(
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
      console.warn(
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
        console.warn('[verify] failed to release a connection:', outcome.reason);
      }
    }
  }
}
