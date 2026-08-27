// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The create door accepts a Google ACCOUNT source (workplan 0106 T3b).
 *
 * The engine seams learned the kind in the previous slice; this is the door
 * that lets a row of that kind exist at all. Four things are worth pinning,
 * and each has a way of going wrong quietly:
 *
 *  1. **The kind it stores.** `sourceKindFor` is the forward direction of a
 *     round trip the Connections page depends on: looking a setup profile up
 *     by the WRONG kind answers `[]`, which renders as "this provider needs
 *     nothing set up in advance" rather than as an error. `google` is the one
 *     Google source whose wizard word and connection kind are the same word,
 *     so the round trip is asserted rather than assumed from that.
 *  2. **The config it stores.** One field, and deliberately one: a Google
 *     account serves its faces from one address, and a list of domains here
 *     would be a second copy of the ticks, free to disagree with them.
 *  3. **The scopes its refusal names.** With several Google sources sharing
 *     one OAuth client, "which consent is this" is the mistake waiting to
 *     happen — and for an account the answer is a SET. The sentence is built
 *     from the same function the consent screen uses, so the door demands what
 *     the consent asked for.
 *  4. **The faces it refuses.** Mail and files are not on this account kind,
 *     and the create API must say so in the same words the wizard does.
 */

import { describe, it, expect } from 'vitest';
import { CreateMappingSchema, sourceKindFor, sourceConnectionConfig } from './index.ts';
import { googleAccountScopeSentence } from './google-account-consent.ts';
import {
  parseMappingConfig,
  wizardTypeForConnectionKind,
  PROVIDER_ACCOUNT_DOMAINS,
} from '@openmig/shared';
import { GOOGLE_SCOPES_ASKED_BY_DOMAIN } from '@openmig/orchestration/account-qualification';

const GOOGLE_CREDS = {
  username: 'someone@example.invalid',
  clientId: 'client.apps.googleusercontent.com',
  clientSecret: 'a-test-value',
  refreshToken: '1//a-granted-refresh-token',
};

function body(over: Record<string, unknown> = {}) {
  return {
    name: 'a migration',
    sourceType: 'google',
    targetType: 'caldav',
    sourceConfig: { ...GOOGLE_CREDS },
    targetConfig: { host: 'dst.example.nl', port: 443, username: 'a@example.nl', password: 'x' },
    syncConfig: { domains: ['calendar'] },
    ...over,
  };
}

function refusalText(payload: Record<string, unknown>): string {
  const result = CreateMappingSchema.safeParse(payload);
  if (result.success) throw new Error('expected a refusal');
  return result.error.issues.map((i) => i.message).join(' ');
}

describe('the kind, and the round trip the Connections page needs', () => {
  it('stores the account kind, and it survives the trip back', () => {
    expect(sourceKindFor('google')).toBe('google');
    expect(wizardTypeForConnectionKind('google')).toBe('google');
  });

  it('leaves the four single-purpose kinds exactly as they were', () => {
    expect(sourceKindFor('gmail')).toBe('gmail');
    expect(sourceKindFor('google-calendar')).toBe('google_calendar');
    expect(sourceKindFor('google-contacts')).toBe('google_contacts');
    expect(sourceKindFor('google-drive')).toBe('google_drive');
  });
});

describe('the config it stores', () => {
  it('is the one address, and nothing about which faces', () => {
    const config = sourceConnectionConfig({
      sourceType: 'google',
      sourceConfig: GOOGLE_CREDS,
    } as never);
    expect(config).toEqual({ type: 'google', user: GOOGLE_CREDS.username });
  });

  it('never carries a credential into the config', () => {
    // The credentials go to the SecretStore; a config is echoed by the detail
    // route, so anything that leaked in here would be served back out.
    const config = sourceConnectionConfig({
      sourceType: 'google',
      sourceConfig: GOOGLE_CREDS,
    } as never);
    expect(JSON.stringify(config)).not.toContain(GOOGLE_CREDS.clientSecret);
    expect(JSON.stringify(config)).not.toContain(GOOGLE_CREDS.refreshToken);
  });

  it('round-trips through the SAME parser an appliance mapping file goes through', () => {
    // Hard rule 5: a config one edition stores must be one the other can read.
    // Until `google` joined the SourceConfig union, this threw
    // `source.type: unsupported "google"` on a config the managed door had
    // just written — the two editions disagreeing about a row one of them
    // created. Asserted through `parseMappingConfig`, the appliance's own
    // entry point, rather than through an internal.
    const config = sourceConnectionConfig({
      sourceType: 'google',
      sourceConfig: GOOGLE_CREDS,
    } as never);
    const parsed = parseMappingConfig({
      tenantId: 't',
      mappingId: 'm',
      source: config,
      target: {
        type: 'caldav',
        url: 'https://dav.example.invalid/',
        user: 'u',
        auth: { kind: 'login', passwordFromEnv: 'UNUSED_IN_THIS_TEST' },
      },
    });
    expect(parsed.source).toEqual({ type: 'google', user: GOOGLE_CREDS.username });
  });
});

describe('the refusal names the scopes of the faces ticked', () => {
  it('names both scopes when both faces are ticked', () => {
    const msg = refusalText(
      body({
        sourceConfig: { username: GOOGLE_CREDS.username, clientId: GOOGLE_CREDS.clientId },
        syncConfig: { domains: ['calendar', 'contact'] },
      }),
    );
    expect(msg).toContain(GOOGLE_SCOPES_ASKED_BY_DOMAIN.calendar);
    expect(msg).toContain(GOOGLE_SCOPES_ASKED_BY_DOMAIN.contact);
    expect(msg).toContain('clientSecret');
    expect(msg).toContain('refreshToken');
  });

  it('names only the scope of the one face ticked', () => {
    // Least privilege, visible in the error text: telling somebody their token
    // needs a calendar scope when they only ticked contacts sends them to
    // consent something nobody asked for.
    const msg = refusalText(
      body({
        sourceConfig: { username: GOOGLE_CREDS.username },
        syncConfig: { domains: ['contact'] },
      }),
    );
    expect(msg).toContain(GOOGLE_SCOPES_ASKED_BY_DOMAIN.contact);
    expect(msg).not.toContain(GOOGLE_SCOPES_ASKED_BY_DOMAIN.calendar);
  });

  it('is the SAME string the consent screen asks for', () => {
    // Two reports of one decision. The door demanding a scope the consent
    // never asked for is a person told to fix something they cannot.
    expect(googleAccountScopeSentence(['calendar', 'contact'])).toBe(
      [GOOGLE_SCOPES_ASKED_BY_DOMAIN.calendar, GOOGLE_SCOPES_ASKED_BY_DOMAIN.contact].join(' '),
    );
  });
});

describe('the faces this account kind does not serve', () => {
  it('refuses email, naming what the source can carry', () => {
    const msg = refusalText(
      body({ targetType: 'jmap', syncConfig: { domains: ['email'] } }),
    );
    expect(msg).toContain('Google');
    expect(msg).toContain("'email'");
  });

  it('refuses file the same way', () => {
    const msg = refusalText(
      body({ targetType: 'webdav', syncConfig: { domains: ['file'] } }),
    );
    expect(msg).toContain("'file'");
  });

  it('accepts exactly the faces the table names', () => {
    for (const domain of PROVIDER_ACCOUNT_DOMAINS.google) {
      const result = CreateMappingSchema.safeParse(
        body({
          targetType: domain === 'calendar' ? 'caldav' : 'carddav',
          syncConfig: { domains: [domain] },
        }),
      );
      expect(result.success, `${domain} should be accepted: ${JSON.stringify(result.error?.issues)}`).toBe(
        true,
      );
    }
  });
});
