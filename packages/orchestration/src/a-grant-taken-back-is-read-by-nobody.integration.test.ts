// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT TAKEN BACK IS READ BY NOBODY (workplan 0108 T8 (c), ledger migration
 * 0063), where every reader of a source is built.
 *
 * Withdrawing deletes the grant the person gave through their link. What is
 * left is the connection's own keys, and where the connection holds a token of
 * its own, the builders would open the account on it: the one thing the person
 * has just said no to, with no line anywhere saying so. So both builders, the
 * mail one and the one for every other data type, refuse a mapping whose grant
 * was withdrawn, by name, before any credential is merged.
 *
 * Against real Postgres, because the refusal reads the mapping's own row, and
 * because the control case, the same mapping with no withdrawal, has to be
 * shown to BUILD on the organisation's token: that is the fallback the
 * refusal exists to stop. The addresses are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

// UUID family 6a6c0000-…, unused elsewhere in the repo.
const P = '6a6c0000-e29b-41d4-a716-4466554430';
const TENANT = `${P}01`;
const MAIL_SOURCE = `${P}11`;
const ACCOUNT_SOURCE = `${P}12`;
const TARGET = `${P}13`;
const MAIL_BOX = `${P}21`;
const ACCOUNT_BOX = `${P}22`;
const TARGET_BOX = `${P}23`;
const MAIL_MAPPING = `${P}31`;
const CALENDAR_MAPPING = `${P}32`;

const WITHDRAWN_AT = '2026-09-24T06:00:00.000Z';
/** The organisation's own credential, on the connection, which a withdrawal leaves alone. */
const ORGANISATIONS_OWN = { clientId: 'cid', clientSecret: 'csec', refreshToken: '1//the-organisations-own' };

const withdrawnRefusal = (error: unknown) =>
  isCredentialRefusal(error) && error.refusal.code === 'grant_withdrawn' ? error.refusal : null;

describe('a grant the person took back', () => {
  let db: ReturnType<typeof createPgDb>;
  let pool: Pool;

  const setWithdrawn = (at: string | null) =>
    db.execute(sql`
      UPDATE mailbox_mapping SET grant_withdrawn_at = ${at}::timestamptz
       WHERE id IN (${MAIL_MAPPING}, ${CALENDAR_MAPPING})`);

  beforeAll(async () => {
    process.env.SECRET_ENCRYPTION_KEY ??=
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    initSecretStore();
    db = createPgDb(TEST_DATABASE_URL);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const sealed = (creds: Record<string, string>) =>
      JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Example Care BV', 'active')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, secret_ref, config, status) VALUES
        (${MAIL_SOURCE}, ${TENANT}, 'source', 'gmail', 'mail', ${sealed(ORGANISATIONS_OWN)},
         ${JSON.stringify({ type: 'gmail', user: 'pat@example.invalid' })}, 'connected'),
        (${ACCOUNT_SOURCE}, ${TENANT}, 'source', 'google', 'account', ${sealed(ORGANISATIONS_OWN)},
         ${JSON.stringify({ type: 'google', user: 'pat@example.invalid' })}, 'connected'),
        (${TARGET}, ${TENANT}, 'target', 'jmap', 'target',
         ${sealed({ user: 'pat@target.example.invalid', password: 'target-password' })},
         ${JSON.stringify({
           type: 'jmap',
           baseUrl: 'https://jmap.example.invalid',
           user: 'pat@target.example.invalid',
           auth: { kind: 'basic', passwordFromEnv: 'JMAP_PASSWORD' },
         })}, 'connected')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES
        (${MAIL_BOX}, ${TENANT}, ${MAIL_SOURCE}, 'user', 'pat@example.invalid'),
        (${ACCOUNT_BOX}, ${TENANT}, ${ACCOUNT_SOURCE}, 'user', 'pat@example.invalid'),
        (${TARGET_BOX}, ${TENANT}, ${TARGET}, 'user', 'pat@target.example.invalid')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status, grant_withdrawn_at) VALUES
        (${MAIL_MAPPING}, ${TENANT}, ${MAIL_BOX}, ${TARGET_BOX}, 'mirror', 'active', ${WITHDRAWN_AT}),
        (${CALENDAR_MAPPING}, ${TENANT}, ${ACCOUNT_BOX}, ${TARGET_BOX}, 'mirror', 'active', ${WITHDRAWN_AT})
      ON CONFLICT (id) DO NOTHING`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM mailbox_mapping WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM mailbox WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM connection WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM tenant WHERE id = ${TENANT}`);
    await pool.end();
  });

  it('is not built for mail, and the owner is told why, in both languages', async () => {
    await setWithdrawn(WITHDRAWN_AT);

    const refusal = withdrawnRefusal(
      await buildDepsFromMapping(pool, TENANT, MAIL_MAPPING).then(
        () => null,
        (error: unknown) => error,
      ),
    );

    expect(refusal?.en).toContain('withdrew their permission on 2026-09-24');
    expect(refusal?.nl).toContain('op 2026-09-24 de toegang ingetrokken');
  });

  it('is not built for any other data type either', async () => {
    await setWithdrawn(WITHDRAWN_AT);

    const error = await buildDomainDepsFromMapping(pool, TENANT, CALENDAR_MAPPING, 'calendar').then(
      () => null,
      (e: unknown) => e,
    );

    expect(withdrawnRefusal(error)?.code).toBe('grant_withdrawn');
  });

  it('without the withdrawal, the builder opens the account on the organisation’s own token: the fallback it stops', async () => {
    await setWithdrawn(null);
    try {
      const deps = await buildDepsFromMapping(pool, TENANT, MAIL_MAPPING);
      await deps.close();
      const other = await buildDomainDepsFromMapping(pool, TENANT, CALENDAR_MAPPING, 'calendar').then(
        async (d) => {
          await d.close();
          return null;
        },
        (e: unknown) => e,
      );
      // Built, or refused for a reason of its own; never for a withdrawal.
      expect(withdrawnRefusal(other)).toBeNull();
    } finally {
      await setWithdrawn(WITHDRAWN_AT);
    }
  });
});
