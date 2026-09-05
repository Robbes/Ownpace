// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Load a directory of mapping configs (workplan 0010 T2). The self-host appliance
 * reads every `*.json` under its config dir (default `/data/config`) and validates
 * each with the shared `parseMappingConfigJson` — the same schema the managed
 * edition uses, so there is one config contract.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMappingConfigJson, type MappingConfig } from '@openmig/shared';

/**
 * Deterministic UUID from a seed string.
 *
 * The appliance has no id-issuing service: a mapping's ledger row must land on
 * the same id every restart, or a restarted appliance would orphan its own
 * history. Exported because `index.ts` derives connection and mailbox ids the
 * same way and a test has to be able to compute the value the appliance will
 * choose — it lived in both files with a comment asking them to match, which
 * is the arrangement that eventually stops matching.
 *
 * A HASH of the whole seed. Until 2026-09-05 this was the seed's first sixteen
 * bytes dressed as a UUID, and every seed begins with the 36-character tenant
 * id — so every id the appliance derived for a tenant was the same value: the
 * source connection, the target connection, both mailboxes and the mapping,
 * and a SECOND mapping in the tenant was the first one, sharing its row, its
 * status, its ledger and its finish. Nobody saw it because every appliance
 * had exactly one mapping. The archive-import gate (workplan 0116 T10) added
 * a second and read the first's item count back. `legacyUuidFromString` keeps
 * the old value so an appliance that already has a row under it is not
 * orphaned by the upgrade — see `claimLegacyMappingRows`.
 */
export function uuidFromString(seed: string): string {
  const hash = createHash('sha256').update(seed).digest('hex');
  // Version and variant nibbles as a v4 UUID carries them, so the value is a
  // well-formed UUID to anything that checks; the entropy is the hash's.
  const variant = (8 | (parseInt(hash[16]!, 16) & 3)).toString(16);
  return (
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-` +
    `${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`
  );
}

/**
 * The derivation before 2026-09-05: the seed's first sixteen bytes as hex.
 *
 * Kept ONLY so `claimLegacyMappingRows` can find the row an existing appliance
 * already keeps its history under. Never used to mint a new id. Pinned by a
 * test, because a compat path that drifts orphans exactly the history it is
 * there to keep.
 */
export function legacyUuidFromString(seed: string): string {
  const hash = Buffer.from(seed).toString('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export interface LoadedMapping {
  readonly path: string;
  readonly config: MappingConfig;
  /**
   * The database mailbox_mapping id: derived from tenantId + mappingId, or —
   * on an appliance upgraded from before 2026-09-05 — the legacy row it
   * claimed at boot (`claimLegacyMappingRows`). Stable across restarts either
   * way, which is the property everything keyed by it depends on.
   */
  readonly mailboxMappingId: string;
}

/**
 * Load and validate all mapping JSONs in `dir` (sorted by filename). Throws with
 * the offending path if any file is invalid — fail fast, never skip silently.
 */
export function loadConfigDir(dir: string): LoadedMapping[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const loaded: LoadedMapping[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    const path = join(dir, file);
    let config: MappingConfig;
    try {
      config = parseMappingConfigJson(readFileSync(path, 'utf-8'));
    } catch (err) {
      throw new Error(
        `Invalid mapping config ${path}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    const priorPath = seen.get(config.mappingId);
    if (priorPath) {
      throw new Error(
        `Duplicate mappingId '${config.mappingId}' in ${path} (already defined in ${priorPath})`,
      );
    }
    seen.set(config.mappingId, path);
    // The mailbox_mapping id this mapping will be keyed by — unless a legacy
    // row claims it at boot (`claimLegacyMappingRows`, which needs a database
    // this loader deliberately has not got).
    const mailboxMappingId = uuidFromString(mappingSeed(config.tenantId, config.mappingId));
    loaded.push({ path, config, mailboxMappingId });
  }
  return loaded;
}

/** The one seed the mapping id is derived from, in both derivations. */
export function mappingSeed(tenantId: string, mappingId: string): string {
  return `${tenantId}:mapping:${mappingId}`;
}

/** The slice of a tenant-scoped database client the claim needs. */
export interface TenantQuery {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Give an upgraded appliance back the row it already had.
 *
 * Before 2026-09-05 every mapping of a tenant was keyed by the SAME id (see
 * `uuidFromString`). An appliance mid-migration under that id must not boot
 * into a fresh, paused row with an empty ledger — the quickstart promises an
 * in-place upgrade, and re-copying everything is the duplicate the ledger
 * exists to prevent. So, per mapping, in this order:
 *
 *   1. a row under the NEW id exists → that is the mapping's row;
 *   2. else a row under the LEGACY id exists and is unclaimed (`name` null)
 *      or claimed by this very config mapping → claim it, by writing the
 *      config mappingId into `name`, and key the mapping by the legacy id
 *      from now on;
 *   3. else → the new id; `ensureMappingRecords` inserts the row.
 *
 * The claim is recorded in the database rather than inferred from config
 * order, so a mapping file added later that happens to sort first cannot walk
 * off with another mapping's history. A legacy tenant that already had
 * several mappings had them collapsed into one row all along; the first in
 * sorted order keeps that row and the others start their own, which is the
 * only attribution the old data allows — said in the log rather than guessed
 * silently.
 */
export async function claimLegacyMappingRows(
  mappings: ReadonlyArray<LoadedMapping>,
  inTenant: <T>(tenantId: string, fn: (client: TenantQuery) => Promise<T>) => Promise<T>,
  log: { info(message: string): void } = console,
): Promise<LoadedMapping[]> {
  const resolved: LoadedMapping[] = [];
  const claimedThisBoot = new Set<string>();
  for (const m of mappings) {
    const seed = mappingSeed(m.config.tenantId, m.config.mappingId);
    const legacyId = legacyUuidFromString(seed);
    const owned = await inTenant(m.config.tenantId, async (client) => {
      const fresh = await client.query(`SELECT 1 FROM mailbox_mapping WHERE id = $1`, [m.mailboxMappingId]);
      if (fresh.rows.length > 0) return 'fresh' as const;
      if (claimedThisBoot.has(legacyId)) return 'none' as const;
      const legacy = await client.query(`SELECT name FROM mailbox_mapping WHERE id = $1`, [legacyId]);
      const row = legacy.rows[0] as { name: string | null } | undefined;
      if (!row) return 'none' as const;
      if (row.name === m.config.mappingId) return 'legacy' as const;
      if (row.name !== null) return 'none' as const;
      // The claim itself — once, on the boot that upgrades. Read back as its
      // name from then on, so a routine boot writes nothing to the row.
      await client.query(`UPDATE mailbox_mapping SET name = $2 WHERE id = $1`, [legacyId, m.config.mappingId]);
      return 'legacy' as const;
    });
    if (owned === 'legacy') {
      claimedThisBoot.add(legacyId);
      log.info(
        `[selfhost] ${m.config.mappingId}: keeps the row it had before the id derivation ` +
          `changed (${legacyId}); its history stays where it is.`,
      );
      resolved.push({ ...m, mailboxMappingId: legacyId });
    } else {
      resolved.push(m);
    }
  }
  return resolved;
}
