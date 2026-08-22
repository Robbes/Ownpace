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
 *  - **No email goes out.** The product does not send invitations (the same
 *    thing `Tenants.tsx` says about inviting a member), so the button does not
 *    get to imply one. Somebody still has to tell them.
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
  type RequestState,
} from '../services/access-requests.ts';
import { useT, useFormatters } from '../i18n/index.tsx';

const TABS: ReadonlyArray<RequestState> = ['open', 'granted', 'declined'];

/** One request, with the decision controls when it is still open. */
const RequestCard: React.FC<{
  request: AccessRequest;
  onDecided: () => void;
}> = ({ request, onDecided }) => {
  const t = useT();
  const { dateTime } = useFormatters();
  // Prefilled with what they told us, which is usually right and occasionally a
  // typo somebody wants to fix before it becomes a customer's name.
  const [name, setName] = useState(request.organisation ?? request.name ?? request.email);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async (decision: 'grant' | 'decline') => {
      if (decision === 'grant') {
        await grantAccessRequest(request.id, {
          ...(name.trim() ? { organisationName: name.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        return;
      }
      await declineAccessRequest(request.id, note.trim() || undefined);
    },
    onSuccess: () => {
      setError(null);
      onDecided();
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
                if (globalThis.confirm(t('queue.confirmDecline'))) decide.mutate('decline');
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

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['access-requests', tab],
    queryFn: () => listAccessRequests(tab),
  });

  const refresh = () => {
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
