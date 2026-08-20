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

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TIERS, BEYOND, SUPPORT_EMAIL, money, size, total, firstMonth } from './prices.mjs';
import { LOCALES, DEFAULT_LOCALE, localeRoot, COPY } from './copy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist');

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

footer.site { border-top: 1px solid var(--line); margin-top: 5rem; padding: 2.5rem 0 4rem; color: var(--muted); font-size: 0.92rem; }
footer.site .wrap { display: flex; gap: 2rem; flex-wrap: wrap; justify-content: space-between; }
footer.site a { color: var(--muted); }
.skip { position: absolute; left: -9999px; }
.skip:focus { left: 1rem; top: 1rem; background: var(--bg); padding: 0.5rem 1rem; z-index: 10; }
`;

// ------------------------------------------------------------------ layout --

/** Every page, in every locale, so the switcher and hreflang can be built. */
const PAGE_KEYS = ['home', 'how', 'pricing', 'privacy', 'terms'];

const urlFor = (locale, key) => {
  const file = COPY[locale].files[key];
  return `${localeRoot(locale)}/${file === 'index.html' ? '' : file}`;
};

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
  <div><strong>Ownpace</strong> — ${c.footerTag}<br />${c.footerOss}</div>
  <div>
    <a href="${urlFor(locale, 'privacy')}">${c.nav.privacy}</a> ·
    <a href="${urlFor(locale, 'terms')}">${c.nav.terms}</a> ·
    <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
  </div>
</div></footer>
</body>
</html>
`;
}

const orderHref = (locale, tier) =>
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Ownpace — ${tier ? tier.name : COPY[locale].ctaOrder}`)}`;

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
  <p><a class="btn ${featured ? 'btn-primary' : 'btn-ghost'}" href="${orderHref(locale, t)}">${c.tierStart(t.name)}</a></p>
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
    <a class="btn btn-primary" href="${orderHref(locale, null)}">${c.ctaOrder}</a>
    <a class="btn btn-ghost" href="${urlFor(locale, 'pricing')}">${c.ctaPricing}</a>
  </div>
  <p class="fineprint">${c.heroFine(money(firstMonth(TIERS[0])))}</p>
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
    privacy: ['Privacy policy — Ownpace', 'What Ownpace holds, why, for how long, and what it never does.'],
    terms: ['Terms of service — Ownpace', 'The terms for the managed Ownpace service.'],
  },
  nl: {
    home: ['Ownpace — verhuis uw gegevens in uw eigen tempo', 'Verhuis uw e-mail, contacten, agenda en bestanden van Google of Microsoft naar een Europese aanbieder, doorlopend, en stap over wanneer u er klaar voor bent.'],
    how: ['Hoe het werkt — Ownpace', 'Hoe een verhuizing verloopt, van de eerste koppeling tot de overstap.'],
    pricing: ['Prijzen — Ownpace', 'Vijf pakketten, volledig gepubliceerd. Geprijsd op hoeveel verhuizingen tegelijk lopen en hoeveel gegevens u hebt verhuisd.'],
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
      } else {
        const md = readFileSync(join(HERE, SOURCE[locale][key]), 'utf8');
        body = markdown(md);
        if (key === 'pricing') {
          const beyond = c
            .beyond(BEYOND.paths, size(BEYOND.dataGb), BEYOND.what)
            .replace('{MAILTO}', `mailto:${SUPPORT_EMAIL}`);
          body = body.replace('<p>[[TIERS]]</p>', tierCards(locale) + `<p class="fineprint">${beyond}</p>`);
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

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runDirectly && process.argv.includes('--check')) {
  for (const p of rendered) console.log(`  ${p.file.padEnd(26)} ${p.html.length} bytes`);
  console.log(`[site] ${rendered.length} pages across ${LOCALES.length} locales, ${drafts} unfilled placeholder(s)`);
} else if (runDirectly) {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  for (const p of rendered) {
    const dest = join(DIST, p.file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, p.html);
  }
  if (existsSync(join(HERE, 'brand'))) cpSync(join(HERE, 'brand'), join(DIST, 'brand'), { recursive: true });
  writeFileSync(join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  for (const p of rendered) console.log(`[site] wrote dist/${p.file}`);
  if (drafts > 0) {
    console.log(
      `[site] ${drafts} unfilled placeholder token(s) rendered visibly — see site/legal/README.md.\n` +
        `[site] This build is fine for a test host and MUST NOT be published publicly.`,
    );
  }
}
