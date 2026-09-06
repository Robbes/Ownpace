// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MICROSOFT CONSENT'S FACTS, in the package every edition reads.
 *
 * Moved here from `apps/api`'s consent module (workplan 0114 T2) on
 * 2026-09-06, the day the connection Test needed them. The qualification
 * reads which faces a STORED grant carries by asking Microsoft's token
 * endpoint for `.default` and matching the answer's `scope` field against
 * this map — the same map the consent asked with. One fact in one place,
 * read by the consent that asks, the probe that reaches and the qualification
 * that reports; a second copy in `packages/orchestration` would be the drift
 * 0114 T4 pinned against, one package over.
 */

import type { DiscoveryDomain } from './discovery.ts';

const AUTHORITY = 'https://login.microsoftonline.com';

/** Tenant-scoped, because Microsoft's are. */
export function microsoftAuthEndpoint(tenant: string): string {
  return `${AUTHORITY}/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`;
}
export function microsoftTokenEndpoint(tenant: string): string {
  return `${AUTHORITY}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
}

/**
 * What a refresh token is worth. Without it Microsoft answers with an access
 * token good for about an hour and nothing to renew it with — a consent that
 * works during the demo and fails during the migration.
 */
export const MICROSOFT_OFFLINE_SCOPE = 'offline_access';

/** The resource every Graph scope belongs to; a token response may spell a
 *  scope with this prefix or without it, and `graphScopesGranted` reads both. */
export const MICROSOFT_GRAPH_RESOURCE = 'https://graph.microsoft.com';

/**
 * One Graph scope per face, READ-ONLY.
 *
 * `Files.Read` rather than `Files.Read.All`: the signed-in user's own
 * OneDrive, not the tenant's. The reasoning is already written in
 * `google-token-provider.ts` and holds unchanged — a migration reads, and a
 * token that cannot write is the cheapest possible guarantee of that.
 *
 * `task` is the row 0114 T9 promised would be the whole of that task's
 * consent edit: Microsoft To Do lives behind `/me/todo/lists` with a model of
 * its own, `graph-todo-source` now reads it, and `Tasks.Read` is asked for
 * only when the face is ticked — like every other row here.
 */
export const MICROSOFT_DOMAIN_SCOPES: Readonly<Partial<Record<DiscoveryDomain, string>>> = {
  email: 'Mail.Read',
  calendar: 'Calendars.Read',
  contact: 'Contacts.Read',
  file: 'Files.Read',
  task: 'Tasks.Read',
};

/**
 * The faces this consent can ask for, in the order a person ticks them.
 *
 * DERIVED from the scope map rather than written again. `a-domain-union-typed-
 * out-by-hand` caught the second copy the moment it existed, which is exactly
 * 0113 T1's point: two lists of the same capability disagree with each other
 * precisely once. There is now one fact — a face has a Graph scope or it does
 * not — and both the URL builder and this order read it.
 */
export const MICROSOFT_CONSENT_DOMAINS: ReadonlyArray<DiscoveryDomain> = Object.keys(
  MICROSOFT_DOMAIN_SCOPES,
) as ReadonlyArray<DiscoveryDomain>;

/**
 * The scope string for the faces asked for — always with `offline_access`, and
 * never with a scope for a face nobody ticked.
 *
 * An empty or unrecognised request asks for every face rather than none:
 * a consent that grants nothing is not a safer failure, it is a button that
 * silently does not work.
 */
export function microsoftScopesFor(domains: ReadonlyArray<string>): string[] {
  const asked = domains.filter((d): d is DiscoveryDomain => d in MICROSOFT_DOMAIN_SCOPES);
  const chosen = asked.length > 0 ? asked : MICROSOFT_CONSENT_DOMAINS;
  const scopes = chosen
    .map((d) => MICROSOFT_DOMAIN_SCOPES[d])
    .filter((s): s is string => typeof s === 'string');
  return [MICROSOFT_OFFLINE_SCOPE, ...scopes];
}

/** The Graph scope a face is consented under, or undefined for a face no
 *  consent can ask for. */
export function microsoftFaceScope(face: DiscoveryDomain): string | undefined {
  return MICROSOFT_DOMAIN_SCOPES[face];
}

/**
 * What a token response's `scope` field says was granted, as the short names
 * this map uses.
 *
 * Microsoft answers a `.default` exchange with every scope the person has
 * consented to for the resource, whitespace-separated, and spells each one
 * either bare (`Mail.Read`) or with the resource in front
 * (`https://graph.microsoft.com/Mail.Read`) depending on the request that
 * minted it. Both are the same grant, so both read as the same name.
 */
export function graphScopesGranted(scopeField: string): ReadonlySet<string> {
  const prefix = `${MICROSOFT_GRAPH_RESOURCE}/`;
  return new Set(
    scopeField
      .split(/\s+/)
      .filter((s) => s.length > 0)
      .map((s) => (s.startsWith(prefix) ? s.slice(prefix.length) : s)),
  );
}
