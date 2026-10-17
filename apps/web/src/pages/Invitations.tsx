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
 * **Never back to `/login` while signed in** (the UX sweep, 2026-10-17). *Not
 * now* used to go there, with the session still in the store: the sign-in page
 * offered a sign-in, the provider was still signed in, and `AuthCallback` sent
 * anybody with an open invitation back here. A loop, and a member of another
 * organisation had no way to their migrations. Now somebody who belongs
 * somewhere, or an operator, goes to the landing page (`/`), which knows where
 * each of them goes; somebody who belongs nowhere is signed out, of the
 * sign-in service too (`useSignOut`), which is what "later" means for them. A
 * decline that leaves nothing does the same. The page says which address
 * signed in, as `AuthCallback`'s no-organisation state does, and offers *Sign
 * out*, since the sidebar's is not here.
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
import { rememberSignIn } from '../services/acceptance.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { useLocale, useFormatters, type StringKey } from '../i18n/index.tsx';
import { Hint } from '../components/Hint.tsx';
import { useSignOut } from '../components/SignOut.tsx';
import BuildStamp from '../components/BuildStamp.tsx';
import AlphaNote from '../components/AlphaNote.tsx';
import SupportLine from '../components/SupportLine.tsx';

/**
 * A role as the app names it (`Tenants.tsx` does the same), in place of the
 * API's token: *als beheerder*, not *als admin*. A role this build has no
 * word for is shown as it came.
 */
const ROLE_KEY: Record<string, StringKey> = {
  owner: 'role.owner',
  admin: 'role.admin',
  member: 'role.member',
  viewer: 'role.viewer',
};

const Invitations: React.FC = () => {
  const { t, locale } = useLocale();
  const { dateTime } = useFormatters();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const token = useAuthStore((s) => s.token);
  const tenantCount = useAuthStore((s) => s.tenantCount);
  const operator = useAuthStore((s) => s.operator);
  const email = useAuthStore((s) => s.user?.email);
  const loginToStore = useAuthStore((s) => s.login);
  const roleWord = (role: string): string => {
    // Own keys only: the role is the API's string, and `constructor` is not one.
    const key = Object.prototype.hasOwnProperty.call(ROLE_KEY, role) ? ROLE_KEY[role] : undefined;
    return key ? t(key).toLocaleLowerCase(locale) : role;
  };
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
      // The name from the address, as the two sign-in doors derive it
      // (`Login.tsx`, `AuthCallback.tsx`): the sidebar showed the whole
      // address twice until the next sign-in.
      const address = me.email ?? me.userId;
      loginToStore(
        token,
        {
          id: me.userId,
          email: address,
          name: address.split('@')[0],
          // Whatever the server now says this subject is. Accepting an
          // invitation is precisely the moment that changes, so it is read from
          // the fresh `/api/me` rather than kept from before the answer.
          role: me.role ?? '',
        },
        me.tenantId ?? '',
        me.operator === true,
        me.tenants.length,
      );
      // Joining is when an invited member is first asked to accept the texts
      // (0139 T3): the page this lands on shows the screen from this answer.
      rememberSignIn(me);
      const left = me.invitations ?? [];
      setWaiting(left);
      if (choice === 'accept' || left.length === 0) {
        // Where `AuthCallback` lands the same answer; never `/login`, which
        // would offer a sign-in to somebody who is signed in.
        if (me.tenants.length > 0) void navigate('/mappings', { replace: true });
        else if (me.operator === true) void navigate('/access-requests', { replace: true });
        else signOut();
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
      <main className="max-w-lg w-full space-y-6">
        <div className="flex items-center gap-3">
          <Mail className="w-6 h-6 text-gray-500" />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{t('invite.title')}</h1>
            <p className="text-sm text-gray-600">{t('invite.subtitle')}</p>
            {email && <p className="text-sm text-gray-600">{t('login.noOrganisation.signedInAs', { email })}</p>}
          </div>
        </div>

        {/* The alpha note (workplan 0131 T1), under the title. Outside `Layout`,
            so the note there never reaches this page, and an invited member
            never passes `/request-access` or receives the grant mail. The note
            here is the same welcome they met at `/login`, and in their
            invitation mail when it was mailed. What the Alpha means is in that
            mail (0156 T3). */}
        <AlphaNote />

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
                    {t('invite.asRole', { role: roleWord(invitation.role) })}
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
                    // To the landing page for somebody it has somewhere to
                    // send; signed out for somebody who belongs nowhere yet.
                    onClick={() => (tenantCount > 0 || operator ? void navigate('/', { replace: true }) : signOut())}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
                  >
                    {t('invite.skip')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Hint className="" text={t('invite.skipHelp')} why={t('invite.skipHelp.why')} />

        {/* Outside `Layout`, so the sidebar's stamp never reaches this page —
            and this is a page somebody sees BEFORE they are inside the app,
            which makes it where "what build is this?" gets asked most. See
            components/BuildStamp.tsx. */}
        {/* A person to write to (workplan 0144 T6 (a)), when the deployment
            names one. Outside `Layout`, the sidebar's *Help* is not here. */}
        <div className="text-center space-y-2">
          <button
            type="button"
            onClick={signOut}
            className="text-sm text-gray-600 underline hover:text-gray-900"
          >
            {t('nav.signOut')}
          </button>
          <SupportLine />
          <BuildStamp />
        </div>
      </main>
    </div>
  );
};

export default Invitations;
