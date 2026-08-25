// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MAIL THE ISSUER COULD NOT SEND.
 *
 * Two things on this stack send mail and only one was ever wired.
 *
 * `managed.yml` hands the API `SMTP_HOST` and friends (#551), so an
 * access-request digest reaches Mailpit and a gate asserts it does. The
 * identity provider's mail is its own and never touches the API — the
 * verification link on a new account, an email-change confirmation, a password
 * reset, the invitation to set a first password — and this stack configured no
 * email provider for it AT ALL. Every one of those was composed and dropped.
 *
 * IT FAILS INVISIBLY FROM BOTH ENDS, which is why it needs rules rather than a
 * look. The account is created, the screen says to check your mail, and Mailpit
 * stays empty: indistinguishable from a product whose mail is broken. Nothing
 * in any log says the provider had nowhere to send.
 *
 * ONE RELAY SETTING, NOT TWO. `setup-zitadel.sh` reads the same `SMTP_HOST` /
 * `SMTP_PORT` / `NOTIFY_FROM` the API reads, for the reason `STATUS_URL` is
 * derived rather than configured beside `APP_URL`: two settings that name one
 * relay drift, and the day they disagree half the stack's mail vanishes and the
 * other half does not.
 *
 * AND THE CATCHER IS NOT A PUBLIC READER. Mailpit has no authentication — it is
 * a catcher, and asking it to hold credentials would defeat the point — and
 * what it catches is every verification link and password reset the stack
 * sends. Published on 0.0.0.0 that is an unauthenticated reader of the identity
 * provider's mail. Harmless on a laptop; not harmless once the box has a public
 * name, which is what changed on 2026-08-24.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(REPO_ROOT, 'deploy/compose');

/** Shell source with comment-only lines removed — a rule must not forbid its
 *  own explanation, the false positive this repo has now hit seven times. */
function directives(path: string): string {
  return readFileSync(join(COMPOSE, path), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

describe('the identity provider is given a way to send mail', () => {
  const setup = directives('setup-zitadel.sh');

  it('configures an email provider at all', () => {
    expect(
      setup,
      'setup-zitadel.sh configures no email provider. The instance composes a\n' +
        'verification link for every new account and drops it, while the screen\n' +
        'still says to check your mail.',
    ).toMatch(/\/admin\/v1\/email\/smtp/);
  });

  it('uses the modern endpoints for CONFIG, where they are implemented', () => {
    /**
     * This rule used to forbid `/admin/v1/smtp` outright, because v4.17.1's
     * proto marks the whole family `deprecated: true`. That was the proto's
     * advice taken as fact, and the reference box disproved it: the modern
     * TEST verb answers HTTP 501 UNIMPLEMENTED while the deprecated one works.
     *
     * So the rule says what is actually true. Configuring — add, search,
     * activate — belongs on `/email`, which IS implemented. The test verb is
     * the single exception, pinned by its own case below with the reason.
     */
    const calls = [...setup.matchAll(/\/admin\/v1\/(email\/smtp|email|smtp)\b[^"']*/g)]
      .map((m) => m[0]);
    expect(calls.length, 'no SMTP endpoint is called at all').toBeGreaterThan(0);
    const legacy = calls.filter((c) => /^\/admin\/v1\/smtp\b/.test(c));
    expect(
      legacy.filter((c) => !c.includes('_test')),
      'a CONFIG verb is on the deprecated /admin/v1/smtp family. Those have\n' +
        'modern equivalents that this version implements; only the test verb\n' +
        'does not.',
    ).toEqual([]);
  });

  it('reads the relay the API already reads, rather than a second setting', () => {
    // A ZITADEL_SMTP_HOST would be a second name for one relay, and the day the
    // two disagree exactly half the stack's mail disappears.
    expect(setup).toMatch(/read_env SMTP_HOST/);
    expect(
      setup,
      'a ZITADEL_-prefixed relay setting was introduced; there must be one relay setting',
    ).not.toMatch(/ZITADEL_SMTP/);
  });

  it('treats an empty SMTP_HOST as off rather than as an error', () => {
    // A deployment that has not chosen a relay is not misconfigured, and a
    // bring-up that refused over it would be inventing a requirement.
    expect(setup).toMatch(/if \[ -z "\$SMTP_RELAY" \]/);
  });

  it('activates the provider, because an inactive one is the same silence', () => {
    expect(setup).toMatch(/_activate/);
    expect(
      setup,
      'nothing asserts the provider ended up ACTIVE. Adding one does not put it\n' +
        'in use, and an inactive provider drops mail exactly as silently as none.',
    ).toMatch(/EMAIL_PROVIDER_ACTIVE/);
  });
});

describe('and a gate proves it actually sends', () => {
  const smoke = directives('smoke-managed.sh');

  it('tests the STORED config, not settings handed to the test call', () => {
    // `/email/smtp/_test` takes a full config in the request body, so it would
    // pass against settings this instance does not use — green about the relay
    // being reachable, silent about whether the issuer will ever send through
    // it. `/email/smtp/{id}/_test` uses what is stored.
    expect(smoke).toMatch(/\/admin\/v1\/smtp\/\$\{smtp_id\}\/_test/);
  });

  it('reads the catcher rather than trusting the test call', () => {
    // Zitadel answers the test before delivery completes, so "HTTP 200" is not
    // "a mail arrived". The proof is the message in Mailpit.
    expect(smoke).toMatch(/messages_count/);
  });

  it('skips rather than fails when no relay is configured', () => {
    expect(smoke).toMatch(/no SMTP_HOST in \.env, so nothing to assert/);
  });
});

describe('and it is proved where the proof is needed', () => {
  const setup = directives('setup-zitadel.sh');

  /**
   * `smoke-managed.sh` asserts the issuer can send, and on a REAL deployment it
   * never runs: `phase_smoke` returns early without `--with-demo`, because the
   * smoke drives the demo tenants. So the check was live on the nightly and
   * dead on every stack anybody actually uses — coverage where it cannot
   * execute, which is the gatus healthcheck's shape exactly. Reported from the
   * reference box on 2026-08-25, where `--only smoke` printed "skipped".
   */
  it('the bring-up itself proves delivery, not only the demo gate', () => {
    expect(
      setup,
      'Only smoke-managed.sh proves the issuer can send, and that script does not\n' +
        'run without --with-demo. A real deployment would configure mail and never\n' +
        'find out whether it works.',
    ).toMatch(/_test/);
    expect(setup).toMatch(/messages_count/);
  });

  it('only sends a test when the relay is the catcher, and the catcher answers', () => {
    // A test send is a REAL email. Against a production relay this would mail
    // somebody on every `--only app`, which a setup script may not do uninvited
    // — and the second condition is what stops a real relay that happens to be
    // named `mailpit` from being mistaken for one.
    expect(setup).toMatch(/\[ "\$SMTP_RELAY" = "mailpit" \] &&/);
    expect(setup).toMatch(/api\/v1\/messages/);
  });

  it('tests on the endpoint the server IMPLEMENTS, not the one it advertises', () => {
    /**
     * Three attempts, on the same three lines, and the third is the one the
     * server actually answers:
     *
     *   /email/{id}/_test        → HTTP 404, that is the activate shape
     *   /email/smtp/{id}/_test   → HTTP 501, code 12 UNIMPLEMENTED
     *   /smtp/{id}/_test         → implemented
     *
     * v4.17.1's proto declares `TestEmailProviderSMTPById` and says to prefer
     * it over the deprecated one. `internal/api/grpc/admin/smtp.go` at that tag
     * implements exactly two test verbs — `TestSMTPConfigById` and
     * `TestSMTPConfig` — and both are on the deprecated paths.
     *
     * DEPRECATED IS NOT ABSENT, AND DECLARED IS NOT IMPLEMENTED. The proto is
     * an interface; only the Go says what exists.
     */
    expect(
      setup,
      'the test send moved off /admin/v1/smtp/{id}/_test. The modern\n' +
        '/email/smtp/{id}/_test is declared in the proto and NOT implemented in\n' +
        'v4.17.1 — it answers 501. Re-check the Go before changing this back.',
    ).toMatch(/\/admin\/v1\/smtp\/\$\{SMTP_ID\}\/_test/);
    // The CONFIG verbs stay modern, because those ARE implemented.
    expect(setup).toMatch(/\/admin\/v1\/email\/smtp\b/);
    expect(setup).toMatch(/\/admin\/v1\/email\/\$\{SMTP_ID\}\/_activate/);
  });

  it('never lets a mail check take down the bring-up', () => {
    // `api` dies on any non-2xx, so an unguarded call here exits the script
    // MID-PHASE — before `up -d --build` has built api and web, which is what
    // phase_app exists to do. A check on the mail channel took down the whole
    // deployment: a healthcheck killing the service it watches. Delivery is
    // REPORTED here and asserted in the smoke, where failing is the job.
    // Bounded by CODE at both ends. The first version ended the slice at the
    // `# ---- letting people in ----` section header, which `directives()`
    // strips — so indexOf returned -1, the slice ran to end of file, and the
    // rule read every `die` in the script. It failed for a reason that had
    // nothing to do with what it guards.
    const from = setup.indexOf('sending one test message');
    // The end anchor is the first line of the NEXT section, and it moved once
    // already: the login-version block (#566) landed between the mail block and
    // the registration policy, and its `die` — which is correct, choosing the
    // login page is this script's job — failed this rule. A window that ends at
    // the next-but-one section reads code it does not guard.
    const to = setup.indexOf('checking which login page');
    expect(from, 'the test-send block moved or was renamed').toBeGreaterThan(-1);
    expect(to, 'the anchor after it moved or was renamed').toBeGreaterThan(from);
    const upTo = setup.slice(from, to);
    expect(
      upTo,
      'the mail verification calls `die`, which aborts phase_app before api and\n' +
        'web are built. Report it here; assert it in smoke-managed.sh.',
    ).not.toMatch(/\bdie\b/);
    expect(upTo, 'the test send is not guarded against a refusal').toMatch(/if ! probe_out=/);
  });

  it('says "configured, not proved" rather than skipping in silence', () => {
    // Two different claims. Reporting the weaker one as the stronger is how a
    // stack ends up trusted for something nobody measured.
    expect(setup).toMatch(/configured, not proved/);
  });
});

describe('the catcher is not readable from the internet', () => {
  const compose = parse(readFileSync(join(COMPOSE, 'managed.yml'), 'utf8')) as {
    services: Record<string, { ports?: string[] }>;
  };

  /**
   * THE RULE IS ABOUT THE DEFAULT, NOT ABOUT LOOPBACK.
   *
   * It said `^127.0.0.1:` and meant "nobody gets this by accident". Those are
   * not the same sentence, and the difference showed up the first time somebody
   * wanted the catcher on their laptop without a tunnel every time (owner,
   * 2026-08-25).
   *
   * A private mesh address is not `0.0.0.0`. On WireGuard — NetBird, Tailscale
   * — the peer address is reachable only by devices holding a key for it, which
   * is an authentication boundary this container does not have to provide
   * itself. Forbidding that outright bought no safety and cost a tunnel.
   *
   * SO THE BIND IS A SETTING WHOSE DEFAULT IS LOOPBACK, and this checks exactly
   * that: an operator has to say a different address out loud, in their own
   * `.env`, and nobody who says nothing is exposed. Both ways of getting it
   * wrong are still refused — `0.0.0.0`, and a variable with no default, which
   * is the same mistake by omission.
   */
  const LOOPBACK_DEFAULT = /^(127\.0\.0\.1|\$\{[A-Z_][A-Z0-9_]*:-127\.0\.0\.1\}):/;

  it('publishes mailpit on loopback unless somebody says otherwise', () => {
    const ports = compose.services.mailpit?.ports ?? [];
    expect(ports.length, 'mailpit publishes no port at all').toBeGreaterThan(0);
    for (const p of ports) {
      expect(
        p,
        `mailpit publishes ${p}. It has no authentication and it holds every\n` +
          'verification link, email-change confirmation and password reset this\n' +
          'stack sends — on a box with a public name that is an account-takeover\n' +
          'primitive, so the DEFAULT has to be loopback and the exception has to\n' +
          'be typed out.\n\n' +
          'Write it as "${MAILPIT_BIND:-127.0.0.1}:…" — a variable WITH the\n' +
          'loopback default. A bare "${MAILPIT_BIND}" exposes every deployment\n' +
          'that never set it.',
      ).toMatch(LOOPBACK_DEFAULT);
      expect(
        p,
        `mailpit publishes ${p}, which is every interface — see above. A private\n` +
          'mesh address (NetBird, Tailscale) is a legitimate value for\n' +
          'MAILPIT_BIND; 0.0.0.0 is not, because "who can route to this box" is\n' +
          'not an authentication boundary.',
      ).not.toMatch(/0\.0\.0\.0|\[::\]/);
    }
  });
});

describe('and it still has what it caught tomorrow', () => {
  const compose = parse(readFileSync(join(COMPOSE, 'managed.yml'), 'utf8')) as {
    services: Record<
      string,
      { environment?: Record<string, string>; volumes?: string[] }
    >;
    volumes?: Record<string, unknown>;
  };
  const mailpit = compose.services.mailpit ?? {};
  const env = mailpit.environment ?? {};

  /**
   * A CATCHER THAT FORGETS IS A CATCHER THAT NEVER CAUGHT.
   *
   * Mailpit holds messages in memory unless it is told otherwise, so the whole
   * store dies with the container — and the container dies for ordinary
   * reasons. Changing `MAILPIT_BIND` recreates it. So does a version bump, and
   * so does `up -d` after almost any edit to `managed.yml`. Somebody halfway
   * through a sign-up when that happens has no route back to the code they
   * were sent, and what they see is a stack whose mail is broken: the same
   * symptom this whole file exists to make impossible, arrived by a different
   * road.
   *
   * IT IS NOT ENOUGH FOR THE SETTING TO BE PRESENT. `MP_DATABASE=/tmp/x.db`
   * reads as persistence and is not: it is a path in the container's own
   * filesystem, which is the thing being thrown away. So the rule follows the
   * path to a mount and refuses one that does not land on a declared volume —
   * because that, not the variable, is what survives.
   */
  it('writes the mail somewhere that outlives the container', () => {
    const db = env.MP_DATABASE;
    expect(
      db,
      'mailpit has no MP_DATABASE, so it keeps every verification link,\n' +
        'email-change confirmation and password reset in memory and loses all\n' +
        'of them the next time the container is recreated — which changing\n' +
        'MAILPIT_BIND does, and so does `up -d` after most edits here.',
    ).toBeTruthy();

    const mounts = (mailpit.volumes ?? []).map((v) => {
      const [source, target] = v.split(':');
      return { source, target };
    });
    const onAVolume = mounts.find(
      (m) =>
        m.target &&
        (db === m.target || db.startsWith(`${m.target.replace(/\/$/, '')}/`)) &&
        compose.volumes?.[m.source] !== undefined,
    );
    expect(
      onAVolume,
      `mailpit stores its mail at ${db}, which is not inside any volume it\n` +
        `mounts (${mounts.map((m) => m.target).join(', ') || 'it mounts none'}).\n` +
        'That path lives in the container filesystem, so setting MP_DATABASE\n' +
        'bought nothing: the store still dies with the container. Mount a\n' +
        'named volume and put the database inside it.',
    ).toBeTruthy();
  });

  /**
   * AND A STORE THAT PERSISTS IS A STORE THAT GROWS.
   *
   * The cap above was written when this was an in-memory catcher, where an
   * unbounded store costs RAM and a restart clears it. On a volume it costs
   * disk and nothing clears it — which is precisely the shape of the two leaks
   * workplan 0099 was written about. So the two settings are tied together
   * here rather than left to be noticed later: persistence may not arrive
   * without the bound that makes it affordable.
   */
  it('does not let the store grow forever now that it is on a disk', () => {
    if (!env.MP_DATABASE) return;
    expect(
      env.MP_MAX_MESSAGES,
      'mailpit persists to MP_DATABASE with no MP_MAX_MESSAGES, so the store\n' +
        'grows without limit on a disk that nothing prunes. That is the third\n' +
        'disk leak on this box (workplan 0099). Cap it.',
    ).toBeTruthy();
    expect(
      Number(env.MP_MAX_MESSAGES),
      `MP_MAX_MESSAGES is ${env.MP_MAX_MESSAGES}, which is not a positive\n` +
        'number of messages. Mailpit reads it with strconv.Atoi and treats a\n' +
        'failed parse as 0 — unlimited — so a typo here silently removes the\n' +
        'bound rather than failing.',
    ).toBeGreaterThan(0);
  });
});
