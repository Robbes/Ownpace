// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `GET /api/provider-accounts` — what one account of each provider kind can
 * serve ON THIS DEPLOYMENT (ADR-0041, owner decision 2026-09-01).
 *
 * ## Why a route exists at all, when a constant would compile
 *
 * `PROVIDER_ACCOUNT_DOMAINS` is in `@openmig/shared` and the web imports it
 * directly, which was right while the answer was a property of the PRODUCT.
 * It stopped being one the moment a deployment could declare that its own
 * Google application carries the restricted scopes: `GOOGLE_ACCOUNT_SCOPE_CLASS`
 * is read at run time by the API, and the browser bundle was compiled long
 * before anybody set it.
 *
 * The consequence was a half-reachable feature. The consent route would build
 * a four-scope ask; the wizard offered two ticks and the create door refused
 * the other two — so the only way to use what the deployment had declared was
 * to `POST` the domains by hand. A capability nobody can reach from the screen
 * that exists for it is not a capability.
 *
 * A `VITE_` mirror would have compiled, and it would have made the two halves
 * separately settable: an operator sets one, forgets the other, and the wizard
 * offers ticks the API refuses (or the reverse, which is worse — a consent
 * asking for scopes no mapping can carry). One fact, one place, asked over the
 * wire. `deploy/compose/managed.yml` forwards the variable to the API and to
 * nothing else, deliberately.
 *
 * ## Unauthenticated, beside `/api/scope-manifest` and for its reason
 *
 * This is a static fact about the deployment, not tenant data: which faces one
 * account row may wear here. It names no customer, no connection and no
 * address. `/api/scope-manifest` is public for exactly that reason and this is
 * the same category of thing — and the ask-for-access page and sign-in screen
 * are already served by the same origin, so "this deployment can migrate
 * Google mail" is not a secret it was keeping.
 *
 * ## What it is NOT
 *
 * Not a capability, not a promise, and not a measurement. It is a CEILING —
 * what the product is willing to ask a consent for here. What a particular
 * account can actually carry is read off its own measured qualification record
 * (0106 T0/T1a), and only a measured `no` constrains anything (0106 T3a).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { PROVIDER_ACCOUNT_KINDS, providerAccountDomains } from '@openmig/shared';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  // Built from the kinds table rather than written out: a provider gaining a
  // face — or a kind arriving at all — is a row edit in shared, and this
  // follows it. Reading the env on every request, not once at import: an
  // operator who sets the variable and restarts the API gets the new answer,
  // and nothing here caches a value the process was started without.
  res.json(
    Object.fromEntries(PROVIDER_ACCOUNT_KINDS.map((kind) => [kind, providerAccountDomains(kind)])),
  );
});

export default router;
