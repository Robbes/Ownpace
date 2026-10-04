#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * build.mjs — the public site, generated into `site/dist/`.
 *
 *   node site/build.mjs            # build
 *   node site/build.mjs --check    # build to memory and report, writing nothing
 *
 * `--check` with `--public` exits 1 when a legal page's *Version* line says it
 * is a draft, as the `--public` build refuses it (workplan 0139 T2). Its
 * placeholder count stays a count, which a caller reads.
 *
 * WHY IT IMPORTS NOTHING. `site/` depends on no workspace package and no
 * npm dependency, deliberately, twice over: workplan 0086 T7 wants the public
 * pages splittable into their own deploy without a migration, and the
 * `no-managed-leakage` walk (ADR-0036) is easier to keep true when the public
 * site cannot reach the app at all. That costs a small Markdown renderer,
 * which is below.
 *
 * WHAT IT RENDERS. Enough Markdown for the two legal documents and the prose
 * pages, and no more: headings, paragraphs, bullet and numbered lists, tables,
 * blockquotes, horizontal rules, and inline code/bold/italic/links.
 * `site/site.unit.test.ts` asserts no source construct survives into the
 * output unrendered, which is how this stays honest as the documents change
 * rather than by hoping the subset is still enough.
 *
 * THE «PLACEHOLDER» TOKENS in the legal documents are rendered VISIBLY, as a
 * marked span, and the build prints how many it found. They are drafts
 * (site/legal/README.md lists every one); a draft that looks finished is the
 * thing to avoid, so on this site an unfilled placeholder is loud.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  TIERS,
  BEYOND,
  SUPPORT_EMAIL,
  REQUEST_ACCESS_URL,
  SIGN_IN_URL,
  APP_URL,
  PUBLIC_APP_URL,
  STATUS_URL,
  money,
  size,
  total,
} from './prices.mjs';
import { freeTier as free, deriveTier, GMAIL_IMAP_GB_PER_DAY } from './calculator.mjs';
import { securityTxt } from './security-txt.mjs';
import { LOCALES, DEFAULT_LOCALE, localeRoot, COPY } from './copy.mjs';
import { CUSTOMER_TYPES, INDICATIVE_PROFILES, OBJECT_TYPES, PROFILES_VERSION } from './profiles.mjs';
import { DATA_TYPES, DESTINATIONS, PROTOCOL_NAMES } from './destinations.mjs';
import { SPRITE, icon } from './icons.mjs';
import { LEAVING, DOMAIN_OF, EXPORT_TARGETS } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist');

/**
 * Whether this build is for the PUBLIC site.
 *
 * Defaults to false, and the default is the whole point: a test host carries
 * the legal documents with their placeholders unfilled, and a draft reading
 * «LEGAL_ENTITY» must never be indexable. Fail-safe means the build that
 * forgets to say which it is produces the harmless one.
 *
 *   node site/build.mjs             -> noindex (test hosts)
 *   node site/build.mjs --public    -> indexable (www.ownpace.eu only)
 *
 * `robots.txt` alone is not enough — it asks a crawler not to *fetch*, which
 * does not stop a URL discovered elsewhere from being listed. The meta tag is
 * what actually says "do not index", so both are emitted.
 */
const PUBLIC = process.argv.includes('--public');

/**
 * THE TWO SWITCHES HAVE TO AGREE.
 *
 * `--public` and `OWNPACE_APP_URL` both say which environment this build is
 * for, and nothing compared them until now. Either contradiction ships a real
 * mistake:
 *
 *   --public with a test app URL   an indexable production site whose every
 *                                  call to action leads somewhere private.
 *   no --public with production    a noindex test site handing its visitors to
 *                                  the real app — which is what put
 *                                  `https://app.ownpace.eu/request-access` on
 *                                  `www.ota.ownpace.eu` on 2026-08-24. A click
 *                                  there files a real access request against
 *                                  the real tenant.
 *
 * Requiring the variable stopped the SILENT case (a forgotten default). This
 * stops the CONTRADICTORY one. Refuse, rather than deriving one from the other:
 * deriving would mean `--public` silently rewriting an operator's explicit
 * URL, which is a different way of not being told.
 */
if (PUBLIC && APP_URL !== PUBLIC_APP_URL) {
  throw new Error(
    `--public builds the site for ${PUBLIC_APP_URL}, but OWNPACE_APP_URL is ${APP_URL}.\n` +
      'An indexable public site whose "Request access" buttons lead somewhere\n' +
      'private is not a site anybody can use. Drop --public, or set\n' +
      `OWNPACE_APP_URL=${PUBLIC_APP_URL}.`,
  );
}
if (!PUBLIC && APP_URL === PUBLIC_APP_URL) {
  throw new Error(
    `OWNPACE_APP_URL is ${PUBLIC_APP_URL} — production — but this is a test build\n` +
      '(no --public), so it will be served on a test host with noindex set. Its\n' +
      '"Request access" buttons would hand test visitors to the real app, and a\n' +
      'click there files a real access request against the real tenant.\n' +
      'Set the test app\u2019s URL, or pass --public if this really is production.',
  );
}

/**
 * Whether this build is for the ALPHA (workplan 0144 T1).
 *
 * The same one setting the API and the web build read for it,
 * `OWNPACE_STAGE=alpha` (0131 T1; `alphaFrom` in `apps/api/src/access-notify.ts`
 * and `apps/web/src/services/stage.ts` hold the same rule). `alpha`, trimmed and
 * in any case, is the only value that turns it on; unset, empty or anything
 * else is off, which is every deployment whose `.env` does not say alpha. The
 * rule is written out here rather than imported, because `site/` imports
 * nothing.
 *
 * It decides one thing: whether the pages in `ALPHA_ONLY` are rendered. A
 * build without it leaves them out, so they leave the site when the alpha ends.
 * `deploy-live.sh` hands every site build live's own value, read from its
 * `.env`, and never the shell's. The OTA site's documented build
 * (`deploy/compose/www.yml`) hands its stack's own value the same way, because
 * the app on that stack links the guide whenever its `.env` says alpha.
 */
const ALPHA = (process.env.OWNPACE_STAGE ?? '').trim().toLowerCase() === 'alpha';

// ---------------------------------------------------------------- markdown --

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A marker that cannot occur in a Markdown source file, used to park code
 * spans while the rest of the inline rules run.
 *
 * An earlier version parked them as ` 0 `, ` 1 ` ... and therefore rewrote
 * any bare number in ordinary prose: "we keep logs for 5 days" rendered as
 * "forundefineddays", and a sentence containing a real 0 beside one code
 * span swallowed the 0 and emitted the code span in its place. Both are
 * silent -- the page renders, it is simply wrong.
 */
const MARK = String.fromCharCode(0);

/** Inline: code first, so nothing inside backticks is re-interpreted. */
function inline(text) {
  const code = [];
  let s = text.replace(
    /`([^`]+)`/g,
    (_, c) => `${MARK}${code.push(`<code>${esc(c)}</code>`) - 1}${MARK}`,
  );
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const external = /^https?:/.test(href);
    const rel = external ? ' rel="noopener noreferrer"' : '';
    return `<a href="${esc(href)}"${rel}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Draft markers stay visible rather than blending into the prose.
  s = s.replace(/«([A-Z_]+)»/g, '<span class="todo" title="not filled in yet">«$1»</span>');
  return s.replace(new RegExp(`${MARK}(\\d+)${MARK}`, 'g'), (_, i) => code[Number(i)]);
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Block-level. Deliberately line-oriented: it is easier to read than a parser. */
function markdown(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const isTableRule = (l) => /^\|[\s:|-]+\|$/.test(l.trim());

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }
    if (/^<!--/.test(line.trim())) {
      while (i < lines.length && !/-->/.test(lines[i])) i += 1;
      i += 1;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      out.push('<hr />');
      i += 1;
      continue;
    }
    // `## Hulp {#hulp}` gives the heading the id it names, so a link to the
    // section (an issue form's, an invitation's) survives a reworded heading.
    // Without one, the id is the heading's slug, as before.
    const h = /^(#{1,4})\s+(.*?)(?:\s+\{#([a-z0-9-]+)\})?\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = inline(h[2]);
      const id = h[3] ?? slug(h[2]);
      out.push(`<h${level} id="${id}">${text}</h${level}>`);
      i += 1;
      continue;
    }
    if (line.trim().startsWith('|') && isTableRule(lines[i + 1] ?? '')) {
      const cells = (l) =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        body.push(cells(lines[i]));
        i += 1;
      }
      out.push(
        '<div class="scroll"><table><thead><tr>' +
          head.map((c) => `<th>${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          body
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
            .join('') +
          '</tbody></table></div>',
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${markdown(buf.join('\n'))}</blockquote>`);
      continue;
    }
    const listItem = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (listItem) {
      const ordered = /\d/.test(listItem[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m) {
          // A wrapped continuation line belongs to the item above it.
          if (items.length && /^\s{2,}\S/.test(lines[i])) {
            items[items.length - 1] += ' ' + lines[i].trim();
            i += 1;
            continue;
          }
          break;
        }
        items.push(m[3]);
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    // Paragraph: consume until a blank line or the start of another block.
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,4}\s|>|---+\s*$|\|)/.test(lines[i])) {
      const m = /^(\s*)([-*]|\d+\.)\s+/.exec(lines[i]);
      if (m && buf.length) break;
      buf.push(lines[i]);
      i += 1;
    }
    if (buf.length) out.push(`<p>${inline(buf.join(' ').trim())}</p>`);
  }
  return out.join('\n');
}

// ------------------------------------------------------------------- theme --

/**
 * The palette is the one `scripts/make-logo.py` draws the mark in.
 * `site/site.unit.test.ts` asserts the two agree — a site whose green is not
 * the logo's green looks like somebody else's site.
 */
const TEAL = '#0E4F4A';
const MINT = '#7FD4C1';

const CSS = `
:root {
  --teal: ${TEAL};
  --mint: ${MINT};
  --ink: #12211f;
  --muted: #556b66;
  --line: #dfe7e5;
  --bg: #ffffff;
  --panel: #f5f9f8;
  --max: 68rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e8f1ef; --muted: #9fb3ae; --line: #23423e;
    --bg: #0b1716; --panel: #10201e;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-synthesis-weight: none;
}
.wrap { max-width: var(--max); margin: 0 auto; padding: 0 1.25rem; }
a { color: var(--teal); text-underline-offset: 2px; }
@media (prefers-color-scheme: dark) { a { color: var(--mint); } }
h1, h2, h3 { line-height: 1.2; letter-spacing: -0.015em; margin: 2.5rem 0 0.75rem; }
h1 { font-size: clamp(2rem, 5vw, 3rem); }
h2 { font-size: clamp(1.4rem, 3vw, 1.9rem); }
h3 { font-size: 1.15rem; }
p, li { color: var(--ink); }
code { background: var(--panel); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
hr { border: 0; border-top: 1px solid var(--line); margin: 3rem 0; }
blockquote {
  margin: 1.5rem 0; padding: 0.25rem 0 0.25rem 1.25rem;
  border-left: 3px solid var(--mint); color: var(--muted);
}
.scroll { overflow-x: auto; margin: 1.5rem 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }
th, td { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
.todo {
  background: #ffe9a8; color: #5b4600; padding: 0 0.3em; border-radius: 3px;
  font-weight: 600; font-size: 0.9em;
}

/* header */
header.site { border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 5; }
header.site .wrap { display: flex; align-items: center; gap: 1.5rem; height: 4rem; }
.brand { display: flex; align-items: center; gap: 0.6rem; font-weight: 650; text-decoration: none; color: var(--ink); }
.brand img { width: 28px; height: 28px; border-radius: 7px; display: block; }
nav.site { margin-left: auto; display: flex; gap: 1.25rem; }
nav.site a, nav.menu a { text-decoration: none; color: var(--muted); font-size: 0.95rem; white-space: nowrap; }
nav.site a:hover, nav.site a[aria-current], nav.menu a:hover, nav.menu a[aria-current] { color: var(--ink); }
header.site a.lang {
  border: 1px solid var(--line); border-radius: 999px; padding: 0.15rem 0.7rem; font-size: 0.85rem;
  text-decoration: none; color: var(--muted); white-space: nowrap;
}
header.site a.lang:hover { border-color: var(--teal); color: var(--teal); }
@media (prefers-color-scheme: dark) { header.site a.lang:hover { border-color: var(--mint); color: var(--mint); } }
/* On a phone the pages fold into a menu that opens without a script (0152 T2). */
details.menu { display: none; }
details.menu > summary {
  list-style: none; cursor: pointer; border: 1px solid var(--line); border-radius: 8px;
  padding: 0.3rem 0.8rem; font-size: 0.95rem; color: var(--ink);
}
details.menu > summary::-webkit-details-marker { display: none; }
/* A drawn chevron, with no text for a screen reader to read: the browser says open or closed. */
details.menu > summary::after {
  content: ""; display: inline-block; width: 0.4em; height: 0.4em; margin-left: 0.55em;
  border-right: 2px solid currentColor; border-bottom: 2px solid currentColor;
  transform: translateY(-0.2em) rotate(45deg);
}
details.menu[open] > summary::after { transform: translateY(0.1em) rotate(-135deg); }
nav.menu {
  position: absolute; top: 100%; left: 0; right: 0; background: var(--bg);
  border-bottom: 1px solid var(--line); padding: 0.25rem 1.25rem 0.75rem;
  display: flex; flex-direction: column;
}
nav.menu a { padding: 0.75rem 0; border-top: 1px solid var(--line); font-size: 1rem; }
nav.menu a:first-child { border-top: 0; }
/* Leaving… (0152 T5 (b)): the six pages, a list that opens without a script. */
details.leaving { position: relative; }
details.leaving > summary {
  list-style: none; cursor: pointer; color: var(--muted); font-size: 0.95rem; white-space: nowrap;
}
details.leaving > summary::-webkit-details-marker { display: none; }
details.leaving > summary::after {
  content: ""; display: inline-block; width: 0.35em; height: 0.35em; margin-left: 0.45em;
  border-right: 2px solid currentColor; border-bottom: 2px solid currentColor;
  transform: translateY(-0.2em) rotate(45deg);
}
details.leaving[open] > summary::after { transform: translateY(0.05em) rotate(-135deg); }
details.leaving > summary:hover, details.leaving[open] > summary,
details.leaving:has(a[aria-current]) > summary { color: var(--ink); }
.leaving-list {
  position: absolute; top: calc(100% + 1.1rem); right: -0.75rem; min-width: 16rem; z-index: 6;
  display: flex; flex-direction: column; padding: 0.4rem; background: var(--bg);
  border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.1);
}
nav.site .leaving-list a { display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0.6rem; border-radius: 6px; }
nav.site .leaving-list a:hover { background: var(--panel); }
nav.menu details.leaving > summary { padding: 0.75rem 0; border-top: 1px solid var(--line); font-size: 1rem; }
nav.menu .leaving-list {
  position: static; min-width: 0; padding: 0 0 0.5rem 0.25rem; border: 0; border-radius: 0; box-shadow: none;
}
nav.menu .leaving-list a { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0; border-top: 0; }
/* A provider's tile (0152 D4, tiles.svg): its initial on the teal, hidden from a
   screen reader, the name always written beside it. 20 px in text, 28 in a row,
   48 beside a heading; the corner is 22% of the size and the letter 45%. */
.tile {
  display: inline-grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 4.4px;
  background: var(--teal); color: #fff; font-size: 9px; font-weight: 700; line-height: 1; letter-spacing: 0;
}
.tile.t28 { width: 28px; height: 28px; border-radius: 6.16px; font-size: 12.6px; }
.tile.t48 { width: 48px; height: 48px; border-radius: 10.56px; font-size: 21.6px; }
@media (max-width: 48rem) {
  header.site .wrap { height: 3.5rem; gap: 0.75rem; }
  nav.site { display: none; }
  header.site a.lang { margin-left: auto; }
  details.menu { display: block; }
}

.draft {
  background: #ffe9a8; color: #5b4600; border-radius: 8px; padding: 0.75rem 1rem;
  margin: 1.5rem 0 0; font-size: 0.92rem; font-weight: 600;
}

/* hero */
.hero { padding: clamp(3rem, 8vw, 6rem) 0 2rem; }
.hero h1 { margin-top: 0; max-width: 20ch; }
.lede { font-size: clamp(1.05rem, 2.2vw, 1.3rem); color: var(--muted); max-width: 58ch; }
.cta { display: flex; gap: 0.75rem; flex-wrap: wrap; margin: 2rem 0 0; }
.btn {
  display: inline-block; padding: 0.7rem 1.15rem; border-radius: 8px; text-decoration: none;
  font-weight: 600; border: 1px solid var(--teal);
}
.btn-primary { background: var(--teal); color: #fff; }
.btn-primary:hover { filter: brightness(1.12); }
.btn-ghost { color: var(--teal); }
@media (prefers-color-scheme: dark) {
  .btn { border-color: var(--mint); }
  .btn-primary { background: var(--mint); color: #06201c; }
  .btn-ghost { color: var(--mint); }
}
.fineprint { color: var(--muted); font-size: 0.9rem; margin-top: 0.75rem; }

/* cards */
.cards { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); margin: 1.5rem 0; }
/* The data-type icons (icons.mjs): one sprite per page, each icon 24 px in the text's colour. */
.sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
.icon { width: 1.25rem; height: 1.25rem; flex: none; color: var(--teal); }
@media (prefers-color-scheme: dark) { .icon { color: var(--mint); } }
/* Where to (0152 T4): each destination, and the data types it takes. */
.dest .sub { color: var(--muted); margin: -0.5rem 0 0.75rem; font-size: 0.95rem; }
.types { list-style: none; padding: 0; margin: 0; }
.types li { display: flex; align-items: center; gap: 0.6rem; padding: 0.3rem 0; }
.types .via { color: var(--muted); font-size: 0.85rem; margin-left: auto; }
/* The hero's six Leaving… names (0152 T5 (b)). */
.leaving-label { font-weight: 700; margin: 2rem 0 0.6rem; }
/* Three by two beside the hero's words, as wf-site-home.svg draws it; two by three on a phone. */
.leaving-row {
  list-style: none; padding: 0; margin: 0; display: grid; gap: 0.6rem 1.5rem; max-width: 42rem;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr));
}
.leaving-row a { display: flex; align-items: center; gap: 0.6rem; font-weight: 600; text-decoration: none; }
.leaving-row a:hover span:last-child { text-decoration: underline; }
/* A Leaving… page (0152 T5 (a)). */
.leaving-h1 { display: flex; align-items: center; gap: 0.9rem; }
.moves { list-style: none; padding: 0; margin: 1rem 0; border-top: 1px solid var(--line); }
.move { display: flex; gap: 0.85rem; align-items: flex-start; padding: 0.85rem 0; border-bottom: 1px solid var(--line); }
.move .icon { margin-top: 0.2rem; }
.move p { margin: 0; }
.move .head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 0.6rem; }
.move .to { color: var(--muted); font-size: 0.93rem; margin-top: 0.2rem; }
.verdict { font-size: 0.85rem; font-weight: 600; padding: 0.05rem 0.55rem; border-radius: 999px; white-space: nowrap; }
.verdict[data-verdict="moves"] { background: #def3ee; color: #0b3f3a; }
.verdict[data-verdict="limit"] { background: #fdf0cc; color: #5b4600; }
.verdict[data-verdict="no"] { background: #eceff0; color: #3b4a47; }
@media (prefers-color-scheme: dark) {
  .verdict[data-verdict="moves"] { background: #143b36; color: #bfeee2; }
  .verdict[data-verdict="limit"] { background: #3d3315; color: #f5dc94; }
  .verdict[data-verdict="no"] { background: #26302e; color: #c9d3d0; }
}
a.verdict { text-decoration: underline; text-decoration-thickness: 1px; }
.tag {
  font-size: 0.75rem; font-weight: 600; letter-spacing: 0.03em; padding: 0.05rem 0.5rem;
  border: 1px solid var(--muted); border-radius: 999px; color: var(--muted); white-space: nowrap;
}
.limits { padding-left: 1.2rem; }
.limits li { margin: 0 0 1rem; scroll-margin-top: 5rem; }
.limits li p { margin: 0; }
.limits .guide { font-size: 0.9rem; margin-top: 0.25rem; }
.steps { list-style: none; padding: 0; margin: 1rem 0; }
.steps li { padding: 0.75rem 0; border-top: 1px solid var(--line); }
.steps li:first-child { border-top: 0; }
.steps .kind { display: block; color: var(--muted); font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.card { border: 1px solid var(--line); border-radius: 12px; padding: 1.25rem; background: var(--panel); }
.card h3 { margin-top: 0; }
.card p:last-child { margin-bottom: 0; }
.step { font-variant-numeric: tabular-nums; color: var(--mint); font-weight: 700; }

/* pricing */
.tiers { display: grid; gap: 0.85rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr)); margin: 2rem 0; }
.tier {
  border: 1px solid var(--line); border-radius: 12px; padding: 1.1rem;
  display: flex; flex-direction: column; position: relative;
}
.tier.featured { border-color: var(--teal); box-shadow: 0 0 0 1px var(--teal); }
@media (prefers-color-scheme: dark) { .tier.featured { border-color: var(--mint); box-shadow: 0 0 0 1px var(--mint); } }
.tier h3 { margin: 0 0 0.15rem; }
/* Two lines reserved, so a one-line subtitle does not lift its card's price
   out of line with the others. A price column that does not line up reads as
   carelessness on the one page where it costs the most. */
.tier .who {
  color: var(--muted); font-size: 0.9rem; margin: 0 0 1rem;
  line-height: 1.5; min-height: 3em;
}
.price { font-size: 1.9rem; font-weight: 700; letter-spacing: -0.02em; }
.price span { font-size: 0.85rem; font-weight: 500; color: var(--muted); }
.tier ul { list-style: none; padding: 0; margin: 1rem 0; font-size: 0.93rem; }
.tier ul li { padding: 0.3rem 0; border-top: 1px solid var(--line); }
.tier .note { color: var(--muted); font-size: 0.9rem; margin-top: auto; padding-top: 1rem; }

/* How you pay (0152 T6 (e)): a switch that needs no script and opens on yearly.
   Each paid card carries both answers, and the switch shows one. Where :has() is
   unknown both show, which is wordier and never wrong. */
.pay-switch { border: 0; padding: 0; margin: 1.75rem 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.9rem; }
.pay-switch legend { float: left; padding: 0; font-weight: 650; }
.pay-options { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 3px; }
.pay-options input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
.pay-options label { padding: 0.3rem 1rem; border-radius: 999px; cursor: pointer; color: var(--muted); font-weight: 600; font-size: 0.95rem; }
.pay-options input:checked + label { background: var(--teal); color: #fff; }
.pay-options input:focus-visible + label { outline: 2px solid var(--teal); outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  .pay-options input:checked + label { background: var(--mint); color: #06201c; }
  .pay-options input:focus-visible + label { outline-color: var(--mint); }
}
.pay-rule { color: var(--muted); margin: 0.6rem 0 0; }
.pay:has(#pay-month:checked) .when-year, .pay:has(#pay-year:checked) .when-month { display: none; }
.tier .price-year { font-size: 1.1rem; font-weight: 700; margin-top: 0.15rem; }
.tier .price-how { color: var(--muted); font-size: 0.85rem; }
.tier .half { display: block; margin-top: 0.35rem; color: var(--teal); font-size: 0.85rem; font-weight: 650; }
@media (prefers-color-scheme: dark) { .tier .half { color: var(--mint); } }

/* calculator (workplan 0088 T3) */
.calc fieldset { border: 1px solid var(--line); border-radius: 12px; padding: 1rem 1.25rem 1.25rem; margin: 1.25rem 0; }
.calc legend { font-weight: 650; padding: 0 0.4rem; }
.calc .opts { display: flex; flex-wrap: wrap; gap: 0.4rem 1.1rem; }
.calc label.opt { display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.2rem 0; cursor: pointer; }
.calc .hint { color: var(--muted); font-size: 0.9rem; margin: 0.5rem 0 0; }
.calc .amounts { display: grid; gap: 0.5rem 1rem; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); margin-top: 0.75rem; }
.calc .amount { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem; min-width: 0; }
/* The label on its own line, and the item count wrapping under the box rather
   than running into the next field (0152 T7 (c): at 1280 pixels Calendar's
   "2,000 items" ran into Files). */
.calc .amount label { flex-basis: 100%; }
.calc .amount input { width: 6.5rem; padding: 0.35rem 0.5rem; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); font: inherit; }
.calc .amount .items { color: var(--muted); font-size: 0.8rem; }
.calc .amount[data-off] { opacity: 0.45; }
#paths-line { font-weight: 600; margin: 1.5rem 0 0.5rem; }
.axes { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); margin: 1rem 0; }
.axis { border: 1px solid var(--line); border-radius: 12px; padding: 2.4rem 1.25rem 1rem; position: relative; }
.axis .val { font-size: 1.6rem; font-weight: 700; }
/* Above the heading, in room both cards reserve, so it never covers the heading
   (at 390 pixels it covered "Migrations at the same time") and both cards keep
   their headings on one line whichever one decides. */
.axis .decides { display: none; position: absolute; top: 0.75rem; left: 1.25rem;
  background: var(--mint); color: #06201c; font-size: 0.68rem; font-weight: 700;
  letter-spacing: 0.05em; text-transform: uppercase; padding: 0.15rem 0.5rem; border-radius: 999px; }
.axis[data-decides] .decides { display: inline-block; }
.axis[data-decides] { border-color: var(--teal); box-shadow: 0 0 0 1px var(--teal); }
@media (prefers-color-scheme: dark) { .axis[data-decides] { border-color: var(--mint); box-shadow: 0 0 0 1px var(--mint); } }
#tier-card { border: 1px solid var(--teal); box-shadow: 0 0 0 1px var(--teal); border-radius: 12px; padding: 1.25rem; margin: 1rem 0; }
@media (prefers-color-scheme: dark) { #tier-card { border-color: var(--mint); box-shadow: 0 0 0 1px var(--mint); } }
#tier-card h3 { margin: 0 0 0.5rem; }
#tier-card ul { list-style: none; padding: 0; margin: 0.75rem 0; }
#tier-card ul li { padding: 0.3rem 0; border-top: 1px solid var(--line); }
.calc .fine { color: var(--muted); font-size: 0.9rem; }

footer.site { border-top: 1px solid var(--line); margin-top: 5rem; padding: 2.5rem 0 4rem; color: var(--muted); font-size: 0.92rem; }
footer.site .wrap { display: flex; gap: 2rem; flex-wrap: wrap; justify-content: space-between; }
footer.site a { color: var(--muted); }
footer.site .build { font-size: 0.8rem; opacity: 0.7; }
.skip { position: absolute; left: -9999px; }
.skip:focus { left: 1rem; top: 1rem; background: var(--bg); padding: 0.5rem 1rem; z-index: 10; }
`;

// ------------------------------------------------------------------ layout --

/** Every page, in every locale, so the switcher and hreflang can be built. */
const PAGE_KEYS = ['home', 'how', 'pricing', 'calculator', 'privacy', 'terms'];

/**
 * The pages the header lists, before *Sign in* and the language switch
 * (workplan 0152 T2): *Home · How it works · Pricing · Sign in*. The estimate
 * is linked from the pricing page and the home page's *What it costs* (T6 (c)),
 * and Privacy and Terms from the footer. They stay in `PAGE_KEYS`, so the
 * language switch and hreflang still reach them.
 */
const NAV_KEYS = ['home', 'how', 'pricing'];

/**
 * The *Leaving…* pages (workplan 0152 T5), one per provider a person leaves,
 * in `sources.mjs`'s order. The header lists them after Pricing, in a
 * `<details>` of their own, and the home page's hero names them under its
 * buttons. Each has a file of its own in each language (`files` in
 * `copy.mjs`), so the language switch and hreflang reach them.
 */
const LEAVING_KEYS = LEAVING.map((p) => `leaving-${p.id}`);

/**
 * Pages rendered in every locale like the ones above, with a file of their own
 * in each (`files` in `copy.mjs`, so the switcher and hreflang still work), and
 * left out of the nav.
 *
 * The Alpha conditions (workplan 0139 T2) are for the few people taking part:
 * the app links them where it asks a tester to accept them with the terms and
 * the privacy policy (0139 T3), and so do the texts that name them. A link in
 * every visitor's nav would offer conditions to people who cannot take part.
 */
const OUTSIDE_NAV = ['alpha'];

/**
 * Pages rendered like `OUTSIDE_NAV`'s, and only when the build is for the
 * alpha (`ALPHA` above).
 *
 * The tester guide (workplan 0144 T1; the owner, 2026-10-03: *"Agreed, write
 * the Dutch version on the site"*): how to take part, written for the people
 * invited, Dutch first. The conditions are rendered in every build, because the
 * acceptance screen links them wherever it runs; the guide is the alpha's own,
 * and leaves the site with it. Its address for the app is
 * `apps/web/src/services/tester-guide-link.ts`.
 */
const ALPHA_ONLY = ['guide'];

const urlFor = (locale, key) => {
  const file = COPY[locale].files[key];
  return `${localeRoot(locale)}/${file === 'index.html' ? '' : file}`;
};

// WHAT BUILD THIS PAGE CAME FROM.
//
// The monorepo root package.json, which is the same single source the app's
// bundle and the server's GET /version use. `site/` imports no workspace
// package by design (see this file's header), and reading one JSON file at
// build time does not change that: nothing is linked, nothing is resolved
// through node_modules, and the site still builds if the rest of the
// repository is not installed.
//
// The commit is optional and comes from the environment, because git is not
// necessarily present wherever this runs. Absent, the footer shows the version
// alone rather than the word "unknown".
const BUILD = (() => {
  try {
    const { version } = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
    const sha = (process.env.GIT_SHA || '').trim().slice(0, 7);
    return { version: version || '', commit: sha };
  } catch {
    // A site that cannot read the version still builds. The stamp is the least
    // important thing on the page.
    return { version: '', commit: '' };
  }
})();

/** `v0.1.0-rc.1 · a1b2c3d`, or as much of it as is known, or nothing. */
function buildStamp() {
  if (!BUILD.version) return '';
  return BUILD.commit ? `v${BUILD.version} \u00b7 ${BUILD.commit}` : `v${BUILD.version}`;
}

function layout({ title, description, body, locale, key, draft }) {
  const c = COPY[locale];
  const leaving = LEAVING.map((p) => leavingLink(locale, p, 20, `leaving-${p.id}` === key)).join('');
  const nav =
    NAV_KEYS.map((k) => {
      const href = urlFor(locale, k);
      const current = k === key ? ' aria-current="page"' : '';
      return `<a href="${href}"${current}>${c.nav[k]}</a>`;
    }).join('') +
    `<details class="leaving"><summary>${c.leaving.menu}</summary><div class="leaving-list">${leaving}</div></details>` +
    `<a href="${esc(SIGN_IN_URL)}">${c.nav.signIn}</a>`;

  const other = LOCALES.find((l) => l !== locale);
  const alternates = LOCALES.map(
    (l) => `<link rel="alternate" hreflang="${l}" href="${urlFor(l, key)}" />`,
  ).join('\n');

  const banner = draft
    ? `<p class="draft">${c.draftBanner}</p>`
    : '';

  return `<!doctype html>
<html lang="${c.htmlLang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="${locale === 'nl' ? 'nl_NL' : 'en_GB'}" />
${PUBLIC ? '' : '<meta name="robots" content="noindex, nofollow" />'}
${alternates}
<link rel="alternate" hreflang="x-default" href="${urlFor(DEFAULT_LOCALE, key)}" />
<link rel="icon" href="/brand/logo-120.png" />
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">${c.skip}</a>
<header class="site"><div class="wrap">
  <a class="brand" href="${urlFor(locale, 'home')}"><img src="/brand/logo-120.png" alt="" width="28" height="28" /> Ownpace</a>
  <nav class="site" aria-label="${c.navName}">${nav}</nav>
  <a class="lang" href="${urlFor(other, key)}" lang="${COPY[other].htmlLang}">${c.otherLangName}</a>
  <details class="menu"><summary>${c.menu}</summary><nav class="menu" aria-label="${c.navName}">${nav}</nav></details>
</div></header>
<main id="main"><div class="wrap">
${banner}
${body}
</div></main>
<footer class="site"><div class="wrap">
  <div><strong>Ownpace</strong> — ${c.footerTag}<br />${c.footerOss}${
    buildStamp() ? `<br /><span class="build">${buildStamp()}</span>` : ''
  }</div>
  <div>
    <a href="${urlFor(locale, 'privacy')}">${c.nav.privacy}</a> ·
    <a href="${urlFor(locale, 'terms')}">${c.nav.terms}</a> ·
    <a href="${STATUS_URL}">${c.footerStatus}</a> ·
    <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
  </div>
</div></footer>
</body>
</html>
`;
}

/**
 * Where "Request access" goes (workplan 0093 T4).
 *
 * It was `mailto:` — so the first step of becoming a customer was composing an
 * email in whatever client the visitor's browser happened to open, and the
 * first record of them was somebody's inbox. It now points at the app's
 * request-access page.
 *
 * **The form is on the APP, not here, and that is a CSP decision.** This site
 * is served with `default-src 'none'; … form-action 'none'`
 * (`deploy/compose/www-nginx.conf`): no scripts, no submissions, deliberately.
 * A form on these pages would mean relaxing that for every one of them. A link
 * costs nothing and the app already has the plumbing.
 *
 * The tier rides along as a query parameter so a visitor who clicked "Start
 * with Medium" does not have to answer that question again. Indicative only —
 * the tier is DERIVED from what actually runs (ADR-0014), never picked.
 */
const orderHref = (locale, tier) => {
  // Hand-built with `encodeURIComponent`, which this file already uses
  // everywhere, rather than `URLSearchParams`: the lint config's globals for
  // `.mjs` are a curated allowlist and do not include it. Two parameters do not
  // justify widening that list.
  const params = [`locale=${encodeURIComponent(locale)}`];
  if (tier) params.push(`tier=${encodeURIComponent(tier.name)}`);
  return `${REQUEST_ACCESS_URL}?${params.join('&')}`;
};

// ------------------------------------------------------------------- pages --

function cards(list) {
  return (
    '<div class="cards">' +
    list.map(([h, p]) => `<div class="card"><h3>${h}</h3><p>${p}</p></div>`).join('') +
    '</div>'
  );
}

function tierCards(locale) {
  const c = COPY[locale];
  return (
    '<div class="tiers">' +
    TIERS.map((t, i) => {
      const featured = t.id === 'small';
      // A free tier says so, and says where it ends: never "€0", which reads
      // as a price that could be billed (ADR-0014, 2026-09-24).
      const next = TIERS[i + 1];
      const prices = free(t)
        ? `<div class="price">${c.tierFree}</div>
  <div class="price-year">${c.tierFreeFor}</div>
  <div class="price-how">${c.tierNoInvoice}, ${c.tierNoInvoiceWhy}</div>`
        : // A year shown per month is the year divided by twelve, with the year's
          // total in bold under it, never in small print, and the comparison of
          // two prices on sale now: nothing struck through, no former price. A
          // year that does not divide into whole cents stops the build in money().
          `<div class="when-year">
    <div class="price">${money(t.annual / 12)} <span>${c.tierMonth}</span></div>
    <div class="price-year">${c.payYearTotal(money(t.annual))}</div>
    <div class="price-how">${c.payYearHow}</div>
    <div class="half">${c.payHalf}</div>
  </div>
  <div class="when-month">
    <div class="price">${money(t.monthly)} <span>${c.tierMonth}</span></div>
    <div class="price-how">${c.payMonthHow}</div>
  </div>`;
      const terms = free(t)
        ? `<li>${c.tierFreeEdge(next.name)}</li>`
        : `<li>${c.tierNoSetup}</li>
    <li>${c.tierThree(money(total(t, 3)))}</li>`;
      return `<div class="tier${featured ? ' featured' : ''}">
  <h3>${t.name}</h3>
  <p class="who">${esc(c.tierText[t.id].who)}</p>
  ${prices}
  <ul>
    <li>${c.tierPaths(t.paths)}</li>
    <li>${c.tierData(size(t.dataGb))}</li>
    ${terms}
  </ul>
  <p class="note">${esc(c.tierText[t.id].note)}</p>
  <p><a class="btn ${featured ? 'btn-primary' : 'btn-ghost'}" href="${esc(orderHref(locale, t))}">${c.tierStart(t.name)}</a></p>
</div>`;
    }).join('') +
    '</div>'
  );
}

/** The data-type icon each of the app's data types is drawn with (icons.mjs). */
const ICON_OF = { email: 'mail', calendar: 'calendar', contact: 'contacts', file: 'files', task: 'tasks' };

/**
 * *Where to* (workplan 0152 T4): the destinations the app moves data into, from
 * the guarded copy in `destinations.mjs`, each with the data types it takes,
 * named as the app names them. The card that is four protocols says which
 * protocol carries each.
 */
function whereTo(locale) {
  const c = COPY[locale];
  const card = (d) => {
    const { name, sub } = c.destinations[d.id];
    const many = d.types.length > 1;
    const types = DATA_TYPES.filter((t) => d.takes[t])
      .map(
        (t) =>
          `<li>${icon(ICON_OF[t])}<span>${c.dataTypes[t]}</span>${
            many ? `<span class="via">${PROTOCOL_NAMES[d.takes[t]]}</span>` : ''
          }</li>`,
      )
      .join('');
    return `<div class="card dest"><h3>${name}</h3>${sub ? `<p class="sub">${sub}</p>` : ''}<ul class="types">${types}</ul></div>`;
  };
  return `
<h2>${c.whereTitle}</h2>
<p>${c.whereLede}</p>
${SPRITE}
<div class="cards">${DESTINATIONS.map(card).join('')}</div>
`;
}

// ----------------------------------------------------------------- leaving --

/** A provider's tile (0152 D4): the initial, hidden from a screen reader, which reads the name beside it. */
const tile = (letter, size) => `<span class="tile${size === 20 ? '' : ` t${size}`}" aria-hidden="true">${esc(letter)}</span>`;

/** A Leaving… page's title: *Leaving Google*, or the page's own where its name will not take the frame. */
const leavingTitle = (locale, page) => {
  const L = COPY[locale].leaving;
  return L.title[page.id] ?? L.titleOf(L.names[page.id]);
};

/**
 * A link to a Leaving… page, with its tile and its name. Read out of context,
 * as a screen reader's list of links reads it, a bare *Google* says nowhere it
 * goes, so the link is named by the page's title, which holds the name.
 */
function leavingLink(locale, page, size, current) {
  const L = COPY[locale].leaving;
  return (
    `<a href="${urlFor(locale, `leaving-${page.id}`)}" aria-label="${esc(leavingTitle(locale, page))}"` +
    `${current ? ' aria-current="page"' : ''}>${tile(page.tile, size)}<span>${L.names[page.id]}</span></a>`
  );
}

/** Names as a sentence lists them: `A`, `A or B`, `A, B or C`. */
const listed = (names, word) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`;

/** The data-type icon each of the app's data types is drawn with, and photos (icons.mjs). */
const LEAVING_ICON = { email: 'mail', calendar: 'calendar', contact: 'contacts', file: 'files', task: 'tasks', photos: 'photos' };

/** The calculator's own name for each data type a page can price (`OBJECT_TYPES`). Tasks have none. */
const PROFILE_OF = { email: 'mail', calendar: 'calendar', contact: 'contacts', file: 'files', photos: 'photos' };

/**
 * A page's typical case, priced as the calculator prices it (0152 T5 (a) 4):
 * one person, the indicative profile's sizes for the data types the provider
 * typically holds, a migration per data type, through `deriveTier`.
 * `scripts/leaving-pages-say-what-the-app-says` works it out again, from the
 * calculator's own modules, and holds the page's sentence to it.
 */
function typicalCase(page) {
  const accounts = CUSTOMER_TYPES.find((w) => w.id === 'individual').accounts;
  const objects = page.typical.map((t) => PROFILE_OF[t]);
  const sizes = INDICATIVE_PROFILES.individual;
  // Summed and rounded as the calculator's own recompute() does.
  const gb = Math.round(objects.reduce((sum, o) => sum + sizes[o].gb, 0) * 10) / 10;
  const atOnce = deriveTier(TIERS, accounts * objects.length, gb).tier;
  const oneByOne = deriveTier(TIERS, accounts, gb).tier;
  if (!atOnce || !oneByOne) throw new Error(`${page.id}: its typical case is past the published tiers`);
  return { objects, gb, atOnce, oneByOne };
}

/**
 * Where a row's data type can go, named as *Where to* names the destinations
 * (D7): every destination that takes it, and for photos from an export only
 * the ones an export is read from.
 */
function goesTo(locale, row) {
  const L = COPY[locale].leaving;
  const domain = DOMAIN_OF[row.type];
  const names = DESTINATIONS.filter((d) => {
    const by = d.takes[domain];
    return by !== undefined && (row.by !== 'archive' || EXPORT_TARGETS.includes(by));
  }).map((d) => (d.id === 'protocols' ? L.anyProvider(PROTOCOL_NAMES[d.takes[domain]]) : L.destShort[d.id]));
  return listed(names, L.or);
}

/**
 * A Leaving… page (workplan 0152 T5 (a)): what moves, the limits, what the
 * person does, a typical cost, and the next step. Everything it says is
 * `sources.mjs`'s, which `scripts/leaving-pages-say-what-the-app-says` holds to
 * the app, in `copy.mjs`'s words.
 */
function leavingPage(locale, page) {
  const c = COPY[locale];
  const L = c.leaving;
  const typeName = (t) => (t === 'photos' ? L.photos : c.dataTypes[t]);

  const rows = page.rows
    .map((r) => {
      const verdict =
        r.verdict === 'moves'
          ? `<span class="verdict" data-verdict="moves">${L.verdict.moves}</span>`
          : `<a class="verdict" data-verdict="${r.verdict}" href="#limit-${r.limit}">${L.verdict[r.verdict]}</a>`;
      const tag = r.experimental ? `<span class="tag">${L.experimental}</span>` : '';
      const to = r.verdict === 'no' ? '' : `<p class="to">${L.goesTo}: ${goesTo(locale, r)}</p>`;
      return (
        `<li class="move" data-type="${r.type}" data-verdict="${r.verdict}"${r.experimental ? ' data-experimental' : ''}>` +
        `${icon(LEAVING_ICON[r.type])}<div><p class="head"><strong>${typeName(r.type)}</strong>${verdict}${tag}</p>${to}</div></li>`
      );
    })
    .join('');
  const experimental = page.rows.some((r) => r.experimental)
    ? `<p class="fineprint"><span class="tag">${L.experimental}</span> ${L.experimentalWhy}</p>`
    : '';
  const behind = page.staysBehind
    ? `<p class="fineprint"><strong>${L.staysBehind}</strong> ${page.staysBehind.items.map((i) => L.staysBehindItems[i]).join('; ')}.</p>`
    : '';

  const limits = page.limits
    .map((l) => {
      const [slug, section] = l.guide.split('#');
      const text = l.id === 'gmailDaily' ? L.limits.gmailDaily(GMAIL_IMAP_GB_PER_DAY.toLocaleString(c.htmlLang)) : L.limits[l.id];
      return (
        `<li id="limit-${l.id}"><p>${text}</p>` +
        `<p class="guide"><a href="${esc(`${APP_URL}/docs/${slug}#${section}`)}">${L.guideLink}</a></p></li>`
      );
    })
    .join('');

  const steps = page.steps
    .map((s) => `<li><span class="kind">${L.stepKind[s.kind]}</span>${L.steps[s.card]}</li>`)
    .join('');

  const { objects, atOnce, oneByOne } = typicalCase(page);
  const what = listed(
    page.typical.map((t) => typeName(t).toLowerCase()),
    L.and,
  );
  const cost = free(atOnce)
    ? L.costFree(what, atOnce.name)
    : `${L.costPaid(what, atOnce.name, money(atOnce.monthly))}${
        free(oneByOne) ? ` ${L.costOneAtATime(oneByOne.name)}` : ''
      }`;
  // The calculator opens on this page's case: the source chosen, its data types ticked.
  const estimate = `${urlFor(locale, 'calculator')}?from=${encodeURIComponent(page.from)}&what=${objects.join(',')}`;

  return `
<h1 class="leaving-h1">${tile(page.tile, 48)}<span>${leavingTitle(locale, page)}</span></h1>
<p class="lede">${L.lede[page.id] ?? L.ledeOf(L.names[page.id])}</p>
${SPRITE}
<h2>${L.whatMoves}</h2>
<ul class="moves">${rows}</ul>
${experimental}
${behind}
<h2>${L.limitsTitle}</h2>
<ul class="limits">${limits}</ul>
<h2>${L.stepsTitle}</h2>
<ul class="steps">${steps}</ul>
<h2>${L.costTitle}</h2>
<p>${cost}</p>
<p class="fineprint">${esc(c.vatIncluded)}</p>
<div class="cta"><a class="btn btn-ghost" href="${esc(estimate)}">${c.ctaEstimate}</a></div>
<h2>${L.nextTitle}</h2>
<div class="cta"><a class="btn btn-primary" href="${esc(orderHref(locale, null))}">${c.ctaOrder}</a></div>
`;
}

function landing(locale) {
  const c = COPY[locale];
  const small = TIERS.find((t) => t.id === 'small');
  return `
<section class="hero">
  <h1>${c.heroTitle}</h1>
  <p class="lede">${c.heroLede}</p>
  <div class="cta">
    <a class="btn btn-primary" href="${esc(orderHref(locale, null))}">${c.ctaOrder}</a>
    <a class="btn btn-ghost" href="${urlFor(locale, 'pricing')}">${c.ctaPricing}</a>
  </div>
  <p class="fineprint">${c.heroFree(TIERS[0].name, size(TIERS[0].dataGb))} ${esc(c.vatIncluded)}</p>
  <p class="leaving-label" id="leaving-label">${c.leaving.menu}</p>
  <ul class="leaving-row" aria-labelledby="leaving-label">${LEAVING.map((p) => `<li>${leavingLink(locale, p, 28, false)}</li>`).join('')}</ul>
</section>
${whereTo(locale)}
<h2>${c.diffTitle}</h2>
${cards(c.diff)}

<h2>${c.wontTitle}</h2>
<p>${c.wontLede}</p>
${cards(c.wont)}

<h2>${c.costTitle}</h2>
<p>${c.costLede}</p>
<p>${c.costPick(small.name, money(small.monthly), money(small.annual), small.paths, size(small.dataGb))}</p>
<div class="cta">
  <a class="btn btn-primary" href="${urlFor(locale, 'calculator')}">${c.ctaEstimate}</a>
  <a class="btn btn-ghost" href="${urlFor(locale, 'pricing')}">${c.ctaAllTiers}</a>
</div>
`;
}

// -------------------------------------------------------------- calculator --

/**
 * The pre-preflight calculator (workplan 0088 T3; owner decision 2026-08-26,
 * shape (a) of the CSP fork): one page per locale, ONE inline script shared
 * by both, allowed by hash and nowhere else.
 *
 * WHY THE SCRIPT IS LOCALE-BLIND. The site's CSP pins the script by sha256 in
 * `deploy/compose/www-nginx.conf`. One script for both locales means one hash
 * and one conf line; every localised word reaches the script through the
 * page's embedded JSON config instead. `site/calculator.unit.test.ts` fails
 * if the rendered script's hash and the conf's pinned hash disagree — the
 * drift that would otherwise kill the calculator silently (a blocked script
 * leaves a perfectly rendered, perfectly dead page).
 *
 * The ARITHMETIC lives in `site/calculator.mjs`, imported by the tests and
 * inlined here verbatim (exports stripped) — the code in the visitor's
 * browser is byte-for-byte the code the tests exercised.
 */
const CALC_LIB = readFileSync(join(HERE, 'calculator.mjs'), 'utf8').replace(/^export /gm, '');

/**
 * The DOM half: read the config JSON, wire the inputs, recompute on change.
 * Every computed string lands via `textContent` — nothing here writes HTML,
 * which is what keeps a page-with-a-script as inert as the pages without one.
 */
const CALC_GLUE = `
(function () {
  var cfg = JSON.parse(document.getElementById('calc-config').textContent);
  var S = cfg.strings;
  function $(id) { return document.getElementById(id); }
  function radio(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function ticked() {
    return cfg.objectTypes.filter(function (t) { return $('what-' + t).checked; });
  }
  function gbOf(t) {
    var n = Number($('gb-' + t).value);
    return isFinite(n) && n > 0 ? n : 0;
  }
  function prefill() {
    var who = radio('who');
    cfg.objectTypes.forEach(function (t) {
      var cell = cfg.profiles[who][t];
      $('gb-' + t).value = String(cell.gb);
      $('items-' + t).textContent = fill(S.itemsAssumed, cell.items.toLocaleString(cfg.locale));
    });
  }
  function recompute() {
    var who = radio('who');
    var from = radio('from');
    var until = radio('until');
    var types = ticked();
    cfg.objectTypes.forEach(function (t) {
      var row = $('amount-' + t);
      if (types.indexOf(t) === -1) row.setAttribute('data-off', ''); else row.removeAttribute('data-off');
    });

    var paths = cfg.accounts[who] * types.length;
    var gb = types.reduce(function (sum, t) { return sum + gbOf(t); }, 0);
    gb = Math.round(gb * 10) / 10;

    var names = types.map(function (t) { return S.what[t]; }).join(', ');
    $('paths-line').textContent =
      types.length === 0 ? S.pathsNone
        : paths === 1 ? fill(S.pathsOne, names)
        : fill(S.pathsMany, names, S.forWho[who], paths);

    var b = band(gb);
    $('axis-paths-val').textContent = String(paths);
    $('axis-data-val').textContent = sizeOf(gb);
    $('band-line').textContent = fill(S.bandLine, b.low, b.high);

    var d = deriveTier(cfg.tiers, paths, gb);
    var pathsAxis = $('axis-paths'), dataAxis = $('axis-data');
    pathsAxis.removeAttribute('data-decides'); dataAxis.removeAttribute('data-decides');
    if (d.decidedBy === 'paths' || d.decidedBy === 'both') pathsAxis.setAttribute('data-decides', '');
    if (d.decidedBy === 'data' || d.decidedBy === 'both') dataAxis.setAttribute('data-decides', '');

    var card = $('tier-card'), beyond = $('beyond-line');
    if (!d.tier || types.length === 0) {
      card.hidden = true;
      beyond.hidden = types.length === 0;
      $('topup-line').textContent = '';
      $('gmail-line').hidden = true;
      return;
    }
    beyond.hidden = true;
    card.hidden = false;
    var t = d.tier;
    $('tier-name').textContent = fill(S.tierLine, t.name);
    var next = cfg.tiers[cfg.tiers.indexOf(t) + 1];
    var isFree = freeTier(t);
    $('tier-monthly').textContent = isFree ? S.tierFree : fill(S.tierMonthly, money(t.monthly));
    $('tier-year').textContent = isFree ? fill(S.tierFreeEdge, sizeOf(t.dataGb), next.name) : fill(S.tierYear, money(t.annual));
    $('tier-three').hidden = isFree;
    $('tier-three').textContent = fill(S.tierThree, money(t.monthly * 3));

    var vs = topUpAgainstStepUp(t, next);
    $('topup-line').textContent = !vs ? '' :
      fill(S.topUpLine, t.name, money(vs.topUpOnce), sizeOf(t.dataGb), next.name, money(vs.stepUpMonthlyMore))
      + ' ' + fill(S.topUpBreakEven, vs.breakEvenDays);

    var gmail = $('gmail-line');
    var mailGb = types.indexOf('mail') !== -1 ? gbOf('mail') : 0;
    if (from === 'google' && mailGb > 0) {
      var days = gmailMailDays(mailGb);
      var chosen = { m1: 30, m3: 90, m6: 180, ready: null }[until];
      gmail.textContent = fill(S.gmailCeiling, mailGb, days)
        + (chosen !== null && days > chosen ? ' ' + fill(S.gmailLonger, S.until[until]) : '');
      gmail.hidden = false;
    } else {
      gmail.hidden = true;
    }
  }
  document.querySelectorAll('input[name="who"]').forEach(function (el) {
    el.addEventListener('change', function () { prefill(); recompute(); });
  });
  document.querySelectorAll('#calc input').forEach(function (el) {
    el.addEventListener('input', recompute);
    el.addEventListener('change', recompute);
  });
  // Arriving from a Leaving… page (0152 T5): ?from= chooses the source and
  // ?what= ticks what moves. Each is matched against the page's own options,
  // so a value it does not offer changes nothing.
  var asked = new URLSearchParams(location.search);
  document.querySelectorAll('input[name="from"]').forEach(function (el) {
    if (el.value === asked.get('from')) el.checked = true;
  });
  var what = (asked.get('what') || '').split(',').filter(function (t) { return cfg.objectTypes.indexOf(t) !== -1; });
  if (what.length > 0) cfg.objectTypes.forEach(function (t) { $('what-' + t).checked = what.indexOf(t) !== -1; });
  prefill();
  recompute();
})();
`;

/** The one script, the one hash. Exported for the drift test against nginx. */
export const CALC_SCRIPT = CALC_LIB + CALC_GLUE;

function calculatorPage(locale) {
  const c = COPY[locale].calc;
  const config = {
    locale: COPY[locale].htmlLang,
    objectTypes: OBJECT_TYPES,
    accounts: Object.fromEntries(CUSTOMER_TYPES.map((w) => [w.id, w.accounts])),
    profiles: INDICATIVE_PROFILES,
    tiers: TIERS.map(({ id, name, paths, dataGb, monthly, annual }) => ({ id, name, paths, dataGb, monthly, annual })),
    strings: c,
  };
  const radios = (name, options, checkedId) =>
    Object.entries(options)
      .map(
        ([id, label]) =>
          `<label class="opt"><input type="radio" name="${name}" value="${id}"${id === checkedId ? ' checked' : ''} /> ${esc(label)}</label>`,
      )
      .join('\n      ');
  const defaultTicked = ['mail', 'contacts', 'calendar', 'files'];
  const whatBoxes = OBJECT_TYPES.map(
    (t) =>
      `<label class="opt"><input type="checkbox" id="what-${t}"${defaultTicked.includes(t) ? ' checked' : ''} /> ${esc(c.what[t])}</label>`,
  ).join('\n      ');
  const amounts = OBJECT_TYPES.map(
    (t) => `<div class="amount" id="amount-${t}"><label for="gb-${t}">${esc(c.what[t])}</label>
        <input id="gb-${t}" type="number" min="0" step="0.1" inputmode="decimal" /> <span>${esc(c.gbLabel)}</span>
        <span class="items" id="items-${t}"></span></div>`,
  ).join('\n      ');

  // The JSON block is data, not an executable script: the CSP's script-src
  // governs what RUNS, and this never does. `<` is escaped so no value can
  // close the element.
  const configJson = JSON.stringify(config).replace(/</g, '\\u003c');

  return `
<h1>${esc(c.title)}</h1>
<p class="lede">${esc(c.lede)}</p>
<p class="hint">${esc(c.kept)}</p>

<div id="calc" class="calc">
  <fieldset><legend>${esc(c.whoLegend)}</legend>
    <div class="opts">${radios('who', c.who, 'individual')}</div>
  </fieldset>
  <fieldset><legend>${esc(c.fromLegend)}</legend>
    <div class="opts">${radios('from', c.from, 'google')}</div>
  </fieldset>
  <fieldset><legend>${esc(c.whatLegend)}</legend>
    <div class="opts">${whatBoxes}</div>
  </fieldset>
  <fieldset><legend>${esc(c.howMuchLegend)}</legend>
    <p class="hint">${esc(c.howMuchHint)}</p>
    <div class="amounts">${amounts}</div>
  </fieldset>
  <fieldset><legend>${esc(c.untilLegend)}</legend>
    <div class="opts">${radios('until', c.until, 'ready')}</div>
    <p class="hint">${esc(c.untilHint)}</p>
  </fieldset>
</div>

<div id="result" aria-live="polite">
<p id="paths-line"></p>

<div class="axes">
  <div class="axis" id="axis-paths"><span class="decides">${esc(c.axisDecides)}</span>
    <div>${esc(c.axisPaths)}</div><div class="val" id="axis-paths-val"></div></div>
  <div class="axis" id="axis-data"><span class="decides">${esc(c.axisDecides)}</span>
    <div>${esc(c.axisData)}</div><div class="val" id="axis-data-val"></div>
    <div class="fine" id="band-line"></div></div>
</div>

<div id="tier-card" hidden>
  <h3 id="tier-name"></h3>
  <p class="fine">${esc(c.tierDerived)}</p>
  <ul>
    <li id="tier-monthly"></li>
    <li id="tier-year"></li>
    <li id="tier-three"></li>
  </ul>
  <p class="fine">${esc(c.stepUpRule)}</p>
  <p class="fine">${esc(COPY[locale].vatIncluded)}</p>
</div>
<p id="beyond-line" hidden>${esc(c.beyondLine)} <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
</div>

<p id="gmail-line" class="fine" hidden></p>
<p id="topup-line" class="fine"></p>
<p>${esc(c.billDown)}</p>
<p><strong>${esc(c.cannotKnow)}</strong></p>

<h2>${esc(c.assumptionsTitle)}</h2>
<p class="fine">${esc(
    c.assumptionsVersion
      .replace('{0}', String(PROFILES_VERSION.version))
      .replace('{1}', PROFILES_VERSION.date),
  )}</p>
<p><a class="btn btn-ghost" href="${urlFor(locale, 'pricing')}">${esc(c.seeAllTiers)}</a></p>

<noscript><p class="draft">${esc(c.noscript)}</p></noscript>
<script type="application/json" id="calc-config">${configJson}</script>
<script>${CALC_SCRIPT}</script>
`;
}

// -------------------------------------------------------------------- main --

/**
 * Source file for each locale/page. Legal documents keep their own names.
 *
 * Exported so the guards can tell which pages are the legal ones (the entries
 * under `legal/`) from the build itself: `scripts/a-policy-link-that-answers`
 * holds the web app's links to them, and `scripts/legal-docs` its list of
 * documents (workplan 0139 T10).
 */
export const SOURCE = {
  en: { how: 'pages/en/how-it-works.md', pricing: 'pages/en/pricing.md', privacy: 'legal/privacy.md', terms: 'legal/terms.md', alpha: 'legal/alpha.md', guide: 'pages/en/alpha-guide.md' },
  nl: { how: 'pages/nl/hoe-het-werkt.md', pricing: 'pages/nl/prijzen.md', privacy: 'legal/privacy.nl.md', terms: 'legal/terms.nl.md', alpha: 'legal/alpha.nl.md', guide: 'pages/nl/alpha-handleiding.md' },
};

const META = {
  en: {
    home: ['Ownpace — move your data at your own pace', 'Move your mail, contacts, calendar and files from Google or Microsoft to a European provider, continuously, and cut over when you are ready.'],
    how: ['How it works — Ownpace', 'What a migration looks like from the first connection to the cutover.'],
    pricing: ['Pricing — Ownpace', 'Five tiers, published in full. Priced on how many migrations run at once and how much data you have moved.'],
    calculator: ['Estimate your migration — Ownpace', 'Five questions, an indicative band, and the tier it lands on — derived, never picked. No account, no email, nothing stored.'],
    privacy: ['Privacy policy — Ownpace', 'What Ownpace holds, why, for how long, and what it never does.'],
    terms: ['Terms of service — Ownpace', 'The terms for the managed Ownpace service.'],
    alpha: ['Alpha conditions — Ownpace', 'The conditions for taking part in the Alpha of the managed Ownpace service.'],
    guide: ['Guide to the Alpha — Ownpace', 'For the people invited to the Alpha: what it is, what to do before you start, how to start, where to get help and how to stop.'],
  },
  nl: {
    home: ['Ownpace — neem uw gegevens mee, in uw eigen tempo', 'Migreer uw e-mail, contacten, agenda en bestanden van Google of Microsoft naar een Europese aanbieder, doorlopend, en stap over wanneer u er klaar voor bent.'],
    how: ['Hoe het werkt — Ownpace', 'Hoe een migratie verloopt, van de eerste koppeling tot de overstap.'],
    pricing: ['Prijzen — Ownpace', 'Vijf pakketten, volledig gepubliceerd. Geprijsd op hoeveel migraties tegelijk lopen en hoeveel gegevens u hebt gemigreerd.'],
    calculator: ['Schat uw migratie — Ownpace', 'Vijf vragen, een indicatieve bandbreedte, en het pakket waar dat op uitkomt — afgeleid, nooit gekozen. Geen account, geen e-mail, niets wordt bewaard.'],
    privacy: ['Privacyverklaring — Ownpace', 'Wat Ownpace bewaart, waarom, hoe lang, en wat het nooit doet.'],
    terms: ['Servicevoorwaarden — Ownpace', 'De voorwaarden voor de beheerde Ownpace-dienst.'],
    alpha: ['Voorwaarden voor de Alpha — Ownpace', 'De voorwaarden voor deelname aan de Alpha van de beheerde Ownpace-dienst.'],
    guide: ['Handleiding voor de Alpha — Ownpace', 'Voor wie is uitgenodigd voor de Alpha: wat het is, wat u vooraf doet, hoe u begint, waar u hulp krijgt en hoe u stopt.'],
  },
};

/**
 * Every page, rendered to memory. `alpha` says whether the build is for the
 * alpha, which adds `ALPHA_ONLY`'s pages; it defaults to the environment's
 * answer (`ALPHA`), and is a parameter so `site/site.unit.test.ts` can render
 * both builds in one process.
 */
export function build({ alpha = ALPHA } = {}) {
  const rendered = [];
  for (const locale of LOCALES) {
    const c = COPY[locale];
    for (const key of [...PAGE_KEYS, ...LEAVING_KEYS, ...OUTSIDE_NAV, ...(alpha ? ALPHA_ONLY : [])]) {
      const page = LEAVING.find((p) => `leaving-${p.id}` === key);
      // A Leaving… page's title and description are its heading and its lede.
      const [title, description] = page
        ? [`${leavingTitle(locale, page)} — Ownpace`, c.leaving.lede[page.id] ?? c.leaving.ledeOf(c.leaving.names[page.id])]
        : META[locale][key];
      let body;
      if (key === 'home') {
        body = landing(locale);
      } else if (key === 'calculator') {
        body = calculatorPage(locale);
      } else if (page) {
        body = leavingPage(locale, page);
      } else {
        let md = readFileSync(join(HERE, SOURCE[locale][key]), 'utf8');
        // The app's request page, which differs per environment (a test site
        // hands its visitors to the test app): the guide names it as
        // [[REQUEST_ACCESS]] and never writes an app's address itself.
        if (key === 'guide') md = md.replace(/\[\[REQUEST_ACCESS\]\]/g, orderHref(locale, null));
        body = markdown(md);
        if (key === 'pricing') {
          const beyond = c
            .beyond(BEYOND.paths, size(BEYOND.dataGb), BEYOND.what)
            .replace('{MAILTO}', `mailto:${SUPPORT_EMAIL}`);
          body = body.replace(
            '<p>[[TIERS]]</p>',
            `<div class="pay"><fieldset class="pay-switch"><legend>${c.payLabel}</legend><div class="pay-options">` +
              `<input type="radio" name="pay" id="pay-year" value="year" checked /><label for="pay-year">${c.payYear}</label>` +
              `<input type="radio" name="pay" id="pay-month" value="month" /><label for="pay-month">${c.payMonth}</label>` +
              `</div></fieldset><p class="pay-rule">${c.payRule}</p>` +
              tierCards(locale) +
              '</div>' +
              `<div class="cta"><a class="btn btn-ghost" href="${urlFor(locale, 'calculator')}">${c.ctaEstimate}</a></div>` +
              `<p class="fineprint">${esc(c.vatIncluded)}</p>` +
              `<p class="fineprint">${beyond}</p>`,
          );
        }
        if ((key === 'privacy' || key === 'terms') && c.translationNote) {
          body = `<blockquote><p>${c.translationNote}</p></blockquote>\n` + body;
        }
      }
      const draft = /class="todo"/.test(body);
      rendered.push({
        locale,
        key,
        file: `${localeRoot(locale).replace(/^\//, '')}${localeRoot(locale) ? '/' : ''}${c.files[key]}`,
        html: layout({ title, description, body, locale, key, draft }),
      });
    }
  }
  // THE PAGE FOR AN ADDRESS THAT IS NOT A PAGE.
  //
  // Deliberately NOT in PAGE_KEYS: it must not appear in the nav, and it has no
  // entry in `files` because nginx addresses it directly (`error_page 404
  // /404.html`, and `/nl/404.html` for the Dutch tree).
  //
  // Until 2026-08-25 `www-nginx.conf` said `error_page 404 /index.html`, so
  // every wrong address served the HOME PAGE — with a 404 status, which is the
  // worst of both: a visitor sees a working site and concludes the link was
  // fine, while a crawler is told the page is missing.
  //
  // `key: 'home'` marks the nav's Home entry as current. There is no truthful
  // answer here — this address is no page — and Home is where the only link on
  // it goes.
  for (const locale of LOCALES) {
    const c = COPY[locale];
    const body =
      `<h1>${c.notFound.heading}</h1>\n` +
      `<p class="lede">${c.notFound.lede}</p>\n` +
      `<p><a class="cta" href="${localeRoot(locale) || '/'}">${c.notFound.back}</a></p>\n` +
      `<p class="fineprint">${c.notFound.status} <a href="${STATUS_URL}">${STATUS_URL.replace(/^https?:\/\//, '')}</a></p>`;
    rendered.push({
      locale,
      key: 'home',
      file: `${localeRoot(locale).replace(/^\//, '')}${localeRoot(locale) ? '/' : ''}404.html`,
      html: layout({
        title: c.notFound.title,
        description: c.notFound.title,
        body,
        locale,
        key: 'home',
        draft: false,
      }),
    });
  }

  const drafts = rendered.reduce((n, p) => n + (p.html.match(/class="todo"/g) ?? []).length, 0);
  return { rendered, drafts };
}

/**
 * A LEGAL PAGE WHOSE VERSION LINE SAYS DRAFT IS NOT PUBLISHED (workplan 0139 T2).
 *
 * The placeholder refusal below stops a page that is visibly unfinished. It did
 * not stop one that looks finished and was never approved: every placeholder
 * filled, and the *Version* line still reading "draft for legal review — not
 * yet published". An indexable page that says of itself that it is not
 * published is a contradiction any tester can read, and the version is what a
 * tester accepts (0139 T3).
 *
 * So a `--public` build refuses every legal page it renders (the `legal/`
 * entries of `SOURCE`, in `PAGE_KEYS` or not: a page can be rendered outside
 * the nav, as the 404 page is) whose version line holds one of `DRAFT_WORDS`,
 * and one with no version line at all, which cannot be told apart from a draft.
 * Only that line is read, outside HTML comments, where the lawyer's briefings
 * say "DRAFT" on purpose. The words match anywhere in the line and in any case,
 * so a Dutch compound such as "conceptversie" or "ontwerpversie" is caught too:
 * a false alarm costs a reworded version line, a miss costs a published draft.
 *
 * `--public --check` counts them and exits 1 as well. A check that passed what
 * the build then refuses is a deploy that moves the app first and finds out
 * about the site after, which is what a check before a deploy exists to stop.
 *
 * Until the owner's final-text pull request removes the words, every `--public`
 * build refuses. That is intended: privacy and terms say "not yet published"
 * about themselves.
 *
 * Exported so `scripts/legal-docs.unit.test.ts` reads each document's version
 * line the way this build does, instead of keeping a copy of the pattern.
 */
export const VERSION_LINE = /^\*\*(?:Version|Versie):\*\*/;
export const DRAFT_WORDS = /draft|concept|ontwerp|voorlopig|not yet published|nog niet gepubliceerd/i;

/** A legal text's *Version* line, read outside HTML comments; `undefined` when it has none. */
export function versionLineOf(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => VERSION_LINE.test(l));
}

/** `site/legal/<file>: <why>` for each legal page a public build must not publish. */
function unpublishableLegalPages() {
  const out = [];
  for (const locale of LOCALES) {
    for (const src of Object.values(SOURCE[locale]).filter((s) => s.startsWith('legal/'))) {
      const line = versionLineOf(readFileSync(join(HERE, src), 'utf8'));
      if (line === undefined) out.push(`site/${src}: no **Version:** or **Versie:** line`);
      else if (DRAFT_WORDS.test(line)) out.push(`site/${src}: ${line}`);
    }
  }
  return out;
}

/** Why `--public` refuses these pages, naming each: the build throws it, `--check` prints it. */
function draftRefusal(unpublishable) {
  return (
    `--public makes this site indexable, and ${unpublishable.length} legal page(s) say on their\n` +
    'version line that they are a draft or not yet published (or have no version line):\n' +
    unpublishable.map((u) => `  ${u}\n`).join('') +
    'Publish the text the owner and the lawyer approved, whose version line says neither\n' +
    '(site/legal/README.md), or build without --public.'
  );
}

/**
 * Exported so `site/site.unit.test.ts` can inspect every rendered page without
 * a build step and without touching the filesystem. Importing this module
 * therefore renders but writes NOTHING — the writing happens only when the
 * file is run directly, which is the difference between a build tool and a
 * module a test may import.
 */
export const { rendered, drafts } = build();

/**
 * CLEAR THE CONTENTS OF `dist`, NEVER THE DIRECTORY ITSELF.
 *
 * `rmSync(DIST) + mkdirSync(DIST)` is the obvious way to start from clean and
 * it hands the directory a NEW INODE. A Docker bind mount resolves to an inode
 * when the container starts, so a running nginx keeps looking at the old,
 * now-unlinked directory: `ls` inside the container shows `total 0`, and every
 * request gets `directory index of "/usr/share/nginx/html/" is forbidden` —
 * a 403 that looks like a permissions problem and is not one.
 *
 * That happened on the Spark on 2026-08-24. The site served 200s at 19:49,
 * a republish at 20:20 replaced the directory, and `www.ota.ownpace.eu`
 * answered 403 from then on with the files sitting correctly on disk the
 * whole time. `deploy/compose/www.yml` promised in its own header that a
 * rebuild needs no restart — which was false precisely because of these two
 * lines, and is true because of this function.
 *
 * Same inode, same mount, contents replaced. `readdirSync` + per-entry remove
 * does exactly that, and creates the directory when it is genuinely absent.
 */
function emptyDist() {
  if (!existsSync(DIST)) {
    mkdirSync(DIST, { recursive: true });
    return;
  }
  for (const entry of readdirSync(DIST)) rmSync(join(DIST, entry), { recursive: true, force: true });
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runDirectly && process.argv.includes('--check')) {
  for (const p of rendered) console.log(`  ${p.file.padEnd(26)} ${p.html.length} bytes`);
  // The draft version lines are refused here as the build refuses them, so a
  // `--public --check` that passes is a `--public` build that writes.
  const unpublishable = unpublishableLegalPages();
  console.log(`[site] ${unpublishable.length} legal page(s) marked draft on their version line, or with none`);
  if (PUBLIC && unpublishable.length > 0) {
    console.error(draftRefusal(unpublishable));
    process.exitCode = 1;
  } else {
    for (const u of unpublishable) console.log(`  ${u}`);
  }
  // A deploy that checks a tag's site before it moves anything reads this line
  // (0139 T10), so it stays the last, in its shape, and the count stays a count
  // under --public.
  console.log(`[site] ${rendered.length} pages across ${LOCALES.length} locales, ${drafts} unfilled placeholder(s)`);
} else if (runDirectly) {
  // A PUBLIC BUILD WITH UNFILLED PLACEHOLDERS IS NOT A WARNING, IT IS A STOP.
  //
  // The two messages below used to be printed about the SAME build: "PUBLIC
  // build — indexable. Every placeholder must be filled." and then "This build
  // is fine for a test host and MUST NOT be published publicly." Both true,
  // flatly contradictory, and neither stopped anything — so the way to publish
  // a terms page reading `[[COMPANY_ADDRESS]]` was to ignore two lines of
  // output. `must be filled` is now enforced where it is claimed.
  if (PUBLIC && drafts > 0) {
    throw new Error(
      `${drafts} placeholder token(s) are still unfilled, and --public makes this site\n` +
        'indexable. Legal pages carrying [[TOKENS]] are not publishable.\n' +
        'Fill them — see site/legal/README.md — or build without --public.',
    );
  }
  const unpublishable = unpublishableLegalPages();
  if (PUBLIC && unpublishable.length > 0) throw new Error(draftRefusal(unpublishable));
  emptyDist();
  for (const p of rendered) {
    const dest = join(DIST, p.file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, p.html);
  }
  if (existsSync(join(HERE, 'brand'))) cpSync(join(HERE, 'brand'), join(DIST, 'brand'), { recursive: true });
  writeFileSync(
    join(DIST, 'robots.txt'),
    PUBLIC ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n',
  );
  // Where a vulnerability is reported (0139 T9): the channel SECURITY.md
  // names, in the same order, with an Expires the RFC requires.
  mkdirSync(join(DIST, '.well-known'), { recursive: true });
  writeFileSync(join(DIST, '.well-known', 'security.txt'), securityTxt({ now: new Date(), isPublic: PUBLIC }));
  for (const p of rendered) console.log(`[site] wrote dist/${p.file}`);
  console.log(
    PUBLIC
      ? '[site] PUBLIC build — indexable. Every placeholder must be filled.'
      : '[site] test build — noindex, and robots.txt disallows everything. Pass --public for www.ownpace.eu.',
  );
  if (drafts > 0) {
    console.log(
      `[site] ${drafts} unfilled placeholder token(s) rendered visibly — see site/legal/README.md.\n` +
        `[site] This build is fine for a test host and MUST NOT be published publicly.`,
    );
  }
  if (unpublishable.length > 0) {
    console.log(
      `[site] ${unpublishable.length} legal page(s) still marked draft on their version line; ` +
        'a --public build refuses them.',
    );
  }
}
