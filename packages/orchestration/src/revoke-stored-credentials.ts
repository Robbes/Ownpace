// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Provider-side revocation for every credential a tenant stored (0085 T4a),
 * in ONE implementation both editions call (0085 T9, hard rule 5).
 *
 * ## Why this moved out of the purge job
 *
 * It lived as a private function inside `managed-purge-closed.ts`. The
 * appliance needs exactly the same thing — `docker compose down -v` deletes our
 * copy of a credential and does nothing whatever to the grant it authenticates
 * with — and a second, slightly different copy of this is how the two editions
 * start disagreeing about what "forgotten" means.
 *
 * ## The bug that came out with it
 *
 * The original read `encrypted_credentials`. That column exists — it is in the
 * baseline migration and was never dropped — but **nothing has written to it
 * for a long time**: every write path stores `secret_ref` (the API's two
 * connection routes, the seed), and every read path on the live sync side reads
 * `secret_ref`.
 *
 * So the revocation found NULL on every row and recorded `no_credential`:
 * *"No credentials were stored for this connection."* For every connection.
 * Always. Google's revocation is the one provider where a token can genuinely
 * be withdrawn, and it never ran — while the erasure record told the customer
 * there had been nothing to revoke.
 *
 * That is worse than the failure T4a was written to avoid. The workplan's own
 * argument was that *"a row of green ticks, four-fifths of them nothing, would
 * be worse than no revocation at all, because it would stop the customer doing
 * the one thing that works."* This was the same mistake with the sign flipped:
 * not a false success, a false "nothing to do" — which stops the customer just
 * as effectively, and is harder to doubt.
 *
 * Both columns are read now, `secret_ref` first. The legacy one is still there
 * and a deployment old enough to have used it should not be silently skipped
 * on the one operation that cannot be repeated after the rows are gone.
 */

import { SecretStore } from '@openmig/core/secret-store';
import type { RevocationOutcome, TokenRevoker } from '@openmig/shared';

/**
 * Just enough of a database to ask one question.
 *
 * Structural rather than `pg.Pool` because the appliance may be running PGlite,
 * where there is no server to hold a pool to — and a function only one edition
 * can call is not the shared implementation this was extracted to be. Both
 * `pg.Pool` and the ledger's own connection satisfy this shape.
 */
export interface QueryableForRevocation {
  query<T>(text: string, params: unknown[]): Promise<{ rows: T[] }>;
}

interface CredentialRow {
  readonly kind: string;
  readonly secret_ref: string | null;
  readonly legacy_credentials: string | null;
}

/**
 * Revoke what can be revoked, and say honestly what could not.
 *
 * Best effort by design, and never a reason to refuse an erasure: a provider
 * being down must not keep somebody on the books. Each outcome carries its own
 * reason so the receipt can say *"we could not revoke this one — go and
 * withdraw it yourself"* rather than implying something happened.
 *
 * Must run BEFORE the rows are deleted: it needs the credentials the purge is
 * about to destroy. That ordering is the caller's to get right, which is why
 * this takes a database and does no deleting of its own.
 */
export async function revokeStoredCredentials(
  db: QueryableForRevocation,
  tenantId: string,
  revoker: TokenRevoker,
): Promise<RevocationOutcome[]> {
  const { rows } = await db.query<CredentialRow>(
    `SELECT kind, secret_ref, encrypted_credentials AS legacy_credentials
       FROM connection WHERE tenant_id = $1`,
    [tenantId],
  );

  const outcomes: RevocationOutcome[] = [];
  for (const row of rows) {
    const stored = row.secret_ref ?? row.legacy_credentials;
    if (!stored) {
      outcomes.push({
        kind: row.kind,
        status: 'no_credential',
        reason: 'No credentials were stored for this connection.',
      });
      continue;
    }
    let credentials: Record<string, string>;
    try {
      credentials = SecretStore.decryptCredentials(stored);
    } catch (err) {
      outcomes.push({
        kind: row.kind,
        status: 'failed',
        reason: `Stored credentials could not be decrypted, so nothing could be revoked: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      continue;
    }
    outcomes.push(await revoker.revoke({ kind: row.kind, credentials }));
  }
  return outcomes;
}
