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
 * ## BOTH EDITIONS FEED ONE FAN-OUT (2026-09-11, owner option (b))
 *
 * There used to be two loops over these five domains — `buildTargetReindexers`
 * over connection ROWS, and `verifyMapping`'s own inline one over the
 * appliance's `MappingConfig` — and this builder was written over the managed
 * one only. A third copy for the confirmation pass was the obvious next step
 * and the wrong one: two copies already cost this repository `tasks 0/4`.
 *
 * So this takes an `OpenTarget` rather than a `Pool`. The managed worker hands
 * over `managedOpener`, the appliance `applianceOpener`, and the builder below
 * does not know or care which it got.
 */

import type { Pool } from 'pg';
import { readerOverTarget, type ConfirmationReader, type TargetBudget } from '@openmig/core';
import {
  DISCOVERY_DOMAINS,
  type DiscoveryDomain,
  type DownloadMeter,
  type TargetReindexer,
} from '@openmig/shared';

import { asReindexer, fanOutTargets, type OpenTarget } from './target-fan-out.ts';

export { GATE_NAME } from './target-fan-out.ts';

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
  /** Release every connection the targets opened. */
  close(): Promise<void>;
}

/**
 * Build the readers for one mapping's confirmation pass, on EITHER edition.
 *
 * `open` is the only edition-specific thing, and that is the point of taking
 * it: the managed worker hands over `managedOpener` (connection rows, a pg
 * `Pool`), the appliance hands over its config-built one, and everything below
 * is the same code answering both.
 *
 * `wanted` narrows to the domains the caller asked about; omitting it means
 * every domain that can be read. A domain with no enumerable target is left OUT
 * rather than given a reader that answers nothing — its rows then keep their
 * NULL answer and read `unchecked`, which is the honest outcome and the one
 * `runConfirmationPass` already documents for a missing reader.
 *
 * ENUMERATES EAGERLY: `readerOverTarget` walks the whole account when it is
 * built, so this is the expensive call and the caller has already decided to
 * pay for it by starting a pass. Only the WANTED domains are opened — the first
 * version built all five and discarded the rest, which is a walk per domain
 * nobody asked about.
 */
export async function buildConfirmationReaders(args: {
  open: OpenTarget;
  wanted?: readonly DiscoveryDomain[];
  /** The tenant's budget for the target's provider, when one is known (D9). */
  budget?: TargetBudget;
}): Promise<ConfirmationReaders> {
  const budget = args.budget;
  const fanned = await fanOutTargets<ConfirmationReader>({
    wanted: args.wanted ?? DISCOVERY_DOMAINS,
    open: args.open,
    keep: async (target, domain) => {
      const reindexer = asReindexer<TargetReindexer>(target);
      if (!reindexer) return undefined;
      return readerOverTarget({
        domain,
        reindexer,
        ...(budget ? { budget } : {}),
      });
    },
    label: '[confirm]',
  });

  return {
    readerFor: (domain) => fanned.byDomain[domain],
    domains: fanned.domains,
    ...(budget?.meter
      ? { meter: { budget: budget.meter, tenantId: budget.tenantId, provider: budget.provider } }
      : {}),
    close: () => fanned.close(),
  };
}

/**
 * THE TARGET'S OWN IDENTITY, for keying the tenant's budget by (D9).
 *
 * MANAGED-shaped, and deliberately left beside the builder rather than moved:
 * it reads connection ROWS, so it is the managed worker's answer to "whose
 * limit is this", and the D9 reasoning below is what makes the builder's
 * `budget` argument mean anything. The appliance resolves the same question
 * from its own config. (`pg` is a type-only import here, so nothing about this
 * reaches an appliance bundle.)
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
