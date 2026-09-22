// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A THIRD-PARTY ACTION, REFERENCED BY SOMETHING ITS PUBLISHER CAN REWRITE.
 *
 * Every `uses:` in this repository is pinned to a 40-character commit SHA and
 * carries the version it was at in a comment. All fifteen of them, today,
 * without a guard ever having asked — which is the state a rule is in just
 * before it quietly stops being true.
 *
 * ## Why a tag is not a version
 *
 * `actions/checkout@v7` is not a version. It is a NAME the publisher can point
 * anywhere, at any time, and a workflow re-resolves it on every run. There is
 * no lockfile for `uses:`, no integrity hash, and no equivalent of
 * `--frozen-lockfile`: the tag is the whole reference.
 *
 * `tj-actions/changed-files` — used by `detect-changes` in ci.yml, twice — is
 * the reason this is not hypothetical. In March 2025 it was compromised and
 * its version tags were repointed at a commit that dumped CI secrets into the
 * build log. Consumers who had written a TAG ran the attacker's code on their
 * next build. Consumers who had written a SHA did not, and needed to do
 * nothing at all. That is the entire difference, and it is available for the
 * price of forty characters.
 *
 * ## Why this repository in particular
 *
 * `pnpm-workspace.yaml` already sets `minimumReleaseAge` against exactly this
 * threat, and says so at length: "A package published in the last few days is
 * the shape a compromised publish takes." That reasoning is about npm, and it
 * applies HARDER here. An npm dependency is at least frozen by a lockfile
 * between installs and held behind a three-day window; a tag is re-read every
 * run and has neither. And some of these jobs are not cheap to own — the
 * security workflow runs with `security-events: write` and, on a tag,
 * `contents: write` to attach the release SBOM.
 *
 * So the repository has decided this threat matters, paid for a defence on the
 * npm side, and had nothing holding the side where the window is zero.
 *
 * ## What this holds
 *
 * That every `uses:` is a commit SHA or a path inside this repository, and
 * that every pin says which version it is — because a bare SHA is a string
 * nobody can review, and the comment is what makes a bump legible in a diff.
 *
 * It reads the workflows twice, once parsed and once as text, and fails if the
 * two disagree about how many `uses:` there are. The parse is authoritative
 * about what actually runs; the text is the only place the comment survives.
 * Either alone could quietly stop seeing a step.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const WORKFLOWS = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');

/** A commit, not a name: forty hex characters and nothing else. */
const SHA_PINNED = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;
/** `# v7.0.1`, `# v0.36.0` — the version the SHA was, for a human reading a diff. */
const SAYS_ITS_VERSION = /#\s*v?\d+\.\d+/;

function workflowFiles(): ReadonlyArray<string> {
  return readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
}

interface Step {
  readonly uses?: unknown;
}
interface Job {
  readonly uses?: unknown;
  readonly steps?: ReadonlyArray<Step>;
}

/**
 * Every `uses:` a workflow actually runs, from the parsed document.
 *
 * Both places one can appear: a step inside a job, and a job that IS a call to
 * a reusable workflow. Parsed rather than grepped so a commented-out line is
 * not mistaken for one that runs.
 */
function actionsUsed(file: string): ReadonlyArray<string> {
  const doc = parseYaml(readFileSync(join(WORKFLOWS, file), 'utf8')) as {
    jobs?: Record<string, Job>;
  };
  return Object.values(doc.jobs ?? {}).flatMap((job) => [
    ...(typeof job?.uses === 'string' ? [job.uses] : []),
    ...(job?.steps ?? []).flatMap((s) => (typeof s?.uses === 'string' ? [s.uses] : [])),
  ]);
}

/** Every `uses:` LINE, with the rest of the line, because YAML throws comments away. */
function usesLines(file: string): ReadonlyArray<string> {
  return readFileSync(join(WORKFLOWS, file), 'utf8')
    .split('\n')
    .filter((l) => /^\s*-?\s*uses:\s*\S/.test(l))
    .map((l) => l.trim());
}

describe('an action is pinned to a commit, not to a name its publisher owns', () => {
  const files = workflowFiles();

  it('reads real workflows with real steps — this guard is not passing vacuously', () => {
    expect(files.length, 'no workflow files at all').toBeGreaterThan(3);
    const used = files.flatMap((f) => actionsUsed(f));
    expect(
      used.length,
      'the parse found almost no `uses:` at all, which is not what this directory looks like — ' +
        'every assertion below would be passing over an empty list',
    ).toBeGreaterThan(10);
  });

  it('pins every action to a 40-character commit SHA', () => {
    const unpinned = files.flatMap((file) =>
      actionsUsed(file)
        // A path into this repository is our own code, versioned by the commit
        // being built. There is no third party to pin against.
        .filter((spec) => !spec.startsWith('./') && !SHA_PINNED.test(spec))
        .map((spec) => `${file}: ${spec}`),
    );
    expect(
      unpinned,
      'these reference an action by a tag or branch, which the publisher can repoint at any ' +
        'time — there is no lockfile for `uses:` and the reference is re-read on every run. ' +
        'That is how tj-actions/changed-files, used by detect-changes in ci.yml, reached ' +
        'everyone pinned by tag in March 2025, and did not reach anyone pinned by SHA. ' +
        'Replace each with the commit the tag points at, and put the version in a comment.',
    ).toEqual([]);
  });

  it('says which version each SHA is, so a bump is legible in a diff', () => {
    const silent = files.flatMap((file) =>
      usesLines(file)
        .filter((line) => !line.includes('./') && !SAYS_ITS_VERSION.test(line))
        .map((line) => `${file}: ${line}`),
    );
    expect(
      silent,
      'these pin a SHA and do not say what it is. Forty hex characters are unreviewable — a ' +
        'reader cannot tell an upgrade from a downgrade from a hijack. Add `# v1.2.3` after it.',
    ).toEqual([]);
  });

  it('the parse and the text agree, so neither is quietly missing a step', () => {
    // The parse knows what RUNS; the text is the only place the comment above
    // survives. If they ever disagree, one of them has stopped seeing
    // something and the assertion it backs has gone soft.
    for (const file of files) {
      expect(
        usesLines(file).length,
        `${file}: the YAML parse and a line scan disagree about how many \`uses:\` it has`,
      ).toBe(actionsUsed(file).length);
    }
  });
});
