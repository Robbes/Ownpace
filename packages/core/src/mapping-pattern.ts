// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * `mailbox_mapping.pattern` finally gets a reader (workplan 0027 T3).
 *
 * The column has been settable since ledger v1 and read by nothing — one of
 * the unowned features the 2026-08-02 sweep found. §14.1's Pattern S says a
 * shared mailbox becomes an ORDINARY mapping: the full folder tree copied
 * idempotently, the existing mail path unchanged. Nothing about the copy
 * differs, which is exactly why this file is small — the pattern is a fact
 * ABOUT a mapping, not a second engine.
 *
 * What it does earn its place doing is the refusal below.
 *
 * A mapping declaring `distribution_d` is REFUSED at build time. A
 * distribution list usually has no message store at all (§14.1) — what
 * migrates is the definition and the member list, and that is 0027 T2's
 * runbook, not a mailbox copy. Allowed through, such a mapping would connect,
 * find nothing to copy, and report a clean, successful, entirely empty
 * migration; the owner would read "done" and cut over to an address that
 * reaches nobody. A loud refusal naming the runbook is the whole difference
 * between a caught misconfiguration and a silent data loss (hard rule 9).
 */

import type { MappingConfig, SourceConfig, SharedAddressPattern } from '@openmig/shared';

export type { SharedAddressPattern };

/**
 * Which §14.1 pattern this mapping's source describes.
 *
 * A Graph source naming a `mailbox` is reading `/users/{address}` under
 * application permissions — the only way to reach a store with no interactive
 * user to sign in as, which is what a shared mailbox is. Everything else is
 * an ordinary personal mailbox and carries no pattern at all: `undefined`
 * means "not a shared address", not "unknown".
 */
export function patternForSource(source: SourceConfig): SharedAddressPattern | undefined {
  const mailbox = (source as { mailbox?: string }).mailbox;
  return source.type.startsWith('graph-') && typeof mailbox === 'string' && mailbox.trim() !== ''
    ? 'shared_s'
    : undefined;
}

/**
 * Refuse a mapping that cannot do what it says.
 *
 * Throws rather than returning a flag: this runs where a mapping is built,
 * and a mapping that would copy nothing must not reach a scheduler at all.
 */
export function assertMappingPattern(config: MappingConfig): void {
  if (config.pattern === undefined) return;

  // `distribution_d` never reaches here from a config FILE — the parser
  // refuses it with the same reasoning (`parsePattern`). This guards the
  // other doors: a mapping built in code, or by the managed wizard.
  if ((config.pattern as string) !== 'shared_s') {
    throw new Error(
      `Mapping ${config.mappingId} declares pattern ${JSON.stringify(config.pattern)}, which ` +
        'cannot be a mapping. The only pattern a mailbox mapping can carry is "shared_s" (a ' +
        'shared mailbox). A distribution list has no message store to copy — what migrates is ' +
        'the group definition and its member list, which is a manual step (see the ' +
        'shared-addresses runbook, GET /shared-addresses/runbook). A mapping for one would ' +
        'connect, find nothing, and report a successful empty migration.',
    );
  }

  // Declared shared_s: the source has to actually be able to read a shared
  // store. A `/me` read is whoever the stored credentials belong to, so a
  // mapping claiming to migrate info@ while reading /me would copy somebody's
  // personal mailbox into the shared target — wrong mail, in the wrong place,
  // reported as a success.
  if (patternForSource(config.source) !== 'shared_s') {
    throw new Error(
      `Mapping ${config.mappingId} declares pattern "shared_s" but its source does not name a ` +
        'mailbox. A shared store has no interactive user to sign in as, so it is read as ' +
        '/users/{address}: set `source.mailbox` to the shared address. Without it the source ' +
        'reads /me — whoever the stored credentials belong to — and would copy the wrong ' +
        'mailbox into the shared target. See docs/shared-mailboxes.md.',
    );
  }
}

/**
 * The pattern to persist for this mapping: what it declared, or what its
 * source implies. Declared wins, and `assertMappingPattern` has already
 * refused a declaration the source cannot support.
 */
export function resolveMappingPattern(config: MappingConfig): SharedAddressPattern | undefined {
  return config.pattern ?? patternForSource(config.source);
}
