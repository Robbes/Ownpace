// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A DAV SOURCE AT THE CREATE DOOR (workplan 0169; the owner, 2026-11-24:
 * *"yes to all, build them. But dont add the nextcloud as source card, add
 * only the generic cards as source."*).
 *
 * Until this, the create route's `sourceType` refused `caldav`, `carddav` and
 * `webdav`, so nobody could leave a DAV server through the managed door
 * (0141 open question 9). These hold that it accepts each, stores it as the
 * worker's wiring reads it, and refuses what it should:
 *
 * - each is accepted by its base URL, or by host and port, with a login;
 * - each is refused without a server, or without a login, by name;
 * - each carries only the faces its protocol carries;
 * - `nextcloud` is refused as a source: it is a target card only;
 * - the stored config is a DAV target's shape, `url` where typed; the
 *   credential is the login and nothing else; the kind is the type.
 */
import { describe, it, expect } from 'vitest';
import {
  CreateMappingSchema,
  sourceConfigOverride,
  sourceConnectionConfig,
  sourceCredentialRecord,
  sourceKindFor,
} from './index.ts';

const DAV = ['caldav', 'carddav', 'webdav'] as const;
type DavType = (typeof DAV)[number];

/** The faces each protocol carries, one of which each body ticks. */
const FACES: Readonly<Record<DavType, ReadonlyArray<string>>> = {
  caldav: ['calendar', 'task'],
  carddav: ['contact'],
  webdav: ['file'],
};

/** A body as *Start a migration* posts one, to a Nextcloud destination. */
function body(sourceType: string, sourceConfig: Record<string, unknown>, domains?: ReadonlyArray<string>) {
  return {
    name: 'Anna — leaving a DAV server',
    sourceType,
    sourceConfig: { username: 'anna', password: 'an-app-password', ...sourceConfig },
    targetType: 'nextcloud',
    targetConfig: {
      url: 'https://cloud.example.org/remote.php/dav',
      username: 'anna',
      password: 'p',
    },
    syncConfig: { domains: domains ?? FACES[sourceType as DavType] ?? ['calendar'] },
  };
}

const issuesOf = (input: unknown) => {
  const parsed = CreateMappingSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
};

describe('the create door accepts each DAV source', () => {
  it.each(DAV)('%s, by its base URL', (type) => {
    expect(issuesOf(body(type, { url: 'https://dav.example.org/remote.php/dav' }))).toEqual([]);
  });

  it.each(DAV)('%s, by host and port', (type) => {
    expect(issuesOf(body(type, { host: 'dav.example.org', port: 443 }))).toEqual([]);
  });
});

describe('and refuses one it cannot open, by name', () => {
  it.each(DAV)('%s with no server: the host, or the base URL that names it', (type) => {
    const issues = issuesOf(body(type, {}));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: 'sourceConfig.host' });
    expect(issues[0]!.message).toMatch(/connects to a server: sourceConfig is missing host and port, or the DAV base URL/);
  });

  it.each(DAV)('%s with no password', (type) => {
    const issues = issuesOf(body(type, { host: 'dav.example.org', port: 443, password: undefined }));
    expect(issues).toEqual([
      {
        path: 'sourceConfig.password',
        message: `A '${type}' source signs in with the account's login: sourceConfig is missing password.`,
      },
    ]);
  });

  it.each([
    ['caldav', 'contact'],
    ['carddav', 'calendar'],
    ['webdav', 'calendar'],
  ] as const)('%s asked for %s, a face its protocol does not carry', (type, face) => {
    const issues = issuesOf(body(type, { host: 'dav.example.org', port: 443 }, [face]));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe('syncConfig.domains');
    expect(issues[0]!.message).toMatch(new RegExp(`cannot provide the '${face}' data type`));
  });
});

describe('a Nextcloud is a destination only', () => {
  it('nextcloud is refused as a source type', () => {
    const issues = issuesOf(body('nextcloud', { url: 'https://cloud.example.org/remote.php/dav' }, ['calendar']));
    expect(issues.map((i) => i.path)).toEqual(['sourceType']);
  });

  it('and is still accepted as a target', () => {
    expect(issuesOf(body('caldav', { url: 'https://dav.example.org/' }))).toEqual([]);
  });
});

describe('what is stored is what the worker reads', () => {
  it.each(DAV)('%s: the kind is the type', (type) => {
    expect(sourceKindFor(type)).toBe(type);
  });

  it.each(DAV)('%s: a DAV target’s config shape, the typed base URL beside host and port', (type) => {
    const parsed = CreateMappingSchema.parse(
      body(type, { host: 'dav.example.org', port: 443, url: ' https://dav.example.org/dav/ ' }),
    );
    expect(sourceConnectionConfig(parsed)).toEqual({
      host: 'dav.example.org',
      port: 443,
      useSsl: true,
      url: 'https://dav.example.org/dav/',
    });
  });

  it('no url key where none was typed, so host and port decide', () => {
    const parsed = CreateMappingSchema.parse(body('webdav', { host: 'dav.example.org', port: 8443 }));
    expect(sourceConnectionConfig(parsed)).toEqual({ host: 'dav.example.org', port: 8443, useSsl: true });
  });

  it.each(DAV)('%s: the credential is the login, and nothing of the address', (type) => {
    const parsed = CreateMappingSchema.parse(body(type, { url: 'https://dav.example.org/' }));
    expect(sourceCredentialRecord(parsed)).toEqual({ username: 'anna', password: 'an-app-password' });
  });

  it.each(DAV)('%s: a reused connection takes nothing from the mapping', (type) => {
    const parsed = CreateMappingSchema.parse(body(type, { url: 'https://dav.example.org/' }));
    expect(sourceConfigOverride(parsed)).toEqual({});
  });
});
