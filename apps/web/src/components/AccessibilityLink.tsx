// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A link to the accessibility statement (workplan 0145 T9 (b)).
 *
 * The statement says which standard the app aims for, the gaps known today,
 * and where to report a barrier. A person meets a barrier on a screen of the
 * app, so the app links it, in the reader's language, where it links its
 * other texts outside a form: under the sign-in page, in the menu, and at the
 * foot of the grant page. The address is `services/accessibility-link.ts`'s,
 * so `VITE_LEGAL_SITE_URL` moves it with the legal links.
 *
 * In the same tab, as the grant page's links to the privacy policy and the
 * terms are: none of these places holds a form half filled in.
 */

import React from 'react';
import { useLocale } from '../i18n/index.tsx';
import { accessibilityUrl } from '../services/accessibility-link.ts';

export const AccessibilityLink: React.FC<{
  readonly className?: string;
  /** An icon before the words, as the menu's entries have (`aria-hidden`). */
  readonly children?: React.ReactNode;
}> = ({ className, children }) => {
  const { t, locale } = useLocale();
  return (
    <a href={accessibilityUrl(locale)} className={className}>
      {children}
      {t('accessibility.link')}
    </a>
  );
};

export default AccessibilityLink;
