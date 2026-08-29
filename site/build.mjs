#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * build.mjs — the public site, generated into `site/dist/`.
 *
 *   node site/build.mjs            # build
 *   node site/build.mjs --check    # build to memory and report, writing nothing
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
 * (site/legal/README.md lists all twelve); a draft that looks finished is the
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
  APP_URL,
  PUBLIC_APP_URL,
  STATUS_URL,
  money,
  size,
  total,
  firstMonth,
} from './prices.mjs';
import { LOCALES, DEFAULT_LOCALE, localeRoot, COPY } from './copy.mjs';
import { CUSTOMER_TYPES, INDICATIVE_PROFILES, OBJECT_TYPES, PROFILES_VERSION } from './profiles.mjs';

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
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = inline(h[2]);
      const id = slug(h[2]);
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
nav.site { margin-left: auto; display: flex; gap: 1.25rem; flex-wrap: wrap; }
nav.site a { text-decoration: none; color: var(--muted); font-size: 0.95rem; }
nav.site a:hover, nav.site a[aria-current] { color: var(--ink); }
nav.site a.lang {
  border: 1px solid var(--line); border-radius: 999px; padding: 0.15rem 0.7rem; font-size: 0.85rem;
}
nav.site a.lang:hover { border-color: var(--teal); color: var(--teal); }
@media (prefers-color-scheme: dark) { nav.site a.lang:hover { border-color: var(--mint); color: var(--mint); } }
@media (max-width: 40rem) {
  header.site .wrap { height: auto; padding-top: 0.75rem; padding-bottom: 0.75rem; flex-wrap: wrap; }
  nav.site { margin-left: 0; width: 100%; gap: 0.9rem; }
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
.card { border: 1px solid var(--line); border-radius: 12px; padding: 1.25rem; background: var(--panel); }
.card h3 { margin-top: 0; }
.card p:last-child { margin-bottom: 0; }
.step { font-variant-numeric: tabular-nums; color: var(--mint); font-weight: 700; }

/* pricing */
.tiers { display: grid; gap: 0.85rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr)); margin: 2rem 0; }
.tier {
  border: 1px solid var(--line); border-radius: 12px; padding: 2.6rem 1.1rem 1.1rem;
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
/* Absolutely placed, with room reserved by .tier's top padding, so every card's
   heading — and therefore every price — sits on the same line. */
.badge {
  position: absolute; top: 0.9rem; left: 1.1rem;
  background: var(--mint); color: #06201c; font-size: 0.68rem; font-weight: 700;
  letter-spacing: 0.05em; text-transform: uppercase; padding: 0.15rem 0.5rem; border-radius: 999px;
}

/* calculator (workplan 0088 T3) */
.calc fieldset { border: 1px solid var(--line); border-radius: 12px; padding: 1rem 1.25rem 1.25rem; margin: 1.25rem 0; }
.calc legend { font-weight: 650; padding: 0 0.4rem; }
.calc .opts { display: flex; flex-wrap: wrap; gap: 0.4rem 1.1rem; }
.calc label.opt { display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.2rem 0; cursor: pointer; }
.calc .hint { color: var(--muted); font-size: 0.9rem; margin: 0.5rem 0 0; }
.calc .amounts { display: grid; gap: 0.5rem 1rem; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); margin-top: 0.75rem; }
.calc .amount { display: flex; align-items: baseline; gap: 0.5rem; }
.calc .amount input { width: 6.5rem; padding: 0.35rem 0.5rem; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); font: inherit; }
.calc .amount .items { color: var(--muted); font-size: 0.8rem; }
.calc .amount[data-off] { opacity: 0.45; }
#paths-line { font-weight: 600; margin: 1.5rem 0 0.5rem; }
.axes { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); margin: 1rem 0; }
.axis { border: 1px solid var(--line); border-radius: 12px; padding: 1rem 1.25rem; position: relative; }
.axis .val { font-size: 1.6rem; font-weight: 700; }
.axis .decides { display: none; position: absolute; top: 0.75rem; right: 1rem;
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
  const nav = PAGE_KEYS.map((k) => {
    const href = urlFor(locale, k);
    const current = k === key ? ' aria-current="page"' : '';
    return `<a href="${href}"${current}>${c.nav[k]}</a>`;
  }).join('');

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
  <nav class="site">${nav}<a class="lang" href="${urlFor(other, key)}" lang="${COPY[other].htmlLang}">${c.otherLangName}</a></nav>
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
    TIERS.map((t) => {
      const featured = t.id === 'small';
      return `<div class="tier${featured ? ' featured' : ''}">
  ${featured ? `<span class="badge">${c.tierBadge}</span>` : ''}
  <h3>${t.name}</h3>
  <p class="who">${esc(t.who)}</p>
  <div class="price">${money(firstMonth(t))} <span>${c.tierFirstMonth}</span></div>
  <div class="price" style="font-size:1.1rem">${money(t.monthly)} <span>${c.tierThen}</span></div>
  <ul>
    <li>${c.tierPaths(t.paths)}</li>
    <li>${c.tierData(size(t.dataGb))}</li>
    <li>${c.tierSetup(money(t.setup))}</li>
    <li>${c.tierThree(money(total(t, 3)))}</li>
  </ul>
  <p class="note">${esc(t.note)}</p>
  <p><a class="btn ${featured ? 'btn-primary' : 'btn-ghost'}" href="${esc(orderHref(locale, t))}">${c.tierStart(t.name)}</a></p>
</div>`;
    }).join('') +
    '</div>'
  );
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
  <p class="fineprint">${c.heroFine(money(firstMonth(TIERS[0])))} ${esc(c.vatIncluded)}</p>
</section>

<h2>${c.diffTitle}</h2>
${cards(c.diff)}

<h2>${c.wontTitle}</h2>
<p>${c.wontLede}</p>
${cards(c.wont)}

<h2>${c.costTitle}</h2>
<p>${c.costLede}</p>
<p>${c.costPick(small.name, money(firstMonth(small)), money(small.monthly), small.paths, size(small.dataGb))}</p>
<div class="cta">
  <a class="btn btn-primary" href="${urlFor(locale, 'pricing')}">${c.ctaAllTiers}</a>
  <a class="btn btn-ghost" href="${urlFor(locale, 'how')}">${c.ctaHow}</a>
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
  function euro(n) { return '\\u20ac' + n; }
  function sizeOf(gb) { return gb >= 1000 ? (gb / 1000) + ' TB' : gb + ' GB'; }
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
    $('tier-setup').textContent = fill(S.tierSetup, euro(t.setup));
    $('tier-monthly').textContent = fill(S.tierMonthly, euro(t.monthly));
    $('tier-first').textContent = fill(S.tierFirstMonth, euro(t.setup + t.monthly));
    $('tier-three').textContent = fill(S.tierThree, euro(t.setup + t.monthly * 3));

    var next = cfg.tiers[cfg.tiers.indexOf(t) + 1];
    var vs = topUpAgainstStepUp(t, next);
    $('topup-line').textContent = !vs ? '' :
      fill(S.topUpLine, t.name, euro(vs.topUpOnce), sizeOf(t.dataGb), next.name, euro(vs.stepUpNow), euro(vs.stepUpMonthlyMore))
      + ' ' + (vs.extraUpFront <= 0 ? S.topUpCheaper
        : vs.paybackDays === null ? ''
        : fill(S.topUpBreakEven, euro(vs.extraUpFront), euro(vs.stepUpMonthlyMore), vs.paybackDays));

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
    tiers: TIERS.map(({ id, name, paths, dataGb, setup, monthly }) => ({ id, name, paths, dataGb, setup, monthly })),
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
    <li id="tier-setup"></li>
    <li id="tier-monthly"></li>
    <li id="tier-first"></li>
    <li id="tier-three"></li>
  </ul>
  <p class="fine">${esc(c.stepUpRule)}</p>
  <p class="fine">${esc(COPY[locale].vatIncluded)}</p>
</div>
<p id="beyond-line" hidden>${esc(c.beyondLine)} <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>

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

/** Source file for each locale/page. Legal documents keep their own names. */
const SOURCE = {
  en: { how: 'pages/en/how-it-works.md', pricing: 'pages/en/pricing.md', privacy: 'legal/privacy.md', terms: 'legal/terms.md' },
  nl: { how: 'pages/nl/hoe-het-werkt.md', pricing: 'pages/nl/prijzen.md', privacy: 'legal/privacy.nl.md', terms: 'legal/terms.nl.md' },
};

const META = {
  en: {
    home: ['Ownpace — move your data at your own pace', 'Move your mail, contacts, calendar and files from Google or Microsoft to a European provider, continuously, and cut over when you are ready.'],
    how: ['How it works — Ownpace', 'What a migration looks like from the first connection to the cutover.'],
    pricing: ['Pricing — Ownpace', 'Five tiers, published in full. Priced on how many migrations run at once and how much data you have moved.'],
    calculator: ['Estimate your migration — Ownpace', 'Five questions, an indicative band, and the tier it lands on — derived, never picked. No account, no email, nothing stored.'],
    privacy: ['Privacy policy — Ownpace', 'What Ownpace holds, why, for how long, and what it never does.'],
    terms: ['Terms of service — Ownpace', 'The terms for the managed Ownpace service.'],
  },
  nl: {
    home: ['Ownpace — verhuis uw gegevens in uw eigen tempo', 'Verhuis uw e-mail, contacten, agenda en bestanden van Google of Microsoft naar een Europese aanbieder, doorlopend, en stap over wanneer u er klaar voor bent.'],
    how: ['Hoe het werkt — Ownpace', 'Hoe een verhuizing verloopt, van de eerste koppeling tot de overstap.'],
    pricing: ['Prijzen — Ownpace', 'Vijf pakketten, volledig gepubliceerd. Geprijsd op hoeveel verhuizingen tegelijk lopen en hoeveel gegevens u hebt verhuisd.'],
    calculator: ['Schat uw verhuizing — Ownpace', 'Vijf vragen, een indicatieve bandbreedte, en het pakket waar dat op uitkomt — afgeleid, nooit gekozen. Geen account, geen e-mail, niets wordt bewaard.'],
    privacy: ['Privacyverklaring — Ownpace', 'Wat Ownpace bewaart, waarom, hoe lang, en wat het nooit doet.'],
    terms: ['Servicevoorwaarden — Ownpace', 'De voorwaarden voor de beheerde Ownpace-dienst.'],
  },
};

function build() {
  const rendered = [];
  for (const locale of LOCALES) {
    const c = COPY[locale];
    for (const key of PAGE_KEYS) {
      const [title, description] = META[locale][key];
      let body;
      if (key === 'home') {
        body = landing(locale);
      } else if (key === 'calculator') {
        body = calculatorPage(locale);
      } else {
        const md = readFileSync(join(HERE, SOURCE[locale][key]), 'utf8');
        body = markdown(md);
        if (key === 'pricing') {
          const beyond = c
            .beyond(BEYOND.paths, size(BEYOND.dataGb), BEYOND.what)
            .replace('{MAILTO}', `mailto:${SUPPORT_EMAIL}`);
          body = body.replace(
            '<p>[[TIERS]]</p>',
            tierCards(locale) +
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
}
