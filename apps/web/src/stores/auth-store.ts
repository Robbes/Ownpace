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
  login: (token: string, user: AuthState['user'], tenantId: string, operator?: boolean) => void;
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
      login: (token, user, tenantId, operator = false) => {
        localStorage.setItem('auth_token', token);
        set({ isAuthenticated: true, user, tenantId, token, operator });
      },
      logout: () => {
        localStorage.removeItem('auth_token');
        set({ isAuthenticated: false, user: null, tenantId: null, token: null, operator: false });
      },
    }),
    {
      name: 'auth-storage',
    }
  )
);
