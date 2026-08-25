// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ISSUER THE BUNDLE NEVER LEARNED.
 *
 * Reported from the reference box on 2026-08-25: `app.ota.ownpace.eu/login`
 * offered the seed-token box and NO sign-in button, on a stack whose identity
 * provider was configured, healthy, and had just been provisioned.
 *
 * `setup-zitadel.sh` writes `VITE_OIDC_ISSUER` and `VITE_OIDC_CLIENT_ID` into
 * `.env`. `bootstrap-managed.sh` reloads it immediately afterwards, with a
 * comment stating the reason: *"the script above just wrote JWT_ISSUER,
 * JWT_AUDIENCE and the two VITE_ values, and the build below has to see them."*
 *
 * IT COULD NOT SEE THEM. A compose **build arg** is a different boundary from
 * the shell environment, and neither `managed.yml` nor `apps/web/Dockerfile`
 * declared these two. Vite, inside the build stage, read nothing. `oidcConfig()`
 * returned null on every managed image ever built, and `Login.tsx` — correctly,
 * given what it was told — rendered the paste box alone. The
 * authorization-code + PKCE flow that ADR-0042 specifies and #496 implemented
 * has been unreachable from the UI since the day it was written.
 *
 * NOTHING CAUGHT IT BECAUSE NOTHING ASKED THE BUNDLE. `smoke-managed.sh` signs
 * in by driving the provider's `/oauth/v2/authorize` and `/oauth/v2/token` with
 * curl; `managed-ui.ui.test.ts` mocks `oidcConfig` and signs in by pasting a
 * token. Both proved that signing in works, on a screen that offered no way to
 * do it. The intent was written down in three places and the one mechanism that
 * had to carry it was missing.
 *
 * SO THE RULE IS DERIVED, NOT LISTED. Every `VITE_` name the shipped source
 * READS must arrive by some declared route — a `define:` in `vite.config.ts`, a
 * build arg, or an explicit entry below saying why it needs neither. A list
 * would have been written to match the code of the day and would not have
 * caught this one either.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(REPO_ROOT, 'apps/web');

/**
 * Names the app READS, with comments stripped.
 *
 * `StatusLink.tsx` discusses a `VITE_STATUS_URL` at length in order to explain
 * why it deliberately does NOT use one — deriving the host at runtime instead.
 * A rule that counted prose would demand a build arg for a variable whose whole
 * point is not existing, which is the self-inflicted false positive this repo
 * has now hit seven times.
 */
function namesRead(): Set<string> {
  const src = webSources()
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
    // Comments stripped BEFORE matching, block then line.
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // Any mention in code: an interface member, a destructuring, a property
  // access, or the name inside a refusal's own sentence. Each of those is the
  // app saying it consumes the value; none of them is prose about one.
  return new Set([...src.matchAll(/\bVITE_[A-Z0-9_]+/g)].map((m) => m[0]));
}

/** Every shipped .ts/.tsx under apps/web/src — tests excluded, they mock. */
function webSources(dir = join(WEB, 'src')): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...webSources(p));
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Supplied by the bundler, so they need no build arg. */
function definedInViteConfig(): Set<string> {
  const cfg = readFileSync(join(WEB, 'vite.config.ts'), 'utf8');
  return new Set(
    [...cfg.matchAll(/'import\.meta\.env\.(VITE_[A-Z0-9_]+)'\s*:/g)].map((m) => m[1]!),
  );
}

/**
 * Names that reach the bundle by neither route, ON PURPOSE. Each needs a reason
 * a person can check, not just an entry.
 */
const NEEDS_NEITHER: Record<string, string> = {
  VITE_OPERATING_URL:
    'optional by design — `operatingBaseUrl()` documents the default it falls ' +
    'back to per edition, and managed does not implement the contract yet',
};

describe('and a gate asks the artefact, not just the declarations', () => {
  const smoke = readFileSync(join(REPO_ROOT, 'deploy/compose/smoke-managed.sh'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  /**
   * The rules above check that the value is DECLARED — an ARG and a build arg.
   * That is where this bug lived, and it is not the same claim as "the bundle a
   * browser downloads actually carries it". A Dockerfile can declare an ARG
   * that compose passes from an empty `.env`, and every rule above still
   * passes while the login page still has no button.
   */
  it('fetches the built JavaScript and looks for the issuer in it', () => {
    expect(
      smoke,
      'The smoke proves the SPA serves and its /api proxy works, and asks nothing\n' +
        'about what the JavaScript was built with. That is the gap the missing\n' +
        'build arg lived in for the whole life of the OIDC flow.',
    ).toMatch(/\/assets\/\[A-Za-z0-9\._-\]\+\\\.js/);
    expect(smoke).toMatch(/bundle_knows/);
  });

  it('only demands it when the stack actually has an issuer', () => {
    // Without one the paste box IS the right screen, and failing a bring-up
    // over it would be the gate inventing a requirement.
    expect(smoke).toMatch(/if \[ -n "\$\{STACK_ISSUER:-\}" \]; then/);
  });
});

describe('every VITE_ the app reads can actually reach it', () => {
  const dockerfile = readFileSync(join(WEB, 'Dockerfile'), 'utf8');
  const declaredArgs = new Set(
    [...dockerfile.matchAll(/^ARG (VITE_[A-Z0-9_]+)/gm)].map((m) => m[1]!),
  );
  const compose = parse(readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8')) as {
    services: Record<string, { build?: { args?: Record<string, string> } }>;
  };
  const passed = new Set(Object.keys(compose.services.web?.build?.args ?? {}));

  it('reads at least the two the sign-in flow needs', () => {
    // An empty scan must not pass. If the parser stops finding names, every
    // rule below becomes vacuously true.
    const read = namesRead();
    expect(read.has('VITE_OIDC_ISSUER'), 'the scan found no VITE_OIDC_ISSUER at all').toBe(true);
    expect(read.has('VITE_API_URL')).toBe(true);
  });

  it.each([...namesRead()])('%s arrives by a declared route', (name) => {
    if (definedInViteConfig().has(name)) return;
    if (NEEDS_NEITHER[name]) return;
    expect(
      declaredArgs.has(name),
      `${name} is read by the app and is not an ARG in apps/web/Dockerfile.\n` +
        'Vite reads the build stage\'s environment, and a compose build arg is\n' +
        'the only thing that puts a value there. Undeclared, it is empty in every\n' +
        'image — which is how the login page shipped with no sign-in button.',
    ).toBe(true);
    expect(
      passed.has(name),
      `${name} is an ARG the Dockerfile declares and managed.yml never passes,\n` +
        'so it takes its default in every managed build.',
    ).toBe(true);
  });

  it('passes the issuer and the client id, which sign-in cannot work without', () => {
    // Named explicitly as well as covered by the derived rule above: these two
    // are the ones whose absence has an invisible symptom — a login page that
    // renders fine and simply cannot start the flow.
    for (const name of ['VITE_OIDC_ISSUER', 'VITE_OIDC_CLIENT_ID']) {
      expect(declaredArgs.has(name), `${name} is not an ARG in apps/web/Dockerfile`).toBe(true);
      expect(passed.has(name), `${name} is not a build arg in managed.yml`).toBe(true);
    }
  });

  it('leaves them EMPTY by default rather than inventing an issuer', () => {
    // A stack that has not run the identity setup has no issuer, and the paste
    // box is the correct screen there. A made-up default would render a sign-in
    // button that leads nowhere.
    expect(dockerfile).toMatch(/^ARG VITE_OIDC_ISSUER=$/m);
    const args = compose.services.web?.build?.args ?? {};
    expect(args.VITE_OIDC_ISSUER).toBe('${VITE_OIDC_ISSUER:-}');
  });
});
