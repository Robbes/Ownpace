// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A POLICY LINK THAT ANSWERS (workplan 0139 T10 (a)).
 *
 * Until #1137 the grant page linked `https://www.ownpace.eu/privacy` and
 * `/terms`. Neither is a file the site build writes: it writes `privacy.html`
 * and `terms.html`, and `nl/privacy.html` and `nl/voorwaarden.html`, and the
 * site's nginx adds no `.html` (`try_files $uri $uri/ =404`). So the one screen
 * that shows the policy before a redirect to Google linked two 404s. #1137
 * fixed the addresses and pinned them in `Grant.unit.test.tsx` as literals.
 * That proves the page renders what it was given. It does not prove the site
 * has the file, and nothing compared the two.
 *
 * The host was fixed in the code as well. Testers use the production names
 * (0139 D5), so live's app links the production site; the OTA stack's app
 * should link its own test site; and each new screen that links a text (T4's
 * notices, T3's acceptance screen) would have copied the table again.
 *
 * So where the legal pages live is ONE build argument, `VITE_LEGAL_SITE_URL`,
 * and ONE module turns it into an address per page and per language
 * (`apps/web/src/services/legal-links.ts`). This guard holds:
 *
 *  1. every address the module produces is a file the site build writes, for
 *     that language and that page: each `legalLinks()` gives, which the grant
 *     page reads, and each `legalUrl()` gives. The list comes from the build
 *     itself (`rendered` and `SOURCE` in `site/build.mjs`, run in a child
 *     process), never from a list typed here. With the setting given, every
 *     link is on that site, so a module that ignores it fails;
 *  2. every legal page the build renders has an address, and a page it does
 *     not render is not a link. Today that leaves out the sub-processor list
 *     (text from T5), which T10 renders: the module names it as not built
 *     yet, and this fails the day the build renders it and the module does
 *     not link it. The alpha conditions (text from T2) are rendered since T3's
 *     acceptance screen links them (2026-09-28);
 *  3. `managed.yml` passes the setting to the web build, the Dockerfile
 *     declares it, and the compose `.env` example documents it. A value the
 *     module would refuse stops the web build (`vite.config.ts`), because the
 *     grant page reads it while it renders and the web app has no error
 *     boundary: a typo would blank the page for every recipient;
 *  4. unset, it is the production site, the address the site build calls
 *     itself, so a build that was told nothing links what it linked before;
 *  5. no other shipped file in the web app names a legal page's address;
 *  6. THE MAIL'S LINK (0139 T4, privacy-share-mail-notice (a)). The mail to
 *     people items were shared with links the privacy policy, and the API
 *     sends it, so the API reads the same `.env` key: `managed.yml` hands
 *     `VITE_LEGAL_SITE_URL` to the api service as `LEGAL_SITE_URL`, and
 *     `packages/shared/src/privacy-policy-link.ts` makes the address. That
 *     module cannot import this one (the web bundle's, which `vite.config.ts`
 *     loads at build time) and this one does not import the shared index, so
 *     the privacy page's file is written in both. For every value, the mail's
 *     address must be the web's, and a file the build writes; a value the web
 *     refuses, the API refuses too, and at its start (`apps/api/src/index.ts`,
 *     before it listens), so the operator meets the refusal there.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type * as LegalLinks from '../apps/web/src/services/legal-links.ts';
import type * as MailLink from '../packages/shared/src/privacy-policy-link.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

const SETTING = 'VITE_LEGAL_SITE_URL';
const MODULE = 'apps/web/src/services/legal-links.ts';

/** The OTA stack's test site: a value an operator sets, beside the default. */
const OTA_SITE = 'https://www.ota.ownpace.eu';

/**
 * Loaded inside the tests, not at the top, so a missing or broken module fails
 * each case by name instead of stopping the file from loading.
 */
const loadModule = (): Promise<typeof LegalLinks> =>
  import('../apps/web/src/services/legal-links.ts');

/** The mail's half, loaded the same way (point 6). */
const MAIL_MODULE = 'packages/shared/src/privacy-policy-link.ts';
const MAIL_SETTING = 'LEGAL_SITE_URL';
const loadMailModule = (): Promise<typeof MailLink> => import('../packages/shared/src/privacy-policy-link.ts');

interface Built {
  readonly pages: ReadonlyArray<{ readonly locale: string; readonly key: string; readonly file: string }>;
  /** `SOURCE` in `site/build.mjs`: per locale, the source file of each Markdown page. */
  readonly sources: Readonly<Record<string, Readonly<Record<string, string>>>> | null;
  /** Where the production site is served, as the site build names it. */
  readonly publicSite: string;
}

/**
 * The real build, in a child process: `build.mjs` reads the environment at
 * load and refuses without `OWNPACE_APP_URL`, and a child keeps that away from
 * every other test. The OTA app address, because a build without `--public`
 * refuses the production one. The files it writes do not depend on either.
 * Memoised, and run inside the tests, so a broken build fails them by name.
 */
let cached: Built | null = null;
function built(): Built {
  if (cached) return cached;
  const build = pathToFileURL(join(REPO_ROOT, 'site/build.mjs')).href;
  const security = pathToFileURL(join(REPO_ROOT, 'site/security-txt.mjs')).href;
  const out = execFileSync(
    'node',
    [
      '-e',
      `Promise.all([import(${JSON.stringify(build)}), import(${JSON.stringify(security)})])
         .then(([b, s]) => process.stdout.write(JSON.stringify({
           pages: b.rendered.map((p) => ({ locale: p.locale, key: p.key, file: p.file })),
           sources: b.SOURCE ?? null,
           publicSite: s.PUBLIC_SITE_URL,
         })))
         .catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });`,
    ],
    {
      env: { ...process.env, OWNPACE_APP_URL: 'https://app.ota.ownpace.eu' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'] as const,
    },
  );
  cached = JSON.parse(out) as Built;
  return cached;
}

/** Per locale, the keys of the pages the build renders from `site/legal/`. */
function legalPagesBuilt(): Map<string, Set<string>> {
  const { sources } = built();
  expect(
    sources,
    'site/build.mjs does not export SOURCE, so this cannot tell which pages are the legal ones',
  ).not.toBeNull();
  const out = new Map<string, Set<string>>();
  for (const [locale, pages] of Object.entries(sources ?? {})) {
    const legal = Object.entries(pages)
      .filter(([, src]) => src.startsWith('legal/'))
      .map(([key]) => key);
    out.set(locale, new Set(legal));
  }
  return out;
}

describe('the build is read, so the checks below compare real files', () => {
  it('renders the privacy policy, the terms and the alpha conditions, in English and in Dutch', () => {
    // The vacuity check. If the child stopped returning pages, or SOURCE lost
    // its legal entries, every rule below would pass over an empty set.
    const legal = legalPagesBuilt();
    expect([...legal.keys()].sort()).toEqual(['en', 'nl']);
    for (const [locale, keys] of legal) {
      expect([...keys].sort(), `the ${locale} legal pages`).toEqual(
        expect.arrayContaining(['privacy', 'terms', 'alpha']),
      );
    }
    expect(built().pages.length).toBeGreaterThan(4);
  });
});

/** One address, held to the file the build writes for that language and page. */
function expectWritten(address: string, origin: string, locale: string, page: string): void {
  expect(address.startsWith(`${origin}/`), `${address} is not on ${origin}`).toBe(true);
  const file = address.slice(origin.length + 1);
  const written = built().pages.find((p) => p.file === file);
  expect(
    written,
    `${address} links ${file}, which the site build does not write. The site's\n` +
      'nginx serves files as they are named, so this link is a 404.',
  ).toBeDefined();
  expect(written?.locale, `${address} is the ${locale} ${page} link`).toBe(locale);
  expect(written?.key, `${address} is the ${locale} ${page} link`).toBe(page);
}

describe('every address the app links is a file the site build writes', () => {
  // The origin each case must land on is written here or read from the build,
  // never taken from the module: a module that ignored the setting would
  // otherwise agree with itself.
  it.each([
    ['unset, the production site', {}, (): string => built().publicSite],
    ['the OTA test site, with a trailing slash', { [SETTING]: `${OTA_SITE}/` }, (): string => OTA_SITE],
  ])('%s', async (_name, env, origin) => {
    const m = await loadModule();
    for (const [locale, pages] of legalPagesBuilt()) {
      // What the grant page reads: every key, not only the ones named here.
      const links = m.legalLinks(locale as 'en' | 'nl', env);
      expect(Object.keys(links).sort(), `the ${locale} links`).toEqual([...pages].sort());
      for (const [page, address] of Object.entries(links)) {
        expectWritten(address, origin(), locale, page);
      }
      for (const page of pages) {
        const address = m.legalUrl(page as LegalLinks.LegalPage, locale as 'en' | 'nl', env);
        expectWritten(address, origin(), locale, page);
      }
    }
  });

  it('has an address in every language the site is built in, and the web app speaks', async () => {
    const m = await loadModule();
    expect(Object.keys(m.LEGAL_FILES).sort()).toEqual([...legalPagesBuilt().keys()].sort());
  });
});

describe('it links every legal page the build renders, and nothing else', () => {
  it('names the same pages the build renders from site/legal/', async () => {
    const m = await loadModule();
    for (const [locale, keys] of legalPagesBuilt()) {
      expect(
        [...m.LEGAL_PAGES].sort(),
        `The site build renders these legal pages in ${locale}. A page the build\n` +
          'renders and the app does not link is a text a tester cannot reach from\n' +
          'the app; a page the app links and the build does not write is a 404.',
      ).toEqual([...keys].sort());
      expect(Object.keys(m.LEGAL_FILES[locale as 'en' | 'nl']).sort()).toEqual([...keys].sort());
    }
  });

  it('keeps the sub-processor list out until the build writes it', async () => {
    const m = await loadModule();
    const notYet = Object.keys(m.NOT_BUILT_YET);
    // Named, so T10 finds the slot. Only the build decides when it moves. The
    // alpha conditions moved on 2026-09-28: the build renders them, because
    // T3's acceptance screen links them.
    expect(notYet.sort()).toEqual(['subprocessors']);
    for (const page of notYet) {
      expect(m.LEGAL_PAGES as readonly string[]).not.toContain(page);
      for (const [locale, keys] of legalPagesBuilt()) {
        expect(
          keys.has(page),
          `The site build now renders "${page}" in ${locale}. Move it from NOT_BUILT_YET\n` +
            `into LEGAL_PAGES in ${MODULE}, with its file per language.`,
        ).toBe(false);
      }
    }
  });
});

describe('one setting, from the deployment to the bundle', () => {
  it('the module reads the setting, for every link the grant page shows', async () => {
    // The vacuity check for the cases below: if the module read another name,
    // or built one link without it, they would keep passing on a setting that
    // moves nothing.
    const m = await loadModule();
    for (const locale of legalPagesBuilt().keys()) {
      const links = Object.values(m.legalLinks(locale as 'en' | 'nl', { [SETTING]: OTA_SITE }));
      expect(links.length).toBeGreaterThan(0);
      for (const address of links) {
        expect(new URL(address).origin, `${address}, with ${SETTING}=${OTA_SITE}`).toBe(OTA_SITE);
      }
    }
  });

  it('managed.yml passes it to the web build, empty unless the deployment sets it', () => {
    const compose = parseYaml(read('deploy/compose/managed.yml')) as {
      services: Record<string, { build?: { args?: Record<string, unknown> } }>;
    };
    expect(
      compose.services.web?.build?.args?.[SETTING],
      `managed.yml does not pass ${SETTING} to the web build, so every managed\n` +
        'bundle links the production site, the OTA stack included. The default\n' +
        'lives once, in the module, so compose passes it empty.',
    ).toBe(`\${${SETTING}:-}`);
  });

  it('the web Dockerfile declares it before the build', () => {
    const dockerfile = read('apps/web/Dockerfile');
    const arg = dockerfile.search(new RegExp(`^ARG ${SETTING}=$`, 'm'));
    const env = dockerfile.search(new RegExp(`^ENV ${SETTING}=\\$${SETTING}$`, 'm'));
    const build = dockerfile.indexOf('RUN pnpm --filter @openmig/web build');
    expect(arg, `apps/web/Dockerfile has no "ARG ${SETTING}="`).toBeGreaterThan(-1);
    expect(env, `apps/web/Dockerfile has no "ENV ${SETTING}=$${SETTING}"`).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(-1);
    expect(arg, 'the ARG comes after the web build, which never sees it').toBeLessThan(build);
    expect(env, 'the ENV comes after the web build, which never sees it').toBeLessThan(build);
  });

  /**
   * Resolves `apps/web/vite.config.ts` as `vite build` does, in a child process
   * run from `apps/web` (where vite is installed) with the setting in its
   * environment, as the Dockerfile's `ENV` hands it over.
   */
  function resolveWebBuild(value: string): { ok: boolean; message: string } {
    try {
      execFileSync(
        'node',
        [
          '-e',
          `import('vite')
             .then((v) => v.resolveConfig({ configFile: 'vite.config.ts', logLevel: 'silent' }, 'build', 'production'))
             .then(() => process.stdout.write('resolved'))
             .catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });`,
        ],
        {
          cwd: join(REPO_ROOT, 'apps/web'),
          env: { ...process.env, [SETTING]: value },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'] as const,
        },
      );
      return { ok: true, message: '' };
    } catch (e) {
      return { ok: false, message: String((e as { stderr?: string }).stderr ?? e) };
    }
  }

  it('a value the links cannot use stops the web build, naming the setting', () => {
    // The grant page reads the setting while it renders, and the web app has no
    // error boundary, so a refusal there is a blank page for every recipient.
    // The build is where the owner meets it instead. The value is the OTA
    // site's with its scheme left off, the typo the .env example invites.
    const refused = resolveWebBuild('www.ota.ownpace.eu');
    expect(
      refused.ok,
      `vite build accepted ${SETTING}=www.ota.ownpace.eu, which legal-links.ts refuses\n` +
        'while the grant page renders: that bundle blanks the page for every recipient.',
    ).toBe(false);
    expect(refused.message).toContain(SETTING);
  });

  it('a value the links can use builds', () => {
    // The other side of the case above, so it cannot pass on a config that
    // refuses everything.
    expect(resolveWebBuild(OTA_SITE)).toEqual({ ok: true, message: '' });
    expect(resolveWebBuild('')).toEqual({ ok: true, message: '' });
  });

  it('the compose .env example documents it, empty', () => {
    // Empty, with nothing after the `=`: Compose would read an inline comment
    // as the value (managed-env-contract.unit.test.ts).
    expect(read('deploy/compose/managed.env.example')).toMatch(new RegExp(`^${SETTING}=$`, 'm'));
  });
});

describe('the value', () => {
  it('unset or blank is the production site, the address the site build calls itself', async () => {
    const m = await loadModule();
    expect(m.legalSiteFrom({})).toBe(built().publicSite);
    expect(m.legalSiteFrom({ [SETTING]: '  ' })).toBe(built().publicSite);
  });

  it('is the host alone, whatever slash it was written with', async () => {
    const m = await loadModule();
    expect(m.legalSiteFrom({ [SETTING]: `${OTA_SITE}/` })).toBe(OTA_SITE);
    expect(m.legalUrl('privacy', 'nl', { [SETTING]: OTA_SITE })).toBe(`${OTA_SITE}/nl/privacy.html`);
  });

  it.each([
    ['a scheme that is not http(s)', 'javascript:alert(1)'],
    ['no scheme at all', 'www.ownpace.eu'],
    ['a path, where the site writes its pages at the root', `${OTA_SITE}/legal/`],
    ['a query', `${OTA_SITE}/?lang=nl`],
  ])('refuses %s, naming the setting', async (_name, value) => {
    const m = await loadModule();
    expect(() => m.legalSiteFrom({ [SETTING]: value })).toThrow(SETTING);
  });
});

describe("the mail's link to the privacy policy (0139 T4)", () => {
  it.each([
    ['unset, the production site', undefined, (): string => built().publicSite],
    ['the OTA test site, with a trailing slash', `${OTA_SITE}/`, (): string => OTA_SITE],
  ])('%s: the address the web links, and a file the build writes, in every language', async (_name, value, origin) => {
    const web = await loadModule();
    const mail = await loadMailModule();
    for (const locale of legalPagesBuilt().keys()) {
      const lang = locale as 'en' | 'nl';
      const address = mail.privacyPolicyUrl(lang, value === undefined ? {} : { [MAIL_SETTING]: value });
      expect(address, `${MAIL_MODULE} and ${MODULE} disagree on the ${locale} privacy page`).toBe(
        web.legalUrl('privacy', lang, value === undefined ? {} : { [SETTING]: value }),
      );
      expectWritten(address, origin(), locale, 'privacy');
    }
  });

  it.each([
    ['a scheme that is not http(s)', 'javascript:alert(1)'],
    ['no scheme at all', 'www.ownpace.eu'],
    ['a path, where the site writes its pages at the root', `${OTA_SITE}/legal/`],
    ['a query', `${OTA_SITE}/?lang=nl`],
  ])('refuses %s, as the web build does, naming both names', async (_name, value) => {
    const mail = await loadMailModule();
    expect(() => mail.privacyPolicyUrl('en', { [MAIL_SETTING]: value })).toThrow(MAIL_SETTING);
    // The operator sets the .env key, not the api's name for it.
    expect(() => mail.privacyPolicyUrl('en', { [MAIL_SETTING]: value })).toThrow(SETTING);
  });

  it('the api makes the address at start, before it listens, so a value it cannot use stops the start', () => {
    // The refusal above only stops the start if the start asks. Several texts
    // say it does (this plan, the module's header, managed.yml, the .env
    // example); nothing held them to it until the review of 0139 T4. Asked
    // synchronously in the start block, before the migrations' promise, whose
    // catch would report the throw as a failed migration.
    const index = read('apps/api/src/index.ts');
    const boot = index.slice(index.indexOf("if (process.env.NODE_ENV !== 'test') {"));
    expect(boot, 'the start-up block was not found').toContain('app.listen(');
    const at = boot.search(/\bprivacyPolicyUrl\('(?:en|nl)', process\.env\)/);
    expect(at, `the api's start does not make the privacy address, so a bad ${MAIL_SETTING} starts`).toBeGreaterThan(0);
    expect(at, 'the address is made after the migrations start').toBeLessThan(boot.indexOf('runMigrations('));
    expect(at).toBeLessThan(boot.indexOf('app.listen('));
    expect(index).toMatch(/import \{[^}]*\bprivacyPolicyUrl\b[^}]*\} from '@openmig\/shared';/);
  });

  it('managed.yml hands the api the same .env key the web build takes', () => {
    const compose = parseYaml(read('deploy/compose/managed.yml')) as {
      services: Record<string, { environment?: Record<string, unknown> }>;
    };
    expect(
      compose.services.api?.environment?.[MAIL_SETTING],
      `managed.yml does not pass ${SETTING} to the api as ${MAIL_SETTING}, so the mail\n` +
        "links the production site's policy while the web links the stack's own site.",
    ).toBe(`\${${SETTING}:-}`);
  });

  it('the managed press hands the mail the address, and the appliance hands none', () => {
    // The appliance's owner sends the mail from their own box; our policy is
    // not theirs (privacy §4.6 is the managed service's).
    const managed = read('apps/api/src/routes/migrations/operating-routes.ts');
    const start = managed.indexOf("'/:mappingId/sharing/announce'");
    expect(start, 'the managed announce route moved or was renamed').toBeGreaterThan(-1);
    const handler = managed.slice(start, managed.indexOf('\nrouter.', start));
    expect(handler).toMatch(/\bprivacyPolicyUrl\(locale, process\.env\)/);
    expect(handler).toMatch(/\bprivacyPolicy,/);
    expect(handler).not.toMatch(/privacyPolicy:\s*null/);
    const appliance = read('apps/selfhost/src/index.ts');
    const press = appliance.slice(appliance.indexOf('const sharingAnnounceMatch'));
    expect(press.slice(0, press.indexOf('announceByHandShares(') + 2000)).toMatch(/privacyPolicy:\s*null/);
  });
});

describe("the grant mail's link to the Alpha conditions (0139 T4)", () => {
  // The access-granted mail links the conditions during the alpha, from the
  // same module and the same key as the share mail's privacy line, so it is
  // held to the same two things: the web's address, and a file the build
  // writes in the mail's language.
  it.each([
    ['unset, the production site', undefined, (): string => built().publicSite],
    ['the OTA test site, with a trailing slash', `${OTA_SITE}/`, (): string => OTA_SITE],
  ])('%s: the address the web links, and a file the build writes, in every language', async (_name, value, origin) => {
    const web = await loadModule();
    const mail = await loadMailModule();
    for (const locale of legalPagesBuilt().keys()) {
      const lang = locale as 'en' | 'nl';
      const address = mail.alphaConditionsUrl(lang, value === undefined ? {} : { [MAIL_SETTING]: value });
      expect(address, `${MAIL_MODULE} and ${MODULE} disagree on the ${locale} Alpha conditions`).toBe(
        web.legalUrl('alpha', lang, value === undefined ? {} : { [SETTING]: value }),
      );
      expectWritten(address, origin(), locale, 'alpha');
    }
  });
});

describe('the one place in the web app that names a legal page', () => {
  /** Every shipped .ts/.tsx under apps/web/src; tests excluded, they pin literals. */
  function webSources(dir = join(REPO_ROOT, 'apps/web/src')): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...webSources(p));
      else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
    }
    return out;
  }

  it('the grant page reads the module', () => {
    expect(read('apps/web/src/pages/Grant.tsx')).toContain(
      "from '../services/legal-links.ts'",
    );
  });

  it('no other shipped file names the site or a legal file', () => {
    // The file names come from the build, so a page T2 adds is covered too.
    const names = new Set(
      built()
        .pages.filter((p) => legalPagesBuilt().get(p.locale)?.has(p.key))
        .map((p) => basename(p.file)),
    );
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      [escape(new URL(built().publicSite).host), ...[...names].map(escape)].join('|'),
    );
    const offenders = webSources()
      .filter((f) => !f.endsWith(MODULE.replace('apps/web/', '')))
      .filter((f) => {
        const code = readFileSync(f, 'utf8')
          .replace(/\/\*[^]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        return pattern.test(code);
      })
      .map((f) => f.slice(REPO_ROOT.length + 1));
    expect(
      offenders,
      `These name a legal page's address themselves. Read it from ${MODULE},\n` +
        `so ${SETTING} moves every link at once.`,
    ).toEqual([]);
  });
});
