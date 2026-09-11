// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The readers a confirmation pass runs over (workplan 0117 T2, slice 7).
 *
 * `runConfirmationPass` asks for a `ConfirmationReader` per domain and does no
 * provider I/O itself. This is where those come from: the mapping's own target,
 * per domain, wrapped by `readerOverTarget` and handed the tenant's budget.
 *
 * ## It borrows the verification gate's builder, deliberately
 *
 * `buildTargetReindexers` already assembles exactly what is needed — one
 * `TargetReindexer` per domain whose target can enumerate itself, each with its
 * own pool and a `close()` that releases them all. Building a second assembler
 * beside it is how this repository ends up with two copies of a fan-out and one
 * of them silently stops being the product (`job-resolution.ts` records the
 * cost of that shape). So this adapts rather than duplicates.
 *
 * ## The vocabularies, and the bug that lives between them
 *
 * The gate speaks `mail | calendar | contacts | files | tasks`; everything from
 * the ledger down speaks `email | calendar | contact | file | task`. That gap is
 * not cosmetic — `build-reindexers.ts` carries the story in full: the task
 * domain got a source, a writer, a ledger row, a tick, a place in the report
 * and named assertions in both gates, and never a target reindexer, so
 * verification reported `tasks 0/4` about a target the tasks were sitting on.
 * Nothing failed; a lookup returned `undefined` and every layer above read it
 * as an honest no.
 *
 * The translation is therefore a TOTAL `Record` over `DiscoveryDomain`, so a
 * sixth domain is a compile error here rather than a domain that quietly
 * confirms nothing and reports it as an account with nothing in it.
 *
 * ## THERE IS A SECOND FAN-OUT, AND THIS FILE ONLY KNOWS ONE (2026-09-11)
 *
 * Read this before adding the appliance's half. `buildTargetReindexers` is the
 * MANAGED assembler, over deps built from connection ROWS
 * (`build-deps-from-mapping.ts`, `Pool`). The appliance never calls it: it
 * assembles the same five reindexers inside `verifyMapping`
 * (`orchestration.ts`), over deps built from its `MappingConfig`
 * (`build-deps.ts`, injected `ledgerDb` — PGlite-safe today). Two copies of one
 * fan-out already, which is precisely what the paragraph above says this repo
 * must not end up with, and precisely what cost it `tasks 0/4`.
 *
 * So this builder cannot simply be pointed at the appliance, and cloning it
 * there would make THREE copies. 0117's Status block (2026-09-11) states the
 * fork that has to be settled first: assemble beside `verifyMapping`'s, or
 * extract one fan-out both editions feed. Until then no screen offers Confirm
 * or the list on either edition.
 */

import type { Pool } from 'pg';
import { readerOverTarget, type ConfirmationReader, type TargetBudget } from '@openmig/core';
import {
  DISCOVERY_DOMAINS,
  log,
  type DiscoveryDomain,
  type DownloadMeter,
} from '@openmig/shared';

import { buildTargetReindexers, type VerificationDomain } from './build-reindexers.ts';

/**
 * One name per domain, in the verification gate's spelling.
 *
 * TOTAL over `DiscoveryDomain`: adding a sixth domain fails to compile here.
 * The alternative — a lookup that answers `undefined` — is precisely how the
 * task domain went unconfirmed for a month while every surface said no.
 */
export const GATE_NAME: Readonly<Record<DiscoveryDomain, VerificationDomain>> = {
  email: 'mail',
  calendar: 'calendar',
  contact: 'contacts',
  file: 'files',
  task: 'tasks',
};

export interface ConfirmationReaders {
  /** A reader per domain whose target could be built AND could enumerate itself. */
  readonly readerFor: (domain: DiscoveryDomain) => ConfirmationReader | undefined;
  /** The domains that actually got one — what the pass should be asked to run. */
  readonly domains: readonly DiscoveryDomain[];
  /**
   * The byte meter the pass GATES on, when the target has a known ceiling.
   *
   * The same `ByteBudget` instance the readers spend, re-carried with its key
   * because that is the shape `runConfirmationPass` gates with (0090's
   * `DownloadMeter`: the budget and the `(tenant, provider)` it is keyed by,
   * together, *"so no consumer invents its own"*).
   *
   * Usually absent, and honestly so: a ceiling is a number somebody PUBLISHED,
   * and the only one this product knows is Gmail's IMAP download limit — which
   * belongs to a source, since people migrate away from Gmail rather than into
   * it. No meter means the pass runs to the end, which is right for a server
   * with no ceiling and would be dangerous for one that has it.
   */
  readonly meter?: DownloadMeter;
  /** Release every connection the reindexers opened. */
  close(): Promise<void>;
}

/**
 * Build the readers for one mapping's confirmation pass.
 *
 * `wanted` narrows to the domains the caller asked about; omitting it means
 * every domain that can be read. A domain with no enumerable target is left
 * OUT rather than given a reader that answers nothing — its rows then keep
 * their NULL answer and read `unchecked`, which is the honest outcome and the
 * one `runConfirmationPass` already documents for a missing reader.
 *
 * ENUMERATES EAGERLY: `readerOverTarget` walks the whole account when it is
 * built, so this is the expensive call and the caller has already decided to
 * pay for it by starting a pass.
 */
export async function buildConfirmationReaders(args: {
  pool: Pool;
  tenantId: string;
  mappingId: string;
  wanted?: readonly DiscoveryDomain[];
  /** The tenant's budget for the target's provider, when one is known (D9). */
  budget?: TargetBudget;
}): Promise<ConfirmationReaders> {
  const built = await buildTargetReindexers(args.pool, args.tenantId, args.mappingId);
  const asked = args.wanted ?? DISCOVERY_DOMAINS;

  const readers = new Map<DiscoveryDomain, ConfirmationReader>();
  try {
    for (const domain of asked) {
      const reindexer = built.reindexers[GATE_NAME[domain]];
      if (!reindexer) {
        log.info(
          `[confirm] mapping ${args.mappingId}: no enumerable ${domain} target — ` +
            `its rows stay unchecked rather than being reported as missing`,
        );
        continue;
      }
      readers.set(
        domain,
        await readerOverTarget({
          domain,
          reindexer,
          ...(args.budget ? { budget: args.budget } : {}),
        }),
      );
    }
  } catch (err) {
    // Release what was opened before rethrowing: a pass that never starts must
    // not leave a pool per domain held open behind it.
    await built.close().catch(() => {});
    throw err;
  }

  const budget = args.budget;
  return {
    readerFor: (domain) => readers.get(domain),
    domains: [...readers.keys()],
    ...(budget?.meter
      ? { meter: { budget: budget.meter, tenantId: budget.tenantId, provider: budget.provider } }
      : {}),
    close: () => built.close(),
  };
}

/**
 * THE TARGET'S OWN IDENTITY, for keying the tenant's budget by (D9).
 *
 * D9 is about a limit that *"belongs to the PROVIDER, not to us"*, so the key
 * has to name the provider. A per-mapping label would hand the confirmation a
 * private bucket — exactly the second allowance D9 refuses — and it would look
 * correct while being false.
 *
 * Two mappings pointing at the same server share one key, which is the point.
 * Resolved through the mapping's own target mailbox, the way
 * `buildDepsFromMapping` resolves its connections and for the same reason: the
 * tenant's first target ROW was survivable while a tenant could hold one, and
 * stopped being so the moment the wizard could create a second.
 *
 * **The fallback narrows, it never widens.** Where no host can be read the key
 * falls back to the target CONNECTION's id: still shared across every pass
 * against that account — the ordinary case, one customer with one target — and
 * never a bucket shared with an unrelated server. Falling back to *nothing*
 * would switch the budget off, which is the failure this whole shape was
 * corrected to avoid.
 */
export async function targetProviderKey(
  pool: Pool,
  tenantId: string,
  mappingId: string,
): Promise<string | undefined> {
  const { rows } = await pool.query<{ id: string; config: Record<string, unknown> }>(
    `SELECT c.id, c.config
       FROM mailbox_mapping m
       JOIN mailbox mb ON mb.id = m.target_mailbox_id
       JOIN connection c ON c.id = mb.connection_id
      WHERE m.tenant_id = $1 AND m.id = $2`,
    [tenantId, mappingId],
  );
  const row = rows[0];
  if (!row) return undefined;
  const host = hostFromStoredConfig(row.config);
  return host ? `target:${host}` : `target-connection:${row.id}`;
}

/**
 * The endpoint host as the Connections door stored it.
 *
 * Not a `TargetConfig` — this is the raw jsonb, and the shapes differ by kind
 * because the door stores what each kind's fields are called:
 * `mailTargetConfigFromConnection` reads `host`/`port`/`useSsl` for the IMAP
 * and JMAP kinds, while the DAV kinds carry a `url`. Both are read, and
 * anything else answers undefined rather than a guess.
 *
 * Exported for its guard: which fields are read, and that an unparseable one
 * answers undefined instead of a string that would key a budget to nonsense,
 * are judgements rather than plumbing.
 */
export function hostFromStoredConfig(config: Record<string, unknown>): string | undefined {
  const host = config.host;
  if (typeof host === 'string' && host.trim() !== '') return host.trim().toLowerCase();
  for (const field of ['url', 'baseUrl'] as const) {
    const value = config[field];
    if (typeof value === 'string') {
      const parsed = hostOf(value);
      if (parsed) return parsed.toLowerCase();
    }
  }
  return undefined;
}

/** The host of a URL, or undefined if it will not parse — never a guess. */
function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
