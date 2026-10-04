// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * *← ownpace.eu*: the way back to the public site, from the two pages a person
 * meets before they are inside the app (workplan 0152 T9). A visitor arrives
 * at either from the site's *Sign in* or *Request access*, and had no way back
 * but the browser's.
 *
 * The address and the name are `services/site-home.ts`'s, from the deployment's
 * own site setting, in the reader's language. The arrow is drawn, not read: the
 * link's name is the site's.
 */

import React from 'react';
import { useLocale } from '../i18n/index.tsx';
import { siteHomeUrl, siteName } from '../services/site-home.ts';

export const BackToSite: React.FC = () => {
  const { locale } = useLocale();
  return (
    <a
      href={siteHomeUrl(locale)}
      className="inline-flex items-center gap-1 text-sm text-site-teal hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-site-teal rounded"
    >
      <span aria-hidden="true">←</span>
      {siteName()}
    </a>
  );
};

export default BackToSite;
