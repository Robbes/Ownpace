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
 * ## The same family, found again the same evening
 *
 * `POST /api/migrations/google/authorize` has always answered with
 * `redirectUri` — the exact string Google matches against the client's
 * registered list — and its own client doc says it is returned "so a mismatch
 * is shown before Google shows it". The wizard destructured `{ url }` and threw
 * the other half away.
 *
 * So the owner met `Fout 400: redirect_uri_mismatch`, which says a string did
 * not match and does not say what the string was, and finding the right one
 * meant reading a route's source. Computed, returned, never rendered: the same
 * shape as the ceiling above, one field instead of one env var.
 *
 * WHERE IT IS PINNED NOW. The wizard held both halves until it retired
 * (0153 D5). *Start a migration* reads the deployment's answer for what
 * each Google card carries (`StartMigration.tsx`, `start-plan.ts`), and the
 * consent both doors draw (`components/ProviderConsent.tsx`) reads it for
 * what it asks Google for, and keeps and shows the redirect address. The
 * properties below are the wizard's, asked of the files that hold them now.
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
const FLOW = 'apps/web/src/pages/StartMigration.tsx';
const PLAN = 'apps/web/src/services/start-plan.ts';
const CONSENT = 'apps/web/src/components/ProviderConsent.tsx';

describe('the deployment answers once, and the screen asks', () => {
  it('the API mounts a route that says what an account may serve here', () => {
    const index = read('apps/api/src/index.ts');
    expect(index, 'nothing serves the declaration to a client').toContain(
      "app.use('/api/provider-accounts'",
    );
    // And it is built from the kinds table, not from a list written twice.
    expect(read(ROUTE)).toContain('PROVIDER_ACCOUNT_KINDS');
    // Through shared's one answer per kind — which is where the declaration
    // is read, so the route cannot ignore it without shared ignoring it too.
    expect(read(ROUTE), 'the route ignores the declaration').toContain('providerAccountFacts');
    expect(
      read('packages/shared/src/provider-accounts.ts'),
      'providerAccountFacts no longer reads the declared ceiling',
    ).toMatch(/providerAccountFacts[\s\S]*providerAccountDomains\(kind, env\)/);
  });

  it('Start a migration asks it rather than compiling the answer in', () => {
    const flow = read(FLOW);
    expect(flow, 'the flow does not fetch the deployment’s answer').toContain('providerAccountsApi');
    expect(flow, 'the flow fetches the answer and then does not use it').toContain(
      'facts.google = providerAccounts.google.domains',
    );
    // The two places that decide what a sign-in carries, both reading the
    // fetched list: which Google card carries a ticked type, and which faces
    // the consent asks Google for. A missed one is not a crash — it is a
    // screen that offers what the next screen refuses.
    expect(read(PLAN), 'which card carries a type is decided by the compiled-in ceiling').toContain(
      '(served.google ?? PROVIDER_ACCOUNT_DOMAINS.google).includes(type)',
    );
    expect(read(CONSENT), 'the consent asks for the compiled-in faces').toContain(
      'providerAccounts?.[type]?.domains ?? PROVIDER_ACCOUNT_DOMAINS[type as ProviderAccountKind]',
    );
  });

  it('has no VITE_ twin of the declaration', () => {
    // The fix that would have compiled, and the reason it was not taken. One
    // fact, one place: the variable is the API's, and the client asks.
    for (const rel of [FLOW, PLAN, CONSENT, 'apps/web/src/services/mapping-service.ts']) {
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
    // The other half of one contract (ADR-0026): the screen constrains the
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
    // all — a screen that offered four faces while the request was pending
    // would be refused them at the create door a minute later. The flow's
    // facts stay empty until the answer is in, so the plan reads the default.
    expect(read(FLOW)).toContain('if (providerAccounts?.google) facts.google =');
    expect(read(PLAN)).toContain('served.google ?? PROVIDER_ACCOUNT_DOMAINS.google');
    expect(read(CONSENT)).toContain('?? PROVIDER_ACCOUNT_DOMAINS[type as ProviderAccountKind]');
  });
});

describe('the second fact the screen could not see (ADR-0041, owner decision 2026-09-01)', () => {
  // The same shape a day later: the server accepted a consent and a create
  // without a client id and secret once GOOGLE_OAUTH_CLIENT_* was set, and
  // the wizard went on demanding both. Same rule; since Connect with Dropbox
  // (2026-09-02) the fact has a route of its own, one answer per provider,
  // because Dropbox has no account kind for its answer to ride on.
  it('the answer carries where each application comes from, and the consent reads it', () => {
    // The facts were two inline ternaries until workplan 0114 made them a
    // probe table over `GRANT_PROVIDERS` — a hand-written object per provider
    // is the fan-out family in its quietest form, and Microsoft's absence
    // from it was live on the branch that added Microsoft. What is pinned is
    // the PROPERTY, one provider wider: each provider's answer comes from its
    // own deployment-client module, and the list is what the answer is built
    // from. `scripts/a-consent-nobody-can-answer.unit.test.ts` pairs that
    // list against the descriptors and the browser's schema.
    const clients = read('packages/shared/src/provider-clients.ts');
    for (const probe of [
      'googleDeploymentClient(env) !== null',
      'dropboxDeploymentClient(env) !== null',
      'microsoftDeploymentClient(env) !== null',
    ]) {
      expect(clients, `provider-clients.ts no longer probes with ${probe}`).toContain(probe);
    }
    expect(clients).toContain("DEPLOYMENT_CLIENTS[provider](env) ? 'deployment' : 'connection'");
    expect(read('apps/api/src/index.ts')).toContain("app.use('/api/provider-clients'");
    expect(read('apps/web/src/services/mapping-service.ts')).toContain('google: CLIENT_SOURCE');
    // Compared against 'deployment', never against 'connection': an absent,
    // unparsable or still-pending answer must keep demanding the pair. And
    // indexed by the provider the source's descriptor names — a Google
    // client is not a Dropbox app.
    //
    // TWO READERS, NOT THREE (2026-09-08). The Connections page had its own
    // copy of this until the rotate panel needed the same consent and got a
    // shared module instead of a third copy — so the file to grep for the
    // page's half is `components/ProviderConsent.tsx`, which the add form and
    // Replace credentials both import. The PROPERTY is unchanged and is what
    // this asserts; only the file holding it moved. ONE READER since the
    // wizard's copy retired with it (0153 D5): both doors draw this module.
    for (const rel of [CONSENT]) {
      expect(read(rel), `${rel} does not ask which applications the deployment carries`).toContain(
        'providerClientsApi',
      );
      // The SHAPE, not a local variable's name: indexed by whatever the file
      // calls the provider its descriptor named, and compared against
      // 'deployment'. The module says `provider`; pinning that spelling here
      // would fail the next rename while the property held.
      expect(
        read(rel),
        `${rel} no longer indexes the answer by provider, or no longer compares against ` +
          "'deployment' — an absent, unparsable or still-pending answer must keep demanding " +
          'the pair, which comparing against \'connection\' would not do',
      ).toMatch(/providerClients\?\.\[\w+\] === 'deployment'/);
    }
    // And the page reaches it, rather than having quietly grown a copy back.
    expect(
      read('apps/web/src/pages/Connections.tsx'),
      'Connections.tsx no longer goes through the shared consent — if it has its own ' +
        'deployment-client question again, that is the second copy this module exists to prevent',
    ).toContain('useProviderConsent');
  });

  it('the pair travels whole or not at all — never as empty strings', () => {
    // The authorize routes' schemas are `.min(1).optional()`: an empty string
    // is refused, an absent key means "the deployment's". A door that sent
    // `clientId: ''` would be refused by the very route that no longer needs
    // the value. One pair for every provider's consent.
    const module = read(CONSENT);
    const consent = module.slice(module.indexOf('const beginConsent'));
    // The page's language rides beside the pair since workplan 0145 T6, so
    // the ending after the provider is in it; the pair itself is still
    // spread whole, never rebuilt field by field.
    expect(consent).toContain('mappingApi.dropboxAuthorize({ ...ownPair, locale })');
    expect(consent).toContain('...ownPair');
    expect(consent.slice(0, consent.indexOf('const begin ='))).not.toMatch(/clientId:/);
  });
});

describe('a fact the server computed and the screen must show', () => {
  it('the consent KEEPS the redirect address, instead of destructuring past it', () => {
    // `const { url } = await mappingApi.googleAuthorize(…)` is what was there,
    // and it is what a later edit would most naturally write back — the URL is
    // the thing you obviously need, and the other field is the one you need
    // only when it has already gone wrong.
    const consent = read(CONSENT);
    // EVERY provider's answer lands in the same destructuring. This pinned the
    // `dropbox ? … : google…` chain verbatim until workplan 0114 turned it
    // into a per-provider table — a two-way condition meeting a third provider
    // takes its else branch and asks the wrong company. So what is pinned now
    // is the PROPERTY rather than the shape: one destructuring, naming both
    // fields, over whatever the table returned.
    expect(consent, 'the authorize answer is being destructured without its redirect').toMatch(
      /const \{ url, redirectUri \} = await begin\(\)/,
    );
    expect(consent, 'kept but never stored').toContain('setRedirect(');
    // And every row of that table must be able to answer with one: a provider
    // whose ask drops `redirectUri` re-creates the original defect for itself
    // alone, which is harder to notice than the version that broke for
    // everybody.
    expect(consent).toMatch(/beginConsent: Record<string, \(\) => Promise<\{ url: string; redirectUri\?: string \}>>/);
  });

  it('and RENDERS it, because a value in state nobody can read is the same defect', () => {
    const consent = read(CONSENT);
    // In the provider's own words: `words` reads `wizard.<provider>.redirectUri`.
    expect(consent).toContain("words('redirectUri')");
    expect(consent, 'the address itself, not only the label').toContain('{consent.redirect}');
  });

  it('the sentence beside it tells somebody what to DO with the address', () => {
    // "Redirect URI: https://…" is a fact. What a person needs is the
    // instruction, because the address is useless until it is registered in
    // the right box of somebody else's console.
    const strings = read('apps/web/src/i18n/strings.ts');
    const at = strings.indexOf("'wizard.google.redirectUri':");
    expect(at, 'the string is gone').toBeGreaterThan(-1);
    const sentence = strings.slice(at, at + 400);
    expect(sentence).toContain('Register this exact address');
    expect(sentence, 'and where — Google calls it Authorised redirect URIs').toContain(
      'Authorised redirect URIs',
    );
    // Dropbox's sentence names Dropbox's box (App Console → OAuth 2).
    const dbx = strings.indexOf("'wizard.dropbox.redirectUri':");
    expect(dbx, 'the Dropbox string is gone').toBeGreaterThan(-1);
    const dbxSentence = strings.slice(dbx, dbx + 400);
    expect(dbxSentence).toContain('Register this exact address');
    expect(dbxSentence).toContain('Redirect URIs');
  });
});
