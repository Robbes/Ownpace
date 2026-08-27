// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The revocation reads the column the credentials are actually in (0085 T4a).
 *
 * It read `encrypted_credentials`. That column exists — baseline migration,
 * never dropped — but nothing has written it for a long time: every write path
 * stores `secret_ref`, and so does every read on the live sync side. So the
 * revocation found NULL on every row and recorded *"No credentials were stored
 * for this connection."* for every connection, always. Google's revocation is
 * the one that genuinely withdraws a token, and it never ran — while the
 * erasure record told the customer there had been nothing to revoke.
 *
 * That is the failure T4a was written to avoid, with the sign flipped: not a
 * false success, a false "nothing to do". Which stops the customer acting just
 * as effectively, and is harder to doubt.
 *
 * The pool is a stub because the interesting behaviour is entirely in which
 * column is read and what is done with it — a real database would prove the
 * SQL parses and nothing about the bug.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  revokeStoredCredentials,
  type QueryableForRevocation,
} from './revoke-stored-credentials.ts';
import type { RevocationOutcome, TokenRevoker } from '@openmig/shared';

vi.mock('@openmig/core/secret-store', () => ({
  SecretStore: {
    decryptCredentials: (stored: string) => {
      if (stored === 'undecryptable') throw new Error('bad key');
      return { refresh_token: `decrypted:${stored}` };
    },
  },
}));

type Row = { kind: string; secret_ref: string | null; legacy_credentials: string | null };

function poolOf(rows: Row[]): { pool: QueryableForRevocation; sql: string[] } {
  const sql: string[] = [];
  const pool = {
    query: (text: string) => {
      sql.push(text);
      return Promise.resolve({ rows });
    },
  } as unknown as QueryableForRevocation;
  return { pool, sql };
}

const recording = (): TokenRevoker & { seen: Array<Record<string, string>> } => {
  const seen: Array<Record<string, string>> = [];
  return {
    seen,
    revoke: (input: { kind: string; credentials: Record<string, string> }) => {
      seen.push(input.credentials);
      return Promise.resolve<RevocationOutcome>({
        kind: input.kind,
        status: 'revoked',
        reason: 'withdrawn at the provider',
      });
    },
  };
};

describe('which column the credentials are read from', () => {
  it('revokes what is stored in secret_ref — the column everything writes', async () => {
    const { pool } = poolOf([{ kind: 'google', secret_ref: 'sr', legacy_credentials: null }]);
    const revoker = recording();
    const out = await revokeStoredCredentials(pool, 't', revoker);

    // Before the fix this was `no_credential`, for every connection, always.
    expect(out).toEqual([
      { kind: 'google', status: 'revoked', reason: 'withdrawn at the provider' },
    ]);
    expect(revoker.seen).toEqual([{ refresh_token: 'decrypted:sr' }]);
  });

  it('asks for both columns, so an old deployment is not silently skipped', async () => {
    const { pool, sql } = poolOf([]);
    await revokeStoredCredentials(pool, 't', recording());
    expect(sql[0]).toMatch(/secret_ref/);
    expect(sql[0]).toMatch(/encrypted_credentials/);
  });

  it('falls back to the legacy column when secret_ref is empty', async () => {
    const { pool } = poolOf([{ kind: 'google', secret_ref: null, legacy_credentials: 'old' }]);
    const revoker = recording();
    await revokeStoredCredentials(pool, 't', revoker);
    expect(revoker.seen).toEqual([{ refresh_token: 'decrypted:old' }]);
  });

  it('prefers secret_ref when both are present', async () => {
    const { pool } = poolOf([{ kind: 'google', secret_ref: 'sr', legacy_credentials: 'old' }]);
    const revoker = recording();
    await revokeStoredCredentials(pool, 't', revoker);
    expect(revoker.seen).toEqual([{ refresh_token: 'decrypted:sr' }]);
  });

  it('asks the MAPPING table too, or a migrator’s grant is erased and never withdrawn', async () => {
    // Migration 0032 put a credential on `mailbox_mapping` — the refresh token
    // a person granted through their own link. It is the single most important
    // token in the product to revoke, because it reaches a private
    // individual's own mailbox rather than an account the customer
    // administers. Reading only `connection` would delete it from our database
    // and leave it live at Google, with the erasure receipt reporting nothing
    // to revoke: this file's founding mistake, in a worse place.
    const { pool, sql } = poolOf([]);
    await revokeStoredCredentials(pool, 't', recording());
    expect(sql[0]).toMatch(/mailbox_mapping/);
    expect(sql[0]).toMatch(/source_secret_ref/);
    // Via its source connection, because the KIND is what decides how a token
    // is withdrawn — a mapping alone cannot say.
    expect(sql[0]).toMatch(/JOIN\s+connection/i);
  });

  it('revokes a mapping-held token under its source connection’s kind', async () => {
    // The union's second leg answers rows of the same shape; nothing
    // downstream has to know which table a credential came from.
    const { pool } = poolOf([
      { kind: 'gmail', secret_ref: 'the-connection', legacy_credentials: null },
      { kind: 'gmail', secret_ref: 'the-migrators-grant', legacy_credentials: null },
    ]);
    const revoker = recording();
    const out = await revokeStoredCredentials(pool, 't', revoker);
    expect(out).toHaveLength(2);
    expect(revoker.seen).toEqual([
      { refresh_token: 'decrypted:the-connection' },
      { refresh_token: 'decrypted:the-migrators-grant' },
    ]);
  });
});

describe('what it says when it genuinely cannot revoke', () => {
  it('reports no_credential only when there really is nothing stored', async () => {
    const { pool } = poolOf([{ kind: 'imap', secret_ref: null, legacy_credentials: null }]);
    const out = await revokeStoredCredentials(pool, 't', recording());
    expect(out[0]!.status).toBe('no_credential');
  });

  it('reports a failure rather than a silence when decryption breaks', async () => {
    // A credential we hold but cannot read is not "nothing stored" — the
    // customer still has a live grant and needs to be told so.
    const { pool } = poolOf([
      { kind: 'google', secret_ref: 'undecryptable', legacy_credentials: null },
    ]);
    const out = await revokeStoredCredentials(pool, 't', recording());
    expect(out[0]!.status).toBe('failed');
    expect(out[0]!.reason).toMatch(/could not be decrypted/i);
  });

  it('keeps going after one connection fails', async () => {
    const { pool } = poolOf([
      { kind: 'google', secret_ref: 'undecryptable', legacy_credentials: null },
      { kind: 'proton', secret_ref: 'sr', legacy_credentials: null },
    ]);
    const out = await revokeStoredCredentials(pool, 't', recording());
    expect(out.map((o) => o.status)).toEqual(['failed', 'revoked']);
  });
});
