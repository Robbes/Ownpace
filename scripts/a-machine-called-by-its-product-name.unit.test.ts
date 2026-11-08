// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MACHINE CALLED BY ITS PRODUCT NAME.
 *
 * The box that runs CI's pushes, the nightly gates, the OTA stack and
 * `ownpace-live` is the owner's own machine, and its hardware has a product
 * name. The owner's rule is that public text does not name it: say the
 * machine, the box, the host or the self-hosted runner. On 2026-11-08, at
 * `origin/main` `b832d027`, a case-insensitive whole-word search for its words
 * found 375 lines in 142 tracked files that did: 9 workflows, 17 of the
 * stacks' files, 20 files in `apps/` and `packages/`, 36 under `scripts/`
 * (guard headers among them), 37 workplans and their index, 5 ADR files, 11
 * other documents, the CHANGELOG, the README, AGENTS.md, 2 E2E tests and the
 * site's build. Five test fixtures used it as a host name
 * (`<word>.mesh.example`), a runbook as a placeholder for the machine's mesh
 * address, one record named the runner itself, and eighteen quotations of four
 * things the owner said held it. Every one of them is public, as the
 * repository is.
 *
 * NOTHING HELD THE RULE BUT MEMORY. Agents were told it; no file said it and
 * nothing checked it. So it spread the way house style spreads: a new Status
 * entry copies the words of the one above it, a new guard the header of the
 * guard it was modelled on. The rule was true in the sense that everyone would
 * have agreed with it, and false in the sense that nothing in the tree depended
 * on it, which is how `a-convention-two-of-two-hundred-commits-followed`
 * describes the same shape.
 *
 * The sweep changed 374 of the 375 lines (workplan 0132's Status, 2026-11-08).
 * Each was read in context. An owner's quotation keeps its words, with the
 * substitution in square brackets, *"[The machine] has a lot free memory"*.
 * Fixtures got neutral names, and the tests that read them pass unchanged.
 * Git history keeps the old text: the recommendation the owner accepted on
 * 2026-11-08 leaves it alone.
 *
 * WHAT IT CHECKS. Every file `git ls-files` lists, untracked ones included, so
 * the verdict does not depend on whether `git add` has run (the lessons index's
 * reason). Each file's text is split into tokens, runs of ASCII letters and
 * digits, so a hyphen, an underscore, a dot, a slash or an apostrophe ends one:
 * a host name that holds a word is a hit, and so is the word with `'s`, but a
 * longer word that contains it is not. Each token is lowercased and its SHA-256
 * compared with a list; so is each pair of adjacent tokens, joined by one space,
 * for the names of two words, and a pair may span a line break. A hit is
 * reported by file, line and column, once a line, and never by what it found.
 *
 * WHY DIGESTS, AND NOT THE WORDS. A guard that held the words would be the one
 * file in the tree that names them. `scripts/machine-product-name.mjs` holds
 * SHA-256 digests, and this file builds the words at test time from an encoding
 * nobody reads in passing (each word's letters reversed, in base64); both are
 * deliberately not in clear. A digest of a short word is no secret to anybody
 * who tries. It keeps the word out of the text, which is all the rule asks. The
 * first case below proves that the decoding gives exactly what the detector
 * looks for, so neither list can drift from the other.
 *
 * WHAT IS SKIPPED, and why. A file whose first 8,000 bytes hold a NUL, git's
 * own test for binary: 11 files on 2026-11-08, images, archives, a keyring and
 * a signature, and none of them holds a word in its strings. And
 * `pnpm-lock.yaml`, generated from the registry: its names are third-party
 * packages', and a package whose name holds a word could arrive with any
 * update, which nobody here could rename. It holds none today. `SKIPPED` in the
 * detector lists it, and a case below pins the list.
 *
 * WHAT IS OWED. One line is still there on purpose. `e2e-o365.yml`'s `runs-on`
 * asks for a runner label that is the word itself, and the owner added that
 * label to the runner on 2026-11-02 rather than drop it from `runs-on`, the
 * choice #1137 left to them (workplan 0141 T13 (a)). A label is behaviour: a
 * job whose labels no runner carries waits for one forever. So it waits for the
 * owner. `OWED` in the detector declares each such file and how many lines it
 * holds, and a file that holds more or fewer fails, for the reason the conflict
 * detector counts its quotations: a declaration nothing uses would excuse the
 * next word written there. A case below holds today's one line to the label.
 *
 * WHERE IT RUNS. `docs-hygiene` in `.github/workflows/ci.yml` runs
 * `node scripts/machine-product-name.mjs --check` on every change, docs-only
 * ones included, because `detect-changes` skips `unit-tests` for a change to the
 * workplans alone, and most of the 375 lines were prose. This file runs in
 * `unit-tests` and imports the same module.
 *
 * WHAT IT CANNOT SEE, so its silence is not read as coverage.
 *
 *  - A word glued to another without a separator (camelCase, or two words
 *    written as one) is a different token, and passes. So does a spelling with
 *    a letter that is not ASCII.
 *  - Anything that is not a file in the tree: git history, commit messages,
 *    pull request and issue text, release notes, and the logs of runs. Every
 *    job on the self-hosted runner prints the runner's name and its host's name
 *    in its set-up step, and both hold a word: those are the owner's to change,
 *    on the runner and the host, not here.
 *  - What the words describe. The machine's memory size or its core count,
 *    written as numbers, names nothing this can match.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OWED,
  PAIR_DIGESTS,
  SKIPPED,
  WORD_DIGESTS,
  hitsIn,
  isBinary,
  owedFindings,
  scanTree,
  verdictMessage,
} from './machine-product-name.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DETECTOR = join(REPO_ROOT, 'scripts', 'machine-product-name.mjs');

/** This file, as git spells it. It is scanned like any other, and must pass. */
const SELF = relative(REPO_ROOT, fileURLToPath(import.meta.url));

/**
 * The words, DELIBERATELY NOT IN CLEAR: each is its letters reversed, in
 * base64, and decoded here. Written out, they would make this file the thing it
 * guards against.
 */
const decode = (s: string): string => [...Buffer.from(s, 'base64').toString('utf8')].reverse().join('');
const WORDS = ['a3JhcHM=', 'eGdk', 'YWlkaXZu', 'MDFiZw=='].map(decode);
const PAIRS = ['bGxld2tjYWxiIGVjYXJn', 'c28geGdk'].map(decode);
/** The first pair's two halves; its first word is not a word of its own. */
const [FIRST, SECOND] = PAIRS[0]!.split(' ') as [string, string];

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const tree = scanTree();

/** How many lines each file names it on. */
const counts = (byFile: Readonly<Record<string, ReadonlyArray<unknown>>>): Record<string, number> =>
  Object.fromEntries(Object.entries(byFile).map(([file, hits]) => [file, hits.length]));

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('the list: digests in the detector, an encoding here, and the same words in both', () => {
  it('decodes to exactly the words and pairs the detector looks for', () => {
    // A word added to one list and not the other fails here, in either direction.
    expect(WORDS.map(sha256).sort()).toEqual([...WORD_DIGESTS].sort());
    expect(PAIRS.map((p) => [sha256(p.split(' ')[0]!), sha256(p)])).toEqual(PAIR_DIGESTS.map((d) => [...d]));
    expect(WORD_DIGESTS, "the first pair's halves are not words of their own").not.toContain(sha256(FIRST));
    expect(WORD_DIGESTS).not.toContain(sha256(SECOND));
  });

  it('holds digests and nothing else, and this file holds the words only encoded', () => {
    for (const d of [...WORD_DIGESTS, ...PAIR_DIGESTS.flat()]) expect(d).toMatch(/^[0-9a-f]{64}$/);
    // Neither file passes by being skipped: both are read like any other.
    expect(tree.scanned).toContain(SELF);
    expect(tree.scanned).toContain('scripts/machine-product-name.mjs');
    expect(hitsIn(readFileSync(DETECTOR, 'utf8'))).toEqual([]);
    expect(hitsIn(readFileSync(fileURLToPath(import.meta.url), 'utf8'))).toEqual([]);
  });
});

describe('no file in the tree names it, but the one line that is owed', () => {
  it('reads the whole tree, so an empty listing cannot pass', () => {
    // 2,886 text files on 2026-11-08, out of 2,898 that git lists.
    for (const file of ['CHANGELOG.md', 'AGENTS.md', 'docs/LESSONS.md', 'docs/workplans/README.md', '.github/workflows/ci.yml']) {
      expect(tree.scanned).toContain(file);
    }
    expect(tree.scanned.filter((f) => f.startsWith('docs/workplans/')).length).toBeGreaterThan(150);
    expect(tree.scanned.length).toBeGreaterThan(2000);
    // The binary test cannot quietly swallow text: 11 files on 2026-11-08.
    expect(tree.binary).toContain('site/brand/logo-512.png');
    expect(tree.binary.length).toBeLessThan(50);
  });

  it(`finds nothing OWED does not declare (${tree.scanned.length} files read)`, () => {
    expect(tree.findings, verdictMessage(tree.findings)).toEqual([]);
  });

  it('passes over the lockfile and nothing else, by name', () => {
    expect(SKIPPED).toEqual(['pnpm-lock.yaml']);
    expect(tree.skipped).toEqual(['pnpm-lock.yaml']);
  });

  it('owes one line, the runner label of the O365 lane, and declares it here as well as in the detector', () => {
    // Declared in two places on purpose, so that a new exception is added on
    // purpose and never by accident. It goes when the owner's step is done.
    expect(OWED).toEqual({ '.github/workflows/e2e-o365.yml': 1 });
    expect(counts(tree.byFile)).toEqual(OWED);
    const workflow = readFileSync(join(REPO_ROOT, '.github/workflows/e2e-o365.yml'), 'utf8').split('\n');
    const [hit] = tree.byFile['.github/workflows/e2e-o365.yml']!;
    // A boolean, so that a failure does not print the line, label and all.
    expect(
      /^ {4}runs-on: \[self-hosted, linux, arm64, [a-z0-9]+\]$/.test(workflow[hit!.line - 1]!),
      `line ${hit!.line} of e2e-o365.yml holds the word and is not the runs-on label`,
    ).toBe(true);
  });
});

/**
 * A case here names what it built by its index, never by its text: a failing
 * case in `unit-tests` prints its label into a public log, as the detector would.
 */
describe('what counts as naming it', () => {
  it('finds each word in any case, once a line, at its first column', () => {
    WORDS.forEach((w, i) => {
      expect(hitsIn(`on the ${w} box`), `word ${i}`).toEqual([{ line: 1, column: 8 }]);
      expect(hitsIn(`on the ${w.toUpperCase()} box`), `word ${i}`).toEqual([{ line: 1, column: 8 }]);
      expect(hitsIn(`x\n${title(w)} and ${w} again`), `word ${i}`).toEqual([{ line: 2, column: 1 }]);
    });
  });

  it('finds it inside a name a separator ends: a host, a fixture, a placeholder, a URL', () => {
    const [w] = WORDS as [string];
    [
      `${w}.mesh.example`,
      `https://${w}.local:3443/magic`,
      `ownpace-${w}`,
      `<${w}-netbird-ip>`,
      `${w}_runner`,
      `the ${title(w)}'s .env`,
      `runs-on: [self-hosted, linux, arm64, ${w}]`,
      `\`${w}\``,
      `(${title(w)}, 2026-08-18)`,
    ].forEach((text, i) => {
      expect(hitsIn(text), `form ${i}`).toHaveLength(1);
    });
  });

  it('passes a longer word that only contains it, and a word it only contains', () => {
    const [w] = WORDS as [string];
    [`${w}s`, `${w}le`, `un${w}`, `${w}2`, `x${w}x`, `ignores${title(w)}`, w.slice(1), w.slice(0, -1)].forEach((text, i) => {
      expect(hitsIn(text), `form ${i}`).toEqual([]);
    });
  });

  it('finds a name of two words, with any separator, across a line break, and not its halves alone', () => {
    expect(hitsIn(`the ${FIRST} ${SECOND} chip`)).toEqual([{ line: 1, column: 5 }]);
    expect(hitsIn(`the ${title(FIRST)}-${title(SECOND)} chip`)).toEqual([{ line: 1, column: 5 }]);
    expect(hitsIn(`${FIRST.toUpperCase()} ${SECOND.toUpperCase()}`)).toEqual([{ line: 1, column: 1 }]);
    // A wrapped line, in prose and in a comment: reported at the first word.
    expect(hitsIn(`runs on ${title(FIRST)}\n${title(SECOND)} silicon`)).toEqual([{ line: 1, column: 9 }]);
    expect(hitsIn(` * runs on ${FIRST}\n * ${SECOND} silicon`)).toEqual([{ line: 1, column: 12 }]);
    // Each half alone is ordinary English or a surname, and passes.
    expect(hitsIn(`a ${FIRST} period of seven days`)).toEqual([]);
    expect(hitsIn(`Ms ${title(SECOND)} signed it`)).toEqual([]);
    expect(hitsIn(`${FIRST} and ${SECOND}`)).toEqual([]);
    // The second pair starts with a word, which is a hit by itself.
    expect(hitsIn(PAIRS[1]!)).toEqual([{ line: 1, column: 1 }]);
  });
});

describe('what is owed, and what is not', () => {
  const at = (line: number) => ({ line, column: 1 });
  const declared = { 'x.yml': 1 };

  it('passes a declared file that holds exactly what it declares, and nothing else', () => {
    expect(owedFindings({ 'x.yml': [at(9)] }, declared)).toEqual([]);
  });

  it('fails each line of a file that declares nothing, and of a declared file that holds more', () => {
    expect(owedFindings({ 'a.md': [at(2), at(7)] }, {}).map((f) => `${f.file}:${f.line}`)).toEqual(['a.md:2', 'a.md:7']);
    expect(owedFindings({ 'x.yml': [at(3), at(9)] }, declared).map((f) => f.what)).toEqual([
      'one of 2, where OWED declares 1',
      'one of 2, where OWED declares 1',
    ]);
  });

  it('fails a declaration nothing uses any more, so that it goes when the owner’s step is done', () => {
    expect(owedFindings({}, declared)).toEqual([
      { file: 'x.yml', line: 0, column: 0, what: expect.stringMatching(/^OWED declares 1 line\(s\) .* holds 0: take the entry out/) },
    ]);
  });
});

describe('where it runs: on every change, docs-only ones included', () => {
  it("is a step of docs-hygiene, which nothing skips, and imports only Node's own modules", () => {
    const ci = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const job = ci.slice(ci.indexOf('\n  docs-hygiene:'), ci.indexOf('\n  fixture-uuid-check:'));
    expect(job).toContain('node scripts/machine-product-name.mjs --check');
    expect(job, 'docs-hygiene runs on every change; a `needs` or `if` would let one skip it').not.toMatch(
      /^ {4}(?:needs|if):/m,
    );
    const imports = [...readFileSync(DETECTOR, 'utf8').matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((s) => !s.startsWith('node:'))).toEqual([]);
  });

  it('a word added to a file turns the check red, naming the file and line and not the word; taken out, green', () => {
    // The command docs-hygiene runs, from another directory, on a repository of
    // untracked files: the detector, the owed workflow, a plan, a binary and
    // the lockfile.
    const root = mkdtempSync(join(tmpdir(), 'machine-product-name-'));
    dirs.push(root);
    const write = (path: string, body: string | Buffer): void => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), body);
    };
    const [w] = WORDS as [string];
    mkdirSync(join(root, 'scripts'));
    copyFileSync(DETECTOR, join(root, 'scripts', 'machine-product-name.mjs'));
    write('.github/workflows/e2e-o365.yml', `jobs:\n  e2e-o365:\n    runs-on: [self-hosted, linux, arm64, ${w}]\n`);
    write('site/logo.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]), Buffer.from(` ${w} `)]));
    write('pnpm-lock.yaml', `packages:\n  ${w}-md5@3.0.2:\n    resolution: {integrity: sha512-x}\n`);
    write('docs/workplans/0200-x.md', '# A plan\n\nThe gate runs on the machine.\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    const check = () =>
      spawnSync(process.execPath, [join(root, 'scripts', 'machine-product-name.mjs'), '--check'], {
        cwd: tmpdir(),
        encoding: 'utf8',
      });

    const before = check();
    expect(before.status, before.stderr).toBe(0);
    expect(before.stdout).toContain('(1 binary and 1 skipped passed over); owed: 1 in .github/workflows/e2e-o365.yml');

    write('docs/workplans/0200-x.md', `# A plan\n\nThe gate runs on the ${title(w)}.\n`);
    const red = check();
    expect(red.status, red.stderr).toBe(1);
    expect(red.stderr).toContain('1 file(s) name the machine by its hardware product name:');
    expect(red.stderr).toContain('  docs/workplans/0200-x.md:3:22\n');
    expect(red.stderr).toContain('Say "the machine", "the box", "the host"');
    // The public log of a red run must not carry what the run refused.
    [...WORDS, ...PAIRS].forEach((word, i) => {
      expect(red.stderr.toLowerCase().includes(word), `the refusal names word ${i}`).toBe(false);
    });

    write('docs/workplans/0200-x.md', '# A plan\n\nThe gate runs on the machine.\n');
    const green = check();
    expect(green.status, green.stderr).toBe(0);
    expect(green.stdout).toContain('owed: 1 in .github/workflows/e2e-o365.yml');
  });

  it('reads a binary as git does: a NUL in its first 8,000 bytes', () => {
    expect(isBinary(Buffer.from('plain text\n'))).toBe(false);
    expect(isBinary(Buffer.concat([Buffer.alloc(100, 0x61), Buffer.from([0])]))).toBe(true);
    expect(isBinary(Buffer.concat([Buffer.alloc(8000, 0x61), Buffer.from([0])]))).toBe(false);
  });
});
