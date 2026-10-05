// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * "Welkom bij de Alpha! Probeer Ownpace rustig aan uit, en help anderen
 * makkelijker over te stappen naar Europese alternatieven." (workplan 0131 T1;
 * the owner's words, 2026-10-04). In English, their translation: "Welcome to
 * the Alpha! Try Ownpace at your own pace, and help others move to European
 * alternatives more easily."
 *
 * Shown at the top of every signed-in page: `Layout.tsx`, beside the platform
 * hold's banner, and under the title of `/invitations`, which sits outside
 * `Layout` and is where an invited member first meets the service. And under
 * the title of `/login` and `/request-access`, which a tester sees before
 * there is any session, before and after the request is sent. Nothing at all
 * unless the deployment runs the alpha, and never on the appliance
 * (`services/stage.ts` holds the rule and says why).
 *
 * WHO READS THE WELCOME, AND WHO A FACT (workplan 0152 T1 (a), open question
 * 5; the owner, 2026-10-05: *"Do suggestions for non alpha viewers"*). The
 * welcome is written for the people invited, so it stays where they stand:
 * the pages above, the acceptance screen and the mails. `/login` and
 * `/request-access` keep it by the owner's earlier choice (0131 D4's
 * amendment). A visitor who was not invited reads `AlphaVisitorLine`, below,
 * instead: the guides for a visitor without a session (`PublicDocs`), and
 * every page of the public site while it is built for the Alpha, in the same
 * words (`site/copy.mjs`).
 *
 * The shape is the platform hold's, deliberately: an amber note, `role="note"`.
 * Two kinds of platform news in two shapes would look like two different kinds
 * of thing. A note and not an alert: it is a standing welcome, not a failure,
 * and `role="alert"` would be read out on every page a screen reader opens.
 *
 * The Dutch is the owner's welcome, word for word (0131 D4's amendment,
 * 2026-10-04); the English is its translation, not the owner's words. The note
 * is that and its links, and nothing else (*"Welcome only"*). Until then it
 * said what the Alpha means: nothing charged, it can end, no backups apart
 * from one copy, keep the old account. Both mails now open with the same
 * welcome and then give those facts, word for word (`grantedAlpha` in
 * @openmig/shared's notifications.ts), and the Alpha conditions and the tester
 * guide say them too. Two dictionary keys, because the first sentence is the
 * bold lead.
 *
 * After the words, the note links what a tester reads next (0131 T1 (b)): the
 * Alpha conditions (0139 T2) and the tester guide (0144 T1), in the reader's
 * language, each named by its own title and opening in a new tab, drawn by
 * `LegalLinks` as every other link to the texts is. Always shown, also before
 * the site has them (the owner, 2026-10-03: *"Always shown"*). On the
 * acceptance screen the list below the note links the conditions as well:
 * one note, the same everywhere, is worth the second link there.
 *
 * Written *Alpha*, a proper name, in both languages (the owner, 2026-10-04,
 * on #1439: *"akkoord, Alpha"*), as the conditions write it.
 */

import React from 'react';
import { Link } from 'react-router';
import { useT } from '../i18n/index.tsx';
import { isSelfHost } from '../services/edition.ts';
import { alphaFrom } from '../services/stage.ts';
import LegalLinks from './LegalLinks.tsx';

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
        <span className="font-medium">{t('alpha.note.lead')}</span> {t('alpha.note.welcome')}
      </p>
      {/* 0131 T1 (b): the conditions, then the guide, as the grant mail and
          the invitation end their alpha paragraph. */}
      <p className="mt-1">
        <LegalLinks pages={['alpha']} guide />
      </p>
    </div>
  );
};

/**
 * The Alpha, said to a visitor who was not invited (workplan 0152 T1 (a)):
 * *"Ownpace is in its Alpha, by invitation. Nothing is charged during the
 * Alpha."*, then *Request access*, the request page by its own title. The
 * site says the same under its header, from a guarded copy
 * (`scripts/the-alpha-said-to-a-visitor.unit.test.ts`).
 *
 * A fact in the site's muted style, not the welcome's amber box: the box is
 * the members' note, and a second one in its shape would read as the same
 * kind of thing. A plain line, so a screen reader reads it where it stands.
 * The same rule as the note: only while the deployment runs the alpha, and
 * never on the appliance, which lets nobody in.
 */
export const AlphaVisitorLine: React.FC<{
  /** Spacing from what surrounds it. */
  className?: string;
}> = ({ className }) => {
  const t = useT();
  if (!isAlpha()) return null;

  const shape = 'text-sm text-gray-600';
  return (
    <p className={className ? `${className} ${shape}` : shape}>
      {t('alpha.visitor.line')} {t('alpha.nothingCharged')}{' '}
      <Link to="/request-access" className="text-site-teal hover:underline">
        {t('access.title')}
      </Link>
    </p>
  );
};

export default AlphaNote;
