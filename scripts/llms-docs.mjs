#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY DOCUMENT `llms.txt` LINKS IS IN THE TREE, UNDER ITS OWN FIRST HEADING.
 *
 * The check of `site/maintained-docs.mjs` (ADR-0029; workplan 0152 T5 (c)),
 * whose header says what the list is and why it links `main`, and of
 * `scripts/a-doc-an-assistant-is-sent-to.unit.test.ts`, which holds this
 * check, where it runs, and `llms.txt` to the list.
 *
 * It lives here, in plain `.mjs` with Node's own modules and the site's list,
 * for the reason `conflict-markers.mjs` does. A document renamed, removed or
 * retitled is a change to that document, and the change is often docs-only:
 * `detect-changes` skips `unit-tests` for the workplans, `docs/architecture/**`
 * and a few root files alone, so a check that ran only there would let a
 * rename merge green and turn the link dead. `docs-hygiene` runs on every
 * change and installs nothing, and runs this.
 *
 * Not in `site/build.mjs`: live's deploy test-builds the site from
 * `git archive <tag> site package.json`, where no document is, and the tests
 * build copies of `site/` alone (`maintained-docs.mjs` says more).
 *
 * Usage, from any directory (it finds the repository by its own location):
 *
 *   node scripts/llms-docs.mjs --check
 *
 * Exit 0 with one line when every document is there under the title the list
 * gives it, 1 with each one that is not and what to do, 2 on a wrong usage.
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAINTAINED_DOCS } from '../site/maintained-docs.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A path GitHub serves as written, and that cannot leave the repository:
 * segments of letters, digits, `.`, `_` and `-`, none starting with a dot (so
 * no `..`), ending in a Markdown file, which is what llmstxt.org links.
 */
const PATH = /^(?:[A-Za-z0-9_][A-Za-z0-9._-]*\/)*[A-Za-z0-9_][A-Za-z0-9._-]*\.md$/;

/** A CommonMark fence opener or closer: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * A document's first `# ` heading, as its text, outside HTML comments and
 * fenced code; `undefined` when it has none. `OPERATIVE.md` opens with a
 * comment, and a shell `# comment` in a fence is not a heading.
 */
export function firstHeading(text) {
  const lines = text.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  let fence;
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = undefined;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    const h = /^# +(.*?)[ \t]*$/.exec(line);
    if (h) return h[1];
  }
  return undefined;
}

/** What is wrong with the list against the tree at `root`: `{ path, what }` each, or none. */
export function docProblems(root = REPO_ROOT, list = MAINTAINED_DOCS) {
  const out = [];
  if (list.length === 0) out.push({ path: '', what: 'the list names no topic, so llms.txt links no document' });
  const topics = new Set();
  const paths = new Set();
  for (const { topic, docs } of list) {
    if (!topic || /[\r\n]/.test(topic)) out.push({ path: '', what: `a topic named ${JSON.stringify(topic)}, which cannot head a section` });
    else if (topics.has(topic)) out.push({ path: '', what: `the topic "${topic}" twice` });
    topics.add(topic);
    if (docs.length === 0) out.push({ path: '', what: `the topic "${topic}" lists no document` });
    for (const { path, title } of docs) {
      if (!PATH.test(path)) {
        out.push({ path, what: 'is not a Markdown file by a plain path inside the repository' });
        continue;
      }
      if (paths.has(path)) out.push({ path, what: 'is listed twice' });
      paths.add(path);
      if (!title || /[[\]\r\n]/.test(title)) {
        out.push({ path, what: `has the title ${JSON.stringify(title)}, which cannot be a link's text` });
      }
      let text;
      try {
        if (statSync(join(root, path)).isFile()) text = readFileSync(join(root, path), 'utf8');
      } catch (e) {
        if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      }
      if (text === undefined) {
        out.push({ path, what: 'is not in the tree' });
        continue;
      }
      const heading = firstHeading(text);
      if (heading === undefined) out.push({ path, what: `has no "# " heading, and the list gives it "${title}"` });
      else if (heading !== title) out.push({ path, what: `opens with "# ${heading}", and the list gives it "${title}"` });
    }
  }
  return out;
}

/** The failure message: every document and what is wrong with it, and what to do. */
export function verdictMessage(problems) {
  return [
    `llms.txt links ${problems.length} thing(s) that are not as site/maintained-docs.mjs says:`,
    '',
    ...problems.map((p) => `  ${p.path || 'site/maintained-docs.mjs'}  ${p.what}`),
    '',
    'llms.txt sends an assistant to each of these, on main, by its own first heading (ADR-0029).',
    'A document renamed or moved: give MAINTAINED_DOCS in site/maintained-docs.mjs its new path,',
    'in this same change. Removed: take its line out, or choose the document that replaces it.',
    'Retitled: copy its new first heading into the list, word for word. The build reads the list',
    'and never the documents (maintained-docs.mjs says why), so this check is what keeps them one.',
  ].join('\n');
}

/** `--check`: the exit status, with the verdict printed. */
export function main(argv = process.argv.slice(2), root = REPO_ROOT) {
  if (argv.length !== 1 || argv[0] !== '--check') {
    console.error('usage: llms-docs.mjs --check');
    return 2;
  }
  const problems = docProblems(root);
  if (problems.length > 0) {
    console.error(verdictMessage(problems));
    return 1;
  }
  const count = MAINTAINED_DOCS.reduce((n, t) => n + t.docs.length, 0);
  console.log(
    `llms.txt links ${count} document(s) in ${MAINTAINED_DOCS.length} topic(s), each in the tree under its own first heading`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
