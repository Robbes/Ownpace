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

  it('uses the endpoint this version has, not the deprecated one', () => {
    // v4.17.1's admin.proto marks the whole `/smtp` family `deprecated: true`
    // in favour of the email-provider endpoints. Checked against the proto for
    // the pinned tag rather than remembered.
    const calls = [...setup.matchAll(/\/admin\/v1\/(email\/smtp|smtp)\b/g)].map((m) => m[1]);
    expect(calls.length, 'no SMTP endpoint is called at all').toBeGreaterThan(0);
    expect(
      calls.filter((c) => c === 'smtp'),
      'the deprecated /admin/v1/smtp endpoints are used; v4 wants /admin/v1/email/smtp',
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
    expect(smoke).toMatch(/\/admin\/v1\/email\/smtp\/\$\{smtp_id\}\/_test/);
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
