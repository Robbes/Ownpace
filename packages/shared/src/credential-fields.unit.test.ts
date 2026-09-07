// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The credential field descriptor (workplan 0063). What these hold:
 *
 *  1. Every secret is MARKED. A field that should be masked and is not gets
 *     rendered in the clear and echoed into logs — the one mistake here that
 *     is not recoverable by editing a form.
 *  2. Providers are named in THEIR vocabulary, not ours: Dropbox's client id
 *     is an "App key", and the label key says so.
 *  3. An unknown type answers `[]` rather than a plausible-looking default,
 *     because a form with the wrong fields silently stores the wrong thing.
 */

import { describe, it, expect } from 'vitest';
import {
  connectableTypes,
  credentialFieldRequired,
  credentialFieldsFor,
  secretFieldKeys,
} from './credential-fields.ts';

describe('secrets', () => {
  it('marks every value that must never be rendered in the clear', () => {
    expect(secretFieldKeys('source', 'dropbox')).toEqual([
      'clientSecret',
      'refreshToken',
    ]);
    expect(secretFieldKeys('source', 'google-drive')).toContain('serviceAccountKey');
    expect(secretFieldKeys('target', 'jmap')).toEqual(['password']);
  });

  it('never marks an identifier as secret — masking a client id only hides typos', () => {
    for (const type of connectableTypes('source')) {
      expect(secretFieldKeys('source', type)).not.toContain('clientId');
      expect(secretFieldKeys('source', type)).not.toContain('username');
    }
  });
});

describe('the provider\'s own vocabulary', () => {
  it("calls Dropbox's client id an App key, because Dropbox does", () => {
    const appKey = credentialFieldsFor('source', 'dropbox').find((f) => f.key === 'clientId');
    expect(appKey?.labelKey).toBe('wizard.dropboxAppKey');
  });

  it("names whose consent mints each token, and pairs Dropbox's App key with its secret (2026-09-02)", () => {
    const dropbox = credentialFieldsFor('source', 'dropbox');
    expect(dropbox.find((f) => f.key === 'refreshToken')?.consent).toBe('dropbox');
    expect(dropbox.find((f) => f.key === 'clientId')).toMatchObject({ pairedWith: 'clientSecret' });
    expect(dropbox.find((f) => f.key === 'clientId')?.required).not.toBe(true);
    expect(dropbox.find((f) => f.key === 'clientSecret')?.required).toBe(false);
    for (const type of ['gmail', 'google-drive', 'google'] as const) {
      expect(credentialFieldsFor('source', type).find((f) => f.key === 'refreshToken')?.consent).toBe('google');
    }
    // Box mints no refresh token and names no consent.
    expect(credentialFieldsFor('source', 'box').some((f) => f.consent)).toBe(false);
  });

  it('asks Box for the numeric subject user id it needs', () => {
    const keys = credentialFieldsFor('source', 'box').map((f) => f.key);
    expect(keys).toContain('userId');
    // ...and never for a refresh token, which Box rotates (workplan 0056).
    expect(keys).not.toContain('refreshToken');
  });

  it('offers Google a pasted key file as a multiline alternative to the trio', () => {
    const key = credentialFieldsFor('source', 'gmail').find(
      (f) => f.key === 'serviceAccountKey',
    );
    expect(key?.multiline).toBe(true);
    // The trio is therefore NOT required — either flow is valid (ADR-0033).
    const trio = credentialFieldsFor('source', 'gmail').filter((f) =>
      ['clientId', 'clientSecret', 'refreshToken'].includes(f.key),
    );
    expect(trio.every((f) => !f.required)).toBe(true);
  });
});

describe('unknown types', () => {
  it('answer an empty list rather than a plausible default', () => {
    expect(credentialFieldsFor('source', 'not-a-provider')).toEqual([]);
    // A source type is not automatically a target type, and vice versa.
    expect(credentialFieldsFor('target', 'box')).toEqual([]);
    expect(credentialFieldsFor('source', 'jmap')).toEqual([]);
  });
});

describe('what each side can offer', () => {
  it('lists the types a connection form may present', () => {
    expect(connectableTypes('source')).toContain('box');
    expect(connectableTypes('target')).toEqual([
      'jmap',
      'imap',
      'caldav',
      'carddav',
      'webdav',
      'soverin',
      // The second ACCOUNT kind on the target side (2026-09-07): one row for
      // the calendars, address books, files and task lists one Nextcloud
      // already serves, instead of three protocol rows describing it.
      'nextcloud',
    ]);
  });
});

describe('the DAV targets ask for an optional base URL (0105 T1)', () => {
  it('caldav, carddav, webdav and soverin offer url, and it gates nothing', () => {
    // The escape hatch for a provider whose DAV root lives behind a path —
    // host+port can only ever say https://host:port/.
    for (const type of ['caldav', 'carddav', 'webdav', 'soverin']) {
      const url = credentialFieldsFor('target', type).find((f) => f.key === 'url');
      expect(url, `${type} has no url field`).toBeDefined();
      expect(url?.required, `${type}'s url must stay optional — host+port keep working`).not.toBe(
        true,
      );
      expect(url?.secret, 'a URL is not a secret').not.toBe(true);
    }
  });

  it('imap and jmap targets do NOT — one has no URL, the other derives its own', () => {
    for (const type of ['imap', 'jmap']) {
      expect(
        credentialFieldsFor('target', type).some((f) => f.key === 'url'),
        `${type} must not ask for a url`,
      ).toBe(false);
    }
  });
});

describe('the soverin mail face is asked at ITS door only (0106 T4b)', () => {
  it('soverin offers optional mailHost + mailPort — typed, never pre-filled', () => {
    const fields = credentialFieldsFor('target', 'soverin');
    const mailHost = fields.find((f) => f.key === 'mailHost');
    const mailPort = fields.find((f) => f.key === 'mailPort');
    expect(mailHost).toBeDefined();
    expect(mailPort).toBeDefined();
    // Optional: an account used only for calendars and contacts needs no
    // mail server — the create door demands it when email is ticked instead.
    expect(mailHost?.required).not.toBe(true);
    expect(mailHost?.secret, 'a host name is not a secret').not.toBe(true);
    expect(mailPort?.numeric).toBe(true);
  });

  it('the protocol trio, imap and jmap never grow a mail face', () => {
    for (const type of ['caldav', 'carddav', 'webdav', 'imap', 'jmap']) {
      expect(
        credentialFieldsFor('target', type).some((f) => f.key === 'mailHost'),
        `${type} must not ask for a mailHost`,
      ).toBe(false);
    }
  });
});

describe('a pair is presented as a pair (ADR-0041)', () => {
  const GOOGLE_TYPES = ['gmail', 'google-drive', 'google-calendar', 'google-contacts', 'google'];

  it("pairs every Google type's client id with its secret", () => {
    // The id is neither secret nor required once the deployment may carry the
    // client, so a panel offering "required or secret" would drop it and let
    // a new secret travel alone — the half pair every door now refuses.
    for (const type of GOOGLE_TYPES) {
      const fields = credentialFieldsFor('source', type);
      const id = fields.find((f) => f.key === 'clientId');
      expect(id?.pairedWith, `${type}: the client id travels alone`).toBe('clientSecret');
      expect(
        fields.find((f) => f.key === id?.pairedWith)?.secret,
        `${type}: pairedWith names a field that is not the secret half`,
      ).toBe(true);
    }
  });

  it('never points at a field the same type does not have', () => {
    // A dangling pair is worse than none: a panel would show a box for a
    // partner that the route never reads.
    for (const role of ['source', 'target'] as const) {
      for (const type of connectableTypes(role)) {
        const fields = credentialFieldsFor(role, type);
        for (const f of fields) {
          if (f.pairedWith === undefined) continue;
          expect(
            fields.some((g) => g.key === f.pairedWith),
            `${role}/${type}: '${f.key}' is paired with '${f.pairedWith}', which does not exist there`,
          ).toBe(true);
        }
      }
    }
  });
});

/**
 * THE NEXTCLOUD DOOR, AS THE OWNER FOUND IT (2026-09-07): "why do i have a
 * host and a dav base url?"
 *
 * It shipped as a DAV target like the others — host and port required, the
 * base URL optional beneath the password — and every one of those three
 * answers was wrong for Nextcloud, whose DAV root is always behind
 * `/remote.php/dav`. The card meant to save somebody adding three connections
 * asked for two fields it ignores and marked the only one that works
 * optional.
 */
describe('the nextcloud target asks for the address a person has', () => {
  it('demands the base URL and does not ask for host or port at all', () => {
    const fields = credentialFieldsFor('target', 'nextcloud');
    expect(fields.find((f) => f.key === 'url')?.required).toBe(true);
    expect(fields.some((f) => f.key === 'host'), 'host can never be right here').toBe(false);
    expect(fields.some((f) => f.key === 'port'), 'port can never be right here').toBe(false);
    // It is still an account on a server: who signs in, and with what.
    expect(fields.map((f) => f.key)).toEqual(['url', 'username', 'password']);
  });

  it('leaves the other DAV targets exactly as they were', () => {
    // The inversion is Nextcloud's alone. A caldav target reaching a server
    // at the host root must keep working with host+port and nothing else.
    for (const type of ['caldav', 'carddav', 'webdav', 'soverin']) {
      const fields = credentialFieldsFor('target', type);
      expect(fields.find((f) => f.key === 'host')?.required, `${type}`).toBe(true);
      expect(fields.find((f) => f.key === 'url')?.required, `${type}`).not.toBe(true);
    }
  });
});

/**
 * A PLACEHOLDER IS THE ONLY WORKED EXAMPLE MOST PEOPLE READ (2026-09-07).
 *
 * Every target type inherited `jmap.example.com` and `443` from the shared
 * field list, so six of the seven doors taught the wrong protocol — an IMAP
 * target, whose port is 993 in every mail client ever shipped, showed 443
 * beside a host called `jmap`.
 */
describe('every target type shows an example of ITSELF', () => {
  const hostOf = (type: string) =>
    credentialFieldsFor('target', type).find((f) => f.key === 'host')?.placeholder;

  it('never leaves a type showing the jmap example by default', () => {
    for (const type of connectableTypes('target')) {
      const host = hostOf(type);
      if (host === undefined) continue; // nextcloud asks for a URL instead
      if (type === 'jmap') continue;
      expect(host, `${type} still shows the jmap host example`).not.toBe('jmap.example.com');
    }
  });

  it('shows an IMAP target the port IMAP actually uses', () => {
    const port = credentialFieldsFor('target', 'imap').find((f) => f.key === 'port');
    expect(port?.placeholder).toBe('993');
  });
});

/**
 * WHERE, THEN WHO, THEN WHAT — the order a door asks in (2026-09-07).
 *
 * Field order is not decoration: the base URL answers the same question as
 * host and port, and standing under the password it read as an afterthought
 * to the credential. Box asked "which account", then two fields about an
 * application, then "whose files" — the two identity questions split by the
 * thing that authenticates them.
 */
describe('the descriptor asks in an order a person can follow', () => {
  const keys = (role: 'source' | 'target', type: string) =>
    credentialFieldsFor(role, type).map((f) => f.key);

  it('puts a DAV base URL with host and port, never under the password', () => {
    for (const type of ['caldav', 'carddav', 'webdav', 'soverin']) {
      const at = (key: string) => keys('target', type).indexOf(key);
      expect(at('port') + 1, `${type}: the URL is not beside the port`).toBe(at('url'));
      expect(at('url'), `${type}: the URL sits below the credential`).toBeLessThan(at('username'));
    }
  });

  it('asks Box whose files before which application reads them', () => {
    const at = (key: string) => keys('source', 'box').indexOf(key);
    expect(at('username')).toBeLessThan(at('userId'));
    expect(at('userId')).toBeLessThan(at('clientId'));
  });

  it('asks WHO before asking what proves it, on every door', () => {
    // Not "the account is field one" — a plain IMAP source is asked for its
    // server first, and rightly: there is no account without one. The rule
    // is that the account precedes everything that AUTHENTICATES it, which
    // is what Box broke by putting its subject below the client pair.
    const proves = ['clientId', 'clientSecret', 'refreshToken', 'password', 'serviceAccountKey'];
    for (const role of ['source', 'target'] as const) {
      for (const type of connectableTypes(role)) {
        const fields = keys(role, type);
        const account = fields.indexOf('username');
        if (account === -1) continue; // an archive is a path, not an account
        for (const key of proves) {
          const at = fields.indexOf(key);
          if (at === -1) continue;
          expect(account, `${role}/${type} asks for '${key}' above the account`).toBeLessThan(at);
        }
      }
    }
  });
});

/**
 * WHAT THIS DEPLOYMENT DEMANDS (2026-09-07, the owner: "do you account for
 * the folding of fields, like when the env in managed is missing
 * clientid/secret of for example Dropbox, Google, Microsoft? the appliance
 * might require those fields").
 *
 * `required: false` on a client pair means "the DEPLOYMENT may carry one",
 * not "you can leave this out". On an appliance with no
 * `GOOGLE_OAUTH_CLIENT_ID`, those two fields are the only way forward — and
 * both doors rendered them unmarked, at the one moment they were mandatory.
 * The wizard had the right rule for Google alone; this is that rule, for
 * every provider and every door.
 */
describe('credentialFieldRequired', () => {
  const google = credentialFieldsFor('source', 'google-drive');
  const field = (key: string, fields = google) => {
    const f = fields.find((x) => x.key === key);
    if (!f) throw new Error(`no ${key} field to test`);
    return f;
  };

  it('demands both halves of the pair where the deployment carries no client', () => {
    for (const type of ['google-drive', 'dropbox', 'microsoft']) {
      const fields = credentialFieldsFor('source', type);
      for (const key of ['clientId', 'clientSecret']) {
        expect(
          credentialFieldRequired(field(key, fields), { deploymentClient: false }),
          `${type}/${key} on an appliance`,
        ).toBe(true);
      }
    }
  });

  it('demands neither where it does, because the button supplies them', () => {
    for (const type of ['google-drive', 'dropbox', 'microsoft']) {
      const fields = credentialFieldsFor('source', type);
      for (const key of ['clientId', 'clientSecret']) {
        expect(
          credentialFieldRequired(field(key, fields), { deploymentClient: true }),
          `${type}/${key} on a managed deployment`,
        ).toBe(false);
      }
    }
  });

  it('demands both again the moment one half is typed — half a pair is refused', () => {
    const where = { deploymentClient: true, halfPairTyped: true };
    expect(credentialFieldRequired(field('clientId'), where)).toBe(true);
    expect(credentialFieldRequired(field('clientSecret'), where)).toBe(true);
  });

  it('always demands the consent-minted token: a client is not a grant', () => {
    // The deployment can carry an application. It cannot carry whose data
    // this is, so no fold ever makes the token optional.
    for (const type of ['google-drive', 'dropbox', 'microsoft']) {
      const token = field('refreshToken', credentialFieldsFor('source', type));
      expect(credentialFieldRequired(token, { deploymentClient: true }), type).toBe(true);
      expect(credentialFieldRequired(token, { deploymentClient: false }), type).toBe(true);
    }
  });

  it('drops the whole trio for a pasted service-account key (ADR-0033)', () => {
    const where = { deploymentClient: false, sideStepped: true };
    for (const key of ['clientId', 'clientSecret', 'refreshToken']) {
      expect(credentialFieldRequired(field(key), where), key).toBe(false);
    }
    // ...and never the account, which no flow can guess.
    expect(credentialFieldRequired(field('username'), where)).toBe(true);
  });

  it('never folds a pair that is always the customer\'s own', () => {
    // Box's client pair and the O365 app registration have no deployment
    // application to fall back on — there is no BOX_OAUTH_CLIENT_ID and never
    // will be, because Box's CCG flow is per-customer. Both declare their
    // secret `required: true` and their id unpaired for that reason, and the
    // rule used to override it by matching the KEY NAME: a caller asking
    // "does this deployment carry a client?" with a plain `true` was told a
    // Box secret was optional.
    for (const type of ['box', 'graph', 'oauth2']) {
      for (const key of ['clientId', 'clientSecret']) {
        const f = field(key, credentialFieldsFor('source', type));
        for (const deploymentClient of [true, false]) {
          expect(
            credentialFieldRequired(f, { deploymentClient, halfPairTyped: false }),
            `${type}/${key} with deploymentClient=${deploymentClient}`,
          ).toBe(true);
        }
      }
    }
  });

  it('leaves every other field exactly as the descriptor declared it', () => {
    // The rule is about the pair and the token. A guard that quietly changed
    // an unrelated field's requiredness would be a second source of truth.
    for (const role of ['source', 'target'] as const) {
      for (const type of connectableTypes(role)) {
        for (const f of credentialFieldsFor(role, type)) {
          if (f.pairedWith !== undefined || f.key === 'clientSecret' || f.consent !== undefined) {
            continue;
          }
          for (const deploymentClient of [true, false]) {
            expect(
              credentialFieldRequired(f, { deploymentClient }),
              `${role}/${type}/${f.key}`,
            ).toBe(f.required === true);
          }
        }
      }
    }
  });
});
