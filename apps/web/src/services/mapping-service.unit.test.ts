// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The mapping schemas against the ROUTES' literal responses (0033 T1).
 *
 * Every fixture here is a copy of what the corresponding route mapper in
 * apps/api/src/routes/migrations/index.ts actually builds — not a hand-built
 * ideal. That is the point: the previous MappingSchema described a payload no
 * route ever sent (required configs the list never serves, a tenantId key the
 * list spelled tenant_id, a status enum the DB CHECK forbids), so the parse
 * threw on EVERY non-empty list and on every successful create — and the
 * failure was invisible because a failed read rendered as an empty table.
 * If a route's shape changes, change the fixture HERE by copying the route's
 * mapper again, and let the schema fail until it matches.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  MappingListItemSchema,
  MappingSchema,
  CreateMappingResponseSchema,
} from './mapping-service';

/** GET /migrations — one list item per real lifecycle state, as the route
 *  mapper builds them (index.ts, the res.json({mappings: ...}) block). */
const listFixture = (['active', 'paused', 'cutover', 'done'] as const).map(
  (status, i) => ({
    id: `mapping-${i}`,
    tenantId: 'tenant-1',
    name: `Mailbox ${i}`,
    sourceType: 'o365',
    targetType: 'jmap',
    status,
    mode: 'mirror',
    pattern: i === 0 ? 'shared_s' : null,
    domains: ['email', 'calendar'],
    // lastSyncAt is absent until a domain completes — the route omits the key.
    ...(i % 2 === 0 ? { lastSyncAt: '2026-08-09T10:00:00.000Z' } : {}),
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
  }),
);

/** GET /migrations/:id — as the detail route builds it, including the
 *  'unknown' fallback for a missing connection row, the masked password,
 *  and the domainStatus rows from PgMigrationStatusStore.getStatus. */
const detailFixture = {
  id: 'mapping-0',
  tenantId: 'tenant-1',
  name: 'Mailbox 0',
  sourceType: 'o365',
  targetType: 'unknown', // connection row missing — the route's ?? 'unknown'
  sourceConfig: {
    host: 'outlook.office365.com',
    port: 993,
    useSsl: true,
    username: 'user@acme.nl',
    password: '***',
  },
  targetConfig: {
    // missing connection: the route spreads {} and username is undefined
    password: '***',
  },
  syncConfig: { domains: ['email'], schedule: '0 2 * * *' },
  status: 'cutover',
  mode: 'mirror',
  pattern: null,
  domainStatus: [
    {
      // getStatus rows carry id/tenantId/mappingId too; z.object strips them,
      // which is fine — what must NOT be stripped is the block the hub renders.
      id: 'status-1',
      tenantId: 'tenant-1',
      mappingId: 'mapping-0',
      domain: 'email',
      state: 'in_progress',
      itemsSynced: 42,
      itemsFailed: 3,
      bytesTransferred: 1024,
      startedAt: '2026-08-09T09:00:00.000Z',
      updatedAt: '2026-08-09T10:00:00.000Z',
      completedAt: '2026-08-09T10:00:00.000Z',
      lastError: 'IMAP LIST failed: connection reset',
      lastPassMetrics: {
        items: 42,
        wallMs: 1000,
        sourceFetchMs: 400,
        targetWriteMs: 300,
        ledgerMs: 100,
        hashMs: 50,
        overlap: 2.1,
      },
    },
  ],
  lastSyncAt: '2026-08-09T10:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
};

/** POST /migrations 201 — as the create route answers (no configs; the
 *  wizard's own source/target vocabulary echoed back). */
const createFixture = {
  id: 'mapping-new',
  tenantId: 'tenant-1',
  name: 'New mailbox',
  sourceType: 'oauth2',
  targetType: 'jmap',
  status: 'paused', // 0013 T5: new mappings land paused
  mode: 'mirror',
  syncConfig: { domains: ['email'], schedule: '0 2 * * *' },
  createdAt: '2026-08-09T12:00:00.000Z',
  updatedAt: '2026-08-09T12:00:00.000Z',
};

describe('MappingListItemSchema vs the list route', () => {
  it('parses a list with one mapping in each of the four real states', () => {
    const parsed = z.array(MappingListItemSchema).parse(listFixture);
    expect(parsed.map((m) => m.status)).toEqual(['active', 'paused', 'cutover', 'done']);
    expect(parsed[0]!.domains).toEqual(['email', 'calendar']);
    expect(parsed[1]!.lastSyncAt).toBeUndefined();
  });

  it('rejects the OLD route shape (tenant_id, hardcoded types, no domains) — the drift alarm', () => {
    // This is what the route sent before 0033 T1. If someone regresses the
    // route, the client must fail loudly at the parse (and T2 renders that
    // failure), never render an empty table.
    const oldShape = {
      id: 'm1',
      tenant_id: 'tenant-1',
      name: 'Mailbox',
      sourceType: 'imap',
      targetType: 'jmap',
      status: 'active',
      mode: 'mirror',
      pattern: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
    expect(() => z.array(MappingListItemSchema).parse([oldShape])).toThrow();
  });

  it('rejects lifecycle words the DB CHECK forbids', () => {
    // Mutation check for the tile filters: 'completed'/'error'/'draft' are not
    // mapping states; a fixture carrying one must fail the parse so no screen
    // can count them again.
    for (const impossible of ['draft', 'completed', 'error']) {
      expect(() =>
        MappingListItemSchema.parse({ ...listFixture[0], status: impossible }),
      ).toThrow();
    }
  });
});

describe('MappingSchema vs the detail route', () => {
  it('parses the detail payload, including unknown target and masked configs', () => {
    const parsed = MappingSchema.parse(detailFixture);
    expect(parsed.targetType).toBe('unknown');
    expect(parsed.sourceConfig.password).toBe('***');
  });

  it('does NOT strip domainStatus — the hub renders it (z.object strips unknown keys)', () => {
    const parsed = MappingSchema.parse(detailFixture);
    expect(parsed.domainStatus).toHaveLength(1);
    expect(parsed.domainStatus[0]).toMatchObject({
      domain: 'email',
      state: 'in_progress',
      itemsSynced: 42,
      itemsFailed: 3,
      lastError: 'IMAP LIST failed: connection reset',
      completedAt: '2026-08-09T10:00:00.000Z',
    });
  });
});

describe('CreateMappingResponseSchema vs the 201 body', () => {
  it('parses the create response, so a SUCCESSFUL create reaches onSuccess', () => {
    const parsed = CreateMappingResponseSchema.parse(createFixture);
    expect(parsed.id).toBe('mapping-new');
    expect(parsed.status).toBe('paused');
  });

  it('the 201 body does NOT satisfy the detail schema — the mismatch that made success look like failure', () => {
    // Pinned so nobody "simplifies" create back to MappingSchema.parse: the
    // 201 carries no configs and no domainStatus, and parsing it with the
    // detail schema is exactly the bug that swallowed every successful create.
    expect(() => MappingSchema.parse(createFixture)).toThrow();
  });
});
