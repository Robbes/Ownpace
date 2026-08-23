// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The identity provider and the database it initialises into are pinned in the
 * same file, and they are not independent.
 *
 * E2E (managed) #46 is what that costs. `ghcr.io/zitadel/zitadel:v4.6.2`
 * against `postgres:18-alpine`:
 *
 *   migration failed  name=34_add_cache_schema
 *     error="ERROR: partitioned tables cannot be unlogged (SQLSTATE 0A000)"
 *   setup failed, skipping cleanup
 *
 * Zitadel's cache schema created an UNLOGGED PARTITIONED table; PostgreSQL
 * removed support for that. Setup step 34 therefore failed on every attempt and
 * the provider could never finish starting. No setting avoids it
 * (zitadel/zitadel#10712); it was fixed upstream in zitadel/zitadel#11484,
 * merged 2026-02-03 and backported to the v4 line.
 *
 * Neither number can be checked against reality from here — this repository's
 * CI has no Docker daemon and no route to ghcr.io — so what is checkable is the
 * PAIRING, and that is what this pins. Moving either version alone is how a
 * combination nobody has ever run reaches the Spark.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPOSE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'compose', 'managed.yml'),
  'utf8',
);

/**
 * A floor, deliberately, and NOT a claim about the earliest release that works.
 * The fix landed on 2026-02-03 and the v4 minors are not dated in this file, so
 * naming an exact first-fixed version would be inventing precision nobody here
 * can check. v4.17.1 is a release known to be long after the backport. Lowering
 * this needs evidence, not arithmetic.
 */
const ZITADEL_FLOOR_FOR_PG18 = [4, 17, 1] as const;
const PG_MAJOR_REQUIRING_THE_FIX = 18;

const zitadelTag = /image:\s*ghcr\.io\/zitadel\/zitadel:v(\d+)\.(\d+)\.(\d+)/.exec(COMPOSE);
const pgMajors = [...COMPOSE.matchAll(/image:\s*postgres:(\d+)-/g)].map((m) => Number(m[1]));

const cmp = (a: readonly number[], b: readonly number[]) =>
  a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;

describe('the identity provider can initialise into the database it is pointed at', () => {
  it('found both pins', () => {
    // Vacuity guard: if either regex stops matching, every case below passes on
    // nothing at all.
    expect(zitadelTag, 'the zitadel image pin is gone or no longer a vX.Y.Z tag').toBeTruthy();
    expect(pgMajors.length, 'no postgres image pin found').toBeGreaterThan(0);
  });

  it('does not pair a PostgreSQL that forbids unlogged partitions with a Zitadel that needs them', () => {
    const version = [Number(zitadelTag![1]), Number(zitadelTag![2]), Number(zitadelTag![3])];
    const worst = Math.max(...pgMajors);
    if (worst < PG_MAJOR_REQUIRING_THE_FIX) return;
    expect(
      cmp(version, ZITADEL_FLOOR_FOR_PG18),
      `postgres ${worst} needs a Zitadel carrying the fix from zitadel/zitadel#11484; ` +
        `v${version.join('.')} is below the v${ZITADEL_FLOOR_FOR_PG18.join('.')} floor. ` +
        'Setup step 34_add_cache_schema will fail with SQLSTATE 0A000 and the provider ' +
        'will never finish starting.',
    ).toBeGreaterThanOrEqual(0);
  });

  it('every postgres in the file is the same major, because zitadel shares one of them', () => {
    // The provider initialises into `ownpace-db`. A second Postgres on a
    // different major would make "which version does Zitadel see" a question
    // whose answer depends on which service it happened to be pointed at.
    expect(new Set(pgMajors).size, `mixed postgres majors: ${pgMajors.join(', ')}`).toBe(1);
  });

  it('records why the pair is what it is, next to the pin', () => {
    // A version number with no reason beside it is one somebody bumps back.
    const block = COMPOSE.slice(
      COMPOSE.indexOf('\n  zitadel:'),
      COMPOSE.indexOf('image: ghcr.io/zitadel/zitadel'),
    );
    expect(block, 'the reason for the pin has gone missing').toContain('34_add_cache_schema');
    expect(block).toMatch(/partitioned tables cannot be unlogged/);
  });
});
