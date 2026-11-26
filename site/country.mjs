// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHERE THE SERVICE RUNS, AS THE SITE SAYS IT (workplan 0176 D16 (a), §22.5;
 * the owner, 2026-11-26: *"P16: a"*).
 *
 * One setting in the stack's `.env`, `OWNPACE_COUNTRY`, holds the country the
 * service runs in as a two-letter code (ISO 3166-1). The web build reads it
 * for a person's link page, which says *Ownpace runs in {country}.*, and this
 * site's build reads it for the home page's sentence, as both read the stage.
 * The rules are the web app's (`apps/web/src/services/where-it-runs.ts`),
 * written out here because `site/` imports nothing;
 * `scripts/a-country-both-builds-know-about.unit.test.ts` holds the two copies
 * to the same answer for every code.
 *
 * - **Unset or empty says nothing.** Somebody else can run the same software,
 *   so no sentence names a country and nothing defaults to one.
 * - **Anything that is no country's code stops the build,** naming the
 *   setting: not two letters, an old alias of another code (*UK* is GB's), a
 *   code the list does not name, or a region of the list that is no country.
 * - **The name is the list's,** Node's own (`Intl.DisplayNames`), in each
 *   language of the site, with the article a sentence puts before it (*the
 *   United Kingdom*, *het Verenigd Koninkrijk*).
 * - **The home page says *in the EU* only of a member state** (`EU_MEMBERS`).
 */

/** The one name an operator sets, in the stack's `.env`. */
export const COUNTRY_SETTING = 'OWNPACE_COUNTRY';

/** Regions of the list that are no country. */
const NOT_A_COUNTRY = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ']);

/**
 * THE ARTICLE A SENTENCE PUTS BEFORE A NAME, by language and by code. Grammar,
 * for every name of the list that takes one, and no deployment's value; the
 * web app's module holds the same two tables.
 */
export const ARTICLE = {
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

/** The member states of the European Union, the 27 of 2020 on: where the home page says *in the EU*. */
export const EU_MEMBERS = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU',
  'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

function refused(value, why) {
  return new Error(
    `${COUNTRY_SETTING} is "${value}", which ${why}. Set it to the two-letter code of the ` +
      'country the service runs in (ISO 3166-1, such as DE or BE), or leave it empty to say ' +
      'nothing, and rebuild the web image and the site.',
  );
}

/** The list's own name for a code, in a language; null for a code it does not hold. */
const listedName = (code, locale) =>
  new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }).of(code) ?? null;

/**
 * The setting's code, trimmed and in capitals, or null when it is unset or
 * empty. Throws, naming the setting, for anything that is no country's code.
 */
export function countryFrom(raw) {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  if (!/^[A-Za-z]{2}$/.test(value)) throw refused(value, 'is not a two-letter country code');
  const code = value.toUpperCase();
  const canonical = Intl.getCanonicalLocales(`und-${code}`)[0]?.slice(4);
  if (canonical !== code) throw refused(value, `is an old name for ${canonical ?? 'another code'}`);
  if (NOT_A_COUNTRY.has(code)) throw refused(value, 'is a region of the list that is no country');
  if (listedName(code, 'en') === null) throw refused(value, 'is no country the list names');
  return code;
}

/** The country's name as a sentence says it, in a language of the site, with its article. */
export function countryName(code, locale) {
  const name = listedName(code, locale);
  if (name === null) return null;
  const article = ARTICLE[locale]?.[code];
  return article ? `${article} ${name}` : name;
}

/**
 * Where the service runs, as the site's pages say it: per language, the name
 * and whether it is in the EU. Null when the setting says nothing.
 */
export function whereItRuns(raw, locales = ['en', 'nl']) {
  const code = countryFrom(raw);
  if (code === null) return null;
  return {
    code,
    ...Object.fromEntries(locales.map((locale) => [locale, { name: countryName(code, locale), eu: EU_MEMBERS.has(code) }])),
  };
}
