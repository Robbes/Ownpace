// Copyright 2026 The Ownpace authors (Apache-2.0)
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/auth-store.ts';

/**
 * Clear all auth state on an unauthorized response. The token is mirrored in the
 * raw `auth_token` key AND the zustand-persisted `auth-storage`; clearing only
 * one leaves `isAuthenticated` stale (the app would look logged-in while every
 * request 401s). `logout()` resets state + both keys, keeping them consistent.
 */
export function onUnauthorized(): void {
  useAuthStore.getState().logout();
  const win = globalThis as unknown as { location?: { href: string } };
  if (win.location) {
    win.location.href = '/login';
  }
}

// Create axios instance with default config
const apiClient: AxiosInstance = axios.create({
  baseURL: (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - add auth token to requests
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('auth_token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid — clear ALL auth state and redirect to login.
      onUnauthorized();
    }
    // A DEAD membership is a dead session (release-readiness, 2026-08-10): a
    // valid token whose subject has no active tenant_member row 403s on every
    // route forever — the UI used to stay "logged in" rendering a wall of red
    // reads. Only the membership gate's own sentence triggers this; a
    // role-refusal 403 (e.g. a member opening Billing) passes through to the
    // screen that knows how to say it.
    if (
      error.response?.status === 403 &&
      error.response?.data?.message === 'No active membership for this tenant'
    ) {
      onUnauthorized();
    }
    return Promise.reject(error);
  }
);

/**
 * The server's own words for a failed request (hard rule 9 / 0033 T2).
 *
 * The API routes answer failures with a JSON body — `{error, message}` — and
 * axios puts it in `err.response.data`, while `err.message` is only the
 * transport's generic "Request failed with status code 500". Screens that
 * render `err.message` are showing the wrapper and discarding the sentence
 * the server wrote for exactly this moment; this helper prefers the body and
 * falls back to the transport message only when there is no body to show.
 */
export function serverMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data: unknown = err.response?.data;
    if (data && typeof data === 'object') {
      const d = data as {
        message?: unknown;
        reason?: unknown;
        error?: unknown;
        details?: unknown;
      };
      if (typeof d.message === 'string' && d.message) return d.message;
      // `reason` is the OTHER shape this API answers with — 24 routes use it
      // where 44 use `message`, and the connections routes are all in the first
      // group. Without this the delete-in-use refusal renders as the bare code
      // 'in_use' (it falls through to `error` below), which is how a sentence
      // naming the migrations that block the delete became a word nobody can
      // act on. Found on a phone, in Dutch, by the owner (workplan 0068).
      if (typeof d.reason === 'string' && d.reason) return d.reason;
      // Zod refusals from routes that answer `{error, details}` without a
      // message: the sentences the schema wrote live on the issues. Showing
      // only the label 'Validation error' would discard exactly the words the
      // refusal exists to deliver (0037 T4).
      if (Array.isArray(d.details)) {
        const sentences = d.details
          .map((i) => (i && typeof i === 'object' ? (i as { message?: unknown }).message : undefined))
          .filter((m): m is string => typeof m === 'string' && m !== '');
        if (sentences.length > 0) return sentences.join(' ');
      }
      if (typeof d.error === 'string' && d.error) return d.error;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * The credential FIELD KEYS a `missing_fields` refusal names, or null when the
 * error is not one (workplan 0071).
 *
 * `serverMessage` is the right answer for a provider's own words, and the
 * wrong one here: this refusal is our own, and the sentence it carries is
 * English prose naming storage keys (`clientId`) rather than the label the
 * person is looking at (*App key* / *App-sleutel*). The keys are the stable
 * handle the caller localizes against — `credentialFieldsFor` already maps
 * each to the same i18n key the input's own label uses, so both doors say what
 * the wizard says, in the reader's language.
 */
export function missingCredentialFields(err: unknown): string[] | null {
  return credentialFieldsInRefusal(err, 'missing_fields');
}

/**
 * The same, for values that ARE filled in but are the wrong shape (0072) —
 * `invalid_values`. Kept a separate call rather than a flag, because the two
 * need different sentences: one asks for something, the other says what you
 * gave cannot be used.
 */
export function invalidCredentialFields(err: unknown): string[] | null {
  return credentialFieldsInRefusal(err, 'invalid_values');
}

function credentialFieldsInRefusal(err: unknown, code: string): string[] | null {
  if (!axios.isAxiosError(err)) return null;
  const data = err.response?.data as { error?: unknown; fields?: unknown } | undefined;
  if (!data || data.error !== code || !Array.isArray(data.fields)) return null;
  const keys = data.fields.filter((f): f is string => typeof f === 'string' && f !== '');
  return keys.length > 0 ? keys : null;
}

/**
 * The migrations an `in_use` delete-refusal names, or null when the error is
 * not one (workplan 0071).
 *
 * Same split as `missingCredentialFields`: the NAMES are the server's finding
 * and render verbatim, the sentence around them is ours and gets translated.
 * 0068 T4 established what the refusal has to answer — why, what first, where
 * — and shipped it as one English paragraph on the route, which is how a Dutch
 * operator got five clauses of English.
 *
 * `names` may be SHORTER than `used`, because `mailbox_mapping.name` is
 * nullable (the appliance writes rows without one). Falling back to the
 * server's English sentence in that case was the first answer here and the
 * wrong one — it put the reader back in English for the case they were most
 * likely to meet. The caller says "an unnamed migration" in its own language
 * instead, which is still true and still points at the right screen.
 */
export function inUseMigrations(err: unknown): { names: string[]; used: number } | null {
  if (!axios.isAxiosError(err)) return null;
  const data = err.response?.data as
    | { error?: unknown; migrations?: unknown; used?: unknown }
    | undefined;
  if (!data || data.error !== 'in_use' || !Array.isArray(data.migrations)) return null;
  return {
    names: data.migrations.filter((m): m is string => typeof m === 'string' && m !== ''),
    used: typeof data.used === 'number' ? data.used : data.migrations.length,
  };
}

/**
 * The migration a `duplicate_mapping` refusal points at, or null (0071 T6).
 *
 * Same split again: the existing migration's name and id are the finding, the
 * sentence explaining why two of them would double everything on the target is
 * ours. The id is what makes the refusal a way OUT rather than a wall — the
 * screen can offer to open the migration that already does this.
 */
export function duplicateMapping(err: unknown): { id: string; name: string | null } | null {
  if (!axios.isAxiosError(err)) return null;
  const data = err.response?.data as
    | { error?: unknown; existingMappingId?: unknown; existingMappingName?: unknown }
    | undefined;
  if (!data || data.error !== 'duplicate_mapping') return null;
  if (typeof data.existingMappingId !== 'string' || !data.existingMappingId) return null;
  return {
    id: data.existingMappingId,
    name: typeof data.existingMappingName === 'string' ? data.existingMappingName : null,
  };
}

export default apiClient;
