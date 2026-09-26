// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A READ-ONLY CLAIM WITH ITS SCOPE (workplan 0144 T3).
 *
 * The readiness review of 2026-09-23 read what a tester is told before they
 * connect, and found *"read-only"* said about every Google connection. The
 * grant page opened a green box with *"Read-only."* above the scope Google was
 * about to record, and for a Gmail link that scope was `https://mail.google.com/`,
 * which Google itself describes as reading, sending and permanently deleting
 * all mail. `docs/grant-links.md` specified the same promise, and the site and
 * one setup step said it too.
 *
 * Two different things were being called one word:
 *
 *   what Ownpace DOES   it only reads. No source connector sends anything that
 *                       writes, and that is true of every source.
 *   what the PERMISSION  read-only only where the provider enforces it: Google
 *   allows              Drive (`drive.readonly`), Google Tasks
 *                       (`tasks.readonly`) and Microsoft through *Connect with
 *                       Microsoft* (`*.Read`). For Gmail, Google Calendar and
 *                       Google Contacts, and for Microsoft 365 through IMAP
 *                       (`IMAP.AccessAsUser.All`), the permission also allows
 *                       changes, and the guarantee is the software's.
 *
 * A person reads "read-only" as the second, because that is what the word
 * means on a consent screen. So the rule this file holds: on the surfaces the
 * plan names, the words *read-only*, *alleen-lezen* and *alleen lezen* appear
 * only in a sentence that also names a provider whose permission is read-only
 * by its own rule. Everything else says *only reads* / *leest alleen*, which is
 * the software's promise and is true everywhere.
 *
 * ## What is not yet under the rule, and whose it is
 *
 * The site's how-it-works page is the owner's copy to approve (0144 T0, T3 (b)),
 * and the setup step's title is T3's *after the first invitation*. They are
 * named in `PENDING` below with whose they are, and the list only shrinks: an
 * entry whose text no longer breaks the rule fails here until it is removed,
 * so an excuse cannot outlive what it excused. The grant page's own box is
 * chosen by the grant's scopes at run time, which a text scan cannot see; its
 * guard is `apps/web/src/a-permission-described-as-it-is.unit.test.tsx`, and
 * the decision's is `grant-link-readiness.unit.test.ts`.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY (AGENTS.md): the dictionary is
 * read as text, the way `a-ceiling-the-screen-could-not-see` reads its files.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** The claim, in both languages. */
const CLAIM = /read-only|alleen-lezen|alleen lezen/i;

/**
 * What makes the claim true in the sentence that carries it: a product whose
 * permission the provider itself holds to reading. Dropbox and Box are left out
 * on purpose: their read-only is the app's configuration, which this rule does
 * not read (0140 T7 narrows Dropbox's).
 *
 * Microsoft only by its button, *Connect with Microsoft* / *Verbinden met
 * Microsoft*, whose permissions are the `*.Read` ones. The brand alone is not
 * enough: Microsoft 365 through the IMAP card asks `IMAP.AccessAsUser.All`,
 * which can write (0144 §1), and a sentence naming only "Microsoft 365" would
 * lend that card a read-only it does not have. §3 says "names Drive, Tasks or
 * Microsoft"; this is the narrower reading §1's table supports.
 */
const SCOPED = /\b(?:Drive|Tasks|Taken)\b|\bConnect with Microsoft\b|\bVerbinden met Microsoft\b/;

const STRINGS = 'apps/web/src/i18n/strings.ts';

/** A surface is a Markdown file, or one dictionary key in one language. */
type Surface = { readonly kind: 'markdown'; readonly path: string } | {
  readonly kind: 'string';
  readonly key: string;
  readonly locale: 'en' | 'nl';
};

const nameOf = (s: Surface): string =>
  s.kind === 'markdown' ? s.path : `${STRINGS} ${s.key} (${s.locale})`;

/** Every surface 0144 T3's guard names. */
const SURFACES: ReadonlyArray<Surface> = [
  { kind: 'markdown', path: 'docs/grant-links.md' },
  { kind: 'markdown', path: 'site/pages/en/how-it-works.md' },
  { kind: 'markdown', path: 'site/pages/nl/hoe-het-werkt.md' },
  { kind: 'string', key: 'setup.google.consent_scope.title', locale: 'en' },
  { kind: 'string', key: 'setup.google.consent_scope.title', locale: 'nl' },
];

/** Surface → whose it is to change, and when. Only shrinks. */
const PENDING: Readonly<Record<string, string>> = {
  'site/pages/en/how-it-works.md':
    "0144 T3 (b): the site copy is the owner's to approve or rewrite (T0), in group R5.",
  'site/pages/nl/hoe-het-werkt.md':
    "0144 T3 (b): the site copy is the owner's to approve or rewrite (T0), in group R5.",
  [`${STRINGS} setup.google.consent_scope.title (en)`]:
    "0144 T3's setup title, planned for after the first invitation.",
  [`${STRINGS} setup.google.consent_scope.title (nl)`]:
    "0144 T3's setup title, planned for after the first invitation.",
};

/**
 * A Markdown file as the sentences a reader meets: a heading, a list item or a
 * paragraph is a block, its lines are joined, emphasis is dropped, and a block
 * breaks into sentences after `.`, `!`, `?` or `;`.
 */
function markdownSentences(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) blocks.push(current.join(' '));
    current = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flush();
    } else if (/^(#{1,6}\s|[-*]\s|\d+\.\s|>)/.test(line)) {
      flush();
      current.push(line);
      if (line.startsWith('#')) flush();
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks
    .map((b) => b.replace(/^(?:[-*]|\d+\.)\s+/, '').replace(/\*\*|__|`/g, ''))
    .flatMap((b) => b.split(/(?<=[.!?;])\s+/))
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** One dictionary key's text in one language, read from the source as text. */
function dictionaryText(key: string, locale: 'en' | 'nl'): string {
  const source = read(STRINGS);
  // `const en = {` opens the English table and `const nl` the Dutch one.
  const nlStart = source.indexOf('\nconst nl');
  expect(nlStart, `${STRINGS} no longer has a Dutch table where this guard looks`).toBeGreaterThan(0);
  const table = locale === 'en' ? source.slice(0, nlStart) : source.slice(nlStart);
  const escaped = key.replace(/\./g, '\\.');
  const found = new RegExp(`'${escaped}':\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(table);
  expect(found, `${STRINGS} has no '${key}' in its ${locale} table`).not.toBeNull();
  return found![1]!;
}

function sentencesOf(s: Surface): string[] {
  return s.kind === 'markdown' ? markdownSentences(read(s.path)) : [dictionaryText(s.key, s.locale)];
}

/** The sentences that claim read-only without naming whose permission it is. */
function unscopedClaims(sentences: ReadonlyArray<string>): string[] {
  return sentences.filter((s) => CLAIM.test(s) && !SCOPED.test(s));
}

describe('the judge itself', () => {
  it('finds a claim with no scope, and passes one that names whose permission is read-only', () => {
    expect(unscopedClaims(['The connection is read-only: the software has no path that writes.'])).toHaveLength(1);
    expect(unscopedClaims(['Die koppeling is alleen-lezen.'])).toHaveLength(1);
    expect(unscopedClaims(['Alleen lezen. Er wordt nooit iets verwijderd.'])).toHaveLength(1);
    expect(unscopedClaims(['For Google Drive and Google Tasks the permission is read-only.'])).toEqual([]);
    expect(unscopedClaims(['Ownpace only reads; it changes nothing.'])).toEqual([]);
  });

  it('takes Microsoft only as Connect with Microsoft, whose permissions are the read-only ones', () => {
    // Microsoft 365 through the IMAP card asks `IMAP.AccessAsUser.All`, which
    // can write (0144 §1). The brand alone would lend its read-only to that.
    expect(unscopedClaims(['Microsoft 365 through IMAP is read-only.'])).toHaveLength(1);
    expect(unscopedClaims(['Microsoft 365 via IMAP is alleen-lezen.'])).toHaveLength(1);
    expect(unscopedClaims(['Microsoft 365 through Connect with Microsoft is read-only.'])).toEqual([]);
    expect(unscopedClaims(['Via Verbinden met Microsoft is de toestemming alleen-lezen.'])).toEqual([]);
  });

  it('reads a list item as its own sentence, so a neighbour cannot lend it a scope', () => {
    const md = ['- **that it is read-only** — nothing is ever changed;', '- **what will be read** — files in Google Drive;'].join(
      '\n',
    );
    expect(unscopedClaims(markdownSentences(md))).toEqual(['that it is read-only — nothing is ever changed;']);
  });

  it('reads a heading as its own sentence', () => {
    const md = '## 2. Connect the account you are leaving — read-only\n\nGoogle Drive is enforced.';
    expect(unscopedClaims(markdownSentences(md))).toHaveLength(1);
  });
});

describe('"read-only" is said only where the provider enforces it (0144 T3)', () => {
  it('every surface the plan names still exists, so the scan is not reading nothing', () => {
    for (const s of SURFACES) {
      if (s.kind === 'markdown') expect(existsSync(join(REPO_ROOT, s.path)), s.path).toBe(true);
      else expect(dictionaryText(s.key, s.locale).length, nameOf(s)).toBeGreaterThan(0);
    }
  });

  for (const s of SURFACES.filter((x) => !(nameOf(x) in PENDING))) {
    it(`${nameOf(s)}: says "read-only" only beside Drive, Tasks or Connect with Microsoft`, () => {
      expect(
        unscopedClaims(sentencesOf(s)),
        `${nameOf(s)} calls something read-only without naming a permission the provider holds to ` +
          'reading. Say what Ownpace does ("only reads" / "leest alleen"), or name the product whose ' +
          'permission is read-only.',
      ).toEqual([]);
    });
  }

  it('names only surfaces the scan reads, so an entry cannot excuse a file nobody checks', () => {
    const names = new Set(SURFACES.map(nameOf));
    for (const pending of Object.keys(PENDING)) expect(names.has(pending), pending).toBe(true);
  });

  for (const s of SURFACES.filter((x) => nameOf(x) in PENDING)) {
    it(`${nameOf(s)}: still pending (${PENDING[nameOf(s)]}), or it leaves the list`, () => {
      expect(
        unscopedClaims(sentencesOf(s)).length,
        `${nameOf(s)} no longer calls anything read-only without its scope. Remove it from PENDING, ` +
          'so the rule holds it from now on.',
      ).toBeGreaterThan(0);
    });
  }
});
