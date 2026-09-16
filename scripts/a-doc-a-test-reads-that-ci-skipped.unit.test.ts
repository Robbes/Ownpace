// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOC A TEST READS, ON A PATH CI SKIPS THE TESTS FOR.
 *
 * `detect-changes` skips lint and the whole test suite for docs-only changes,
 * and that is right for almost every document here: workplans, ADRs and
 * architecture notes are read by nobody but people, and running a nine-minute
 * suite over a prose commit buys no assertion.
 *
 * **It is wrong for three families**, and this file said "exactly one" until
 * 2026-09-16, when the second one went red on main. All three are documents
 * that a test READS, which makes them code's business however much they look
 * like prose:
 *
 *   1. `docs/*-setup.md` — `end-user-docs.unit.test.tsx` reads them through the
 *      same `import.meta.glob` the customer-facing `/docs` page uses, and
 *      asserts they cite no workplan, no ADR and no edition aside, because a
 *      customer cannot open any of those.
 *   2. `docs/LESSONS.md` — `lessons.unit.test.ts` compares it against a fresh
 *      regeneration. It is build output; a stale copy is a red guard.
 *   3. `docs/adr/*.md` — `adr-operative.unit.test.ts` assembles `OPERATIVE.md`
 *      from every ADR's own `## Operative rules` block. Editing that block
 *      without regenerating is a red guard, and an ADR edit is prose-shaped.
 *
 * Observed 2026-09-04 on PR #772: `apple-setup.md` cited three workplans, the
 * guard was red, the change was docs-only, and `ci-complete` reported success.
 * The failure surfaced a branch later, on a commit that happened to touch a
 * `.ts` file — which is to say it surfaced by luck, and on the wrong PR.
 *
 * Observed again 2026-09-16, on family (2), and worse. #968 and #969 each added
 * a guard and each regenerated `LESSONS.md` against a base without the other,
 * so main landed on a count of 133 against 134 guard files and CI run #2654
 * went red. The one-line fix could not prove itself either: THAT pull request
 * was docs-only, so the suite containing the drift guard was skipped on it too.
 * Family (3) had not fired yet — #966 and #967 both edited ADRs and regenerated
 * `OPERATIVE.md` with their code lanes skipped, and were simply correct.
 *
 * ## What this holds
 *
 * That every glob the customer-guide test reads is covered by a pattern in the
 * filter. Not that the two strings match — they are different languages, and
 * demanding they be identical would be a test of spelling. It resolves the
 * glob to REAL FILES and asks whether the filter would have selected each one,
 * so the assertion survives either side being rewritten in its own idiom.
 *
 * ## Why text rather than a shared constant
 *
 * A GitHub Actions filter cannot import from TypeScript, so there is nothing
 * to share. Two files have to agree, in two syntaxes, and the only thing that
 * can hold them together is a test that reads both. This file is at the
 * repository root for the same reason `a-kind-with-nowhere-to-live` is:
 * workspace imports do not resolve here, and what it reads is a workflow.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The globs the web app's own test reads documents through. */
function guideGlobsTheTestReads(): ReadonlyArray<string> {
  const test = readFileSync(
    join(REPO_ROOT, 'apps/web/src/pages/end-user-docs.unit.test.tsx'),
    'utf8',
  );
  // `import.meta.glob('../../../../docs/*-setup.md', …)` — captured from the
  // call rather than restated, so a widened glob widens this test with it.
  const globs = [...test.matchAll(/import\.meta\.glob\(\s*'([^']+)'/g)].map((m) => m[1]!);
  expect(
    globs.length,
    'end-user-docs.unit.test.tsx no longer globs anything — either it was rewritten, in ' +
      'which case this guard needs rewriting with it, or the documents it asserted on are ' +
      'now unasserted',
  ).toBeGreaterThan(0);
  return globs;
}

/** The patterns `detect-changes` selects on, from the workflow itself. */
function filterPatterns(): ReadonlyArray<string> {
  const yml = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
  // The first `files: |` block scalar is detect-changes'. Its lines are
  // patterns; a `#` line there is a PATTERN, which is why the workflow keeps
  // its comments outside the block — and why this reads until the indent ends.
  const start = yml.indexOf('files: |');
  expect(start, 'ci.yml has no `files: |` block — detect-changes was restructured').toBeGreaterThan(-1);
  const lines = yml.slice(start).split('\n').slice(1);
  const out: string[] = [];
  for (const line of lines) {
    if (!/^\s{12}\S/.test(line)) break;
    out.push(line.trim());
  }
  return out;
}

/** Would any filter pattern select this repo-relative path? */
function selectedBy(patterns: ReadonlyArray<string>, path: string): boolean {
  return patterns.some((p) => {
    // The two forms this filter actually uses: `**.md`-style suffix matches,
    // and directory prefixes. Deliberately not a general glob engine — a
    // hand-rolled one would be the third thing that can be wrong.
    if (p.startsWith('**')) return path.endsWith(p.slice(2));
    if (p.endsWith('/**')) return path.startsWith(p.slice(0, -2));
    if (p.includes('*')) {
      const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
      return re.test(path);
    }
    return p === path;
  });
}

/** Documents read by a test that are named directly rather than globbed. */
const DIRECTLY_READ: ReadonlyArray<{ readonly path: string; readonly reader: string }> = [
  { path: 'docs/LESSONS.md', reader: 'scripts/lessons.unit.test.ts' },
  // One real ADR, not a pattern: the question is whether the filter selects an
  // ADR at all, and naming a file that exists keeps the assertion honest.
  {
    path: 'docs/adr/0046-a-rendering-is-compared-by-its-parts.md',
    reader: 'scripts/adr-operative.unit.test.ts',
  },
];

describe('a document a test reads is not a docs-only change', () => {
  it('every document read by name is on a path CI runs tests for', () => {
    const patterns = filterPatterns();
    for (const { path, reader } of DIRECTLY_READ) {
      expect(
        readdirSync(join(REPO_ROOT, dirname(path))).includes(path.split('/').pop()!),
        `${path} does not exist — this guard names it because ${reader} reads it`,
      ).toBe(true);
      expect(
        selectedBy(patterns, path),
        `${path} is read by ${reader}, but no detect-changes pattern selects it. A docs-only ` +
          'change to it will SKIP the unit suite, so the guard that reads it cannot go red ' +
          'and ci-complete will report success over a broken one. Add a pattern covering it ' +
          'to the `files:` block in .github/workflows/ci.yml.',
      ).toBe(true);
    }
  });

  it('every customer guide the web test globs is on a path CI runs tests for', () => {
    const patterns = filterPatterns();
    const globs = guideGlobsTheTestReads();

    // Resolve each glob to the documents that exist NOW: a rule about paths is
    // only worth as much as the files it currently selects, and a new guide
    // dropped into docs/ is exactly the case that must not slip through.
    const guides = globs.flatMap((glob) => {
      const [, tail] = glob.split('docs/');
      expect(tail, `glob '${glob}' does not point into docs/ — this guard assumes it does`).toBeDefined();
      const suffix = tail!.replace('*', '');
      return readdirSync(join(REPO_ROOT, 'docs'))
        .filter((f) => f.endsWith(suffix))
        .map((f) => `docs/${f}`);
    });

    expect(guides.length, 'the glob matched no documents at all').toBeGreaterThan(0);

    for (const guide of guides) {
      expect(
        selectedBy(patterns, guide),
        `${guide} is read by end-user-docs.unit.test.tsx, but no detect-changes pattern ` +
          'selects it. A docs-only change to it will SKIP the unit suite, so the guard that ' +
          'reads it cannot go red and ci-complete will report success over a broken guide. ' +
          `Add a pattern covering it to the \`files:\` block in .github/workflows/ci.yml.`,
      ).toBe(true);
    }
  });

  it('the skip still exists for documents nothing reads', () => {
    // The control. If this ever goes red, somebody widened the filter to
    // `docs/**` and every prose commit now pays for the full suite — which is
    // the cost the narrow rule above exists to avoid.
    const patterns = filterPatterns();
    expect(
      selectedBy(patterns, 'docs/workplans/0115-the-account-apple-will-not-hand-over.md'),
      'the filter now selects workplans, so every prose commit runs the whole suite for no ' +
        'assertion. The rule is meant to be narrow: a doc a TEST reads, and nothing else.',
    ).toBe(false);
    expect(selectedBy(patterns, 'docs/architecture/solution-architecture.md')).toBe(false);
    // ADRs were on this list until 2026-09-16 and have moved to the other one.
    // Not a widening of the rule — a correction of a fact: `adr-operative.mjs`
    // assembles OPERATIVE.md from every ADR's `## Operative rules` block, so an
    // ADR edit can break a guard. It always could; nobody had re-checked.
    expect(selectedBy(patterns, 'docs/adr/0041-who-owns-the-oauth-client.md')).toBe(true);
  });
});
