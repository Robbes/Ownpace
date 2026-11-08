// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DEPLOY A DROPPED CONNECTION COULD STOP (live's deploy of 2026-11-08; workplan 0132 T6).
 *
 * The owner deployed `v0.2.0-alpha.6` to live from a phone, and ran
 * `deploy-live.sh` inside `tmux` (0132's Status, 2026-11-08). That deploy
 * moved the identity provider's pin, so the script called it one-way: once
 * the new version has run, the way back is the copy the deploy took, not
 * another deploy (`docs/managed-bring-up.md`, step 3). A connection that drops
 * hangs up the shell, and the script with it, wherever it is: the script sets
 * no trap for it, and a run stopped halfway is the one case the copy exists
 * for. Nothing in the repository said to start it where it outlives the
 * connection; that was the owner's habit, and a habit is not a step.
 *
 * ## What this holds
 *
 * Step 4 of *`ownpace-live`: a release tag, with `deploy-live.sh`*, the one
 * place the guide runs the deploy, starts it inside `tmux` (or `screen`),
 * before the line that runs it, and says why: a dropped connection, and a
 * deploy that is one-way. Take the sentence out, or move the advice below
 * the command, and this fails.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUIDE = 'docs/managed-bring-up.md';
const SECTION = '### `ownpace-live`: a release tag, with `deploy-live.sh`';
const RUN = './deploy/compose/deploy-live.sh <tag>';

/** Step 4 of the live deploy: from its "4." to its "5.", inside the section. */
function stepFour(): string {
  const guide = readFileSync(join(REPO_ROOT, GUIDE), 'utf8');
  const at = guide.indexOf(SECTION);
  expect(at, `${GUIDE} has no section "${SECTION}"`).toBeGreaterThan(0);
  const section = guide.slice(at);
  const start = section.search(/^4\. /m);
  const end = section.search(/^5\. /m);
  expect(start, 'the section has no step 4').toBeGreaterThan(0);
  expect(end, 'the section has no step 5 after step 4').toBeGreaterThan(start);
  return section.slice(start, end);
}

describe('the live deploy runs where a dropped connection cannot stop it', () => {
  it('step 4 starts the run inside tmux or screen, before the line that runs it', () => {
    const step = stepFour();
    expect(step, 'step 4 no longer runs the deploy').toContain(RUN);
    const advice = step.search(/inside `tmux` \(or `screen`\)/);
    expect(advice, 'step 4 does not say to run the deploy inside tmux or screen').toBeGreaterThanOrEqual(0);
    expect(advice, 'the advice comes after the command it is about').toBeLessThan(step.indexOf(RUN));
    expect(step, 'step 4 starts no tmux session before the run').toMatch(/tmux new -s \S+[^\n]*\n\s*\.\/deploy\/compose\/deploy-live\.sh <tag>/);
  });

  it('and says why: a dropped connection stops it, and the deploy can be one-way', () => {
    const step = stepFour();
    expect(step, 'step 4 does not say what a dropped connection does').toMatch(/connection[\s\S]{0,80}drop/);
    expect(step, 'step 4 does not say the deploy can be one-way').toMatch(/one-way/);
    expect(step, 'step 4 does not say how to see the run again').toMatch(/tmux attach/);
  });
});
