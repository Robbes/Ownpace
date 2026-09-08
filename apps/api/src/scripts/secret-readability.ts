// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Can every stored secret still be read?
 *
 * ## Why this exists
 *
 * A credential encrypted under a key the deployment no longer holds is not
 * corrupt, missing, or invalid in any way a query can see. The row is present,
 * the JSON parses, the base64 decodes and the lengths are right. It fails at
 * exactly one moment: when AES-GCM checks the auth tag, inside a sync pass, on
 * somebody's migration.
 *
 * On the reference deployment (2026-09-08) that cost about a tenth of every run
 * for several hours, repeating once a minute:
 *
 *     run-delta-sync|Authentication failed: encrypted secret may be tampered
 *                    or encrypted with different key
 *
 * and nothing anywhere named the connection. `SECRET_ENCRYPTION_KEY` was
 * identical on the host, in the api container, and in the task environment, so
 * every check an operator would think to run said the configuration was fine.
 * The rows were simply older than a key rotation nobody has a record of.
 *
 * The standing-failure surface (0094 T5) does show it — but only AFTER a pass
 * has already failed against it, which is a diagnosis you get by suffering the
 * symptom. This is the same question asked on purpose, in a second, before
 * anything runs.
 *
 * ## What it will not do
 *
 * **It never returns, logs or stores a plaintext.** `readSecretAt` returns a
 * verdict and nothing else; the decrypted value is discarded inside the
 * function that produced it. An operator tool that prints credentials to a
 * terminal — and therefore to a scrollback buffer, a screen share and whatever
 * captures CI logs — is a worse problem than the one it diagnoses.
 *
 * It also never touches the key material, prints ciphertext, or writes
 * anything at all. It is a read and an arithmetic answer.
 *
 * ## What it cannot fix
 *
 * Nothing here recovers an unreadable secret. AES-GCM without the key is not a
 * puzzle, it is an absence: the plaintext is gone and the credential has to be
 * entered again. Saying so is the entire remedy, and saying WHICH connection
 * is the entire value.
 */

import { decryptSecret, parseEncryptedSecret } from '@openmig/core/secrets';

/**
 * A column that holds an encrypted envelope, and can therefore rot.
 *
 * FOUR OF THEM, and the list was arrived at by asking the database rather than
 * by grepping: `information_schema` for every column matching `%secret%` or
 * `%credential%`. Two of the five it found are not in this list and both
 * omissions are deliberate — see `mapping_link.secret_hash` below.
 *
 * A check that covered only `connection.secret_ref` — the obvious one, and the
 * one the incident was about — would leave three other columns rotting
 * silently, which is the shape of half a check.
 */
export interface SecretSite {
  /** `table.column`, as an operator would say it. */
  readonly at: string;
  /** What the row IS, in a sentence fragment that finishes "an unreadable …". */
  readonly what: string;
  /**
   * Written by nothing current, still READ by something. A legacy column is
   * not a column that can be skipped: `revoke-stored-credentials.ts` reads
   * `encrypted_credentials`, so a row that cannot be decrypted there is a
   * credential an erasure believes it revoked and did not.
   */
  readonly legacy: boolean;
  /**
   * Returns `id, label, ref` — the runner reads no other columns.
   *
   * `ref IS NOT NULL` in every one of these: a null is not a failure. Several
   * connection kinds legitimately store no secret at all (the credential is a
   * location, or the deployment carries the client), and counting those as
   * unreadable would bury the real ones under noise.
   */
  readonly find: string;
  /** What to do about one, ready to act on. Never a value, only a name. */
  readonly remedy: (label: string) => string;
}

export const SECRET_SITES: readonly SecretSite[] = [
  {
    at: 'connection.secret_ref',
    what: "connection's stored credentials",
    legacy: false,
    find: `
      SELECT c.id::text AS id,
             coalesce(t.name, '(no organisation)') || ' — ' ||
               c.display_name || ' (' || c.kind || ', ' || c.role || ')' AS label,
             c.secret_ref AS ref
        FROM connection c
        LEFT JOIN tenant t ON t.id = c.tenant_id
       WHERE c.secret_ref IS NOT NULL
       ORDER BY t.name NULLS FIRST, c.display_name`,
    remedy: (label) =>
      `Re-enter the credentials on ${label} — nothing can decrypt the stored ones.`,
  },
  {
    at: 'connection.encrypted_credentials',
    what: "connection's legacy credentials",
    legacy: true,
    find: `
      SELECT c.id::text AS id,
             coalesce(t.name, '(no organisation)') || ' — ' ||
               c.display_name || ' (' || c.kind || ')' AS label,
             c.encrypted_credentials AS ref
        FROM connection c
        LEFT JOIN tenant t ON t.id = c.tenant_id
       WHERE c.encrypted_credentials IS NOT NULL
       ORDER BY t.name NULLS FIRST, c.display_name`,
    remedy: (label) =>
      `${label} carries a LEGACY credential nothing writes any more, and it cannot be ` +
      'read. Revocation reads this column (revoke-stored-credentials.ts), so an erasure ' +
      'would report revoking a token it could not decrypt. Re-enter the credentials, or ' +
      'clear the column once you are satisfied the token is dead at the provider.',
  },
  {
    at: 'mailbox_mapping.source_secret_ref',
    what: "mapping's own source credentials",
    legacy: false,
    find: `
      SELECT m.id::text AS id,
             coalesce(t.name, '(no organisation)') || ' — mapping ' || m.id::text AS label,
             m.source_secret_ref AS ref
        FROM mailbox_mapping m
        LEFT JOIN tenant t ON t.id = m.tenant_id
       WHERE m.source_secret_ref IS NOT NULL
       ORDER BY t.name NULLS FIRST, m.id`,
    remedy: (label) =>
      `Re-enter the source credentials on ${label} — every pass it runs will fail first.`,
  },
  {
    at: 'backup_target.secret_ref',
    what: "backup target's credentials",
    legacy: false,
    find: `
      SELECT b.id::text AS id,
             coalesce(t.name, '(no organisation)') || ' — backup target ' || b.id::text AS label,
             b.secret_ref AS ref
        FROM backup_target b
        LEFT JOIN tenant t ON t.id = b.tenant_id
       WHERE b.secret_ref IS NOT NULL
       ORDER BY t.name NULLS FIRST, b.id`,
    remedy: (label) =>
      `Re-enter the credentials on ${label}. A backup that cannot authenticate is a ` +
      'backup that is not happening, and that is a failure nobody notices until a restore.',
  },
];

/**
 * `mapping_link.secret_hash` is the fifth column the schema search found and it
 * is deliberately NOT here. It holds a HASH, not an envelope: there is no key,
 * nothing to decrypt, and a rotation cannot break it. Adding it would mean
 * reporting every link as unreadable forever — a check that cries wolf about
 * something working correctly is worse than no check.
 */
export const NOT_A_DECRYPTABLE_SECRET = ['mapping_link.secret_hash'] as const;

/**
 * Why one row could not be read, told apart because the remedies differ.
 *
 *  - `readable`    — it decrypted. Nothing to do.
 *  - `wrong-key`   — the envelope is well formed and the auth tag does not
 *                    check out. The key that wrote it is not the key we hold.
 *                    UNRECOVERABLE; the credential must be entered again.
 *  - `malformed`   — it is not an envelope at all: not JSON, or missing the
 *                    version/nonce/tag/ciphertext fields, or a nonce or tag of
 *                    the wrong length. That is corruption or a hand-edited row,
 *                    and it points at a different investigation entirely.
 */
export type SecretVerdict = 'readable' | 'wrong-key' | 'malformed';

/**
 * Try to read one stored envelope. Returns a verdict and NOTHING ELSE.
 *
 * The plaintext is not returned, not logged, and not held beyond the statement
 * that produced it — see the module header. The two failure verdicts are told
 * apart by `decryptSecret`'s own message, which distinguishes a GCM
 * authentication failure from everything else; matching on the message is
 * unlovely but it is the only thing that crosses the function boundary, and
 * the alternative — treating every failure as a wrong key — would send an
 * operator to re-enter credentials over a truncated column.
 */
export function readSecretAt(ref: string): SecretVerdict {
  let envelope;
  try {
    envelope = parseEncryptedSecret(ref);
  } catch {
    return 'malformed';
  }

  try {
    // The value is deliberately discarded. Assigning it to a name that outlives
    // this line is how a credential ends up in a log.
    decryptSecret(envelope);
    return 'readable';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.startsWith('Authentication failed:') ? 'wrong-key' : 'malformed';
  }
}

/** One row that could not be read, as the report shows it. */
export interface UnreadableSecret {
  readonly at: string;
  readonly id: string;
  readonly label: string;
  readonly verdict: Exclude<SecretVerdict, 'readable'>;
  readonly remedy: string;
}

/** What one site's rows came to. */
export interface SiteTally {
  readonly site: SecretSite;
  readonly checked: number;
  readonly unreadable: readonly UnreadableSecret[];
}

/**
 * Judge every row of one site.
 *
 * Takes rows rather than a database, so the whole decision is testable without
 * one and the SQL stays in `find` where an operator can read it.
 */
export function tallySite(
  site: SecretSite,
  rows: readonly { id: string; label: string; ref: string }[],
): SiteTally {
  const unreadable: UnreadableSecret[] = [];
  for (const row of rows) {
    const verdict = readSecretAt(row.ref);
    if (verdict === 'readable') continue;
    unreadable.push({
      at: site.at,
      id: row.id,
      label: row.label,
      verdict,
      remedy:
        verdict === 'wrong-key'
          ? site.remedy(row.label)
          : `${row.label} does not hold an encryption envelope at all — the column is ` +
            'corrupt or was written by hand. Look at the row before changing anything; ' +
            'this is not the wrong-key case and re-entering credentials may not be the fix.',
    });
  }
  return { site, checked: rows.length, unreadable };
}

/**
 * The closing line, and it says the good news out loud.
 *
 * A report that lists only problems cannot be told apart from a report that did
 * not run — the same rule `operator.sh check` was written under. "Nothing
 * found" is the answer an operator is hoping for and it has to be printed.
 */
export function secretSummary(tallies: readonly SiteTally[]): string {
  const checked = tallies.reduce((n, t) => n + t.checked, 0);
  const bad = tallies.reduce((n, t) => n + t.unreadable.length, 0);
  if (checked === 0) {
    return 'No stored secrets at all. Nothing was checked, which is not the same as nothing being wrong.';
  }
  if (bad === 0) {
    return `All ${checked} stored secret(s) decrypt with the key this deployment holds.`;
  }
  const wrongKey = tallies.reduce(
    (n, t) => n + t.unreadable.filter((u) => u.verdict === 'wrong-key').length,
    0,
  );
  return (
    `${bad} of ${checked} stored secret(s) CANNOT be read.\n` +
    (wrongKey > 0
      ? `${wrongKey} of those failed the authentication tag: written under a different key, ` +
        'and unrecoverable. Every pass that needs one fails, once per tick, until the\n' +
        'credential is entered again.'
      : 'None of them is a wrong-key failure, so this is corruption rather than a rotation.')
  );
}
