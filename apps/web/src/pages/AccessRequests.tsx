// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The access queue — where somebody answers the door (workplan 0093 T7).
 *
 * **Nothing here authorises anything.** Every call is decided by policies on
 * `access_request`: a non-operator asking for the list gets `[]` and asking to
 * grant gets a 404, because to the database the rows are invisible and "not
 * found" is the honest answer about a row you cannot see. `Me.operator` decides
 * whether the nav offers this screen; a typed URL reaches it and shows an empty
 * queue, which is exactly right.
 *
 * Two things the screen says out loud rather than implying:
 *
 *  - **Granting creates the organisation**, and the person becomes its owner
 *    the first time they sign in — not at the moment you click. Until then
 *    there is an invitation with nobody attached, which is what makes it safe
 *    to grant before they have ever visited.
 *  - **What became of the email**, every time (workplan 0095). This screen used
 *    to say no email goes out at all, and that stopped being true when granting
 *    started sending one. The API answers with `notified` on both decisions and
 *    the line above the list reports it, because `off` and `failed` mean the
 *    manual step is back and the operator is the only person who can take it. A
 *    screen that dropped that answer would leave somebody believing they had
 *    been told when nobody had told them.
 *
 * Declining can be QUIET, and granting cannot. The public form is rate-limited
 * but still public, so junk reaches this queue and mailing a refusal to a
 * forged address means mailing a stranger; the operator can tell which is which
 * and the server cannot. A grant has nothing to opt out of — an unannounced
 * grant is one the person can never use.
 *
 * Declined requests are not deleted and cannot be: nobody, operator included,
 * has DELETE on that table. The queue is a record of what was asked and what
 * was decided, and a screen that offered to erase one would be lying about it.
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, Check, X } from 'lucide-react';
import {
  declineAccessRequest,
  grantAccessRequest,
  listAccessRequests,
  type AccessRequest,
  type NotifiedOutcome,
  type RequestState,
} from '../services/access-requests.ts';
import { useT, useFormatters } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';

const TABS: ReadonlyArray<RequestState> = ['open', 'granted', 'declined'];

/** What just happened, for the line above the list. */
interface Decision {
  readonly kind: 'granted' | 'declined';
  readonly email: string;
  readonly notified: NotifiedOutcome;
}

/**
 * One sentence per outcome, rather than a tick and a cross.
 *
 * `off` and `failed` are BOTH "nobody was told" and are deliberately not
 * merged: one is a deployment that sends no mail, the other is a mail server
 * that refused, and the operator does something different about each.
 */
const MAIL_LINE = {
  sent: 'queue.mailSent',
  off: 'queue.mailOff',
  failed: 'queue.mailFailed',
  skipped: 'queue.mailSkipped',
} as const satisfies Record<NotifiedOutcome, StringKey>;

/** One request, with the decision controls when it is still open. */
const RequestCard: React.FC<{
  request: AccessRequest;
  onDecided: (decision: Decision) => void;
}> = ({ request, onDecided }) => {
  const t = useT();
  const { dateTime } = useFormatters();
  // Prefilled with what they told us, which is usually right and occasionally a
  // typo somebody wants to fix before it becomes a customer's name.
  const [name, setName] = useState(request.organisation ?? request.name ?? request.email);
  const [note, setNote] = useState('');
  // Ticked. Silence has to be chosen, not defaulted into — see the file header.
  const [tellThem, setTellThem] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async (decision: 'grant' | 'decline'): Promise<Decision> => {
      if (decision === 'grant') {
        const result = await grantAccessRequest(request.id, {
          ...(name.trim() ? { organisationName: name.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        // The server's own `email`, not the card's: it is the address the mail
        // was actually addressed to, and reporting anything else would be a
        // guess dressed as a receipt.
        return { kind: 'granted', email: result.email, notified: result.notified };
      }
      const result = await declineAccessRequest(request.id, {
        ...(note.trim() ? { note: note.trim() } : {}),
        notify: tellThem,
      });
      // Declining answers with no address — there is no organisation to name —
      // so this one is the card's, which is the row the operator just acted on.
      return { kind: 'declined', email: request.email, notified: result.notified };
    },
    onSuccess: (decision) => {
      setError(null);
      onDecided(decision);
    },
    onError: (err: unknown) => {
      // The server's own sentence where there is one — a 409 says the request
      // was already decided, which is the thing worth reading.
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      setError(detail ?? (err instanceof Error ? err.message : String(err)));
    },
  });

  const open = request.state === 'open';

  return (
    <li className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-medium text-gray-900">{request.email}</p>
          <p className="text-sm text-gray-600">
            {[request.name, request.organisation].filter(Boolean).join(' · ')}
          </p>
        </div>
        <p className="text-xs text-gray-500">
          {t('queue.asked')} {dateTime(request.createdAt)} · {request.locale}
          {request.tier ? ` · ${request.tier}` : ''}
        </p>
      </div>

      {request.note && (
        // Their own words, rendered as text. Read by a human, which is the
        // whole premise of an invite-only front door.
        <p className="text-sm text-gray-800 whitespace-pre-wrap border-l-2 border-gray-200 pl-3">
          {request.note}
        </p>
      )}

      {!open && (
        <p className="text-xs text-gray-500">
          {t('queue.decidedBy')} {request.decidedBy}
          {request.decidedAt ? ` · ${dateTime(request.decidedAt)}` : ''}
          {request.decisionNote ? ` · ${request.decisionNote}` : ''}
        </p>
      )}

      {open && (
        <div className="space-y-3 pt-1">
          <div>
            <label
              htmlFor={`org-${request.id}`}
              className="block text-sm font-medium text-gray-700"
            >
              {t('queue.orgLabel')}
            </label>
            <input
              id={`org-${request.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md sm:text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">{t('queue.orgHelp')}</p>
          </div>

          <div>
            <label
              htmlFor={`note-${request.id}`}
              className="block text-sm font-medium text-gray-700"
            >
              {t('queue.noteLabel')}
            </label>
            <input
              id={`note-${request.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md sm:text-sm"
            />
          </div>

          <div>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={tellThem}
                onChange={(e) => setTellThem(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span>{t('queue.tellThem')}</span>
            </label>
            <p className="mt-1 ml-6 text-xs text-gray-500">{t('queue.tellThemHelp')}</p>
          </div>

          {error !== null && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => decide.mutate('grant')}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {decide.isPending ? t('queue.granting') : t('queue.grant')}
            </button>
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => {
                // A decline cannot be undone through this screen — the row
                // stays, but its state does not go back to open — so it asks.
                // And it asks the RIGHT question: an email that is about to go
                // to somebody is the half of this that reaches outside, so the
                // confirmation says which of the two is about to happen rather
                // than making the operator remember what they ticked.
                const ask = tellThem ? 'queue.confirmDecline' : 'queue.confirmDeclineQuiet';
                if (globalThis.confirm(t(ask))) decide.mutate('decline');
              }}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              <X className="w-4 h-4" />
              {t('queue.decline')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
};

const AccessRequests: React.FC = () => {
  const t = useT();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<RequestState>('open');
  const [last, setLast] = useState<Decision | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['access-requests', tab],
    queryFn: () => listAccessRequests(tab),
  });

  const refresh = (decision: Decision) => {
    // The card that knew the outcome is about to unmount — deciding a request
    // moves it out of the tab being looked at — so the answer is lifted here
    // first. Without this the whole `notified` chain ends in a component that
    // disappears before anybody reads it.
    setLast(decision);
    // Every tab, not just this one: a grant moves a row from waiting to
    // granted, so leaving the others cached would show it in both.
    void queryClient.invalidateQueries({ queryKey: ['access-requests'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <DoorOpen className="w-6 h-6 text-gray-500" />
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('queue.title')}</h1>
          <p className="text-sm text-gray-600">{t('queue.subtitle')}</p>
        </div>
      </div>

      <div className="flex gap-2" role="tablist">
        {TABS.map((state) => (
          <button
            key={state}
            type="button"
            role="tab"
            aria-selected={tab === state}
            onClick={() => setTab(state)}
            className={`px-3 py-1.5 text-sm rounded-md ${
              tab === state ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {t(`queue.tab.${state}` as 'queue.tab.open')}
          </button>
        ))}
      </div>

      {last && (
        // `status`, not `alert`: this is the result of something the operator
        // just did, not an interruption — but it is still announced, because
        // "nobody was emailed" is the part they must not miss.
        <p
          role="status"
          className={`text-sm ${
            last.notified === 'sent' || last.notified === 'skipped'
              ? 'text-gray-700'
              : 'text-amber-700'
          }`}
        >
          {t(last.kind === 'granted' ? 'queue.granted' : 'queue.declined')}{' '}
          {t(MAIL_LINE[last.notified], { email: last.email })}
        </p>
      )}

      {isLoading ? null : requests.length === 0 ? (
        <p className="text-sm text-gray-600">
          {tab === 'open' ? t('queue.empty') : t('queue.emptyDecided')}
        </p>
      ) : (
        <ul className="space-y-3">
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} onDecided={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
};

export default AccessRequests;
