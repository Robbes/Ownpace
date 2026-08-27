// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Shared API Types
 *
 * Type definitions used across the API server.
 * Placed in a separate file to avoid circular dependencies.
 */

import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  tenantId?: string;
  userId?: string;
  userRole?: string;
  /**
   * The `email` claim, carried through so `GET /api/me` can answer with an
   * address rather than a subject id. `userId` is `sub`, which for most issuers
   * is an opaque identifier — showing it where a person expects their own email
   * is not an identity, it is a serial number.
   */
  userEmail?: string;
  /**
   * Whether the issuer said it VERIFIED `userEmail` (OIDC Core §5.1).
   *
   * Carried because one thing depends on it — binding an invitation addressed
   * to that address (migration 0006) — and a route that wanted to check it
   * would otherwise have to re-decode the token the middleware already
   * verified.
   */
  emailVerified?: boolean;
  /** The tenant named in `X-Ownpace-Tenant`, if the caller named one. */
  requestedTenantId?: string;
}

/**
 * What a verified MIGRATOR LINK attaches (workplan 0108 T2, ADR-0035).
 *
 * A separate interface rather than more optional fields on
 * `AuthenticatedRequest`, deliberately: a link holder is **not a user**. They
 * have no `userId`, no role and no session, and a shape that could carry one
 * invites a route to read a field the link never fills. The one thing this
 * says is which mapping the bearer may act on.
 */
export interface MappingLinkRequest extends Request {
  mappingLink?: {
    readonly linkId: string;
    readonly mappingId: string;
    readonly tenantId: string;
    readonly purpose: 'grant' | 'view';
  };
}

// JwtPayload lives in ../middleware/auth.ts, next to the code that verifies it.
// It was declared here too, with `tenantId` and `role` REQUIRED, which stopped
// being true at ADR-0042 — and a duplicate that contradicts the real one is
// worse than no type at all, because it is the one `index.ts` re-exported.
export type { JwtPayload } from '../middleware/auth.ts';
