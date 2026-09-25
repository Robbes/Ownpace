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
 * The renderer below is deliberately small, and extended rather than replaced
 * by a library (workplan 0148 D6): the guides are ours and short. It takes
 * headings (an `<h2>`–`<h4>` each, with an id from a trailing `{#id}` or else
 * GitHub's slug of the heading, so a section can be linked), bullet and
 * numbered lists, fenced and indented code, links (a `#section` link stays in
 * the tab and scrolls to its heading), code and bold spans with links inside
 * them, and paragraphs. Tables, blockquotes, a list item's continuation lines
 * and a fence indented inside a list are 0148 T6 (b), after the first
 * invitation; a guide is written without them until then, and
 * `Docs.unit.test.tsx` fails when one is used. Anything the renderer does not
 * understand renders as its own text rather than disappearing, which is the
 * right failure for a document.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { GRANT_PROVIDERS, type GrantProvider } from '@openmig/shared';
import { useLocale } from '../i18n/index.tsx';
import { STRINGS, LOCALES, type Locale } from '../i18n/strings.ts';
import { providerClientsApi } from '../services/mapping-service.ts';
import { isSelfHost } from '../services/edition.ts';

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
      } else if (href.startsWith('docs/') || /\.md(#|$)/.test(href)) {
        // Another guide, by its file name: `microsoft.md`, or `microsoft.md#own-app`.
        const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
        parts.push(
          <Link key={key++} to={`/docs/${slugOf(href)}${hash}`} className="text-blue-700 hover:underline">
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

/**
 * A guide's `#` is the page's `<h2>`: the layout's `<h1>` names the screen.
 * `###` and `####` both land on `<h4>`, the deepest level a guide has.
 * `scroll-mt-20` keeps a heading that was scrolled to clear of the layout's
 * sticky header, which is `h-16`.
 */
const HEADING_TAG = { 1: 'h2', 2: 'h3', 3: 'h4', 4: 'h4' } as const;
const HEADING_SIZE = { 1: 'text-xl', 2: 'text-lg', 3: 'text-base', 4: 'text-base' } as const;

/** The section id 0148 T2 (c) folds: the steps to create an app of one's own. */
const OWN_APP_ID = 'own-app';

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
              <Inline text={item} />
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
              <Inline text={item} />
            </li>
          ))}
        </ol>
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
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="my-2 border-l-2 border-gray-200 pl-4"
    >
      <summary className="cursor-pointer text-sm text-blue-700 hover:underline">{summary}</summary>
      {children}
    </details>
  );
};

const Markdown: React.FC<{
  body: string;
  lang: Locale;
  ownAppFolded: boolean;
  /** The id the address names, if any. */
  target: string;
  visit: string;
}> = ({ body, lang, ownAppFolded, target, visit }) => {
  const blocks = parseGuide(body);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    out.push(<BlockView key={i} block={block} />);
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
 * falls back to, in a stable order: the index, and the not-found page.
 */
const GuideList: React.FC<{ className: string; locale: Locale }> = ({ className, locale }) => (
  <ul className={className}>
    {[...GUIDE_SLUGS].sort().map((s) => {
      const picked = pickGuide(LIBRARY, s, locale)!;
      return (
        <li key={s}>
          <Link to={`/docs/${s}`} lang={picked.lang} className="text-blue-700 hover:underline">
            {guideTitle(picked.body, s)}
          </Link>
        </li>
      );
    })}
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
  // one answer. Until it arrives, and where it never does (the appliance
  // serves no such route), the section stays open: the direction that cannot
  // hide a step somebody needs.
  const provider = picked ? grantProviderOf(slug) : undefined;
  const { data: providerClients } = useQuery({
    queryKey: ['provider-clients'],
    queryFn: providerClientsApi.get,
    retry: false,
    staleTime: Infinity,
    enabled: provider !== undefined,
  });
  const ownAppFolded = provider !== undefined && providerClients?.[provider] === 'deployment';

  if (!slug) {
    return (
      <div className="p-6 max-w-3xl">
        <h2 className="text-xl font-semibold text-gray-900">{t('docs.title')}</h2>
        <GuideList className="mt-4 space-y-2" locale={locale} />
        {isSelfHost() && (
          // Only the appliance: its owner also runs it, and what this page
          // stopped serving in 0148 T1 is theirs (D9).
          <p className="mt-6 text-sm text-gray-600">
            <a href={OPERATOR_DOCS_URL} target="_blank" rel="noreferrer noopener" className="text-blue-700 hover:underline">
              {t('docs.operatorDocs')}
            </a>
          </p>
        )}
      </div>
    );
  }

  if (!picked) {
    // Naming what DOES exist beats a bare 404 when somebody followed a stale
    // reference from a refusal message.
    return (
      <div className="p-6 max-w-3xl">
        <p className="text-gray-700">{t('docs.notFound')}</p>
        <GuideList className="mt-3 space-y-2" locale={locale} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
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
    </div>
  );
};

export default Docs;
