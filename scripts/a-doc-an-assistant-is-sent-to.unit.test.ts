// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOC AN ASSISTANT IS SENT TO (ADR-0029; workplan 0152 T5 (c)).
 *
 * ADR-0029's operative rules say the public site "ships `llms.txt` curated as
 * links to maintained docs": the ADRs, workplans and runbooks, listed rather
 * than restated. From #1743 (2026-10-30) the site wrote an `llms.txt` that
 * listed its own pages and none of the documentation, and its own header said
 * so: "the documentation's lines are still owed". Since 2026-10-31 it lists a
 * selection of the documentation too, `MAINTAINED_DOCS` in
 * `site/maintained-docs.mjs`, whose header says what was chosen, why it links
 * the Markdown on `main` and not a release tag or GitHub's page for it, and
 * what that costs.
 *
 * A list of links into the repository goes stale in one way that matters: a
 * document renamed, moved or removed is a link that answers 404, and nothing
 * on the site says so. The build cannot look, because live's deploy builds the
 * site from an archive of `site/` alone, so `node scripts/llms-docs.mjs
 * --check` looks, in CI's `docs-hygiene`, on every change. Held here:
 *
 *  1. every document the list names is in this tree, a Markdown file by a
 *     plain path, under the title the list gives it, which is its own first
 *     `# ` heading word for word;
 *  2. `llms.txt` links each one, in the build for the Alpha and the one
 *     without, after the site's pages, one section per topic, by that title,
 *     at the repository's own raw Markdown on `main`, with no notes after it,
 *     and nothing else;
 *  3. the check fails on a document renamed, removed or retitled, naming it
 *     and what to do, as docs-hygiene runs it: from any directory, with
 *     nothing installed;
 *  4. docs-hygiene runs it on every change, and it imports nothing an install
 *     provides;
 *  5. the build reads the list, never the documents: built on a copy of
 *     `site/` alone, it writes the same `llms.txt`.
 *
 * NOT held: that GitHub answers for the links (checked by hand on 2026-10-31:
 * all fourteen `200 text/plain; charset=utf-8`), that the repository stays
 * public, or that live's `llms.txt`, built from a release tag, follows a
 * rename on `main` before the next release (`maintained-docs.mjs` says so).
 * The site's pages in `llms.txt` are `site/a-page-that-names-its-address-in-full`'s.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { docProblems, firstHeading, type Topic } from './llms-docs.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = join(REPO_ROOT, 'scripts', 'llms-docs.mjs');

/** A site module, by address: `site/` is plain JavaScript the root project does not type. */
const site = async <T>(file: string): Promise<T> =>
  (await import(pathToFileURL(join(REPO_ROOT, 'site', file)).href)) as T;

interface Docs {
  MAINTAINED_DOCS: Topic[];
  RAW_REPOSITORY_URL: string;
  docUrl: (path: string) => string;
}

const docs = () => site<Docs>('maintained-docs.mjs');

/** `llms.txt` of a build for the Alpha, or not, asked in this process. */
async function llms(alpha: boolean): Promise<string> {
  process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';
  const m = await site<{ build: (o: { alpha: boolean }) => { llms: string } }>('build.mjs');
  return m.build({ alpha }).llms;
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A directory of its own under the system's temporary directory, removed after the case. */
function scratch(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

/** The listed documents, copied from this tree into `root` at their paths. */
function copyDocs(list: Topic[], root: string): void {
  for (const { path } of list.flatMap((t) => t.docs)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(REPO_ROOT, path), join(root, path));
  }
}

describe('1. every document llms.txt links is in this tree, under its own first heading', () => {
  it('the check finds nothing wrong, over the five topics the selection is for', async () => {
    const { MAINTAINED_DOCS } = await docs();
    expect(docProblems(REPO_ROOT)).toEqual([]);
    // The selection's shape (ADR-0029; the item that asked for it): what the
    // product is, how data moves, the security and privacy model,
    // self-hosting, and the Alpha. A topic dropped is a question an assistant
    // is left to answer from somewhere else.
    expect(MAINTAINED_DOCS.map((t) => t.topic)).toEqual([
      'What it is',
      'How data moves',
      'Security and privacy',
      'Self-hosting',
      'The Alpha',
    ]);
    for (const { topic, docs: listed } of MAINTAINED_DOCS) expect(listed.length, `${topic} lists nothing`).toBeGreaterThan(0);
    // The vacuity check: a list of nothing passes every check above.
    expect(MAINTAINED_DOCS.flatMap((t) => t.docs).length).toBeGreaterThanOrEqual(10);
    // The source of truth and the security policy are the two an assistant
    // should not be without.
    const paths = MAINTAINED_DOCS.flatMap((t) => t.docs.map((d) => d.path));
    expect(paths).toContain('docs/architecture/solution-architecture.md');
    expect(paths).toContain('SECURITY.md');
  });

  it("reads a document's first heading past an HTML comment and a fenced block, and not inside them", () => {
    // OPERATIVE.md opens with a comment; a shell `# comment` in a fence is no heading.
    expect(firstHeading('<!-- GENERATED\n# not this -->\n\n# The heading\n')).toBe('The heading');
    expect(firstHeading('Intro.\n\n```bash\n# a comment\n```\n\n# The heading  \n')).toBe('The heading');
    expect(firstHeading('~~~~\n```\n# still fenced\n~~~~\n# The heading\n')).toBe('The heading');
    expect(firstHeading('## Only a second level\n')).toBeUndefined();
    expect(firstHeading('#No space\n')).toBeUndefined();
  });
});

describe('2. llms.txt links each one, after the pages, by its own heading, as its Markdown on main', () => {
  for (const alpha of [true, false]) {
    it(`a section per topic and a line per document, and nothing else, in a build ${alpha ? 'for' : 'not for'} the Alpha`, async () => {
      const { MAINTAINED_DOCS } = await docs();
      const { REPOSITORY_URL } = await site<{ REPOSITORY_URL: string }>('proof.mjs');
      const { LOCALES, COPY } = await site<{ LOCALES: string[]; COPY: Record<string, { langName: string }> }>('copy.mjs');
      const text = await llms(alpha);
      const lines = text.split('\n');

      // The pages first, under the languages, then the documentation; no
      // topic is named like a language.
      const headings = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
      const languages = LOCALES.map((l) => COPY[l]!.langName);
      expect(headings).toEqual([...languages, ...MAINTAINED_DOCS.map((t) => t.topic)]);

      // From the first topic to the end: exactly the list, in its order. The
      // address is the repository the README clones (`proof.mjs`, held by
      // claims-you-can-check), on GitHub's host for raw files, on `main`.
      const raw = REPOSITORY_URL.replace(/^https:\/\/github\.com\//, 'https://raw.githubusercontent.com/');
      expect(raw, 'REPOSITORY_URL is not a github.com address').not.toBe(REPOSITORY_URL);
      const expected = MAINTAINED_DOCS.flatMap(({ topic, docs: listed }) => [
        `## ${topic}`,
        '',
        ...listed.map((d) => `- [${d.title}](${raw}/main/${d.path})`),
        '',
      ]);
      const from = lines.indexOf(`## ${MAINTAINED_DOCS[0]!.topic}`);
      expect(lines.slice(from)).toEqual(expected);
      // One line spelled out, so the formula above is not the only witness.
      expect(text).toContain(
        '\n- [Security Policy](https://raw.githubusercontent.com/Robbes/Ownpace/main/SECURITY.md)\n',
      );

      // Listed, not restated: no document's line carries notes after its link.
      const docLines = lines.slice(from).filter((l) => l.startsWith('- '));
      expect(docLines.filter((l) => !l.endsWith(')'))).toEqual([]);
      // Not GitHub's page for the file, whose text sits in a JSON payload for a script.
      expect(text).not.toContain('/blob/');
    });
  }

  it('the raw address is derived from the one place the repository is named, not written again', async () => {
    const { REPOSITORY_URL } = await site<{ REPOSITORY_URL: string }>('proof.mjs');
    const { RAW_REPOSITORY_URL, docUrl } = await docs();
    expect(RAW_REPOSITORY_URL).toBe(REPOSITORY_URL.replace('https://github.com/', 'https://raw.githubusercontent.com/'));
    expect(docUrl('docs/x.md')).toBe(`${RAW_REPOSITORY_URL}/main/docs/x.md`);
    const source = readFileSync(join(REPO_ROOT, 'site', 'maintained-docs.mjs'), 'utf8');
    const name = new URL(REPOSITORY_URL).pathname; // `/Robbes/Ownpace`
    expect(source, `maintained-docs.mjs writes ${name} itself`).not.toContain(name);
  });
});

describe('3. a document renamed, removed or retitled fails the check, naming it', () => {
  it('in the module: each change named, by its path, and nothing named once it is put right', async () => {
    const { MAINTAINED_DOCS } = await docs();
    const root = scratch('llms-docs-');
    copyDocs(MAINTAINED_DOCS, root);
    expect(docProblems(root)).toEqual([]);

    // Renamed: the old path is gone.
    renameSync(join(root, 'docs/rollback-mechanisms.md'), join(root, 'docs/rolling-back.md'));
    // Retitled: the heading is not the one the list copies.
    const security = join(root, 'SECURITY.md');
    writeFileSync(security, readFileSync(security, 'utf8').replace(/^# Security Policy$/m, '# Reporting a vulnerability'));
    // Moved into a directory of the same name: a directory is not a document.
    rmSync(join(root, 'CHANGELOG.md'));
    mkdirSync(join(root, 'CHANGELOG.md'));
    expect(docProblems(root)).toEqual([
      { path: 'docs/rollback-mechanisms.md', what: 'is not in the tree' },
      { path: 'SECURITY.md', what: 'opens with "# Reporting a vulnerability", and the list gives it "Security Policy"' },
      { path: 'CHANGELOG.md', what: 'is not in the tree' },
    ]);
  });

  it('in the list: a path that leaves the repository or is no Markdown, a title no link can carry, a document twice', () => {
    const root = scratch('llms-docs-list-');
    writeFileSync(join(root, 'README.md'), '# Ownpace\n');
    const list: Topic[] = [
      {
        topic: 'One',
        docs: [
          { path: '../outside.md', title: 'Outside' },
          { path: 'deploy/compose/managed.yml', title: 'A stack' },
          { path: 'README.md', title: 'Own [pace]' },
        ],
      },
      { topic: 'One', docs: [{ path: 'README.md', title: 'Ownpace' }] },
      { topic: 'Empty', docs: [] },
    ];
    expect(docProblems(root, list).map((p) => `${p.path}: ${p.what}`)).toEqual([
      '../outside.md: is not a Markdown file by a plain path inside the repository',
      'deploy/compose/managed.yml: is not a Markdown file by a plain path inside the repository',
      'README.md: has the title "Own [pace]", which cannot be a link\'s text',
      'README.md: opens with "# Ownpace", and the list gives it "Own [pace]"',
      ': the topic "One" twice',
      'README.md: is listed twice',
      ': the topic "Empty" lists no document',
    ]);
    expect(docProblems(root, []).map((p) => p.what)).toEqual(['the list names no topic, so llms.txt links no document']);
  });

  it('as docs-hygiene runs it: exits 1 naming the path and what to do, from any directory with nothing installed, and 0 once it is put right', async () => {
    const { MAINTAINED_DOCS } = await docs();
    // A tree of the check, the two site modules it reads, and the documents:
    // no node_modules, no package.json, nothing an install would provide.
    const root = scratch('llms-docs-cli-');
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'site'));
    copyFileSync(CHECK, join(root, 'scripts', 'llms-docs.mjs'));
    for (const f of ['maintained-docs.mjs', 'proof.mjs']) copyFileSync(join(REPO_ROOT, 'site', f), join(root, 'site', f));
    copyDocs(MAINTAINED_DOCS, root);
    const check = () =>
      spawnSync(process.execPath, [join(root, 'scripts', 'llms-docs.mjs'), '--check'], { cwd: tmpdir(), encoding: 'utf8' });

    const green = check();
    expect(green.status, green.stderr).toBe(0);
    const count = MAINTAINED_DOCS.flatMap((t) => t.docs).length;
    expect(green.stdout).toBe(
      `llms.txt links ${count} document(s) in ${MAINTAINED_DOCS.length} topic(s), each in the tree under its own first heading\n`,
    );

    const from = join(root, 'docs/workplans/0134-no-backups-during-the-alpha-said-truthfully.md');
    renameSync(from, join(root, 'docs/workplans/0134-no-backups.md'));
    const red = check();
    expect(red.status, red.stdout).toBe(1);
    expect(red.stderr).toContain('  docs/workplans/0134-no-backups-during-the-alpha-said-truthfully.md  is not in the tree');
    expect(red.stderr).toContain('give MAINTAINED_DOCS in site/maintained-docs.mjs its new path');

    renameSync(join(root, 'docs/workplans/0134-no-backups.md'), from);
    expect(check().status).toBe(0);
    expect(spawnSync(process.execPath, [join(root, 'scripts', 'llms-docs.mjs')], { encoding: 'utf8' }).status).toBe(2);
  });
});

describe('4. where it runs: on every change, docs-only ones included', () => {
  it("is a step of docs-hygiene, which nothing skips, and the check imports Node's own modules and the site's list", () => {
    // `unit-tests` does not run on a change to a workplan or the architecture
    // document alone, and three of the documents are those.
    const ci = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const job = ci.slice(ci.indexOf('\n  docs-hygiene:'), ci.indexOf('\n  fixture-uuid-check:'));
    expect(job).toContain('run: node scripts/llms-docs.mjs --check');
    expect(job, 'docs-hygiene runs on every change; a `needs` or `if` would let one skip it').not.toMatch(
      /^ {4}(?:needs|if):/m,
    );
    // That job installs nothing, so an import from a package would fail there
    // and only there. Followed through the site modules the check loads.
    const importsOf = (file: string) =>
      [...readFileSync(file, 'utf8').matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of importsOf(file)) {
        if (spec.startsWith('node:')) continue;
        expect(spec, `${file} imports ${spec}, which an install provides`).toMatch(/^\.\.?\//);
        walk(join(dirname(file), spec));
      }
    };
    walk(CHECK);
    expect([...seen].map((f) => f.slice(REPO_ROOT.length + 1)).sort()).toEqual([
      'scripts/llms-docs.mjs',
      'site/maintained-docs.mjs',
      'site/proof.mjs',
    ]);
  });
});

describe('5. the build reads the list, never the documents', () => {
  it('built on a copy of site/ alone, as live’s deploy tests a tag, it writes the same llms.txt', async () => {
    // `git archive <tag> site package.json` is what `site_test_build` builds
    // (deploy/compose/deploy-live.sh). A build that read `../docs` would
    // refuse there, before anything moved, on every deploy.
    const root = scratch('llms-docs-site-');
    cpSync(join(REPO_ROOT, 'site'), join(root, 'site'), {
      recursive: true,
      filter: (src) => !src.split(sep).includes('dist') && !src.split(sep).includes('node_modules'),
    });
    copyFileSync(join(REPO_ROOT, 'package.json'), join(root, 'package.json'));
    const build = pathToFileURL(join(root, 'site', 'build.mjs')).href;
    const out = execFileSync(
      process.execPath,
      ['-e', `import(${JSON.stringify(build)}).then((m) => process.stdout.write(m.build({ alpha: true }).llms))`],
      { cwd: root, env: { ...process.env, OWNPACE_APP_URL: 'https://app.ota.ownpace.eu' }, encoding: 'utf8' },
    );
    const { MAINTAINED_DOCS } = await docs();
    expect(out).toContain(`## ${MAINTAINED_DOCS[0]!.topic}\n`);
    expect(out).toBe(await llms(true));
  });
});
