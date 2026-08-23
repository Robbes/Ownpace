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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/**
 * The first human's password, which the provider has to ACCEPT.
 *
 * Zitadel's default password complexity policy demands a lowercase letter, an
 * uppercase letter, a number and a symbol. `openssl rand -hex` produces
 * lowercase letters and digits and nothing else, so the password this repo
 * generated could never start an instance. E2E (managed) #39 and #40 both died
 * on it, the second only saying so because #507 had taught the bring-up to
 * print the container's log:
 *
 *   migration failed  name=03_default_instance
 *   error="ID=COMMA-VoaRj Message=Errors.User.PasswordComplexityPolicy.HasUpper"
 *   level=fatal msg="setup failed, skipping cleanup"
 *
 * after which the container exits 1 and restarts forever, which reads like a
 * crash and is a rejected password.
 *
 * These cases RUN the script rather than reading it. A static assertion that
 * some function is called proves nothing about the string that comes out, and
 * the string is the entire subject.
 */
describe('the admin password is one the provider will accept', () => {
  const SCRIPT = join(REPO, 'deploy/compose/ensure-env-secrets.sh');
  let dir: string;

  // The script writes .env and pgbouncer/userlist.txt beside ITSELF, so it is
  // copied into a temp directory rather than run in place — otherwise every run
  // of this suite would rewrite the developer's own secrets.
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'secrets-'));
    copyFileSync(SCRIPT, join(dir, 'ensure-env-secrets.sh'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = () => spawnSync('bash', [join(dir, 'ensure-env-secrets.sh')], { encoding: 'utf8' });
  const envFile = () => readFileSync(join(dir, '.env'), 'utf8');
  const adminPassword = () => /^ZITADEL_ADMIN_PASSWORD=(.*)$/m.exec(envFile())?.[1] ?? '';

  it('generates one carrying all four classes the policy demands', () => {
    expect(run().status).toBe(0);
    const pw = adminPassword();
    expect(pw, 'nothing was generated at all').not.toEqual('');
    expect(pw, 'no uppercase — this is the exact failure of #39/#40').toMatch(/[A-Z]/);
    expect(pw, 'no lowercase').toMatch(/[a-z]/);
    expect(pw, 'no digit').toMatch(/[0-9]/);
    expect(pw, 'no symbol — the next refusal after HasUpper').toMatch(/[^A-Za-z0-9]/);
    expect(pw.length, 'shorter than any sane minimum length').toBeGreaterThanOrEqual(12);
  });

  it('generates it correctly the FIRST time, without the repair covering for it', () => {
    // THE CASE THAT ALMOST WAS NOT HERE. Reverting the generator to plain hex
    // left every other case green: the repair below saw its own bad output and
    // healed it, so the end state was compliant and nothing complained. Defence
    // in depth is good and a test that cannot see the regression is not.
    //
    // On a FRESH .env the repair must never fire. If it does, the generator
    // produced something that had to be fixed — which is precisely the bug.
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('generated ZITADEL_ADMIN_PASSWORD');
    expect(
      r.stdout,
      'the repair fired on a fresh file — the generator is writing what the policy rejects',
    ).not.toContain('REPLACED ZITADEL_ADMIN_PASSWORD');
  });

  it('keeps the entropy in the random half, not in the suffix', () => {
    // The four fixed characters satisfy a policy and are not a secret. What
    // must not happen is somebody "simplifying" this to a short password plus
    // decoration, so the random part is asserted at full width.
    expect(run().status).toBe(0);
    expect(adminPassword()).toMatch(/^[0-9a-f]{32}/);
  });

  it('repairs a plain-hex password the old generator already wrote', () => {
    // `ensure` fills a MISSING key and never touches a present one, which is
    // right for a secret and wrong for a value that provably cannot work: the
    // policy rejected it, so `03_default_instance` failed, so no account was
    // ever created with it. This is what heals a runner whose .env predates the
    // fix without anybody editing a file by hand.
    const stale = '0123456789abcdef0123456789abcdef';
    writeFileSync(join(dir, '.env'), `ZITADEL_ADMIN_PASSWORD=${stale}\n`);
    const r = run();
    expect(r.status).toBe(0);
    expect(adminPassword(), 'the unusable value survived').not.toEqual(stale);
    expect(adminPassword()).toMatch(/[A-Z]/);
    expect(r.stdout, 'a silent replacement is worse than none').toContain(
      'REPLACED ZITADEL_ADMIN_PASSWORD',
    );
  });

  it("leaves an operator's own password alone", () => {
    // Only the old generator's exact fingerprint is repaired. Anything a person
    // chose is theirs, and rewriting it would be this script deciding it knows
    // better than the operator about their own instance.
    const chosen = 'MyOwnCarefullyChosen1!';
    writeFileSync(join(dir, '.env'), `ZITADEL_ADMIN_PASSWORD=${chosen}\n`);
    expect(run().status).toBe(0);
    expect(adminPassword()).toEqual(chosen);
  });

  it('changes nothing on a second run', () => {
    // The script's central promise, and the repair is the kind of addition that
    // breaks it: a rewrite keyed on a pattern its own output matches would
    // rotate the password on every bring-up.
    expect(run().status).toBe(0);
    const first = envFile();
    expect(run().status).toBe(0);
    expect(envFile()).toEqual(first);
  });
});
