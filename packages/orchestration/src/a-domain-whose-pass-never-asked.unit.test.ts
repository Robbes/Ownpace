// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PASS ASKS WHETHER THE TARGET CAN CARRY ITS DOMAIN — ALL FIVE OF THEM
 * (2026-09-08).
 *
 * Every coherence gate this product has runs at CREATION: the wizard locks the
 * ticks to the intersection of what the source provides and the target
 * receives, the create API refuses the same combination verbatim, and
 * `scope_selection` is written straight from the array that refusal checked.
 *
 * None of them runs again, and the ground under them moves. `TARGET_TYPE_DOMAINS`
 * gained `task` in workplan 0113 and `nextcloud` on 2026-09-07; a grant can be
 * revoked long after a mapping was made. A mapping created before a row changed
 * keeps a tick nothing re-asks about, because `scope_selection` is written once
 * and never updated.
 *
 * #858 gave mail the question, in place, after the owner's preflight showed him
 * `Unsupported target type: undefined` — a sentence naming no target, no domain
 * and no remedy. The other four domains still had none. This is that question,
 * asked once for all five, through one function both seams call.
 *
 * ## Two seams, and why they must not each own a copy
 *
 * The mail pass builds its deps in `buildDepsFromMapping`; the other four go
 * through `buildDomainDepsFromMapping`. Two entry points is a fact of the code.
 * Two COPIES of the table lookup would be the shape this exact file has been
 * repaired for twice — a table and a switch agreeing by hand until somebody
 * adds a provider to one of them.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DISCOVERY_DOMAINS,
  TARGET_TYPE_DOMAINS,
  type WizardTargetType,
} from '@openmig/shared';
import {
  refuseDomainTheTargetCannotCarry,
  discoveryDomainOf,
  type PassDomain,
} from './pass-domain-refusal.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILDER = readFileSync(join(HERE, 'build-deps-from-mapping.ts'), 'utf8');

/** The deps-builder word for each domain, which is not quite the domain name. */
const PASS_DOMAINS: PassDomain[] = ['mail', 'calendar', 'contact', 'file', 'task'];

describe('the vocabulary the builders and the tables each use', () => {
  it('translates every deps-builder domain into one the tables know', () => {
    // `mail` is the odd one: the builder overload says `'mail'`, the tables say
    // `'email'`. A translation that silently returned `'mail'` would look up a
    // domain no table has, find nothing, and refuse nothing — a guard that is
    // present and inert, which is worse than an absent one.
    const translated = PASS_DOMAINS.map(discoveryDomainOf);
    expect(new Set(translated)).toEqual(new Set(DISCOVERY_DOMAINS));
    expect(discoveryDomainOf('mail')).toBe('email');
  });
});

describe('what each target kind is refused', () => {
  // Derived from the table rather than hand-picked, so a kind added to
  // TARGET_TYPE_DOMAINS is covered the day it arrives.
  for (const kind of Object.keys(TARGET_TYPE_DOMAINS) as WizardTargetType[]) {
    const carried = TARGET_TYPE_DOMAINS[kind];

    it(`refuses ${kind} every domain it cannot carry, in the wizard's own words`, () => {
      const cannot = PASS_DOMAINS.filter((d) => !carried.includes(discoveryDomainOf(d)));
      for (const domain of cannot) {
        let message: string | undefined;
        try {
          refuseDomainTheTargetCannotCarry(domain, kind);
        } catch (err) {
          message = (err as Error).message;
        }
        // Absent means it did not refuse at all, which is the whole defect —
        // named here rather than left to a confusing assertion on `undefined`.
        expect(message, `${kind} did not refuse the '${domain}' domain at all`).toBeDefined();
        message ??= '';
        // The refusal has to NAME both sides and offer a way out — it is the
        // wizard's sentence, rendered verbatim, not a second one written here.
        expect(message).toContain(discoveryDomainOf(domain));
        expect(message).toMatch(/cannot receive/);
        expect(message).toMatch(/Choose a target that speaks every selected data type/);
        // And never the sentence this replaced.
        expect(message).not.toMatch(/undefined/);
      }
    });

    it(`lets ${kind} through for every domain it CAN carry`, () => {
      // The other half, and the one that would break working migrations if it
      // were wrong. A refusal that refuses everything is not a guard.
      const can = PASS_DOMAINS.filter((d) => carried.includes(discoveryDomainOf(d)));
      expect(can.length).toBeGreaterThan(0);
      for (const domain of can) {
        expect(() => refuseDomainTheTargetCannotCarry(domain, kind)).not.toThrow();
      }
    });
  }

  it('leaves a kind the table has never heard of alone', () => {
    // Connection kinds outnumber wizard target types — `imap-dav`, the archive
    // kinds, anything a future provider adds. Refusing everything unrecognised
    // would break working migrations to make a point about a table this
    // function does not own.
    for (const domain of PASS_DOMAINS) {
      expect(() => refuseDomainTheTargetCannotCarry(domain, 'imap-dav')).not.toThrow();
      expect(() => refuseDomainTheTargetCannotCarry(domain, '')).not.toThrow();
    }
  });
});

describe('both seams ask it', () => {
  it('the mail seam and the four-domain seam both call the shared refusal', () => {
    const calls = [...BUILDER.matchAll(/refuseDomainTheTargetCannotCarry\(/g)];
    // Exactly two: one per entry point. A third would mean a branch grew its
    // own; a first-and-only would mean one seam lost it.
    expect(calls.length).toBe(2);
  });

  it('holds no second copy of the table lookup', () => {
    // The failure this guard exists for is not an absent call — it is a
    // SECOND implementation that drifts. `targetDomainRefusal` belongs to the
    // shared module now; the builder reaching for it directly again is the
    // start of the copy.
    expect(BUILDER).not.toMatch(/targetDomainRefusal\(/);
  });
});
