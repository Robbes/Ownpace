// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A data type the migration page will not add, in the reader's language (UX
 * sweep, 2026-10-17).
 *
 * The rule in shared (`kindChoices`) refuses with an English `reason`, written
 * for the API, its logs and the appliance: *"A kind can only be added before
 * cutover…"*, or *"This account MEASURED that it cannot carry 'task'…"*. The
 * data types panel showed it as served, so a Dutch screen read English
 * developer prose. The rule now says which refusal it was in `code`, and the
 * page says that in its own words. The code is the rule's own statement, so
 * this is a translation, not a guess at what the sentence meant.
 *
 * A refusal without a code (an older API, or a code this page does not know)
 * shows the served English, and says it is English so a screen reader on a
 * Dutch page reads it in an English voice.
 */

import type { KindRefusalCode } from '@openmig/shared';
import type { TemplateVars } from './fill.ts';
import type { StringKey } from './strings.ts';

export function refusedKindWords(
  t: (key: StringKey, vars?: TemplateVars) => string,
  choice: { readonly reason: string; readonly code?: KindRefusalCode | undefined },
): { readonly text: string; readonly english: boolean } {
  if (choice.code === 'after_cutover') return { text: t('settings.kinds.refused.afterCutover'), english: false };
  if (choice.code === 'measured_no') return { text: t('settings.kinds.refused.measured'), english: false };
  return { text: choice.reason, english: true };
}
