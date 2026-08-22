// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The identity provider's wiring (ADR-0042), checked where it is checkable.
 *
 * None of this can be proved without a docker daemon, so what is pinned here is
 * the set of things that are STATIC and that have each cost somebody an evening
 * elsewhere in this repository: a key generated at the wrong length, a script
 * that writes one variable name while the code reads another, and a service
 * pointed at the pooler when it runs its own migrations.
 *
 * IN `scripts/`, NOT beside the compose file it reads, and that is not taste.
 * `deploy/` is in no tsconfig, and every `.ts` in this repository must be in one
 * or lint cannot parse it — the mistake this file made first, caught by CI with
 * `was not found by the project service`. `bootstrap-managed.unit.test.ts` is
 * the precedent: it lives here and tests what ends up in
 * `deploy/compose/.env` for the same reason.
 *
 * A LOCAL `pnpm lint` DID NOT CATCH IT. The script runs with `--cache`, and the
 * cached run stayed green on a file it had never parsed; `rm -f .eslintcache`
 * reproduced the CI failure immediately. Worth doing before trusting a green
 * lint on a file that has just been added.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');

const COMPOSE = read('deploy/compose/managed.yml');
const SETUP = read('deploy/compose/setup-zitadel.sh');
const SECRETS = read('deploy/compose/ensure-env-secrets.sh');
const EXAMPLE = read('deploy/compose/managed.env.example');
const AUTH = read('apps/api/src/middleware/auth.ts');

describe('the masterkey is generated at the length the provider demands', () => {
  it('asks for 16 bytes, because hex doubles it to the 32 CHARACTERS required', () => {
    // `openssl rand -hex 16` is 32 hex characters. Asking for 32 would produce
    // 64 and the container refuses to start — a confusing first bring-up for a
    // reason nobody sees, so the arithmetic is pinned rather than commented.
    expect(SECRETS).toMatch(/ensure ZITADEL_MASTERKEY 16\b/);
  });

  it('refuses to rotate it, like the other key that encrypts a live store', () => {
    // Replacing it on an instance that holds accounts strands them. The file
    // already learned this lesson once, for TRIGGER_ENCRYPTION_KEY.
    const guard = /needs_rotation_procedure\(\)[\s\S]*?\n}/.exec(SECRETS)?.[0] ?? '';
    expect(guard).toContain('ZITADEL_MASTERKEY');
    expect(guard).toContain('TRIGGER_ENCRYPTION_KEY');
  });
});

describe('the script writes the variable names the code actually reads', () => {
  /**
   * The failure this prevents is silent and total: the script reports success,
   * .env looks configured, and the API never sees an issuer — so it stays on
   * the symmetric secret and nobody can sign in with the provider that was
   * just set up.
   */
  it('writes JWT_ISSUER and JWT_AUDIENCE, which is what auth.ts reads', () => {
    expect(SETUP).toContain('JWT_ISSUER=${ISSUER}');
    expect(SETUP).toContain('JWT_AUDIENCE=${PROJECT_ID}');
    expect(AUTH).toContain('process.env.JWT_ISSUER');
    expect(AUTH).toContain('process.env.JWT_AUDIENCE');
  });

  it('passes both through compose to the api service', () => {
    expect(COMPOSE).toMatch(/JWT_ISSUER:\s*\$\{JWT_ISSUER:-\}/);
    expect(COMPOSE).toMatch(/JWT_AUDIENCE:\s*\$\{JWT_AUDIENCE:-\}/);
  });

  it('documents every variable it writes in the example env', () => {
    for (const key of ['JWT_ISSUER', 'JWT_AUDIENCE', 'VITE_OIDC_ISSUER', 'VITE_OIDC_CLIENT_ID']) {
      expect(EXAMPLE, `${key} is written by the script but undocumented`).toContain(`${key}=`);
    }
  });
});

describe('the provider connects the way a thing that runs its own migrations must', () => {
  it('goes DIRECT to postgres, never through the transaction pooler', () => {
    // Same reason the api service's DIRECT_DATABASE_URL exists: a migration
    // lock taken on one server connection and released on another is not a
    // lock, and it fails only under load.
    const block = /\n {2}zitadel:\n([\s\S]*?)\n {2}[a-z][a-z-]*:\n/.exec(COMPOSE)?.[1] ?? '';
    expect(block, 'the zitadel service block was not found').not.toBe('');
    expect(block).toContain('ZITADEL_DATABASE_POSTGRES_HOST: postgres');
    expect(block).not.toContain('pgbouncer');
  });

  it('waits on its own readiness signal rather than on a port', () => {
    const block = /\n {2}zitadel:\n([\s\S]*?)\n {2}[a-z][a-z-]*:\n/.exec(COMPOSE)?.[1] ?? '';
    // It listens well before its migrations finish; a port check would let the
    // setup script start provisioning into errors that read like bugs.
    expect(block).toContain('healthcheck:');
    expect(block).toMatch(/"ready"/);
  });

  it('keeps the provisioning token off the working tree', () => {
    const block = /\n {2}zitadel:\n([\s\S]*?)\n {2}[a-z][a-z-]*:\n/.exec(COMPOSE)?.[1] ?? '';
    // A named volume, not a bind mount: a machine credential with owner rights
    // must not be somewhere `git add -A` can reach (hard rule 3).
    expect(block).toContain('zitadel_machinekey:/machinekey');
    expect(block).not.toMatch(/\.\/[^\s:]*:\/machinekey/);
  });
});

describe('the browser client is public, which is what PKCE is for', () => {
  it('creates the app with no client secret', () => {
    // A single-page app cannot hold one: shipping a secret to every visitor is
    // not a secret. Asserted because the provider's default is confidential.
    expect(SETUP).toContain('OIDC_AUTH_METHOD_TYPE_NONE');
    expect(SETUP).toContain('OIDC_APP_TYPE_USER_AGENT');
  });

  it('asks for JWT access tokens, or the API could not verify them locally', () => {
    // The default is opaque, which would force an introspection call to the
    // provider on every request — slower, and exactly the provider-specific
    // coupling ADR-0042 forbids.
    expect(SETUP).toContain('OIDC_TOKEN_TYPE_JWT');
  });
});

describe('letting a granted person in (workplan 0095 T0)', () => {
  const script = readFileSync(join(REPO, 'deploy/compose/setup-zitadel.sh'), 'utf8');

  it('turns self-registration ON, because nothing else can create the account', () => {
    // ADR-0042 forbids creating users through the provider's API — that is the
    // rule that keeps the issuer replaceable. So a granted person makes their
    // own account, or the grant email sends them to a door they cannot open.
    expect(script).toContain('allowRegister:true');
  });

  it('VERIFIES the setting rather than trusting the call', () => {
    // `api` runs `curl -sS` without `-f`, so an HTTP 404 or 400 still exits 0.
    // Chaining on the exit code would report success for a call that changed
    // nothing — and this particular nothing surfaces days later, in front of a
    // customer who cannot sign in. So it is read back.
    const block = script.slice(script.indexOf('allowing people to register'));
    expect(block).toContain('read_allow_register');
    // The LAST read-back, not the first: the first is the "already allowed"
    // guard that skips the writes entirely. What this pins is that the one
    // deciding whether to `die` runs AFTER them.
    const write = block.indexOf('api PUT /management/v1/policies/login');
    const decides = block.lastIndexOf('read_allow_register)');
    expect(write).toBeGreaterThan(-1);
    expect(decides).toBeGreaterThan(write);
    // …and that failing it is fatal rather than a warning nobody reads.
    expect(block.slice(decides, decides + 200)).toContain('|| die');
  });

  it('says what to do by hand when it cannot, rather than only failing', () => {
    // A refusal that names the console path is one somebody can act on at
    // 23:00; "could not set policy" is not.
    const block = script.slice(script.indexOf('allowing people to register'));
    expect(block).toMatch(/ui\/console/);
    expect(block).toMatch(/Register allowed/i);
  });
});
