// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The language the screen is in, for code that chooses words outside React.
 *
 * `serverMessage` (`services/api.ts`) is called from some sixty places with an
 * error and nothing else, and one kind of failure it words is ours: an answer
 * the page's schema refused, which has no server sentence to show. Handing it
 * `t` at every call site would be sixty edits, and one forgotten would put
 * the JSON back. So `LocaleProvider` publishes its locale here as it renders,
 * and the helper reads it.
 *
 * Read from the provider, not from `detectLocale()`: storage can be
 * unavailable (private mode), and then the provider holds a choice that
 * storage does not. Outside a provider this answers English, as `useLocale`
 * does there.
 */

import type { Register } from '@openmig/shared';
import { STRINGS, type Locale, type StringKey } from './strings.ts';
import { NL_JE } from './informal.ts';
import { fill, type TemplateVars } from './fill.ts';

let published: Locale = 'en';
let register: Register = 'formal';

/** Called by `LocaleProvider` with the locale it renders in. */
export function publishLocale(locale: Locale): void {
  published = locale;
}

/**
 * Called by `InTheirVoice` with the register a person's own page speaks in
 * (workplan 0176 T7), and back to `formal` when it leaves: the member's
 * screens say *u*.
 */
export function publishRegister(next: Register): void {
  register = next;
}

/** The locale the screen renders in; English outside a provider. */
export function activeLocale(): Locale {
  return published;
}

/**
 * `t` in the locale the screen renders in, for words chosen outside React,
 * and on a person's page whose Dutch says *je*, in the informal layer first.
 */
export function tActive(key: StringKey, vars?: TemplateVars): string {
  const twin = published === 'nl' && register === 'informal' ? NL_JE[key] : undefined;
  return fill(twin ?? STRINGS[published][key], vars);
}
