// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE COHERENCE CHECK THAT RUNS WHEN THE PASS DOES, not only when the mapping
 * was made.
 *
 * The wizard constrains the data-type ticks to the intersection of what the
 * source can provide and the target can receive, the create API refuses the
 * same combination verbatim, and `scope_selection` is written straight from
 * the array that refusal just checked. Three gates, and every one of them runs
 * ONCE — at creation.
 *
 * Ground truth does not hold still underneath them:
 *
 *  - `TARGET_TYPE_DOMAINS` has changed twice in a month. `task` joined in
 *    workplan 0113; `nextcloud` became a target kind on 2026-09-07. A mapping
 *    created before a row changed keeps a tick nothing re-asks about.
 *  - a grant can be REVOKED after creation. Someone removes `Tasks.Read` from
 *    the Entra app registration and the mapping still carries tasks. No
 *    creation-time gate can see that, by construction.
 *
 * So the pass asks too, for its own domain, at the moment it builds its deps.
 * The check is one table lookup against the kind the connection row actually
 * holds — cheap enough to run every pass, and it cannot go stale because it
 * reads the same table the wizard reads.
 *
 * ## This generalises #858 rather than sitting beside it
 *
 * That PR put the question inside `mailTargetConfigFromConnection`, for mail
 * and the target only, after the owner's preflight showed him an Email row
 * reading `Unsupported target type: undefined` — a sentence naming no target,
 * no domain and no remedy. The sentence it now gives is
 * `targetDomainRefusal`'s, the wizard's own words, so the two cannot drift.
 * The other four domains had no such question at all.
 *
 * ## What this deliberately does NOT do: the source half
 *
 * `sourceDomainRefusal` exists and is enforced at creation beside its target
 * twin, and it is NOT asked here. Two reasons, neither of them "not worth it":
 *
 *  - it needs the account's granted faces (`googleAccountDomains`), which live
 *    in the connection's stored qualification rather than in a static table —
 *    so the question is "what did the last Test measure", not "what can this
 *    kind do", and a stale or absent qualification must never refuse a pass
 *    (the three-state rule: a measured no constrains, unknown never does);
 *  - `measuredNoRefusal` already asks the measured half at creation, and
 *    putting a second, differently-shaped reading of the same record in the
 *    pass path is how two answers to one question start disagreeing.
 *
 * The source half is worth doing and wants the qualification's own seam, not
 * this one. Saying so here rather than leaving the asymmetry to be discovered.
 */

import {
  TARGET_TYPE_DOMAINS,
  targetDomainRefusal,
  type DiscoveryDomain,
  type WizardTargetType,
} from '@openmig/shared';

/**
 * The domain literals the deps builders take, which are not quite the domain
 * names: the mail pass is built with `'mail'` because that is the word its
 * overload uses, while the domain it carries is `'email'`.
 */
export type PassDomain = 'mail' | 'calendar' | 'contact' | 'file' | 'task';

/** The deps builder's word for a domain, in the vocabulary the tables use. */
export function discoveryDomainOf(domain: PassDomain): DiscoveryDomain {
  return domain === 'mail' ? 'email' : domain;
}

/**
 * Refuse, in the wizard's own sentence, a domain this target kind cannot
 * receive — or return silently when it can.
 *
 * A kind the table has never heard of is LEFT ALONE, deliberately. Connection
 * kinds outnumber wizard target types (`imap-dav`, `soverin` and the archive
 * kinds among them), and refusing everything unrecognised here would break
 * working migrations to make a point about a table this function does not own.
 * The table's job is to say what a listed kind cannot do; silence about an
 * unlisted one is honest.
 */
export function refuseDomainTheTargetCannotCarry(
  domain: PassDomain,
  targetKind: string,
): void {
  if (!(targetKind in TARGET_TYPE_DOMAINS)) return;
  const refusal = targetDomainRefusal(targetKind as WizardTargetType, [discoveryDomainOf(domain)]);
  if (refusal) throw new Error(refusal);
}
