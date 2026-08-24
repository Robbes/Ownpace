// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT BUILD IS THIS? — asked of the bundle AND of the server.
 *
 * Every support conversation starts with that question, and until now the only
 * thing that could answer it was `GET /version` (`buildIdentity()` in
 * `@openmig/core`), which nobody looking at the screen was going to curl.
 *
 * TWO ANSWERS, NOT ONE, and that is the point rather than an accident. A
 * bundle can only ever report the version it was BUILT from, and on an
 * appliance a stale bundle can be served in front of a newer server: nginx
 * hands out whatever is in its image, the API is a different container, and
 * nothing makes them move together. A single number captioned "the version
 * that is running" would then be a status that does not belong to the thing
 * that happened — the exact shape hard rule 10 exists to refuse.
 *
 * So the UI reports its own build, asks the server for the server's, and shows
 * BOTH when they disagree. A mismatch is not decoration: it is the only way a
 * stale bundle announces itself, and it is a real failure mode of this stack
 * (`docker compose up -d api` without `web`).
 */

type ViteEnv = {
  readonly VITE_VERSION?: string;
  readonly VITE_COMMIT?: string;
};

function env(): ViteEnv {
  return (import.meta as unknown as { env?: ViteEnv }).env ?? {};
}

export interface BuildIdentity {
  readonly version: string;
  readonly commit: string;
}

/** A short commit for display. Full SHAs are for machines. */
export function shortCommit(commit: string): string {
  if (!commit || commit === 'unknown') return '';
  return commit.slice(0, 7);
}

/**
 * What THIS bundle was built from.
 *
 * `vite.config.ts` stamps both at build time: the version from the monorepo
 * root `package.json` — one source, so there is no second number to drift —
 * and the commit from the `GIT_SHA` build argument the images pass.
 *
 * Falls back to empty rather than to a plausible-looking number. A build stamp
 * that invents `0.0.0` when it was not stamped is worse than one that admits
 * it does not know, because only the second sends anyone to look at why.
 */
export function uiBuild(): BuildIdentity {
  return { version: env().VITE_VERSION ?? '', commit: env().VITE_COMMIT ?? '' };
}

/**
 * What the SERVER answering this UI is running.
 *
 * Both editions mount it, at the root the API of that edition answers on: the
 * appliance serves `/version` itself, and the managed web image's nginx
 * proxies `/api` to the api container. `operatingBaseUrl()` already encodes
 * exactly that difference, so this does not invent a second opinion about it.
 *
 * Returns null when it cannot be reached or does not answer with a shape we
 * recognise. The caller renders the UI's own build alone in that case — the
 * absence is not worth an error banner, and a version stamp that could take
 * the page down with it would be a poor trade.
 */
export async function fetchServerBuild(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<BuildIdentity | null> {
  try {
    const res = await fetch(`${baseUrl}/version`, { signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) return null;
    const { version, commit } = body as { version?: unknown; commit?: unknown };
    if (typeof version !== 'string') return null;
    return { version, commit: typeof commit === 'string' ? commit : '' };
  } catch {
    // Unreachable, aborted, or not JSON. See the doc comment: the stamp is not
    // load-bearing enough to justify surfacing this, and `null` is a complete
    // answer that the caller already handles.
    return null;
  }
}

/**
 * How the two should be shown together.
 *
 * Separated from React so the interesting decision — when to say two things
 * instead of one — can be tested without rendering anything.
 */
export function describeBuild(ui: BuildIdentity, server: BuildIdentity | null): string {
  const render = (b: BuildIdentity) => {
    const short = shortCommit(b.commit);
    if (!b.version) return short ? short : '';
    return short ? `v${b.version} · ${short}` : `v${b.version}`;
  };

  const uiText = render(ui);
  if (!server) return uiText;

  const serverText = render(server);
  // Agreeing is the ordinary case, and saying it twice would train the reader
  // to stop looking at it — which is precisely when a mismatch would slip by.
  if (uiText === serverText) return serverText;
  if (!uiText) return serverText;
  return `UI ${uiText} · API ${serverText}`;
}
