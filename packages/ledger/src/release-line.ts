// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE RELEASE LINE: every release, where pre-release ended, and where each
 * upgrade gate starts (workplan 0146 T3 and T4). Test support: nothing that
 * ships imports this, and the package index does not re-export it.
 *
 * `scripts/release-line.json` is the one place these are written:
 *
 * - `releases`: every release tag, oldest first, in SemVer order. The fold
 *   adds the version it folds (`docs/release.md` §1), so the last entry may
 *   be the release being prepared, untagged until Release tags it. Every
 *   other entry is a tag, and every `v*` tag is an entry
 *   (`every-release-is-a-starting-point.unit.test.ts`).
 * - `preReleaseEndedAt`: the tag pre-release ended with. From it on, no
 *   migration a release shipped may change, and `squash-migrations.sh`
 *   refuses (ADR-0045, `a-chain-that-only-grows.unit.test.ts`).
 * - `oldestSupported`: per chain, the oldest release an upgrade is still
 *   proved from. The ledger chain's is rc.1; the managed chain's is the
 *   first release that had one, since a database from before the split is
 *   adopted (`two-chains.unit.test.ts`), not upgraded.
 *
 * Each upgrade gate starts from its chain's oldest supported release and from
 * the newest release (§22.1: "from N-1, and at least one older, to N"),
 * unless `UPGRADE_FROM_REF` names one, which is how Release's preflight runs
 * each gate from the release before alone.
 *
 * JSON rather than a module, so that a shell script (`squash-migrations.sh`)
 * and the tests read the same file with nothing to import. This module is
 * the one reading of it the tests share: both upgrade gates, the managed
 * chain's Postgres leg, and the guards in `scripts/`. It lives here rather
 * than in `scripts/` because a relative import from a package's `src` must
 * name a file in a package (`runs-without-a-transpiler.unit.test.ts`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RELEASE_LINE = 'scripts/release-line.json';

export type Chain = 'ledger' | 'managed';

export interface ReleaseLine {
  /** The tag pre-release ended with (ADR-0045). */
  preReleaseEndedAt: string;
  /** Every release tag, oldest first; the last may be the release being prepared. */
  releases: string[];
  /** Per chain, the oldest release an upgrade is still proved from. */
  oldestSupported: Record<Chain, string>;
}

/** The chains an upgrade gate proves, as `release-upgrade-gates.mjs` names them. */
export const CHAINS: readonly Chain[] = Object.freeze(['ledger', 'managed'] as const);

/** The release line as the file holds it, from a checkout's root. */
export function readReleaseLine(root: string): ReleaseLine {
  return JSON.parse(readFileSync(join(root, RELEASE_LINE), 'utf8')) as ReleaseLine;
}

/** The root `package.json`'s version, from a checkout's root. */
export function rootVersion(root: string): string {
  return (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
}

/**
 * The releases that are out: every entry but a last one that is the version
 * this checkout is about to release and is not tagged yet (the fold lists it
 * before Release tags it).
 *
 * `isTagged(tag)` says whether the tag resolves here.
 */
export function releasedOnly(
  line: ReleaseLine,
  { version, isTagged }: { version: string; isTagged: (tag: string) => boolean },
): string[] {
  const releases = [...line.releases];
  const last = releases[releases.length - 1];
  if (last === `v${version}` && !isTagged(last)) releases.pop();
  return releases;
}

/**
 * Where a chain's upgrade gate starts, in order: its oldest supported
 * release, then the newest release, once each. `fromRef` is
 * `UPGRADE_FROM_REF`; when it is set it is the only one.
 */
export function startingPoints(
  line: ReleaseLine,
  chain: Chain,
  {
    fromRef,
    version,
    isTagged,
  }: { fromRef?: string | undefined; version: string; isTagged: (tag: string) => boolean },
): string[] {
  if (fromRef) return [fromRef];
  if (!CHAINS.includes(chain)) throw new Error(`no upgrade gate proves a chain called ${JSON.stringify(chain)}`);
  const oldest = (line.oldestSupported as Partial<Record<Chain, string>> | undefined)?.[chain];
  if (!oldest) throw new Error(`${RELEASE_LINE} names no oldest supported release for the ${chain} chain`);
  const released = releasedOnly(line, { version, isTagged });
  const newest = released[released.length - 1];
  return newest === undefined || newest === oldest ? [oldest] : [oldest, newest];
}
