// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A person to write to (workplan 0144 T6 (a)).
 *
 * *"Stuck? Mail {address} and name the page you are on. Never send a
 * password."*, in the reader's language, with the address as a `mailto:`
 * link. On the pages a tester sees before there is a session: `/login`,
 * `/request-access`, `/auth/callback` (the no-organisation state and the
 * failed one) and `/invitations`. The report form (0130) cannot help there:
 * its route is inside the signed-in layout and its API requires sign-in. The
 * layout uses the same address as *"Help: {address}"* in the sidebar, where
 * *Report a problem* would be, while the form is off (`Layout.tsx`).
 *
 * The address is the deployment's, never the code's: the build argument
 * `VITE_SUPPORT_EMAIL`, which `managed.yml` passes from `.env`. The owner chose
 * it (0144 T0, answered in 0133), and it goes in the tester stack's `.env`.
 * Unset or empty, nothing is shown, as the report link is hidden when it could
 * reach nobody. And never on an appliance, whatever its bundle was built with:
 * its owner is the person, and the address is the hosted service's.
 *
 * Guarded by `pages/a-person-before-sign-in.unit.test.tsx`, and the build
 * argument by `scripts/a-helpdesk-the-api-was-never-handed.unit.test.ts`.
 */

import React from 'react';
import { useT } from '../i18n/index.tsx';
import { isSelfHost } from '../services/edition.ts';

/** The rule, as a pure function of the setting and the edition. */
export function supportAddressFrom(setting: unknown, selfhost: boolean): string | null {
  if (selfhost || typeof setting !== 'string') return null;
  const address = setting.trim();
  return address === '' ? null : address;
}

/**
 * The address this bundle was built with, or null.
 *
 * READ HERE, DIRECTLY, for the reason `isAlpha` in `AlphaNote.tsx` gives: Vite
 * replaces `import.meta.env.VITE_SUPPORT_EMAIL` at build time, and written out
 * like this vitest's `vi.stubEnv` reaches it too, so the guard turns the real
 * setting on.
 */
export function supportAddress(): string | null {
  return supportAddressFrom(import.meta.env.VITE_SUPPORT_EMAIL, isSelfHost());
}

/** The address as a link, with the words around it. */
function withAddress(sentence: string, address: string, linkClass: string): React.ReactNode {
  const [before = '', after = ''] = sentence.split('{address}');
  return (
    <>
      {before}
      <a href={`mailto:${address}`} className={linkClass}>
        {address}
      </a>
      {after}
    </>
  );
}

const SHAPE = 'text-center text-sm text-gray-600';

/** The line on the pages before sign-in. Nothing without an address. */
export const SupportLine: React.FC = () => {
  const t = useT();
  const address = supportAddress();
  if (address === null) return null;

  return (
    <p className={SHAPE}>
      {withAddress(t('help.line'), address, 'text-blue-600 underline hover:text-blue-500')}
    </p>
  );
};

export default SupportLine;
