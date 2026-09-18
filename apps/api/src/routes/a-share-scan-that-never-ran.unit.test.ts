// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SHARE SCAN THAT NEVER RAN.
 *
 * The owner, 2026-09-17, on a live Google-to-Nextcloud migration: the Sharing
 * page found no Google sharings. There were plenty. Two independent defects in
 * one lookup, and either alone is enough to empty the page.
 *
 * ## 1. It asked for a kind the column cannot hold
 *
 *     WHERE role = 'source' AND kind = 'google-drive'
 *
 * `connection.kind` is CHECK-constrained and spells it `google_drive`;
 * `google-drive` is the WIZARD's word. The query matched nothing for anybody —
 * not the `google` ACCOUNT kind he was running, and not the legacy Drive row it
 * was written for. `a-kind-the-column-cannot-hold.unit.test.ts` holds that half
 * against the database's own constraint.
 *
 * ## 2. It handed the connection's credentials straight to the builder
 *
 * A connection made through Connect with Google stores a refresh token and, on
 * a deployment that carries its own application (ADR-0041, owner decision
 * option B: *"store neither"*), no client pair at all. The builder demands all
 * three and throws — so even once the lookup found the row, the scan would have
 * answered with a refusal about missing credentials that are deliberately not
 * there.
 *
 * ## What a blind spot costs here
 *
 * Both failures land as `not_discoverable`, which is the honest shape — but the
 * sentence carried is written for a source that could not be READ, and an
 * operator working a cutover checklist reads an empty Sharing section as "no
 * sharing to worry about". That is hard rule 9's exact prohibition, arriving
 * the night before a cutover.
 *
 * ## Why this runs the real function
 *
 * `tenantInventoryScans` is what both the report and the sharing queue's rescan
 * call (ADR-0032), so it is the one place the answer can be wrong for both. The
 * pool is a fake that FILTERS the rows itself from the query it is given, which
 * is what makes these assertions sensitive to the parameter list rather than to
 * a string this file typed: narrow the lookup and the fake finds nothing, just
 * as Postgres did.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PermissionListing } from '@openmig/shared';

/** A stored connection row, as the fake pool holds it. */
interface Row {
  readonly kind: string;
  readonly secret_ref: string | null;
  readonly config: unknown;
}

const h = vi.hoisted(() => ({
  connections: [] as Array<{ kind: string; secret_ref: string | null; config: unknown }>,
  queries: [] as Array<{ text: string; values: readonly unknown[] }>,
  /** The credentials each Drive build was handed — the ADR-0041 evidence. */
  built: [] as Array<Record<string, string | undefined>>,
  listing: { kind: 'listed', grants: [] } as PermissionListing,
}));

vi.mock('pg', () => ({
  Pool: class {
    async query(text: string, values: readonly unknown[] = []) {
      h.queries.push({ text, values });
      const rows = h.connections.filter((c) => {
        if (text.includes("kind = 'o365'")) return c.kind === 'o365';
        if (text.includes('kind = ANY($2::text[])'))
          return (values[1] as readonly string[]).includes(c.kind);
        if (text.includes("kind IN ('nextcloud', 'webdav')"))
          return c.kind === 'nextcloud' || c.kind === 'webdav';
        return false;
      });
      return { rows: rows.slice(0, 1) };
    }
    async end() {}
  },
}));

// The real builder's REFUSAL is kept — it is half of what is under test — and
// only the network is taken away. A stub that accepted anything would pass
// whether or not the client was resolved, which is the defect itself.
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

const { tenantInventoryScans } = await import('./permissions.ts');

const TENANT = '02240000-e29b-41d4-a716-446655442001';
const MAILBOX = 'someone@example.test';

/** A Connect-with-Google row: a refresh token, and no client pair (ADR-0041 B). */
const accountRow = (): Row => ({
  kind: 'google',
  secret_ref: null,
  config: { credentials: { refreshToken: 'rt-not-a-real-token' } },
});

let saved: Record<string, string | undefined>;

beforeEach(() => {
  h.connections.length = 0;
  h.queries.length = 0;
  h.built.length = 0;
  saved = {
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  };
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('the lookup finds the connection the customer actually made', () => {
  it('asks for kinds, not for the wizard word', async () => {
    h.connections.push(accountRow());
    await tenantInventoryScans(TENANT, MAILBOX);
    const drive = h.queries.find((q) => q.text.includes('kind = ANY($2::text[])'));
    expect(drive, 'the Drive lookup is no longer a kind list').toBeDefined();
    const kinds = drive!.values[1] as readonly string[];
    expect(kinds).toContain('google');
    expect(kinds).toContain('google_drive');
    expect(
      kinds,
      "the lookup asks for 'google-drive', which connection.kind cannot hold — it is the " +
        'wizard word. This is the defect the owner hit: the query matches no row, ever.',
    ).not.toContain('google-drive');
  });

  it('scans the Drive of a google account connection', async () => {
    // With the deployment carrying the client, which is the shape Connect with
    // Google produces and the one that was broken twice over.
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'deployment-client-id.apps.googleusercontent.test';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'deployment-client-secret';
    h.connections.push(accountRow());

    const { scanDrive } = await tenantInventoryScans(TENANT, MAILBOX);
    const listing = await scanDrive();

    expect(
      listing.kind,
      'the scan did not run on a google account connection. ' +
        (listing.kind === 'not_discoverable' ? listing.reason : ''),
    ).toBe('listed');
    expect(h.built, 'no Drive source was built, so nothing was asked of Google').toHaveLength(1);
    expect(
      h.built[0]?.clientId,
      "the connection's credentials went to the builder unfilled. A Connect with Google " +
        'row stores NEITHER half of the client (ADR-0041, option B), so the deployment’s ' +
        'own pair has to be resolved in — otherwise the builder refuses for credentials ' +
        'that are deliberately absent.',
    ).toBe('deployment-client-id.apps.googleusercontent.test');
    expect(h.built[0]?.refreshToken, "the connection's own token was dropped").toBe(
      'rt-not-a-real-token',
    );
  });

  it("says Google calendar sharing is by hand, not Microsoft's app registration", async () => {
    // The same lookup decides the CALENDAR sentence, so a lookup that finds
    // nothing also hands a Google customer a reason about an Entra
    // registration they never had. Two wrong sections from one bad WHERE.
    h.connections.push(accountRow());
    const { scanCalendars } = await tenantInventoryScans(TENANT, MAILBOX);
    const listing = await scanCalendars();
    expect(listing.kind).toBe('not_discoverable');
    expect(listing.kind === 'not_discoverable' && listing.reason).toContain('Google Calendar');
  });
});

describe('a Google connection with no client anywhere says which way out', () => {
  it('answers with the resolver’s sentence rather than a builder throw', async () => {
    h.connections.push(accountRow());
    const { scanDrive } = await tenantInventoryScans(TENANT, MAILBOX);
    const listing = await scanDrive();

    expect(listing.kind).toBe('not_discoverable');
    const reason = listing.kind === 'not_discoverable' ? listing.reason : '';
    // The way forward, in the words every other Google door uses: either send
    // a pair or configure the deployment's. The builder's own refusal names
    // the STORED credential keys instead, which tells somebody to type a
    // secret into a connection that is not supposed to hold one.
    expect(
      reason,
      'the refusal is not the shared resolver’s. A Google door that answers in its own ' +
        'words is a door that can disagree with the other three.',
    ).toContain('GOOGLE_OAUTH_CLIENT_ID');
    expect(reason).toContain('could not be inventoried');
    expect(h.built, 'the builder was reached with no client, so it threw').toHaveLength(0);
  });
});

describe('the fake is not answering everything', () => {
  it('finds nothing when the tenant connected nothing', async () => {
    // Guards every assertion above: a fake that returned a row for any query
    // would make "it found the connection" meaningless.
    const { scanDrive } = await tenantInventoryScans(TENANT, MAILBOX);
    const listing = await scanDrive();
    expect(listing.kind).toBe('not_discoverable');
    expect(h.built).toHaveLength(0);
  });
});
