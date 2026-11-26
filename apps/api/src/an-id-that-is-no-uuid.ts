// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ID THAT IS NO UUID IS A ROW THAT IS NOT THERE (workplan 0178, the owner's
 * answer A1 of 2026-11-26).
 *
 * Every row an API path names by id has a `uuid` key. A path id that is no
 * UUID used to reach Postgres as it was, Postgres refused it (`invalid input
 * syntax for type uuid`), and the API answered 500. This answers it instead,
 * in one place, before any handler and before the database: 404, in the API's
 * `Error` shape, as for a row the caller cannot see. A wrong id and a
 * malformed one are the same answer on purpose: neither names anything.
 *
 * HOW. `idsThatAreNoUuid(router)` registers a check with Express's own
 * `router.param` for each name in `UUID_PATH_PARAMS`. Express runs it only
 * when a route of that router with that parameter has matched, after the
 * router's own middleware (sign-in where it is `router.use`) and before the
 * route's handlers, so a literal route registered first (`GET
 * /api/migrations/pace`) keeps its path, and a word that falls through to an
 * id route (`GET /api/migrations/somewhere`) is not found. A router that
 * declares no route with one of these names is not touched by it.
 *
 * TWO WAYS A ROUTER SAYS MORE.
 *   - `answers`: the router's own answer for a row that is not there, where
 *     it has one (the connections' `{ error: 'not_found', reason }`), so a
 *     malformed id is answered as a missing one is, in that router's words.
 *   - `checkedByItsRoutes`: a name whose routes check it themselves, after
 *     sign-in, with an answer of their own the description and their tests
 *     already hold (the operator's routes answer 400 *"must be one uuid"*
 *     after their 401; a person's pages answer `person_not_found`). Such a
 *     name is not checked here, and says why, with the test that holds it.
 *
 * Every router that has such a route calls this, which
 * `an-id-that-is-no-uuid.unit.test.ts` holds by walking the real app: a route
 * with one of these names is checked here, or its router names it as checked
 * by its routes, with a reason.
 */

import type { NextFunction, Request, Response, Router } from 'express';

/**
 * The path parameters that name a row by its `uuid` key, in every router
 * that has them. The guard holds that every path parameter the API
 * description declares `format: uuid` is here.
 */
export const UUID_PATH_PARAMS = [
  'id',
  'mappingId',
  'tenantId',
  'memberId',
  'personId',
  'invoiceId',
  'linkId',
  'decisionId',
  'grantId',
  'paymentMethodId',
  'creditNoteId',
] as const;

export type UuidPathParam = (typeof UUID_PATH_PARAMS)[number];

/** A UUID as Postgres writes one: 8-4-4-4-12 hexadecimal digits, in either case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** What the answer says. The `Error` shape's `message` is shown to a person as it is. */
export const NOT_FOUND = 'There is nothing here by that id.';

/** The answer for a row that is not there, where a router has none of its own. */
export function notFound(res: Response): void {
  res.status(404).json({ error: 'Not found', message: NOT_FOUND });
}

/** Every check this module made, so the guard can tell one by identity. */
const CHECKS = new WeakSet<object>();

/** Whether `fn` is a check this module made. */
export function isTheCheck(fn: unknown): boolean {
  return typeof fn === 'function' && CHECKS.has(fn);
}

/** The names each router says its routes check themselves, and why. */
const CHECKED_BY_ITS_ROUTES = new WeakMap<object, Readonly<Partial<Record<UuidPathParam, string>>>>();

/** Why `router`'s routes check `name` themselves, or undefined where they do not say. */
export function checkedByItsRoutes(router: object, name: string): string | undefined {
  return CHECKED_BY_ITS_ROUTES.get(router)?.[name as UuidPathParam];
}

/** A check that lets a UUID through and answers anything else with `answer`. */
function checkWith(answer: (res: Response) => void) {
  const check = (_req: Request, res: Response, next: NextFunction, value: unknown): void => {
    if (isUuid(value)) {
      next();
      return;
    }
    answer(res);
  };
  CHECKS.add(check);
  return check;
}

/** The shared check, answering `notFound`. */
export const uuidParamCheck = checkWith(notFound);

export interface IdsThatAreNoUuidOptions {
  /** The router's own answer for a row that is not there, by name. */
  readonly answers?: Readonly<Partial<Record<UuidPathParam, (res: Response) => void>>>;
  /** Names whose routes check them themselves: the reason, and the test that holds it. */
  readonly checkedByItsRoutes?: Readonly<Partial<Record<UuidPathParam, string>>>;
}

/** Passes every id in `UUID_PATH_PARAMS` a route of `router` takes through the check. */
export function idsThatAreNoUuid<R extends Router>(router: R, options: IdsThatAreNoUuidOptions = {}): R {
  const own = options.checkedByItsRoutes ?? {};
  for (const [name, why] of Object.entries(own)) {
    if (typeof why !== 'string' || why.trim().length < 20) throw new Error(`idsThatAreNoUuid: say why ${name} is checked by its routes, and which test holds it`);
  }
  CHECKED_BY_ITS_ROUTES.set(router, own);
  for (const name of UUID_PATH_PARAMS) {
    if (Object.hasOwn(own, name)) continue;
    const answer = options.answers?.[name];
    router.param(name, answer ? checkWith(answer) : uuidParamCheck);
  }
  return router;
}
