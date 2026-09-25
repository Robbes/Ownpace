// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What a closed-list choice is called on screen (workplan 0148 T3, D7).
 *
 * ONE FUNCTION, because two doors draw the archive form's choice: the wizard
 * and the Connections page. An option whose export no reader opens yet carries
 * a tag, *To be tested*, and it is TEXT inside the option's name, since a
 * `<select>`'s option can hold nothing else. Composed in one place, so the two
 * doors cannot word it differently.
 *
 * The label is verbatim in every language (the provider's own name); the tag is
 * ours and translated. A name and a tag, not a sentence, so there is no word
 * order to get wrong in Dutch.
 */

import type { CredentialOption } from '@openmig/shared';
import type { StringKey } from './strings.ts';

export function optionName(t: (key: StringKey) => string, option: CredentialOption): string {
  // A provider's own name is verbatim; our own words (0148 T9's two places)
  // come through a key.
  const name = option.labelKey ? t(option.labelKey as StringKey) : (option.label ?? option.value);
  return option.tagKey ? `${name} — ${t(option.tagKey as StringKey)}` : name;
}
