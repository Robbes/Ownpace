// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The owner's grant-link surface (workplan 0108 T3): issue, list, revoke.
 *
 * ADR-0035 in one screen: *"the owner decides who gets a link to manage and
 * grant their own migration"*, and **the owner distributes it — we never do.**
 * There is no address field on this panel, deliberately. Ownpace never learns
 * who the link went to, which means Ownpace cannot leak it, and the person
 * deciding who gets access already knows who they are.
 *
 * ## Three things this panel is careful about
 *
 * **The URL exists once.** It lives in component state until the owner
 * navigates away, and there is nowhere else it could come from — the server
 * holds a sha256. So it is shown large, with the copy button beside it and the
 * expiry stated in the same breath, rather than tucked into a toast that
 * disappears while somebody is reaching for the mouse.
 *
 * **An expired link is not greyed away.** Every other ending on these screens
 * fades; this one does not. A link only reads `expired` when it was never used
 * — somebody was asked to do their part and never got there — so it is the one
 * row on the panel that wants an action, and the action (issue another) is put
 * beside it rather than left to be inferred.
 *
 * **A refusal is the server's sentence, verbatim.** ADR-0024's prose boundary:
 * the four ways a grant link cannot work (`no_source_connection`,
 * `source_not_google`, `client_not_configured`, `web_url_unset`) each name what
 * to configure, and re-writing them here in two languages would be two more
 * places for that advice to go stale. The states — live/used/revoked/expired —
 * are the client's to word, and go through `StateChip` like every other enum.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, KeyRound } from 'lucide-react';
import { isSelfHost } from '../services/edition.ts';
import { serverMessage } from '../services/api.ts';
import {
  DEFAULT_GRANT_LINK_EXPIRY_DAYS,
  GRANT_LINK_EXPIRY_DAYS,
  grantLinkApi,
  type GrantLink,
  type IssuedGrantLink,
} from '../services/grant-link-service.ts';
import { useT, useFormatters } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/index.tsx';
import StateChip from './StateChip.tsx';

/** One key per offered lifetime, so a translator can say "1 day" properly. */
const EXPIRY_LABEL: Record<number, StringKey> = {
  1: 'grantLink.expiry.1',
  7: 'grantLink.expiry.7',
  30: 'grantLink.expiry.30',
};

const GrantLinksPanel: React.FC<{ mappingId: string }> = ({ mappingId }) => {
  const t = useT();
  const { dateTime } = useFormatters();
  const queryClient = useQueryClient();

  const [expiryDays, setExpiryDays] = React.useState<number>(DEFAULT_GRANT_LINK_EXPIRY_DAYS);
  const [issued, setIssued] = React.useState<IssuedGrantLink | null>(null);
  const [issueError, setIssueError] = React.useState('');
  const [issuing, setIssuing] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [armedRevoke, setArmedRevoke] = React.useState<string | null>(null);
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});

  const links = useQuery({
    queryKey: ['grant-links', mappingId],
    queryFn: () => grantLinkApi.list(mappingId),
    enabled: !isSelfHost(),
    retry: false,
  });

  // The appliance's ledger carries the table (the migration is shared), but its
  // API does not serve these routes — 0108 T3 built the managed half. Showing a
  // button that 404s would be worse than showing nothing, and claiming the
  // feature is managed-only would be worse still, because it is not: it is
  // unbuilt there.
  if (isSelfHost()) return null;

  const issue = async (e: React.FormEvent) => {
    e.preventDefault();
    setIssuing(true);
    setIssueError('');
    setCopied(false);
    try {
      const link = await grantLinkApi.issue(mappingId, expiryDays);
      setIssued(link);
      await queryClient.invalidateQueries({ queryKey: ['grant-links', mappingId] });
    } catch (err) {
      // Verbatim. Every refusal this route answers with names what to
      // configure; a generic "could not create link" would throw that away.
      setIssueError(serverMessage(err));
    } finally {
      setIssuing(false);
    }
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused by the browser (permission, an
      // insecure origin) and there is nothing to fix — the URL is already on
      // screen and selectable, which is why it is rendered in a real input
      // rather than only behind this button.
      setCopied(false);
    }
  };

  const revoke = async (link: GrantLink) => {
    // Armed, like every other destructive button in this app: the first click
    // relabels, the second acts. Revoking is not undoable — a revoked link
    // cannot be un-revoked, only replaced.
    if (armedRevoke !== link.id) {
      setArmedRevoke(link.id);
      return;
    }
    setArmedRevoke(null);
    setRowErrors((errors) => ({ ...errors, [link.id]: '' }));
    try {
      await grantLinkApi.revoke(mappingId, link.id);
      await queryClient.invalidateQueries({ queryKey: ['grant-links', mappingId] });
    } catch (err) {
      setRowErrors((errors) => ({ ...errors, [link.id]: serverMessage(err) }));
    }
  };

  return (
    <section className="mt-8">
      <h3 className="text-base font-semibold text-gray-900">{t('grantLink.title')}</h3>
      <p className="mt-0.5 text-sm text-gray-500">{t('grantLink.blurb')}</p>

      <form onSubmit={issue} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm text-gray-700">
          {t('grantLink.expiryLabel')}
          <select
            value={expiryDays}
            onChange={(e) => setExpiryDays(Number(e.target.value))}
            className="mt-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
          >
            {GRANT_LINK_EXPIRY_DAYS.map((days) => (
              <option key={days} value={days}>
                {t(EXPIRY_LABEL[days]!)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={issuing}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <KeyRound className="w-4 h-4" />
          {issuing ? t('grantLink.issuing') : t('grantLink.issue')}
        </button>
      </form>

      {issueError && <p className="mt-2 text-sm text-amber-800">{issueError}</p>}

      {issued && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm font-medium text-gray-900">{t('grantLink.issued.once')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={issued.url}
              aria-label={t('grantLink.issued.urlLabel')}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono text-gray-900 bg-white"
            />
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-white"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? t('grantLink.copied') : t('grantLink.copy')}
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-700">
            {t('grantLink.issued.until', { date: dateTime(issued.expiresAt) })}
          </p>
          <p className="mt-1 text-sm text-gray-700">{t('grantLink.issued.youSend')}</p>
        </div>
      )}

      {links.error != null && (
        <p className="mt-3 text-sm text-amber-800">{t('grantLink.loadError')}</p>
      )}

      {links.data && links.data.length === 0 && (
        <p className="mt-3 text-sm text-gray-600">{t('grantLink.empty')}</p>
      )}

      {links.data && links.data.length > 0 && (
        <ul className="mt-3 space-y-2">
          {links.data.map((link) => (
            <li
              key={link.id}
              className={`p-3 rounded-lg border ${
                link.state === 'expired'
                  ? 'border-yellow-300 bg-yellow-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StateChip entity="link" state={link.state} />
                  <span className="text-sm text-gray-600">
                    {t('grantLink.issuedBy', {
                      date: dateTime(link.createdAt),
                      who: link.createdBy,
                    })}
                  </span>
                </div>
                {link.state === 'live' && (
                  <button
                    type="button"
                    onClick={() => revoke(link)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                      armedRevoke === link.id
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'text-red-700 hover:bg-red-50'
                    }`}
                  >
                    {armedRevoke === link.id ? t('grantLink.revokeArmed') : t('grantLink.revoke')}
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-600">
                {link.state === 'used' && link.usedAt
                  ? t('grantLink.grantedOn', { date: dateTime(link.usedAt) })
                  : link.state === 'revoked' && link.revokedAt
                    ? t('grantLink.revokedOn', { date: dateTime(link.revokedAt) })
                    : link.state === 'expired'
                      ? t('grantLink.expiredOn', { date: dateTime(link.expiresAt) })
                      : t('grantLink.worksUntil', { date: dateTime(link.expiresAt) })}
              </p>
              {link.state === 'expired' && (
                <p className="mt-1 text-sm text-yellow-900">{t('grantLink.expiredNudge')}</p>
              )}
              {rowErrors[link.id] && (
                <p className="mt-1 text-sm text-amber-800">{rowErrors[link.id]}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default GrantLinksPanel;
