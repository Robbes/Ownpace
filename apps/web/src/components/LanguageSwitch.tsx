// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The language switch, in the sidebar and on the pages outside `Layout`
 * (workplan 0145 T6).
 *
 * The grant and view pages are routed outside `Layout`, and `Layout` held the
 * only switch, so a Dutch reader whose phone is set to English read those
 * pages in English and could not change it. Two text buttons, not an icon or
 * a flag (ADR-0013, WCAG 2.2 AA per SAD §23), and each says whether it is the
 * one on (`aria-pressed`). The choice is one stored preference.
 *
 * Since the UX sweep `Layout` draws this one too, so the sidebar's switch is a
 * named group as well (its own was a `<div>` with a label nothing reads). Each
 * button is big enough for a thumb, and says its language in that language
 * (`lang`): a Dutch voice reads a bare "EN" as the word *en*.
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
          lang={l}
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={`px-3 py-2 text-xs font-medium rounded ${
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
