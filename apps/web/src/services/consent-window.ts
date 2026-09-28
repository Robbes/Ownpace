// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE CONSENT WINDOW, OPENED BY THE PRESS (workplan 0145 T5).
 *
 * A browser lets a page open a window only as the direct result of a press,
 * and only for a short while after it (the specs call it transient user
 * activation). Both doors that run a consent, the Connections page's panel
 * (`ProviderConsent.tsx`) and the wizard's source step (`CreateMapping.tsx`),
 * used to ask our server for the provider's address first and open the window
 * once the answer came. Desktop Chrome still counted the press after that
 * wait. Safari on an iPhone is reported not to, and a blocked window was never
 * noticed: the button looked as if it did nothing.
 *
 * So each door now does three things, in this order:
 *
 * 1. **In the press, before anything is awaited:** `openConsentWindow(name)`
 *    opens a blank window under the consent's name, and answers `null` when
 *    the browser opened none.
 * 2. **When the server answers:** `sendConsentWindow(w, url)` points that
 *    window at the provider. A page may send a window it opened anywhere,
 *    across origins too, and the window keeps its opener: the ending still
 *    hands the result back over `postMessage`, because the callback page is
 *    served with `Cross-Origin-Opener-Policy: unsafe-none`
 *    (`callbackPageHeaders`, `apps/api/src/routes/migrations/google-consent.ts`)
 *    and this app sets no opener policy of its own. When there is no window to
 *    send (none opened, or the person closed the blank one while it waited),
 *    it answers `false`, and the door shows one sentence and a link
 *    (`ConsentWindowLink`). Tapping the link is a new press, so no blocker
 *    stops it. It targets the same name, not `_blank`, and carries
 *    `rel="opener"`, so the window it opens can still hand the result back.
 * 3. **When the server refuses:** `closeConsentWindow(w)` closes the blank
 *    window, and the refusal shows as it did before.
 *
 * Only the opening is shared. Each door keeps its own state: the wizard's copy
 * is the wizard's business.
 *
 * **Nothing else in `apps/web/src` opens a window.**
 * `components/a-consent-window-opened-by-the-press.unit.test.tsx` scans for
 * the call, so a third copy of the opening, after an `await`, cannot come
 * back.
 *
 * **Not built: a same-tab trip** for a browser where neither the window nor
 * the link comes back. The consent result is handed to the opener and not
 * kept by the server, so that is a feature of its own, parked in 0145 until
 * T0 or T10 finds such a browser.
 */

import type { GrantProvider } from '@openmig/shared';

/** The name on the button a provider's consent draws: *Connect with Google*. */
export const GRANT_PROVIDER_NAMES: Readonly<Record<GrantProvider, string>> = {
  google: 'Google',
  dropbox: 'Dropbox',
  microsoft: 'Microsoft',
};

/**
 * The provider's name for a sentence, or the key itself when the table has
 * none: a key on screen is a bug report, a blank is a mystery.
 */
export function consentProviderName(provider: string): string {
  return (GRANT_PROVIDER_NAMES as Readonly<Record<string, string>>)[provider] ?? provider;
}

/**
 * The window a provider's consent opens in. One name per provider, so a
 * second press reuses the window the first one opened, and the link a blocked
 * window offers opens that same window.
 */
export function consentWindowName(provider: string): string {
  return `ownpace-${provider}-consent`;
}

/** The size the consent screens are drawn for. */
const FEATURES = 'popup,width=520,height=640';

/**
 * A consent window, as far as this helper touches it. A browser's `Window` is
 * one; so is a test's stand-in.
 */
export interface ConsentWindow {
  readonly closed: boolean;
  readonly location: { href: string };
  close(): void;
}

/**
 * The browser's window, described by the one call made on it here. The root
 * `tsc` covers this file with Node's lib rather than DOM (a `lib` is
 * program-wide, AGENTS.md), so it reaches the browser through `globalThis`
 * with a cast, as `api.ts` and `oidc.ts` reach `location`.
 */
const window = globalThis as unknown as {
  open(url: string, target: string, features: string): ConsentWindow | null | undefined;
};

/**
 * Open a blank window for the consent, or `null` when the browser opened none.
 * Call it inside the click handler, before anything is awaited: that is the
 * whole point.
 */
export function openConsentWindow(name: string): ConsentWindow | null {
  // `?? null`: the specs answer `null` for no window, and a host that
  // implements no windows at all may answer `undefined` instead. Every door
  // treats "no window" as one thing.
  return window.open('', name, FEATURES) ?? null;
}

/**
 * Send the window the press opened to the provider. `false` when there is no
 * window to send: the browser opened none, or the blank one was closed while
 * the server was answering. The door then offers the link.
 */
export function sendConsentWindow(w: ConsentWindow | null, url: string): boolean {
  if (w === null || w.closed) return false;
  w.location.href = url;
  return true;
}

/** Close the blank window when the server refused to start the consent. */
export function closeConsentWindow(w: ConsentWindow | null): void {
  if (w !== null && !w.closed) w.close();
}

/**
 * What the link a blocked window offers says: the host it goes to, which is
 * the provider's own (`accounts.google.com`), rather than the whole consent
 * address with its client id and state. An address that does not parse is
 * shown whole: a link that says where it goes is still a link.
 */
export function consentLinkText(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
