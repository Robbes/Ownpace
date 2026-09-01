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
import { googleDeploymentClient, type GoogleClientEnv } from './google-deployment-client.ts';

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
  // not because they do not work. This is the DEFAULT — the answer for a
  // deployment that has not declared otherwise, and the only answer the
  // appliance can have, since it has no application of its own at all
  // (ADR-0041). A deployment whose own Google application carries the
  // restricted scopes says so, and `providerAccountDomains` below is what
  // reads that. `gmail`/`google_drive` remain their own kinds either way.
  google: ['calendar', 'contact'],
  // Soverin's Nextcloud for files is expected later in 2026 (the owner,
  // 2026-08-27). When it lands and has been MEASURED against the live
  // provider, 'file' joins this array — one word, no new branch. Never added
  // on an announcement: 0105's never-guess rule.
  soverin: ['email', 'calendar', 'contact'],
};

/**
 * The faces a `google` account serves when the deployment's own application
 * carries Google's RESTRICTED scopes as well as its sensitive ones.
 *
 * Not a wish list: `https://mail.google.com/` and `drive.readonly` are
 * restricted, and Google grants them only to an application that registered
 * them and passed the review its publishing status demands.
 */
export const GOOGLE_RESTRICTED_ACCOUNT_DOMAINS: ReadonlyArray<DiscoveryDomain> = [
  'email',
  'calendar',
  'contact',
  'file',
];

/** What a deployment may declare about the scope class its application holds. */
export const GOOGLE_ACCOUNT_SCOPE_CLASSES = ['sensitive', 'restricted'] as const;
export type GoogleAccountScopeClass = (typeof GOOGLE_ACCOUNT_SCOPE_CLASSES)[number];

export interface ProviderAccountEnv {
  readonly GOOGLE_ACCOUNT_SCOPE_CLASS?: string | undefined;
}

/** Is this kind an account that can wear several faces? */
export function isProviderAccountKind(kind: string): kind is ProviderAccountKind {
  return (PROVIDER_ACCOUNT_KINDS as ReadonlyArray<string>).includes(kind);
}

/**
 * The faces this provider account can serve ON THIS DEPLOYMENT, or an empty
 * list for a kind that is not one. Empty rather than a throw: callers ask
 * about arbitrary kinds, and "this is not a provider account" is an answer,
 * not an error.
 *
 * WHAT AN APPLICATION CARRIES IS A FACT ABOUT A DEPLOYMENT, NOT ABOUT THE
 * PRODUCT (ADR-0041, owner decision 2026-09-01). `PROVIDER_ACCOUNT_DOMAINS`
 * was written when there was one Google client and it reads as a law; it was
 * a law about that client, and it still governs the one Ownpace publishes to
 * strangers. A deployment running its OWN application — registered by its own
 * owner, who accepts the restricted tier's consequences — answers for itself
 * in `GOOGLE_ACCOUNT_SCOPE_CLASS`.
 *
 * DEFAULTS TO THE NARROW ANSWER, and every unrecognised value defaults with
 * it. Unset, mistyped, or never heard of all mean "sensitive only" — the
 * answer that cannot over-ask. The appliance has no application at all, so
 * this never widens it (hard rule 5).
 *
 * A DECLARATION IS NOT A CAPABILITY. Setting it does not make Google grant
 * anything. It changes which consent this product is willing to BUILD, so a
 * deployment that declares `restricted` without having registered the scopes
 * gets a refusal at Google's own screen with the scope string in hand —
 * never a consent silently narrowed to two faces and a migration that turns
 * out weeks later to have never included mail.
 *
 * AND IN "EXTERNAL + TESTING" IT COSTS ONE MORE THING, which the operator
 * documentation says beside the setting: Google expires refresh tokens after
 * seven days in that publishing status. `google-token-provider.ts`'s
 * `invalid_grant` hint names that cause first, and it is the same fact.
 */
export function providerAccountDomains(
  kind: string,
  env: ProviderAccountEnv = process.env,
): ReadonlyArray<DiscoveryDomain> {
  if (!isProviderAccountKind(kind)) return [];
  if (kind === 'google' && env.GOOGLE_ACCOUNT_SCOPE_CLASS?.trim() === 'restricted') {
    return GOOGLE_RESTRICTED_ACCOUNT_DOMAINS;
  }
  return PROVIDER_ACCOUNT_DOMAINS[kind];
}

/** Where a Google connection's OAuth client comes from on this deployment. */
export type ProviderClientSource = 'deployment' | 'connection';

/**
 * Every deployment-level fact about one provider account kind, in ONE answer.
 *
 * `domains` is the ceiling above. `client` is the second fact the screen could
 * not see (ADR-0041, owner decision 2026-09-01): whether this deployment
 * carries its own Google OAuth client, so a wizard can stop demanding a client
 * id and secret the deployment already has. The server had accepted a consent
 * and a create without the pair since it became configurable; the screen kept
 * refusing to press the button, because nothing had told it.
 *
 * Present for `google` only. Soverin has no OAuth client to speak of, and a
 * `'connection'` there would be a claim about a thing that does not exist.
 *
 * `'deployment'` is answered only for a COMPLETE pair — the rule
 * `googleDeploymentClient` already follows. Half a pair is no client, and
 * telling a screen otherwise would have it drop two required fields on the
 * strength of a typo. The values themselves are never part of the answer.
 */
export interface ProviderAccountFacts {
  readonly domains: ReadonlyArray<DiscoveryDomain>;
  readonly client?: ProviderClientSource;
}

export function providerAccountFacts(
  kind: string,
  env: ProviderAccountEnv & GoogleClientEnv = process.env,
): ProviderAccountFacts {
  const domains = providerAccountDomains(kind, env);
  if (kind !== 'google') return { domains };
  return { domains, client: googleDeploymentClient(env) ? 'deployment' : 'connection' };
}

/**
 * Does this provider account serve that face?
 *
 * The question a domain tick asks. It is the CEILING — an account's own
 * measured record still decides what is true for it.
 */
export function providerAccountServes(
  kind: string,
  domain: DiscoveryDomain,
  env: ProviderAccountEnv = process.env,
): boolean {
  return providerAccountDomains(kind, env).includes(domain);
}
