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

  it('is not gated by a probe that runs where the answer cannot be reached', () => {
    // This service used to carry
    //   test: ["CMD", "/app/zitadel", "ready", "--config", "/dev/null"]
    // and E2E (managed) #47 showed it cannot work. Zitadel came up perfectly —
    // every migration applied, OIDC routes registered, `server is listening` —
    // and compose called it unhealthy for thirty-one minutes, while
    // `curl http://localhost:3126/debug/ready` answered 200 from the host.
    //
    // `zitadel ready` builds its URL from ExternalPort, which is BY DEFINITION
    // the address the outside reaches Zitadel on. Inside the container nothing
    // listens there: here 3126 is a published port, and behind a front it is
    // 443, terminated by something that is not Zitadel.
    const block = /\n {2}zitadel:\n([\s\S]*?)\n {2}[a-z][a-z-]*:\n/.exec(COMPOSE)?.[1] ?? '';
    expect(block, 'the zitadel service block could not be found').not.toEqual('');
    expect(
      block.replace(/^\s*#.*$/gm, ''),
      'a probe asking ExternalPort from INSIDE the container cannot be answered',
    ).not.toMatch(/^\s*test:.*zitadel.*ready/m);
    // And the removal has to carry its reason, or somebody restores it.
    expect(block, 'a healthcheck removed without a reason is one that comes back').
      toMatch(/NO HEALTHCHECK, AND THAT IS THE FIX/);
  });

  it('checks readiness from the host, which is the side that can ask', () => {
    // Not weaker — the same question, asked by something in a position to hear
    // the answer, and able to say which of "nothing answered" and "answered and
    // said no" happened.
    const BOOTSTRAP = read('deploy/compose/bootstrap-managed.sh');
    const fn = BOOTSTRAP.slice(
      BOOTSTRAP.indexOf('wait_for_idp_ready() {'),
      BOOTSTRAP.indexOf('\n}', BOOTSTRAP.indexOf('wait_for_idp_ready() {')),
    );
    expect(fn.length, 'the readiness wait is gone or renamed').toBeGreaterThan(200);
    expect(fn, 'it must ask the readiness endpoint, not a port').toContain('/debug/ready');
    // The PUBLISHED port. ExternalPort is 443 behind a front and the host can
    // only reach what compose published — using it here rebuilds the bug.
    expect(fn, 'the host can only reach the published port').toMatch(/env_get ZITADEL_PORT/);
    expect(fn, 'ExternalPort is exactly the address that cannot be reached').
      not.toMatch(/ZITADEL_EXTERNALPORT/);
    // A timeout is still a diagnosis, not a silent give-up.
    expect(fn).toMatch(/explain_failure zitadel/);
    expect(fn, 'the reader needs to know whether anything answered at all').
      toMatch(/000/);
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
    // `api` used to run `curl -sS` without `-f`, so an HTTP 404 or 400 still
    // exited 0, and chaining on the exit code would have reported success for a
    // call that changed nothing — a nothing that surfaces days later, in front
    // of a customer who cannot sign in. So it is read back.
    //
    // `api` now reports what it was told and dies on a non-2xx, which is why
    // the writes below say `api_try`: exactly one of the two verbs is EXPECTED
    // to be refused, so "it did not error" still cannot mean "it took". The
    // read-back is what decides, then as now.
    const block = script.slice(script.indexOf('allowing people to register'));
    expect(block).toContain('read_allow_register');
    // The LAST read-back, not the first: the first is the "already allowed"
    // probe that skips the writes entirely. What this pins is that the one
    // deciding whether to `die` runs AFTER them.
    const write = block.indexOf('api_try PUT /management/v1/policies/login');
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

/**
 * E2E (managed) #44, the oldest line in the failure window, from the FIRST
 * attempt on a genuinely clean database:
 *
 *   migration failed  name=03_default_instance
 *     error="open /machinekey/pat.txt: permission denied"
 *   setup failed, skipping cleanup
 *
 * Docker creates a new named volume's mount point owned by root, and the
 * Zitadel image runs as a non-root user — which that error proves, since root
 * could have written anywhere. So the provisioning token could never be
 * written, and this had never worked once.
 *
 * It stayed hidden because `03_default_instance` creates the first HUMAN before
 * the machine account: while the admin password was being rejected (#509) the
 * migration died earlier and never reached the token. Fixing the password is
 * what exposed it. Two bugs in a queue, the second unreachable until the first
 * was gone — and every restart in between reported
 * `Errors.Instance.Domain.AlreadyExists`, the leftover of the first failure.
 */
describe('the provisioning token can actually be written (E2E managed #44)', () => {
  const BOOTSTRAP = read('deploy/compose/bootstrap-managed.sh');
  const prepare = BOOTSTRAP.slice(
    BOOTSTRAP.indexOf('prepare_machinekey_volume() {'),
    BOOTSTRAP.indexOf('\n}', BOOTSTRAP.indexOf('prepare_machinekey_volume() {')),
  );
  // The uid lookup is its own function, above the caller like every other
  // helper in that file, so it is not inside the slice above.
  const bootstrapFn = BOOTSTRAP.slice(
    BOOTSTRAP.indexOf('resolve_image_uid() {'),
    BOOTSTRAP.indexOf('\n}', BOOTSTRAP.indexOf('resolve_image_uid() {')),
  );

  it('read the real files', () => {
    // Vacuity guard: an empty string satisfies every "does not contain" below.
    expect(prepare.length).toBeGreaterThan(200);
    expect(bootstrapFn.length, 'the uid lookup is gone or renamed').toBeGreaterThan(150);
    expect(COMPOSE).toContain('zitadel-machinekey:');
  });

  it('prepares the volume BEFORE the provider that has to write into it', () => {
    // Ordering is the entire fix. Preparing it afterwards is preparing it for
    // the next run, which is how this looked for six dispatches.
    const prep = BOOTSTRAP.indexOf('\n  prepare_machinekey_volume\n');
    // `up -d zitadel`, not `up_wait`: the container no longer carries a
    // healthcheck for `--wait` to gate on (#47 — the probe asked an address that
    // cannot be reached from inside it). Readiness moved to a host-side poll,
    // and the ordering this case exists for is unchanged.
    const up = BOOTSTRAP.indexOf('" up -d zitadel"'.slice(1, -1));
    expect(prep, 'the bring-up no longer prepares the volume at all').toBeGreaterThan(-1);
    expect(up, 'the zitadel bring-up moved or went away').toBeGreaterThan(-1);
    expect(prep, 'preparing it after the provider starts prepares it for the NEXT run').
      toBeLessThan(up);
  });

  it('reads the user off the image instead of writing a uid down', () => {
    // The image carries no shell this can rely on, but `docker image inspect`
    // reads the same config the daemon applies, so this cannot disagree with
    // reality the way a number in a comment can. E2E (managed) #45 proved the
    // point: v4.6.2 reported `zitadel`, a NAME, and a hardcoded 1000 would have
    // chowned the token directory to whoever else holds that uid.
    expect(prepare).toMatch(/docker image inspect "\$image" --format '\{\{\.Config\.User\}\}'/);
    // A literal uid anywhere in the helper would be the guess this avoids.
    expect(
      prepare.replace(/^\s*#.*$/gm, ''),
      'a hardcoded uid is exactly what a version bump silently invalidates',
    ).not.toMatch(/\b1000\b/);
  });

  it('names the image by KEY, never by position in a list', () => {
    // `config --images zitadel` looks like the obvious call and is a trap: it
    // prints the service's DEPENDENCIES too (`postgres:18-alpine` came back on
    // the second line), so taking the first line is a coin flip on an ordering
    // nothing documents. Losing it means inspecting Postgres and chowning the
    // token volume to whatever user THAT runs as — a silently wrong answer,
    // which is worse than an error.
    expect(prepare).toMatch(/\.services\.zitadel\.image/);
    // Comments stripped: the helper's own comment NAMES the trap in order to
    // explain it, and a test that reads prose cannot tell a warning about a
    // call from the call.
    expect(prepare.replace(/^\s*#.*$/gm, ''), 'a list of images is not an answer to "which image"').
      not.toMatch(/config --images/);
  });

  it('pulls before it inspects, because inspect reads the LOCAL image', () => {
    // On a fresh machine the image arrives with `up`, which is after this.
    const pull = prepare.indexOf('pull -q zitadel');
    const inspect = prepare.indexOf('docker image inspect');
    expect(pull, 'inspect on a machine that has never pulled reports nothing').
      toBeGreaterThan(-1);
    expect(pull).toBeLessThan(inspect);
  });

  it('treats "no USER" as root rather than substituting a guess', () => {
    // An empty answer is a real answer: the image declares no USER, so it runs
    // as root, and root needs no help writing to a root-owned directory.
    // Falling back to a uid there would be inventing a fact (hard rule 9).
    expect(prepare).toMatch(/if \[ -z "\$user" \]; then/);
    expect(prepare).toMatch(/runs as root/);
  });

  it('resolves a NAME to a number instead of refusing it', () => {
    // E2E (managed) #45: `ghcr.io/zitadel/zitadel:v4.6.2` reported `Config.User`
    // as `zitadel`. The first version of this refused, correctly — `chown
    // zitadel` inside busybox resolves against BUSYBOX's passwd, where no such
    // user exists. But refusing is half an answer when the number is readable,
    // and it is: Docker resolves `USER zitadel` against the IMAGE'S OWN
    // /etc/passwd to start the container at all, so that file is in there.
    expect(prepare, 'a name must be looked up, not rejected outright').
      toMatch(/resolve_image_uid "\$image" "\$user"/);
    expect(bootstrapFn, 'the lookup reads the image\'s own passwd').
      toMatch(/\/etc\/passwd/);
    expect(bootstrapFn, 'and finds the third field of the matching line').
      toMatch(/awk -F: -v u="\$name"/);
  });

  it('reads that passwd WITHOUT running the image', () => {
    // `docker create` makes a container and does not start it; `docker cp`
    // reads files out of one. So this needs no shell, no entrypoint and no
    // running process — which matters, because what is in that image beyond
    // the binary is exactly what nothing here can assume.
    expect(bootstrapFn).toMatch(/docker create "\$image"/);
    expect(bootstrapFn).toMatch(/docker cp "\$\{cid\}:\/etc\/passwd" -/);
    expect(bootstrapFn, 'a container started to read a file is a container that can fail to stop').
      not.toMatch(/docker run[^\n]*\$image/);
  });

  it('removes the container it created, whether or not the read worked', () => {
    // A created-and-abandoned container is litter on a long-lived box, and the
    // Spark is the definition of one.
    expect(bootstrapFn).toMatch(/docker rm -f "\$cid"/);
    const rmLine = bootstrapFn.split('\n').find((l) => /docker rm -f "\$cid"/.test(l)) ?? '';
    expect(rmLine, 'a removal that only happens on success does not happen when it matters').
      toContain('|| true');
  });

  it('still refuses a name the image cannot explain', () => {
    // The lookup replaces the guess, not the refusal. A name that is not in the
    // image's own passwd has no number anybody can justify, and chowning a
    // token directory to an unjustified uid is how a credential ends up owned
    // by whoever happens to hold it.
    expect(prepare).toMatch(/not in the image's own \/etc\/passwd/);
    expect(prepare, 'a refusal that does not say what to do next is half a refusal').
      toMatch(/docker run --rm -v ownpace-managed_zitadel_machinekey/);
  });

  it('the init service is kept out of `up` and writes only the one directory', () => {
    const block = /\n {2}zitadel-machinekey:\n([\s\S]*?)\n {2}[a-z][a-z-]*:\n/.exec(COMPOSE)?.[1] ?? '';
    expect(block, 'the service block could not be found').not.toEqual('');
    // A profile, so a plain `up` never starts it and `--wait` never has to have
    // an opinion about a container that exits 0.
    expect(block).toMatch(/profiles: \["init"\]/);
    expect(block).toContain('zitadel_machinekey:/machinekey');
    expect(block).toMatch(/chmod 700 \/machinekey/);
    // It gets the uid from the environment the bring-up exports; the default is
    // only for a hand-run `compose run`.
    expect(block).toMatch(/\$\{ZITADEL_UID:-1000\}/);
  });

  it('the volume stays the only home for the token', () => {
    // The whole reason for a named volume is that a machine credential with
    // owner rights must not be somewhere `git add -A` can reach (hard rule 3).
    // A bind mount would make the permission problem go away and the secret
    // problem appear, which is not a trade this repository makes.
    const block = /\n {2}zitadel-machinekey:\n([\s\S]*?)\n {2}[a-z][a-z-]*:\n/.exec(COMPOSE)?.[1] ?? '';
    expect(block).not.toMatch(/\.\/[^\s:]*:\/machinekey/);
    expect(prepare).not.toMatch(/\/machinekey.*\$\{?(REPO_ROOT|SCRIPT_DIR|PWD)/);
  });
});

/**
 * ONE ORIGIN, AND THE API HAS TO BE ABLE TO PRESENT IT.
 *
 * E2E (managed) #52 was the first run whose stack got all the way through
 * `setup-zitadel.sh`, and every authenticated request in it answered HTTP 500
 * `auth_failed`. Not one token was rejected: verification never got as far as a
 * token. `JWT_ISSUER` was `http://localhost:3126`, and inside the API container
 * `localhost` is the API.
 *
 *   fetch("http://localhost:3126/.well-known/openid-configuration")
 *     TypeError: fetch failed / Error: connect ECONNREFUSED 127.0.0.1:3126
 *
 * There is no internal shortcut, and this was measured rather than assumed:
 *
 *   http://zitadel:8080/...       404  unable to set instance using origin
 *   http://ownpace-idp:8080/...   404  &{...  http} (ExternalDomain is localhost)
 *
 * The provider resolves the instance from the request's ORIGIN — host and port
 * — and refuses any other. Adding an instance TRUSTED domain does not change it
 * (one was added; still 404), and `AddInstanceDomain` is on the System API,
 * which a provisioning token cannot reach: `POST /admin/v1/domains` answers 404
 * `Not Found`. So the origin is fixed at FIRST INIT and everything else has to
 * agree with it.
 */
describe('one origin, and every side of the stack can present it', () => {
  it('does not make the issuer `localhost`, which the API can never mean', () => {
    const value = /ZITADEL_EXTERNALDOMAIN: \$\{ZITADEL_EXTERNALDOMAIN:-([^}]+)\}/.exec(COMPOSE)?.[1];
    expect(value, 'managed.yml must default ZITADEL_EXTERNALDOMAIN').toBeDefined();
    expect(
      value,
      'inside the API container `localhost` is the API — an issuer there can never be reached',
    ).not.toBe('localhost');
    expect(value, 'nor any other loopback spelling').not.toMatch(/^(127\.|::1|localhost)/);
  });

  it('registers that very domain as a network alias, as the same expression', () => {
    // Written as the same `${VAR:-default}` string in both places so the name
    // the provider answers for and the name that resolves to it cannot drift.
    // Whatever origin an operator configures, that is the name the API reaches
    // it by — including a real hostname on a real deployment.
    const domain = /ZITADEL_EXTERNALDOMAIN: (\$\{ZITADEL_EXTERNALDOMAIN:-[^}]+\})/.exec(
      COMPOSE,
    )?.[1];
    expect(domain).toBeDefined();
    const zitadel = /\n {2}zitadel:\n([\s\S]*?)\n {2}[a-z][a-z-]*:\n/.exec(COMPOSE)?.[1] ?? '';
    expect(zitadel, 'the zitadel service block must be readable').toContain('ZITADEL_EXTERNALDOMAIN');
    expect(zitadel, 'the alias must be the external domain itself').toMatch(
      new RegExp(`aliases:\\s*\\n\\s*- ${domain!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  });

  it('presents the origin from the HOST, which cannot resolve a compose alias', () => {
    // setup-zitadel.sh runs on the host. The host has the published port and
    // not the name; the API container has the name and not the port. `curl
    // --resolve` connects here while presenting the origin the instance was
    // initialised with — and only when this machine cannot reach it unaided, so
    // a deployment with real DNS is left alone.
    expect(SETUP).toContain('CURL_ORIGIN=(');
    expect(SETUP).toMatch(/--resolve "\$\{IDP_DOMAIN\}:\$\{IDP_PORT\}:127\.0\.0\.1"/);
    expect(SETUP, 'every API call must go out with it').toMatch(
      /local args=\(-sS "\$\{CURL_ORIGIN\[@\]\}"/,
    );
  });

  it('REFUSES a loopback issuer up front, where the remedy is two lines', () => {
    // The failure this prevents is silent and four steps away: the bring-up
    // goes green in under four minutes, every service is healthy, and every
    // authenticated request answers HTTP 500 with a reference id that mentions
    // no issuer, no token and no URL. Two whole runs went that way.
    const block = /case "\$IDP_DOMAIN" in[\s\S]*?\nesac/.exec(SETUP)?.[0] ?? '';
    expect(block, 'there must be a loopback guard at all').toContain('die');
    for (const loopback of ['localhost', '127.', '::1']) {
      expect(block, `${loopback} names the API to the API`).toContain(loopback);
    }
    // Both remedies, because changing the variable alone is not enough on a
    // provider that has already been initialised under the old name.
    expect(block).toContain('ZITADEL_EXTERNALDOMAIN=ownpace-idp');
    expect(block, 'and the re-init, which the variable alone does not do').toContain(
      'DROP DATABASE IF EXISTS zitadel',
    );
  });

  it('says what is configured without touching anything', () => {
    // `--print` exists to answer a question instantly. The origin probe added
    // for `curl --resolve` sat above it at first, so the flag did a network
    // round trip before printing four lines it already knew.
    const printBlock = /if \[ "\$\{1:-\}" = "--print" \]; then[\s\S]*?\nfi\n/.exec(SETUP)?.[0] ?? '';
    expect(printBlock, 'the --print block must be readable').toContain('issuer:');
    expect(SETUP.indexOf('CURL_ORIGIN=('), 'the probe must come AFTER --print exits').toBeGreaterThan(
      SETUP.indexOf('if [ "${1:-}" = "--print" ]; then'),
    );
  });

  it('names the instance-not-found refusal instead of printing a bare status', () => {
    // A 404 from this provider has two completely different meanings — "no such
    // object" and "I do not serve this origin" — and only one of them is fixed
    // by re-initialising. Hard rule 10: the message must belong to what
    // happened.
    expect(SETUP).toContain('unable to set instance using origin');
    expect(SETUP).toContain('Instance not found');
    expect(SETUP, 'and it must say what to do about it').toMatch(
      /DROP DATABASE IF EXISTS zitadel/,
    );
  });
});

/**
 * A SIGN-IN THAT CAN ACTUALLY COMPLETE.
 *
 * Two more things in the same path, both provisioned in a way that could not
 * work and both reporting success:
 *
 *   GET /oauth/v2/authorize?...&redirect_uri=http://localhost:3123/auth/callback
 *     400  {"error":"invalid_request","error_description":"This client's
 *           redirect_uri is http and is not allowed."}
 *
 * — before any login screen, because the application was created with
 * `devMode:false`. And with that turned on, the sign-in completes and the token
 * it returns carries no email address, which the API requires:
 *
 *   access token  iss sub aud exp iat nbf client_id jti     (userinfo flag on OR off)
 *   ID token      ... + email email_verified name ...       (flag ON only)
 */
describe('a sign-in that can actually complete', () => {
  it('derives devMode from the scheme of WEB_URL rather than writing it down', () => {
    expect(SETUP).toMatch(/case "\$WEB_URL" in[\s\S]*?https:\/\/\*\)\s*DEV_MODE=false/);
    expect(SETUP).toMatch(/http:\/\/\*\)\s*DEV_MODE=true/);
    expect(SETUP, 'the application must be created with the derived value').toMatch(
      /devMode:\$dm/,
    );
    // Comments in this file quote `devMode:false` while explaining the bug, so
    // the check is against the CODE, not against every occurrence of the word.
    const code = SETUP.split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(code, 'and never with a hardcoded one').not.toMatch(/devMode:(true|false)/);
  });

  it('refuses a WEB_URL whose scheme it cannot read, instead of guessing', () => {
    const block = /case "\$WEB_URL" in[\s\S]*?\nesac/.exec(SETUP)?.[0] ?? '';
    expect(block).toContain('*)');
    expect(block).toContain('die');
  });

  it('asks for user info in the ID token, the only place the provider puts email', () => {
    expect(SETUP).toContain('idTokenUserinfoAssertion:true');
    // Both the create and the reconcile, or a stack converges on one of two
    // different applications depending on which path it took.
    expect(SETUP.match(/idTokenUserinfoAssertion:true/g)?.length).toBe(2);
  });

  it('RECONCILES an application it finds, rather than reading one field off it', () => {
    // The stack that already exists is the broken one: it has devMode:false and
    // no userinfo assertion, and a script that finds an application and stops
    // leaves it that way for ever. Idempotent means converges (hard rule 1).
    // Anchored on the APPLICATION branch: the project lookup above it has an
    // `else say "found it"` of its own, and matching that one made this case
    // assert about the wrong block entirely.
    const found = /else\n\s*say "found it — reading its configuration"[\s\S]*?\nfi\n/.exec(
      SETUP,
    )?.[0] ?? '';
    expect(found, 'the found-branch must be readable').toContain('CLIENT_ID');
    expect(found).toContain('CURRENT_DEV');
    expect(found).toContain('CURRENT_USERINFO');
    expect(found).toMatch(/api PUT .*oidc_config/);
    expect(found, 'and must not write when nothing differs').toMatch(/if \[ "\$CURRENT_DEV" != /);
  });

  it('the web app sends the token that carries the email claim', () => {
    // `verifyManagedToken` requires ['sub','email'] (ADR-0042 — invitations are
    // addressed to an email address, and a first-time signer-in has no row to
    // look one up in). The access token has never carried one. Sending it is a
    // sign-in that completes and then cannot be used.
    const OIDC = read('apps/web/src/services/oidc.ts');
    expect(OIDC).toMatch(/return body\.id_token;/);
    expect(OIDC, 'the refusal must be about the token it actually needs').toMatch(
      /!body\.id_token/,
    );
    expect(OIDC, 'and it must say why, because this reads like a mistake').toContain(
      'NOT THE ACCESS TOKEN',
    );
  });
});
