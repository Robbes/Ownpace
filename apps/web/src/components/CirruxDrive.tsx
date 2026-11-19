// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CONNECT CIRRUX DRIVE, ON A CIRRUX ACCOUNT'S ROW (workplan 0160 T5; ADR-0052).
 *
 * A Cirrux account's app password reaches its mail, calendars, contacts and
 * tasks. Its Drive is reached only through Cirrux's own API, with a person's
 * sign-in, so the file face is added to the account later, here, by one
 * button. What this panel holds:
 *
 * - **No button without the deployment's Cirrux client.** `/provider-accounts`
 *   says `client: 'deployment'` for `cirrux` only when the deployment has one;
 *   otherwise this draws nothing, and the account's own record says why files
 *   cannot go there (its file face is a measured no with that sentence).
 * - **The button opens the window in the press** (`openConsentWindow`, workplan
 *   0145 T5), and a window that did not open offers the link.
 * - **No token reaches this page.** The server stores the sign-in on the
 *   account, and the window it ends in posts only `ownpace-cirrux-drive` with
 *   the account's id, from this origin. On it, the page reads the accounts
 *   again, and the row shows the Drive connected, as the server measured it.
 * - **Connected or not is the record's**: the file face of what the account
 *   last measured, `yes` when the Drive answered through the stored sign-in.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { qualifiedAnswerFor } from '@openmig/shared';
import { mappingApi, providerAccountsApi, type ConnectionSummary } from '../services/mapping-service.ts';
import { closeConsentWindow, consentWindowName, openConsentWindow, sendConsentWindow } from '../services/consent-window.ts';
import { serverMessage } from '../services/api.ts';
import { useLocale } from '../i18n/index.tsx';
import { ConsentWindowLink, type UnopenedConsent } from './ProviderConsent.tsx';
import { Hint } from './Hint.tsx';

/** Is this row a Cirrux account, the one kind whose files come with a sign-in? */
export function isCirruxAccount(connection: Pick<ConnectionSummary, 'kind' | 'role'>): boolean {
  return connection.kind === 'cirrux' && connection.role === 'target';
}

/** Does the account's own record say its Drive answered through the stored sign-in? */
export function cirruxDriveConnected(qualification: ConnectionSummary['qualification']): boolean {
  return qualifiedAnswerFor(qualification, 'file')?.answer === 'yes';
}

export const CirruxDrivePanel: React.FC<{
  readonly connection: ConnectionSummary;
  /** Read the accounts again: the server measured the Drive when it stored the sign-in. */
  readonly onChanged: () => void;
}> = ({ connection, onChanged }) => {
  const { t, locale } = useLocale();
  const { data: facts } = useQuery({
    queryKey: ['provider-accounts'],
    queryFn: providerAccountsApi.get,
    enabled: isCirruxAccount(connection),
  });
  const [note, setNote] = React.useState<{ readonly tone: 'done' | 'refused'; readonly text: string } | null>(null);
  const [unopened, setUnopened] = React.useState<UnopenedConsent | null>(null);
  const [asking, setAsking] = React.useState(false);

  // The window's one message: this account's Drive is connected. From this
  // origin only, and for this row only: a second Cirrux account's window
  // lands on its own row.
  const idRef = React.useRef(connection.id);
  idRef.current = connection.id;
  const onChangedRef = React.useRef(onChanged);
  onChangedRef.current = onChanged;
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; connected?: unknown; connectionId?: unknown } | null;
      if (!data || data.type !== 'ownpace-cirrux-drive' || data.connected !== true) return;
      if (data.connectionId !== idRef.current) return;
      setUnopened(null);
      setNote({ tone: 'done', text: t('account.cirrux.landed') });
      onChangedRef.current();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [t]);

  if (!isCirruxAccount(connection) || facts?.cirrux?.client !== 'deployment') return null;
  const connected = cirruxDriveConnected(connection.qualification);

  const connect = async () => {
    setNote(null);
    setUnopened(null);
    setAsking(true);
    // In the press, before anything is awaited (0145 T5).
    const consentWindow = openConsentWindow(consentWindowName('cirrux'));
    const pressedAt = Date.now();
    try {
      const { url } = await mappingApi.cirruxDriveAuthorize({ connectionId: connection.id, locale });
      if (!sendConsentWindow(consentWindow, url)) setUnopened({ url, pressedAt });
    } catch (err) {
      closeConsentWindow(consentWindow);
      setNote({ tone: 'refused', text: serverMessage(err) });
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="mt-2" data-testid="cirrux-drive">
      {connected && <p className="text-sm text-green-800">{t('account.cirrux.connected')}</p>}
      <button
        type="button"
        onClick={() => void connect()}
        disabled={asking}
        className="mt-1 text-sm px-3 py-1.5 border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-50"
      >
        {connected ? t('account.cirrux.again') : t('account.cirrux.connect')}
      </button>
      <Hint className="mt-1" text={t('account.cirrux.connect.hint')} why={t('account.cirrux.connect.why')} />
      <ConsentWindowLink provider="cirrux" unopened={unopened} />
      {note && (
        <p
          role={note.tone === 'refused' ? 'alert' : 'status'}
          className={`mt-1 text-sm ${note.tone === 'refused' ? 'text-amber-900' : 'text-green-800'}`}
        >
          {note.text}
        </p>
      )}
    </div>
  );
};
