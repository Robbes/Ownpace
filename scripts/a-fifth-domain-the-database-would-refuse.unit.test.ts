// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * No domain the product knows may be one the database refuses
 * (workplan 0113 T2).
 *
 * Eight tables store a domain, each behind its own `CHECK (domain = ANY
 * (ARRAY[…]))`. A domain added to `DISCOVERY_DOMAINS` without a migration
 * widening those eight does not fail at compile time and does not fail at
 * start-up. It fails when the first row is written — mid-pass, on a customer's
 * migration, with a constraint violation and a half-copied collection behind
 * it. That is the worst place to learn it, so it is learned here instead.
 *
 * THE ORDER THIS PINS. The migration goes first and the code follows: the
 * database accepts `task` from `0036_a_task_is_not_an_event.sql` while
 * `DISCOVERY_DOMAINS` still names four. A database that accepts a value nobody
 * sends is inert; code that sends a value the database refuses is a dead run.
 * So there are two assertions, and they are not the same one twice: every
 * domain the product KNOWS must be accepted (which fails if a fifth is added
 * to the shared list on its own), and `task` specifically must be accepted
 * (which fails if 0036 is reverted or a later migration re-narrows a CHECK).
 * The second folds into the first the day `task` joins `DISCOVERY_DOMAINS`.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'packages', 'ledger', 'migrations');
const DISCOVERY = join(ROOT, 'packages', 'shared', 'src', 'discovery.ts');

/**
 * The product's domain list, READ AS TEXT rather than imported.
 *
 * A test file at the repo root cannot resolve a workspace import — vitest's
 * own config says so, and says why. Reading the source is no weaker here: the
 * list is a literal, `a-domain-union-typed-out-by-hand.unit.test.ts` pins it to
 * this one file, and a parse that found nothing throws below rather than
 * quietly checking an empty set.
 */
function discoveryDomains(): ReadonlyArray<string> {
  const src = readFileSync(DISCOVERY, 'utf8');
  const m = /export const DISCOVERY_DOMAINS = \[([^\]]*)\] as const;/.exec(src);
  if (!m) throw new Error(`DISCOVERY_DOMAINS is no longer a literal array in ${DISCOVERY}`);
  const values = [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((v) => v[1]!);
  if (values.length === 0) throw new Error('DISCOVERY_DOMAINS parsed as empty');
  return values;
}

/**
 * The domain a `CHECK` names, and the values it accepts — read from the
 * migrations in the order Postgres applies them, so the LAST definition of a
 * constraint is the one that counts. A widening migration drops and recreates;
 * this reads the same history the database did.
 */
function effectiveDomainChecks(): Map<string, ReadonlyArray<string>> {
  const byName = new Map<string, ReadonlyArray<string>>();
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    // `CONSTRAINT x CHECK ((domain = ANY (ARRAY[…])))` in the baseline, and
    // `ADD CONSTRAINT x CHECK (domain = ANY (ARRAY[…]))` in a widening — one
    // pattern for both, tolerant of the whitespace each style uses.
    const re =
      /CONSTRAINT\s+(\w*(?:domain_check|item_type_check))\s+CHECK\s*\(+\s*(?:domain|item_type)\s*=\s*ANY\s*\(\s*ARRAY\[([^\]]*)\]/gi;
    for (const m of sql.matchAll(re)) {
      const values = [...m[2]!.matchAll(/'([a-z_]+)'/g)].map((v) => v[1]!);
      byName.set(m[1]!, values);
    }
  }
  return byName;
}

describe('the database accepts every domain the product knows', () => {
  it('found the domain CHECKs at all — nine of them, or this guard is reading nothing', () => {
    const checks = effectiveDomainChecks();
    // Eight tables store a `domain`; `item` also carries the legacy
    // `item_type` column, whose vocabulary says 'mail' where the others say
    // 'email'. Nine in total, and the count is asserted because a regex that
    // silently stopped matching would otherwise report perfect health.
    expect([...checks.keys()].sort()).toEqual([
      'collection_mapping_domain_check',
      'item_domain_check',
      'item_item_type_check',
      'migration_discovery_domain_check',
      'migration_status_domain_check',
      'path_lifecycle_domain_check',
      'scope_selection_domain_check',
      'sync_checkpoint_domain_check',
      'verification_domain_check',
    ]);
  });

  it('every domain in DISCOVERY_DOMAINS is accepted by every CHECK that stores one', () => {
    const checks = effectiveDomainChecks();
    const refused: string[] = [];
    for (const [name, accepted] of checks) {
      for (const domain of discoveryDomains()) {
        // The legacy `item_type` column spells the mail domain 'mail'.
        const spelling = name === 'item_item_type_check' && domain === 'email' ? 'mail' : domain;
        if (!accepted.includes(spelling)) refused.push(`${name} refuses '${spelling}'`);
      }
    }
    expect(
      refused,
      'a domain the product knows is one the database would refuse. Widen these CHECKs in ' +
        'an additive migration BEFORE the domain reaches DISCOVERY_DOMAINS — otherwise the ' +
        "first row written is a constraint violation in the middle of somebody's pass",
    ).toEqual([]);
  });

  it("'task' is accepted everywhere already, ahead of the code that will send it (0113 T2)", () => {
    const checks = effectiveDomainChecks();
    const refused = [...checks]
      .filter(([, accepted]) => !accepted.includes('task'))
      .map(([name]) => name);
    expect(
      refused,
      'migration 0036 widened every domain CHECK to accept task; one of them no longer does, ' +
        'so either 0036 was reverted or a later migration re-narrowed a constraint',
    ).toEqual([]);
  });

  it("'journal' is NOT accepted — an unmeasured face stays out of the database too", () => {
    // VJOURNAL is the third component in the same iCalendar enum and the
    // obvious thing to widen "while we are in here". 0105's never-guess rule
    // and 0113's own scope say no: nobody has asked, and no provider this
    // product targets exposes one. A CHECK that already accepted it would be
    // a promise nothing keeps.
    const accepting = [...effectiveDomainChecks()]
      .filter(([, accepted]) => accepted.includes('journal'))
      .map(([name]) => name);
    expect(accepting).toEqual([]);
  });
});
