// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * IS THIS PAGE THE ONE THE SITE SERVES NOW? (workplan 0145; the owner's
 * "build the deploy check and the reload prompt", 2026-09-29)
 *
 * A tab left open across a deploy keeps running the code it loaded, against a
 * server that has moved on. It is the likeliest way to meet *The server
 * answered in a form this page does not know*, and no deploy check can reach
 * it. So the page asks the site which build it serves now, and offers a reload
 * when that is not its own (`NewVersionPrompt`).
 *
 * THE SITE'S BUILD, NOT THE API'S. `version.json` is written by the web build
 * beside the page (`vite.config.ts`), from the same two values stamped into
 * the page, and `deploy-live.sh` reads the same file. Comparing with the API
 * would be wrong in the one case that matters: after a deploy that moved the
 * API and not the web image, a reload loads the same page again, and a prompt
 * to reload would never go away. That mismatch is the deploy check's to
 * refuse, and the sidebar's stamp already shows it (`describeBuild`).
 *
 * A build differs only on a part both sides know, as the server's log line
 * has it: an unstamped build (a dev server, a hand build without `GIT_SHA`)
 * prompts nobody.
 */

import type { BuildIdentity } from './build-identity.ts';

/** Where this bundle is served from: `/`, or `/ui/` on the appliance. */
function base(): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const at = env?.BASE_URL ?? '/';
  return at.endsWith('/') ? at : `${at}/`;
}

/**
 * The build the site serves now, or null when it cannot say: not reached, not
 * found (a build from before `version.json`), or not the shape it writes.
 * Never from a cache: the question is what the site serves NOW.
 */
export async function fetchServedBuild(): Promise<BuildIdentity | null> {
  try {
    const res = await fetch(`${base()}version.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) return null;
    const { version, commit } = body as { version?: unknown; commit?: unknown };
    if (typeof version !== 'string' || typeof commit !== 'string') return null;
    return { version, commit };
  } catch {
    return null;
  }
}

const known = (part: string): boolean => part !== '' && part !== 'unknown';

/** Whether the site serves another build than the page on screen, on a part both know. */
export function servesAnotherBuild(page: BuildIdentity, served: BuildIdentity | null): boolean {
  if (!served) return false;
  const commits = known(page.commit) && known(served.commit) && page.commit !== served.commit;
  const versions = known(page.version) && known(served.version) && page.version !== served.version;
  return commits || versions;
}

/** Whoever asks the site when told to: the prompt, while it is mounted. */
const askers = new Set<() => void>();

/** Be told when there is a reason to ask now; returns how to stop. */
export function onAskServedBuild(ask: () => void): () => void {
  askers.add(ask);
  return () => {
    askers.delete(ask);
  };
}

/** A reason to ask now: an answer this page could not read (`unreadable-answer.ts`). */
export function askServedBuild(): void {
  for (const ask of askers) ask();
}
