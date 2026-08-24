// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Answering an invitation (workplan 0099).
 *
 * **This screen exists because the answer used to be assumed.** Until 0099 an
 * invitation bound itself to your subject the first time you signed in — no
 * screen, no prompt, no way to refuse. That was tolerable while the only
 * invitations were ones an operator had just granted and emailed you about, and
 * it stopped being tolerable the moment anybody could be invited to a second
 * organisation: reading your own account joined you to things.
 *
 * Three answers, and the third one is the reason the other two are honest:
 *
 *  - **Join** binds your subject and makes the membership active.
 *  - **Decline** records the refusal WITHOUT binding you to it. The database
 *    enforces that (migration 0008), not this screen.
 *  - **Not now** does nothing at all — no call, no state. The invitation is
 *    offered again next time you sign in. A person who is not ready to decide
 *    must not be cornered into deciding, and "ask me later" is the answer most
 *    people actually want when a stranger's organisation appears in front of
 *    them.
 *
 * Nothing here authorises anything. Policies on `tenant_member` do: the row has
 * to be an open invitation addressed to the address the issuer VERIFIED, and
 * what it may become is pinned from the other side too. A caller answering an
 * invitation that is not theirs gets the same 404 as one that does not exist.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Mail, Check, X } from 'lucide-react';
import { answerInvitation, fetchMe, type Invitation } from '../services/session.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { useT, useFormatters } from '../i18n/index.tsx';
import BuildStamp from '../components/BuildStamp.tsx';

const Invitations: React.FC = () => {
  const t = useT();
  const { dateTime } = useFormatters();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const loginToStore = useAuthStore((s) => s.login);
  const [waiting, setWaiting] = useState<ReadonlyArray<Invitation> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Asked fresh rather than carried from sign-in. An invitation can be answered
  // in another tab, or withdrawn, and a stale list here would offer somebody a
  // button that 404s — which reads as a broken product rather than as a race.
  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const me = await fetchMe(token);
        setWaiting(me.invitations ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setWaiting([]);
      }
    })();
  }, [token]);

  const answer = async (tenantId: string, choice: 'accept' | 'decline') => {
    if (!token) return;
    setBusy(tenantId);
    setError(null);
    try {
      await answerInvitation(token, tenantId, choice);
      // Re-read rather than patch the list locally: accepting changes what this
      // subject may do, and the server is the only thing that knows what it
      // became. A client that guessed would be right until it was not.
      const me = await fetchMe(token);
      loginToStore(
        token,
        {
          id: me.userId,
          email: me.email ?? me.userId,
          name: me.email ?? me.userId,
          // Whatever the server now says this subject is. Accepting an
          // invitation is precisely the moment that changes, so it is read from
          // the fresh `/api/me` rather than kept from before the answer.
          role: me.role ?? '',
        },
        me.tenantId ?? '',
        me.operator === true,
      );
      const left = me.invitations ?? [];
      setWaiting(left);
      if (choice === 'accept' || left.length === 0) {
        void navigate(me.tenants.length > 0 ? '/dashboard' : '/login', { replace: true });
      }
    } catch (err) {
      // The server's own sentence where there is one — a 404 says the
      // invitation is not there for you, which is worth reading verbatim.
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      setError(detail ?? (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-lg w-full space-y-6">
        <div className="flex items-center gap-3">
          <Mail className="w-6 h-6 text-gray-500" />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{t('invite.title')}</h1>
            <p className="text-sm text-gray-600">{t('invite.subtitle')}</p>
          </div>
        </div>

        {error !== null && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        {waiting === null ? null : waiting.length === 0 ? (
          <p className="text-sm text-gray-600">{t('invite.none')}</p>
        ) : (
          <ul className="space-y-3">
            {waiting.map((invitation) => (
              <li
                key={invitation.tenantId}
                className="bg-white border border-gray-200 rounded-lg p-4 space-y-3"
              >
                <div>
                  <p className="font-medium text-gray-900">{invitation.name}</p>
                  <p className="text-sm text-gray-600">
                    {t('invite.asRole', { role: invitation.role })}
                    {invitation.invitedAt ? ` · ${dateTime(invitation.invitedAt)}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void answer(invitation.tenantId, 'accept')}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    {busy === invitation.tenantId ? t('invite.joining') : t('invite.accept')}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      // Declining cannot be undone from this screen — only the
                      // organisation can invite again — so it asks.
                      if (globalThis.confirm(t('invite.confirmDecline', { name: invitation.name })))
                        void answer(invitation.tenantId, 'decline');
                    }}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    {t('invite.decline')}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    // NO REQUEST. Skipping is the absence of an answer, so the
                    // invitation stays open and is offered again next sign-in.
                    onClick={() => void navigate('/login', { replace: true })}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
                  >
                    {t('invite.skip')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-gray-500">{t('invite.skipHelp')}</p>

        {/* Outside `Layout`, so the sidebar's stamp never reaches this page —
            and this is a page somebody sees BEFORE they are inside the app,
            which makes it where "what build is this?" gets asked most. See
            components/BuildStamp.tsx. */}
        <div className="text-center">
          <BuildStamp />
        </div>
      </div>
    </div>
  );
};

export default Invitations;
