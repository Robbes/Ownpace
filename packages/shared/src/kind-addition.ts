// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ADDING A KIND TO A MIGRATION THAT ALREADY EXISTS (workplan 0125 T6, the
 * owner's decision of 2026-09-23).
 *
 * The day Google Tasks became a face of a Google account (workplan 0126), the
 * owner reconnected his account with Tasks ticked and asked how his running
 * migration would pick them up. It could not. A migration's kinds were fixed
 * when it was created: the create route wrote `scope_selection` once, and
 * nothing offered to change it. Both ways round it were worse:
 *
 *  - a SECOND migration between the same two accounts is refused unless its
 *    folder setting differs (migration 0022, the owner's rule against landing
 *    everything twice);
 *  - deleting and recreating the migration adopts everything already copied,
 *    and an adopted item deliberately stops following edits at the source.
 *
 * So a migration may now GAIN a kind. Only gain: taking a kind off would leave
 * what it already copied on the target with nothing keeping it in step, and
 * nothing here decides what those copies then are.
 *
 * ## One answer for the page and the route
 *
 * `kindChoices` says, for each kind, whether it is on the migration, may be
 * added, or may not and why. The migration page shows exactly that list, and
 * the route accepts exactly what it calls addable, so the page cannot offer a
 * press the route refuses and the route cannot accept what the page never
 * offered. The rules are the ones the migration was created under, read from
 * the same tables:
 *
 *  - the SOURCE must serve the kind. An account's ceiling is this
 *    deployment's (`providerAccountDomains`), a single-purpose source serves
 *    its one kind (`SOURCE_TYPE_DOMAINS`), and a source whose ceiling nothing
 *    declares, such as a plain IMAP server, is offered nothing new;
 *  - the TARGET must receive it (`TARGET_TYPE_DOMAINS`);
 *  - neither side may have MEASURED that it cannot (`measuredNoRefusal`, the
 *    three-state rule: only a measured no refuses, never an unknown);
 *  - and the migration must not be past cutover, from which point its source
 *    is no longer the authority on what exists (`isAfterCutover`).
 */

import { wizardTypeForConnectionKind } from './credential-fields.ts';
import { DISCOVERY_DOMAINS, type DiscoveryDomain } from './discovery.ts';
import { isAfterCutover } from './lifecycle.ts';
import {
  isProviderAccountKind,
  providerAccountDomains,
  type ProviderAccountEnv,
} from './provider-accounts.ts';
import { measuredNoRefusal } from './qualification-gate.ts';
import { SOURCE_TYPE_DOMAINS, TARGET_TYPE_DOMAINS } from './target-domains.ts';

/** One kind, as the migration page shows it. */
export type KindChoice =
  | { readonly domain: DiscoveryDomain; readonly state: 'on' }
  | { readonly domain: DiscoveryDomain; readonly state: 'addable' }
  | { readonly domain: DiscoveryDomain; readonly state: 'refused'; readonly reason: string };

/** What the choice is made from: the migration and its two connections. */
export interface KindChoiceInput {
  /** The migration's lifecycle word (`mailbox_mapping.status`). */
  readonly status: string;
  /** The kinds already on it (its included `scope_selection` rows). */
  readonly current: ReadonlyArray<string>;
  /** `connection.kind` of each side. */
  readonly sourceKind: string;
  readonly targetKind: string;
  /** Each side's stored measurement (`connection.qualification`); absent is unmeasured. */
  readonly sourceQualification?: unknown;
  readonly targetQualification?: unknown;
}

/**
 * Past cutover the old account stops deciding what exists (0117 D4), so a
 * kind added then would be copied from a source nobody follows any more.
 */
export const KIND_AFTER_CUTOVER_REFUSAL =
  'A kind can only be added before cutover. From cutover on, the old account no longer ' +
  'decides what exists, so a kind added now would be copied from a source nothing follows ' +
  'any more. Start a new migration for it.';

/**
 * What this source can serve, or undefined when nothing declares it.
 *
 * Undefined is not "everything". The create route lets a plain IMAP source
 * through with any tick, because nothing says what else its server does; a
 * door that ADDS to a running migration offers nothing it cannot vouch for.
 */
function sourceCeiling(
  kind: string,
  env: ProviderAccountEnv,
): ReadonlyArray<DiscoveryDomain> | undefined {
  if (isProviderAccountKind(kind)) return providerAccountDomains(kind, env);
  const table: Partial<Record<string, ReadonlyArray<DiscoveryDomain>>> = SOURCE_TYPE_DOMAINS;
  return table[wizardTypeForConnectionKind(kind)];
}

/** What this target can receive, or undefined for a kind no wizard offers. */
function targetCeiling(kind: string): ReadonlyArray<DiscoveryDomain> | undefined {
  const table: Partial<Record<string, ReadonlyArray<DiscoveryDomain>>> = TARGET_TYPE_DOMAINS;
  return table[kind];
}

/**
 * Every kind worth showing on this migration's page, in the order a person
 * ticks them: the ones it has, and the ones both sides could carry.
 *
 * A kind neither side could carry is left out rather than listed as refused.
 * A Google account migration does not need telling, every time the page
 * loads, that it will never copy a mailbox; the wizard said so at creation.
 *
 * `env` is this deployment's, because a Google account's ceiling is (ADR-0041).
 * The route passes `process.env`; nothing in a browser calls this.
 */
export function kindChoices(input: KindChoiceInput, env: ProviderAccountEnv = {}): KindChoice[] {
  const current = new Set(input.current);
  const serves = sourceCeiling(input.sourceKind, env);
  const receives = targetCeiling(input.targetKind);
  const choices: KindChoice[] = [];
  for (const domain of DISCOVERY_DOMAINS) {
    if (current.has(domain)) {
      choices.push({ domain, state: 'on' });
      continue;
    }
    if (!serves?.includes(domain) || !receives?.includes(domain)) continue;
    if (isAfterCutover(input.status)) {
      choices.push({ domain, state: 'refused', reason: KIND_AFTER_CUTOVER_REFUSAL });
      continue;
    }
    const measured =
      measuredNoRefusal(input.sourceQualification, [domain]) ??
      measuredNoRefusal(input.targetQualification, [domain]);
    choices.push(
      measured === null ? { domain, state: 'addable' } : { domain, state: 'refused', reason: measured },
    );
  }
  return choices;
}

/**
 * Why this kind may not be added, or null when it may: what the route answers.
 *
 * Every refusal names what to do instead. A kind the page would never have
 * offered, because one side cannot carry it, says which side.
 */
export function kindAdditionRefusal(
  domain: DiscoveryDomain,
  input: KindChoiceInput,
  env: ProviderAccountEnv = {},
): string | null {
  const choice = kindChoices(input, env).find((c) => c.domain === domain);
  if (choice?.state === 'addable') return null;
  if (choice?.state === 'refused') return choice.reason;
  if (choice?.state === 'on') return `'${domain}' is already part of this migration.`;
  const serves = sourceCeiling(input.sourceKind, env);
  if (serves === undefined) {
    return (
      "Nothing says what else this migration's source can carry, so no kind can be added to " +
      'it. Start a new migration with the kinds you want.'
    );
  }
  if (!serves.includes(domain)) {
    return (
      `This migration's source cannot provide '${domain}'. Start a new migration from a ` +
      'source that serves it.'
    );
  }
  return (
    `This migration's destination cannot receive '${domain}'. Start a new migration to a ` +
    'destination that can.'
  );
}
