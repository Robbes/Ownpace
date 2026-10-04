// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ALPHA BY ITS NAME (the owner, 2026-10-04, on #1439: *"akkoord, Alpha"*;
 * workplan 0131 T1, 0144 T1).
 *
 * The test phase had two spellings. The Alpha conditions
 * (`site/legal/alpha.nl.md`, `alpha.md`) and the acceptance screen wrote
 * *Alpha*, a proper name. The app's note, its other sentences, the mails, the
 * API's refusals and the tester guide wrote *alfa* in Dutch and *the alpha* in
 * English, by the glossary's old rule. The acceptance screen showed both at
 * once: the note said *"de alfa kan stoppen"* above a link to the *"Voorwaarden
 * voor de Alpha"*. The owner chose the conditions' spelling: *Alpha*, with a
 * capital, in both languages' running text (*de Alpha*, *tijdens de Alpha*,
 * *the Alpha can end*), never *alfa*, never a lower-case *alpha*.
 *
 * This reads what a tester or an applicant can read, and finds neither:
 *
 *  1. every value of the web dictionary, in both languages;
 *  2. the two mails that speak of the Alpha (`access_granted` and
 *     `member_invited`), rendered in both languages with every line the Alpha
 *     adds;
 *  3. every string written in the source of an app or a package, and the
 *     site's build and copy, read by TypeScript's parser so that a comment is
 *     never read and a `/*` inside quotes hides nothing: *alfa* in any
 *     string, and a lower-case *alpha* in any string with a space in it (a
 *     sentence, not a key). The API's refusals (the 400 for a role the Alpha
 *     does not have, the 409 for a ceiling there is nothing to agree to) and
 *     the engine's too-large sentence, which the app shows word for word, are
 *     not in the dictionary. One operator's log line keeps *an alpha stack*,
 *     listed by its file and its exact words (`FOR_THE_OPERATOR`);
 *  4. every page the site writes, the alpha build's tester guide among them:
 *     its title, its description and its text, and its file name. The Dutch
 *     guide moved with the name, to `nl/alpha-handleiding.html`. The note
 *     names the guide by the page's own title, in both languages;
 *  5. the setup guides the app serves (`docs/guides/`).
 *
 * NOT READ: identifiers and keys (`alpha.note.lead`, the error code
 * `nothing_charged_during_the_alpha`), a setting's value
 * (`OWNPACE_STAGE=alpha`), file names in an address (`alpha.html`), the
 * version (`v0.2.0-alpha.1`) and comments. The legal texts are read as built
 * pages (4), and say *Alpha* already. Test files are not read: they quote
 * what they forbid.
 *
 * It failed on cd318823, before the change, in 13 of its 17 cases: fifteen
 * dictionary values (seven English, eight Dutch), both mails in both
 * languages, the API's two sentences and the engine's one, the site's page
 * titles, the tester guide in both languages (the Dutch one by its file name
 * too), and the note, which named no guide.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { STRINGS } from '../apps/web/src/i18n/strings.ts';
import { renderEvent, type NotificationEvent } from '../packages/shared/src/notifications.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** *alfa*, in any case: the old Dutch spelling. */
const ALFA = /\balfa\b/i;
/** A lower-case *alpha* as a word: the name, written the old way. */
const LOWER = /\balpha\b/;

/**
 * Prose, with what is not prose taken out first: an address (`…/alpha.html`),
 * a version (`v0.2.0-alpha.1`) and a setting's value (`OWNPACE_STAGE=alpha`)
 * carry the word as an identifier.
 */
function prose(text: string): string {
  return text
    .replace(/\bhttps?:\/\/\S+/g, ' ')
    .replace(/\bv?\d+\.\d+\.\d+-alpha(?:\.\d+)?\b/g, ' ')
    .replace(/\b[A-Z][A-Z0-9_]*=alpha\b/g, ' ');
}

/** What is wrong with one piece of text, or nothing. */
function misspelt(text: string): string[] {
  const p = prose(text);
  return [
    ...(p.match(new RegExp(`.{0,30}${ALFA.source}.{0,20}`, 'gi')) ?? []),
    ...(p.match(new RegExp(`.{0,30}${LOWER.source}.{0,20}`, 'g')) ?? []),
  ];
}

const WHY =
  'The owner, 2026-10-04 (#1439): "akkoord, Alpha". The test phase is the Alpha,\n' +
  'a proper name, as the Alpha conditions write it: "de Alpha", "tijdens de\n' +
  'Alpha", "the Alpha can end". Never "alfa", never a lower-case "alpha"\n' +
  '(apps/web/src/i18n/GLOSSARY.md).';

describe('1. the web dictionary', () => {
  it('has the values this reads, so an empty dictionary cannot pass', () => {
    for (const locale of ['en', 'nl'] as const) {
      expect(Object.keys(STRINGS[locale]).length).toBeGreaterThan(1000);
      expect(STRINGS[locale]['alpha.note.lead']).toBeTruthy();
    }
  });

  it.each(['en', 'nl'] as const)('says Alpha, never alfa or a lower-case alpha, in %s', (locale) => {
    const wrong = Object.entries(STRINGS[locale])
      .filter(([, value]) => misspelt(value).length > 0)
      .map(([key, value]) => `${key}: ${value}`);
    expect(wrong, WHY).toEqual([]);
    // And the note names it, as the owner's own example does: "Alpha: een
    // kleine, uitgenodigde groep …".
    expect(STRINGS[locale]['alpha.note.lead']).toMatch(/^Alpha: /);
    expect(STRINGS[locale]['alpha.note.terms']).toMatch(/\bAlpha\b/);
  });
});

describe('2. the mails that speak of the Alpha', () => {
  const SITE = 'https://www.ownpace.eu';
  /** Every line the Alpha adds, with addresses as the API makes them. */
  const EVENTS = {
    access_granted: {
      kind: 'access_granted',
      organisation: 'Familie de Vries',
      appUrl: 'https://app.ownpace.eu',
      email: 'stranger@example.test',
      alpha: true,
      alphaConditions: { en: `${SITE}/alpha.html`, nl: `${SITE}/nl/alpha.html` },
      testerGuide: { en: `${SITE}/alpha-guide.html`, nl: `${SITE}/nl/alpha-handleiding.html` },
    },
    member_invited: {
      kind: 'member_invited',
      organisation: 'Familie Berentsen',
      invitedBy: 'rob@example.test',
      appUrl: 'https://app.ownpace.eu',
      email: 'test@ownpace.test',
      privacyPolicy: `${SITE}/privacy.html`,
      alpha: true,
      alphaConditions: `${SITE}/alpha.html`,
      testerGuide: `${SITE}/alpha-guide.html`,
    },
  } as const;

  for (const [kind, event] of Object.entries(EVENTS)) {
    it.each(['en', 'nl'] as const)(`${kind} says Alpha, never alfa or a lower-case alpha, in %s`, (locale) => {
      const { subject, body } = renderEvent(event as unknown as NotificationEvent, locale);
      // The vacuity check: the mail does speak of the Alpha.
      expect(body).toMatch(/^Alpha: /m);
      expect(misspelt(`${subject}\n${body}`), WHY).toEqual([]);
    });
  }
});

/** Every source file under `dir`, test files left out. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!['node_modules', 'dist', 'build', 'coverage'].includes(name)) out.push(...sources(path));
    } else if (/\.(ts|tsx|mts|mjs|js)$/.test(name) && !name.includes('.test.')) {
      out.push(path);
    }
  }
  return out;
}

/** One string a source file writes, and where. */
interface Written {
  readonly at: string;
  readonly text: string;
}

/**
 * Every string a file writes, read by TypeScript's own parser: string
 * literals, the text of a template, and JSX text. A comment is never a string
 * here, and a `/*` inside quotes (`'image/*'`, a glob) is a string, not the
 * start of a comment that hides the code after it.
 */
function written(file: string): Written[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : /\.m?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
  const out: Written[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      out.push({ at: `${relative(ROOT, file)}:${line}`, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * What is wrong with one string: *alfa* anywhere, or a lower-case *alpha* in
 * a sentence. A string with no space in it is a key, a stage value or a page's
 * key (`'alpha'`, `'alpha.note.lead'`), not a sentence.
 */
function wrongIn(text: string): boolean {
  return ALFA.test(text) || (/\s/.test(text) && LOWER.test(prose(text)));
}

/**
 * The operator's own words, which no tester or applicant reads: the API's
 * refusal to start, in its log. Each by its file and its exact text, so a new
 * sentence is read like any other.
 */
const FOR_THE_OPERATOR: ReadonlyArray<{ readonly file: string; readonly text: string }> = [
  { file: 'apps/api/src/config-guards.ts', text: 'and an alpha stack must say whether it keeps any. ' },
];

describe('3. the sentences written in the source', () => {
  const files = [
    ...['apps', 'packages'].flatMap((top) =>
      readdirSync(join(ROOT, top)).flatMap((name) => {
        const src = join(ROOT, top, name, 'src');
        return existsSync(src) && statSync(src).isDirectory() ? sources(src) : [];
      }),
    ),
    join(ROOT, 'site/build.mjs'),
    join(ROOT, 'site/copy.mjs'),
  ];
  const strings = files.flatMap(written);

  it('reads the files the sentences live in, and the sentences in them, so an empty walk cannot pass', () => {
    const read = files.map((f) => relative(ROOT, f));
    expect(read.length).toBeGreaterThan(500);
    for (const known of [
      'apps/api/src/routes/tenants/members.ts',
      'apps/api/src/routes/billing/index.ts',
      'packages/core/src/largest-file.ts',
      'packages/shared/src/notifications.ts',
      'apps/web/src/i18n/strings.ts',
      'site/build.mjs',
    ]) {
      expect(read, `the walk missed ${known}`).toContain(known);
    }
    const texts = strings.map((w) => w.text);
    expect(texts.length).toBeGreaterThan(10_000);
    // The API's two sentences, read as strings.
    expect(texts).toContain('During the Alpha, a person can only be an owner or an admin.');
    expect(texts).toContain('Nothing is charged during the Alpha, so there is nothing to agree to yet.');
    // A string after a quoted `/*` ('image/*', graph-contacts-source.ts) is
    // still read: a comment stripper that took it for a comment's start
    // blanked the next twenty lines.
    expect(texts).toContain('Writing the card without it would lose the photo without saying so.');
  });

  it('finds no alfa, and no lower-case alpha in a sentence, in any string outside a comment', () => {
    const allowed = (w: Written) =>
      FOR_THE_OPERATOR.some((o) => w.at.startsWith(`${o.file}:`) && w.text === o.text);
    const saying = strings.filter((w) => wrongIn(w.text) && !allowed(w)).map((w) => `${w.at}  ${JSON.stringify(w.text)}`);
    expect(saying, WHY).toEqual([]);
  });

  it("the operator's sentences it leaves alone are still there, so the list cannot go stale", () => {
    for (const o of FOR_THE_OPERATOR) {
      expect(
        strings.some((w) => w.at.startsWith(`${o.file}:`) && w.text === o.text && wrongIn(w.text)),
        `${o.file} no longer says ${JSON.stringify(o.text)}: take it off FOR_THE_OPERATOR`,
      ).toBe(true);
    }
  });
});

interface Page {
  readonly file: string;
  readonly key: string;
  readonly html: string;
}

/** The real site build, in a child process, for the alpha or not. */
const builds = new Map<boolean, Page[]>();
function siteBuild(alpha: boolean): Page[] {
  const hit = builds.get(alpha);
  if (hit) return hit;
  const build = pathToFileURL(join(ROOT, 'site/build.mjs')).href;
  const out = execFileSync(
    'node',
    [
      '-e',
      `import(${JSON.stringify(build)})
         .then((b) => process.stdout.write(JSON.stringify(b.rendered.map((p) => ({ file: p.file, key: p.key, html: p.html })))))
         .catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });`,
    ],
    {
      env: { ...process.env, OWNPACE_APP_URL: 'https://app.ota.ownpace.eu', OWNPACE_STAGE: alpha ? 'alpha' : '' },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'] as const,
    },
  );
  const pages = JSON.parse(out) as Page[];
  builds.set(alpha, pages);
  return pages;
}

/** What a reader sees of a page: its title, its description and its text. */
function readable(html: string): string {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return `${title}\n${description}\n${text}`;
}

describe('4. every page the site writes', () => {
  it('the alpha build writes the tester guide at its address, in both languages', () => {
    const files = siteBuild(true).filter((p) => p.key === 'guide').map((p) => p.file);
    expect(files.sort()).toEqual(['alpha-guide.html', 'nl/alpha-handleiding.html']);
  });

  it.each([
    ['the alpha build', true],
    ['the build every other deployment gets', false],
  ] as const)('%s: says Alpha, never alfa or a lower-case alpha, in a title, a description or the text', (_name, alpha) => {
    const pages = siteBuild(alpha);
    // The vacuity check: both languages, the legal texts among them.
    expect(pages.map((p) => p.file)).toEqual(expect.arrayContaining(['index.html', 'nl/alpha.html', 'alpha.html']));
    const wrong = pages.flatMap((p) => [
      ...(ALFA.test(p.file) ? [`${p.file}: its file name`] : []),
      ...misspelt(readable(p.html)).map((m) => `${p.file}: ${m.trim()}`),
    ]);
    expect(wrong, WHY).toEqual([]);
  });

  it.each([
    ['en', 'alpha-guide.html'],
    ['nl', 'nl/alpha-handleiding.html'],
  ] as const)("the app's note names the guide by the page's own title, in %s", (locale, file) => {
    // The note's link (AlphaNote, LegalLinks) reads `alpha.note.guide`; the
    // page it opens is titled by site/build.mjs. One name for one page.
    const page = siteBuild(true).find((p) => p.file === file);
    expect(page, `the alpha build wrote no ${file}`).toBeDefined();
    const title = /<title>([^<]*)<\/title>/.exec(page!.html)?.[1] ?? '';
    expect(title).toMatch(/ — Ownpace$/);
    expect(STRINGS[locale]['alpha.note.guide']).toBe(title.replace(/ — Ownpace$/, ''));
  });

  it("the guide's source file carries the name too, so the page and its source agree", () => {
    expect(existsSync(join(ROOT, 'site/pages/nl/alpha-handleiding.md'))).toBe(true);
    expect(existsSync(join(ROOT, 'site/pages/nl/alfa-handleiding.md'))).toBe(false);
  });
});

describe('5. the setup guides the app serves', () => {
  it('say Alpha, never alfa or a lower-case alpha, where they speak of it', () => {
    const guides = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return guides(p);
        return e.name.endsWith('.md') ? [p] : [];
      });
    const files = guides(join(ROOT, 'docs/guides'));
    expect(files.length, 'docs/guides has no guides to read').toBeGreaterThan(10);
    const wrong = files.flatMap((f) =>
      misspelt(readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, ' ')).map((m) => `${relative(ROOT, f)}: ${m}`),
    );
    expect(wrong, WHY).toEqual([]);
  });
});
