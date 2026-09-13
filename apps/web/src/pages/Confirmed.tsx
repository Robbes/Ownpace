// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The confirmed list (workplan 0117 T2, D10) — the screen.
 *
 * **This is the page somebody deletes their originals on the strength of.**
 * Everything below follows from that sentence, and it is why the server half
 * shipped a month before this one: a list that overstates its evidence by one
 * word is a person emptying a folder they should have kept.
 *
 * ## What is on screen, and why it is not everything
 *
 * > ✅ D10 *"(a): a headline count, every row that is NOT verified, the total
 * > stated, and a full export."*
 *
 * The headline is what CAN be claimed; the table is what somebody can ACT on;
 * the total says nothing has been quietly omitted; the export is the complete
 * account, for reconciling one file at a time. A verified row is not on screen
 * because there is nothing to do about it — which is exactly why the export
 * exists beside it rather than instead of it.
 *
 * ## Behind a button, and never polled
 *
 * `GET .../confirmed-list` WALKS the mapping's items, because the headline is
 * derived at read time rather than stored (slice 1's rule: no stale word in
 * the database). So this screen reads once on mount and re-reads when a pass
 * lands — a `setInterval` on the list itself would walk a family file account
 * every few seconds. The pass's own progress is a run row, which is cheap.
 *
 * ## The states are not a scale
 *
 * `confirmed-list.ts` is explicit: the claims are different QUESTIONS, not
 * confidence levels, and `unchecked` / `missing` / `never-placed` are three
 * different facts a list must never render alike. So each state gets its own
 * word and its own hover sentence, and none of them is a star rating.
 *
 * ## An identifier that is blank, and why it says so
 *
 * `item.natural_key` was written as `''` on every row in the repository's
 * history until 2026-09-12. Rows written before that carry a blank there and
 * cannot be backfilled — the plain text is not recoverable from its sha256 —
 * so they repair one at a time as a pass re-walks the source. A blank cell
 * would read as *this item has no name*, on the one document where that is a
 * frightening thing to read, so the blank is named and its reason is one hover
 * away.
 */

import React from 'react';
import { useParams } from 'react-router';
import { AlertCircle, Download, Loader2 } from 'lucide-react';
import type { ClaimKind, ConfirmedListQueue, ConfirmedRowView, RowState } from '@openmig/shared';
import {
  fetchConfirmedList,
  fetchConfirmedListExport,
  fetchRuns,
  startConfirmation,
} from '../services/operating-service.ts';
import { useT, useFormatters } from '../i18n/index.tsx';
import { isSelfHost } from '../services/edition.ts';
import MappingHubLink from '../components/MappingHubLink.tsx';
import type { StringKey } from '../i18n/index.tsx';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import { PAUSE_KEY } from '../i18n/pause-key.ts';
import { serverMessage } from '../services/api.ts';

/**
 * A word and a sentence per state — total over `RowState`, so a ninth state is
 * a compile error here rather than an unlabelled row on this page.
 *
 * `verified` is in the map and not on the table: the server sends only
 * non-verified rows, and a record that omitted it would stop being total the
 * day that changes.
 */
const STATE: Readonly<
  Record<RowState, { nameKey: StringKey; helpKey: StringKey; className: string }>
> = {
  verified: {
    nameKey: 'confirmed.state.verified',
    helpKey: 'confirmed.help.verified',
    className: 'text-emerald-700',
  },
  differs: {
    nameKey: 'confirmed.state.differs',
    helpKey: 'confirmed.help.differs',
    className: 'text-red-700',
  },
  present: {
    nameKey: 'confirmed.state.present',
    helpKey: 'confirmed.help.present',
    className: 'text-gray-700',
  },
  yours: {
    nameKey: 'confirmed.state.yours',
    helpKey: 'confirmed.help.yours',
    className: 'text-gray-700',
  },
  missing: {
    nameKey: 'confirmed.state.missing',
    helpKey: 'confirmed.help.missing',
    className: 'text-red-700 font-medium',
  },
  'never-placed': {
    nameKey: 'confirmed.state.neverPlaced',
    helpKey: 'confirmed.help.neverPlaced',
    className: 'text-amber-800',
  },
  removed: {
    nameKey: 'confirmed.state.removed',
    helpKey: 'confirmed.help.removed',
    className: 'text-gray-500',
  },
  unchecked: {
    nameKey: 'confirmed.state.unchecked',
    helpKey: 'confirmed.help.unchecked',
    className: 'text-gray-500',
  },
};

/** What was compared. Named, never scored — see the file header. */
const CLAIM: Readonly<Record<ClaimKind, StringKey>> = {
  'byte-hash': 'confirmed.claim.byteHash',
  fingerprint: 'confirmed.claim.fingerprint',
  none: 'confirmed.claim.none',
};

function Row({ r }: { r: ConfirmedRowView }): React.ReactElement {
  const t = useT();
  const { dateTime } = useFormatters();
  const s = STATE[r.state];
  return (
    <tr className="border-b border-gray-100 last:border-0 align-top">
      <td className="py-2 pr-3 text-gray-900">{t(DOMAIN_STRING_KEY[r.domain])}</td>
      <td className="py-2 pr-3 text-gray-600 break-all">{r.collection}</td>
      <td className="py-2 pr-3 break-all">
        {r.naturalKey === '' ? (
          // Not "unknown item" — "we did not record the name". The difference
          // matters on this page more than anywhere else in the product.
          <span className="text-gray-500 italic" title={t('confirmed.noKey.hover')}>
            {t('confirmed.noKey')}
          </span>
        ) : (
          <span className="text-gray-900">{r.naturalKey}</span>
        )}
      </td>
      <td className="py-2 pr-3">
        <span className={s.className} title={t(s.helpKey)}>
          {t(s.nameKey)}
        </span>
      </td>
      <td className="py-2 pr-3 text-xs text-gray-600">{t(CLAIM[r.claim])}</td>
      <td className="py-2 text-xs text-gray-600">
        {r.confirmedAt === null ? '—' : dateTime(r.confirmedAt)}
      </td>
    </tr>
  );
}

function ExportButton({ mappingId }: { mappingId?: string }): React.ReactElement {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);
  return (
    <span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(null);
          fetchConfirmedListExport(mappingId)
            .then(({ blob, filename }) => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              a.click();
              URL.revokeObjectURL(url);
            })
            .catch((err: unknown) => {
              // A download button that silently does nothing is a support
              // ticket, and this one hands over the complete account.
              setFailed(serverMessage(err));
            })
            .finally(() => setBusy(false));
        }}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {t('confirmed.export')}
      </button>
      {failed !== null && <span className="ml-2 text-sm text-amber-800">{failed}</span>}
    </span>
  );
}

function PassLine({ q }: { q: ConfirmedListQueue }): React.ReactElement {
  const t = useT();
  const { dateTime } = useFormatters();
  const p = q.lastPass;
  if (p.state === 'never-run') {
    return <p className="text-xs text-gray-500">{t('confirmed.neverRun')}</p>;
  }
  if (p.state === 'running') {
    return (
      <p className="text-xs text-gray-500">
        {t('confirmed.running')} {dateTime(p.startedAt)}
      </p>
    );
  }
  if (p.state === 'failed') {
    // A failed pass is not a result. Saying "checked at …" over a pass that
    // died would date a document by the moment it stopped being trustworthy.
    return (
      <p className="text-xs text-amber-800">
        {t('confirmed.passFailed')} {dateTime(p.finishedAt)}
        {p.error !== undefined ? ` — ${p.error}` : ''}
      </p>
    );
  }
  return (
    <p className="text-xs text-gray-500">
      {t('confirmed.checkedAt')} {dateTime(p.finishedAt)}
    </p>
  );
}

function Mapping({ mappingId, q }: { mappingId: string; q: ConfirmedListQueue }): React.ReactElement {
  const t = useT();
  const { number } = useFormatters();
  return (
    <section className="mb-8 p-4 bg-white border border-gray-200 rounded-lg">
      <h3 className="font-semibold text-gray-900 mb-2">
        <MappingHubLink mappingId={mappingId} />
      </h3>

      {/*
        D10's headline, and the whole claim of this page. `verified` counts
        only rows re-read from the target that matched — `yours` and `present`
        are not in it, deliberately — and the total beside it is what stops the
        number reading as the whole account.
      */}
      <p className="text-gray-900">
        <span className="text-2xl font-semibold tabular-nums">{number(q.verified)}</span>{' '}
        <span className="text-sm">
          {t('confirmed.headline.of')} {number(q.total)} {t('confirmed.headline.rest')}
        </span>
      </p>
      <PassLine q={q} />

      {/*
        Why the account is only PART checked, when there is a reason. Without
        it "12 of 50 000" reads as a bad result rather than as a day's budget
        spent — §7c's own warning about a list that misleads by omission.
      */}
      {q.pausedAt !== undefined && (
        <p className="mt-2 text-sm text-amber-800">
          {t('confirmed.paused')} {t(PAUSE_KEY[q.pausedAt.kind])}
        </p>
      )}

      {q.rows.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600">
          {q.total === 0 ? t('confirmed.nothingYet') : t('confirmed.allVerified')}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3 font-medium">{t('confirmed.col.domain')}</th>
                <th className="py-2 pr-3 font-medium">{t('confirmed.col.collection')}</th>
                <th className="py-2 pr-3 font-medium">{t('confirmed.col.item')}</th>
                <th className="py-2 pr-3 font-medium">{t('confirmed.col.state')}</th>
                <th className="py-2 pr-3 font-medium">{t('confirmed.col.claim')}</th>
                <th className="py-2 font-medium">{t('confirmed.col.when')}</th>
              </tr>
            </thead>
            <tbody>
              {q.rows.map((r, i) => (
                <Row key={`${r.domain}:${r.collection}:${r.naturalKey}:${i}`} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        Silent truncation reads as "covered everything" (0036 T3). Before any
        pass has run NOTHING is verified, so this is the ordinary case rather
        than an edge one — and the way out of it is the export, which is
        bounded by nothing.
      */}
      {q.truncated === true && (
        <p className="mt-3 text-sm text-amber-800">
          {t('confirmed.truncated.a')} {number(q.rows.length)} {t('confirmed.truncated.b')}
        </p>
      )}
    </section>
  );
}

/** How long the run watch may wait, and how often it asks. See `start`. */
const POLL_MS = 5000;
const MAX_POLLS = 60;

const Confirmed: React.FC = () => {
  const { mappingId } = useParams<{ mappingId: string }>();
  const t = useT();

  const [list, setList] = React.useState<Record<string, ConfirmedListQueue> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [checking, setChecking] = React.useState(false);
  const [joined, setJoined] = React.useState(false);

  const read = React.useCallback(() => {
    setLoading(true);
    return fetchConfirmedList(mappingId)
      .then((r) => {
        setList(r as Record<string, ConfirmedListQueue>);
        setError(null);
      })
      .catch((err: unknown) => setError(serverMessage(err)))
      .finally(() => setLoading(false));
  }, [mappingId]);

  React.useEffect(() => {
    void read();
  }, [read]);

  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pollsRef = React.useRef(0);
  const stopPolling = React.useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  React.useEffect(() => stopPolling, [stopPolling]);

  /**
   * Start a pass, watch the RUN, then re-read the list once.
   *
   * The run row is cheap; the list walks every item in the account. So the
   * poll goes to `/runs` and the expensive read happens exactly once, when no
   * run is open any more — which is the rule the contract states and the
   * reason this screen does not simply poll itself.
   *
   * **Bounded, because "no run is open" is not guaranteed to arrive.** A
   * mapping in the continuous lane (T1) keeps opening sync runs, so a watch
   * that waited for quiet would wait for ever with a spinner on screen. After
   * the cap the watch stops and re-reads anyway: a list a few minutes stale,
   * with its own `lastPass` line saying so, beats a spinner that never ends.
   */
  const start = () => {
    setChecking(true);
    setError(null);
    setJoined(false);
    void startConfirmation(mappingId)
      .then((r) => {
        // `started: false` means a pass was already under way and this request
        // joined it — an outcome, not an error, and the screen says which.
        setJoined(Object.values(r).some((v) => v.started === false));
        stopPolling();
        pollsRef.current = 0;
        pollRef.current = setInterval(() => {
          const id = mappingId ?? Object.keys(list ?? {})[0];
          if (id === undefined) return;
          pollsRef.current += 1;
          if (pollsRef.current > MAX_POLLS) {
            stopPolling();
            setChecking(false);
            void read();
            return;
          }
          void fetchRuns(id)
            .then(({ runs }) => {
              const open = runs.some((run) => run.status === 'running' || run.status === 'pending');
              if (!open) {
                stopPolling();
                setChecking(false);
                void read();
              }
            })
            .catch(() => {
              // A missed poll is not a failed pass — the worker may be busy or
              // the laptop asleep. Keep polling; the run row is authoritative.
            });
        }, POLL_MS);
      })
      .catch((err: unknown) => {
        setChecking(false);
        setError(serverMessage(err));
      });
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">{t('confirmed.title')}</h2>
      <p className="mt-1 mb-4 text-sm text-gray-600">{t('confirmed.intro')}</p>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={start}
          disabled={checking}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {checking && <Loader2 className="w-4 h-4 animate-spin" />}
          {t('confirmed.check')}
        </button>
        <ExportButton {...(mappingId !== undefined ? { mappingId } : {})} />
        {/*
          Said before they press it. A pass re-reads the TARGET item by item
          and costs a request each — an operator who is not told that will
          assume it has hung and reload.
        */}
        <span className="text-xs text-gray-500">
          {t('confirmed.durationHint')}
          {isSelfHost() && <> {t('confirmed.applianceScope')}</>}
          {joined && <> {t('confirmed.joined')}</>}
        </span>
      </div>

      {error !== null && (
        <div className="flex items-start gap-2 p-4 mb-4 rounded-lg bg-red-50 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t('confirmed.couldNotRead')}</p>
            <p className="mt-1">{error}</p>
          </div>
        </div>
      )}

      {loading && list === null && <p className="text-sm text-gray-500">{t('confirmed.loading')}</p>}

      {list !== null &&
        Object.entries(list).map(([id, q]) => <Mapping key={id} mappingId={id} q={q} />)}
    </div>
  );
};

export default Confirmed;
