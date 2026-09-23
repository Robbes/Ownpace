// Copyright 2026 The Ownpace authors (Apache-2.0)

import { SecretStore } from '@openmig/core/secret-store';

/**
 * WHICH ACCOUNT A CONNECTION SIGNS IN AS, for the detail route to print.
 *
 * THE DEFECT (owner, 2026-09-17): *"in the migration overview or 'Migration
 * Details' view ... it doesnt list the username within the source and username
 * within target ... please that those in this overview."* The screen printed
 * neither, and for his migration this route could not have supplied them: it
 * read the account out of the encrypted credential record alone.
 *
 * TWO PLACES, because two kinds of connection keep it in different ones:
 *
 *  - a PASSWORD kind (imap, the DAV targets) stores `{username, password}`
 *    encrypted together, so the account is in the secret;
 *  - an OAUTH kind (every Google, Microsoft and Apple row — the doors most
 *    customers now come through) has no password and stores no username at
 *    all: `sourceCredentialRecord` writes the client pair and the refresh
 *    token, and the ADDRESS goes in the connection's own config as `user`.
 *
 * The secret first and the config second, so a row that has both answers with
 * the credential it actually signs in with. `password` is never returned by
 * the route whatever this finds; an address is not a secret, and a screen that
 * cannot say whose mailbox is being read is the one the owner met.
 */
export function accountOnConnection(
  conn: { readonly secretRef?: string | null; readonly config?: unknown } | null | undefined,
): string | undefined {
  const fromConfig = (conn?.config as { user?: unknown } | null | undefined)?.user;
  const fallback = typeof fromConfig === 'string' && fromConfig !== '' ? fromConfig : undefined;
  if (!conn?.secretRef) return fallback;
  try {
    // A secret this process cannot read is a fact for the connection card to
    // report (0094 T5), not a reason to print nothing here.
    return SecretStore.decryptCredentials(conn.secretRef).username ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * WHICH ACCOUNT ONE MIGRATION READS OR WRITES, on a connection several may share
 * (workplan 0108 T8a).
 *
 * Migration 0021's split: a connection answers *as whom do we sign in*, a
 * mapping answers *whose data*. So the mapping's own `user` (its source or
 * target override, written at create for exactly this case) wins, and the
 * connection's account answers only where the mapping names none. The run path
 * merges the override over the connection's config key by key, so this is the
 * account a pass actually uses, not the one the connection was made for.
 */
export function accountOfMapping(
  conn: { readonly secretRef?: string | null; readonly config?: unknown } | null | undefined,
  override: unknown,
): string | undefined {
  const own = (override as { user?: unknown } | null | undefined)?.user;
  if (typeof own === 'string' && own.trim() !== '') return own;
  return accountOnConnection(conn);
}
