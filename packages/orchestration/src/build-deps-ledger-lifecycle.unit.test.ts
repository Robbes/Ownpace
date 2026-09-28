// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What happens to the database pool when `buildDomainDeps` REFUSES.
 *
 * Every refusal in that function happens after the ledger is taken — a domain
 * that is not enabled, an endpoint missing credentials, and since 0042 T5 a
 * Drive source with no OAuth values. When the builder opened its own pool from
 * `DATABASE_URL` for a caller that passed no handle, each refusal used to
 * return without closing the pool it had just opened. An appliance retrying a
 * misconfigured mapping on its schedule leaked one per attempt until Postgres
 * refused connections, at which point the failure read as "the database is
 * down" and pointed nowhere near the mapping that was actually wrong.
 *
 * Since workplan 0138 T1 part 2 there is no such pool: the builder is handed
 * its ledger, and opens none, whatever `DATABASE_URL` says. So what is asserted
 * now is that no pool is opened at all, on a refusal or on success, and that
 * the caller's handle is left alone either way. A cleanup nobody checks is a
 * cleanup that silently stops happening; so is an opening.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MappingConfig } from '@openmig/shared';
import type { PgDatabase } from '@openmig/ledger';

const { opened } = vi.hoisted(() => ({ opened: vi.fn() }));

// The seam is `createPgDb`: the one call that would acquire a pool. Everything
// else in @openmig/ledger stays real, so PgLedger/PgCursorStore are the actual
// classes — they only store the handle at construction.
vi.mock('@openmig/ledger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/ledger')>();
  return { ...actual, createPgDb: opened };
});

import { buildDomainDeps } from './build-deps.ts';

/** The caller's handle. A proxy that records any use of it: none is expected. */
const touched: string[] = [];
const LEDGER = {
  ledgerDb: new Proxy({} as PgDatabase, {
    get: (_t, key) => {
      touched.push(String(key));
      return undefined;
    },
  }),
};

function mapping(domains: Record<string, unknown>) {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001',
    mappingId: '11111111-1111-4111-8111-111111111111',
    source: {
      type: 'imap-oauth2',
      host: 'stalwart',
      port: 993,
      user: 'source@dev.local',
      auth: { kind: 'login', passwordFromEnv: 'SRC_PASSWORD' },
    },
    target: {
      type: 'jmap',
      baseUrl: 'https://mail.example.net',
      user: 'u@example.net',
      auth: { kind: 'basic', passwordFromEnv: 'TGT_PASSWORD' },
    },
    domains,
  } as unknown as MappingConfig;
}

const WEBDAV_TARGET = {
  type: 'webdav',
  url: 'https://cloud.example.net/remote.php/dav/files/target/',
  user: 'target',
  auth: { kind: 'login', passwordFromEnv: 'TGT_PASSWORD' },
};

beforeEach(() => {
  opened.mockClear();
  touched.length = 0;
  // Set, to show it is not read: the builder used to open a pool from it.
  vi.stubEnv('DATABASE_URL', 'postgresql://nobody@ledger.test.invalid/none');
  vi.stubEnv('TGT_PASSWORD', 'target_password');
});

describe('the pool a refusal would have opened', () => {
  it('is never opened when the Drive source has no credentials', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', '');
    try {
      expect(() =>
        buildDomainDeps(
          mapping({
            files: {
              enabled: true,
              source: { type: 'google-drive' },
              target: WEBDAV_TARGET,
            },
          }),
          'file',
          LEDGER,
        ),
      ).toThrow(/GOOGLE_CLIENT_ID/);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(opened).not.toHaveBeenCalled();
    expect(touched).toEqual([]);
  });

  it('is never opened when the domain is not enabled at all', () => {
    // The oldest of these refusals, and the one an appliance hits repeatedly:
    // a scheduled pass for a domain somebody turned off.
    try {
      expect(() =>
        buildDomainDeps(
          mapping({ files: { enabled: false, source: { type: 'google-drive' }, target: WEBDAV_TARGET } }),
          'file',
          LEDGER,
        ),
      ).toThrow(/not enabled/);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(opened).not.toHaveBeenCalled();
    expect(touched).toEqual([]);
  });

  it('is never opened when the build succeeds, and close() leaves the caller\'s handle alone', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-1.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'GOCSPX-secret');
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', '1//refresh');
    try {
      const deps = buildDomainDeps(
        mapping({
          files: { enabled: true, source: { type: 'google-drive' }, target: WEBDAV_TARGET },
        }),
        'file',
        LEDGER,
      );
      await deps.close();
    } finally {
      vi.unstubAllEnvs();
    }

    expect(opened).not.toHaveBeenCalled();
    expect(touched).toEqual([]);
  });

  it('is refused rather than opened for a caller that passes no ledger at all', () => {
    // Typed away, and checked anyway: a caller outside TypeScript's sight used
    // to get the owner's pool from DATABASE_URL here.
    expect(() =>
      buildDomainDeps(
        mapping({ files: { enabled: true, source: { type: 'google-drive' }, target: WEBDAV_TARGET } }),
        'file',
        {} as unknown as typeof LEDGER,
      ),
    ).toThrow(/handed its ledger/);
    vi.unstubAllEnvs();
    expect(opened).not.toHaveBeenCalled();
  });
});
