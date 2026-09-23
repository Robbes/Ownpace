// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FIFTH GOOGLE FACE (workplan 0126 T2, 2026-09-23).
 *
 * Until today a Google account served calendar and contacts by default and
 * no task face at any tier, because Google's CalDAV carries no VTODO (0113
 * T5). T1 built a source for the Tasks API; this pins what makes it
 * reachable, end to end, in the order a migration meets it:
 *
 *  - the face resolves to its own builder, not to the DAV default a pass would
 *    fail in with a sentence about a missing DAV host;
 *  - the builder a pass uses mints with `tasks.readonly`, the scope the
 *    consent asked for, and hands every request to the tenant's rate budget;
 *  - domain-wide delegation impersonates the mapping's own account;
 *  - missing credentials are refused at build time, by name;
 *  - the Test measures the face like the other four, instead of answering a
 *    structural no.
 */

import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { ThrottleLimiter } from '@openmig/shared';
import { GoogleTasksSource } from '@openmig/connectors';
import { domainsToScopes, qualifyGoogleGrant } from './account-qualification.ts';
import { buildTaskSourceFromConnection } from './build-deps-from-mapping.ts';
import { GOOGLE_TASKS_SCOPE } from './google-tasks-source-factory.ts';
import { sourceFaceBuilder } from './source-face-builders.ts';

const ROW = {
  kind: 'google',
  config: { user: 'someone@example.com' },
  creds: { clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt' },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Google's token endpoint answers; anything else reaching the network is a defect. */
function stubTokenEndpoint() {
  const tokenBodies: string[] = [];
  const elsewhere: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/token')) {
        tokenBodies.push(String(init?.body ?? ''));
        return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600, token_type: 'Bearer' }), {
          status: 200,
        });
      }
      elsewhere.push(String(url));
      return new Response('not expected: the rate budget should have carried this', { status: 500 });
    }),
  );
  return { tokenBodies, elsewhere };
}

/** A tenant rate budget that answers every request itself, and records whose it was. */
function recordingLimiter(page: unknown) {
  const providers: string[] = [];
  const limiter = {
    executeWithThrottling: vi.fn(async (_tenant: string, provider: string) => {
      providers.push(provider);
      return { status: 200, body: JSON.stringify(page), headers: {} };
    }),
  } as unknown as ThrottleLimiter;
  return { limiter, providers };
}

describe('the face resolves to the Tasks API', () => {
  it('names its own builder, not the DAV default a pass would fail in', () => {
    // Before T2 `google.task` fell to `protocolDefault`, which is `dav`, and
    // the refusal would have been about a missing DAV host on an OAuth row.
    expect(sourceFaceBuilder('google', 'task')).toBe('google-tasks');
  });

  it('builds a GoogleTasksSource from a stored Google row', () => {
    expect(buildTaskSourceFromConnection(ROW, undefined)).toBeInstanceOf(GoogleTasksSource);
  });

  it('asks exactly tasks.readonly for a Tasks tick, the scope the source mints with', () => {
    expect(domainsToScopes(['task'])).toEqual(['https://www.googleapis.com/auth/tasks.readonly']);
    expect(GOOGLE_TASKS_SCOPE).toBe('https://www.googleapis.com/auth/tasks.readonly');
  });
});

describe('the builder a pass uses', () => {
  it('mints with tasks.readonly and hands every Tasks request to the tenant’s rate budget', async () => {
    const { tokenBodies, elsewhere } = stubTokenEndpoint();
    const { limiter, providers } = recordingLimiter({ items: [{ id: 'L1', title: 'My Tasks' }] });

    const folders = await buildTaskSourceFromConnection(ROW, limiter).listFolders();

    expect(folders.map((f) => f.name)).toEqual(['My Tasks']);
    expect(providers).toEqual(['tasks.googleapis.com']);
    expect(elsewhere).toEqual([]);
    // Asked == minted: a token minted for another scope is refused by the
    // API mid-pass, as an error that reads like Google is down.
    expect(new URLSearchParams(tokenBodies[0]).get('scope')).toBe(GOOGLE_TASKS_SCOPE);
  });

  it('refuses at build time, naming what is missing, before any pass starts', () => {
    expect(() =>
      buildTaskSourceFromConnection({ ...ROW, creds: { clientId: 'cid' } }, undefined),
    ).toThrow(/Google Tasks source is missing clientSecret, refreshToken/);
  });

  it('takes domain-wide delegation from a service-account key, impersonating the row’s own account', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = JSON.stringify({
      type: 'service_account',
      client_email: 'migrator@project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    const { tokenBodies } = stubTokenEndpoint();
    const { limiter } = recordingLimiter({ items: [] });

    await buildTaskSourceFromConnection(
      { ...ROW, creds: { serviceAccountKey: key } },
      limiter,
    ).listFolders();

    const body = new URLSearchParams(tokenBodies[0]);
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const claims = JSON.parse(
      Buffer.from(body.get('assertion')!.split('.')[1]!, 'base64url').toString(),
    ) as { sub: string; scope: string };
    expect(claims.sub).toBe('someone@example.com');
    expect(claims.scope).toBe(GOOGLE_TASKS_SCOPE);
  });
});

describe('the Test measures the face like the other four', () => {
  const grantOf = (scope: string) =>
    vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'at', scope }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  /** Two lists, with 3 and 2 tasks: what a pass would carry. */
  const twoLists = {
    listFolders: async () => [{ path: '/tasks/lists/A' }, { path: '/tasks/lists/B' }],
    listSince: async (folder: { path: string }) => ({
      items: folder.path.endsWith('A') ? [1, 2, 3] : [4, 5],
    }),
  };

  it('counts the lists and the tasks when the grant carries Tasks', async () => {
    vi.stubGlobal('fetch', grantOf(GOOGLE_TASKS_SCOPE));
    const q = await qualifyGoogleGrant('google', ROW.creds, {
      tokenEndpoint: 'https://stub/token',
      reach: { user: 'someone@example.com', listable: () => twoLists },
    });
    expect(q?.domains.task).toMatchObject({
      answer: 'yes',
      count: 2,
      unit: 'taskList',
      volume: { items: 5 },
    });
  });

  it('accepts the read-write scope a person granted elsewhere', async () => {
    vi.stubGlobal('fetch', grantOf('https://www.googleapis.com/auth/tasks'));
    const q = await qualifyGoogleGrant('google', ROW.creds, { tokenEndpoint: 'https://stub/token' });
    expect(q?.domains.task.answer).toBe('yes');
  });

  it('a grant without Tasks is a measured no naming the scope to add, and the face is never asked', async () => {
    vi.stubGlobal('fetch', grantOf('https://www.googleapis.com/auth/calendar'));
    const asked: string[] = [];
    const q = await qualifyGoogleGrant('google', ROW.creds, {
      tokenEndpoint: 'https://stub/token',
      reach: {
        user: 'someone@example.com',
        listable: (domain) => {
          asked.push(domain);
          return twoLists;
        },
      },
    });
    expect(q?.domains.task).toMatchObject({ answer: 'no', reason: 'notGranted' });
    expect(q?.domains.task.detail).toContain(GOOGLE_TASKS_SCOPE);
    expect(asked).not.toContain('task');
  });

  it('an exchange that failed leaves Tasks unmeasured like the rest, not a structural no', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })));
    const q = await qualifyGoogleGrant('google', ROW.creds, { tokenEndpoint: 'https://stub/token' });
    expect(q?.domains.task.answer).toBe('unknown');
    expect(q?.domains.task.detail).toContain('invalid_grant');
  });
});
