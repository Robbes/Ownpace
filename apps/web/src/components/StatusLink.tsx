// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A LINK TO THE PAGE THAT SAYS WHETHER ANYTHING IS DOWN.
 *
 * The site footer got one when the 404 pages were built. The app did not, and
 * the app is where it matters more: somebody who cannot sign in is exactly the
 * person asking "is it me or is it them", and the sign-in screen is where they
 * are standing when they ask it.
 *
 * DERIVED AT RUNTIME from the address in the browser's bar — `app.` → `status.`
 * — and that choice is the whole design. The alternative is a `VITE_STATUS_URL`
 * baked at build time, which would mean a rebuild to move it, a new argument
 * threaded through the Dockerfile and compose, and a fourth setting that names
 * the environment and can therefore disagree with the other three. The
 * hostname cannot disagree with itself: it IS the environment, on every
 * deployment, with nothing to configure.
 *
 * The same `app.` → `status.` rule the site build uses (`site/prices.mjs`), and
 * the same refusal: RENDER NOTHING rather than guess when the host is not an
 * `app.` one. A link to a status page that does not exist is worse than no
 * link, because it answers "is it down" with a browser error — and localhost,
 * an IP address, and the appliance are all hosts where guessing would do that.
 */

import React from 'react';
import { Activity } from 'lucide-react';
import { useT } from '../i18n/index.tsx';

/**
 * `https://app.ota.ownpace.eu` → `https://status.ota.ownpace.eu`, or null when
 * the host is not an `app.` one. Exported for the test, which must be able to
 * ask about hosts this browser is not on.
 */
export function statusUrlFor(hostname: string, protocol: string): string | null {
  if (!hostname.startsWith('app.')) return null;
  const rest = hostname.slice('app.'.length);
  // `app.` alone, or `app.localhost`, is not a deployment with a sibling.
  if (!rest.includes('.')) return null;
  return `${protocol}//status.${rest}`;
}

const StatusLink: React.FC = () => {
  const t = useT();
  const href =
    typeof window === 'undefined'
      ? null
      : statusUrlFor(window.location.hostname, window.location.protocol);

  if (!href) return null;

  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
      rel="noreferrer"
    >
      <Activity className="w-4 h-4" aria-hidden="true" />
      {t('status.link')}
    </a>
  );
};

export default StatusLink;
