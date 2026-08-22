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
}

// JwtPayload lives in ../middleware/auth.ts, next to the code that verifies it.
// It was declared here too, with `tenantId` and `role` REQUIRED, which stopped
// being true at ADR-0042 — and a duplicate that contradicts the real one is
// worse than no type at all, because it is the one `index.ts` re-exported.
export type { JwtPayload } from '../middleware/auth.ts';
