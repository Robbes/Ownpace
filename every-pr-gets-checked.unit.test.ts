// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A pull request cannot be opened into a state where nothing runs.
 *
 * `every-pr-check-is-classified.unit.test.ts` asks whether each check a pull
 * request produces is required or not. This one asks the question underneath
 * it: **is the check reachable at all.** A trigger filter answers that, and it
 * answers it silently.
 *
 * ## What went wrong
 *
 * `ci.yml`, `no-committed-artifacts.yml` and `security-scan.yml` all carried
 * `pull_request: branches: [main]`. So a pull request whose BASE was any other
 * branch produced **no checks whatsoever** — not failing checks, none.
 *
 * That is not the harmless case it sounds like. On 2026-08-23, #501 was opened
 * against another feature branch so its diff would show only its own commits.
 * It reported zero checks. Had it stayed that way, the branch underneath would
 * have merged, GitHub would have retargeted it to `main` — and a retarget fires
 * `pull_request.edited`, which is NOT in the default activity set, so still
 * nothing would have run. The end state is a pull request to `main` with four
 * required contexts that can never be reported: "Expected — waiting for status
 * to be reported", nothing in Actions to point at, and re-running fixes
 * nothing. Only a fresh push escapes.
 *
 * `every-pr-check-is-classified` already describes exactly this failure for
 * `images.yml`'s `paths:` filter, and calls it worse than a check that fails.
 * The same hazard sat on the `branches:` axis and nothing was watching it.
 *
 * ## Why a `paths:` filter is still allowed and a `branches:` one is not
 *
 * They are not the same bet. `paths:` says "this check is about these files",
 * and a workflow it skips is one whose subject the pull request did not touch —
 * so the honest response is to leave it out of branch protection, which is what
 * `NOT_REQUIRABLE` does for `build`. `branches:` says "this check is about
 * these TARGETS", which is a claim about where a change is going rather than
 * what it is, and no amount of classification rescues a required context that
 * a legitimate pull request can never report.
 *
 * So `paths:` is a documented trade with a recorded cost. `branches:` on a
 * `pull_request` trigger is refused outright.
 *
 * ## What this cannot do
 *
 * Branch protection lives in GitHub's settings, not the repo, so this cannot
 * read which contexts are actually required — same limitation its sibling
 * records. It asserts that every PR-triggered workflow is reachable from any
 * base; whether the resulting checks are gated is the sibling's question.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const WORKFLOW_DIR = fileURLToPath(new URL('./.github/workflows/', import.meta.url));

interface Workflow {
  readonly on?: unknown;
}

const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

/**
 * `on` is a YAML 1.1 boolean, so some parsers key this map under `true` rather
 * than the string. Read both, for the reason its sibling gives: a parser
 * default change must surface as a failure here rather than as this test
 * finding no triggers and passing vacuously.
 */
function triggersOf(wf: Workflow): Record<string, unknown> {
  const on = wf.on ?? (wf as Record<string, unknown>)['true'];
  if (typeof on === 'string') return { [on]: {} };
  if (Array.isArray(on)) return Object.fromEntries(on.map((k) => [String(k), {}]));
  return (on ?? {}) as Record<string, unknown>;
}

/** Every workflow with a `pull_request` trigger, and what that trigger filters on. */
const prTriggered = files.flatMap((file) => {
  const wf = parse(readFileSync(WORKFLOW_DIR + file, 'utf8')) as Workflow;
  const triggers = triggersOf(wf);
  if (!('pull_request' in triggers)) return [];
  const pr = triggers.pull_request;
  const config = (pr && typeof pr === 'object' ? pr : {}) as Record<string, unknown>;
  return [{ file, keys: Object.keys(config) }];
});

describe('a pull request always produces the checks it will be judged on', () => {
  it('found real workflows with real pull_request triggers', () => {
    // The vacuity guard. Every assertion below is trivially true against an
    // empty list, and an empty list is exactly what a broken `on:` parse or a
    // wrong directory produces.
    expect(files.length, `no workflow files under ${WORKFLOW_DIR}`).toBeGreaterThan(3);
    expect(
      prTriggered.map((w) => w.file),
      'no pull_request-triggered workflow found — check `on:` parsing',
    ).toContain('ci.yml');
    expect(prTriggered.length, 'expected several PR-triggered workflows').toBeGreaterThan(2);
  });

  it('never filters a pull_request trigger by target branch', () => {
    // The whole point. A base other than `main` must not silence a workflow —
    // see this file's header for what that costs.
    const filtered = prTriggered.filter((w) => w.keys.includes('branches'));
    expect(
      filtered.map((w) => w.file),
      'these workflows filter their pull_request trigger by base branch, so a PR ' +
        'targeting anything else reports no check at all — which wedges a required ' +
        'context rather than failing it',
    ).toEqual([]);
  });

  it('does not filter by branches-ignore either', () => {
    // The same hazard spelled the other way round. Asserted separately so the
    // failure message names the actual key somebody reached for.
    const filtered = prTriggered.filter((w) => w.keys.includes('branches-ignore'));
    expect(filtered.map((w) => w.file), 'same problem as `branches:`, inverted').toEqual([]);
  });

  it('leaves the push trigger alone — that one is a different question', () => {
    // `push: branches: [main]` is correct and must not be "fixed" by a later
    // reading of this file: it decides which branches deserve a build after the
    // fact, and it is also what keeps every other branch off the self-hosted
    // runner (`runs-on` keys on `github.event_name == 'push'`).
    const ci = parse(readFileSync(WORKFLOW_DIR + 'ci.yml', 'utf8')) as Workflow;
    const push = triggersOf(ci).push as { branches?: string[] } | undefined;
    expect(push?.branches, 'ci.yml must still restrict which branches build on push').toEqual([
      'main',
    ]);
  });
});
