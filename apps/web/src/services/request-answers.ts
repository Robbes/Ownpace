// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE ANSWERS A VISITOR ALREADY GAVE (workplan 0152 T7 (a)).
 *
 * The site's estimate asks who is moving, from where and what; a *Leaving…*
 * page knows the provider and what it holds. Asking the same again on the
 * request form is how a form loses somebody, so the site's *Request access*
 * carries them along, as `?from=`, `?what=` and `?who=`, and the form's *What
 * are you moving?* arrives with one sentence built from them:
 *
 *   *Moving away from Google: email, calendar, contacts, and files, for one person.*
 *
 * Nothing new is stored: it is the note, which the person reads and edits like
 * anything else they type, and the server keeps its limits. Each value is
 * matched against its list, as `?tier=` is, so a URL anybody can edit puts no
 * stranger's text in the field: an unknown value is left out, and with nothing
 * known there is no sentence at all.
 *
 * In the language the page is asked for (`?locale=`), which the page switches
 * to only after its first render, so the sentence reads that language's own
 * strings rather than the translator of the moment.
 *
 * The vocabularies are the site's: `from` is the estimate's *Moving away from?*
 * answers, one or a comma list since a person may leave several (the owner,
 * 2026-10-04), `what` its data types (`site/profiles.mjs`'s OBJECT_TYPES, tasks
 * among them), `who` its customer types.
 */
import { STRINGS, type Locale, type StringKey } from '../i18n/strings.ts';
import { fill } from '../i18n/fill.ts';
import { formatList } from '../i18n/datetime.ts';

export const ANSWER_FROM = ['google', 'microsoft', 'apple', 'dropbox', 'box', 'other'] as const;
export const ANSWER_WHAT = ['mail', 'contacts', 'calendar', 'tasks', 'files', 'photos'] as const;
export const ANSWER_WHO = ['individual', 'family', 'sme'] as const;

/** How the app names each of the estimate's data types: the app's own words, where it has them. */
const WHAT_KEY: Record<(typeof ANSWER_WHAT)[number], StringKey> = {
  mail: 'domain.email',
  contacts: 'domain.contact',
  calendar: 'domain.calendar',
  tasks: 'domain.task',
  files: 'domain.file',
  photos: 'access.answers.photos',
};

const known = <T extends string>(list: ReadonlyArray<T>, value: string | null): T | undefined =>
  list.find((item) => item === value);

/** Each known value of a comma list, once, in the order given. */
const knownList = <T extends string>(list: ReadonlyArray<T>, value: string | null): T[] =>
  (value ?? '')
    .split(',')
    .map((v) => known(list, v.trim()))
    .filter((v): v is T => v !== undefined)
    .filter((v, i, all) => all.indexOf(v) === i);

/** The sentence the note arrives with, or undefined when the URL carries nothing this form knows. */
export function answersSentence(search: URLSearchParams, locale: Locale): string | undefined {
  const t = (key: StringKey, vars?: Readonly<Record<string, string>>) => fill(STRINGS[locale][key], vars);
  const from = knownList(ANSWER_FROM, search.get('from'));
  const what = knownList(ANSWER_WHAT, search.get('what'));
  const who = known(ANSWER_WHO, search.get('who'));
  if (from.length === 0 && what.length === 0 && who === undefined) return undefined;

  const head =
    from.length === 0
      ? t('access.answers.noFrom')
      : t('access.answers.from', {
          name: formatList(
            from.map((f) => t(`access.answers.provider.${f}`)),
            locale,
          ),
        });
  const items = what.map((w) => t(WHAT_KEY[w]).toLocaleLowerCase(locale));
  const body = items.length > 0 ? `: ${formatList(items, locale)}` : '';
  const tail = who === undefined ? '' : `, ${t(`access.answers.who.${who}`)}`;
  return `${head}${body}${tail}.`;
}
