// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DECLARATION THE SERVER HONOURED AND THE SCREEN COULD NOT SEE.
 *
 * `GOOGLE_ACCOUNT_SCOPE_CLASS` landed on 2026-09-01 (ADR-0041, owner decision
 * of that day): a deployment whose own Google application carries the
 * restricted scopes may ask one account consent for all four faces. The API
 * honoured it within the hour. The wizard did not, and could not — it read
 * `PROVIDER_ACCOUNT_DOMAINS`, a constant compiled into the browser bundle long
 * before anybody set the variable.
 *
 * The result was the worst version of a half-built feature: a consent route
 * willing to ask for four scopes, a screen offering two ticks, and a create
 * door refusing the other two. The only way to reach what had been declared
 * was to POST the domains by hand. A capability nobody can reach from the
 * screen that exists for it is not a capability.
 *
 * ## The two shapes this pins, because both have cost a day here
 *
 * **The variable nothing forwards.** `docker compose` passes nothing to a
 * service that does not name it. `TRIGGER_ENCRYPTION_KEY` and
 * `DEPLOY_IMAGE_PLATFORM` both cost a live afternoon for exactly that, and
 * `a-scope-class-the-product-does-not-decide.unit.test.ts` already pins the
 * API's half.
 *
 * **The second copy of one fact.** The obvious fix was a `VITE_` mirror, and
 * it would have compiled: set the variable twice, once for the API and once
 * for the build. That is two separately settable copies of one fact, which is
 * how a client comes to offer what the server refuses — and the reverse, which
 * is worse: a consent asking for scopes no mapping can carry, discovered weeks
 * later by somebody whose mail was never in the grant.
 *
 * So: the deployment answers ONCE, on the server, and the client ASKS. What is
 * checked here is that the route exists, that the client asks it, and that no
 * `VITE_` twin has appeared beside it.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY. A test in `scripts/` cannot
 * import `@openmig/shared` — the workspace aliases are not a substitute for a
 * declared dependency (AGENTS.md). The BEHAVIOUR halves live beside their code:
 * `apps/api/src/routes/provider-accounts.unit.test.ts` for what the route
 * answers, `packages/shared/src/target-domains.unit.test.ts` for what the
 * matrix does with it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

const ROUTE = 'apps/api/src/routes/provider-accounts.ts';
const WIZARD = 'apps/web/src/pages/CreateMapping.tsx';

describe('the deployment answers once, and the screen asks', () => {
  it('the API mounts a route that says what an account may serve here', () => {
    const index = read('apps/api/src/index.ts');
    expect(index, 'nothing serves the declaration to a client').toContain(
      "app.use('/api/provider-accounts'",
    );
    // And it is built from the kinds table, not from a list written twice.
    expect(read(ROUTE)).toContain('PROVIDER_ACCOUNT_KINDS');
    expect(read(ROUTE), 'the route ignores the declaration').toContain('providerAccountDomains');
  });

  it('the wizard asks it rather than compiling the answer in', () => {
    const wizard = read(WIZARD);
    expect(wizard, 'the wizard does not fetch the deployment’s answer').toContain(
      'providerAccountsApi',
    );
    // The three places that decide what a person may tick, all reading the
    // fetched list. A missed one is not a crash — it is a screen that offers
    // what the next screen refuses.
    expect(wizard, 'the domain step still uses the compiled-in ceiling').toContain(
      'sourceTypeDomains(formData.sourceType, googleAccountDomains)',
    );
    expect(wizard, 'the account card still ticks the compiled-in faces').toContain(
      'domains: [...googleAccountDomains]',
    );
    expect(
      (wizard.match(/sourceDomainRefusal\([^)]*googleAccountDomains/g) ?? []).length,
      'a sourceDomainRefusal call is deciding without the deployment’s answer',
    ).toBe(2);
  });

  it('has no VITE_ twin of the declaration', () => {
    // The fix that would have compiled, and the reason it was not taken. One
    // fact, one place: the variable is the API's, and the client asks.
    for (const rel of [WIZARD, 'apps/web/src/services/mapping-service.ts']) {
      expect(
        read(rel),
        `${rel} reads a VITE_ mirror of the scope class — two settable copies of one fact`,
      ).not.toMatch(/VITE_[A-Z_]*SCOPE_CLASS/);
    }
    expect(
      read('deploy/compose/managed.yml'),
      'the web build is being handed the scope class as well as the API',
    ).not.toMatch(/VITE_[A-Z_]*SCOPE_CLASS/);
  });

  it('the create door refuses against the same answer the screen offered', () => {
    // The other half of one contract (ADR-0026): the wizard constrains the
    // choice as it is made and the API refuses it verbatim for any other
    // client. A create door still reading the constant would refuse exactly
    // the ticks the screen had just offered.
    const create = read('apps/api/src/routes/migrations/index.ts');
    expect(create).toContain("providerAccountDomains('google')");
  });

  it('and the falls-back-narrow default is still there', () => {
    // Every failure falls back to the answer that cannot over-ask: an
    // unreachable route, an unrecognised shape, a request in flight. Written
    // out here because it is the property that makes the fetch safe to add at
    // all — a wizard that offered four ticks while the request was pending
    // would refuse them at the create door a minute later.
    expect(read(WIZARD)).toContain(
      'accountDomainsByKind?.google ?? PROVIDER_ACCOUNT_DOMAINS.google',
    );
  });
});
