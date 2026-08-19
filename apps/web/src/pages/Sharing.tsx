// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The sharing checklist (ADR-0032, workplan 0052).
 *
 * Every grant the §14.2 inventory discovered, as a list the owner WORKS
 * rather than a report the owner reads: open rows wait, settled rows keep who
 * decided and when, and the progress line says how much is left. Three ways
 * to settle a row — and only one of them is the tool acting:
 *
 *  - **apply**: re-create the share on the target through its own share API.
 *    The target then notifies the grantee itself; the button says so, because
 *    pressing it sends a real invitation to a real person. That is why apply
 *    gets the two-step arm-then-confirm ceremony (outward-facing, ADR-0032),
 *    and why the grantee address sits in an editable field beside it — the
 *    machine proposes the source's address, a person confirms or corrects it
 *    (§6) before anything is sent.
 *  - **done**: the owner did it by hand on the target and ticks it off.
 *  - **skip**: it deliberately does not carry over; recorded, not forgotten.
 *
 * Every refusal the server answers with renders verbatim — the gates' own
 * words (not cut over yet, link share, no share API on this target…) are the
 * explanation, and rephrasing them here would be drift (hard rule 5).
 */

import React from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleDashed, Link2, SkipForward, Loader2 } from 'lucide-react';
import type { ShareGrantRow } from '@openmig/shared';
import {
  ActionButton,
  DestructiveButton,
  Refused,
} from '../components/queues/primitives.tsx';
import {
  DecisionRefusedError,
  decideSharing,
  fetchSharing,
  rescanSharing,
} from '../services/operating-service.ts';
import MappingHubLink from '../components/MappingHubLink.tsx';
import { useT, useFormatters } from '../i18n/index.tsx';
import { serverMessage } from '../services/api.ts';

const StateBadge: React.FC<{ row: ShareGrantRow }> = ({ row }) => {
  const t = useT();
  const { relativeToNow, dateTime } = useFormatters();
  if (row.state === 'open') return null;
  const label =
    row.state === 'applied'
      ? t('sharing.state.applied')
      : row.state === 'done_manual'
        ? t('sharing.state.doneManual')
        : t('sharing.state.skipped');
  return (
    <span
      className="text-xs text-gray-500"
      title={row.decidedAt ? `${row.decidedBy ?? ''} — ${dateTime(row.decidedAt)}` : undefined}
    >
      {label}
      {row.decidedAt ? ` · ${relativeToNow(row.decidedAt)}` : ''}
    </span>
  );
};

const Row: React.FC<{
  row: ShareGrantRow;
  busy: boolean;
  onDecide: (
    row: ShareGrantRow,
    action: 'apply' | 'done' | 'skip',
    grantee?: string,
  ) => void;
  refusal?: string;
  /** A pair the owner already confirmed on another row of the same grantee. */
  confirmedGrantee?: string;
}> = ({ row, busy, onDecide, refusal, confirmedGrantee }) => {
  const t = useT();
  // The machine proposes; a person confirms or edits before anything is sent
  // (ADR-0032 §6). Confirm ONCE: an address the owner already corrected for
  // this grantee — anna@old → anna@new on some other file — prefills their
  // remaining rows, so nobody retypes the same correction ten times. Local
  // state beyond that: nothing is stored until apply succeeds.
  const [grantee, setGrantee] = React.useState(confirmedGrantee ?? row.grantee ?? '');
  const [edited, setEdited] = React.useState(false);
  React.useEffect(() => {
    // A confirmation arriving from ANOTHER row updates this one only while
    // the owner has not typed here themselves — their edit always wins.
    if (!edited && confirmedGrantee) setGrantee(confirmedGrantee);
  }, [confirmedGrantee, edited]);
  const settled = row.state !== 'open';
  const applicable = !settled && row.verdict === 'clean' && !row.viaLink;

  return (
    <li className="p-3 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-center gap-2 flex-wrap">
        {settled ? (
          row.state === 'skipped' ? (
            <SkipForward className="w-4 h-4 text-gray-400 flex-shrink-0" />
          ) : (
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          )
        ) : (
          <CircleDashed className="w-4 h-4 text-amber-500 flex-shrink-0" />
        )}
        <span
          className={`truncate font-medium ${settled ? 'text-gray-500' : 'text-gray-900'}`}
          title={row.raw}
        >
          {row.onLabel}
        </span>
        <span className="text-xs text-gray-500 flex-shrink-0">{row.role}</span>
        {row.viaLink ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800 flex-shrink-0">
            <Link2 className="w-3 h-3" />
            {t('sharing.linkShare')}
          </span>
        ) : (
          row.grantee && <span className="text-sm text-gray-700 truncate">{row.grantee}</span>
        )}
        {row.verdict === 'manual' && !settled && (
          <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700 flex-shrink-0">
            {t('sharing.manualBadge')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <StateBadge row={row} />
          {busy && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
        </div>
      </div>
      {/* The mapping table's verdict, verbatim: what this right corresponds
          to on the target, or what to do instead (0029 T2). */}
      <p className="mt-1 text-xs text-gray-500">{row.verdictTarget}</p>
      {!settled && !busy && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {applicable && (
            <>
              <label className="text-xs text-gray-500">{t('sharing.granteeLabel')}</label>
              <input
                type="text"
                value={grantee}
                onChange={(e) => {
                  setEdited(true);
                  setGrantee(e.target.value);
                }}
                className="input text-sm py-1 w-56"
              />
              <DestructiveButton
                pending={false}
                label={t('sharing.apply')}
                armedLabel={t('sharing.applyArmed')}
                onClick={() => onDecide(row, 'apply', grantee.trim() || undefined)}
              />
            </>
          )}
          <ActionButton pending={false} onClick={() => onDecide(row, 'done')}>
            {t('sharing.done')}
          </ActionButton>
          <ActionButton pending={false} onClick={() => onDecide(row, 'skip')}>
            {t('sharing.skip')}
          </ActionButton>
        </div>
      )}
      {applicable && !settled && (
        <p className="mt-1 text-xs text-gray-400">{t('sharing.inviteNote')}</p>
      )}
      {refusal && (
        <div className="mt-2">
          <Refused text={refusal} />
        </div>
      )}
    </li>
  );
};

const Sharing: React.FC = () => {
  const { mappingId } = useParams<{ mappingId: string }>();
  const t = useT();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [refusals, setRefusals] = React.useState<Record<string, string>>({});
  // Confirm-once address mapping (ADR-0032 §6): a corrected address, applied
  // successfully, prefills the same grantee's other rows this session. Never
  // stored server-side — each apply still sends its address explicitly.
  const [confirmedPairs, setConfirmedPairs] = React.useState<Record<string, string>>({});
  const [rescanning, setRescanning] = React.useState(false);
  const [blindSpots, setBlindSpots] = React.useState<ReadonlyArray<string>>([]);

  const queryKey = ['sharing', mappingId];
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchSharing(mappingId!),
    enabled: Boolean(mappingId),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  if (!mappingId) return <p className="text-sm text-amber-800">{t('hub.noId')}</p>;

  const refresh = () => void queryClient.invalidateQueries({ queryKey });

  const onDecide = (row: ShareGrantRow, action: 'apply' | 'done' | 'skip', grantee?: string) => {
    setBusyId(row.id);
    setRefusals((r) => ({ ...r, [row.id]: '' }));
    decideSharing(mappingId, row.id, { action, ...(grantee ? { grantee } : {}) })
      .then(() => {
        // A successful apply with a corrected address IS the confirmation —
        // remember the pair for this grantee's remaining rows.
        if (action === 'apply' && grantee && row.grantee && grantee !== row.grantee) {
          setConfirmedPairs((p) => ({ ...p, [row.grantee!]: grantee }));
        }
        refresh();
      })
      .catch((err: unknown) => {
        setRefusals((r) => ({
          ...r,
          [row.id]:
            err instanceof DecisionRefusedError
              ? (err.refusal.reason ?? err.refusal.hint ?? err.refusal.error)
              : err instanceof Error
                ? err.message
                : t('common.requestFailed'),
        }));
      })
      .finally(() => setBusyId(null));
  };

  const rescan = () => {
    setRescanning(true);
    rescanSharing(mappingId)
      .then((r) => {
        setBlindSpots(r.blindSpots);
        refresh();
      })
      .catch(() => setBlindSpots([t('common.requestFailed')]))
      .finally(() => setRescanning(false));
  };

  const summary = data?.summary;
  const settledCount = summary ? summary.total - summary.open : 0;

  return (
    <div>
      <MappingHubLink mappingId={mappingId} />
      <h2 className="text-lg font-semibold text-gray-900">{t('sharing.title')}</h2>
      <p className="mt-1 text-sm text-gray-600">{t('sharing.intro')}</p>

      <div className="mt-3 flex items-center gap-3 flex-wrap">
        {summary && summary.total > 0 && (
          <span className="text-sm font-medium text-gray-900">
            {settledCount} / {summary.total} {t('sharing.progressSettled')}
          </span>
        )}
        <ActionButton pending={rescanning} onClick={rescan}>
          {t('sharing.rescan')}
        </ActionButton>
      </div>
      {summary && summary.openManual > 0 && (
        <p className="mt-1 text-sm text-gray-600">
          {summary.openManual} {t('sharing.openManualNote')}
        </p>
      )}
      {data?.reportingClosed && (
        <p className="mt-2 text-sm text-gray-500">{data.reportingClosed}</p>
      )}
      {blindSpots.length > 0 && (
        <div className="mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-amber-900">{t('sharing.blindSpots')}</p>
          {/* The scans' own sentences, verbatim — a blind spot is a checklist
              item too, just one the tool cannot enumerate. */}
          <ul className="mt-1 space-y-1">
            {blindSpots.map((b, i) => (
              <li key={i} className="text-sm text-amber-800">
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLoading && <Loader2 className="mt-6 w-5 h-5 animate-spin text-gray-400" />}
      {error != null && (
        <p className="mt-4 text-sm text-amber-800">
          {t('sharing.loadFailed')}{' '}
          {serverMessage(error)}
        </p>
      )}
      {data && data.grants.length === 0 && (
        <p className="mt-6 text-sm text-gray-500">{t('sharing.empty')}</p>
      )}
      {data && data.grants.length > 0 && (
        <ul className="mt-4 space-y-2">
          {data.grants.map((row) => (
            <Row
              key={row.id}
              row={row}
              busy={busyId === row.id}
              onDecide={onDecide}
              refusal={refusals[row.id] || undefined}
              confirmedGrantee={row.grantee ? confirmedPairs[row.grantee] : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

export default Sharing;
