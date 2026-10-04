// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHETHER THE SIGNED-IN PAGES ARE THIS VISITOR'S: a session on managed, and
 * always on the appliance.
 *
 * The appliance has no accounts to authenticate against: it is single-user,
 * bound to localhost, and its HTTP surface has been unauthenticated since
 * workplan 0010 (`services/edition.ts`). Sending its operator to a login form
 * that nothing can satisfy would make the UI unusable there, so it counts as
 * signed in. The edition defaults to `managed`, so a misconfigured build keeps
 * the login rather than losing it.
 *
 * ONE READING, AND EVERY PLACE THAT ASKS READS IT (workplan 0152; the owner,
 * 2026-10-04: *"Guide links on the Leaving pages: yes, make public"*):
 *
 * - `ProtectedRoute` (`AppRoutes.tsx`) sends anybody else to the sign-in page;
 * - `GuidesForEverybody` (`AppRoutes.tsx`) draws the guides for them in the
 *   front door's look instead (`pages/PublicDocs.tsx`);
 * - `Docs` asks the API nothing for them.
 *
 * Two copies of this sentence would be a page that opens for a visitor the
 * route table sends to sign in, or the reverse.
 */
import { useAuthStore } from './auth-store.ts';
import { isSelfHost } from '../services/edition.ts';

export function useSignedIn(): boolean {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated || isSelfHost();
}
