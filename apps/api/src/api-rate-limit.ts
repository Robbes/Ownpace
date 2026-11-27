// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE REQUEST LIMIT FOR THE WHOLE API (workplan 0178 T6; the maintainer's
 * decision of 2026-11-27).
 *
 * Until now only the public doors had a limit of their own (`knock-limit.ts`,
 * `probe-limit.ts`, `routes/migrations/live-link-limit.ts`), and the signed-in
 * routes had none. This one is mounted once in `index.ts`, with
 * `app.use('/api', …)`, before every `/api` route. The doors keep their
 * stricter limits behind it.
 *
 * **Why `express-rate-limit` here, when `knock-limit.ts` says why not.** That
 * header weighed one door, and twenty lines of our own were the right price
 * for it. This limit covers every route, and code scanning only recognises a
 * limit that comes from a library it knows. So with our own code, every route
 * stays counted as unlimited even though it is limited. The library is MIT,
 * has two small dependencies, and does what `createKnockLimiter` does: a
 * fixed window per key, in this process.
 *
 * **Keyed by the caller's address,** the same way the doors key it: `req.ip`,
 * under `TRUST_PROXY` (`index.ts`). The library's own key is used, which is
 * `req.ip` for IPv4. For IPv6 it is the address's /56, so somebody cannot walk
 * a fresh address out of their own block for every request.
 *
 * **Where `TRUST_PROXY` is unset, this is one budget for every caller,** the
 * same as the doors' limits: `req.ip` is then the web container's nginx for
 * every browser, and the Docker host for anything calling the published port.
 * That holds on dev, the acceptance stack and the smokes. Live sets 2 (and
 * `deploy/compose/stand-up-live.sh` refuses anything but 2 or 3), so there it
 * is per visitor. The default is sized so that a shared budget never bites on
 * the stacks that have one (`DEFAULT_API_RATE_LIMIT`), and `index.ts` says at
 * startup which of the two this stack has.
 *
 * **What it is not:** distributed. The counters live in this process, so with
 * N replicas the limit is N times this. The managed API runs one.
 *
 * **`/api/ready` is never limited.** A status page polls it, and a 429 there
 * would read as the service being down. It is skipped by path, inside the one
 * mount, so no route can come before the limiter by being mounted first.
 *
 * The appliance (`apps/selfhost`) is its own server and does not run this API,
 * so nothing here limits a household's own box.
 */

import { rateLimit, type AugmentedRequest } from 'express-rate-limit';
import type { Request, RequestHandler, Response } from 'express';
import { reasonPair, type Bilingual } from '@openmig/shared';

/** A fixed window, and how many requests one address may make in it. */
export interface ApiRateLimitConfig {
  readonly windowMs: number;
  readonly max: number;
}

/**
 * A minute, and 1,200 requests in it from one address.
 *
 * **Measured against the heaviest caller on a stack whose budget is shared.**
 * `deploy/compose/smoke-managed.sh` calls the API from 125 lines, one after
 * another, and polls every 2 s. That is about 160 in a minute even if the
 * whole run fell into one, so this leaves more than seven times that. A person
 * clicking through the app makes a few dozen a minute. The managed UI smoke
 * (`test/ui`) has no API at all.
 *
 * Schemathesis (`.github/workflows/schemathesis.yml`) sends about ten thousand
 * a minute from one address, by design. Its job raises this through
 * `API_MAX_REQUESTS_PER_MINUTE`, the same setting any operator has, so it
 * still checks the API as it ships.
 */
export const DEFAULT_API_RATE_LIMIT: ApiRateLimitConfig = {
  windowMs: 60 * 1000,
  max: 1200,
};

/** What a caller who asked too often is told, in both languages, as the gift door says its own. */
export const API_TOO_MANY_REQUESTS: Bilingual = {
  en: 'That is more requests than we expected from one place in a minute. Wait a moment, then try again. Nothing is lost.',
  nl: 'Dat waren meer verzoeken dan wij in een minuut van één plek verwachten. Wacht even en probeer het dan opnieuw. Er gaat niets verloren.',
};

/**
 * The configured limit, or the default. A value somebody clearly meant to set
 * and that is no positive whole number is refused, not quietly replaced by the
 * default (hard rule 9), so the API does not start with it.
 */
export function apiRateLimitFromEnv(env: NodeJS.ProcessEnv = process.env): ApiRateLimitConfig {
  const raw = env.API_MAX_REQUESTS_PER_MINUTE;
  if (raw === undefined || raw.trim() === '') return DEFAULT_API_RATE_LIMIT;
  const max = Number(raw);
  if (!/^\s*\d+\s*$/.test(raw) || !Number.isSafeInteger(max) || max < 1) {
    throw new Error(
      `API_MAX_REQUESTS_PER_MINUTE must be a positive whole number; got ${JSON.stringify(raw)}. ` +
        'It is how many requests one address may make to /api in a minute, and unless ' +
        'TRUST_PROXY is set, "one address" is every caller together.',
    );
  }
  return { windowMs: DEFAULT_API_RATE_LIMIT.windowMs, max };
}

/** The path under the `/api` mount that is never limited. */
const NEVER_LIMITED = /^\/ready(\/|$)/;

/** The limiter, for `app.use('/api', apiRateLimit(apiRateLimitFromEnv()))`. */
export function apiRateLimit(config: ApiRateLimitConfig = DEFAULT_API_RATE_LIMIT): RequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.max,
    // No RateLimit headers on every answer: the answers stay what the API
    // description says they are, and only a refusal carries Retry-After.
    standardHeaders: false,
    legacyHeaders: false,
    skip: (req: Request) => NEVER_LIMITED.test(req.path),
    validate: {
      // The library warns when a request carries X-Forwarded-For and `trust
      // proxy` is off. That is every request through the web container on a
      // stack without TRUST_PROXY, and the shared budget it means is decided
      // (the comment at the top). `index.ts` says so once, at startup.
      xForwardedForHeader: false,
    },
    handler: (req: Request, res: Response) => {
      // The library adds what it counted to the request before it calls this.
      const resetTime = (req as AugmentedRequest).rateLimit?.resetTime;
      const seconds = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(config.windowMs / 1000);
      res.set('Retry-After', String(seconds));
      res.status(429).json({
        error: 'Too many requests',
        message: API_TOO_MANY_REQUESTS.en,
        ...reasonPair(API_TOO_MANY_REQUESTS),
      });
    },
  });
}

/** One line for the start of the API: the limit, and whether it is per caller or shared. */
export function apiRateLimitAtStart(config: ApiRateLimitConfig, trustProxy: string | undefined): string {
  const per = `at most ${config.max} requests a minute to /api from one address`;
  return trustProxy
    ? `[api] ${per}, the caller's address read through TRUST_PROXY=${trustProxy}`
    : `[api] ${per}; TRUST_PROXY is empty, so every caller shares that one budget`;
}
