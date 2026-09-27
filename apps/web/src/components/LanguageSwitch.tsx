// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The language switch for the pages outside `Layout` (workplan 0145 T6).
 *
 * The grant and view pages are routed outside `Layout`, and `Layout` holds the
 * only switch, so a Dutch reader whose phone is set to English read those
 * pages in English and could not change it. These are the same two text
 * buttons `Layout` has, not an icon or a flag (ADR-0013, WCAG 2.2 AA per SAD
 * §23), and each says whether it is the one on (`aria-pressed`). The choice
 * is the same stored preference `Layout`'s switch writes.
 */

import React from 'react';
import { useLocale } from '../i18n/index.tsx';
import { LOCALES } from '../i18n/strings.ts';

const LanguageSwitch: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { locale, setLocale, t } = useLocale();
  return (
    <div role="group" aria-label={t('language.label')} className={`flex items-center gap-2 ${className}`}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={`px-2 py-1 text-xs font-medium rounded ${
            locale === l ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
};

export default LanguageSwitch;
