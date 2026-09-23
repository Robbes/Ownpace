// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A grant link that could not work is never minted (workplan 0108 T3).
 *
 * The refusal is the whole point of this task, so it is tested as a decision
 * rather than through a server: every condition below would otherwise surface
 * as a Google error page in front of a person with no account, no session, and
 * no way to fix anything — which is exactly the support call the link exists to
 * remove.
 *
 * The route-shape assertions at the end are `operating-routes.unit.test.ts`'s
 * trick: importing the router is the cheapest thing that reproduces API
 * startup, and it also pins WHICH routes are guarded by a role, which is not
 * something the type system can check.
 */

import { describe, it, expect } from 'vitest';
import {
  GOOGLE_CONSENT_KIND_TO_SOURCE,
  awaitingGrantRefusal,
  grantLinkAsk,
  grantLinkRefusal,
  type GrantLinkDecision,
  type GrantLinkReadiness,
} from './grant-link-readiness.ts';
import { GOOGLE_SOURCE_SCOPES } from './google-consent.ts';
import { googleAccountConsent, isRefusal } from './google-account-consent.ts';
import router from './link-routes.ts';

/** A mapping that could be granted. Each test spoils exactly one thing. */
const READY: GrantLinkReadiness = {
  sourceKind: 'gmail',
  includedDomains: [],
  hasTarget: true,
  hasClientId: true,
  hasClientSecret: true,
  hasDeploymentClient: false,
  scopeClass: undefined,
  hasWebUrl: true,
};

/** A source that stores no client of its own, on a deployment that has one. */
const ON_THE_DEPLOYMENTS_CLIENT: GrantLinkReadiness = {
  ...READY,
  hasClientId: false,
  hasClientSecret: false,
  hasDeploymentClient: true,
};

/** The ask, or the test fails saying which refusal it got instead. */
function askOf(decided: GrantLinkDecision) {
  if (!decided.ok) throw new Error(`refused: ${decided.refusal.code} — ${decided.refusal.reason}`);
  return decided.ask;
}

describe('the ways a grant link is dead on arrival', () => {
  it('lets a fully configured Google source through', () => {
    expect(grantLinkRefusal(READY)).toBeNull();
  });

  it('refuses a mapping with no source connection', () => {
    const refusal = grantLinkRefusal({ ...READY, sourceKind: null });
    expect(refusal?.code).toBe('no_source_connection');
    expect(refusal?.reason).toMatch(/no source connection/i);
  });

  it('refuses a source that is not one of the four Google kinds', () => {
    const refusal = grantLinkRefusal({ ...READY, sourceKind: 'imap' });
    expect(refusal?.code).toBe('source_not_google');
    // Names the kind it actually got, so the owner is not left guessing which
    // of their migrations this was about.
    expect(refusal?.reason).toContain("'imap'");
  });

  it('refuses a migration with no destination, because the page must name it', () => {
    const refusal = grantLinkRefusal({ ...READY, hasTarget: false });
    expect(refusal?.code).toBe('no_target');
    // The remedy, and why it is one: the person asked is shown where it goes.
    expect(refusal?.reason).toMatch(/set the destination first/);
    expect(refusal?.reason).toMatch(/shown where their data will go/);
  });

  it('names WHICH credential field is missing, and never a value', () => {
    const noId = grantLinkRefusal({ ...READY, hasClientId: false });
    const noSecret = grantLinkRefusal({ ...READY, hasClientSecret: false });
    const neither = grantLinkRefusal({ ...READY, hasClientId: false, hasClientSecret: false });

    expect(noId?.code).toBe('client_not_configured');
    expect(noId?.reason).toContain('has no client id stored');
    expect(noSecret?.reason).toContain('has no client secret stored');
    expect(neither?.reason).toContain('has neither a client id nor a client secret stored');
    // The remedy, not just the diagnosis — every one of the three says where.
    for (const r of [noId, noSecret, neither]) {
      expect(r?.reason).toMatch(/source connection/);
    }
  });

  it('refuses when the deployment cannot say where its own web app lives', () => {
    const refusal = grantLinkRefusal({ ...READY, hasWebUrl: false });
    expect(refusal?.code).toBe('web_url_unset');
    expect(refusal?.reason).toContain('WEB_URL');
  });

  it('reports the mapping is problem before the deployment is', () => {
    // Both wrong at once. An owner can fix the source today; WEB_URL is
    // somebody else's restart, and leading with it would send them off to
    // their host over a migration that could not be granted anyway.
    const refusal = grantLinkRefusal({
      ...READY,
      sourceKind: 'imap',
      hasTarget: false,
      hasClientId: false,
      hasClientSecret: false,
      hasWebUrl: false,
    });
    expect(refusal?.code).toBe('source_not_google');
  });

  it('never puts a credential value in a refusal, because it never receives one', () => {
    // Structural, not a grep: the input type has no field that could hold one.
    // If someone widens it to take `clientSecret`, this stops compiling — which
    // is the point of the boolean signature.
    // `scopeClass` is the one string beside the kind, and it is a setting:
    // the value of GOOGLE_ACCOUNT_SCOPE_CLASS, never the environment it sits in.
    const keys = Object.keys(READY).sort();
    expect(keys).toEqual([
      'hasClientId',
      'hasClientSecret',
      'hasDeploymentClient',
      'hasTarget',
      'hasWebUrl',
      'includedDomains',
      'scopeClass',
      'sourceKind',
    ]);
  });
});

describe("the deployment's Google client, where the source stores none (0108 T6)", () => {
  it('asks through it for calendars and contacts', () => {
    for (const sourceKind of ['google_calendar', 'google_contacts']) {
      const ask = askOf(grantLinkAsk({ ...ON_THE_DEPLOYMENTS_CLIENT, sourceKind }));
      expect(ask.client, sourceKind).toBe('deployment');
    }
  });

  it("keeps the source's own whole pair ahead of the deployment's", () => {
    // ADR-0041: a customer's own application is a real choice, and a
    // deployment-wide default that quietly replaced it would take it away.
    const ask = askOf(grantLinkAsk({ ...READY, hasDeploymentClient: true }));
    expect(ask.client).toBe('connection');
  });

  it("refuses half a pair rather than finishing it with the deployment's other half", () => {
    const refusal = grantLinkRefusal({ ...READY, hasClientSecret: false, hasDeploymentClient: true });
    expect(refusal?.code).toBe('client_not_configured');
    expect(refusal?.reason).toContain('has no client secret stored');
  });

  it('names both ways out when there is no client anywhere', () => {
    const refusal = grantLinkRefusal({ ...ON_THE_DEPLOYMENTS_CLIENT, hasDeploymentClient: false });
    expect(refusal?.code).toBe('client_not_configured');
    expect(refusal?.reason).toMatch(/source connection/);
    expect(refusal?.reason).toMatch(/GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET/);
  });

  it('asks for mail and files through it only where the restricted class is declared', () => {
    for (const sourceKind of ['gmail', 'google_drive']) {
      const refusal = grantLinkRefusal({ ...ON_THE_DEPLOYMENTS_CLIENT, sourceKind });
      expect(refusal?.code, sourceKind).toBe('restricted_scope');
      // Both ways out, and the setting by name.
      expect(refusal?.reason).toMatch(/GOOGLE_ACCOUNT_SCOPE_CLASS/);
      expect(refusal?.reason).toMatch(/your own Google client on the source connection/);

      const declared = askOf(
        grantLinkAsk({ ...ON_THE_DEPLOYMENTS_CLIENT, sourceKind, scopeClass: 'restricted' }),
      );
      expect(declared.client, sourceKind).toBe('deployment');
      // A mistyped class is the narrow answer, as everywhere else it is read.
      expect(
        grantLinkRefusal({ ...ON_THE_DEPLOYMENTS_CLIENT, sourceKind, scopeClass: 'restricetd' })?.code,
      ).toBe('restricted_scope');
    }
  });

  it("leaves mail and files on the source's own client alone", () => {
    // The owner's own application asks what it registered; the declaration is
    // about THIS deployment's application, not theirs.
    for (const sourceKind of ['gmail', 'google_drive']) {
      expect(askOf(grantLinkAsk({ ...READY, sourceKind })).client, sourceKind).toBe('connection');
    }
  });
});

describe('what a single-purpose link asks for', () => {
  it('asks for its one scope and names its one data type', () => {
    const types = { gmail: 'email', google_calendar: 'calendar', google_contacts: 'contact', google_drive: 'file' };
    for (const [sourceKind, domain] of Object.entries(types)) {
      const ask = askOf(grantLinkAsk({ ...READY, sourceKind, includedDomains: ['task'] }));
      expect(ask.scope).toBe(GOOGLE_SOURCE_SCOPES[GOOGLE_CONSENT_KIND_TO_SOURCE[sourceKind]!]);
      // The migration's own rows do not widen a single-purpose ask.
      expect(ask.domains).toEqual([domain]);
    }
  });
});

describe('a link for a Google ACCOUNT (0108 T7)', () => {
  const ACCOUNT: GrantLinkReadiness = { ...READY, sourceKind: 'google', includedDomains: ['contact', 'calendar'] };

  it("asks for exactly the data types the migration copies, as the owner's own consent would", () => {
    const ask = askOf(grantLinkAsk(ACCOUNT));
    const owners = googleAccountConsent(['contact', 'calendar'], {});
    if (isRefusal(owners)) throw new Error(owners.reason);
    expect(ask.scope).toBe(owners.scope);
    expect(ask.domains).toEqual(['calendar', 'contact']);
  });

  it("asks through the deployment's client where the account stores none", () => {
    const ask = askOf(grantLinkAsk({ ...ACCOUNT, hasClientId: false, hasClientSecret: false, hasDeploymentClient: true }));
    expect(ask.client).toBe('deployment');
  });

  it("refuses mail on a deployment that has not declared the class, in the account consent's words", () => {
    const refusal = grantLinkRefusal({ ...ACCOUNT, includedDomains: ['email', 'calendar'] });
    expect(refusal?.code).toBe('restricted_scope');
    const owners = googleAccountConsent(['email', 'calendar'], {});
    expect(isRefusal(owners) && refusal?.reason).toBe(isRefusal(owners) && owners.reason);
  });

  it('asks for mail and files too where the class is declared', () => {
    const ask = askOf(
      grantLinkAsk({ ...ACCOUNT, includedDomains: ['email', 'file'], scopeClass: 'restricted' }),
    );
    expect(ask.scope.split(' ')).toEqual(
      expect.arrayContaining([GOOGLE_SOURCE_SCOPES.gmail, GOOGLE_SOURCE_SCOPES['google-drive']]),
    );
  });

  it('refuses a migration that copies nothing, rather than asking for a default', () => {
    const refusal = grantLinkRefusal({ ...ACCOUNT, includedDomains: [] });
    expect(refusal?.code).toBe('nothing_to_ask');
    expect(refusal?.reason).toMatch(/Include at least one/);
  });
});

describe('the Google kinds a link may be issued for', () => {
  it('maps every connection kind to a source type the consent flow knows', () => {
    // The two vocabularies drifting is the failure this table exists to stop:
    // a kind mapped to a source type with no scope would produce a consent URL
    // asking for `undefined`.
    for (const source of Object.values(GOOGLE_CONSENT_KIND_TO_SOURCE)) {
      expect(GOOGLE_SOURCE_SCOPES[source]).toBeTruthy();
    }
  });

  it('covers all four consent source types and nothing else', () => {
    expect(Object.values(GOOGLE_CONSENT_KIND_TO_SOURCE).sort()).toEqual(
      Object.keys(GOOGLE_SOURCE_SCOPES).sort(),
    );
  });

  it('accepts exactly the kinds in the table and the account, and refuses every other', () => {
    for (const kind of [...Object.keys(GOOGLE_CONSENT_KIND_TO_SOURCE), 'google']) {
      expect(grantLinkRefusal({ ...READY, sourceKind: kind, includedDomains: ['calendar'] })).toBeNull();
    }
    // The ones that transliterate but are not Google: proof the check is
    // membership rather than a string shape. `toString` is on every object.
    for (const kind of ['google_photos', 'imap', 'o365', 'jmap', 'dropbox', 'toString']) {
      expect(grantLinkRefusal({ ...READY, sourceKind: kind })?.code).toBe('source_not_google');
    }
  });
});

describe('a migration waiting on somebody’s grant may not start', () => {
  const google = { sourceKind: 'gmail', hasRefreshToken: false, hasServiceAccountKey: false };

  it('refuses a Google source with no way in at all', () => {
    const refusal = awaitingGrantRefusal(google);
    // The refusal is where an owner learns the feature exists at the moment
    // they need it, so it names the remedy rather than the deficiency.
    expect(refusal).toMatch(/grant link/);
    expect(refusal).toMatch(/their password never reaches you or us/);
  });

  it('lets it start once the grant has landed', () => {
    expect(awaitingGrantRefusal({ ...google, hasRefreshToken: true })).toBeNull();
  });

  it('accepts a service-account key as the other legitimate way in', () => {
    // What is refused is having NO way in, never a particular way in. An
    // account the customer administers can be connected without a person.
    expect(awaitingGrantRefusal({ ...google, hasServiceAccountKey: true })).toBeNull();
  });

  it('says nothing about sources that do not consent through Google', () => {
    for (const kind of ['imap', 'o365', 'jmap', 'nextcloud', null]) {
      expect(awaitingGrantRefusal({ ...google, sourceKind: kind })).toBeNull();
    }
  });

  it('applies to every Google kind, not only Gmail — the account too', () => {
    for (const kind of [...Object.keys(GOOGLE_CONSENT_KIND_TO_SOURCE), 'google']) {
      expect(awaitingGrantRefusal({ ...google, sourceKind: kind }), kind).toBeTruthy();
    }
  });
});

interface Layer {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string }> };
}

function routes(): Array<{ method: string; path: string; handlers: string[] }> {
  const stack = (router as unknown as { stack: Layer[] }).stack;
  return stack
    .filter((l): l is Required<Layer> => Boolean(l.route))
    .flatMap((l) =>
      Object.keys(l.route.methods).map((m) => ({
        method: m.toUpperCase(),
        path: l.route.path,
        handlers: l.route.stack.map((h) => h.name),
      })),
    );
}

describe('the owner surface the router registers', () => {
  it('registers without throwing — i.e. the API can still start', () => {
    expect(routes().length).toBeGreaterThan(0);
  });

  it('serves exactly issue, list and revoke', () => {
    expect(routes().map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'DELETE /:mappingId/links/:linkId',
      'GET /:mappingId/links',
      'POST /:mappingId/links',
    ]);
  });

  it('guards the two WRITES with a role, and lets any member read the list', () => {
    // Handing out access is an owner's decision. SEEING that a door exists is
    // not being able to open it, so the read is not role-gated — a colleague
    // chasing a stalled migration needs that answer.
    const byKey = new Map(routes().map((r) => [`${r.method} ${r.path}`, r.handlers]));
    for (const write of ['POST /:mappingId/links', 'DELETE /:mappingId/links/:linkId']) {
      expect(byKey.get(write), write).toContain('authenticate');
      // `requireRole(...)` returns an anonymous arrow, so it is identified by
      // position rather than by name: authenticate, the role gate, the handler.
      expect(byKey.get(write)?.length, `${write} should be authenticate + role + handler`).toBe(3);
    }
    expect(byKey.get('GET /:mappingId/links')).toContain('authenticate');
    expect(byKey.get('GET /:mappingId/links')?.length).toBe(2);
  });
});
