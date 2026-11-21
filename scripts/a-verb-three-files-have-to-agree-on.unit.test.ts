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
 *
 * ONE VERB IS THE WORKER'S (workplan 0164 T1). `measure-google-sync` is a
 * command of the worker's CLI, `apps/worker/src/cli/index.ts`, and the wrapper
 * hands it there with `exec node` before the pnpm line, on the same owner
 * connection. The same handshake holds for it with the worker's CLI as the
 * third file: offered in both lists, dispatched before the API's line, and run
 * by the CLI it is handed to. A verb the wrapper hands the worker and the CLI
 * does not know reaches the CLI's `default:` and prints its list of commands.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

const WRAPPER = read('deploy/compose/operator.sh');
const SCRIPT = read('apps/api/src/scripts/operator.ts');
const WORKER_CLI = read('apps/worker/src/cli/index.ts');
const API_PACKAGE = JSON.parse(read('apps/api/package.json')) as {
  scripts: Record<string, string>;
};

/** The verbs the wrapper puts in front of somebody, in either of its two lists. */
const advertised = new Set(
  [...WRAPPER.matchAll(/operator\.sh (?<verb>[a-z]+(?:-[a-z]+)*)/g)].map((m) => m.groups!.verb!),
);

/** The line that hands a verb to the worker's CLI instead of to pnpm. */
const TO_THE_WORKER = 'exec node "$REPO_ROOT/apps/worker/src/cli/index.ts" "$@"';

/** The verbs the wrapper hands to the worker's CLI: an `if` on the verb, then that line. */
const handedToTheWorker = new Set(
  [...WRAPPER.matchAll(/^if \[ "\$1" = "(?<verb>[a-z]+(?:-[a-z]+)*)" \]; then\n(?<body>(?: {2}.*\n)+?)fi$/gm)]
    .filter((m) => m.groups!.body!.includes(TO_THE_WORKER))
    .map((m) => m.groups!.verb!),
);

/** The commands the worker's CLI runs: its `case` labels and the ones it asks for by name. */
const workerRuns = new Set([
  ...[...WORKER_CLI.matchAll(/^ {4}case '(?<verb>[a-z-]+)': \{$/gm)].map((m) => m.groups!.verb!),
  ...[...WORKER_CLI.matchAll(/command === '(?<verb>[a-z-]+)'/g)].map((m) => m.groups!.verb!),
]);

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
    expect(handedToTheWorker.size, "no verb is handed to the worker's CLI").toBeGreaterThan(0);
    expect(workerRuns.size, "no commands found in the worker's CLI").toBeGreaterThan(3);
  });

  it('every verb the wrapper offers can be dispatched by pnpm', () => {
    for (const verb of advertised) {
      if (handedToTheWorker.has(verb)) continue;
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
    for (const verb of [...implemented, ...handedToTheWorker]) {
      expect(
        fatal.includes(`operator.sh ${verb}`),
        `running operator.sh with no arguments does not mention \`${verb}\`.`,
      ).toBe(true);
    }
  });

  it("every verb handed to the worker's CLI is offered, comes before the API's line, and is run there", () => {
    const apiLine = WRAPPER.indexOf('--filter @openmig/api "operator:$1"');
    expect(apiLine, "the API's dispatch line is gone").toBeGreaterThan(0);
    for (const verb of handedToTheWorker) {
      expect(advertised.has(verb), `operator.sh hands \`${verb}\` to the worker and never names it.`).toBe(true);
      expect(
        WRAPPER.indexOf(`if [ "$1" = "${verb}" ]; then`),
        `\`${verb}\` is handed to the worker after the API's line, so pnpm is asked for it first.`,
      ).toBeLessThan(apiLine);
      expect(
        workerRuns.has(verb),
        `operator.sh hands \`${verb}\` to apps/worker/src/cli/index.ts, which does not run it: it reaches ` +
          "the CLI's `default:` and prints its list of commands.",
      ).toBe(true);
    }
  });
});
