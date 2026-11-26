// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHERE THE SERVICE RUNS (workplan 0176 D16 (a), §22.5; the owner,
 * 2026-11-26: *"P16: a"*).
 *
 * ## One setting, two builds
 *
 * The stack's `.env` holds the country the service runs in as a two-letter
 * code (ISO 3166-1), `OWNPACE_COUNTRY`. Two builds read it, as both read the
 * stage: this bundle, where a person's link page says *Ownpace runs in
 * {country}.* under its first line (`components/WhereItRuns.tsx`), and the
 * public site's (`site/build.mjs`, with its own copy of these rules in
 * `site/country.mjs`, because `site/` imports nothing), whose home page takes
 * its sentence from the same value. `managed.yml` hands it to the web build as
 * the build arg `VITE_OWNPACE_COUNTRY`, because Vite exposes only `VITE_`
 * names; `deploy-live.sh` hands live's own value to every site build.
 * `scripts/a-country-both-builds-know-about.unit.test.ts` holds both halves to
 * it, and the two copies of the rules to each other.
 *
 * ## No country in a sentence, and none in a default
 *
 * Somebody else can run the same software, so the dictionary holds *Ownpace
 * runs in {country}.* and never a country, and nothing here defaults to one.
 * Unset or empty says nothing, which is what somebody else's deployment gets.
 * The appliance never says it, whatever its bundle was built with: it runs on
 * its owner's own machine, wherever that is.
 *
 * ## The name, in the reader's language, from the browser's own list
 *
 * `Intl.DisplayNames`, in the page's language. The list gives a name alone,
 * and a sentence in English or in Dutch puts an article before some of them
 * (*the United Kingdom*, *het Verenigd Koninkrijk*), so this adds it, by code,
 * from the two tables below. A browser without the list, or without a name for
 * the code, says nothing: a sentence with a bare code in it is worse than none.
 *
 * ## A value that is no country stops the build
 *
 * Anything but two letters is refused here, naming the setting. A code of two
 * letters that is no country is refused where the build runs, whose list is
 * whole (`countryChecked`, called by `vite.config.ts`): an old alias of another
 * code (*UK* is GB's), a code the list does not name, and a region of the list
 * that is no country (the EU, the euro area, the United Nations, outlying
 * Oceania, an unknown region). The owner meets the refusal, never a reader.
 *
 * ## Where the service runs, and nothing else (R3)
 *
 * The sentence says where the service runs. Where the copy ends up is the
 * provider the page names, which the family chose; nothing here says that the
 * data *stays* in a country, or in the EU.
 */

import type { Locale } from '../i18n/strings.ts';

/** The one name an operator sets, in the stack's `.env`. */
export const COUNTRY_SETTING = 'OWNPACE_COUNTRY';

/** What the bundle is handed: the setting, under the name Vite exposes. */
export interface CountryEnv {
  readonly VITE_OWNPACE_COUNTRY?: string;
}

/** Regions of the browser's list that are no country. */
const NOT_A_COUNTRY: ReadonlySet<string> = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ']);

/**
 * THE ARTICLE A SENTENCE PUTS BEFORE A NAME, by language and by code: *in the
 * United Kingdom*, *in het Verenigd Koninkrijk*. Grammar, for every name of
 * the list that takes one, and no deployment's value. `site/country.mjs` holds
 * the same two tables, and the guard holds them equal.
 */
export const ARTICLE: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
  en: Object.fromEntries(
    [
      'AE', 'AX', 'BQ', 'BS', 'CC', 'CF', 'CK', 'DO', 'FK', 'FO', 'GB', 'GM', 'GS', 'HM', 'IC', 'IO', 'KM',
      'KY', 'MH', 'MP', 'MV', 'NL', 'PH', 'PN', 'PS', 'SB', 'SC', 'TC', 'TF', 'UM', 'US', 'VG', 'VI',
    ].map((code) => [code, 'the']),
  ),
  nl: {
    ...Object.fromEntries(
      [
        'AE', 'BS', 'CC', 'CF', 'CK', 'DO', 'FK', 'FO', 'HM', 'IC', 'KM', 'KY', 'MH', 'MP', 'MV', 'PH', 'PN',
        'PS', 'SB', 'SC', 'TC', 'TF', 'UM', 'US', 'VG', 'VI',
      ].map((code) => [code, 'de']),
    ),
    GB: 'het',
    IO: 'het',
  },
};

function refused(value: string, why: string): Error {
  return new Error(
    `${COUNTRY_SETTING} is "${value}", which ${why}. Set it to the two-letter code of the ` +
      'country the service runs in (ISO 3166-1, such as DE or BE), or leave it empty to say ' +
      'nothing, and rebuild the web image and the site.',
  );
}

/**
 * The setting's code: trimmed, in capitals. Null when it is unset or empty,
 * which says nothing. Anything but two letters throws, naming the setting.
 */
export function countryCodeFrom(source: CountryEnv): string | null {
  const value = (source.VITE_OWNPACE_COUNTRY ?? '').trim();
  if (value === '') return null;
  if (!/^[A-Za-z]{2}$/.test(value)) throw refused(value, 'is not a two-letter country code');
  return value.toUpperCase();
}

/**
 * The browser's own list, in the reader's language, with no name made up for
 * a code it does not hold (`fallback: 'none'`). Two letters is a code the
 * list can read, so it answers rather than throws.
 */
function listedName(code: string, locale: Locale): string | null {
  if (typeof Intl.DisplayNames !== 'function') return null;
  return new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }).of(code) ?? null;
}

/**
 * Why a two-letter code is no country, or null when it is one: an old alias
 * of another code, a code the list does not name, or a region of the list
 * that is no country. For the build, whose list is whole.
 */
export function refusedCountry(code: string): string | null {
  const canonical = Intl.getCanonicalLocales(`und-${code}`)[0]?.slice(4);
  if (canonical !== code) return `is an old name for ${canonical ?? 'another code'}`;
  if (NOT_A_COUNTRY.has(code)) return 'is a region of the list that is no country';
  if (listedName(code, 'en') === null) return 'is no country the list names';
  return null;
}

/**
 * THE BUILD'S CHECK (`vite.config.ts`): the setting's code, or null when it
 * is unset; anything that is not a country's code throws, naming the setting.
 */
export function countryChecked(source: CountryEnv): string | null {
  const code = countryCodeFrom(source);
  if (code === null) return null;
  const why = refusedCountry(code);
  if (why !== null) throw refused(source.VITE_OWNPACE_COUNTRY!.trim(), why);
  return code;
}

/**
 * The country's name as a sentence says it, in the reader's language and
 * with its article; null where the browser has no name for it.
 */
export function countryName(code: string, locale: Locale): string | null {
  const name = listedName(code, locale);
  if (name === null) return null;
  const article = ARTICLE[locale][code];
  return article ? `${article} ${name}` : name;
}

/**
 * WHERE THE SERVICE RUNS, as the sentence names it: the country's name in the
 * reader's language, or null when the deployment says nothing, and always on
 * the appliance. `value` is the build's (`VITE_OWNPACE_COUNTRY`), which the
 * caller reads where Vite can replace it (`components/WhereItRuns.tsx`).
 */
export function whereItRuns(locale: Locale, value: unknown, selfhost: boolean): string | null {
  if (selfhost) return null;
  const code = countryCodeFrom({ VITE_OWNPACE_COUNTRY: typeof value === 'string' ? value : undefined });
  return code === null ? null : countryName(code, locale);
}
