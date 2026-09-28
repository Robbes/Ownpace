// Copyright 2026 The Ownpace authors (Apache-2.0)

import { describe, it, expect, vi } from 'vitest';
import { HANDED_BY_THE_CALLER, withClose } from './deps-lifecycle.ts';
import { buildDeps, buildDomainDeps } from './build-deps.ts';
import type { MappingConfig } from '@openmig/shared';
import type { PgDatabase } from '@openmig/ledger';

describe('withClose', () => {
  it('attaches a close() that delegates to the pool and is idempotent', async () => {
    const dbClose = vi.fn().mockResolvedValue(undefined);
    const deps = withClose({ a: 1 }, { close: dbClose });

    expect(deps.a).toBe(1);
    expect(typeof deps.close).toBe('function');

    await deps.close();
    await deps.close(); // second call must be a no-op, not a double pool.end()

    expect(dbClose).toHaveBeenCalledTimes(1);
  });

  it('closes nothing when the handle is the caller\'s', async () => {
    const deps = withClose({ a: 1 }, HANDED_BY_THE_CALLER);
    await expect(deps.close()).resolves.toBeUndefined();
  });
});

// Regression guard for the self-host pool leak: the deps-builders MUST return a
// closeable so the scheduler's `finally` has one. Before the fix these returned
// bare deps with no close(), and a long-running appliance leaked a pool per
// domain per pass. Since 0138 T1 part 2 the builders are handed their ledger
// and open no pool, so close() resolves and releases nothing of theirs: the
// caller's handle is never touched (here it has no methods at all to touch).
describe('deps-builders return a closeable, and leave the caller\'s handle alone', () => {
  const LEDGER = { ledgerDb: {} as unknown as PgDatabase };

  const config: MappingConfig = {
    tenantId: '00000000-0000-4000-8000-000000000001',
    mappingId: '11111111-1111-4111-8111-111111111111',
    source: {
      type: 'imap-oauth2',
      host: 'imap.example.com',
      port: 993,
      user: 'u@example.com',
      auth: { kind: 'xoauth2', tokenFromEnv: 'SRC_TOKEN' },
    },
    target: {
      type: 'jmap',
      baseUrl: 'https://mail.example.net/jmap',
      user: 'u@example.net',
      auth: { kind: 'basic', passwordFromEnv: 'TGT_PASSWORD' },
    },
    domains: {
      calendar: {
        enabled: true,
        source: { type: 'caldav', url: 'https://dav.example.com/cal', user: 'u', auth: { kind: 'login', passwordFromEnv: 'CAL_PW' } },
        target: { type: 'caldav', url: 'https://dav.example.net/cal', user: 'u', auth: { kind: 'login', passwordFromEnv: 'CAL_PW' } },
      },
    },
  };

  it('buildDeps returns close() and it resolves', async () => {
    vi.stubEnv('SRC_TOKEN', 'tok');
    vi.stubEnv('TGT_PASSWORD', 'pw');
    try {
      const deps = await buildDeps(config, LEDGER);
      expect(typeof deps.close).toBe('function');
      await expect(deps.close()).resolves.toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('buildDomainDeps returns close() and it resolves', async () => {
    vi.stubEnv('CAL_PW', 'pw');
    try {
      const deps = buildDomainDeps(config, 'calendar', LEDGER);
      expect(typeof deps.close).toBe('function');
      await expect(deps.close()).resolves.toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
