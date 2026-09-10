// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The HTTP client for somebody who has no account (workplan 0108 T4, 0122 T4).
 *
 * A **separate axios instance** from `api.ts`'s, and that is the whole reason
 * this file exists. `apiClient` attaches a `Bearer` from `localStorage` on every
 * request and signs the caller out on a 401 — both wrong here, in ways that
 * would be quiet:
 *
 *  - The person opening a link has no session. If they happen to be signed in
 *    to Ownpace in the same browser — an owner testing their own link, most
 *    likely — the shared client would attach that token to a route that
 *    authenticates a LINK, and the two credentials would travel together for no
 *    reason.
 *  - The link routes answer 401 for a refused LINK, not for a stale session.
 *    Running that through `onUnauthorized()` would sign a bystander out of
 *    Ownpace because somebody sent them a dead link.
 *
 * So this client attaches nothing and interprets nothing. The link in the path
 * is the entire credential.
 *
 * ## Why one file rather than one per service
 *
 * ADR-0035's link has two lifetimes and therefore two services
 * (`grant-service.ts`, `view-service.ts`). They must not each keep their own
 * axios instance: the property above is a NEGATIVE one — what the client does
 * not do — and a second copy is a second place for somebody to add an
 * interceptor "for consistency" without meeting this comment.
 */

import axios from 'axios';

export const linkClient = axios.create({
  baseURL:
    (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL || '/api',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});
