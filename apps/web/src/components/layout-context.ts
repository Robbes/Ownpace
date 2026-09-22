// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Pure helpers for the Layout's header and nav-highlight logic (0034 T3).
 *
 * Pure functions rather than logic inline in the component, per the
 * edition.ts `*For(edition, ...)` pattern — the edition flag is baked in by
 * vite `define`, so branch-dependent behavior is tested here as functions
 * of an explicit argument instead of by stubbing an environment variable
 * that no longer exists at runtime.
 */

/** The per-mapping operating screens, by their route segment. */
export type MappingScreen = 'deletions' | 'moves' | 'failures' | 'verify' | 'finish';

const MAPPING_SCREENS: readonly MappingScreen[] = [
  'deletions',
  'moves',
  'failures',
  'verify',
  'finish',
];

export interface MappingRouteContext {
  readonly mappingId: string;
  /** null on the hub itself (`/mappings/:id`). */
  readonly screen: MappingScreen | null;
}

/**
 * Which mapping a route is about, if any. `/mappings/new` is the creation
 * wizard, not a mapping context; `/mappings` alone is the list.
 */
export function mappingRouteContext(pathname: string): MappingRouteContext | null {
  const m = pathname.match(/^\/mappings\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!m) return null;
  const id = m[1]!;
  if (id === 'new') return null;
  const rawScreen = m[2];
  const screen = MAPPING_SCREENS.includes(rawScreen as MappingScreen)
    ? (rawScreen as MappingScreen)
    : null;
  return { mappingId: decodeURIComponent(id), screen };
}

/**
 * Which nav entry should light up (0034 T3's corrected mechanism).
 *
 * Plain prefix-matching cannot light `/deletions` from
 * `/mappings/acme/deletions` — so on a per-mapping route the SCREEN segment
 * is matched against the flat nav hrefs (the appliance's nav), and managed
 * lights its `/mappings` entry for any mapping-scoped path. Everywhere else
 * the old first-match prefix rule stands.
 */
export function activeNavHref(
  pathname: string,
  hrefs: readonly string[],
): string | null {
  const ctx = mappingRouteContext(pathname);
  if (ctx) {
    if (hrefs.includes('/mappings')) return '/mappings';
    if (ctx.screen) {
      const screenHref = `/${ctx.screen}`;
      if (hrefs.includes(screenHref)) return screenHref;
    }
    return null;
  }
  return hrefs.find((href) => pathname.startsWith(href)) ?? null;
}

/**
 * Middle-out truncation for mapping ids in the header — the id's start and
 * end are what an operator recognizes from their config file.
 */
export function truncateMiddle(value: string, max = 28): string {
  if (value.length <= max) return value;
  const keep = Math.max(4, Math.floor((max - 1) / 2));
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

/**
 * Where the header's back arrow goes — UP one level, not back in history.
 *
 * The hub goes up to the list of migrations; a screen under it (Failures,
 * Check, Finish…) goes up to its hub. A route rather than `history.back()`,
 * because history is whatever the person did before arriving: a deep link
 * from an email has no in-app "back" at all, and "back" would take them out
 * of the product.
 *
 * The owner asked for this on 2026-09-22, having clicked the header's only
 * link on a migration's hub expecting it to go back — it pointed at the page
 * they were already on.
 */
export function upHref(ctx: MappingRouteContext): string {
  return ctx.screen === null ? '/mappings' : `/mappings/${encodeURIComponent(ctx.mappingId)}`;
}

/**
 * What the header calls a migration: its NAME, not its id.
 *
 * The header was designed on the appliance, where a mapping's id is a slug
 * somebody chose (`acme-mail`) and reads as a name. On managed it is a UUID,
 * so a person who had named their migration "Goog2NC" saw
 * `ff591fee-9e2a…-37de2233cb7b` at the top of every one of its screens.
 *
 * The shortened id is the fallback, never a blank: while the name is loading,
 * when it could not be read, and on the appliance, which has no separate name
 * and needs none.
 */
export function mappingDisplayName(mappingId: string, name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : truncateMiddle(mappingId);
}
