// Copyright 2026 The Ownpace authors (Apache-2.0)
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  isAuthenticated: boolean;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  } | null;
  tenantId: string | null;
  token: string | null;
  /**
   * Whether to offer the access queue (workplan 0093 T7).
   *
   * A hint from `GET /api/me`, never a permission: the queue is guarded by
   * policies on `access_request`, so a stale or tampered value here shows or
   * hides a link and is told nothing either way.
   */
  operator: boolean;
  /**
   * How many organisations this subject belongs to (workplan 0093 T7's gap).
   *
   * A hint from `GET /api/me`, on the same terms as `operator` above: it
   * decides what the nav OFFERS and nothing else, because every tenant-scoped
   * route is decided server-side by `tenant_member` and RLS.
   *
   * A COUNT, NOT `tenantId !== ''`, and the difference is the whole reason
   * this exists. `tenantId` is empty in TWO unrelated states — belonging to no
   * organisation, and belonging to several without having said which — and a
   * nav that read it would hide the tenant screens from somebody who has two
   * of them. Nought is the only value that means "nowhere yet".
   */
  tenantCount: number;
  login: (
    token: string,
    user: AuthState['user'],
    tenantId: string,
    operator?: boolean,
    tenantCount?: number,
  ) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      user: null,
      tenantId: null,
      token: null,
      operator: false,
      tenantCount: 0,
      login: (token, user, tenantId, operator = false, tenantCount = 0) => {
        localStorage.setItem('auth_token', token);
        set({ isAuthenticated: true, user, tenantId, token, operator, tenantCount });
      },
      logout: () => {
        localStorage.removeItem('auth_token');
        set({
          isAuthenticated: false,
          user: null,
          tenantId: null,
          token: null,
          operator: false,
          tenantCount: 0,
        });
      },
    }),
    {
      name: 'auth-storage',
    }
  )
);
