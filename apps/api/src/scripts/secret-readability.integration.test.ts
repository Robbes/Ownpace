// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The four queries, against a database that has the columns.
 *
 * The unit suite beside this one proves the JUDGEMENT — that a rotation and a
 * corrupt column are told apart, and that no plaintext escapes. It cannot prove
 * the SQL, because a query is a string until something parses it. That
 * distinction is the whole reason `scripts/local-pg.sh` exists, and it was
 * earned: five housekeeping queries were written for `operator.sh check` on
 * 2026-09-01, every one reviewed and none executed, and the first run against a
 * real database found `connection.display_name` is NOT NULL in about a second.
 *
 * So this file asks the database the same four questions the operator command
 * asks, on the real migrated schema:
 *
 *  1. every `find` PARSES and runs — a column renamed by a migration fails here
 *     rather than in front of an operator at three in the morning;
 *  2. each returns exactly `id`, `label`, `ref`, because the runner reads no
 *     other columns and a check that returns more has a column nothing shows;
 *  3. `IS NOT NULL` really excludes the rows that hold no secret, which on a
 *     real deployment is most connections;
 *  4. a row encrypted under ANOTHER key is found, named, and called
 *     `wrong-key` — the incident, end to end, against Postgres.
 *
 * The last one is the point. Everything above it is the scaffolding that makes
 * it trustworthy.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { encryptSecret, serializeEncryptedSecret } from '@openmig/core/secrets';
import { SECRET_SITES, tallySite } from './secret-readability.ts';

const KEY_OURS = 'a'.repeat(64);
const KEY_THEIRS = 'b'.repeat(64);

/** Encrypt under a named key, whichever one is otherwise in force. */
function encryptWith(key: string, plaintext: string): string {
  const previous = process.env.SECRET_ENCRYPTION_KEY;
  process.env.SECRET_ENCRYPTION_KEY = key;
  try {
    return serializeEncryptedSecret(encryptSecret(plaintext));
  } finally {
    if (previous === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
    else process.env.SECRET_ENCRYPTION_KEY = previous;
  }
}

const url = process.env.TEST_DATABASE_URL;
const describeWithDb = url ? describe : describe.skip;

describeWithDb('the four queries run against the real schema', () => {
  let pool: Pool;
  const tenantId = randomUUID();
  const readableId = randomUUID();
  const rottedId = randomUUID();
  const nakedId = randomUUID();

  beforeAll(async () => {
    process.env.SECRET_ENCRYPTION_KEY = KEY_OURS;
    pool = new Pool({ connectionString: url });

    await pool.query(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [
      tenantId,
      'Readability Test Org',
    ]);

    // Three connections, and the third is the one that keeps the test honest:
    // a connection with NO stored secret at all, which several kinds
    // legitimately are. If `IS NOT NULL` were dropped it would be reported as
    // unreadable, and on a real deployment that is most of the rows.
    //
    // `webdav`, not `dav`: `connection_kind_check` enumerates the twenty kinds
    // and refuses anything else. The first draft of this file used `dav` and
    // the database said no — which is exactly the class of error a unit test
    // with a fake pool cannot reach, and the reason this file exists.
    await pool.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, secret_ref)
       VALUES ($1, $4, 'source', 'imap', 'reads fine',   '{}'::jsonb, $5),
              ($2, $4, 'source', 'imap', 'rotted away',  '{}'::jsonb, $6),
              ($3, $4, 'target', 'webdav', 'no secret',  '{}'::jsonb, NULL)`,
      [
        readableId,
        rottedId,
        nakedId,
        tenantId,
        encryptWith(KEY_OURS, 'still-readable'),
        encryptWith(KEY_THEIRS, 'lost-to-a-rotation'),
      ],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM connection WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
    await pool.end();
    delete process.env.SECRET_ENCRYPTION_KEY;
  });

  it('every site query parses, runs, and returns exactly id/label/ref', async () => {
    for (const site of SECRET_SITES) {
      const result = await pool.query(site.find);
      // `fields` is what the driver saw, so this is the database's own answer
      // about the shape rather than ours.
      expect(
        result.fields.map((f) => f.name).sort(),
        `${site.at} must return exactly id, label and ref — the runner reads no others.`,
      ).toEqual(['id', 'label', 'ref']);
    }
  });

  it('excludes the connection that stores no secret', async () => {
    const site = SECRET_SITES.find((s) => s.at === 'connection.secret_ref')!;
    const { rows } = await pool.query<{ id: string }>(site.find);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(readableId);
    expect(ids).toContain(rottedId);
    expect(
      ids,
      'A null secret_ref is not a failure — the credential is a location, or the\n' +
        'deployment carries the client. Counting those would bury the real findings.',
    ).not.toContain(nakedId);
  });

  it('finds the row encrypted under another key, names it, and calls it wrong-key', async () => {
    // The incident, end to end. Both rows are well-formed envelopes; only the
    // key that wrote one of them is gone.
    const site = SECRET_SITES.find((s) => s.at === 'connection.secret_ref')!;
    const { rows } = await pool.query<{ id: string; label: string; ref: string }>(site.find);
    const tally = tallySite(site, rows);

    expect(tally.unreadable).toHaveLength(1);
    const found = tally.unreadable[0]!;
    expect(found.id).toBe(rottedId);
    expect(found.verdict).toBe('wrong-key');
    expect(
      found.label,
      'The label is the entire value of this check: an operator who knows a secret is\n' +
        'unreadable but not WHICH one is exactly where the incident left us.',
    ).toContain('rotted away');
    expect(found.label).toContain('Readability Test Org');
    expect(found.remedy).toContain('Re-enter the credentials');
  });

  it('reports the readable row as readable, so the check can be believed', async () => {
    // A check that flagged everything would also "find" the real one. The
    // negative half is what makes the positive half mean something.
    const site = SECRET_SITES.find((s) => s.at === 'connection.secret_ref')!;
    const { rows } = await pool.query<{ id: string; label: string; ref: string }>(site.find);
    const tally = tallySite(site, rows);
    expect(tally.checked).toBe(2);
    expect(tally.unreadable.map((u) => u.id)).not.toContain(readableId);
  });

  it('puts no plaintext and no ciphertext into what it reports', async () => {
    const site = SECRET_SITES.find((s) => s.at === 'connection.secret_ref')!;
    const { rows } = await pool.query<{ id: string; label: string; ref: string }>(site.find);
    const rendered = JSON.stringify(tallySite(site, rows));
    expect(rendered).not.toContain('still-readable');
    expect(rendered).not.toContain('lost-to-a-rotation');

    // The ciphertext FIELD, for the reason the unit suite records: `row.ref` is
    // JSON, so re-stringifying escapes its quotes and comparing against the
    // whole envelope asserts nothing at all.
    for (const row of rows) {
      const ciphertext = (JSON.parse(row.ref) as { c: string }).c;
      expect(ciphertext.length).toBeGreaterThan(8);
      expect(rendered).not.toContain(ciphertext);
    }
  });
});
