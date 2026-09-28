// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REPORT THAT KNOWS THE MICROSOFT ACCOUNT (workplan 0141 T11).
 *
 * A tester who presses *Connect with Microsoft* gets a `microsoft` connection,
 * and the Finish page's permission list is this report. It looked for the
 * tenant's Microsoft source by `kind = 'o365'` alone, found nothing, and its
 * calendar section said *"this tenant has no Microsoft 365 source connection,
 * and only Graph can enumerate a directory"*. The tenant has one. The owner
 * test runbook's stage 8 records that sentence as step 8's failure.
 *
 * What is true instead:
 *
 * - **a Microsoft account**: its grant is delegated, and reads the signed-in
 *   person's own data. The directory, other people's mailboxes and calendar
 *   sharing need an administrator's registration. That holds whatever this
 *   deployment's environment says;
 * - **the customer's own registration (`o365`)**: the operator's sentence names
 *   this stack's `OAUTH2_*` settings. A tester reads that this deployment does
 *   not yet read a directory with the organisation's own registration.
 *
 * Run through `tenantInventoryScans`, which the report and the sharing queue's
 * rescan both call. The pool is a fake that FILTERS rows by the kinds each
 * query passes, as `a-share-scan-that-never-ran` does: a lookup narrowed back
 * to `o365` finds nothing here, just as Postgres did. It is the request path's
 * pool (`getDbPool`), answering on a client as `withTenant` uses one (0138 T6).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MICROSOFT_ACCOUNT_IS_DELEGATED } from '@openmig/connectors';

/** A stored connection row, as the fake pool holds it. */
interface Row {
  readonly kind: string;
  readonly secret_ref: string | null;
  readonly config: unknown;
}

const h = vi.hoisted(() => ({
  connections: [] as Array<{ kind: string; secret_ref: string | null; config: unknown }>,
  queries: [] as Array<{ text: string; values: readonly unknown[] }>,
}));

vi.mock('pg', () => ({
  Pool: class {
    async connect() {
      return {
        async query(q: string | { text: string }, values: readonly unknown[] = []) {
          const text = typeof q === 'string' ? q : q.text;
          // `withTenant`'s own statements: the transaction and its tenant.
          if (!text.includes('FROM connection')) return { rows: [] };
          h.queries.push({ text, values });
          const rows = h.connections.filter((c) => {
            if (text.includes('kind = ANY($2::text[])'))
              return (values[1] as readonly string[]).includes(c.kind);
            if (text.includes("kind IN ('nextcloud', 'webdav')"))
              return c.kind === 'nextcloud' || c.kind === 'webdav';
            return false;
          });
          // Every matching row unless the query itself asks for one.
          return { rows: text.includes('LIMIT 1') ? rows.slice(0, 1) : rows };
        },
        release() {},
      };
    }
    async end() {}
  },
}));

// The request path's pool is the fake above.
vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const { Pool } = await import('pg');
  return {
    ...(await importOriginal<typeof import('../middleware/auth.ts')>()),
    getDbPool: () => new Pool(),
  };
});

const { tenantInventoryScans, O365_NOT_READ_WITH_ITS_OWN_REGISTRATION } = await import(
  './permissions.ts'
);

const TENANT = '01410000-e29b-41d4-a716-446655441101';
const MAILBOX = 'someone@example.test';

/** What Connect with Microsoft stores: the kind and the address, no tenant. */
const microsoftAccount = (): Row => ({
  kind: 'microsoft',
  secret_ref: null,
  config: { type: 'microsoft', user: MAILBOX },
});

/** The customer's own registration, as the wizard's Graph path stores it. */
const ownRegistration = (): Row => ({
  kind: 'o365',
  secret_ref: null,
  config: { type: 'graph-mail', tenantId: 'contoso.onmicrosoft.test', mailbox: MAILBOX },
});

/** A Connect-with-Google row. */
const googleAccount = (): Row => ({
  kind: 'google',
  secret_ref: null,
  config: { credentials: { refreshToken: 'rt-not-a-real-token' } },
});

const reasonOf = (listing: { kind: string; reason?: string }): string =>
  listing.kind === 'not_discoverable' ? (listing.reason ?? '') : '';

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
  h.connections.length = 0;
  h.queries.length = 0;
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('the lookup finds a Microsoft source by every Microsoft kind', () => {
  it('asks for the account kind and the registration kind together', async () => {
    await tenantInventoryScans(TENANT, MAILBOX);
    const lookup = h.queries.find(
      (q) =>
        q.text.includes('kind = ANY($2::text[])') &&
        (q.values[1] as readonly string[]).includes('o365'),
    );
    expect(lookup, 'the Microsoft source is still looked up by one kind').toBeDefined();
    expect(lookup!.values[1]).toEqual(expect.arrayContaining(['microsoft', 'o365']));
  });
});

describe('a tenant whose Microsoft source is a Microsoft account', () => {
  it('is told the grant is delegated, not that it has no Microsoft 365 source', async () => {
    h.connections.push(microsoftAccount());
    const { scanCalendars } = await tenantInventoryScans(TENANT, MAILBOX);
    const reason = reasonOf(await scanCalendars());
    expect(reason, 'the calendar section still says the tenant has no Microsoft source').not.toContain(
      'no Microsoft 365 source connection',
    );
    expect(reason).toContain(MICROSOFT_ACCOUNT_IS_DELEGATED);
    // Said as a blind spot, like every other section that could not look.
    expect(reason).toContain('could not be inventoried');
  });

  it('is told the same with an application registration in this environment', async () => {
    // The stack's registration does not change what one person's grant reads,
    // and without a tenant on the row there is nothing to point it at.
    process.env.OAUTH2_CLIENT_ID = 'app-id';
    process.env.OAUTH2_CLIENT_SECRET = 'not-a-real-secret';
    h.connections.push(microsoftAccount());
    const { scanCalendars } = await tenantInventoryScans(TENANT, MAILBOX);
    expect(reasonOf(await scanCalendars())).toContain(MICROSOFT_ACCOUNT_IS_DELEGATED);
  });

  it('gets the same reason for files, once the file scope is consented', async () => {
    process.env.GRAPH_FILES_READ_CONSENTED = 'true';
    h.connections.push(microsoftAccount());
    const { scanDrive } = await tenantInventoryScans(TENANT, MAILBOX);
    expect(reasonOf(await scanDrive())).toContain(MICROSOFT_ACCOUNT_IS_DELEGATED);
  });

  it('keeps the Microsoft answers beside a Google account', async () => {
    // "No Microsoft source" was read from a missing tenant id, which a
    // Microsoft account never stores, so this tenant got Google's sentences.
    h.connections.push(googleAccount(), microsoftAccount());
    const { scanCalendars, delegationReason } = await tenantInventoryScans(TENANT, MAILBOX);
    const reason = reasonOf(await scanCalendars());
    expect(reason).toContain(MICROSOFT_ACCOUNT_IS_DELEGATED);
    expect(reason).not.toContain('Google Calendar');
    expect(delegationReason).toContain('Get-MailboxPermission');
  });
});

describe("a tenant with the customer's own registration", () => {
  it("reads the tester's sentence, not this stack's settings", async () => {
    h.connections.push(ownRegistration());
    const { scanCalendars } = await tenantInventoryScans(TENANT, MAILBOX);
    const reason = reasonOf(await scanCalendars());
    expect(reason).toContain(O365_NOT_READ_WITH_ITS_OWN_REGISTRATION);
    expect(reason, "an operator's variable reached the Finish page").not.toContain('OAUTH2_');
  });

  it('is the source asked when the tenant also has a Microsoft account', async () => {
    // The registration is the one kind that can hold application permissions.
    h.connections.push(microsoftAccount(), ownRegistration());
    const { scanCalendars } = await tenantInventoryScans(TENANT, MAILBOX);
    const reason = reasonOf(await scanCalendars());
    expect(reason).toContain(O365_NOT_READ_WITH_ITS_OWN_REGISTRATION);
    expect(reason).not.toContain(MICROSOFT_ACCOUNT_IS_DELEGATED);
  });

  it('says it for files too, once the file scope is consented', async () => {
    process.env.GRAPH_FILES_READ_CONSENTED = 'true';
    h.connections.push(ownRegistration());
    const { scanDrive } = await tenantInventoryScans(TENANT, MAILBOX);
    expect(reasonOf(await scanDrive())).toContain(O365_NOT_READ_WITH_ITS_OWN_REGISTRATION);
  });
});

describe('a tenant with no Microsoft source', () => {
  it('still says so, which is true', async () => {
    h.connections.push({ kind: 'imap', secret_ref: null, config: {} });
    const { scanCalendars } = await tenantInventoryScans(TENANT, MAILBOX);
    expect(reasonOf(await scanCalendars())).toContain('no Microsoft 365 source connection');
  });
});
