// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The setup guides, in the app (workplan 0063).
 *
 * A refusal names no document by file: it carries a guide handle beside its
 * words, such as `box#connect` (workplan 0148 T7), and `GuideLink` draws it as
 * *Guide: {title}* / *Handleiding: {title}*, a link to that section of this
 * route. Until then refusals said "docs/box-setup.md walks through each step",
 * which is actionable with the repository checked out and useless to a
 * customer in a browser.
 *
 * The markdown is imported AT BUILD TIME from the repository's own `docs/`
 * directory, so the guide ships with the code that implements it. That is the
 * whole reason not to host these separately: a setup doc that can drift from
 * its connector is how a customer follows five correct steps and one that
 * stopped being true two releases ago.
 *
 * WHICH DOCUMENTS (workplan 0148 T1, the owner's D1). What this page serves is
 * the customer guide, `docs/guides/<locale>/<slug>.md`: written for the person
 * who connects an account, in the language they read. The `docs/*-setup.md`
 * files it served until then keep their names and are the operator and
 * self-host documents, which are not served; on the appliance the index ends
 * with one line pointing to them (D9). `/docs/<slug>` opens the reader's
 * language, or the other one under a line saying so (T4's "Which language").
 *
 * THE OWN-APP SECTION (T2 (c)). The Google, Dropbox and Microsoft guides each
 * have a section `{#own-app}` with the steps to create an app of one's own. It
 * renders as a `<details>`: closed where `/api/provider-clients` says this
 * deployment carries that provider's app, open otherwise, the way the wizard
 * folds its client pair. It reads that fact under the wizard's own query key,
 * and never the edition's name; the appliance serves no such route, so there
 * the section stays open, as its steps are the appliance's to take.
 *
 * OPEN WITHOUT AN ACCOUNT (workplan 0152; the owner, 2026-10-04: *"Guide links
 * on the Leaving pages: yes, make public"*). On managed a visitor without a
 * session reads this page too, in `PublicDocs`'s frame, and for them it asks
 * the API nothing (`useSignedIn`): the own-app section stays open, as it does
 * where the answer never comes. The route that answers is public, but the
 * client it goes through takes any 401 for a dead session and sends the
 * browser to the sign-in page (`onUnauthorized` in `services/api.ts`), which
 * is the bounce this page was opened up to end. A page for somebody without
 * a session does not depend on every route it touches staying public.
 *
 * The renderer below is deliberately small, and extended rather than replaced
 * by a library (workplan 0148 D6): the guides are ours and short. It takes
 * headings (an `<h2>`–`<h4>` each, with an id from a trailing `{#id}` or else
 * GitHub's slug of the heading, so a section can be linked), bullet and
 * numbered lists, fenced and indented code, links (a `#section` link stays in
 * the tab and scrolls to its heading), code, bold and italic spans with links
 * inside them, and paragraphs (0148 T6 (a)). Since T6 (b) it also takes GFM
 * tables, in a box that scrolls at phone width, blockquotes, and a list item's
 * own lines: the continuation lines of its text, and a fence, a paragraph or a
 * list indented inside it. Anything the renderer does not understand renders
 * as its own text rather than disappearing, which is the right failure for a
 * document.
 *
 * FINDING ONE'S WAY (the UX sweep, 2026-10-17). A guide is 4,000 to 20,000
 * px on a phone. Under its title it lists its sections, *On this page*, in
 * the guide's own language, and the way back to the index comes again after
 * it. A link among other words is underlined, not only under a mouse: the
 * link teal and the text grey are 1.08:1 apart. A code address may wrap
 * rather than push the page sideways. A link that opens a new tab says so to
 * a screen reader. The index is in the order of the titles, not of the file
 * names, and a guide or an address with no guide keeps Help's two tabs.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { GRANT_PROVIDERS, type GrantProvider } from '@openmig/shared';
import { useLocale, useT } from '../i18n/index.tsx';
import { STRINGS, LOCALES, type Locale } from '../i18n/strings.ts';
import { providerClientsApi } from '../services/mapping-service.ts';
import { isSelfHost } from '../services/edition.ts';
import { useSignedIn } from '../stores/signed-in.ts';
import { HelpTabs } from '../components/HelpTabs.tsx';

/** Every customer guide, `docs/guides/<locale>/<slug>.md`, inlined at build time. */
const GUIDES = import.meta.glob('../../../../docs/guides/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `…/docs/guides/en/box.md` → `box`; `box.md#connect` → `box`. */
function slugOf(path: string): string {
  return path.split('#')[0]!.split('/').pop()!.replace(/\.md$/, '');
}

/** The guides by language, then by slug. A `Map`, so no slug is an object's own property. */
export type GuideLibrary = Record<Locale, ReadonlyMap<string, string>>;

/** One language's guides: the files in `docs/guides/<locale>/`. */
function guidesIn(locale: Locale): ReadonlyMap<string, string> {
  return new Map(
    Object.entries(GUIDES)
      .filter(([path]) => path.split('/').slice(-2)[0] === locale)
      .map(([path, body]) => [slugOf(path), body]),
  );
}

const LIBRARY: GuideLibrary = { en: guidesIn('en'), nl: guidesIn('nl') };

/** The guides this build ships, by slug, in any language — for links elsewhere that must not 404. */
export const GUIDE_SLUGS: ReadonlySet<string> = new Set(
  LOCALES.flatMap((locale) => [...LIBRARY[locale].keys()]),
);

/**
 * A served guide's title in the reader's language, or in the other one where
 * the reader's has none; undefined for a guide this build does not ship. What
 * `GuideLink` names beside a refusal (0148 T7).
 */
export function servedGuideTitle(slug: string, locale: Locale): string | undefined {
  const picked = pickGuide(LIBRARY, slug, locale);
  return picked === undefined ? undefined : guideTitle(picked.body, slug);
}

/** A guide as the page shows it: its text, the language it is in, and whether that is not the reader's. */
export interface PickedGuide {
  body: string;
  lang: Locale;
  otherLanguage: boolean;
}

/**
 * The guide in the reader's language, or else in the other one, marked as
 * such (0148 T4). Undefined when neither language has it.
 */
export function pickGuide(library: GuideLibrary, slug: string, locale: Locale): PickedGuide | undefined {
  const own = library[locale].get(slug);
  if (own !== undefined) return { body: own, lang: locale, otherLanguage: false };
  for (const other of LOCALES) {
    if (other === locale) continue;
    const body = library[other].get(slug);
    if (body !== undefined) return { body, lang: other, otherLanguage: true };
  }
  return undefined;
}

/**
 * Where the operator and self-host documents are: the repository's `docs/`,
 * public on GitHub. The appliance's index links it (0148 D9).
 */
const OPERATOR_DOCS_URL = 'https://github.com/Robbes/Ownpace/tree/main/docs';

/**
 * A link among other words: underlined, since its colour alone does not set
 * it apart from the text around it (the UX sweep, 2026-10-17).
 */
const LINK_IN_TEXT = 'text-blue-700 underline underline-offset-2 hover:text-blue-900';

/**
 * Inline spans: `code`, **bold**, *italics*, [text](href). Escapes nothing
 * else. Bold may hold italics, a link or code, and is parsed again. Only the
 * asterisk makes italics: an underscore is left as written, since the guides
 * name scopes and fields such as `sharing.read` and `client_secret`.
 */
const Inline: React.FC<{ text: string }> = ({ text }) => {
  const t = useT();
  const parts: React.ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*(?=\S)(.+?)\*\*(?!\*)|\[([^\]]+)\]\(([^)]+)\)|\*(?=[^\s*])([^*]*[^\s*]|[^\s*])\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(
        <code key={key++} className="px-1 py-0.5 bg-gray-100 rounded text-[0.9em] font-mono break-words">
          {match[1]}
        </code>,
      );
    } else if (match[2] !== undefined) {
      // Parsed again, so a link written inside bold is a link.
      parts.push(
        <strong key={key++}>
          <Inline text={match[2]} />
        </strong>,
      );
    } else if (match[5] !== undefined) {
      parts.push(
        <em key={key++}>
          <Inline text={match[5]} />
        </em>,
      );
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const href = match[4];
      const label = <Inline text={match[3]} />;
      if (href.startsWith('#')) {
        // A section of this page: the same tab, and `GuideArticle` scrolls
        // to it once the address carries the hash.
        parts.push(
          <Link key={key++} to={href} className={LINK_IN_TEXT}>
            {label}
          </Link>,
        );
      } else if (href.startsWith('docs/') || /\.md(#|$)/.test(href)) {
        // Another guide, by its file name: `microsoft.md`, or `microsoft.md#own-app`.
        const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
        parts.push(
          <Link key={key++} to={`/docs/${slugOf(href)}${hash}`} className={LINK_IN_TEXT}>
            {label}
          </Link>,
        );
      } else {
        parts.push(
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className={LINK_IN_TEXT}
          >
            {label}
            <span className="sr-only"> {t('common.newTab')}</span>
          </a>,
        );
      }
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
};

/** Inline markdown reduced to the words a reader sees: for a title or a slug. */
function plainText(markdown: string): string {
  return markdown
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\s][^*]*)\*/g, '$1')
    .trim();
}

/**
 * GitHub's heading slug: lower case, punctuation dropped, each space a hyphen
 * (so `A — B` gives `a--b`). The guides' own `#section` links were written
 * against it, so they resolve here as they do on GitHub.
 */
function slugOfHeading(text: string): string {
  return plainText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** A trailing `{#id}` on a heading: the section's stable id (0148 T4's outline). */
const EXPLICIT_ID = /\s*\{#([A-Za-z0-9_-]+)\}\s*$/;

const HEADING = /^(#{1,4})\s+(.*)$/;
const FENCE = /^ {0,3}```/;
const QUOTE = /^ {0,3}> ?/;
/**
 * A list item's marker: `-`, `*`, `1.` or `1)`, after at most three spaces,
 * then the spaces before its text. Its whole length is how far the item's
 * own lines are indented.
 */
const LIST_ITEM = /^( {0,3})([-*]|(\d{1,9})[.)])( {1,4}|$)/;
/** GFM's delimiter row under a table's header: `| --- | :-: |`. */
const TABLE_DELIMITER = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
/** A line that ends a paragraph because it starts a block of its own. */
const BLOCK_START = /^(#{1,4}\s| {0,3}```| {0,3}>|\s*[-*]\s|\s*\d+[.)]\s)/;

type Align = 'left' | 'center' | 'right' | undefined;

type Block =
  | { kind: 'fence'; code: string }
  | { kind: 'indented'; code: string }
  | { kind: 'heading'; depth: number; text: string; id: string }
  | { kind: 'bullets'; items: Block[][] }
  | { kind: 'steps'; start: number; items: Block[][] }
  | { kind: 'table'; align: Align[]; head: string[]; rows: string[][] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'paragraph'; text: string };

/** Whether `lines[i]` opens a table: a row with a `|`, then the delimiter row. */
function opensTable(lines: readonly string[], i: number): boolean {
  const next = lines[i + 1];
  return lines[i]!.includes('|') && next !== undefined && next.includes('-') && TABLE_DELIMITER.test(next);
}

/**
 * A table row's cells: the outer pipes dropped, split on each `|` that is
 * neither escaped (`\|`) nor inside a code span.
 */
function cellsOf(row: string): string[] {
  let line = row.trim();
  if (line.startsWith('|')) line = line.slice(1);
  if (line.endsWith('|') && !line.endsWith('\\|')) line = line.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  let inCode = false;
  for (let k = 0; k < line.length; k += 1) {
    const c = line[k]!;
    if (c === '\\' && line[k + 1] === '|') {
      cell += '|';
      k += 1;
    } else if (c === '`') {
      inCode = !inCode;
      cell += c;
    } else if (c === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += c;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return undefined;
}

/** How many spaces a line starts with. */
function leadOf(line: string): number {
  return /^ */.exec(line)![0].length;
}

/**
 * Block level: fences, headings, lists, tables, quotes, indented code and
 * paragraphs. A list item's own lines, and a quote's, are parsed again as
 * blocks, so a fence, a list or a second paragraph inside them keeps its
 * shape. `usedIds` is shared, so a heading anywhere gets an id of its own.
 */
function parseBlocks(lines: readonly string[], usedIds: Set<string>): Block[] {
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (FENCE.test(line)) {
      const indent = leadOf(line);
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        code.push(lines[i]!.slice(Math.min(indent, leadOf(lines[i]!))));
        i += 1;
      }
      i += 1;
      out.push({ kind: 'fence', code: code.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const explicit = EXPLICIT_ID.exec(heading[2]!);
      const text = explicit ? heading[2]!.slice(0, explicit.index) : heading[2]!;
      // An id written in the guide is kept as written; a derived one takes
      // GitHub's suffix when the same heading appears twice.
      let id = explicit ? explicit[1]! : slugOfHeading(text);
      if (!explicit) {
        const base = id;
        for (let n = 1; usedIds.has(id); n += 1) id = `${base}-${n}`;
      }
      usedIds.add(id);
      out.push({ kind: 'heading', depth: heading[1]!.length, text, id });
      i += 1;
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = item[3] !== undefined;
      const start = ordered ? Number(item[3]) : 1;
      const items: Block[][] = [];
      let marker: RegExpExecArray | null = item;
      while (marker && (marker[3] !== undefined) === ordered) {
        // The item's own lines: its first, then every line indented to its
        // text, and a line run on from the one above it (GitHub's "lazy"
        // continuation). Blank lines stay inside while an indented line
        // follows them.
        const width = marker[4] === '' ? marker[0].length + 1 : marker[0].length;
        const body = [lines[i]!.slice(marker[0].length)];
        i += 1;
        while (i < lines.length) {
          const next = lines[i]!;
          if (next.trim() === '') {
            body.push('');
            i += 1;
            continue;
          }
          if (leadOf(next) >= width) {
            body.push(next.slice(width));
          } else if (body[body.length - 1] !== '' && !BLOCK_START.test(next) && !opensTable(lines, i)) {
            body.push(next.trimStart());
          } else {
            break;
          }
          i += 1;
        }
        while (body.length > 0 && body[body.length - 1] === '') body.pop();
        items.push(parseBlocks(body, usedIds));
        marker = i < lines.length ? LIST_ITEM.exec(lines[i]!) : null;
      }
      // The first number is kept, so steps a code block or a paragraph
      // interrupted carry on at the right count.
      out.push(ordered ? { kind: 'steps', start, items } : { kind: 'bullets', items });
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const next = lines[i]!;
        if (QUOTE.test(next)) inner.push(next.replace(QUOTE, ''));
        else if (next.trim() !== '' && inner[inner.length - 1]?.trim() && !BLOCK_START.test(next)) inner.push(next);
        else break;
        i += 1;
      }
      out.push({ kind: 'quote', blocks: parseBlocks(inner, usedIds) });
      continue;
    }

    if (opensTable(lines, i)) {
      const head = cellsOf(line);
      const align = cellsOf(lines[i + 1]!).map(alignOf);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim() !== '' && !BLOCK_START.test(lines[i]!)) {
        // A row with fewer cells is filled, one with more is cut, as GitHub does.
        const cells = cellsOf(lines[i]!);
        rows.push(head.map((_, n) => cells[n] ?? ''));
        i += 1;
      }
      out.push({ kind: 'table', align, head, rows });
      continue;
    }

    // Indented blocks in these guides are shell snippets and config samples.
    if (/^ {4,}\S/.test(line)) {
      const block: string[] = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]!) || lines[i]!.trim() === '')) {
        block.push(lines[i]!.replace(/^ {4}/, ''));
        i += 1;
      }
      out.push({ kind: 'indented', code: block.join('\n').trim() });
      continue;
    }

    // The first line is always taken, so a line no rule above claims (a
    // fifth `#`) is shown as text.
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      (paragraph.length === 0 || (!BLOCK_START.test(lines[i]!) && !opensTable(lines, i)))
    ) {
      paragraph.push(lines[i]!.trim());
      i += 1;
    }
    out.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }

  return out;
}

function parseGuide(body: string): Block[] {
  return parseBlocks(body.split('\n'), new Set<string>());
}

/**
 * A guide's title: its first heading, as a reader sees it. The slug when a
 * guide has no heading, so the index never shows an empty link.
 */
export function guideTitle(body: string, slug: string): string {
  const first = parseGuide(body).find((block) => block.kind === 'heading');
  return (first && plainText(first.text)) || slug;
}

/**
 * A guide's `#` is the page's `<h2>`: the frame's `<h1>` names the screen,
 * `Layout`'s or, without a session, `PublicDocs`'s.
 * `###` and `####` both land on `<h4>`, the deepest level a guide has.
 * `scroll-mt-20` keeps a heading that was scrolled to clear of the layout's
 * sticky header, which is at least `h-16`: on `/docs` its title is one word.
 */
const HEADING_TAG = { 1: 'h2', 2: 'h3', 3: 'h4', 4: 'h4' } as const;
const HEADING_SIZE = { 1: 'text-xl', 2: 'text-lg', 3: 'text-base', 4: 'text-base' } as const;

/** The section id 0148 T2 (c) folds: the steps to create an app of one's own. */
const OWN_APP_ID = 'own-app';

/**
 * A list item: its first paragraph as the item's own text, as a list of
 * one-line items always read, then anything else it holds (a second
 * paragraph, a fence, a list) as blocks of their own.
 */
const ItemView: React.FC<{ blocks: Block[] }> = ({ blocks }) => {
  const [first, ...rest] = blocks;
  if (first === undefined) return null;
  return (
    <>
      {first.kind === 'paragraph' ? <Inline text={first.text} /> : <BlockView block={first} />}
      {rest.map((block, n) => (
        <BlockView key={n} block={block} />
      ))}
    </>
  );
};

/** One block, as the page shows it. */
const BlockView: React.FC<{ block: Block }> = ({ block }) => {
  switch (block.kind) {
    case 'fence':
      return (
        <pre className="my-3 p-3 bg-gray-900 text-gray-100 rounded overflow-x-auto text-xs">
          <code>{block.code}</code>
        </pre>
      );
    case 'indented':
      return (
        <pre className="my-3 p-3 bg-gray-100 rounded overflow-x-auto text-xs">
          <code>{block.code}</code>
        </pre>
      );
    case 'heading': {
      const depth = block.depth as keyof typeof HEADING_TAG;
      const Tag = HEADING_TAG[depth];
      return (
        <Tag id={block.id} className={`${HEADING_SIZE[depth]} font-semibold text-gray-900 mt-5 mb-2 scroll-mt-20`}>
          <Inline text={block.text} />
        </Tag>
      );
    }
    case 'bullets':
      return (
        <ul className="my-2 list-disc pl-6 space-y-1 text-gray-700">
          {block.items.map((item, n) => (
            <li key={n}>
              <ItemView blocks={item} />
            </li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol
          start={block.start === 1 ? undefined : block.start}
          className="my-2 list-decimal pl-6 space-y-1 text-gray-700"
        >
          {block.items.map((item, n) => (
            <li key={n}>
              <ItemView blocks={item} />
            </li>
          ))}
        </ol>
      );
    case 'table':
      // Wider than a phone, the table scrolls inside its own box rather than
      // the page; the box takes the focus, so a keyboard can scroll it too.
      return (
        <div
          role="region"
          aria-label={block.head.map(plainText).join(', ')}
          tabIndex={0}
          className="my-3 overflow-x-auto"
        >
          <table className="min-w-full border-collapse text-sm text-gray-700">
            <thead>
              <tr>
                {block.head.map((cell, n) => (
                  <th
                    key={n}
                    scope="col"
                    style={{ textAlign: block.align[n] ?? 'left' }}
                    className="border-b border-gray-300 px-3 py-2 font-semibold text-gray-900 align-bottom"
                  >
                    <Inline text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, n) => (
                    <td
                      key={n}
                      style={{ textAlign: block.align[n] ?? 'left' }}
                      className="border-b border-gray-200 px-3 py-2 align-top"
                    >
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'quote':
      return (
        <blockquote className="my-3 border-l-4 border-gray-200 pl-4 text-gray-600">
          {block.blocks.map((inner, n) => (
            <BlockView key={n} block={inner} />
          ))}
        </blockquote>
      );
    case 'paragraph':
      return (
        <p className="my-2 text-gray-700 leading-relaxed">
          <Inline text={block.text} />
        </p>
      );
  }
};

/**
 * The own-app section's body, folded (0148 T2 (c)). Closed where this
 * deployment carries the provider's app, open otherwise, and opened whenever
 * the address names the section or a heading inside it, so a link to the
 * redirect-address step never lands on a closed fold. A reader's own toggle
 * holds until one of those changes.
 */
const OwnAppFold: React.FC<{
  folded: boolean;
  /** The address names the section, or a heading inside it. */
  named: boolean;
  /** The location's key, so a second press of the same link opens it again. */
  visit: string;
  summary: string;
  children: React.ReactNode;
}> = ({ folded, named, visit, summary, children }) => {
  const [open, setOpen] = useState(!folded || named);
  // Adjusted during render rather than in an effect, so the fold is open in
  // the same commit that `GuideArticle` scrolls to the heading inside it.
  const [seen, setSeen] = useState({ folded, named, visit });
  if (seen.folded !== folded || seen.named !== named || seen.visit !== visit) {
    setSeen({ folded, named, visit });
    if (named) setOpen(true);
    else if (seen.folded !== folded) setOpen(!folded);
  }
  return (
    <details
      open={open}
      // Only a change: the toggle that follows the page's own opening or
      // closing echoes the state, and that no-op update, left queued, made
      // React drop the opening a `#own-app` link asks for above (the UX
      // sweep, 2026-10-17, found it through the outline's link).
      onToggle={(event) => {
        if (event.currentTarget.open !== open) setOpen(event.currentTarget.open);
      }}
      className="my-2 border-l-2 border-gray-200 pl-4"
    >
      <summary className="cursor-pointer text-sm text-blue-700 hover:underline">{summary}</summary>
      {children}
    </details>
  );
};

/**
 * *On this page*: a guide's sections, in the guide's language, each a link
 * that stays in the tab and scrolls to its heading, as a `#section` link in
 * the text does (and opens the own-app fold, which its heading names).
 */
const Outline: React.FC<{ lang: Locale; sections: ReadonlyArray<{ id: string; text: string }> }> = ({
  lang,
  sections,
}) => (
  <nav aria-label={STRINGS[lang]['docs.onThisPage']} className="my-3">
    <p className="text-sm font-medium text-gray-700">{STRINGS[lang]['docs.onThisPage']}</p>
    <ul className="mt-1 space-y-1 text-sm">
      {sections.map((section) => (
        <li key={section.id}>
          <Link to={`#${section.id}`} className="text-blue-700 underline underline-offset-2">
            {plainText(section.text)}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
);

const Markdown: React.FC<{
  body: string;
  lang: Locale;
  ownAppFolded: boolean;
  /** The id the address names, if any. */
  target: string;
  visit: string;
}> = ({ body, lang, ownAppFolded, target, visit }) => {
  const blocks = parseGuide(body);
  // The guide's sections, its `##`s, for the outline under its title.
  const sections = blocks.filter(
    (block): block is Extract<Block, { kind: 'heading' }> => block.kind === 'heading' && block.depth === 2,
  );
  let outlined = false;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    out.push(<BlockView key={i} block={block} />);
    if (!outlined && block.kind === 'heading' && block.depth === 1 && sections.length > 0) {
      outlined = true;
      out.push(<Outline key="outline" lang={lang} sections={sections} />);
    }
    if (block.kind !== 'heading' || block.id !== OWN_APP_ID) continue;

    // Everything under the own-app heading, to the next heading of its level
    // or above, folds. The heading stays outside, so it can still be linked.
    const inside: React.ReactNode[] = [];
    const ids = new Set([block.id]);
    let j = i + 1;
    for (; j < blocks.length; j += 1) {
      const next = blocks[j]!;
      if (next.kind === 'heading') {
        if (next.depth <= block.depth) break;
        ids.add(next.id);
      }
      inside.push(<BlockView key={j} block={next} />);
    }
    out.push(
      <OwnAppFold
        key={`fold-${i}`}
        folded={ownAppFolded}
        named={ids.has(target)}
        visit={visit}
        summary={STRINGS[lang]['docs.ownAppFold']}
      >
        {inside}
      </OwnAppFold>,
    );
    i = j - 1;
  }
  return <>{out}</>;
};

/** The id a location's hash names; a hash that is not valid percent-encoding is taken as written. */
function idFromHash(hash: string): string {
  const raw = hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * One guide, as an article in the guide's language. When the address names a
 * section — a `#section` link on the page, or a link from elsewhere to
 * `/docs/<slug>#<id>` — it scrolls to that heading. A client-side navigation
 * does not scroll by itself, and on a first load the browser looks for the id
 * before the guide has rendered. `key` is in the dependencies so a second
 * click on the same link scrolls again.
 *
 * `ownAppFolded` closes the `{#own-app}` section where this deployment
 * carries the provider's app (0148 T2 (c)).
 */
export const GuideArticle: React.FC<{ body: string; lang: Locale; ownAppFolded?: boolean }> = ({
  body,
  lang,
  ownAppFolded = false,
}) => {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!hash) return;
    document.getElementById(idFromHash(hash))?.scrollIntoView();
  }, [hash, key, body]);

  return (
    <article lang={lang} className="mt-2">
      <Markdown
        body={body}
        lang={lang}
        ownAppFolded={ownAppFolded}
        target={hash ? idFromHash(hash) : ''}
        visit={key}
      />
    </article>
  );
};

/**
 * Every served guide by its title, in the reader's language or the one it
 * falls back to, in the order of those titles in the reader's alphabet: the
 * index, and the not-found page. It was the order of the file names, so
 * *Export archive* (`archive`) sat between Apple and Box.
 */
const GuideList: React.FC<{ className: string; locale: Locale }> = ({ className, locale }) => (
  <ul className={className}>
    {[...GUIDE_SLUGS]
      .map((slug) => {
        const picked = pickGuide(LIBRARY, slug, locale)!;
        return { slug, picked, title: guideTitle(picked.body, slug) };
      })
      .sort((a, b) => a.title.localeCompare(b.title, locale))
      .map(({ slug, picked, title }) => (
        <li key={slug}>
          <Link
            to={`/docs/${slug}`}
            lang={picked.lang}
            className="group flex items-center justify-between gap-3 py-3 text-blue-700"
          >
            <span className="group-hover:underline">{title}</span>
            <ChevronRight className="w-4 h-4 shrink-0 text-gray-400 group-hover:text-blue-700" aria-hidden="true" />
          </Link>
        </li>
      ))}
  </ul>
);

/** The provider a guide's own-app section is about: its slug, where that names one. */
function grantProviderOf(slug: string | undefined): GrantProvider | undefined {
  return (GRANT_PROVIDERS as readonly string[]).includes(slug ?? '') ? (slug as GrantProvider) : undefined;
}

const Docs: React.FC = () => {
  const { locale, t } = useLocale();
  const { slug } = useParams<{ slug: string }>();
  const picked = slug ? pickGuide(LIBRARY, slug, locale) : undefined;

  // Does this deployment carry that provider's app? The fact the wizard and
  // the consent panel read, under their query key, so the three screens share
  // one answer. Until it arrives, where it never does (the appliance serves no
  // such route), and for a visitor without a session, who is not asked for it
  // (the header says why), the section stays open: the direction that cannot
  // hide a step somebody needs.
  const signedIn = useSignedIn();
  const provider = picked ? grantProviderOf(slug) : undefined;
  const { data: providerClients } = useQuery({
    queryKey: ['provider-clients'],
    queryFn: providerClientsApi.get,
    retry: false,
    staleTime: Infinity,
    enabled: provider !== undefined && signedIn,
  });
  const ownAppFolded = provider !== undefined && providerClients?.[provider] === 'deployment';

  // EACH VIEW IS ONE WHITE CARD (2026-10-05), as the app's other pages put
  // their content: the owner found Help drawn straight on the paper. The
  // card's `p-6` is what the public guides' header lines up with
  // (`PublicDocs`).
  if (!slug) {
    return (
      <div className="max-w-3xl">
        <HelpTabs />
        <section aria-labelledby="docs-title" className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 id="docs-title" className="text-lg font-semibold text-gray-900">
            {t('docs.title')}
          </h2>
          <GuideList className="mt-2 divide-y divide-gray-200" locale={locale} />
          {isSelfHost() && (
            // Only the appliance: its owner also runs it, and what this page
            // stopped serving in 0148 T1 is theirs (D9).
            <p className="mt-4 text-sm text-gray-600">
              <a href={OPERATOR_DOCS_URL} target="_blank" rel="noreferrer noopener" className="text-blue-700 hover:underline">
                {t('docs.operatorDocs')}
                <span className="sr-only"> {t('common.newTab')}</span>
              </a>
            </p>
          )}
        </section>
      </div>
    );
  }

  if (!picked) {
    // Naming what DOES exist beats a bare 404 when somebody followed a stale
    // reference from a refusal message.
    return (
      <div className="max-w-3xl">
        <HelpTabs />
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-gray-700">{t('docs.notFound')}</p>
          <GuideList className="mt-2 divide-y divide-gray-200" locale={locale} />
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <HelpTabs />
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <Link to="/docs" className="text-sm text-blue-700 hover:underline">
          {t('docs.all')}
        </Link>
        {picked.otherLanguage && (
          // In the reader's language, about the guide below, which is not.
          <p lang={locale} className="mt-3 p-3 rounded bg-amber-50 text-sm text-amber-900">
            {t('docs.otherLanguage')}
          </p>
        )}
        <GuideArticle body={picked.body} lang={picked.lang} ownAppFolded={ownAppFolded} />
        {/* The way back again at the end: a guide is a long page on a phone. */}
        <Link to="/docs" className="mt-6 inline-block text-sm text-blue-700 hover:underline">
          {t('docs.all')}
        </Link>
      </div>
    </div>
  );
};

export default Docs;
