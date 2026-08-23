// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The identity provider is actually part of the managed gate (workplan 0099).
 *
 * ## What this is guarding against, which already happened
 *
 * `zitadel` went into `managed.yml` in #496. It was never added to the list of
 * services `bootstrap-managed.sh` starts — that list is explicit, so that a
 * bare `up -d` cannot publish Nextcloud's `change-me` admin panel — and nothing
 * ever invoked `setup-zitadel.sh`, which is documented as a step a person runs
 * by hand.
 *
 * The result held for three weeks: the identity provider was DEFINED, its
 * secrets were REQUIRED by every compose command (which is how E2E (managed)
 * #34–#36 died), and it was never started and never configured. The nightly was
 * green and said nothing whatsoever about whether anybody could sign in.
 *
 * Two hand-maintained lists, neither checked against anything. Same shape as
 * `MOUNTS` (0096), the `pull_request` trigger filters (0097) and the pre-flight
 * env list (0098) — so it gets the same treatment.
 *
 * ## And the three answers
 *
 * The smoke has to exercise accept, decline AND skip, and skip is the one a
 * later edit is most likely to "fix" into a request. It is asserted as an
 * absence: no call is made for the third invitation, and the assertion is that
 * it is still open and still offered afterwards.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMPOSE = fileURLToPath(new URL('../deploy/compose/', import.meta.url));
const read = (name: string): string => readFileSync(COMPOSE + name, 'utf8');

const bootstrap = read('bootstrap-managed.sh');
const smoke = read('smoke-managed.sh');
const managed = read('managed.yml');

describe('the gate starts and configures the identity provider', () => {
  it('read the real scripts', () => {
    // Vacuity guard: every assertion below passes against an empty string.
    expect(bootstrap.length).toBeGreaterThan(2000);
    expect(smoke.length).toBeGreaterThan(2000);
    expect(managed).toContain('zitadel:');
  });

  it('names zitadel in the explicit service list, not just in managed.yml', () => {
    // The list is explicit on purpose (a bare `up -d` would publish the demo
    // Nextcloud's default admin password), which is exactly why a service can
    // be in the compose file and never start.
    // To the closing paren ON ITS OWN LINE. A non-greedy match to the first `)`
    // stops inside the comment above `zitadel`, which cites (ADR-0042) — and
    // then this test passes or fails on punctuation rather than on the list.
    const list = /local services=\(([\s\S]*?)\n\s*\)/.exec(bootstrap)?.[1] ?? '';
    expect(list, 'bootstrap-managed.sh must START the identity provider').toMatch(
      /^[ \t]*zitadel[ \t]*$/m,
    );
  });

  it('runs setup-zitadel.sh, because starting it is not configuring it', () => {
    // It creates the project and the public PKCE client and writes JWT_ISSUER.
    // Without it the container is up and the stack authenticates nobody.
    expect(bootstrap).toMatch(/\$\{SCRIPT_DIR\}\/setup-zitadel\.sh/);
  });
});

describe('the smoke can tell a configured issuer from a running container', () => {
  it('reads JWT_ISSUER from the API container rather than from .env', () => {
    // What the running service verifies against. A file on the host is at best
    // a claim about that, and this gate exists because a claim was wrong.
    expect(smoke).toMatch(/docker exec "\$API_CONTAINER" printenv JWT_ISSUER/);
  });

  it('fetches the discovery document and the keys, and FAILS on either', () => {
    expect(smoke).toContain('/.well-known/openid-configuration');
    expect(smoke).toContain('jwks_uri');
    // Not an echo. The whole class of bug here is a check that reports and does
    // not change the verdict — run #6's green said "SKIPPED" and "SMOKE PASS"
    // three lines apart.
    const section = smoke.slice(smoke.indexOf('note "identity provider"'));
    expect(section.slice(0, section.indexOf('note "an invitation'))).toContain('fail=1');
  });

  it('checks the issuer declares its own name, byte for byte', () => {
    // OIDC Discovery §4.3, and the rule both `oidc.ts` and `auth.ts` enforce: a
    // document naming a different issuer is not this issuer.
    expect(smoke).toMatch(/DECLARED/);
    expect(smoke).toContain('declares');
  });
});

describe('the smoke answers an invitation three ways', () => {
  const section = smoke.slice(smoke.indexOf('note "an invitation, answered three ways"'));

  it('accepts one and declines another, over real HTTP', () => {
    expect(section).toMatch(/\/api\/invitations\/\$\{T1\}\/accept/);
    expect(section).toMatch(/\/api\/invitations\/\$\{T2\}\/decline/);
  });

  it('SKIPS the third by making no request at all', () => {
    // The assertion that matters, and the one a later edit would break by
    // "finishing" the pattern. Skipping is the absence of a call; if T3 ever
    // appears in a request URL, skip has stopped being skip.
    expect(section, 'the skipped invitation must never be POSTed to').not.toMatch(
      /\/api\/invitations\/\$\{T3\}\//,
    );
    expect(section, 'and it must be asserted still open').toMatch(/s3.*=.*'invited'|'invited'/);
  });

  it('asserts a refusal names nobody', () => {
    // Migration 0008's WITH CHECK guarantees it; this is the end-to-end reading
    // of that guarantee, and it is the difference between a refusal and a
    // permanent record of who refused.
    expect(section).toContain('pending:*)');
    expect(section).toMatch(/declining BOUND the decliner/);
  });

  it('cleans up the rows it wrote', () => {
    // The gate runs nightly against a long-lived stack. A smoke that leaves
    // rows behind grows the thing it is measuring — 0084's fixture lesson.
    expect(section).toMatch(/DELETE FROM tenant_member WHERE tenant_id=/);
    expect(section).toMatch(/DELETE FROM tenant WHERE id=/);
  });
});
