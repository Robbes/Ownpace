// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CLOSED ORGANISATION IS READ BY NOBODY (workplan 0085 T2; the owner's
 * report of 2026-09-28), where every reader of an account is built.
 *
 * The tick starts no pass for a closed organisation, and a pass under way
 * stops before its next data type. What remains is every task that builds its
 * readers without asking the tick: a pass or a retry that was already queued,
 * a discovery, a verification, a confirmation, an apply, a cutover's gate.
 * They all come through the two builders, so both refuse a closed
 * organisation by name, before any stored credential is decrypted. A reopen
 * sets the status back, and they build again.
 *
 * Against real Postgres, because the builders open their own connection from
 * the database URL. The control case, the same mappings in an open
 * organisation, has to be shown to BUILD: that is what the refusal stops. The
 * addresses are invented.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { createPgDb } from '@openmig/ledger';
import { SecretStore, initSecretStore } from '@openmig/core/secret-store';
import { isCredentialRefusal } from '@openmig/shared';
import { buildDepsFromMapping, buildDomainDepsFromMapping } from './build-deps-from-mapping.ts';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

// UUID family 0085c1b0-…, unused elsewhere in the repo.
const P = '0085c1b0-e29b-41d4-a716-4466554430';
const TENANT = `${P}01`;
const MAIL_SOURCE = `${P}11`;
const ACCOUNT_SOURCE = `${P}12`;
const TARGET = `${P}13`;
const MAIL_BOX = `${P}21`;
const ACCOUNT_BOX = `${P}22`;
const TARGET_BOX = `${P}23`;
const MAIL_MAPPING = `${P}31`;
const CALENDAR_MAPPING = `${P}32`;

const ORGANISATIONS_OWN = { clientId: 'cid', clientSecret: 'csec', refreshToken: '1//the-organisations-own' };

const closedRefusal = (error: unknown) =>
  isCredentialRefusal(error) && error.refusal.code === 'account_closed' ? error.refusal : null;

const outcomeOf = (built: Promise<{ close(): Promise<void> }>): Promise<unknown> =>
  built.then(
    async (deps) => {
      await deps.close();
      return null;
    },
    (error: unknown) => error,
  );

describe('a closed organisation', () => {
  let db: ReturnType<typeof createPgDb>;
  let pool: Pool;

  const setStatus = (status: 'active' | 'closed' | 'deleting') =>
    db.execute(sql`UPDATE tenant SET status = ${status} WHERE id = ${TENANT}`);

  beforeAll(async () => {
    process.env.SECRET_ENCRYPTION_KEY ??=
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    initSecretStore();
    db = createPgDb(TEST_DATABASE_URL);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const sealed = (creds: Record<string, string>) =>
      JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Example Closing BV', 'active')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, secret_ref, config, status) VALUES
        (${MAIL_SOURCE}, ${TENANT}, 'source', 'gmail', 'mail', ${sealed(ORGANISATIONS_OWN)},
         ${JSON.stringify({ type: 'gmail', user: 'sam@example.invalid' })}, 'connected'),
        (${ACCOUNT_SOURCE}, ${TENANT}, 'source', 'google', 'account', ${sealed(ORGANISATIONS_OWN)},
         ${JSON.stringify({ type: 'google', user: 'sam@example.invalid' })}, 'connected'),
        (${TARGET}, ${TENANT}, 'target', 'jmap', 'target',
         ${sealed({ user: 'sam@target.example.invalid', password: 'target-password' })},
         ${JSON.stringify({
           type: 'jmap',
           baseUrl: 'https://jmap.example.invalid',
           user: 'sam@target.example.invalid',
           auth: { kind: 'basic', passwordFromEnv: 'JMAP_PASSWORD' },
         })}, 'connected')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES
        (${MAIL_BOX}, ${TENANT}, ${MAIL_SOURCE}, 'user', 'sam@example.invalid'),
        (${ACCOUNT_BOX}, ${TENANT}, ${ACCOUNT_SOURCE}, 'user', 'sam@example.invalid'),
        (${TARGET_BOX}, ${TENANT}, ${TARGET}, 'user', 'sam@target.example.invalid')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status) VALUES
        (${MAIL_MAPPING}, ${TENANT}, ${MAIL_BOX}, ${TARGET_BOX}, 'mirror', 'active'),
        (${CALENDAR_MAPPING}, ${TENANT}, ${ACCOUNT_BOX}, ${TARGET_BOX}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING`);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.execute(sql`DELETE FROM mailbox_mapping WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM mailbox WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM connection WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM tenant WHERE id = ${TENANT}`);
    await pool.end();
  });

  it.each(['closed', 'deleting'] as const)(
    'is not built for mail while %s, the owner is told why in both languages, and nothing is decrypted',
    async (status) => {
      await setStatus(status);
      const decrypt = vi.spyOn(SecretStore, 'decryptCredentials');
      try {
        const refusal = closedRefusal(await outcomeOf(buildDepsFromMapping(pool, TENANT, MAIL_MAPPING)));
        expect(refusal, 'the mail reader was built for a closed organisation').not.toBeNull();
        expect(refusal?.en).toContain('This organisation was closed');
        expect(refusal?.nl).toContain('Deze organisatie is gesloten');
        expect(decrypt, 'a stored credential was decrypted for a closed organisation').not.toHaveBeenCalled();
      } finally {
        decrypt.mockRestore();
        await setStatus('active');
      }
    },
  );

  it('is not built for any other data type either, and nothing is decrypted', async () => {
    await setStatus('closed');
    const decrypt = vi.spyOn(SecretStore, 'decryptCredentials');
    try {
      const error = await outcomeOf(buildDomainDepsFromMapping(pool, TENANT, CALENDAR_MAPPING, 'calendar'));
      expect(closedRefusal(error)?.code).toBe('account_closed');
      expect(decrypt).not.toHaveBeenCalled();
    } finally {
      decrypt.mockRestore();
      await setStatus('active');
    }
  });

  it('reopened, both build again on the stored access: what the refusal stops', async () => {
    await setStatus('closed');
    await setStatus('active');
    expect(await outcomeOf(buildDepsFromMapping(pool, TENANT, MAIL_MAPPING))).toBeNull();
    // Built, or refused for a reason of its own; never for the close.
    expect(closedRefusal(await outcomeOf(buildDomainDepsFromMapping(pool, TENANT, CALENDAR_MAPPING, 'calendar')))).toBeNull();
  });
});
