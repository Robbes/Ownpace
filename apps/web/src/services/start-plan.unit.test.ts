// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT *START A MIGRATION* DECIDES (workplan 0153 T4): every rule
 * `start-plan.ts`'s header states, held here.
 */
import { describe, it, expect } from 'vitest';
import { DISCOVERY_DOMAINS, sourceFaceIsExperimental } from '@openmig/shared';
import {
  START_PROVIDERS,
  cannotGive,
  carrierOf,
  connectionsFor,
  destinationsFor,
  grantableByLink,
  migrationsFor,
  nextcloudAddress,
  nextcloudDavUrl,
  offers,
  photosThrough,
  type Route,
} from './start-plan.ts';

/** What `/api/provider-accounts` answers where Google's restricted scopes are declared. */
const RESTRICTED = { google: DISCOVERY_DOMAINS };
/** And where they are not, which is the default and every appliance. */
const NARROW = { google: ['calendar', 'contact', 'task'] } as const;

describe('what a provider can give here (step 3)', () => {
  it('lists the drawing’s six, in its order', () => {
    expect(START_PROVIDERS).toEqual(['google', 'microsoft', 'apple', 'dropbox', 'box', 'imap']);
  });

  it('offers Google’s five whichever way the deployment asks for them', () => {
    expect(offers('google', NARROW)).toEqual([...DISCOVERY_DOMAINS]);
    expect(offers('google', RESTRICTED)).toEqual([...DISCOVERY_DOMAINS]);
  });

  it('never offers Apple’s files, which Apple gives nobody (0115)', () => {
    expect(offers('apple')).toEqual(['email', 'calendar', 'contact', 'task']);
    expect(cannotGive('apple')).toEqual(['file']);
  });

  it('offers a single-purpose provider its one type, and says what it cannot give', () => {
    expect(offers('dropbox')).toEqual(['file']);
    expect(offers('box')).toEqual(['file']);
    expect(offers('imap')).toEqual(['email']);
    expect(cannotGive('dropbox')).toEqual(['email', 'calendar', 'contact', 'task']);
  });

  it('reads Microsoft’s faces from the deployment where it answered', () => {
    expect(offers('microsoft')).toEqual([...DISCOVERY_DOMAINS]);
    expect(offers('microsoft', { microsoft: ['email', 'calendar'] })).toEqual(['email', 'calendar']);
  });
});

describe('which card carries a type, and whose verdict its tag reads (step 3)', () => {
  it('is the provider’s own card, except Google’s mail and files where the restricted scopes are not declared', () => {
    expect(carrierOf('google', 'calendar', NARROW)).toBe('google');
    expect(carrierOf('google', 'email', NARROW)).toBe('gmail');
    expect(carrierOf('google', 'file', NARROW)).toBe('google-drive');
    expect(carrierOf('google', 'email', RESTRICTED)).toBe('google');
    expect(carrierOf('microsoft', 'email')).toBe('microsoft');
    expect(carrierOf('imap', 'email')).toBe('imap');
  });

  it('tags Google’s mail as experimental only where the account carries it', () => {
    // The gmail card has run against a real account; the account's mail face has not (0131 D6).
    expect(sourceFaceIsExperimental(carrierOf('google', 'email', NARROW), 'email')).toBe(false);
    expect(sourceFaceIsExperimental(carrierOf('google', 'email', RESTRICTED), 'email')).toBe(true);
  });
});

describe('where photos come from (step 3)', () => {
  it('is Google’s Takeout export, since a reader for it is built', () => {
    expect(photosThrough('google')).toBe('google-takeout');
  });

  it('is nothing yet for Apple, whose export waits on its reader, and nothing for a provider with no photos', () => {
    expect(photosThrough('apple')).toBeUndefined();
    expect(photosThrough('dropbox')).toBeUndefined();
    expect(photosThrough('imap')).toBeUndefined();
  });
});

describe('which accounts to connect for what was ticked (step 4)', () => {
  it('asks Google once for everything where the restricted scopes are declared', () => {
    expect(connectionsFor('google', ['file', 'email', 'calendar'], RESTRICTED)).toEqual([
      { provider: 'google', card: 'google', types: ['email', 'calendar', 'file'] },
    ]);
  });

  it('asks mail and files apart where they are not, and only for what was ticked', () => {
    expect(connectionsFor('google', DISCOVERY_DOMAINS.filter((d) => d !== 'task'), NARROW)).toEqual([
      { provider: 'google', card: 'google', types: ['calendar', 'contact'] },
      { provider: 'google', card: 'gmail', types: ['email'] },
      { provider: 'google', card: 'google-drive', types: ['file'] },
    ]);
    // Files alone: no account consent at all, only Drive's.
    expect(connectionsFor('google', ['file'], NARROW)).toEqual([
      { provider: 'google', card: 'google-drive', types: ['file'] },
    ]);
  });

  it('reads the narrow default where the deployment has not answered', () => {
    expect(connectionsFor('google', ['email'])).toEqual([{ provider: 'google', card: 'gmail', types: ['email'] }]);
  });

  it('asks every other provider once, for its ticked types that it can give', () => {
    expect(connectionsFor('microsoft', ['task', 'email'])).toEqual([
      { provider: 'microsoft', card: 'microsoft', types: ['email', 'task'] },
    ]);
    // A type the provider cannot give is never asked for, even if it arrives ticked.
    expect(connectionsFor('apple', ['email', 'file'])).toEqual([
      { provider: 'apple', card: 'apple', types: ['email'] },
    ]);
  });

  it('asks nothing of a provider with nothing ticked', () => {
    expect(connectionsFor('dropbox', [])).toEqual([]);
    expect(connectionsFor('apple', ['file'])).toEqual([]);
  });
});

describe('which destinations take a type (step 5)', () => {
  it('offers only a destination that can write the type', () => {
    expect(destinationsFor('email')).toEqual(['jmap', 'imap', 'soverin']);
    expect(destinationsFor('file')).toEqual(['jmap', 'webdav', 'nextcloud']);
    expect(destinationsFor('task')).toEqual(['caldav', 'soverin', 'nextcloud']);
    // Nextcloud is no mail server, so mail never goes there.
    expect(destinationsFor('email')).not.toContain('nextcloud');
  });
});

describe('the migrations that follow (underneath)', () => {
  const route = (over: Partial<Route>): Route => ({
    type: 'email',
    provider: 'google',
    sourceCard: 'google',
    sourceConnectionId: 'src-google',
    sourceUsername: 'anna@example.com',
    targetCard: 'soverin',
    targetConnectionId: 'dst-soverin',
    ...over,
  });

  it('makes one migration per pair of accounts, holding every type between them', () => {
    const planned = migrationsFor([
      route({ type: 'calendar' }),
      route({ type: 'email' }),
      route({ type: 'file', targetCard: 'nextcloud', targetConnectionId: 'dst-nextcloud' }),
      route({ type: 'contact' }),
    ]);
    expect(planned).toHaveLength(2);
    expect(planned[0]).toMatchObject({
      sourceConnectionId: 'src-google',
      targetConnectionId: 'dst-soverin',
      types: ['email', 'calendar', 'contact'],
    });
    expect(planned[1]).toMatchObject({ targetCard: 'nextcloud', types: ['file'] });
  });

  it('keeps two accounts of one provider apart, as two migrations', () => {
    const planned = migrationsFor([
      route({ type: 'email', sourceCard: 'gmail', sourceConnectionId: 'src-gmail' }),
      route({ type: 'calendar' }),
    ]);
    expect(planned.map((m) => m.sourceCard)).toEqual(['gmail', 'google']);
  });

  it('lists the migrations in the order a person reads data types, whichever provider came first', () => {
    const planned = migrationsFor([
      route({ type: 'file', provider: 'dropbox', sourceCard: 'dropbox', sourceConnectionId: 'src-dropbox', targetCard: 'nextcloud', targetConnectionId: 'dst-nextcloud' }),
      route({ type: 'email', provider: 'imap', sourceCard: 'imap', sourceConnectionId: 'src-imap' }),
    ]);
    expect(planned.map((m) => m.types[0])).toEqual(['email', 'file']);
  });

  it('counts a type once, even if it arrives twice', () => {
    expect(migrationsFor([route({}), route({})])[0]!.types).toEqual(['email']);
  });
});

describe('a Nextcloud is its address (T7 (c))', () => {
  it('derives the DAV root from what a person types', () => {
    expect(nextcloudDavUrl('cloud.example.eu')).toBe('https://cloud.example.eu/remote.php/dav');
    expect(nextcloudDavUrl(' https://cloud.example.eu/ ')).toBe('https://cloud.example.eu/remote.php/dav');
    // Installed under a path: the path stays.
    expect(nextcloudDavUrl('example.eu/nextcloud')).toBe('https://example.eu/nextcloud/remote.php/dav');
    // Copied from the address bar, or typed whole: what follows the install goes.
    expect(nextcloudDavUrl('https://cloud.example.eu/apps/files/?dir=/')).toBe(
      'https://cloud.example.eu/remote.php/dav',
    );
    expect(nextcloudDavUrl('cloud.example.eu/index.php/apps/dashboard/')).toBe(
      'https://cloud.example.eu/remote.php/dav',
    );
    expect(nextcloudDavUrl('https://cloud.example.eu/remote.php/dav/files/anna')).toBe(
      'https://cloud.example.eu/remote.php/dav',
    );
    // A scheme typed stays as typed.
    expect(nextcloudDavUrl('http://nas.example.eu')).toBe('http://nas.example.eu/remote.php/dav');
    expect(nextcloudDavUrl('   ')).toBe('');
  });

  it('gives the address back for a box drawn again', () => {
    expect(nextcloudAddress('https://cloud.example.eu/remote.php/dav')).toBe('cloud.example.eu');
    expect(nextcloudAddress(nextcloudDavUrl('example.eu/nextcloud'))).toBe('example.eu/nextcloud');
  });
});

describe('what somebody else can connect themselves, by a grant link (0108)', () => {
  const OWN_CLIENT = { ...NARROW, googleClient: 'deployment' } as const;

  it('is Google’s account, for calendars, contacts and tasks, through the deployment’s own client', () => {
    expect(grantableByLink('google', OWN_CLIENT)).toBe(true);
  });

  it('is Gmail and Drive only where the deployment declared Google’s restricted scopes', () => {
    expect(grantableByLink('gmail', OWN_CLIENT)).toBe(false);
    expect(grantableByLink('google-drive', OWN_CLIENT)).toBe(false);
    const restricted = { ...RESTRICTED, googleClient: 'deployment' } as const;
    expect(grantableByLink('gmail', restricted)).toBe(true);
    expect(grantableByLink('google-drive', restricted)).toBe(true);
  });

  it('is nothing where the deployment carries no Google client, or has not said', () => {
    expect(grantableByLink('google', { ...NARROW, googleClient: 'connection' })).toBe(false);
    expect(grantableByLink('google', NARROW)).toBe(false);
  });

  it('is nothing for a provider with no link at all', () => {
    for (const card of ['microsoft', 'apple', 'dropbox', 'box', 'imap']) {
      expect(grantableByLink(card, OWN_CLIENT)).toBe(false);
    }
  });
});
