// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The permission handover, on the Finish checklist (workplan 0029 T4, §14.2).
 *
 * Deliberately a PANEL rather than a numbered step, and the distinction is
 * not cosmetic. The numbered steps are things this tool can check or make you
 * attest to — the copy is complete, the queues are clear, the final pass ran,
 * delivery has moved. This is a document you take away and work through on
 * systems this tool never touches. Numbering it would put it in a list of
 * things somebody could reasonably expect to be ticked off automatically, and
 * §14.2's whole position is that permissions are *covered, not necessarily
 * automated*.
 *
 * It sits ABOVE the steps because of when it has to happen: rights carried
 * across after delivery moves are rights that were missing for however long
 * that took, and the assistant who cannot open the shared mailbox on Monday
 * morning is the failure this exists to prevent.
 */

import React from 'react';
import { KeyRound } from 'lucide-react';
import { scopeFamilyOf, scopeFamilyOfConnectionKind, type ScopeFamily } from '@openmig/shared';
import { useT, type StringKey } from '../../i18n/index.tsx';
import { fetchPermissionReport } from '../../services/operating-service.ts';
import { Hint } from '../Hint.tsx';

/**
 * THE BLIND SPOTS OF THIS MIGRATION'S SOURCE, not of Microsoft's whatever the
 * source (the owner, 2026-10-03). The line named Exchange's FullAccess and
 * Send-As and OneDrive and SharePoint on every Finish page, a Google
 * migration's included. A source family with no line of its own gets none:
 * the document names, at the top, what it could not read.
 *
 * Either vocabulary is asked: the managed edition answers with the connection
 * kind (`o365`, `google_drive`), the appliance with the mapping file's source
 * type (`graph-mail`, `google-drive`). The two agree on every string they
 * share, and the only answers read here are Microsoft and Google.
 */
const BLIND_SPOT: Partial<Record<ScopeFamily, readonly [StringKey, StringKey]>> = {
  microsoft: ['permissions.blindSpot', 'permissions.blindSpot.more'],
  google: ['permissions.blindSpot.google', 'permissions.blindSpot.google.more'],
};

function blindSpotOf(sourceKind: string | undefined): readonly [StringKey, StringKey] | undefined {
  if (!sourceKind) return undefined;
  const family = scopeFamilyOfConnectionKind(sourceKind) ?? scopeFamilyOf(sourceKind);
  return family ? BLIND_SPOT[family] : undefined;
}

export const PermissionsHandover: React.FC<{
  /** Which migration's mailbox to report on. */
  mappingId: string;
  /**
   * The migration's source, as the failures queue names it (`sourceKind`):
   * the connection kind on managed, the source type on the appliance.
   * Absent while it is read, and then no blind-spot line is shown.
   */
  sourceKind?: string | undefined;
}> = ({ mappingId, sourceKind }) => {
  const t = useT();
  const blindSpot = blindSpotOf(sourceKind);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const markdown = await fetchPermissionReport(mappingId);
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `permissions-${mappingId}.md`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      // The server's own words where it has them: a mapping whose source
      // address was never recorded answers with which fact is missing, and
      // that is more useful than "the request failed" (rule 9).
      const data = (err as { response?: { data?: { message?: unknown; reason?: unknown } } })
        ?.response?.data;
      const said =
        typeof data?.message === 'string'
          ? data.message
          : typeof data?.reason === 'string'
            ? data.reason
            : '';
      setError(said || t('permissions.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 p-4 rounded-lg border border-amber-200 bg-amber-50">
      <h3 className="flex items-center gap-2 font-semibold text-amber-900">
        <KeyRound className="w-4 h-4" />
        {t('permissions.heading')}
      </h3>
      <Hint className="mt-1" tone="caution" label="more" text={t('permissions.body')} why={t('permissions.body.more')} />
      {/* Said here, not only inside the document: the one class of right that
          cannot be read at all is the one most likely to break, and somebody
          who never opens the report should still learn it. */}
      {blindSpot && (
        <Hint className="mt-1" tone="caution" label="more" text={t(blindSpot[0])} why={t(blindSpot[1])} />
      )}
      <button
        onClick={download}
        disabled={busy}
        className="mt-3 px-3 py-1.5 text-sm font-medium rounded border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 disabled:opacity-50"
      >
        {t('permissions.download')}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
};

export default PermissionsHandover;
