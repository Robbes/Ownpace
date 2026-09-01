// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `GET /api/redirect-uris` — every address this deployment needs registered in
 * somebody else's console (2026-09-01).
 *
 * ## The question it answers
 *
 * The owner registered the right Google callback, got `redirect_uri_mismatch`
 * anyway because `API_URL` disagreed with it, and asked the useful question:
 * *"what should it be? we will probably have more other callbacks… make the
 * surface understandable."*
 *
 * These addresses live in four different consoles, look almost identical, and
 * each fails with the same unhelpful sentence from a different vendor. Nothing
 * in the product listed them, so the only way to know was to read a route.
 *
 * ## Why the answer is DERIVED and not documented
 *
 * `redirectUris` builds each string from the same variables the code uses —
 * the Google callback from `API_URL` exactly as `callbackUri` does, the
 * sign-in pair from `WEB_URL`, the social one from `JWT_ISSUER`. A written
 * list goes stale the first time somebody moves a host; this cannot, because a
 * wrong value here is the same wrong value the product will send. That is the
 * property worth having: what is on screen is what will be requested.
 *
 * ## Operator-shaped, and unauthenticated for the same reason as its neighbours
 *
 * Every value is an address that is, by construction, published to a provider
 * and typed into a browser's location bar — `/auth/callback` is in the URL bar
 * of every person who signs in. There is nothing here that could not appear in
 * a screenshot, which is exactly what makes it safe to render on a screen an
 * operator will photograph and paste into a console. It names no customer, no
 * connection, no address belonging to a person, and no secret.
 *
 * It sits beside `/api/scope-manifest` and `/api/provider-accounts`, which are
 * public for the same reason: static facts about the deployment.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { redirectUris } from '@openmig/shared';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  // Read per request, not at import: an operator who fixes API_URL and
  // restarts gets the new answer, and nothing serves one from a process that
  // started with the old value.
  res.json({ entries: redirectUris() });
});

export default router;
