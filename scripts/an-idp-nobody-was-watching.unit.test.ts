// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN IDENTITY PROVIDER NOBODY WAS WATCHING.
 *
 * The status page had four rows under **Ownpace** and three of them read the
 * same endpoint. `Web app`, `API`, `Database` and `Sign-in` all ask
 * `${STATUS_WEB_URL}`, and the last two read a FIELD off `/api/ready` — which
 * means the identity provider appeared on that page only as something the API
 * had computed about it, under a name that reads like an Ownpace component.
 *
 * TWO CONSEQUENCES, both found by looking rather than by an outage.
 *
 * The provider was never named. Somebody went looking for it and did not find
 * it (owner, 2026-08-25) — and `Sign-in`, when they were pointed at it, is
 * listed against the app's domain, because that is whose readiness endpoint it
 * reads. A page that cannot say "the identity provider is up" is missing the
 * component whose failure locks everybody out.
 *
 * And the rows go dark together. Three of the four are answers from one
 * process; the moment that process is the unwell one, the page loses its
 * ability to say which OTHER parts are fine — exactly when that is the question.
 *
 * THE PUBLIC SITE WAS NOT THERE EITHER, for a different reason: `www.yml` is a
 * separate deploy on its own network, so it needs a row that can be switched
 * off. A red light for a service nobody deployed is a lamp that lies, and this
 * file's rules keep it off unless somebody asks for it.
 *
 * AND ONE FALSE RED, fixed here because it is the same subject. `/api/ready`
 * fetched `${JWT_ISSUER}/.well-known/openid-configuration` while the verifier
 * used `JWT_JWKS_URI || discover(JWT_ISSUER)`. On a fronted stack those are not
 * the same address — the environment variable exists precisely because the
 * issuer origin is unreachable from inside — so readiness reported `down` for a
 * sign-in that worked. It now asks in the verifier's order.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(REPO_ROOT, 'deploy/compose');

const gatusRaw = readFileSync(join(COMPOSE, 'gatus.yaml'), 'utf8');
/** The endpoints as gatus will see them — comments are not configuration. */
const endpoints: Array<{
  name?: string;
  url?: string;
  enabled?: unknown;
  conditions?: string[];
}> = (parse(gatusRaw) as { endpoints?: [] }).endpoints ?? [];

function row(name: string) {
  const found = endpoints.find((e) => e.name === name);
  expect(found, `there is no '${name}' row on the status page`).toBeDefined();
  return found!;
}

describe('the status page names the identity provider', () => {
  it('has a row for it', () => {
    expect(
      endpoints.map((e) => e.name),
      'nothing on the status page names the identity provider. It appears only\n' +
        "as a field the API computed, under a row called 'Sign-in' that is listed\n" +
        "against the app's own address.",
    ).toContain('Identity provider');
  });

  it('asks the provider, not the API that has an opinion about it', () => {
    // The whole point. A second row reading `/api/ready` would add a lamp and
    // no information: it would go dark with the other three.
    const url = row('Identity provider').url ?? '';
    expect(
      url,
      'the Identity provider row reads the API instead of the provider, so it\n' +
        'goes dark at exactly the moment the API is the unwell part.',
    ).not.toMatch(/STATUS_WEB_URL|\/api\//);
  });

  it('asks an endpoint that is not origin-sensitive', () => {
    /**
     * Zitadel resolves which instance a request is for from its ORIGIN — host
     * AND port — and answers 404 "Instance not found" to any other. A discovery
     * probe would therefore report the provider down whenever it was merely
     * asked by a name that instance does not answer for: a red light about the
     * question, not about the provider.
     *
     * `/debug/ready` is served before instance resolution, which the bring-up
     * already relies on: it waits on `http://localhost:<port>/debug/ready` and
     * gets 200 with a Host header no instance has heard of.
     */
    const url = row('Identity provider').url ?? '';
    expect(url, 'the provider is probed at an origin-sensitive endpoint').toMatch(
      /\/debug\/(ready|healthz)$/,
    );
  });
});

describe('and the public site, without pretending it is always deployed', () => {
  it('has a row', () => {
    expect(endpoints.map((e) => e.name)).toContain('Website');
  });

  it('is off unless somebody switches it on', () => {
    // `www.yml` is a separate deploy that this stack does not start. A row that
    // went red because a service was never deployed is a lamp that lies.
    expect(
      row('Website').enabled,
      'the Website row is enabled unconditionally, so every stack that does not\n' +
        'deploy www.yml gets a permanent red light for a service it never ran.',
    ).toBeDefined();
  });

  it('cannot be accidentally green when nobody set an address', () => {
    // gatus refuses to load a config with an endpoint that has no URL and takes
    // the whole page down, so the URL always has a value. That value must be
    // one that can never resolve.
    const managed = readFileSync(join(COMPOSE, 'managed.yml'), 'utf8');
    const line = managed.match(/^\s*STATUS_SITE_URL:.*$/m)?.[0] ?? '';
    expect(line, 'managed.yml gives gatus no STATUS_SITE_URL').not.toEqual('');
    expect(
      line,
      'the placeholder for an unset site address is a name that could resolve.\n' +
        'Use a .invalid host: a row that can go green while nobody configured it\n' +
        'is worse than one that is red.',
    ).toMatch(/\.invalid\b/);
  });

  it('the bring-up says so when only one of the two settings is set', () => {
    const bootstrap = readFileSync(join(COMPOSE, 'bootstrap-managed.sh'), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(bootstrap, 'nothing checks for a half-configured site row').toMatch(
      /note_site_row_half_configured/,
    );
    // Defined AND called — a rule that checks a definition is satisfied by dead
    // code, which this repo has now been caught by more than once.
    expect(
      (bootstrap.match(/note_site_row_half_configured/g) ?? []).length,
      'note_site_row_half_configured is defined and never called',
    ).toBeGreaterThan(1);
  });
});

describe('and every row has an address, whatever the operator left unset', () => {
  /**
   * gatus runs `os.ExpandEnv` over this file and THEN parses it. An unset
   * variable becomes an empty string, an endpoint with an empty URL is
   * `ErrEndpointWithNoURL`, and gatus refuses to start — so one missing
   * variable does not grey out one row, it takes the whole status page down.
   *
   * Which makes this a rule about managed.yml: every variable gatus.yaml reads
   * must arrive with a default that is not empty.
   */
  it('managed.yml gives gatus a non-empty default for everything gatus.yaml reads', () => {
    // DIRECTIVES ONLY. gatus expands the environment over comments too, but an
    // empty expansion in a comment is a comment — it is the URLs that stop the
    // page from loading. The first version read the whole file and failed on a
    // sentence explaining the endpoint, which is this repo's tenth rule to
    // forbid its own explanation.
    const configOnly = gatusRaw
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    const referenced = new Set(
      [...configOnly.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map((m) => m[1]),
    );
    expect(referenced.size, 'gatus.yaml reads no environment at all').toBeGreaterThan(0);

    const managed = readFileSync(join(COMPOSE, 'managed.yml'), 'utf8');
    const gatusEnv = managed.slice(managed.indexOf('  gatus:'));
    const missing = [...referenced].filter((name) => {
      const line = gatusEnv.match(new RegExp(`^\\s*${name}:\\s*(.*)$`, 'm'))?.[1];
      if (line === undefined) return true;
      // `${X:-…}` or `${X:?…}` — a bare `${X}` has nothing to fall back to.
      return !/\$\{[A-Z_][A-Z0-9_]*:[-?]/.test(line);
    });
    expect(
      missing,
      'gatus.yaml reads these with no non-empty default in managed.yml. An unset\n' +
        'one becomes an empty URL, which gatus refuses to load — so the whole\n' +
        'status page goes down rather than one row going grey.',
    ).toEqual([]);
  });
});

describe('and no row probes an address the expansion mangled', () => {
  /**
   * gatus swaps `$$` out, runs `os.ExpandEnv`, and swaps it back. So a bare
   * `$name` in a URL is an ENVIRONMENT VARIABLE, and an unset one vanishes.
   *
   * `Gmail API` had been probing `https://gmail.googleapis.com//rest?version=v1`
   * since the page was written: Google's discovery path contains a literal
   * dollar, `$discovery` expanded to nothing, and the row answered 404 while
   * the intended URL answers 200. A permanently red row for a healthy service
   * is the same corrosion as a green one for a sick service — and worse in one
   * way, because it teaches the reader to ignore a colour.
   */
  it('every dollar in a URL is either an expansion or escaped', () => {
    const offenders = endpoints
      .map((e) => e.url ?? '')
      .filter((url) => /(^|[^$])\$(?![${])/.test(url.replace(/\$\$/g, '')));
    expect(
      offenders,
      'these URLs carry a bare `$name`, which gatus expands as an environment\n' +
        'variable and drops when it is unset. A literal dollar is written `$$`.',
    ).toEqual([]);
  });
});

describe('and readiness asks where the verifier asks', () => {
  const ready = readFileSync(join(REPO_ROOT, 'apps/api/src/routes/ready.ts'), 'utf8');

  it('prefers JWT_JWKS_URI, the way middleware/auth.ts does', () => {
    /**
     * `auth.ts` resolves `JWT_JWKS_URI || discoverJwksUri(JWT_ISSUER)`. A
     * readiness check that only knew about the issuer probed an address nothing
     * uses on a fronted stack — where that variable exists precisely because
     * the issuer origin is not reachable from inside — and reported `down` for
     * a sign-in that worked. A false red costs the same trust as a false green.
     */
    const auth = readFileSync(join(REPO_ROOT, 'apps/api/src/middleware/auth.ts'), 'utf8');
    expect(auth, 'the verifier no longer reads JWT_JWKS_URI').toMatch(/JWT_JWKS_URI/);
    expect(
      ready,
      'readiness does not know about JWT_JWKS_URI, so on a stack that sets it\n' +
        'the Sign-in row reports on an address no request ever uses.',
    ).toMatch(/JWT_JWKS_URI/);
  });

  it('still treats no issuer as off rather than as broken', () => {
    // Self-host has no issuer, and a managed stack before the identity setup is
    // in a documented state, not a broken one.
    expect(ready).toMatch(/if \(!issuer\) return 'off';/);
  });

  it('keeps the address out of the body and in the log', () => {
    // A readiness endpoint a public status page reads without a credential must
    // not publish internal hostnames.
    const check = ready.slice(ready.indexOf('async function checkSignIn'));
    expect(check, 'the probe URL is not logged, so an operator cannot see which one failed')
      .toMatch(/log\.error\(`\[ready\][^`]*\$\{url\}/);
  });
});
