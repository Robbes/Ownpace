// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

import { describe, it, expect } from 'vitest';
import type { MigrationStatus } from '@openmig/shared';
import { buildStatusReport } from './status.ts';

function status(over: Partial<MigrationStatus>): MigrationStatus {
  return {
    id: 'id',
    tenantId: 't' as MigrationStatus['tenantId'],
    mappingId: 'm' as MigrationStatus['mappingId'],
    domain: 'email',
    state: 'completed',
    itemsSynced: 0,
    itemsFailed: 0,
    bytesTransferred: 0,
    startedAt: '2026-07-20T00:00:00Z',
    updatedAt: '2026-07-20T00:01:00Z',
    ...over,
  };
}

describe('buildStatusReport', () => {
  it('maps per-mapping domain status into a serializable report', () => {
    const report = buildStatusReport([
      {
        mappingId: 'inbox',
        migrationStatus: 'active',
        statuses: [
          status({ domain: 'email', state: 'completed', itemsSynced: 42, bytesTransferred: 1000, completedAt: '2026-07-20T00:02:00Z' }),
          status({ domain: 'calendar', state: 'in_progress' }),
        ],
      },
    ]);

    expect(report.status).toBe('ok');
    expect(report.mappings).toHaveLength(1);
    expect(report.mappings[0]!.mappingId).toBe('inbox');
    expect(report.mappings[0]!.domains[0]).toMatchObject({
      domain: 'email',
      state: 'completed',
      itemsSynced: 42,
      bytesTransferred: 1000,
      lastSyncedAt: '2026-07-20T00:02:00Z',
    });
    expect(report.mappings[0]!.domains[1]).toMatchObject({ domain: 'calendar', state: 'in_progress' });
    // Whether the migration is still running at all. Without it, a finished
    // migration and a stalled one look identical here: both show their last
    // completed pass and nothing since.
    expect(report.mappings[0]!.migrationStatus).toBe('active');
    // JSON-serializable end to end.
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it('surfaces the last error verbatim (SAD §11.2)', () => {
    const report = buildStatusReport([
      { mappingId: 'm', migrationStatus: 'active', statuses: [status({ state: 'failed', lastError: 'connector auth failed: 401' })] },
    ]);
    expect(report.mappings[0]!.domains[0]!.lastError).toBe('connector auth failed: 401');
  });

  it('omits lastError/lastSyncedAt when absent', () => {
    const report = buildStatusReport([{ mappingId: 'm', migrationStatus: 'paused', statuses: [status({ state: 'pending' })] }]);
    const d = report.mappings[0]!.domains[0]!;
    expect(d.lastError).toBeUndefined();
    expect(d.lastSyncedAt).toBeUndefined();
  });
});

describe('buildStatusReport — the notification channel (0043 T3)', () => {
  // Until this existed, the channel's state was one `log.info` at boot. An owner
  // who does not read container logs could not distinguish "nothing needs my
  // attention" from "the emails were never switched on" — two states that look
  // identical from the outside and mean opposite things.

  it('reports the channel as ON when it is enabled', () => {
    const report = buildStatusReport([], { enabled: true });
    expect(report.notifications).toEqual({ enabled: true });
  });

  it('reports OFF with the reason VERBATIM, not a paraphrase', () => {
    // The reason is the actionable part. `readNotifierConfig` distinguishes
    // nothing-set from half-set and names the missing variable; a summarised
    // reason is one an operator cannot act on (rule 9).
    const reason = 'SMTP_HOST is set but SMTP_FROM is missing';
    const report = buildStatusReport([], { enabled: false, reason });

    expect(report.notifications?.enabled).toBe(false);
    expect(report.notifications?.reason).toBe(reason);
  });

  it('says NOTHING when the caller has no channel to report', () => {
    // Deliberately absent rather than `enabled: false`. "Notifications are off"
    // and "nobody asked about notifications" are different claims, and only one
    // of them should send an owner hunting for a setting.
    const report = buildStatusReport([]);
    expect(report.notifications).toBeUndefined();
    expect('notifications' in report).toBe(false);
  });

  it('leaves the rest of the payload alone', () => {
    // The channel is additive: a caller that already read this payload must not
    // find its mappings moved or missing.
    const withChannel = buildStatusReport(
      [{ mappingId: 'inbox', migrationStatus: 'active', statuses: [status({ itemsSynced: 7 })] }],
      { enabled: true },
    );
    const without = buildStatusReport([
      { mappingId: 'inbox', migrationStatus: 'active', statuses: [status({ itemsSynced: 7 })] },
    ]);

    expect(withChannel.mappings).toEqual(without.mappings);
    expect(withChannel.status).toBe('ok');
  });
});

