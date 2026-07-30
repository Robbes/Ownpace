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
 *    front of a port nobody else can reach.
 *
 * Build-time rather than runtime because it decides whether auth exists at all,
 * and a value the page could talk itself out of is not a boundary.
 */

type ViteEnv = {
  readonly VITE_EDITION?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_OPERATING_URL?: string;
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
  return env().VITE_OPERATING_URL ?? '';
}
