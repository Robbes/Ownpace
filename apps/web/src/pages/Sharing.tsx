// Copyright 2026 The Ownpace authors (Apache-2.0)
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
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Folder,
  Link2,
  SkipForward,
  Loader2,
  UserPlus,
} from 'lucide-react';
import {
  groupShareGrants,
  readGrant,
  type ShareGrantRow,
  type ShareGroup,
  type ShareStandalone,
} from '@openmig/shared';
import { ActionButton, ConfirmButton, Refused } from '../components/queues/primitives.tsx';
import {
  DecisionRefusedError,
  decideSharing,
  fetchSharing,
  rescanSharing,
} from '../services/operating-service.ts';
import MappingHubLink from '../components/MappingHubLink.tsx';
import { useT, useFormatters } from '../i18n/index.tsx';
import { serverMessage } from '../services/api.ts';
import { Hint } from '../components/Hint.tsx';

/**
 * A grant, as copy — never as the key it is compared on.
 *
 * `grantSet` builds `grantee:role` so two items can be checked for carrying
 * exactly the same rights. That string reached the screen: the owner read
 * `b.berentsen@gmail.com:writer` beside a folder called `2017 Q2` and asked why
 * an email address had grown a month on the end of it. A comparison key is
 * machinery; a screen shows words.
 *
 * `readGrant` is the builder's own inverse and lives beside it in
 * `@openmig/shared`, so the words here cannot drift from the key there. The
 * ROLE stays the source's own word, exactly as it is on every row below — ours
 * would be a translation of a claim we did not make.
 */
const useGrantText = (): ((key: string) => string) => {
  const t = useT();
  return (key: string): string => {
    const g = readGrant(key);
    const who = g.viaLink ? t('sharing.grant.link') : (g.grantee ?? '');
    return g.role ? `${who} (${g.role})` : who;
  };
};

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
  /**
   * Why this row is not under a folder's lid — rendered INSIDE this card.
   *
   * It used to sit above the card, a loose line between two tiles, and the
   * owner asked whether the sentences outside the tiles were meant to be
   * there. They were not: a sentence about a row belongs to the row it is
   * about, or the reader has to guess which one it points at.
   */
  note?: React.ReactNode;
}> = ({ row, busy, onDecide, refusal, confirmedGrantee, note }) => {
  // The grantee box and its label are joined by id (0067 T7 (a)); one Row per share.
  const granteeId = React.useId();
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
      {note}
      {/* The mapping table's verdict, verbatim: what this right corresponds
          to on the target, or what to do instead (0029 T2). */}
      <p className="mt-1 text-xs text-gray-500">{row.verdictTarget}</p>
      {!settled && !busy && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {applicable && (
            <>
              <label htmlFor={granteeId} className="text-xs text-gray-500">
                {t('sharing.granteeLabel')}
              </label>
              <input
                id={granteeId}
                type="text"
                value={grantee}
                onChange={(e) => {
                  setEdited(true);
                  setGrantee(e.target.value);
                }}
                className="input text-sm py-1 w-56"
              />
              {/* Two presses, because the new system emails a real person the
                  moment this lands and that cannot be unsent — but NOT the
                  destructive dressing: this creates access, it removes
                  nothing. See ConfirmButton's header. */}
              <ConfirmButton
                pending={false}
                tone="outward"
                icon={<UserPlus className="w-3 h-3" />}
                label={t('sharing.apply')}
                armedLabel={t('sharing.applyArmed')}
                onClick={() => onDecide(row, 'apply', grantee.trim() || undefined)}
              />
            </>
          )}
          {/* Both settle the row; they record DIFFERENT things, and after a
              cutover "we rebuilt it" and "we decided to drop it" are
              different answers to why somebody can no longer open this. The
              titles say which is which, because the labels cannot. */}
          <ActionButton
            pending={false}
            title={t('sharing.done.why')}
            onClick={() => onDecide(row, 'done')}
          >
            {t('sharing.done')}
          </ActionButton>
          <ActionButton
            pending={false}
            title={t('sharing.skip.why')}
            onClick={() => onDecide(row, 'skip')}
          >
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

/**
 * One folder's worth of shares, as one row the owner can read (0123 T4).
 *
 * THE COMPLAINT THIS ANSWERS. The owner's Sharing page showed 482 rows for a
 * handful of shared folders, because Drive populates `permissions` on every
 * child of a shared folder as well as on the folder. Every row was true. The
 * wall of them was unreadable — and an unreadable list is where a forgotten
 * "anyone with the link" survives a cutover.
 *
 * NOTHING IS HIDDEN, only folded. The group opens to the very same `Row`s,
 * with the very same presses; the summary is a lid, not a replacement. A
 * deviation never gets under the lid at all (see the page below).
 *
 * WHY THE GROUP PRESS IS `done` AND `skip` AND NOT `apply`. Those two RECORD a
 * decision and reach nobody. `apply` re-creates the share on the target, which
 * emails a real person the moment it lands — which is why it carries the
 * arm-then-confirm ceremony and an editable address per row (ADR-0032 §6). One
 * press that sent eleven invitations would be a different decision about blast
 * radius than the one that ceremony was designed around, so `apply` stays
 * exactly where it is: inside the group, one row at a time.
 */
const GroupCard: React.FC<{
  group: ShareGroup;
  rows: ReadonlyArray<ShareGrantRow>;
  busy: boolean;
  onDecideMany: (rows: ReadonlyArray<ShareGrantRow>, action: 'done' | 'skip') => void;
  children: React.ReactNode;
}> = ({ group, rows, busy, onDecideMany, children }) => {
  const t = useT();
  const grantText = useGrantText();
  const [open, setOpen] = React.useState(false);
  const openRows = rows.filter((r) => r.state === 'open');
  const sharedWith = group.grants.map((g) => grantText(g)).join(', ');

  return (
    <li className="bg-white border border-gray-200 rounded-lg">
      <div className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 min-w-0 text-left"
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
            )}
            <Folder className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="truncate font-medium text-gray-900">
              {/* A container we never listed has no name we may print: a folder
                  can hold shared files without being shared itself, and
                  inventing one would be a claim about a folder nobody read. */}
              {group.label ?? t('sharing.group.unnamedFolder')}
            </span>
          </button>
          {/* ...so it is identified by something demonstrably INSIDE it. Five
              folders all reading "one folder (not itself shared)" identify
              none of them, and one of the owner's five was the Drive root. */}
          {group.label === undefined && group.sample !== undefined && (
            <span className="text-xs text-gray-500 truncate">
              {t('sharing.group.holds')} {group.sample}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-500 flex-shrink-0">
              {group.items} {t('sharing.group.items')}
            </span>
            {busy && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </div>
        </div>
        {/* Who it is shared with, on a line of its own. The folder's NAME and
            its grants are two different facts, and run together on one line
            they read as one — which is exactly how the owner read them. */}
        <p className="mt-1 text-sm text-gray-700 truncate" title={sharedWith}>
          <span className="text-gray-500">{t('sharing.group.sharedWith')}</span> {sharedWith}
        </p>
      </div>
      {openRows.length > 0 && !busy && (
        <div className="px-3 pb-3 flex items-center gap-2 flex-wrap">
          <ActionButton
            pending={false}
            title={t('sharing.done.why')}
            onClick={() => onDecideMany(openRows, 'done')}
          >
            {t('sharing.group.doneAll')} ({openRows.length})
          </ActionButton>
          <ActionButton
            pending={false}
            title={t('sharing.skip.why')}
            onClick={() => onDecideMany(openRows, 'skip')}
          >
            {t('sharing.group.skipAll')} ({openRows.length})
          </ActionButton>
          <span className="text-xs text-gray-400">{t('sharing.group.applyInside')}</span>
        </div>
      )}
      {open && <ul className="px-3 pb-3 space-y-2">{children}</ul>}
    </li>
  );
};

/** Why a row refused to fold — printed inside it, never instead of it. */
const WhyAlone: React.FC<{ row: ShareStandalone }> = ({ row }) => {
  const t = useT();
  const grantText = useGrantText();
  if (row.reason === 'unplaced') {
    return <p className="mt-1 text-xs text-gray-500">{t('sharing.alone.unplaced')}</p>;
  }
  const against =
    row.comparedWith === 'folder'
      ? t('sharing.alone.vsFolder')
      : t('sharing.alone.vsSiblings');
  // What it carries that its folder does not, and what its folder has that it
  // lacks — both in words, for the same reason the group header is.
  const list = (keys: readonly string[]): string => keys.map((k) => grantText(k)).join(', ');
  return (
    <p className="mt-1 text-xs text-amber-800">
      {against}
      {row.extra && row.extra.length > 0
        ? ` · ${t('sharing.alone.extra')} ${list(row.extra)}`
        : ''}
      {row.missing && row.missing.length > 0
        ? ` · ${t('sharing.alone.missing')} ${list(row.missing)}`
        : ''}
    </p>
  );
};

const Sharing: React.FC = () => {
  const { mappingId } = useParams<{ mappingId: string }>();
  const t = useT();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [busyGroup, setBusyGroup] = React.useState<string | null>(null);
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

  /**
   * One press over a whole folder (0123 T4). `done` and `skip` only — see
   * GroupCard's header for why `apply` is not offered here.
   *
   * Sequential, not Promise.all: each one is a write the server records, and a
   * burst of eleven would race the same mapping's rows through the decision
   * gate for no benefit a person can perceive. A refusal on any row is shown
   * against THAT row, and the rest still go — settling ten of eleven is a
   * better outcome than abandoning the press because one was already decided.
   */
  const onDecideMany = (rows: ReadonlyArray<ShareGrantRow>, action: 'done' | 'skip') => {
    const key = rows.map((r) => r.id).join(',');
    setBusyGroup(key);
    void (async () => {
      const failures: Record<string, string> = {};
      for (const row of rows) {
        try {
          await decideSharing(mappingId, row.id, { action });
        } catch (err: unknown) {
          failures[row.id] =
            err instanceof DecisionRefusedError
              ? (err.refusal.reason ?? err.refusal.hint ?? err.refusal.error)
              : err instanceof Error
                ? err.message
                : t('common.requestFailed');
        }
      }
      setRefusals((r) => ({ ...r, ...failures }));
      setBusyGroup(null);
      refresh();
    })();
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

  // The fold is a PRESENTATION over the rows this page already has — no second
  // request, and the same pure rule `@openmig/shared` gives the appliance's
  // own report, so the two surfaces cannot disagree about what a folder covers.
  const grants = data?.grants ?? [];
  const grouped = groupShareGrants(grants);
  // EVERY ROW UNPLACED IS NOT THE SAME FINDING AS ONE ROW UNPLACED.
  //
  // A mapping last scanned before migration 0053 carries no placement at all,
  // so every row comes back `unplaced` and is correct to list on its own. What
  // would NOT be correct is printing "the old system did not say where this
  // sits" 482 times: that sentence earns its place when the absence is
  // SELECTIVE — these rows placed, that one not — and degenerates into noise
  // when it is universal, which is the wall this task exists to remove.
  //
  // So when nothing at all is placed, the page says it once at the top, names
  // the remedy, and renders exactly as it did before this feature existed.
  const nothingPlaced =
    grants.length > 0 &&
    grouped.groups.length === 0 &&
    grouped.standalone.every((a) => a.reason === 'unplaced');
  const byId = new Map(grants.map((r) => [r.id, r]));
  const rowById = (id: string): ShareGrantRow | undefined => byId.get(id);
  const isRow = (r: ShareGrantRow | undefined): r is ShareGrantRow => r !== undefined;
  const renderRow = (row: ShareGrantRow, note?: React.ReactNode) => (
    <Row
      key={row.id}
      row={row}
      busy={busyId === row.id}
      onDecide={onDecide}
      refusal={refusals[row.id] || undefined}
      confirmedGrantee={row.grantee ? confirmedPairs[row.grantee] : undefined}
      note={note}
    />
  );

  return (
    <div>
      <MappingHubLink mappingId={mappingId} />
      <h2 className="text-lg font-semibold text-gray-900">{t('sharing.title')}</h2>
      <Hint className="mt-1" label="more" text={t('sharing.intro')} why={t('sharing.intro.more')} />

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
      {nothingPlaced && (
        <p className="mt-3 text-sm text-gray-500">{t('sharing.notPlacedYet')}</p>
      )}
      {data && data.grants.length > 0 && (
        <ul className="mt-4 space-y-2">
          {/* Folded folders first, then everything that refused to fold. The
              order is the point: a deviation must never end up below three
              screens of collapsed folders, because it is the row somebody
              actually has to look at before a cutover. */}
          {grouped.groups.map((g) => (
            <GroupCard
              key={`${g.parentKey}\u0000${g.grants.join(',')}`}
              group={g}
              rows={g.rowIds.map(rowById).filter(isRow)}
              busy={busyGroup === g.rowIds.filter((id) => rowById(id)?.state === 'open').join(',')}
              onDecideMany={onDecideMany}
            >
              {g.rowIds.map(rowById).filter(isRow).map((r) => renderRow(r))}
            </GroupCard>
          ))}
          {grouped.standalone.map((alone) => {
            // ONE explanation, on the FIRST of this item's rows. An item shared
            // with three people is three rows and a single reason it stands
            // apart; against each of them it is the wall again, in a smaller
            // font. Each card carries its own, so none of them is a line
            // floating between two tiles with nothing saying which it means.
            const aloneRows = alone.rowIds.map(rowById).filter(isRow);
            const why = nothingPlaced ? undefined : <WhyAlone row={alone} />;
            return (
              <React.Fragment key={alone.rowIds.join(',')}>
                {aloneRows.map((r, i) => renderRow(r, i === 0 ? why : undefined))}
              </React.Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default Sharing;
