// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE SOURCE'S OWN COUNT, FOR THE CHECK (the owner, 2026-11-24).
 *
 * The Check used to take its "source" figure from the ledger, which counts
 * what a pass recorded. A message no pass ever listed was then on neither side
 * of the comparison, and Gmail's label-less archived mail was lost through a
 * green gate. Gmail can say how many messages it holds (All Mail, every
 * message once, Spam and Trash aside; `GmailFolderView.countEveryMessage`),
 * and the Check now compares against that (`VerificationDeps.getSourceSideCount`).
 *
 * Both editions' Checks already build the mail deps, source included, to read
 * the destination; the count rides along with them (`withTheSourceSideCount`)
 * rather than opening the old account a second way.
 */

import { DEFAULT_EXCLUDE_SPECIAL_USE, type SourceConnector, type SpecialUse } from '@openmig/shared';
import type { OpenTarget, OpenedTarget, VerificationDomain } from './target-fan-out.ts';

/**
 * The mail source's own count, or undefined where it is no measure of this
 * migration:
 *
 * - a source with no count of its own (every one but Gmail's);
 * - a test migration (`markedOnly`), which copies only what is marked;
 * - a mapping that leaves out more than Spam and Trash (`excludeSpecialUse`):
 *   the account's whole count then holds mail the owner chose not to copy.
 */
export function mailSourceSideCount(deps: {
  /** Optional: a deps double that builds only a target has none, and then there is no count. */
  readonly source?: SourceConnector;
  readonly excludeSpecialUse?: ReadonlyArray<SpecialUse>;
}): (() => Promise<number>) | undefined {
  const { source } = deps;
  if (!source || source.markedOnly || typeof source.countEveryMessage !== 'function') return undefined;
  const excluded = deps.excludeSpecialUse ?? DEFAULT_EXCLUDE_SPECIAL_USE;
  if (excluded.some((role) => role !== 'trash' && role !== 'junk')) return undefined;
  return () => source.countEveryMessage!();
}

/** An opened target that may carry its source's own count (mail only). */
export interface OpenedWithCount extends OpenedTarget {
  readonly sourceSideCount?: () => Promise<number>;
}

/**
 * Wrap an opener so the mail domain's source count is kept as it is opened.
 * Read the counts after the fan-out, for the domains it kept: a domain whose
 * target could not be read is NOT_VERIFIABLE whatever its source holds.
 */
export function withTheSourceSideCount(open: (domain: Parameters<OpenTarget>[0]) => Promise<OpenedWithCount>): {
  readonly open: OpenTarget;
  readonly counts: (kept: ReadonlyArray<Parameters<OpenTarget>[0]>) => Partial<Record<VerificationDomain, () => Promise<number>>>;
} {
  let mail: (() => Promise<number>) | undefined;
  return {
    open: async (domain) => {
      const opened = await open(domain);
      if (domain === 'email') mail = opened.sourceSideCount;
      return opened;
    },
    counts: (kept) => (mail && kept.includes('email') ? { mail } : {}),
  };
}
