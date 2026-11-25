// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE KINDS A PERSON GRANTS BY TYPING THEIR OWN PASSWORD (workplan 0174 §5.1).
 *
 * Two lists, one per role, of `connection.kind`s whose credential is a
 * password the account holder can type on their grant page. They are the
 * seam's (`apps/api/src/routes/grant-providers.ts`, which re-exports them and
 * builds a `PasswordGrant` per kind), and they live here so that the screens
 * read the same lists: *Start a migration* offers *They do, with a link* for
 * exactly these kinds (`grantableByLink`), and the create door accepts an
 * account saved for a person without its password for exactly these kinds
 * (`forPerson`, 0174 §8.2). A copy of either list in a page would be one more
 * place for a kind to be forgotten (`a-target-vocabulary-typed-out-in-nine-places`).
 *
 * For each of these kinds the wizard's card and the connection's kind are
 * the same word, so a screen asks with its card.
 *
 * Held to the field table by `every-password-kind-has-a-link.unit.test.ts`:
 * a kind whose fields carry a secret password, and that is not an OAuth
 * kind, is in one of the lists or is named in the plan's §13 with its reason.
 */

/**
 * Every source `connection.kind` whose credential is a password the account
 * holder can type: IMAP, Apple's app-specific password, and the three DAV
 * protocols (0169).
 */
export const PASSWORD_SOURCE_KINDS = ['imap', 'apple', 'caldav', 'carddav', 'webdav'] as const;

/** Every destination kind whose credential is a password: every target the product connects. */
export const PASSWORD_TARGET_KINDS = [
  'jmap',
  'imap',
  'caldav',
  'carddav',
  'webdav',
  'soverin',
  'nextcloud',
  'cirrux',
  'infomaniak',
] as const;

export type PasswordKind = (typeof PASSWORD_SOURCE_KINDS)[number] | (typeof PASSWORD_TARGET_KINDS)[number];

/** Whether a kind is a password kind in this role. Own lists only. */
export function isPasswordKind(role: 'source' | 'target', kind: string | null | undefined): kind is PasswordKind {
  if (!kind) return false;
  const kinds: ReadonlyArray<string> = role === 'source' ? PASSWORD_SOURCE_KINDS : PASSWORD_TARGET_KINDS;
  return kinds.includes(kind);
}
