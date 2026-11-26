// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COUNTRY BOTH BUILDS KNOW ABOUT (workplan 0176 D16 (a), §22.5; the owner,
 * 2026-11-26: *"P16: a"*).
 *
 * Where the service runs is said in two places that two different builds
 * make: a person's link page, *Ownpace runs in {country}.* under its first
 * line, which the WEB BUNDLE draws, and the public site's home page, whose
 * sentence the SITE'S BUILD writes. One setting in the stack's `.env`,
 * `OWNPACE_COUNTRY`, a two-letter code, decides both, as `OWNPACE_STAGE` does
 * the Alpha (`an-alpha-both-halves-know-about`), and it reaches them by two
 * mechanisms:
 *
 *   the web    a compose BUILD ARG, `VITE_OWNPACE_COUNTRY`, which Vite bakes
 *              in: a person's link page has no session to ask with;
 *   the site   its build's environment: `deploy-live.sh` hands live's own
 *              value to every site build, and the OTA site's documented build
 *              hands its stack's.
 *
 * MISSING EITHER IS A SPLIT NOBODY SEES. An unset setting is the ordinary,
 * correct state of somebody else's deployment, so either half alone arrives
 * with no error: the link page names a country and the home page none, or the
 * other way round. And the rules are written twice, because `site/` imports
 * nothing (`site/country.mjs`, beside `apps/web/src/services/where-it-runs.ts`):
 * so this holds the two to the same answer, for every code there is.
 *
 * NO FILE NAMES THE STACK'S COUNTRY. It is the setting's value on a stack:
 * every default here is empty, and the codes this file uses are examples. The
 * privacy policy says where the service runs as a fact; the site's build
 * refuses a country the policy does not name (`site/site.unit.test.ts`).
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY (AGENTS.md). The behaviour
 * lives beside its code: `apps/web/src/components/WhereItRuns.unit.test.tsx`
 * draws the sentence, `apps/web/src/services/where-it-runs.unit.test.ts` holds
 * the rules, and `scripts/a-deploy-from-a-named-tag.unit.test.ts` runs
 * `deploy-live.sh` and reads what every site build was handed.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  ARTICLE as WEB_ARTICLE,
  countryChecked,
  countryName as webCountryName,
} from '../apps/web/src/services/where-it-runs.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** The one name an operator sets. */
const SETTING = 'OWNPACE_COUNTRY';
/** The name Vite exposes to the bundle. */
const BUILD_ARG = `VITE_${SETTING}`;

interface SiteCountry {
  COUNTRY_SETTING: string;
  ARTICLE: Record<'en' | 'nl', Record<string, string>>;
  countryFrom: (raw: string | undefined) => string | null;
  countryName: (code: string, locale: 'en' | 'nl') => string | null;
}
const siteCountry = async (): Promise<SiteCountry> =>
  (await import(pathToFileURL(join(REPO_ROOT, 'site', 'country.mjs')).href)) as SiteCountry;

/** Every two-letter code, and a few values an operator might type that are none. */
const CODES = Array.from({ length: 26 * 26 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)));
const NOT_CODES = ['', '  ', 'D', 'DEU', '1A', 'D E', 'Germany', 'de-DE'];

/** What a rule answers for a value: the code it accepts, null for nothing, or that it refuses. */
function answer(rule: () => string | null): string | null | 'refused' {
  try {
    return rule();
  } catch {
    return 'refused';
  }
}

describe('the readers name the setting, so the checks below compare real names', () => {
  it('the link page reads the build arg, where Vite replaces it', () => {
    expect(read('apps/web/src/components/WhereItRuns.tsx')).toContain(`import.meta.env.${BUILD_ARG}`);
  });

  it('the web build checks the value it bakes in, with the module’s own rule', () => {
    expect(read('apps/web/vite.config.ts')).toMatch(/configResolved\(config\)\s*\{\s*countryChecked\(config\.env\);/);
  });

  it('the site’s build reads the setting', async () => {
    expect((await siteCountry()).COUNTRY_SETTING).toBe(SETTING);
    expect(read('site/build.mjs')).toContain('process.env[COUNTRY_SETTING]');
  });
});

describe('the two copies of the rule give one answer, for every code', () => {
  it('accept and refuse the same values', async () => {
    const site = await siteCountry();
    const differ: string[] = [];
    for (const value of [...CODES, ...CODES.map((c) => c.toLowerCase()), ...NOT_CODES]) {
      const web = answer(() => countryChecked({ [BUILD_ARG]: value }));
      const built = answer(() => site.countryFrom(value));
      if (web !== built) differ.push(`${JSON.stringify(value)}: the web build says ${web}, the site's ${built}`);
    }
    expect(differ).toEqual([]);
  });

  it('and name each country alike, in both languages, articles and all', async () => {
    const site = await siteCountry();
    expect(site.ARTICLE).toEqual(WEB_ARTICLE);
    let named = 0;
    const differ: string[] = [];
    for (const code of CODES) {
      if (answer(() => countryChecked({ [BUILD_ARG]: code })) !== code) continue;
      for (const locale of ['en', 'nl'] as const) {
        const web = webCountryName(code, locale);
        if (web !== site.countryName(code, locale)) differ.push(`${code} in ${locale}`);
        if (web === null) differ.push(`${code} in ${locale}: a country the build accepts has no name`);
      }
      named++;
    }
    expect(differ).toEqual([]);
    // The vacuity check: the loop above named countries, not nothing.
    expect(named).toBeGreaterThan(200);
  });

  it('and an article is given only to a code that is a country', async () => {
    for (const locale of ['en', 'nl'] as const) {
      for (const code of Object.keys(WEB_ARTICLE[locale])) {
        expect(answer(() => countryChecked({ [BUILD_ARG]: code })), `${code} has an article in ${locale}`).toBe(code);
      }
    }
  });
});

interface Compose {
  services: Record<string, { build?: { args?: Record<string, unknown> } }>;
}

describe('the web build is handed it, and refuses what is no country', () => {
  it('managed.yml hands it to the web build as a build arg, empty by default', () => {
    const compose = parseYaml(read('deploy/compose/managed.yml')) as Compose;
    const args = compose.services.web?.build?.args ?? {};
    expect(
      Object.keys(args),
      `the web build is never handed ${BUILD_ARG}. A compose build arg is a different\n` +
        'boundary from the shell, so setting it in .env bakes nothing into the bundle,\n' +
        'and no link page says where the service runs.',
    ).toContain(BUILD_ARG);
    expect(args[BUILD_ARG], 'the build arg must come from the one setting, and default to empty').toBe(
      `\${${SETTING}:-}`,
    );
  });

  it('the web image declares it, empty by default, and exports it before the build', () => {
    const dockerfile = read('apps/web/Dockerfile');
    const arg = dockerfile.search(new RegExp(`^ARG ${BUILD_ARG}=$`, 'm'));
    const env = dockerfile.search(new RegExp(`^ENV ${BUILD_ARG}=\\$${BUILD_ARG}$`, 'm'));
    const build = dockerfile.indexOf('RUN pnpm --filter @openmig/web build');
    expect(build, 'the build step moved; check this guard still reads it').toBeGreaterThan(-1);
    expect(arg).toBeGreaterThan(-1);
    expect(env).toBeGreaterThan(-1);
    expect(Math.max(arg, env), 'the ARG or the ENV comes after the build, which never sees it').toBeLessThan(build);
  });

  /** `apps/web/vite.config.ts` resolved as `vite build` resolves it, in a child process, with the build arg set. */
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
          env: { ...process.env, [BUILD_ARG]: value, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'] as const,
        },
      );
      return { ok: true, message: '' };
    } catch (e) {
      return { ok: false, message: String((e as { stderr?: string }).stderr ?? e) };
    }
  }

  it('a value that is no country stops the web build, naming the setting', () => {
    // The page reads the value while it renders, and the web app has no error
    // boundary: the build is where the owner meets a refusal, never a reader.
    for (const value of ['EU', 'Germany']) {
      const refused = resolveWebBuild(value);
      expect(refused.ok, `vite build accepted ${BUILD_ARG}=${value}`).toBe(false);
      expect(refused.message).toContain(SETTING);
    }
  });

  it('a country, or none, builds', () => {
    // The other side, so the case above cannot pass on a config that refuses everything.
    expect(resolveWebBuild('BE')).toEqual({ ok: true, message: '' });
    expect(resolveWebBuild('')).toEqual({ ok: true, message: '' });
  });
});

describe('every site build is handed the stack’s own value, never the shell’s', () => {
  it('deploy-live.sh reads live’s from its .env, and hands it to each of its site builds', () => {
    const script = read('deploy/compose/deploy-live.sh');
    expect(script).toMatch(/^\s*SITE_COUNTRY="\$\(env_value "\$ENV_FILE" OWNPACE_COUNTRY\)"$/m);
    // The builds themselves, stamped with the commit, and not the lines that say them.
    const builds = script.split('\n').filter((line) => /GIT_SHA="\$commit" node site\/build\.mjs/.test(line));
    // The test build's --check and full build before the checkout, and the build in it after.
    expect(builds.length, 'deploy-live.sh runs another number of site builds; check this guard still reads them').toBe(3);
    for (const build of builds) {
      expect(build, `a site build in deploy-live.sh is not handed live's ${SETTING}`).toContain(`${SETTING}="$SITE_COUNTRY"`);
    }
  });

  /** A line the command goes on past: a trailing backslash, or the `\\` a string in a module writes for one. */
  const continues = (line: string): boolean => /\\['",]*\s*$/.test(line);
  /** Each command in a text that runs the site build for the OTA app, with every line it continues from. */
  const otaBuilds = (text: string): string[] => {
    const lines = text.split('\n');
    return lines.flatMap((line, i) => {
      if (!/node site\/build\.mjs/.test(line)) return [];
      let start = i;
      while (start > 0 && continues(lines[start - 1]!)) start--;
      const command = lines.slice(start, i + 1).join('\n');
      return /app\.ota\.ownpace\.eu/.test(command) ? [command] : [];
    });
  };

  it.each([
    ["www.yml's header", 'deploy/compose/www.yml'],
    ["the bring-up's site section", 'docs/managed-bring-up.md'],
    ["the build's own refusal without OWNPACE_APP_URL, which prints the command", 'site/prices.mjs'],
  ])('the OTA site’s documented build: %s', (_where, file) => {
    let text = read(file);
    if (file.endsWith('.md')) {
      const at = text.indexOf('## The public site is a separate stack');
      expect(at, 'the bring-up has no site section').toBeGreaterThan(-1);
      text = text.slice(at, text.indexOf('\n## ', at + 1));
    }
    const commands = otaBuilds(text);
    expect(commands.length, `${file} documents no build of the OTA site`).toBeGreaterThan(0);
    for (const command of commands) {
      expect(
        command,
        `${file} builds the OTA site without the stack's own ${SETTING}. The app on that\n` +
          'stack names the country its .env sets; a site built without it names none.',
      ).toMatch(/OWNPACE_COUNTRY="\$\(env_value deploy\/compose\/\.env OWNPACE_COUNTRY\)"/);
    }
  });
});

describe('an operator can find it', () => {
  const example = read('deploy/compose/managed.env.example');

  it('managed.env.example names it, empty: the stack’s own, and nobody else’s default', () => {
    expect(example).toMatch(new RegExp(`^${SETTING}=$`, 'm'));
  });

  it('and says beside it that both builds read it, and that each is rebuilt', () => {
    const lines = example.split('\n');
    const at = lines.findIndex((line) => line === `${SETTING}=`);
    let top = at;
    while (top > 0 && lines[top - 1]!.startsWith('#')) top--;
    const comment = lines.slice(top, at).join('\n');
    expect(comment, 'nothing near it says the web image has to be rebuilt').toMatch(/rebuild the web image/i);
    expect(comment, 'the comment does not name live’s site build').toContain('deploy-live.sh');
    expect(comment, 'the comment does not name the OTA site’s build').toContain('www.yml');
    expect(comment, 'the comment does not say the site must be rebuilt').toMatch(/rebuild the site/i);
  });
});

describe('the appliance is never handed it', () => {
  // It runs on its owner's own machine, wherever that is, and a person's link
  // page is the managed edition's: the web app says nothing on the appliance
  // whatever its bundle was built with (`whereItRuns`).
  it.each([
    'deploy/selfhost/compose.yml',
    'deploy/selfhost/compose.dev.yml',
    'deploy/selfhost/compose.pglite.yml',
    'deploy/selfhost/compose.drill.yml',
    'deploy/selfhost/selfhost.env.example',
    'apps/selfhost/Dockerfile',
  ])('%s does not name it', (file) => {
    expect(read(file)).not.toContain(SETTING);
  });
});
