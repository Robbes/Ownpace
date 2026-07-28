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
  runVerification,
  createRealVerificationDeps,
  type VerificationResult,
} from '@openmig/core';
import { createLedgerVerificationReader } from '@openmig/ledger';
import type { TargetReindexer } from '@openmig/shared';
import { buildDeps, buildDomainDeps } from './build-deps';
import { discoverDomains, type DomainDiscoveryTask, type DomainDiscoveryOutcome } from './discovery';

export interface DomainSyncResult {
  domain: 'email' | 'calendar' | 'contact' | 'file';
  scanned: number;
  created: number;
  skipped: number;
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
      results.push({ domain, scanned: 0, created: 0, skipped: 0, failed: 0 });
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
          results.push({ domain, scanned: result.scanned, created: result.created, skipped: result.skipped, failed: 0 });
        } finally {
          await deps.close();
        }
      } else if (domain === 'calendar') {
        const deps = buildDomainDeps(config, 'calendar');
        try {
          const result = await runCalendarSync(deps);
          results.push({ domain, scanned: result.scanned, created: result.created, skipped: result.skipped, failed: result.failed });
        } finally {
          await deps.close();
        }
      } else if (domain === 'contact') {
        const deps = buildDomainDeps(config, 'contact');
        try {
          const result = await runContactSync(deps);
          results.push({ domain, scanned: result.scanned, created: result.created, skipped: result.skipped, failed: result.failed });
        } finally {
          await deps.close();
        }
      } else {
        const deps = buildDomainDeps(config, 'file');
        try {
          const result = await runFileSync(deps);
          results.push({ domain, scanned: result.scanned, created: result.created, skipped: result.skipped, failed: result.failed });
        } finally {
          await deps.close();
        }
      }

      await statusStore.markCompleted(tenantId, mappingId, domain);
      const last = results[results.length - 1]!;
      console.log(`[Worker] ${domain} sync complete: scanned=${last.scanned}, created=${last.created}, skipped=${last.skipped}`);
    } catch (err) {
      const error = err as Error;
      console.error(`[Worker] ${domain} sync failed: ${error.message}`);
      await statusStore.markFailed(tenantId, mappingId, domain, error.message);
      results.push({ domain, scanned: 0, created: 0, skipped: 0, failed: 1, error: error.message });
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

  const enabled: Array<{ domain: DiscoveryDomain; open: () => Promise<{ source: unknown; close: () => Promise<void> }> }> = [];
  if (config.domains?.mail?.enabled || runMailOnly) {
    enabled.push({ domain: 'email', open: async () => { const d = await buildDeps(config); return { source: d.source, close: d.close }; } });
  }
  if (config.domains?.calendar?.enabled) {
    enabled.push({ domain: 'calendar', open: async () => { const d = buildDomainDeps(config, 'calendar'); return { source: d.source, close: d.close }; } });
  }
  if (config.domains?.contacts?.enabled) {
    enabled.push({ domain: 'contact', open: async () => { const d = buildDomainDeps(config, 'contact'); return { source: d.source, close: d.close }; } });
  }
  if (config.domains?.files?.enabled) {
    enabled.push({ domain: 'file', open: async () => { const d = buildDomainDeps(config, 'file'); return { source: d.source, close: d.close }; } });
  }

  const tasks: DomainDiscoveryTask[] = enabled.map(({ domain, open }) => ({
    domain,
    run: async () => {
      const opened = await open();
      try {
        return await discoverSource(opened.source as Parameters<typeof discoverSource>[0], { itemBytes });
      } finally {
        await opened.close();
      }
    },
  }));

  return discoverDomains(tasks, store, tenantId, mappingId);
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
