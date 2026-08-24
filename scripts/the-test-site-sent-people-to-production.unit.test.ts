// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TEST SITE HANDED VISITORS TO PRODUCTION.
 *
 * `www.ota.ownpace.eu` is the test environment's public site. On 2026-08-24 it
 * was rebuilt and every "Request access" button on it pointed at
 *
 *     https://app.ownpace.eu/request-access?locale=en&tier=Small
 *
 * A click there does not put a test visitor on a test form. It files a real
 * access request against the real tenant, from a site whose whole purpose is
 * to not be real. That is the environment boundary of workplan 0091 — the
 * environment is a domain LEVEL — leaking in the direction that costs
 * something.
 *
 * THE MECHANISM WAS THERE. `site/prices.mjs` already read `OWNPACE_APP_URL`,
 * and its own comment already said to set it for the OTA build. What defeated
 * it was the fallback:
 *
 *     process.env.OWNPACE_APP_URL || 'https://app.ownpace.eu'
 *
 * defended as "a forgotten variable should land on the safe side of that
 * boundary". Backwards, and this is the day that showed it: the build that
 * forgets is by definition the one whose value is NOT the default, so a
 * default can only ever be wrong silently. Production is not the safe side.
 * Neither side is. Being told is.
 *
 * So the build refuses without it, and these are the two rules that keep the
 * refusal meaningful: nothing hardcodes an environment host, and a site built
 * for one environment contains no link to another.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(REPO_ROOT, 'site');

const OTA = 'https://app.ota.ownpace.eu';
const PROD = 'https://app.ownpace.eu';

/**
 * Every source file the site build reads, excluding its own output — and
 * excluding tests, which have to name BOTH hosts in order to prove the
 * boundary holds. A rule that forbade the test its own subject would be a rule
 * nobody could test.
 */
function siteSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'dist' || entry === 'node_modules') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(mjs|js|ts|md|html)$/.test(entry) && !/\.(unit|ui|integration)\.test\./.test(entry)) {
        out.push(full);
      }
    }
  };
  walk(SITE);
  return out;
}

/**
 * A host named alongside `OWNPACE_APP_URL` is the refusal message telling an
 * operator what to set. That is the opposite of hardcoding a link — it is the
 * line that stops one — so it is not an offence.
 *
 * THE LIMIT, written down rather than discovered: this distinguishes by what
 * else is on the line. A hardcoded href assembled across two lines evades it.
 * The build-output rules above are the ones that cannot be talked around, and
 * they are why this one can afford to be narrow: a guard that cries wolf gets
 * disabled, and this rule flagged its own refusal message on first run.
 */
function isAboutTheVariable(line: string): boolean {
  // A host named beside `OWNPACE_APP_URL` is the refusal telling an operator
  // what to set — the line that STOPS a hardcoded link, not one.
  //
  // `PUBLIC_APP_URL` is the single canonical declaration of what production
  // is, and the value both halves of the coherence check compare against. The
  // rule above asserts there is exactly one of it, which is a stronger
  // guarantee than "nobody may say it": somewhere has to know.
  return line.includes('OWNPACE_APP_URL') || /export const PUBLIC_APP_URL/.test(line);
}

/** Lines that are prose about the code rather than code. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|#|<!--)/.test(l))
    .join('\n');
}

/**
 * Render the site for one environment, in a CHILD PROCESS.
 *
 * `build.mjs` reads the environment at module load and Node caches the module,
 * so two environments cannot be rendered in one process without resetting the
 * whole graph. A child also proves the thing that actually ships: the build as
 * an operator runs it, with an environment and nothing else.
 */
function buildFor(
  appUrl: string | null,
  opts: { public?: boolean } = {},
): { status: number; stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env.OWNPACE_APP_URL;
  if (appUrl) env.OWNPACE_APP_URL = appUrl;
  const r = execFileSync(
    'node',
    [
      '-e',
      `import('${join(SITE, 'build.mjs').replace(/\\/g, '/')}')
         .then((m) => { process.stdout.write(m.rendered.map((p) => p.html).join('\\n')); })
         .catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });`,
      // `--` first: without it node claims `--public` as one of its own
      // options and dies with "bad option" before the script ever runs.
      '--',
      ...(opts.public ? ['--public'] : []),
    ],
    { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] as const },
  );
  return { status: 0, stdout: r, stderr: '' };
}

/** Runs a build expected to refuse, and hands back what it said. */
function refusalFrom(appUrl: string | null, opts: { public?: boolean } = {}): string {
  try {
    buildFor(appUrl, opts);
  } catch (e) {
    const err = e as { stderr?: string; status?: number };
    expect(err.status, 'the build exited 0 where it should have refused').not.toBe(0);
    return err.stderr ?? '';
  }
  throw new Error(`the build accepted ${appUrl} with public=${opts.public === true}`);
}

function buildExpectingRefusal(): string {
  try {
    buildFor(null);
  } catch (e) {
    const err = e as { stderr?: string; status?: number };
    expect(err.status, 'the build exited 0 with no OWNPACE_APP_URL set').not.toBe(0);
    return err.stderr ?? '';
  }
  throw new Error('the site built with no OWNPACE_APP_URL and did not refuse');
}

/**
 * Built ONCE, ON FIRST USE, INSIDE A TEST — not at describe time.
 *
 * The first version of this file called `buildFor` while collecting the
 * describe blocks. Restoring the old production default made that call throw,
 * and vitest reported `Tests  no tests` — a file that ran nothing, which on a
 * dashboard is indistinguishable from a file that passed. Work that can fail
 * belongs where a failure has a name.
 */
const built = new Map<string, string>();
function siteFor(appUrl: string): string {
  const cached = built.get(appUrl);
  if (cached !== undefined) return cached;
  const html = buildFor(appUrl).stdout;
  built.set(appUrl, html);
  return html;
}

describe('a site built for one environment carries no link to another', () => {
  it('renders the test app when told the test app', () => {
    const ota = siteFor(OTA);
    // Not merely "no production link": a build that rendered nothing at all
    // would pass that on its own.
    expect(ota).toContain(`${OTA}/request-access`);
  });

  it('contains NO production link anywhere in it', () => {
    // The failure, stated directly. `app.ownpace.eu` is a substring of
    // `app.ota.ownpace.eu`? It is not — the label order makes them distinct —
    // but the assertion is written on the full origin so it cannot become one.
    const leaks = siteFor(OTA).split('\n').filter((l) => l.includes(`${PROD}/`));
    expect(
      leaks,
      `a site built for ${OTA} links to production:\n  ${leaks.join('\n  ')}`,
    ).toEqual([]);
  });

  it('renders production when told production, so the rule is not "never say prod"', () => {
    // `--public` because that is now the only coherent way to say production:
    // a noindex build pointing at the real app is the reported bug itself.
    const prod = buildFor(PROD, { public: true }).stdout;
    expect(prod).toContain(`${PROD}/request-access`);
    expect(prod).not.toContain(OTA);
  });
});

/**
 * `--public` and `OWNPACE_APP_URL` are two ways of saying which environment a
 * build is for. Requiring the variable stopped the SILENT case — a forgotten
 * default quietly choosing production. It left the CONTRADICTORY one, and both
 * contradictions ship a real mistake.
 */
describe('the two switches that both name an environment have to agree', () => {
  it('refuses a test build pointing at production — the bug as reported', () => {
    // "the www.ota webpages have links to production. that should never
    // happen!" — 2026-08-24. A click there files a real access request
    // against the real tenant.
    const said = refusalFrom(PROD);
    expect(said).toContain('test build');
    expect(said, 'the refusal does not say what it would cost').toMatch(/real tenant/);
  });

  it('refuses a public build pointing at the test app', () => {
    // The other direction: an indexable production site whose every call to
    // action leads somewhere private.
    const said = refusalFrom(OTA, { public: true });
    expect(said).toContain(PROD);
    expect(said).toContain(OTA);
  });

  it('accepts each coherent pairing, so the rule is a check and not a ban', () => {
    expect(buildFor(OTA).stdout).toContain(`${OTA}/request-access`);
    expect(buildFor(PROD, { public: true }).stdout).toContain(`${PROD}/request-access`);
  });

  it('names production exactly once, and in the file the check compares against', () => {
    // The hardcoded-host rule below would otherwise have to exempt every
    // mention. One declaration is stronger than none: it is the thing both
    // halves of the check agree on.
    const prices = readFileSync(join(SITE, 'prices.mjs'), 'utf8');
    expect(prices).toContain(`export const PUBLIC_APP_URL = '${PROD}'`);
    const declarations = siteSources()
      .flatMap((f) => readFileSync(f, 'utf8').split('\n'))
      .filter((l) => /^\s*export const PUBLIC_APP_URL/.test(l));
    expect(declarations).toHaveLength(1);
  });
});

describe('the build refuses rather than guessing which environment it is', () => {
  it('says the variable that is missing', () => {
    expect(buildExpectingRefusal()).toContain('OWNPACE_APP_URL');
  });

  it('gives both commands, because knowing the name is not knowing the value', () => {
    const stderr = buildExpectingRefusal();
    expect(stderr).toContain(PROD);
    expect(stderr).toContain(OTA);
  });

  it('says why there is no default, so nobody helpfully puts one back', () => {
    expect(buildExpectingRefusal()).toMatch(/no\s*\n?\s*default/i);
  });
});

describe('nothing in the site hardcodes an environment host', () => {
  const offenders = siteSources().flatMap((file) =>
    withoutComments(readFileSync(file, 'utf8'))
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /https?:\/\/(app|id)\.(ota\.)?ownpace\.eu/.test(line))
      .filter(({ line }) => !isAboutTheVariable(line))
      .map(({ line, n }) => `${relative(REPO_ROOT, file)}:${n}: ${line.trim()}`),
  );

  it('every absolute app link comes from APP_URL, not from a literal', () => {
    expect(
      offenders,
      'an environment host written into the site source. It will be right for\n' +
        'one environment and silently wrong for the other — which is the whole\n' +
        'defect. Build the URL from APP_URL in site/prices.mjs instead:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('APP_URL itself has no fallback', () => {
    // The one line that caused this. A `|| 'https://…'` here restores the
    // silent-wrong-answer path with none of the noise.
    const prices = readFileSync(join(SITE, 'prices.mjs'), 'utf8');
    expect(prices).not.toMatch(/OWNPACE_APP_URL\s*(\|\||\?\?)\s*['"]https?:/);
  });
});
