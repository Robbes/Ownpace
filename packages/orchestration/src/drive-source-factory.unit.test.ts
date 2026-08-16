// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The Drive source's construction, for both editions (workplan 0042 T5).
 *
 * The connector's own tests drive a fake transport and know nothing about OAuth;
 * the token provider's tests drive a fake token endpoint and know nothing about
 * Drive. This file is where the three are actually JOINED — and joining them is
 * the whole of T5, so the wiring is asserted end to end against a stubbed
 * `fetch` rather than by reading the constructor arguments back out.
 */

import { describe, it, expect, vi } from 'vitest';
import { NativeFileRefused, type DriveFile } from '@openmig/connectors';
import {
  ENV_GOOGLE_CREDENTIAL_NAMES,
  STORED_GOOGLE_CREDENTIAL_NAMES,
  buildGoogleDriveSourceFrom,
} from './drive-source-factory';

const CREDS = {
  clientId: 'client-1.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-secret',
  refreshToken: '1//refresh',
};

const NATIVE_DOC: DriveFile = {
  id: 'doc-1',
  name: 'Notes',
  mimeType: 'application/vnd.google-apps.document',
};

/** One stubbed `fetch` answering both the token endpoint and Drive. */
function stubNetwork(driveBody: unknown = { files: [] }) {
  const calls: Array<{ url: string; headers: Record<string, string>; method?: string }> = [];
  const impl = vi.fn(async (url: string, init?: { headers?: Record<string, string>; method?: string }) => {
    calls.push({ url, headers: { ...(init?.headers ?? {}) }, ...(init?.method ? { method: init.method } : {}) });
    const isToken = url.includes('/token');
    return {
      ok: true,
      status: 200,
      text: async () =>
        isToken
          ? JSON.stringify({ access_token: 'at-1', expires_in: 3600, token_type: 'Bearer' })
          : '',
      json: async () => driveBody,
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

describe('refusing before anything is attempted', () => {
  it('names EVERY missing credential at once, in the appliance operator vocabulary', () => {
    // One at a time would mean fix, re-run, be told about the next — three
    // passes to learn one thing.
    expect(() => buildGoogleDriveSourceFrom({}, {}, ENV_GOOGLE_CREDENTIAL_NAMES)).toThrow(
      /GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET.*GOOGLE_REFRESH_TOKEN/s,
    );
  });

  it('names the STORED field for the managed edition, not an env var it never reads', () => {
    // The regression the mail factory paid for: a refusal written once and
    // copied told managed operators to set a variable that edition ignores.
    const failure = (() => {
      try {
        buildGoogleDriveSourceFrom(
          {},
          { clientId: 'id', clientSecret: 'secret' },
          STORED_GOOGLE_CREDENTIAL_NAMES,
        );
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(failure?.message).toContain('refreshToken');
    expect(failure?.message).not.toContain('GOOGLE_REFRESH_TOKEN');
    expect(failure?.message).toContain("connection's stored credentials");
  });

  it('refuses an EMPTY credential, not merely an absent one', () => {
    // `process.env.GOOGLE_CLIENT_SECRET` set to '' is what an operator gets from
    // a half-filled .env file, and it authenticates as nobody.
    expect(() =>
      buildGoogleDriveSourceFrom({}, { ...CREDS, clientSecret: '' }, ENV_GOOGLE_CREDENTIAL_NAMES),
    ).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it('says the token is read-only, because that is the reassurance being asked for', () => {
    // An operator handing a migration tool their Drive credentials wants to know
    // what it can do with them. `drive.readonly` is the answer.
    expect(() => buildGoogleDriveSourceFrom({}, {})).toThrow(/drive\.readonly/);
  });
});

describe('the wiring, end to end', () => {
  it('mints a Google token and spends it on the Drive request', async () => {
    // The claim T5 makes: config → credentials → token → transport → connector.
    // Asserted through the network, so a factory that built a connector with no
    // Authorization header — the one failure this whole file exists to catch —
    // cannot pass.
    const calls = stubNetwork();
    try {
      const source = buildGoogleDriveSourceFrom({ rootFolderId: 'folder-42' }, CREDS);
      await source.listSince({ path: '' });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url, 'the token comes from GOOGLE, not Microsoft').toContain(
      'https://oauth2.googleapis.com/token',
    );
    expect(calls[1]!.headers.Authorization).toBe('Bearer at-1');
    // Google's real Drive base, not a test-only override that leaked in.
    expect(calls[1]!.url).toContain('https://www.googleapis.com/drive/v3/files');
    // And the configured root actually scopes the listing — a shared drive id
    // silently ignored would migrate the whole of My Drive instead.
    expect(decodeURIComponent(calls[1]!.url)).toContain("'folder-42' in parents");
  });

  it('roots at My Drive when the mapping does not say otherwise', async () => {
    const calls = stubNetwork();
    try {
      await buildGoogleDriveSourceFrom({}, CREDS).listSince({ path: '' });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(decodeURIComponent(calls[1]!.url)).toContain("'root' in parents");
  });
});

describe('the native-file policy travels from the mapping to the connector', () => {
  // `refusalFor` is the connector's own answer to "would this item be refused",
  // which is the only way to observe the policy without a native file to fetch.
  const refusalFor = (source: unknown, file: DriveFile) =>
    (source as { refusalFor(f: DriveFile): NativeFileRefused | undefined }).refusalFor(file);

  it('defaults to REFUSING a Google Doc when the mapping says nothing', () => {
    // The default must not be re-decided per edition. It lives in the connector;
    // the factory passes nothing rather than passing its own idea of a default.
    expect(refusalFor(buildGoogleDriveSourceFrom({}, CREDS), NATIVE_DOC)).toBeInstanceOf(
      NativeFileRefused,
    );
  });

  it('stops refusing once the owner has chosen an export policy', () => {
    const source = buildGoogleDriveSourceFrom({ nativeFilePolicy: 'export-office' }, CREDS);

    expect(refusalFor(source, NATIVE_DOC)).toBeUndefined();
  });
});

describe('the shared-drive browse (workplan 0049)', () => {
  it('pages drives.list and returns id+name — read-only, and never sent by a pass', async () => {
    const calls = stubNetwork();
    try {
      const source = buildGoogleDriveSourceFrom({}, CREDS) as unknown as {
        listSharedDrives(): Promise<ReadonlyArray<{ id: string; name: string }>>;
      };
      // The stub answers `{ files: [] }` to everything; drives.list reads
      // `drives`, so the parse tolerating an unrelated body proves the
      // paging loop terminates on an absent nextPageToken.
      expect(await source.listSharedDrives()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
    // Token minted, then ONE listing call to /drives with the documented
    // fields — a browse must never turn into a crawl.
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain('/drives?pageSize=100');
    expect(decodeURIComponent(calls[1]!.url)).toContain('drives(id,name),nextPageToken');
    expect(calls[1]!.headers.Authorization).toBe('Bearer at-1');
  });
});

describe('the shared-with-me folder browse (workplan 0051)', () => {
  it('asks for FOLDERS in the shared-with-me view, untrashed, with the owner riding along', async () => {
    const calls = stubNetwork();
    try {
      const source = buildGoogleDriveSourceFrom({}, CREDS) as unknown as {
        listSharedWithMeFolders(): Promise<
          ReadonlyArray<{ id: string; name: string; owner?: string }>
        >;
      };
      expect(await source.listSharedWithMeFolders()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls).toHaveLength(2);
    const listing = decodeURIComponent(calls[1]!.url);
    // The view, folders only, and never somebody's binned share.
    expect(listing).toContain('sharedWithMe=true');
    expect(listing).toContain("mimeType='application/vnd.google-apps.folder'");
    expect(listing).toContain('trashed=false');
    // The owner's address is what disambiguates two shares named alike.
    expect(listing).toContain('owners(emailAddress)');
    expect(calls[1]!.headers.Authorization).toBe('Bearer at-1');
  });
});
