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
 * The renderer below is deliberately small — headings, lists, code, links,
 * emphasis, paragraphs — because these documents are prose and tables, not a
 * CMS. Anything it does not understand renders as its own text rather than
 * disappearing, which is the right failure for a document.
 */

import React from 'react';
import { useParams, Link } from 'react-router';
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
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const href = match[4];
      const internal = href.startsWith('docs/') || href.endsWith('.md');
      parts.push(
        internal ? (
          <Link key={key++} to={`/docs/${slugOf(href)}`} className="text-blue-700 hover:underline">
            {match[3]}
          </Link>
        ) : (
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-blue-700 hover:underline"
          >
            {match[3]}
          </a>
        ),
      );
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
};

/** Block level: headings, fenced code, bullets, everything else a paragraph. */
const Markdown: React.FC<{ body: string }> = ({ body }) => {
  const out: React.ReactNode[] = [];
  const lines = body.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith('```')) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i++]!);
      i += 1;
      out.push(
        <pre key={key++} className="my-3 p-3 bg-gray-900 text-gray-100 rounded overflow-x-auto text-xs">
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const depth = heading[1]!.length;
      const text = heading[2]!;
      const size =
        depth === 1 ? 'text-xl' : depth === 2 ? 'text-lg' : 'text-base';
      out.push(
        <p key={key++} className={`${size} font-semibold text-gray-900 mt-5 mb-2`}>
          <Inline text={text} />
        </p>,
      );
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      out.push(
        <ul key={key++} className="my-2 list-disc pl-6 space-y-1 text-gray-700">
          {items.map((item, n) => (
            <li key={n}>
              <Inline text={item} />
            </li>
          ))}
        </ul>,
      );
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
      out.push(
        <pre key={key++} className="my-3 p-3 bg-gray-100 rounded overflow-x-auto text-xs">
          <code>{block.join('\n').trim()}</code>
        </pre>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !/^(#{1,4}\s|```|\s*[-*]\s)/.test(lines[i]!)) {
      paragraph.push(lines[i]!);
      i += 1;
    }
    out.push(
      <p key={key++} className="my-2 text-gray-700 leading-relaxed">
        <Inline text={paragraph.join(' ')} />
      </p>,
    );
  }

  return <>{out}</>;
};

const Docs: React.FC = () => {
  const t = useT();
  const { slug } = useParams<{ slug: string }>();
  const body = slug ? BY_SLUG[slug] : undefined;

  if (!slug) {
    return (
      <div className="p-6 max-w-3xl">
        <h2 className="text-xl font-semibold text-gray-900">{t('docs.title')}</h2>
        <ul className="mt-4 space-y-2">
          {Object.keys(BY_SLUG)
            .sort()
            .map((s) => (
              <li key={s}>
                <Link to={`/docs/${s}`} className="text-blue-700 hover:underline">
                  {s}
                </Link>
              </li>
            ))}
        </ul>
      </div>
    );
  }

  if (!body) {
    // Naming what DOES exist beats a bare 404 when somebody followed a stale
    // reference from a refusal message.
    return (
      <div className="p-6 max-w-3xl">
        <p className="text-gray-700">{t('docs.notFound')}</p>
        <ul className="mt-3 space-y-2">
          {Object.keys(BY_SLUG)
            .sort()
            .map((s) => (
              <li key={s}>
                <Link to={`/docs/${s}`} className="text-blue-700 hover:underline">
                  {s}
                </Link>
              </li>
            ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <Link to="/docs" className="text-sm text-blue-700 hover:underline">
        {t('docs.all')}
      </Link>
      <article className="mt-2">
        <Markdown body={body} />
      </article>
    </div>
  );
};

export default Docs;
