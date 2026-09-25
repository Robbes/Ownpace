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
 *   1. The customer guides — `end-user-docs.unit.test.tsx` reads them through
 *      the same `import.meta.glob` the customer-facing `/docs` page uses, and
 *      asserts they cite no workplan, no ADR and no edition aside, because a
 *      customer cannot open any of those. They were `docs/*-setup.md` until
 *      workplan 0148 T1 moved the customer half to `docs/guides/<locale>/`,
 *      a folder below `docs/` that `docs/*.md` does not select: so the filter
 *      names `docs/guides/**`, and the glob case below resolves a nested glob
 *      instead of a suffix of a file directly in `docs/`.
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
 * ## 2026-09-21: the list stopped being kept by hand
 *
 * Three families, found one at a time, each after it bit. That is what a
 * remembered list buys you, and it is worth being exact about the price: this
 * guard was correct about every document it named and could not see a fourth.
 *
 * Scanning all 758 test files for the paths they actually READ found FIFTEEN
 * more that the filter did not select. Not edge cases —
 * `packages/shared/src/feature-matrix.unit.test.ts` asserts that
 * `docs/feature-matrix.md` names every source and target kind the create API
 * accepts; three guards in `scripts/` read `docs/managed-bring-up.md`; three
 * more read `README.md`; `after-cutover-the-source-is-not-the-authority`
 * asserts a workplan still records `TAKEN 2026-09-09`. Each was #772 sitting
 * open, waiting for a prose commit to land on it.
 *
 * The workplan is the sharpest of them, because the control at the bottom of
 * this file asserted — correctly, as a rule — that workplans are not selected,
 * while one workplan was being read by a test. The rule is still right and the
 * control still stands on `0115`, which nothing reads; the filter now names
 * that ONE workplan rather than `docs/workplans/**`, so the 117 nobody reads
 * still cost nothing.
 *
 * So the list is now DERIVED. `filesTestsRead()` discovers what the tests
 * read; the assertion is over that set, not over what somebody remembered to
 * write down. The sixteenth fails on its own pull request.
 *
 * ## What this holds
 *
 * That every file a test reads — discovered from the tests, in the four idioms
 * this repository reads files through — is covered by a pattern in the filter.
 * And that every glob the customer-guide test reads is covered too. Not that
 * the strings match: they are different languages, and demanding they be
 * identical would be a test of spelling. Both resolve to REAL FILES and ask
 * whether the filter would have selected each one, so the assertion survives
 * either side being rewritten in its own idiom.
 *
 * A discovering guard can fail in one way a listing guard cannot — break the
 * scanner and it finds nothing, which reads exactly like success. `ANCHORS`
 * and a floor on the count are the answer to that: the first test below fails
 * if the scan stops seeing a read that exists today.
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
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The globs the web app's own test reads documents through. */
function guideGlobsTheTestReads(): ReadonlyArray<string> {
  const test = readFileSync(
    join(REPO_ROOT, 'apps/web/src/pages/end-user-docs.unit.test.tsx'),
    'utf8',
  );
  // `import.meta.glob('../../../../docs/guides/*/*.md', …)` — captured from
  // the call rather than restated, so a widened glob widens this test with it.
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

/**
 * A Vite glob as a regular expression over repo-relative paths: `*` is one
 * path segment's worth, `**` any number of folders. The two forms the web
 * test's globs use, and nothing else a glob can say.
 */
function globRegExp(glob: string): RegExp {
  const source = glob
    .split('**/')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('(?:[^/]+/)*');
  return new RegExp(`^${source}$`);
}

/** Every file under a directory, by absolute path. */
function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) filesUnder(join(dir, entry.name), out);
    else out.push(join(dir, entry.name));
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

/**
 * A read-shaped call: the four spellings this repository reads files through.
 *
 * `\bread(` catches the local `const read = (rel) => readFileSync(join(ROOT,
 * rel))` helper that most guards in `scripts/` define — the single most common
 * form, and invisible to a scanner that only knows `readFileSync`. The word
 * boundary keeps it off `spread(` and `thread(`.
 */
const READ_CALL = /(?:readFileSync|readFile|import\.meta\.glob|\bread)\s*\(/g;

/** Directories with no tests in them, and enough files to be worth not walking. */
const UNWALKED: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.vite',
  'test-logs',
  'reports',
  'playwright-report',
]);

/** Every test file in the repository, by absolute path. */
function testFilesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!UNWALKED.has(entry.name)) testFilesUnder(join(dir, entry.name), out);
    } else if (/\.(unit|integration)\.test\.(ts|tsx|mts)$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * The argument text of every read-shaped call in a source file.
 *
 * Balanced-paren rather than line-based, because the reads that matter here
 * span lines — `readFileSync(\n  fileURLToPath(new URL('../../../docs/…')),\n
 * 'utf8')` puts the path on a line that contains no `read` at all. Reading the
 * ARGUMENTS is also what keeps this off the control assertions at the bottom of
 * this very file, which name document paths inside `selectedBy(...)`.
 */
function readArguments(source: string): string[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const args: string[] = [];
  for (const call of clean.matchAll(READ_CALL)) {
    const from = call.index + call[0].length;
    let i = from;
    let depth = 1;
    // Bounded. An unbalanced scan — a template literal with a stray paren, a
    // form nobody anticipated — must stop, not run to the end of the file.
    while (i < clean.length && depth > 0 && i - from < 600) {
      const c = clean[i++]!;
      if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    args.push(clean.slice(from, i - 1));
  }
  return args;
}

/**
 * Every directory a test WALKS, with the extensions it then reads from it.
 *
 * The other half of a read, and the half this guard could not see until
 * 2026-09-22. `filesTestsRead` resolves LITERAL paths, and said so — "a path
 * built from a variable is invisible here". That limitation had a price, and
 * `pasteable-hints.unit.test.ts` is where it was paid:
 *
 *     readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'))
 *       .map((f) => ({ file: `docs/${f}`, text: readFileSync(join(DOCS_DIR, f)) }))
 *
 * That reads EVERY top-level document — forty-eight of them — and refuses any
 * line calling `env-upsert.sh` with a `KEY=VALUE` before the env file. Not one
 * of those forty-eight was discovered by the literal scan, because not one of
 * them is named anywhere. Ten happened to be covered by the filter for other
 * reasons; the rest were #772 waiting to happen again, one `env-upsert.sh`
 * hint away.
 *
 * The same resolution as a literal read, applied to the directory instead: the
 * string parts of the `readdirSync(...)` argument are joined and resolved, and
 * the result has to be a directory that EXISTS. Extensions are whatever the
 * file tests with `endsWith`, and only files that exist are produced — so a
 * test that walks two directories for two different extensions
 * over-approximates into pairs that match nothing, which costs nothing.
 */
function directoriesTestsWalk(source: string, testDir: string): ReadonlyArray<string> {
  const found: string[] = [];
  for (const walk of source.matchAll(/readdirSync\(\s*([^)]{0,200})\)/g)) {
    // THE EXTENSION HAS TO BELONG TO THIS WALK. Harvesting every `endsWith` in
    // the file and applying it to every directory in the file was the first
    // version, and it was wrong in both directions at once: it claimed this
    // guard reads all forty-eight documents (its own `readdirSync(docs)` paired
    // with an unrelated `.md`), and it still missed `pasteable-hints`. So the
    // extension is taken from the chain that follows the call.
    const chain = source.slice(walk.index + walk[0].length, walk.index + walk[0].length + 220);
    const extensions = [...chain.matchAll(/endsWith\(\s*['"`](\.[a-z0-9.]{1,12})['"`]/gi)].map(
      (m) => m[1]!,
    );
    // A `endsWith(suffix)` — a VARIABLE — yields nothing, which is right: this
    // cannot know what it holds, and a guess would demand coverage for files
    // nothing reads.
    if (extensions.length === 0) continue;

    // The argument is often a constant defined above, not a literal. Follow it
    // one hop; `DOCS_DIR` is `join(dirname(fileURLToPath(import.meta.url)),
    // '..', 'docs')` and its parts are the only way to reach the directory.
    let argument = walk[1]!;
    const identifier = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(argument)?.[1];
    if (identifier) {
      const declaration = new RegExp(`const\\s+${identifier}\\s*(?::[^=]+)?=\\s*([^;]{0,200})`).exec(
        source,
      );
      if (!declaration) continue;
      argument = declaration[1]!;
    }

    const literals = [...argument.matchAll(/['"`]([^'"`\n]+)['"`]/g)].map((m) => m[1]!);
    for (let i = 0; i < literals.length; i++) {
      for (let j = i; j < literals.length; j++) {
        const candidate = literals.slice(i, j + 1).join('/');
        for (const base of [testDir, REPO_ROOT, join(testDir, '..'), join(testDir, '../..')]) {
          const absolute = resolve(base, candidate);
          if (!absolute.startsWith(`${REPO_ROOT}/`) || absolute.includes('node_modules')) continue;
          if (!existsSync(absolute) || !statSync(absolute).isDirectory()) continue;
          for (const entry of readdirSync(absolute)) {
            if (extensions.some((e) => entry.endsWith(e))) {
              found.push(relative(REPO_ROOT, join(absolute, entry)));
            }
          }
        }
      }
    }
  }
  return found;
}

/**
 * Every repository file a test reads, mapped to the tests that read it.
 *
 * DISCOVERED, not listed. The list this replaced held two entries and was
 * correct about both; what it could not do was notice a third, and on
 * 2026-09-21 there were fifteen — `docs/feature-matrix.md`,
 * `docs/managed-bring-up.md`, `README.md`, a workplan, `site/build.mjs`.
 *
 * Still conservative about a literal: it has to resolve to a file that EXISTS,
 * from the reading test's own directory or the repository root. What it no
 * longer misses is a directory WALK — see `directoriesTestsWalk`, which is the
 * gap this function's own comment used to describe and accept.
 */
function filesTestsRead(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const test of testFilesUnder(REPO_ROOT)) {
    const dir = dirname(test);
    for (const walked of directoriesTestsWalk(readFileSync(test, 'utf8'), dir)) {
      if (!found.has(walked)) found.set(walked, new Set());
      found.get(walked)!.add(relative(REPO_ROOT, test));
    }
    // `join(ROOT, 'docs', 'rls-guide.md')` hands us three literals, not one,
    // so every run of consecutive literals is a candidate path.
    for (const args of readArguments(readFileSync(test, 'utf8'))) {
      const literals = [...args.matchAll(/['"`]([^'"`\n]+)['"`]/g)].map((m) => m[1]!);
      const candidates = new Set<string>();
      for (let i = 0; i < literals.length; i++) {
        for (let j = i; j < literals.length; j++) candidates.add(literals.slice(i, j + 1).join('/'));
      }
      for (const candidate of candidates) {
        if (!/\.[a-z0-9]{1,5}$/i.test(candidate)) continue;
        for (const base of [dir, REPO_ROOT, join(dir, '..'), join(dir, '../..'), join(dir, '../../..'), join(dir, '../../../..')]) {
          // A glob's `*` is stripped so `docs/*-setup.md` resolves to nothing
          // rather than to a wrong file; globs are covered by their own test.
          const absolute = resolve(base, candidate.replace(/\*/g, ''));
          if (!absolute.startsWith(`${REPO_ROOT}/`) || absolute.includes('node_modules')) continue;
          if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
          const path = relative(REPO_ROOT, absolute);
          if (!found.has(path)) found.set(path, new Set());
          found.get(path)!.add(relative(REPO_ROOT, test));
          break;
        }
      }
    }
  }
  return found;
}

/**
 * Reads that exist today, in four different idioms, so the scan cannot pass by
 * finding nothing.
 *
 * A discovering guard has one failure mode a listing guard does not: break the
 * scanner and it reports an empty set, which reads exactly like success. These
 * are its smoke test — a bare repo-relative literal, a `join()` of segments, a
 * `new URL()` walked up three levels, and this file's own read of the workflow.
 */
const ANCHORS: ReadonlyArray<{ readonly path: string; readonly idiom: string }> = [
  { path: 'docs/LESSONS.md', idiom: "read('docs/LESSONS.md')" },
  { path: 'docs/rls-guide.md', idiom: "join(REPO_ROOT, 'docs', 'rls-guide.md')" },
  { path: 'docs/feature-matrix.md', idiom: "new URL('../../../docs/feature-matrix.md')" },
  { path: '.github/workflows/ci.yml', idiom: 'this file, reading the filter it checks' },
];

describe('a document a test reads is not a docs-only change', () => {
  it('finds the reads it is meant to find, in every idiom they are written in', () => {
    const read = filesTestsRead();
    for (const { path, idiom } of ANCHORS) {
      expect(
        read.has(path),
        `the scan no longer sees ${path}, read as \`${idiom}\`. Either that read was removed — ` +
          'in which case pick another anchor — or `readArguments` stopped recognising the way ' +
          'this repository reads files, and the test below is now passing over an empty set.',
      ).toBe(true);
    }
    // A floor, not a count: the figure on 2026-09-21 was 109 across 758 test
    // files. It is here so that a scanner which half-breaks is as loud as one
    // that breaks completely.
    expect(read.size, 'the scan found almost nothing — see the anchors above').toBeGreaterThan(50);
  });

  it('every file a test reads is on a path CI runs tests for', () => {
    const patterns = filterPatterns();
    const missed = [...filesTestsRead()]
      .filter(([path]) => !selectedBy(patterns, path))
      .map(([path, readers]) => `${path} (read by ${[...readers].sort().join(', ')})`)
      .sort();

    expect(
      missed,
      'these files are read by a test, and no detect-changes pattern selects them. A change ' +
        'to one of them ALONE will skip the unit suite, so the test that reads it cannot go ' +
        'red — and ci-complete will report success over a broken guard, which is #772 exactly. ' +
        'Add a pattern covering each to the `files:` block in .github/workflows/ci.yml, or, if ' +
        'the read was removed, this list empties itself.',
    ).toEqual([]);
  });

  it('resolves a glob the way the web test means it, folders included', () => {
    // The control for the resolver below. It used to take the glob's tail as a
    // SUFFIX of a file directly in docs/, which was right for `docs/*-setup.md`
    // and matched nothing at all for `docs/guides/*/*.md` (workplan 0148 T1).
    const re = globRegExp('docs/guides/*/*.md');
    expect(re.test('docs/guides/en/box.md')).toBe(true);
    expect(re.test('docs/guides/box.md')).toBe(false);
    expect(re.test('docs/guides/en/sub/box.md')).toBe(false);
    expect(re.test('docs/box-setup.md')).toBe(false);
    const deep = globRegExp('docs/guides/**/*.md');
    expect(deep.test('docs/guides/box.md')).toBe(true);
    expect(deep.test('docs/guides/en/sub/box.md')).toBe(true);
    expect(globRegExp('docs/*-setup.md').test('docs/box-setup.md')).toBe(true);
    expect(globRegExp('docs/*-setup.md').test('docs/guides/en/box-setup.md')).toBe(false);
  });

  it('every customer guide the web test globs is on a path CI runs tests for', () => {
    const patterns = filterPatterns();
    const globs = guideGlobsTheTestReads();

    // Resolve each glob to the documents that exist NOW: a rule about paths is
    // only worth as much as the files it currently selects, and a new guide
    // dropped into docs/ is exactly the case that must not slip through.
    const docs = filesUnder(join(REPO_ROOT, 'docs')).map((f) => relative(REPO_ROOT, f));
    const guides = globs.flatMap((glob) => {
      const [, tail] = glob.split('docs/');
      expect(tail, `glob '${glob}' does not point into docs/ — this guard assumes it does`).toBeDefined();
      const re = globRegExp(`docs/${tail!}`);
      return docs.filter((path) => re.test(path));
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
