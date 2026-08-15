// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * What happens to the database pool when `buildDomainDeps` REFUSES.
 *
 * Every refusal in that function happens after the ledger is already open — a
 * domain that is not enabled, an endpoint missing credentials, and since 0042 T5
 * a Drive source with no OAuth values. Each one used to return without closing
 * the pool it had just opened. An appliance retrying a misconfigured mapping on
 * its schedule leaks one per attempt until Postgres refuses connections, at
 * which point the failure reads as "the database is down" and points nowhere
 * near the mapping that is actually wrong.
 *
 * The managed builder has had this guard since it was written; this is the
 * appliance's half of it, and it is asserted rather than assumed because a
 * cleanup nobody checks is a cleanup that silently stops happening.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MappingConfig } from '@openmig/shared';

const { closeSpy } = vi.hoisted(() => ({ closeSpy: vi.fn(async () => {}) }));

// The seam is `createPgDb`: the one call that acquires the pool. Everything else
// in @openmig/ledger stays real, so PgLedger/PgCursorStore are the actual
// classes — they only store the handle at construction.
vi.mock('@openmig/ledger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/ledger')>();
  return { ...actual, createPgDb: () => ({ close: closeSpy }) };
});

import { buildDomainDeps } from './build-deps';

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
  closeSpy.mockClear();
  vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/none');
  vi.stubEnv('TGT_PASSWORD', 'target_password');
});

describe('the pool a refusal has already opened', () => {
  it('is closed when the Drive source has no credentials', () => {
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
        ),
      ).toThrow(/GOOGLE_CLIENT_ID/);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('is closed when the domain is not enabled at all', () => {
    // The oldest of these refusals, and the one an appliance hits repeatedly:
    // a scheduled pass for a domain somebody turned off.
    try {
      expect(() =>
        buildDomainDeps(
          mapping({ files: { enabled: false, source: { type: 'google-drive' }, target: WEBDAV_TARGET } }),
          'file',
        ),
      ).toThrow(/not enabled/);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('is NOT closed when the build succeeds — the caller owns it then', () => {
    // The other half of the property. Closing on the way out of a successful
    // build would hand back deps whose ledger is already shut.
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-1.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'GOCSPX-secret');
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', '1//refresh');
    try {
      const deps = buildDomainDeps(
        mapping({
          files: { enabled: true, source: { type: 'google-drive' }, target: WEBDAV_TARGET },
        }),
        'file',
      );
      expect(closeSpy).not.toHaveBeenCalled();

      void deps.close();
      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
