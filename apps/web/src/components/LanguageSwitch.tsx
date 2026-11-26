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
import { LOCALES, type Locale } from '../i18n/strings.ts';
import { usePersonsPage } from './persons-page.tsx';

/**
 * Each language in its own words, as a person's own page says it (workplan
 * 0176 T9.7): *English* and *Nederlands*, the same in either language, since
 * each is said in its own (`lang`). The sidebar keeps *EN* and *NL*.
 */
const IN_ITS_OWN_WORDS: Readonly<Record<Locale, string>> = {
  en: 'English', // i18n-exempt: a language's own name, the same on every page
  nl: 'Nederlands', // i18n-exempt: a language's own name, the same on every page
};

const LanguageSwitch: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { locale, setLocale, t } = useLocale();
  // A target like any other on a person's own page: 44 by 44, in full words.
  const personsPage = usePersonsPage() !== null;
  return (
    <div role="group" aria-label={t('language.label')} className={`flex items-center gap-2 ${className}`}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={`${personsPage ? 'min-h-[44px] min-w-[44px] px-3 py-2 text-base' : 'px-3 py-2 text-xs'} font-medium rounded ${
            locale === l
              ? personsPage
                ? 'bg-blue-50 text-blue-800 underline underline-offset-4'
                : 'bg-blue-50 text-blue-700'
              : personsPage
                ? 'text-gray-800 hover:bg-gray-100'
                : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {personsPage ? IN_ITS_OWN_WORDS[l] : l.toUpperCase()}
        </button>
      ))}
    </div>
  );
};

export default LanguageSwitch;
