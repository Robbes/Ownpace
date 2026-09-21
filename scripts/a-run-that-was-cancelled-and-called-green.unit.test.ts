// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RUN THAT WAS CANCELLED, AND A GREEN TICK OVER THE TREE IT WAS TESTING.
 *
 * `concurrency: cancel-in-progress` is right on a pull request and wrong on a
 * push, and the two look identical.
 *
 * On a PULL REQUEST a new commit makes the running build obsolete — the older
 * commit is not what will merge, and nobody will ever ask what it said.
 * Cancelling is free.
 *
 * On a PUSH to `main` the superseded commit is not obsolete. **It is in
 * `main`.** Cancelling its build means nothing ever runs the gates for the
 * code it carried, because `detect-changes` on the NEXT push computes changed
 * files from THAT push's diff alone — not from everything since the last
 * completed run.
 *
 * ## What it did, 2026-09-21
 *
 * #1054 merged at 21:32 carrying a change to `ci.yml` and a new guard. #1055
 * merged at 21:43 carrying one paragraph of prose. Run **2841** was eleven
 * minutes into the suite on the Spark and was cancelled where it stood. Run
 * **2843** read its own diff — one `.md` file — skipped `lint`, `unit-tests`,
 * `ui-tests`, `migration-lint` and `integration-tests`, and concluded success
 * in four and a half minutes.
 *
 * `main` then carried a green tick over a tree whose tests had not run. The
 * suite was in fact green — it was run by hand to find out, which is the part
 * that should never be necessary. And nothing lied: `ci-complete` named every
 * skipped gate in its summary, exactly as it is built to. The composition did.
 *
 * Any code merge followed within a build's length by a docs-only merge
 * reproduces it. That is not a rare shape; it is two ordinary merges.
 *
 * ## What this holds
 *
 * The PROPERTY, not the spelling: that `cancel-in-progress` is false when the
 * event is `push` and true when it is `pull_request`. It reads the workflow,
 * takes whatever expression is there and evaluates it for both events, so the
 * assertion survives the condition being rewritten in another form.
 *
 * It FAILS CLOSED. An expression this file cannot read is a failure, not a
 * pass — a guard that shrugs at what it does not understand is the same green
 * tick over an unknown tree that it exists to prevent.
 *
 * It also holds the `group`, because the flag is only half the mechanism: the
 * two events are kept apart by `github.ref` (`refs/pull/N/merge` against
 * `refs/heads/main`). A group that stopped varying with the ref would put pull
 * request and push runs in one bucket, where a pull request could cancel a
 * push build and this file's first test would still pass.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const workflow = parseYaml(readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')) as {
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean | string };
};

/**
 * Would this `cancel-in-progress` cancel a running build, for this event?
 *
 * A deliberately tiny evaluator: the two literals, and one comparison against
 * `github.event_name`. Anything else THROWS rather than guessing — see the
 * note on failing closed above. If a future condition needs more than this,
 * the workflow and this evaluator are changed together, which is the point at
 * which somebody re-reads what the flag is for.
 */
function cancelsFor(flag: boolean | string | undefined, eventName: string): boolean {
  if (typeof flag === 'boolean') return flag;
  if (typeof flag !== 'string') {
    throw new Error(
      `ci.yml has no concurrency.cancel-in-progress (got ${JSON.stringify(flag)}). If the ` +
        'concurrency block was removed, nothing cancels anything and this guard needs ' +
        'rewriting; if it moved, point this at its new home.',
    );
  }
  const body = /^\$\{\{(.+)\}\}$/.exec(flag.trim())?.[1]?.trim() ?? flag.trim();
  if (body === 'true') return true;
  if (body === 'false') return false;
  const comparison = /^github\.event_name\s*(==|!=)\s*'([a-z_]+)'$/.exec(body);
  if (!comparison) {
    throw new Error(
      `this guard cannot read the condition \`${flag}\`. It understands \`true\`, \`false\` and ` +
        'one comparison against `github.event_name`, and it refuses to guess at anything else ' +
        'rather than pass over a condition nobody has checked. Widen `cancelsFor` in the same ' +
        'change that widened the workflow.',
    );
  }
  const [, operator, wanted] = comparison;
  return operator === '==' ? eventName === wanted : eventName !== wanted;
}

describe('a superseded push build is finished, not cancelled', () => {
  const flag = workflow.concurrency?.['cancel-in-progress'];

  it('never cancels a push build, whatever lands on main behind it', () => {
    expect(
      cancelsFor(flag, 'push'),
      'ci.yml would cancel a running push build. The commit it was testing is already IN main, ' +
        'and the next push computes its own diff — so nothing re-runs the gates for the code ' +
        'the cancelled build carried, and a later docs-only merge reports green over it. That ' +
        'is run 2841 against run 2843 on 2026-09-21. Condition `cancel-in-progress` on the ' +
        'event instead of setting it true.',
    ).toBe(false);
  });

  it('still cancels a superseded pull request build', () => {
    expect(
      cancelsFor(flag, 'pull_request'),
      'ci.yml no longer cancels superseded pull request builds. Nothing is unsafe about that, ' +
        'but it is waste this repository had already decided against: the older commit is not ' +
        'what will merge. If it was deliberate, delete this test and say why.',
    ).toBe(true);
  });

  it('keeps pull request and push builds in different groups', () => {
    // The other half of the mechanism. One bucket for both events would let a
    // pull request cancel a push build while the test above still passed.
    expect(
      workflow.concurrency?.group ?? '',
      'the concurrency group no longer varies with github.ref, so pull request and push builds ' +
        'share one bucket and can cancel each other regardless of the flag above',
    ).toContain('github.ref');
  });
});
