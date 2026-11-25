// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * `GET …/destination-space`: free space at each destination of a migration,
 * read live on *Review and start* (workplan 0171 §6.3, T9). One core for both
 * editions; each hands it the openers of its own writers.
 *
 * Each destination writer of the migration is opened, asked `capacity()` with
 * a ten-second limit, and closed. Nothing is written and nothing is stored
 * (§8). The answers are grouped per pool (`spaceByPool`), with each pool's
 * need the sum of the discovery bytes of the data types that land in it.
 *
 * What is NOT read, by the plan's table: calendars, contacts and tasks, which
 * are small beside mail and files. They answer `not_offered` without a
 * connection.
 *
 * A writer that cannot be built, a read that throws and a read that outlasts
 * its limit all answer `not_answered`, and the reason is logged: the screen
 * says it does not know, never that there is room (hard rule 9).
 */
import {
  log,
  spaceByPool,
  type DataTypeSpace,
  type DestinationCapacity,
  type DiscoveryDomain,
  type PoolSpace,
  type MappingConfig,
} from '@openmig/shared';
import { buildDeps, buildDomainDeps, resolveMailConfig, type LedgerOptions } from './build-deps.ts';
import { isTopLevelMailSource } from './orchestration.ts';

/** How long one destination may take to say its room (§6.3). */
export const DESTINATION_SPACE_TIMEOUT_MS = 10_000;

/** The data types whose destinations are not asked (§6.2's last row). */
const NOT_READ: ReadonlySet<DiscoveryDomain> = new Set(['calendar', 'contact', 'task']);

/** One data type's destination writer, to be opened only for this question. */
export interface DestinationOpener {
  readonly dataType: DiscoveryDomain;
  /** The destination's name on the screen (`destinationLabelOf`). */
  readonly destination: string;
  /** Build the writer; `close` releases whatever building it took. */
  readonly open: () => Promise<{ readonly target: unknown; readonly close: () => Promise<void> }>;
}

interface CapacityReader {
  capacity?: () => Promise<DestinationCapacity>;
  disconnect?: () => Promise<void>;
}

const notAnswered: DestinationCapacity = { known: false, why: 'not_answered' };

/** `capacity()` within the limit; the writer's own connection is closed once it settles, whenever that is. */
async function askWithin(target: CapacityReader, timeoutMs: number): Promise<DestinationCapacity> {
  if (typeof target.capacity !== 'function') return { known: false, why: 'not_offered' };
  const asked = target.capacity();
  // A writer that holds a connection (IMAP) lets it go after its answer, even
  // one that came too late to be used.
  void asked.finally(() => target.disconnect?.()).catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs / 1000} seconds`)), timeoutMs);
  });
  try {
    return await Promise.race([asked, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** One opener, asked: always an answer, never a throw. */
async function readOne(opener: DestinationOpener, timeoutMs: number, where: string): Promise<DestinationCapacity> {
  if (NOT_READ.has(opener.dataType)) return { known: false, why: 'not_offered' };
  let opened: Awaited<ReturnType<DestinationOpener['open']>> | undefined;
  try {
    opened = await opener.open();
    return await askWithin(opened.target as CapacityReader, timeoutMs);
  } catch (err) {
    log.warn(
      `[destination-space] ${where}: ${opener.dataType} at ${opener.destination} did not say its free space: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return notAnswered;
  } finally {
    await opened?.close().catch(() => undefined);
  }
}

/**
 * Every destination of the migration asked at once, grouped per pool.
 * `needOf` is each data type's discovery bytes (0 when not counted yet).
 */
export async function readDestinationSpace(
  openers: ReadonlyArray<DestinationOpener>,
  needOf: (dataType: DiscoveryDomain) => number,
  options: { readonly timeoutMs?: number; readonly where?: string } = {},
): Promise<PoolSpace<DiscoveryDomain>[]> {
  const timeoutMs = options.timeoutMs ?? DESTINATION_SPACE_TIMEOUT_MS;
  const where = options.where ?? 'migration';
  const rows: DataTypeSpace<DiscoveryDomain>[] = await Promise.all(
    openers.map(async (o) => ({
      dataType: o.dataType,
      destination: o.destination,
      needBytes: needOf(o.dataType),
      capacity: await readOne(o, timeoutMs, where),
    })),
  );
  return spaceByPool(rows);
}

/** Each data type's measured bytes, from its discovery row; one with an error, or none, needs 0. */
export function needFromDiscovery(
  rows: ReadonlyArray<{ readonly domain: DiscoveryDomain; readonly bytes?: number | null; readonly lastError?: string | null }>,
): (dataType: DiscoveryDomain) => number {
  const by = new Map<DiscoveryDomain, number>();
  for (const r of rows) {
    if (r.lastError) continue;
    if (typeof r.bytes === 'number' && r.bytes > 0) by.set(r.domain, r.bytes);
  }
  return (d) => by.get(d) ?? 0;
}

const ADDRESS_KEYS = ['baseUrl', 'url', 'jmapUrl', 'webdavUrl', 'davUrl', 'serverUrl', 'host', 'imapHost'] as const;

/**
 * The name a destination goes by on the screen: its host, read from the
 * target's config, or the kind when no address is stored there (Cirrux's
 * Drive, whose address is the deployment's). No account name, no path.
 */
export function destinationLabelOf(kind: string, config: unknown): string {
  if (kind === 'cirrux') return 'Cirrux';
  const seen = new Set<unknown>();
  const walk = (v: unknown): string | undefined => {
    if (!v || typeof v !== 'object' || seen.has(v)) return undefined;
    seen.add(v);
    const o = v as Record<string, unknown>;
    for (const k of ADDRESS_KEYS) {
      const s = o[k];
      if (typeof s !== 'string' || s === '') continue;
      try {
        return new URL(s).hostname;
      } catch {
        if (/^[a-z0-9.-]+$/i.test(s)) return s.toLowerCase();
      }
    }
    for (const nested of Object.values(o)) {
      const found = walk(nested);
      if (found) return found;
    }
    return undefined;
  };
  return walk(config) ?? kind;
}

/**
 * The appliance's openers, from a mapping's configuration: each enabled data
 * type's writer, built as its pass builds it (`buildDeps`, `buildDomainDeps`),
 * the same list `discoverAllDomains` counts.
 */
export function destinationOpenersFromConfig(config: MappingConfig, ledger: LedgerOptions): DestinationOpener[] {
  const hasDomainConfig = config.domains && Object.values(config.domains).some((d) => d?.enabled);
  const out: DestinationOpener[] = [];
  const label = (target: unknown) => destinationLabelOf(String((target as { type?: unknown })?.type ?? 'unknown'), target);
  if (config.domains?.mail?.enabled || (!hasDomainConfig && isTopLevelMailSource(config.source.type))) {
    out.push({
      dataType: 'email',
      destination: label(resolveMailConfig(config).target),
      open: async () => {
        const d = await buildDeps(config, ledger);
        return { target: d.target, close: d.close };
      },
    });
  }
  const dav = [
    ['calendar', 'calendar', config.domains?.calendar],
    ['contact', 'contact', config.domains?.contacts],
    ['file', 'file', config.domains?.files],
    ['task', 'task', config.domains?.tasks],
  ] as const;
  for (const [dataType, domain, settings] of dav) {
    if (!settings?.enabled) continue;
    out.push({
      dataType,
      destination: label(settings.target),
      open: async () => {
        const d = buildDomainDeps(config, domain as 'file', ledger);
        return { target: d.target, close: d.close };
      },
    });
  }
  return out;
}
