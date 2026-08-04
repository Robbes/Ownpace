// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The shared addresses discovery found (workplan 0027 T4).
 *
 * §14.1 promises migration owners both patterns under *Migrates* — a shared
 * mailbox whose store is copied, and a distribution list whose definition and
 * member list are recreated. 0027 T1 finds them; this is where the owner sees
 * what was found, on the screen that answers "what am I actually getting",
 * before anything is copied.
 *
 * THREE HONEST STATES, and getting them wrong is how this screen would lie:
 *
 *  - **An empty list is not "you have none."** An IMAP source cannot
 *    enumerate groups at all, and a Graph source without application
 *    permissions cannot either. The empty state says that (hard rule 9)
 *    rather than reporting a fact about the owner's organisation that nobody
 *    established.
 *  - **A missing pattern is not a pattern.** The source did not say which of
 *    §14.1's two this is, so the row says the question is waiting on the
 *    Decisions screen — it does not quietly pick one.
 *  - **An unread member list is not an empty group.** `membersKnown: false`
 *    means the members could not be read; showing "0 members" would have the
 *    owner approve recreating an empty group.
 */

import React from 'react';
import { Link } from 'react-router';
import { Users } from 'lucide-react';
import { useT } from '../../i18n';
import { fetchGroupRunbook, type SharedAddressRow } from '../../services/operating-service';

const PATTERN_KEY = {
  shared_s: 'sharedAddresses.pattern.shared_s',
  distribution_d: 'sharedAddresses.pattern.distribution_d',
} as const;

export const SharedAddresses: React.FC<{
  addresses: readonly SharedAddressRow[];
  /** True when the list could not be read at all — never rendered as empty. */
  unreadable?: boolean;
}> = ({ addresses, unreadable = false }) => {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const downloadRunbook = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const markdown = await fetchGroupRunbook();
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'distribution-lists.md';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // Said, not swallowed: a silent no-op would look like an empty runbook,
      // and the reader would conclude there is nothing to do (rule 9).
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (unreadable) {
    return <p className="text-sm text-amber-700">{t('sharedAddresses.readError')}</p>;
  }

  if (addresses.length === 0) {
    return (
      <div className="flex items-start gap-2 text-sm text-gray-500">
        <Users className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>{t('sharedAddresses.empty')}</p>
      </div>
    );
  }

  // Pattern D recreation is entirely manual (0027 T2): no target this stack
  // supports exposes an interface for creating a mail group. The offer only
  // appears when there is a list to recreate, so it never implies work that
  // does not exist.
  const hasLists = addresses.some((a) => a.pattern === 'distribution_d');

  return (
    <>
    {hasLists && (
      <p className="mb-3 text-sm text-gray-600">
        {t('sharedAddresses.runbook.intro')}{' '}
        <button
          onClick={downloadRunbook}
          disabled={busy}
          className="text-blue-700 hover:underline disabled:opacity-50"
        >
          {t('sharedAddresses.runbook.download')}
        </button>
        {failed && <span className="ml-2 text-amber-700">{t('sharedAddresses.runbook.failed')}</span>}
      </p>
    )}
    <ul className="divide-y divide-gray-100">
      {addresses.map((a) => (
        <li key={a.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm text-gray-900">
            {a.displayName ? `${a.displayName} (${a.address})` : a.address}
          </span>

          {a.pattern ? (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
              {t(PATTERN_KEY[a.pattern])}
            </span>
          ) : (
            /* Not a pattern, and not styled like one: the question is open,
               and the link goes to where it gets answered (0028 T3). */
            <Link
              to="/decisions"
              className="px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-800 hover:underline"
            >
              {t('sharedAddresses.pattern.unknown')}
            </Link>
          )}

          <span className="text-xs text-gray-500">
            {a.membersKnown ? (
              <>
                {a.members.length} {t('sharedAddresses.members')}
              </>
            ) : (
              /* "0 members" would have the owner approve recreating an empty
                 group. A different sentence, deliberately. */
              t('sharedAddresses.membersUnknown')
            )}
          </span>
        </li>
      ))}
    </ul>
    </>
  );
};

export default SharedAddresses;
