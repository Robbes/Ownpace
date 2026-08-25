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

  it('binds mailpit to loopback', () => {
    const ports = compose.services.mailpit?.ports ?? [];
    expect(ports.length, 'mailpit publishes no port at all').toBeGreaterThan(0);
    for (const p of ports) {
      expect(
        p,
        `mailpit publishes ${p}, which is every interface. It has no authentication\n` +
          'and it holds every verification link and password reset this stack sends —\n' +
          'on a box with a public name that is an account-takeover primitive.\n' +
          'Reach it through an SSH tunnel instead.',
      ).toMatch(/^127\.0\.0\.1:/);
    }
  });
});
