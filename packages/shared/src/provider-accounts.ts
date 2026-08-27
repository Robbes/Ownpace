// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One account, several faces (workplan 0106 T3b — the owner's decision of
 * 2026-08-27).
 *
 * ## Provider-shaped, not Google-shaped, on purpose
 *
 * The obvious version of this task is "let a Google connection serve more than
 * one domain". The owner asked for the general one, and gave the reason:
 *
 *   *"one can tick 'google' and pick the object types to ask a grant for…
 *   since we will have this more often — Soverin will add Nextcloud for files
 *   later this year."*
 *
 * So this is a TABLE. A provider gaining a face is a row edit here, reviewed in
 * a diff, with no new branch anywhere. `soverin` gaining `file` when its
 * Nextcloud arrives is one word in one array; a `switch (kind)` fork would
 * have been a second implementation and the #597 defect all over again.
 *
 * ## What a row means, and what it does NOT mean
 *
 * A row says: **this provider serves these faces from ONE account row.** It is
 * a ceiling, not a promise. What a particular account can actually carry is
 * read off its measured qualification record (0106 T0/T1a) — the static table
 * says what is possible for the provider, the record says what is true for the
 * account, and only a measured `no` constrains anything (0106 T3a). Unmeasured
 * is never a wall.
 *
 * ## Why `google` starts with two faces
 *
 * Not a technical limit — Google's own pricing of its scopes. Calendar and
 * carddav are *sensitive* (brand verification, free); Gmail's
 * `https://mail.google.com/` and `drive.readonly` are *restricted*, needing an
 * annual third-party security assessment (`docs/google-oauth-verification.md`).
 * One consent inviting all four would push the MANAGED client into the
 * restricted tier for every customer, including one who only wanted contacts.
 *
 * That constraint is the managed client's alone: an appliance registers its own
 * OAuth client and does its own verification (ADR-0041). Which is why this is a
 * table of what the PRODUCT offers rather than of what the protocol allows —
 * and why the single-domain kinds cohabit rather than being replaced.
 */

import type { DiscoveryDomain } from './discovery.ts';

/**
 * Connection kinds that hold ONE account and can serve several of its faces.
 *
 * Deliberately not "every kind": `imap` is a protocol, not an account, and a
 * person who typed an IMAP host has not told us anything about what else that
 * server does. These are the kinds where one credential provably reaches more
 * than one domain.
 */
export const PROVIDER_ACCOUNT_KINDS = ['google', 'soverin'] as const;
export type ProviderAccountKind = (typeof PROVIDER_ACCOUNT_KINDS)[number];

/**
 * The faces each provider account can serve, TODAY.
 *
 * Ordered as a person would tick them rather than alphabetically, so the
 * wizard and any consent screen list them the same way twice running.
 */
export const PROVIDER_ACCOUNT_DOMAINS: Readonly<
  Record<ProviderAccountKind, ReadonlyArray<DiscoveryDomain>>
> = {
  // Mail and files are absent because of Google's restricted-scope assessment,
  // not because they do not work. When it is bought, they are added HERE —
  // and `gmail`/`google_drive` become a migration path rather than the shape.
  google: ['calendar', 'contact'],
  // Soverin's Nextcloud for files is expected later in 2026 (the owner,
  // 2026-08-27). When it lands and has been MEASURED against the live
  // provider, 'file' joins this array — one word, no new branch. Never added
  // on an announcement: 0105's never-guess rule.
  soverin: ['email', 'calendar', 'contact'],
};

/** Is this kind an account that can wear several faces? */
export function isProviderAccountKind(kind: string): kind is ProviderAccountKind {
  return (PROVIDER_ACCOUNT_KINDS as ReadonlyArray<string>).includes(kind);
}

/**
 * The faces this provider account can serve, or an empty list for a kind that
 * is not one. Empty rather than a throw: callers ask about arbitrary kinds,
 * and "this is not a provider account" is an answer, not an error.
 */
export function providerAccountDomains(
  kind: string,
): ReadonlyArray<DiscoveryDomain> {
  return isProviderAccountKind(kind) ? PROVIDER_ACCOUNT_DOMAINS[kind] : [];
}

/**
 * Does this provider account serve that face?
 *
 * The question a domain tick asks. It is the CEILING — an account's own
 * measured record still decides what is true for it.
 */
export function providerAccountServes(kind: string, domain: DiscoveryDomain): boolean {
  return providerAccountDomains(kind).includes(domain);
}
