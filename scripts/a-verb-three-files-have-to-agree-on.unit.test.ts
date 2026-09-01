// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SUB-COMMAND IS A HANDSHAKE BETWEEN THREE FILES, and none of them checks the
 * other two.
 *
 * `deploy/compose/operator.sh` advertises verbs in its header and in the FATAL
 * block somebody sees when they run it bare. It then dispatches by STRING
 * CONCATENATION:
 *
 *     pnpm --dir "$REPO_ROOT" --filter @openmig/api "operator:$1" "${@:2}"
 *
 * So a verb the wrapper offers and `apps/api/package.json` does not define
 * fails with pnpm's own words — `Command "operator:leave" not found` — which
 * reads like a broken installation rather than like a script that advertised
 * something it cannot run. And a verb package.json defines with no `case` in
 * `operator.ts` reaches the `default:` and prints USAGE, so the operator is
 * handed the list of commands in answer to running one of them.
 *
 * BOTH FAILURES ARE OF THE KIND THIS REPOSITORY KEEPS FINDING: nothing is red,
 * something merely does not work, and the message points somewhere else. The
 * `--` that made `operator.sh add` write a row nobody could match was exactly
 * this shape — a wrapper and a script disagreeing about their interface, with
 * no third thing holding them to it.
 *
 * `memberships` and `leave` (2026-09-01) made it three verbs to keep in step
 * across three files, which is the point at which remembering stops being a
 * plan.
 *
 * WHAT THIS DOES NOT CLAIM: that any verb works. It cannot run one — that needs
 * the owner connection to a live database, which is the whole reason these are
 * scripts. It claims only that every verb offered can be dispatched and every
 * verb implemented can be found, which is the half a half-finished addition
 * gets wrong.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

const WRAPPER = read('deploy/compose/operator.sh');
const SCRIPT = read('apps/api/src/scripts/operator.ts');
const API_PACKAGE = JSON.parse(read('apps/api/package.json')) as {
  scripts: Record<string, string>;
};

/** The verbs the wrapper puts in front of somebody, in either of its two lists. */
const advertised = new Set(
  [...WRAPPER.matchAll(/operator\.sh (?<verb>[a-z]+)/g)].map((m) => m.groups!.verb!),
);

/** The verbs `operator.ts` actually implements. */
const implemented = new Set(
  [...SCRIPT.matchAll(/^ {6}case '(?<verb>[a-z]+)': \{$/gm)].map((m) => m.groups!.verb!),
);

/** The verbs `pnpm --filter @openmig/api operator:<verb>` can reach. */
const dispatchable = new Set(
  Object.keys(API_PACKAGE.scripts)
    .filter((name) => name.startsWith('operator:'))
    .map((name) => name.slice('operator:'.length)),
);

describe('operator.sh, package.json and operator.ts agree on one set of verbs', () => {
  it('found verbs in all three places at all', () => {
    // The guard that keeps the three below from passing vacuously the day a
    // regex stops matching — an empty set is a subset of everything.
    expect(advertised.size, 'no verbs found in operator.sh').toBeGreaterThan(3);
    expect(implemented.size, 'no `case` verbs found in operator.ts').toBeGreaterThan(3);
    expect(dispatchable.size, 'no operator:* scripts in apps/api/package.json').toBeGreaterThan(3);
  });

  it('every verb the wrapper offers can be dispatched by pnpm', () => {
    for (const verb of advertised) {
      expect(
        dispatchable.has(verb),
        `operator.sh offers \`${verb}\`, and apps/api/package.json has no ` +
          `"operator:${verb}" script.\n\n` +
          'The wrapper dispatches by building the script name, so running it ' +
          'fails with\npnpm\'s `Command "operator:' +
          verb +
          '" not found` — which reads like a\nbroken install rather than a ' +
          'missing line here.',
      ).toBe(true);
    }
  });

  it('every dispatchable verb is implemented rather than answered with USAGE', () => {
    for (const verb of dispatchable) {
      expect(
        implemented.has(verb),
        `apps/api/package.json defines "operator:${verb}", and operator.ts has ` +
          `no \`case '${verb}'\`.\n\n` +
          "It reaches the switch's `default:` and prints the list of commands " +
          'in\nanswer to running one of them.',
      ).toBe(true);
    }
  });

  it('every implemented verb is advertised where somebody will find it', () => {
    for (const verb of implemented) {
      expect(
        advertised.has(verb),
        `operator.ts implements \`${verb}\` and deploy/compose/operator.sh never ` +
          'names it.\n\nA command nobody can find is a command nobody has.',
      ).toBe(true);
    }
  });

  it('the FATAL block a bare run prints lists them all', () => {
    // The header is read by whoever opens the file; this is what reaches the
    // person who ran the wrapper with no arguments, which is the ordinary way
    // of asking it what it does.
    const from = WRAPPER.indexOf('FATAL: no sub-command');
    expect(from, 'the bare-run refusal is gone').toBeGreaterThan(0);
    const fatal = WRAPPER.slice(from, WRAPPER.indexOf('exit 1', from));
    for (const verb of implemented) {
      expect(
        fatal.includes(`operator.sh ${verb}`),
        `running operator.sh with no arguments does not mention \`${verb}\`.`,
      ).toBe(true);
    }
  });
});
