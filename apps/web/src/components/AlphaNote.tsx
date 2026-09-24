// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * "Alpha: a small invited group is trying this service out." (workplan 0131 T1)
 *
 * Shown at the top of every signed-in page (`Layout.tsx`, beside the platform
 * hold's banner) and under the title of `/login` and `/request-access`, which
 * a tester sees before there is any session. Nothing at all unless the
 * deployment runs the alpha, and never on the appliance (`services/stage.ts`
 * holds the rule and says why).
 *
 * The shape is the platform hold's, deliberately: an amber note, `role="note"`.
 * Two kinds of platform news in two shapes would look like two different kinds
 * of thing. A note and not an alert: it is a standing fact about the service,
 * and `role="alert"` would be read out on every page a screen reader opens.
 *
 * The words are the access-granted mail's, sentence for sentence
 * (`grantedAlpha` in @openmig/shared's notifications.ts), and must match 0139's
 * alpha conditions once those exist. They are three dictionary keys only so
 * that each fits the copy budget; they read as one paragraph.
 */

import React from 'react';
import { useT } from '../i18n/index.tsx';
import { isSelfHost } from '../services/edition.ts';
import { alphaFrom } from '../services/stage.ts';

/**
 * Whether this bundle was built for the alpha, and is not an appliance.
 *
 * READ HERE, DIRECTLY, AND NOT IN `services/stage.ts`. Vite replaces
 * `import.meta.env.VITE_OWNPACE_STAGE` at build time, and written out like this
 * vitest's `vi.stubEnv` reaches it too, so the note's test turns the real
 * setting on instead of mocking the question away. The cast `edition.ts` and
 * `oidc.ts` read through is one no test can stub. A `.ts` file cannot say it
 * this way: the root typecheck compiles every `.ts` under `apps/` without
 * Vite's client types, and only this app's own program, which also takes
 * `.tsx`, knows `import.meta.env`.
 */
export function isAlpha(): boolean {
  return alphaFrom(import.meta.env.VITE_OWNPACE_STAGE, isSelfHost());
}

const SHAPE = 'rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900';

export const AlphaNote: React.FC<{
  /** Spacing from what surrounds it, which differs per page; the shape does not. */
  className?: string;
}> = ({ className }) => {
  const t = useT();
  if (!isAlpha()) return null;

  return (
    <div role="note" className={className ? `${className} ${SHAPE}` : SHAPE}>
      <p>
        <span className="font-medium">{t('alpha.note.lead')}</span> {t('alpha.note.terms')}{' '}
        {t('alpha.note.keep')}
      </p>
      {/* 0131 T1 (b): the links to the alpha conditions (0139 T2) and the
          tester guide (0144 T1) go here, in the reader's language, once 0139
          T10's module builds their addresses. The grant mail's paragraph
          carries the same links. */}
    </div>
  );
};

export default AlphaNote;
