// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Locale context (workplan 0024 T1, ADR-0013).
 *
 * The locale is a CLIENT concern: persisted per browser
 * (localStorage `openmig.locale`), defaulting from `navigator.language`
 * (`nl*` → Dutch, everything else → English). No server state — a per-member
 * preference can join the managed edition later without changing callers.
 */

import React from 'react';
import { STRINGS, type Locale, type StringKey } from './strings.ts';
import { formatRelativeToNow, formatDateTime, formatNumber, formatCurrency } from './datetime.ts';

const STORAGE_KEY = 'openmig.locale';

export function detectLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'nl') return stored;
  } catch {
    // Storage unavailable (private mode, embedded) — fall through to detection.
  }
  return navigator.language?.toLowerCase().startsWith('nl') ? 'nl' : 'en';
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: StringKey, vars?: TemplateVars) => string;
}

const LocaleContext = React.createContext<LocaleContextValue | null>(null);

/**
 * Values substituted into a string's `{placeholders}` (workplan 0080).
 *
 * Added for the probe results, and the reason it had to exist rather than be
 * composed at the call site: a sentence built by concatenating dictionary
 * fragments has ENGLISH word order baked into the concatenation. *The JMAP
 * session document at {url} answered {status}* and its Dutch counterpart do
 * not put those two values in the same places, and no amount of care at the
 * call site fixes that — the ordering belongs to the sentence, which means it
 * belongs to the dictionary.
 */
export type TemplateVars = Readonly<Record<string, string | number>>;

/**
 * Substitute `{name}` from `vars`. A placeholder with no value is left ALONE
 * rather than blanked: a visible `{count}` on screen is a bug report, and an
 * empty gap is a mystery.
 */
function fill(template: string, vars?: TemplateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = React.useState<Locale>(detectLocale);

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is acceptable; the session keeps the chosen locale.
    }
  }, []);

  const t = React.useCallback(
    (key: StringKey, vars?: TemplateVars) => fill(STRINGS[locale][key], vars),
    [locale],
  );

  const value = React.useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

/**
 * The full locale handle. Outside a LocaleProvider it degrades to a fixed
 * English handle (with setLocale a no-op) instead of throwing: the app always
 * mounts the provider, so the un-provided case is an isolated render — a
 * component test, a storybook-style harness — where crashing over a missing
 * language context would punish exactly the wrong caller. English output in
 * that situation is correct, not a bug mask: it is the dictionary's source
 * language.
 */
export function useLocale(): LocaleContextValue {
  const ctx = React.useContext(LocaleContext);
  if (!ctx) {
    return {
      locale: 'en',
      setLocale: () => {},
      t: (key: StringKey, vars?: TemplateVars) => fill(STRINGS.en[key], vars),
    };
  }
  return ctx;
}

/** Shorthand for components that only read strings. */
export function useT(): (key: StringKey, vars?: TemplateVars) => string {
  return useLocale().t;
}

/**
 * The date/time/number formatters bound to the active locale — the only form
 * components should reach for (workplan 0024 T3). The pure functions live in
 * `datetime.ts`; outside a LocaleProvider this inherits `useLocale()`'s
 * documented English fallback, so isolated renders keep working.
 */
export function useFormatters(): {
  relativeToNow: (when: string | Date) => string;
  dateTime: (when: string | Date) => string;
  number: (n: number) => string;
  currency: (cents: number, currency: string) => string;
} {
  const { locale } = useLocale();
  return React.useMemo(
    () => ({
      relativeToNow: (when: string | Date) => formatRelativeToNow(when, locale),
      dateTime: (when: string | Date) => formatDateTime(when, locale),
      number: (n: number) => formatNumber(n, locale),
      currency: (cents: number, currency: string) => formatCurrency(cents, currency, locale),
    }),
    [locale],
  );
}

export type { Locale, StringKey };
