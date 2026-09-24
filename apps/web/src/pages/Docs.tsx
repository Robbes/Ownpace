// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The setup guides, in the app (workplan 0063).
 *
 * The wizard's panels and several refusals name documents by FILENAME —
 * "docs/box-setup.md walks through each step" — which is actionable if you
 * have the repository checked out and useless if you are a managed customer
 * in a browser. This route makes those references real links.
 *
 * The markdown is imported AT BUILD TIME from the repository's own `docs/`
 * directory, so the guide ships with the code that implements it. That is the
 * whole reason not to host these separately: a setup doc that can drift from
 * its connector is how a customer follows five correct steps and one that
 * stopped being true two releases ago.
 *
 * The renderer below is deliberately small, and extended rather than replaced
 * by a library (workplan 0148 D6): the guides are ours and short. It takes
 * headings (an `<h2>`–`<h4>` each, with an id from a trailing `{#id}` or else
 * GitHub's slug of the heading, so a section can be linked), bullet and
 * numbered lists, fenced and indented code, links (a `#section` link stays in
 * the tab and scrolls to its heading), code and bold spans with links inside
 * them, and paragraphs. Tables, blockquotes, a list item's continuation lines
 * and a fence indented inside a list are 0148 T6 (b), after the first
 * invitation; until then a guide is written without them. Anything the
 * renderer does not understand renders as its own text rather than
 * disappearing, which is the right failure for a document.
 */

import React, { useEffect } from 'react';
import { useParams, useLocation, Link } from 'react-router';
import { useT } from '../i18n/index.tsx';

/** Every guide in the repo's docs/ directory, inlined at build time. */
const GUIDES = import.meta.glob('../../../../docs/*-setup.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `…/docs/box-setup.md` → `box-setup`. */
function slugOf(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/, '');
}

const BY_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(GUIDES).map(([path, body]) => [slugOf(path), body]),
);

/** The guides this build ships, by slug — for links elsewhere that must not 404. */
export const GUIDE_SLUGS: ReadonlySet<string> = new Set(Object.keys(BY_SLUG));

/** Inline spans: `code`, **bold**, [text](href). Escapes nothing else. */
const Inline: React.FC<{ text: string }> = ({ text }) => {
  const parts: React.ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(
        <code key={key++} className="px-1 py-0.5 bg-gray-100 rounded text-[0.9em] font-mono">
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
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const href = match[4];
      const label = <Inline text={match[3]} />;
      if (href.startsWith('#')) {
        // A section of this page: the same tab, and `GuideArticle` scrolls
        // to it once the address carries the hash.
        parts.push(
          <Link key={key++} to={href} className="text-blue-700 hover:underline">
            {label}
          </Link>,
        );
      } else if (href.startsWith('docs/') || href.endsWith('.md')) {
        parts.push(
          <Link key={key++} to={`/docs/${slugOf(href)}`} className="text-blue-700 hover:underline">
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
            className="text-blue-700 hover:underline"
          >
            {label}
          </a>,
        );
      }
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
};

/**
 * The language the served guides are written in, set as `lang` on what shows
 * their text, so a Dutch page does not read an English guide under
 * `lang="nl"`. Every guide served today is English; workplan 0148 T4 serves
 * `docs/guides/<locale>/` and picks this per guide.
 */
const GUIDE_LANG = 'en';

/** Inline markdown reduced to the words a reader sees: for a title or a slug. */
function plainText(markdown: string): string {
  return markdown
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
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
const BULLET = /^\s*[-*]\s+/;
const STEP = /^\s*(\d+)\.\s+/;
/** A line that ends a paragraph because it starts a block of its own. */
const BLOCK_START = /^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s)/;

type Block =
  | { kind: 'fence'; code: string }
  | { kind: 'indented'; code: string }
  | { kind: 'heading'; depth: number; text: string; id: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'steps'; start: number; items: string[] }
  | { kind: 'paragraph'; text: string };

/** Block level: fences, headings, bullets, numbered steps, indented code, paragraphs. */
function parseGuide(body: string): Block[] {
  const out: Block[] = [];
  const lines = body.split('\n');
  const usedIds = new Set<string>();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith('```')) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i++]!);
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

    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i]!)) {
        items.push(lines[i]!.replace(BULLET, ''));
        i += 1;
      }
      out.push({ kind: 'bullets', items });
      continue;
    }

    const step = STEP.exec(line);
    if (step) {
      const items: string[] = [];
      while (i < lines.length && STEP.test(lines[i]!)) {
        items.push(lines[i]!.replace(STEP, ''));
        i += 1;
      }
      // The first number is kept, so steps a sub-list or a code block
      // interrupted carry on at the right count.
      out.push({ kind: 'steps', start: Number(step[1]), items });
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Indented blocks in these guides are shell snippets and config samples.
    if (/^ {4}\S/.test(line)) {
      const block: string[] = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]!) || lines[i]!.trim() === '')) {
        block.push(lines[i]!.replace(/^ {4}/, ''));
        i += 1;
      }
      out.push({ kind: 'indented', code: block.join('\n').trim() });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !BLOCK_START.test(lines[i]!)) {
      paragraph.push(lines[i]!);
      i += 1;
    }
    out.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }

  return out;
}

/**
 * A guide's title: its first heading, as a reader sees it. The slug when a
 * guide has no heading, so the index never shows an empty link.
 */
export function guideTitle(body: string, slug: string): string {
  const first = parseGuide(body).find((block) => block.kind === 'heading');
  return (first && plainText(first.text)) || slug;
}

const TITLES: Record<string, string> = Object.fromEntries(
  Object.entries(BY_SLUG).map(([slug, body]) => [slug, guideTitle(body, slug)]),
);

/**
 * A guide's `#` is the page's `<h2>`: the layout's `<h1>` names the screen.
 * `###` and `####` both land on `<h4>`, the deepest level a guide has.
 * `scroll-mt-20` keeps a heading that was scrolled to clear of the layout's
 * sticky header, which is `h-16`.
 */
const HEADING_TAG = { 1: 'h2', 2: 'h3', 3: 'h4', 4: 'h4' } as const;
const HEADING_SIZE = { 1: 'text-xl', 2: 'text-lg', 3: 'text-base', 4: 'text-base' } as const;

const Markdown: React.FC<{ body: string }> = ({ body }) => (
  <>
    {parseGuide(body).map((block, key) => {
      switch (block.kind) {
        case 'fence':
          return (
            <pre key={key} className="my-3 p-3 bg-gray-900 text-gray-100 rounded overflow-x-auto text-xs">
              <code>{block.code}</code>
            </pre>
          );
        case 'indented':
          return (
            <pre key={key} className="my-3 p-3 bg-gray-100 rounded overflow-x-auto text-xs">
              <code>{block.code}</code>
            </pre>
          );
        case 'heading': {
          const depth = block.depth as keyof typeof HEADING_TAG;
          const Tag = HEADING_TAG[depth];
          return (
            <Tag
              key={key}
              id={block.id}
              className={`${HEADING_SIZE[depth]} font-semibold text-gray-900 mt-5 mb-2 scroll-mt-20`}
            >
              <Inline text={block.text} />
            </Tag>
          );
        }
        case 'bullets':
          return (
            <ul key={key} className="my-2 list-disc pl-6 space-y-1 text-gray-700">
              {block.items.map((item, n) => (
                <li key={n}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        case 'steps':
          return (
            <ol
              key={key}
              start={block.start === 1 ? undefined : block.start}
              className="my-2 list-decimal pl-6 space-y-1 text-gray-700"
            >
              {block.items.map((item, n) => (
                <li key={n}>
                  <Inline text={item} />
                </li>
              ))}
            </ol>
          );
        case 'paragraph':
          return (
            <p key={key} className="my-2 text-gray-700 leading-relaxed">
              <Inline text={block.text} />
            </p>
          );
      }
    })}
  </>
);

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
 */
export const GuideArticle: React.FC<{ body: string }> = ({ body }) => {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!hash) return;
    document.getElementById(idFromHash(hash))?.scrollIntoView();
  }, [hash, key, body]);

  return (
    <article lang={GUIDE_LANG} className="mt-2">
      <Markdown body={body} />
    </article>
  );
};

/** Every served guide by its title, in a stable order: the index, and the not-found page. */
const GuideList: React.FC<{ className: string }> = ({ className }) => (
  <ul className={className}>
    {Object.keys(BY_SLUG)
      .sort()
      .map((s) => (
        <li key={s}>
          <Link to={`/docs/${s}`} lang={GUIDE_LANG} className="text-blue-700 hover:underline">
            {TITLES[s]}
          </Link>
        </li>
      ))}
  </ul>
);

const Docs: React.FC = () => {
  const t = useT();
  const { slug } = useParams<{ slug: string }>();
  const body = slug ? BY_SLUG[slug] : undefined;

  if (!slug) {
    return (
      <div className="p-6 max-w-3xl">
        <h2 className="text-xl font-semibold text-gray-900">{t('docs.title')}</h2>
        <GuideList className="mt-4 space-y-2" />
      </div>
    );
  }

  if (!body) {
    // Naming what DOES exist beats a bare 404 when somebody followed a stale
    // reference from a refusal message.
    return (
      <div className="p-6 max-w-3xl">
        <p className="text-gray-700">{t('docs.notFound')}</p>
        <GuideList className="mt-3 space-y-2" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <Link to="/docs" className="text-sm text-blue-700 hover:underline">
        {t('docs.all')}
      </Link>
      <GuideArticle body={body} />
    </div>
  );
};

export default Docs;
