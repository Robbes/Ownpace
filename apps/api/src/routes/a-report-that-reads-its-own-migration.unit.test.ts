// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REPORT THAT READS ITS OWN MIGRATION (the owner, 2026-10-03).
 *
 * One organisation, two migrations: MS-2-NC, a Microsoft account into
 * Nextcloud, and Goog2NC, a Google account into Nextcloud. The Finish page of
 * the Microsoft migration offered *Get the permission list*, and the list it
 * fetched carried the Google account's Drive shares.
 *
 * The page asked for its own migration and the rows are stored per migration
 * (`share_grant`, ADR-0032), but the scans were resolved by
 * `tenantInventoryScans`: every Microsoft source in the organisation, its first
 * Google Drive source and its first DAV source, with Drive asked first. So a
 * Microsoft migration got Google's Drive, and a Google migration got
 * Microsoft's wording for its mailbox. `migrationInventoryScans` resolves the
 * migration's own source, migration → source mailbox → connection, as the pass
 * does (`loadDomainConnections`).
 *
 * The pool is a fake that answers the migration's join from its own tables and
 * FILTERS the organisation-wide lookups by the kinds each query passes, as
 * `a-share-scan-that-never-ran` does, so the control below shows the defect on
 * the very rows the fix is held to.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MICROSOFT_ACCOUNT_IS_DELEGATED } from '@openmig/connectors';
import type { PermissionListing } from '@openmig/shared';

/** A stored connection row. */
interface Connection {
  readonly id: string;
  readonly kind: string;
  readonly secret_ref: string | null;
  readonly config: unknown;
}

/** A migration, by the connection its source mailbox names (or none). */
interface Mapping {
  readonly id: string;
  readonly source: string | null;
  readonly override?: unknown;
  readonly grantWithdrawnAt?: Date;
}

const h = vi.hoisted(() => ({
  connections: [] as Connection[],
  mappings: [] as Mapping[],
  /** Each statement that reached the fake, with the organisation it was scoped to. */
  queries: [] as Array<{ text: string; values: readonly unknown[]; tenant: unknown }>,
  /** The credentials each Drive build was handed. */
  built: [] as Array<Record<string, string | undefined>>,
  listing: { kind: 'listed', grants: [] } as PermissionListing,
}));

vi.mock('pg', () => ({
  Pool: class {
    async connect() {
      let tenant: unknown;
      return {
        async query(q: string | { text: string }, values: readonly unknown[] = []) {
          const text = typeof q === 'string' ? q : q.text;
          if (text.includes("set_config('app.current_tenant'")) tenant = values[0];
          if (!text.includes('connection')) return { rows: [] };
          h.queries.push({ text, values, tenant });
          if (text.includes('mm.source_config_override')) {
            // The migration's own source: its mailbox's connection, or nothing
            // for a mailbox that names none.
            const mapping = h.mappings.find((m) => m.id === values[1]);
            const conn = h.connections.find((c) => c.id === mapping?.source);
            if (!mapping || !conn) return { rows: [] };
            return {
              rows: [
                {
                  kind: conn.kind,
                  config: conn.config,
                  secret_ref: conn.secret_ref,
                  override: mapping.override ?? null,
                  mapping_secret_ref: null,
                  grant_withdrawn_at: mapping.grantWithdrawnAt ?? null,
                },
              ],
            };
          }
          const rows = h.connections.filter((c) => {
            if (text.includes('kind = ANY($2::text[])'))
              return (values[1] as readonly string[]).includes(c.kind);
            if (text.includes("kind IN ('nextcloud', 'webdav')"))
              return c.kind === 'nextcloud' || c.kind === 'webdav';
            return false;
          });
          return { rows: text.includes('LIMIT 1') ? rows.slice(0, 1) : rows };
        },
        release() {},
      };
    }
    async end() {}
  },
}));

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const { Pool } = await import('pg');
  return {
    ...(await importOriginal<typeof import('../middleware/auth.ts')>()),
    getDbPool: () => new Pool(),
  };
});

// Only the network is taken away; the real builder's checks stay.
vi.mock('@openmig/orchestration/drive-source-factory', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@openmig/orchestration/drive-source-factory')>();
  return {
    ...actual,
    buildGoogleDriveSourceFrom: (
      endpoint: Parameters<typeof actual.buildGoogleDriveSourceFrom>[0],
      creds: Parameters<typeof actual.buildGoogleDriveSourceFrom>[1],
      naming: Parameters<typeof actual.buildGoogleDriveSourceFrom>[2],
    ) => {
      const source = actual.buildGoogleDriveSourceFrom(endpoint, creds, naming);
      h.built.push({ ...(creds as Record<string, string | undefined>) });
      return Object.assign(source, { listOwnedShareGrants: async () => h.listing });
    },
  };
});

const { migrationInventoryScans, tenantInventoryScans } = await import('./permissions.ts');

const TENANT = '0156a000-e29b-41d4-a716-446655440001';
const MAILBOX = 'rob@example.test';
const MS_2_NC = '0156a000-e29b-41d4-a716-446655440011';
const GOOG_2_NC = '0156a000-e29b-41d4-a716-446655440012';

/** Connect with Microsoft: one person's delegated grant. */
const MICROSOFT: Connection = {
  id: 'conn-microsoft',
  kind: 'microsoft',
  secret_ref: null,
  config: { type: 'microsoft', user: MAILBOX },
};

/** Connect with Google: a refresh token, and no client pair (ADR-0041 B). */
const GOOGLE: Connection = {
  id: 'conn-google',
  kind: 'google',
  secret_ref: null,
  config: { credentials: { refreshToken: 'rt-of-the-google-account' } },
};

const reasonOf = (listing: PermissionListing): string =>
  listing.kind === 'not_discoverable' ? listing.reason : '';

const ENV = [
  'OAUTH2_CLIENT_ID',
  'OAUTH2_CLIENT_SECRET',
  'OAUTH2_REFRESH_TOKEN',
  'GRAPH_FILES_READ_CONSENTED',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  h.queries.length = 0;
  h.built.length = 0;
  // The owner's organisation: both accounts connected, a migration on each.
  h.connections.splice(0, h.connections.length, MICROSOFT, GOOGLE);
  h.mappings.splice(
    0,
    h.mappings.length,
    { id: MS_2_NC, source: MICROSOFT.id },
    { id: GOOG_2_NC, source: GOOGLE.id },
  );
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  // The deployment carries the Google client, so a Drive scan can run at all.
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'deployment-client-id.apps.googleusercontent.test';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'deployment-client-secret';
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('the defect, on these rows', () => {
  it("the organisation-wide lookup gives a Microsoft mailbox the Google account's Drive", async () => {
    // The control: what the Finish page of MS-2-NC used to be handed.
    const { scanDrive } = await tenantInventoryScans(TENANT, MAILBOX);
    expect((await scanDrive()).kind).toBe('listed');
    expect(h.built.map((c) => c.refreshToken)).toEqual(['rt-of-the-google-account']);
  });
});

describe('a Microsoft migration beside a Google one', () => {
  it("reads no Google Drive: its file section is its own source's", async () => {
    process.env.GRAPH_FILES_READ_CONSENTED = 'true';
    const { scanDrive } = await migrationInventoryScans(TENANT, MS_2_NC, MAILBOX);
    const listing = await scanDrive();

    expect(h.built, "the Google account's Drive was read for a Microsoft migration").toEqual([]);
    expect(reasonOf(listing)).toContain(MICROSOFT_ACCOUNT_IS_DELEGATED);
  });

  it("keeps Exchange's words for its mailbox and Microsoft's for its calendars", async () => {
    const { scanCalendars, delegationReason } = await migrationInventoryScans(
      TENANT,
      MS_2_NC,
      MAILBOX,
    );
    expect(delegationReason).toContain('Get-MailboxPermission');
    expect(reasonOf(await scanCalendars())).toContain(MICROSOFT_ACCOUNT_IS_DELEGATED);
  });
});

describe('a Google migration beside a Microsoft one', () => {
  it("gets Google's sentences, not Exchange's", async () => {
    const { scanCalendars, delegationReason } = await migrationInventoryScans(
      TENANT,
      GOOG_2_NC,
      MAILBOX,
    );
    // With a Microsoft row anywhere in the organisation, the lookup used to
    // give a Gmail account Exchange PowerShell to run.
    expect(delegationReason).toContain('Gmail delegation');
    expect(delegationReason).not.toContain('Get-MailboxPermission');
    const calendars = reasonOf(await scanCalendars());
    expect(calendars).toContain('Google Calendar');
    expect(calendars).not.toContain(MICROSOFT_ACCOUNT_IS_DELEGATED);
  });

  it("scans its own account's Drive, with the deployment's client resolved in", async () => {
    const { scanDrive } = await migrationInventoryScans(TENANT, GOOG_2_NC, MAILBOX);
    expect((await scanDrive()).kind).toBe('listed');
    expect(h.built).toHaveLength(1);
    expect(h.built[0]?.refreshToken).toBe('rt-of-the-google-account');
    expect(h.built[0]?.clientId).toBe('deployment-client-id.apps.googleusercontent.test');
  });
});

describe('what else the migration says', () => {
  it('a withdrawn grant reads nothing, and no credential is opened', async () => {
    // A secret that cannot be decrypted: opening it would throw here.
    h.connections.splice(1, 1, { ...GOOGLE, secret_ref: 'not-a-decryptable-secret' });
    h.mappings.splice(1, 1, {
      id: GOOG_2_NC,
      source: GOOGLE.id,
      grantWithdrawnAt: new Date('2026-10-01T09:00:00Z'),
    });

    const { scanDrive, scanCalendars } = await migrationInventoryScans(TENANT, GOOG_2_NC, MAILBOX);
    for (const listing of [await scanDrive(), await scanCalendars()]) {
      expect(reasonOf(listing)).toContain('withdrew their permission on 2026-10-01');
    }
    expect(h.built).toEqual([]);
  });

  it("a migration whose mailbox names no connection keeps the organisation's answer", async () => {
    // A row older than `mailbox.connection_id`: the pass falls back the same way.
    h.mappings.splice(0, 1, { id: MS_2_NC, source: null });
    const { scanDrive } = await migrationInventoryScans(TENANT, MS_2_NC, MAILBOX);
    expect((await scanDrive()).kind).toBe('listed');
    expect(h.queries.some((q) => q.text.includes("role = 'source'"))).toBe(true);
  });

  it('asks every question inside the organisation it was asked for (0138 T6)', async () => {
    await migrationInventoryScans(TENANT, GOOG_2_NC, MAILBOX);
    expect(h.queries.length).toBeGreaterThan(0);
    for (const q of h.queries) {
      expect(q.tenant, `asked outside withTenant for ${TENANT}:\n${q.text}`).toBe(TENANT);
    }
  });
});
