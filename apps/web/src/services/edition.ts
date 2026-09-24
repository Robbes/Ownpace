// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Which edition this bundle was built for (ADR-0026).
 *
 * One React app is served by both editions, but they do not present the same
 * way, and the difference is not cosmetic:
 *
 *  - **managed** is multi-tenant behind an authenticating API. Every request
 *    carries a bearer token and every route is behind a login.
 *  - **selfhost** is a single-user appliance bound to localhost by default
 *    (`SELFHOST_BIND`). It has no tenants, no accounts and no login, and its
 *    HTTP surface — including `apply`, the one destructive route — has been
 *    unauthenticated since workplan 0010. The UI matching that is consistent
 *    with what already ships rather than a new hole; the protection is the bind
 *    address, and an operator who changes it is changing that decision. Adding
 *    a login here instead would be security theatre: a password to lose in
 *    front of a port nobody else can reach. The one caller the bind cannot keep
 *    out, a page on another site in the owner's own browser, is refused by the
 *    appliance when it tries to change anything (`apps/selfhost/src/cross-site.ts`).
 *
 * Build-time rather than runtime because it decides whether auth exists at all,
 * and a value the page could talk itself out of is not a boundary.
 */

type ViteEnv = {
  readonly VITE_EDITION?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_OPERATING_URL?: string;
  /** Vite's own value for the `--base` this bundle was built with. */
  readonly BASE_URL?: string;
};

function env(): ViteEnv {
  return (import.meta as unknown as { env?: ViteEnv }).env ?? {};
}

export type Edition = 'managed' | 'selfhost';

/**
 * Defaults to `managed`, deliberately.
 *
 * The safe default for a flag that gates authentication is the one that keeps
 * the login. A misconfigured build should over-protect, not serve the decision
 * queues to whoever asks.
 */
export function edition(): Edition {
  return env().VITE_EDITION === 'selfhost' ? 'selfhost' : 'managed';
}

export function isSelfHost(): boolean {
  return edition() === 'selfhost';
}

/**
 * Where the operating surface (the decision queues) lives.
 *
 * The appliance serves this bundle itself and answers `/deletions`, `/moves`
 * and `/failures` at its own root, so the default is the empty string — same
 * origin, no prefix. The managed edition sets `VITE_OPERATING_URL=/api` once it
 * implements the contract; it does not serve these endpoints yet, which is the
 * gap ADR-0026 exists to close.
 */
export function operatingBaseUrl(): string {
  if (env().VITE_OPERATING_URL !== undefined) return env().VITE_OPERATING_URL!;
  // Managed serves the operating surface under the same authenticated API as
  // everything else; the appliance answers at its own root.
  return isSelfHost() ? '' : '/api';
}

/**
 * Path to one of the decision queues.
 *
 * **The two editions share the SHAPES but not the URLs**, and pretending
 * otherwise would be the one place ADR-0026's "one contract" claim quietly
 * stopped being true:
 *
 *  - The appliance answers `/deletions` for **every** mapping in its config
 *    directory. There are a handful, and its operator wants all of them.
 *  - A managed tenant can have many, so its queues are scoped to one mapping:
 *    `/api/migrations/{id}/deletions`. Returning every mapping's queue in one
 *    response would be a slow, unbounded answer to a question nobody asked.
 *
 * Both return the contract's `ByMapping<T>`, so a screen iterating the response
 * works unchanged against either — managed simply always has one key. The
 * difference is confined to this function on purpose.
 *
 * **The confirmation surface joined in 2026-09-13**, when its screen was
 * built. `POST /confirm` and `GET /confirmed-list` take exactly this split on
 * both servers — flat on the appliance, under the mapping on managed
 * (`apps/selfhost/src/index.ts`, `operating-routes.ts`) — so they belong
 * here rather than in a fourth path helper free to drift from this one.
 * `confirm` is a POST and not a queue; the union is about URL SHAPE, which is
 * what this function decides, and nothing else about them differs.
 */
export type OperatingPath = 'deletions' | 'moves' | 'failures' | 'confirmed-list' | 'confirm';

export function queuePath(queue: OperatingPath, mappingId?: string): string {
  return queuePathFor(edition(), queue, mappingId);
}

/**
 * The path logic, as a pure function of the edition.
 *
 * Split out because the flag itself is baked in at BUILD time (see `edition()`
 * — that is deliberate, since a value the page could talk itself out of is not
 * a boundary), which also means a test cannot stub it. Keeping the decision
 * pure lets both branches be exercised without weakening the thing that makes
 * the flag a boundary.
 */
export function queuePathFor(
  ed: Edition,
  queue: OperatingPath,
  mappingId?: string,
): string {
  if (ed === 'selfhost') return `/${queue}`;
  if (!mappingId) {
    // Not a defaulting decision to make: without a mapping there is nothing to
    // ask about, and guessing one would show somebody another migration's queue.
    // On `confirmed-list` that guess would be worse than a wrong screen: it is
    // the document somebody deletes their originals on the strength of.
    throw new Error(`The managed edition needs a mappingId to reach ${queue}.`);
  }
  return `/migrations/${encodeURIComponent(mappingId)}/${queue}`;
}

/**
 * Path to the §20 verify pair (workplan 0017 T3/T5 — the same start + poll
 * shape in both editions, at different URLs).
 *
 * The split mirrors `queuePathFor` for the same reason: the appliance scans
 * every configured mapping in one run and answers at its root
 * (`/verify/start`), while a managed run is a per-mapping row in
 * `verification_run`, so its pair hangs off the mapping
 * (`/migrations/{id}/verify/start`).
 */
export function verifyPath(action: 'start' | 'report', mappingId?: string): string {
  return verifyPathFor(edition(), action, mappingId);
}

/** As `verifyPath`, as a pure function of the edition. See `queuePathFor`. */
export function verifyPathFor(
  ed: Edition,
  action: 'start' | 'report',
  mappingId?: string,
): string {
  if (ed === 'selfhost') return `/verify/${action}`;
  if (!mappingId) {
    // Same refusal as the queues: a scan is a real cost against a real target,
    // and guessing whose would start (or report) the wrong migration's.
    throw new Error(`The managed edition needs a mappingId for verify/${action}.`);
  }
  return `/migrations/${encodeURIComponent(mappingId)}/verify/${action}`;
}

/**
 * Where a queue's SCREEN lives, which is not where its data does.
 *
 * `queuePathFor` answers for the API; this answers for the router, and the two
 * split on the same line for the same reason: the appliance's screens show
 * every configured mapping at once (`/failures`), a managed tenant's are
 * scoped to one (`/mappings/{id}/failures`).
 *
 * It exists because the Attention page links OUT to all of them. Building
 * those hrefs inline would have put the edition split in a component, which is
 * the thing this file is for — and a wrong link there sends somebody to a
 * 404 or, worse, to another migration's queue.
 */
export type QueueScreen = 'failures' | 'deletions' | 'moves' | 'sharing';

export function queueScreenPath(queue: QueueScreen, mappingId: string): string {
  return queueScreenPathFor(edition(), queue, mappingId);
}

/** As `queueScreenPath`, as a pure function of the edition. See `queuePathFor`. */
export function queueScreenPathFor(ed: Edition, queue: QueueScreen, mappingId: string): string {
  // The sharing checklist is per-mapping in BOTH editions — its rows live in
  // the ledger either way, and `AppRoutes` mounts only the scoped route. A
  // flat `/sharing` would 404 on the appliance, which is the one case where
  // copying the other three would be wrong.
  if (ed === 'selfhost' && queue !== 'sharing') return `/${queue}`;
  return `/mappings/${encodeURIComponent(mappingId)}/${queue}`;
}

/** Path prefix for the decisions and `finish`, which are per-mapping in both editions. */
export function mappingPath(mappingId: string): string {
  return mappingPathFor(edition(), mappingId);
}

/** As `mappingPath`, as a pure function of the edition. See `queuePathFor`. */
export function mappingPathFor(ed: Edition, mappingId: string): string {
  return ed === 'selfhost'
    ? `/mappings/${encodeURIComponent(mappingId)}`
    : `/migrations/${encodeURIComponent(mappingId)}`;
}

/** As `operatingBaseUrl`, as a pure function of the edition. See `queuePathFor`. */
export function operatingBaseUrlFor(ed: Edition): string {
  return ed === 'selfhost' ? '' : '/api';
}

/**
 * Where the router is mounted.
 *
 * The appliance serves this bundle under `/ui`, because its JSON operating
 * endpoints already own `/deletions`, `/moves` and `/failures` and the router's
 * own paths would collide with them. Managed serves it at `/`.
 *
 * Read from Vite's `BASE_URL` — the value baked in from the `--base` the bundle
 * was built with — rather than from a second flag, so the router's mount point
 * and the asset URLs cannot disagree with each other.
 */
export function uiBasename(): string {
  return env().BASE_URL ?? '/';
}
