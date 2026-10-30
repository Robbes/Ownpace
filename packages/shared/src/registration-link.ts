// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The grant mail's link, which opens registration with the address filled in
 * (workplan 0095 T6; the owner, 2026-10-29).
 *
 * ## Why
 *
 * The owner, after their own grant on live: *"I needed to register an account
 * again. While I thought I already filled in my data when asking access to the
 * alpha."* The request form adds a row to our own table and creates no account
 * (ADR-0042: the issuer owns identity, and creating the account through its
 * API was option B in 0095 T0, rejected). So the person registers at the
 * sign-in service, and typed the address there a second time.
 *
 * ## What the link carries, and where
 *
 * The address the mail already prints on its next line ("Use this account:"),
 * after `#`. A fragment is never part of an HTTP request or a Referer, so no
 * server log of ours, nor the reverse proxy's in front of us, receives it. The
 * sign-in page reads it in the browser and, only when somebody presses
 * "Create your account", hands it to the issuer as the standard `login_hint`
 * (OIDC Core §3.1.2.1) with `prompt=create` (Initiating User Registration via
 * OpenID Connect 1.0).
 *
 * STILL NO TOKEN. The link authorises nothing: anybody can type a link with
 * any address in it, and what binds a person to the organisation is an
 * address the issuer verified with a code (`claimRequestedMembership`). So
 * the mail stays safe to forward, which is the property its
 * `appUrl` comment in `notifications.ts` exists to keep.
 *
 * ## Both halves in one place
 *
 * The API writes the link (`renderEvent`) and the web app reads it
 * (`Login.tsx`). One module for both, so the key and the encoding cannot drift
 * apart: `registration-link.unit.test.ts` writes a link with one and reads it
 * back with the other.
 */
import type { NotificationLocale } from './notifications.ts';

/** The fragment's one key. */
const KEY = 'register';

/**
 * An address, as far as a sign-in page needs to know: something, an `@`,
 * something, no spaces, at most 320 characters, the request form's own limit
 * (`apps/api/src/routes/access-requests.ts`), so every address a request can
 * hold survives the trip. The issuer decides what it accepts; this only keeps
 * a junk fragment from becoming a button.
 */
const ADDRESS = /^[^\s@]+@[^\s@]+$/;
const LONGEST = 320;

/**
 * The sign-in page in the mail's language, with the address after `#`. One
 * trailing slash on the setting is not doubled; the address is trimmed and
 * percent-encoded, so `+` and `@` survive the trip.
 */
export function registrationLink(appUrl: string, locale: NotificationLocale, email: string): string {
  return `${appUrl.replace(/\/$/, '')}/login?locale=${locale}#${KEY}=${encodeURIComponent(email.trim())}`;
}

/**
 * The address a grant link carries, or null.
 *
 * Null for anything that is not `register=` and an address: no fragment,
 * another key, a broken `%` escape, a value too long or without an `@`. The
 * sign-in page then draws exactly the page it draws without a link.
 */
export function addressFromRegistrationLink(hash: string): string | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of fragment.split('&')) {
    if (!part.startsWith(`${KEY}=`)) continue;
    let address: string;
    try {
      address = decodeURIComponent(part.slice(KEY.length + 1)).trim();
    } catch {
      return null;
    }
    return address.length <= LONGEST && ADDRESS.test(address) ? address : null;
  }
  return null;
}
