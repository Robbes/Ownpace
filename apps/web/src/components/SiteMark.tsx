// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The site's mark, on the two pages a person meets before they are inside the
 * app: `/login` and `/request-access` (workplan 0152 T9).
 *
 * The drawing is `site/brand/logo.svg`, which `scripts/make-logo.py` draws
 * from one set of constants. It is inline rather than a file this bundle
 * serves: the appliance serves the bundle under `/ui`, and an absolute asset
 * address escapes that mount (`index.html` says how the favicon learned it).
 * `scripts/one-look-from-the-site-to-the-app.unit.test.ts` holds every shape
 * here to the site's file, so a redrawn mark fails until both agree.
 *
 * Decorative: the page's title names Ownpace beside it.
 */

import React from 'react';

export const SiteMark: React.FC<{ readonly className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 100 100"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <rect width="100" height="100" rx="22" fill="#0E4F4A" />
    <path
      d="M 22.749 59.919 A 29 29 0 1 1 64.500 75.115"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="8.5"
      strokeLinecap="round"
    />
    <circle cx="64.500" cy="75.115" r="5.75" fill="#7FD4C1" />
  </svg>
);

export default SiteMark;
