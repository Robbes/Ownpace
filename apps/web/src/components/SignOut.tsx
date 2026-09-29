// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * SIGN OUT OF THE ISSUER TOO, not just of this tab (2026-09-01), wherever the
 * app signs somebody out: the nav's *Sign out* and the acceptance screen's
 * *Not now* (workplan 0139 T3, review of 2026-09-29).
 *
 * `logout()` clears the store and `localStorage`, which ends the APP's session
 * and nothing else. The issuer's own cookie survived it, so pressing "Sign in"
 * afterwards completed the whole authorization-code round trip with no prompt
 * at all and put the same person straight back in — found by the owner one
 * press after signing out.
 *
 * On a shared or borrowed machine that is not cosmetic: "sign out" that leaves
 * the issuer signed in means the next person to press "Sign in" is in your
 * account having proved nothing. On the acceptance screen it is worse: that
 * next person lands on the screen, and could accept the texts on your behalf.
 * So the two buttons share this, rather than one of them remembering it.
 *
 * THE LOCAL HALF HAPPENS FIRST AND UNCONDITIONALLY. The remote leg can be
 * absent (no issuer configured — the paste-a-token door has no remote
 * session), unsupported (no `end_session_endpoint` published) or unreachable,
 * and none of those may leave somebody still signed in HERE. So the URL is
 * asked for before the state is cleared — it needs the ID token — and followed
 * after, if there is one. Without one, the sign-in page.
 */

import React from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '../stores/auth-store.ts';
import { leaveForIssuer, signOutUrl } from '../services/oidc.ts';

export function useSignOut(): () => void {
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  return React.useCallback(() => {
    void (async () => {
      const url = await signOutUrl(token);
      logout();
      if (url) leaveForIssuer(url);
      else void navigate('/login', { replace: true });
    })();
  }, [token, logout, navigate]);
}
