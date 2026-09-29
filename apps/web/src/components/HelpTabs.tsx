// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * HELP IS ONE MENU ENTRY WITH TWO TABS (workplan 0153 T3 (c)): the setup
 * checklist and the setup guides. They were two entries of the menu, beside
 * five others, for what a person reads when they are stuck; the menu now says
 * *Help* once, and these tabs say which half is open.
 *
 * A MEMBER'S ONLY. The appliance's menu keeps both entries, and an operator
 * in no organisation has the guides alone, because the checklist belongs to
 * an organisation (0093 T6/T7): a tab to a page that refuses them would be
 * the dead end the menu was fixed to stop offering.
 */
import React from 'react';
import { Link, useLocation } from 'react-router';
import { useAuthStore } from '../stores/auth-store.ts';
import { isSelfHost } from '../services/edition.ts';
import { useT } from '../i18n/index.tsx';

const TABS = [
  { href: '/setup', label: 'nav.setup' },
  { href: '/docs', label: 'nav.docs' },
] as const;

export const HelpTabs: React.FC = () => {
  const t = useT();
  const { pathname } = useLocation();
  const { tenantCount } = useAuthStore();
  if (isSelfHost() || tenantCount === 0) return null;

  return (
    <nav aria-label={t('nav.help')} className="mb-6 flex flex-wrap gap-2 border-b border-gray-200">
      {TABS.map((tab) => {
        const current = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            to={tab.href}
            aria-current={current ? 'page' : undefined}
            className={`-mb-px px-4 py-2 text-sm font-medium border-b-2 ${
              current ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {t(tab.label)}
          </Link>
        );
      })}
    </nav>
  );
};
