// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Live per-domain progress — ONE component, both editions (0033 T5).
 *
 * Born inside Confirm.tsx (#355) after a Windows operator compared the
 * discovery snapshot's 510 against the ledger's 1149: what the migration is
 * doing NOW, from the same numbers `/status` serves, so the screen and
 * `Invoke-RestMethod .../status` can never disagree. Extracted so the managed
 * hub (MappingDetail) renders the identical strip from
 * `GET /migrations/{id}`'s `domainStatus` — both payloads are
 * `DomainStatusReport` rows built by the same shared function, which is what
 * makes this a data-source seam and not a feature fork (hard rule 5).
 *
 * `lastError` renders VERBATIM (the prose boundary): it is the line the
 * operator acts on, and a paraphrase is a different claim.
 *
 * Since 0110 T3 a CATEGORY renders above it, and the two are not in tension —
 * they answer different people. The prose stays exactly as the provider said
 * it, because precision is what an engineer needs and a paraphrase would be a
 * different claim. The category's sentence is what the CUSTOMER can act on,
 * which the owner's reframing of 2026-08-27 made the point: *"most of it must
 * be self-service."* Nobody self-serves from `invalid_grant`. Both, in that
 * order — the way out first, the evidence under it.
 */

import React from 'react';
import type {
  DomainStatusReport,
  FailureCategory,
  FailureSide,
  PauseReason,
} from '@openmig/shared';
import { useT, useLocale, useFormatters } from '../i18n/index.tsx';
import StateChip from './StateChip.tsx';
import { formatNumber } from '../i18n/datetime.ts';
// One map, shared with the operator's support screen (0110 T4) so the person
// who phones and the person they phone read the same sentence.
import { FAILURE_KEY, FAILURE_SIDE_KEY } from '../i18n/failure-key.ts';
// And one map for the domain words, shared with the confirm screen and the
// probe text — this was the fifth copy of it (workplan 0113 T5).
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import PausedBecause from './PausedBecause.tsx';
import { Hint } from './Hint.tsx';
import { SendItToUs } from './SendItToUs.tsx';
import { bytesOfAbout, progressTotals, wholePercent } from '../services/progress-totals.ts';

export const DOMAIN_KEY = DOMAIN_STRING_KEY satisfies Record<
  DomainStatusReport['domain'],
  unknown
>;

/** Only what the strip renders — `DomainStatusReport` satisfies this, and so
 *  does the detail schema's parsed row. */
export interface LiveProgressRow {
  readonly domain: DomainStatusReport['domain'];
  readonly state: DomainStatusReport['state'];
  readonly itemsSynced: number;
  readonly itemsFailed: number;
  readonly itemsRetrying: number;
  /**
   * How many were LEFT AS THEY ALREADY WERE (workplan 0124 T2).
   *
   * Absent means nobody counted, and the strip then says nothing — which is
   * not the same as saying none, and is why this is optional rather than
   * defaulted to zero (hard rule 9). A counted zero renders, because "nothing
   * was already there" is a real answer to the question the line raises.
   */
  readonly itemsAdopted?: number;
  /**
   * What discovery found of this data type (0154 T2), and its bytes. Absent
   * when discovery has no count, and the row then says the total is not
   * known: optional for `itemsAdopted`'s reason. See `progress-totals.ts`.
   */
  readonly itemsFound?: number;
  readonly bytesFound?: number;
  /** The bytes of what was copied. Optional only for rows built before it was read here. */
  readonly bytesTransferred?: number;
  readonly lastSyncedAt?: string;
  readonly lastError?: string;
  readonly lastErrorCategory?: FailureCategory;
  /** Which side the pass named when it failed (0094 T5); absent when it could not tell. */
  readonly failedSide?: FailureSide;
  /** The reference the failure was recorded under (0129 T1); absent when there is none. */
  readonly lastErrorReference?: string;
  /**
   * Why this data type stopped on purpose, when it did (migration 0041).
   * Absent while nothing is holding it up.
   */
  readonly pausedReason?: PauseReason;
  /**
   * When a pass last touched it — NOT the same claim as `lastSyncedAt`, which
   * is a completion. Optional here only because a payload built before this
   * field existed will not carry it.
   */
  readonly lastActiveAt?: string;
  /**
   * Its owner stopped it (0128 T4, slice 3c), rather than the mapping file
   * switching it off: the same `stopped`, a different way back.
   */
  readonly stoppedByOwner?: true;
}

const LiveProgress: React.FC<{ domains: readonly LiveProgressRow[] }> = ({ domains }) => {
  const t = useT();
  const { locale } = useLocale();
  const { relativeToNow } = useFormatters();
  // `skipped` is a data type the migration never had, so it has no line. A
  // `stopped` one keeps its line (0125 T7): it has copies on the target, and
  // hiding it is the silence that made a switched-off data type invisible.
  const running = domains.filter((d) => d.state !== 'skipped');
  if (running.length === 0) return null;
  return (
    <div className="mb-3">
      <h4 className="text-sm font-medium text-gray-700 mb-1">{t('confirm.progress.heading')}</h4>
      <ul className="space-y-2">
        {running.map((d) => {
          // OF ABOUT HOW MANY (0154 T2): the copies set against what discovery
          // found, by the rules in `progress-totals.ts`. With no count from
          // discovery the copies stand alone and say the total is not known,
          // never *"of 0"* (hard rule 9).
          const totals = progressTotals(d);
          const done = formatNumber(d.itemsSynced, locale);
          const count =
            totals.kind === 'ofAbout'
              ? t('confirm.progress.ofAbout', { done, total: formatNumber(totals.total, locale) })
              : totals.kind === 'noneFound'
                ? t('confirm.progress.noneFound')
                : t('confirm.progress.totalNotKnown', { done });
          const bytes = bytesOfAbout(d, locale);
          const rest: { key: string; className: string; text: string; title?: string }[] = [];
          if (d.itemsFailed > 0) {
            rest.push({
              key: 'failed',
              className: 'text-red-700',
              text: `${formatNumber(d.itemsFailed, locale)} ${t('confirm.progress.failed')}`,
            });
          }
          if (d.itemsRetrying > 0) {
            rest.push({
              key: 'retrying',
              className: 'text-amber-700',
              text: `${formatNumber(d.itemsRetrying, locale)} ${t('confirm.progress.retrying')}`,
            });
          }
          if (d.itemsAdopted !== undefined && d.itemsAdopted > 0) {
            // LEFT ALONE IS NOT COPIED, and until 0124 T2 the strip had no word
            // for it: everything else here is something that HAPPENED to an
            // item, and these are the ones hard rule 2 protected by doing
            // nothing. A migration that adopted four hundred contacts showed
            // four hundred fewer of everything and offered no explanation for
            // the gap.
            //
            // Grey: it is neither a problem nor something to act on. One
            // sentence for both kinds of adoption — already there, or changed
            // there since — because the ledger cannot tell them apart and this
            // must not pretend it can. What it means is on screen since 0154
            // T2; the longer reassurance stays in the title.
            rest.push({
              key: 'left',
              className: 'text-gray-600',
              text: t('confirm.progress.leftAsIs', { count: formatNumber(d.itemsAdopted, locale) }),
              title: t('confirm.progress.leftAsIs.why'),
            });
          }
          return (
            <li key={d.domain} className="text-sm text-gray-800 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium">{t(DOMAIN_KEY[d.domain])}</span>
              <StateChip entity="domain" state={d.state} />
              <span>
                {count}
                {bytes && (
                  <>
                    {' · '}
                    {t('confirm.progress.ofAbout', { done: bytes.done, total: bytes.total })}
                  </>
                )}
              </span>
              {d.lastSyncedAt && (
                // The as-of the payload always carried and the strip never
                // showed (0036 T1) — both editions serve it via
                // buildDomainStatusReports.
                <span className="text-gray-500">
                  {t('confirm.progress.lastSynced')} {relativeToNow(d.lastSyncedAt)}
                </span>
              )}
              {!d.lastSyncedAt && d.lastActiveAt && (
                // A FIRST COPY HAS NO COMPLETION YET, AND IS NOT NOTHING.
                //
                // Every time on this strip came from `completedAt`, so a copy
                // that runs for two days before it finishes anything showed no
                // time at all while the counter beside it climbed — a working
                // migration that reads as a dead one. Shown only until the first
                // completion, because after that "last synced" is the stronger
                // claim and two times would invite the reader to work out which
                // one matters.
                <span className="text-gray-500">
                  {t('confirm.progress.lastActive')} {relativeToNow(d.lastActiveAt)}
                </span>
              )}
              {totals.kind === 'ofAbout' && (
                // The share, as a bar in two parts: what was copied, then what
                // was left as it was, in the destination's colour, because those
                // are in the new system too. Never above 100%: the total grows
                // with what arrived. Its value is the line above, said in words.
                // A line of its own: a capped width on the bar itself would let
                // it sit beside a short first line.
                <div className="basis-full">
                  <div
                    role="progressbar"
                    aria-label={t(DOMAIN_KEY[d.domain])}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={wholePercent(totals.copiedShare)}
                    aria-valuetext={count}
                    className="flex h-2 w-full max-w-xs overflow-hidden rounded-full bg-gray-200"
                  >
                    <div className="bg-[#0E4F4A]" style={{ width: `${totals.copiedShare * 100}%` }} />
                    {totals.leftShare > 0 && (
                      <div className="bg-[#7FD4C1]" style={{ width: `${totals.leftShare * 100}%` }} />
                    )}
                  </div>
                </div>
              )}
              {rest.length > 0 && (
                // WHAT HAPPENED TO THE REST, on one line (0154 T2): failed,
                // retrying, and left as they are. One run of text, so it is
                // read as one line too.
                <span className="basis-full">
                  {rest.map((part, i) => (
                    <React.Fragment key={part.key}>
                      {i > 0 && ' · '}
                      <span className={part.className} title={part.title}>
                        {part.text}
                      </span>
                    </React.Fragment>
                  ))}
                </span>
              )}
              {d.state === 'stopped' && (
                // Stopped after copying: the count beside the chip is how many
                // copies stay, and this says they no longer follow. Whose stop
                // it is decides the way back: Resume on the migration's page for
                // one its owner stopped (0128 T4), the file for one it switched
                // off (0125 T7).
                <Hint
                  className="basis-full"
                  tone="note"
                  text={t(d.stoppedByOwner ? 'confirm.progress.stoppedByYou' : 'confirm.progress.stopped')}
                  why={t(
                    d.stoppedByOwner ? 'confirm.progress.stoppedByYou.why' : 'confirm.progress.stopped.why',
                  )}
                />
              )}
              {d.pausedReason && (
                // Stopped on purpose, and why. Its own line rather than a chip:
                // the reason is the whole point, and a word alone would send
                // somebody looking for the rest of it.
                <PausedBecause reason={d.pausedReason} />
              )}
              {d.lastErrorCategory && (
                // The way OUT, first: a sentence the person whose migration
                // stopped can act on without contacting anybody (0110 T3).
                <span className="basis-full text-xs text-red-900">
                  {t(FAILURE_KEY[d.lastErrorCategory])}
                  {/* And the side, when the pass could tell (0094 T5, second
                      slice): "reconnect it" then points at the right account. */}
                  {d.failedSide && <> {t(FAILURE_SIDE_KEY[d.failedSide])}</>}
                  {/* And the way out that `unknown` promises: the report form,
                      with this failure's reference in it (0130 T3). */}
                  {d.lastErrorCategory === 'unknown' && (
                    <>
                      {' '}
                      <SendItToUs
                        category={d.lastErrorCategory}
                        {...(d.lastErrorReference ? { reference: d.lastErrorReference } : {})}
                        dataType={d.domain}
                        {...(d.failedSide ? { side: d.failedSide } : {})}
                      />
                    </>
                  )}
                </span>
              )}
              {d.lastError && (
                // Verbatim (the prose boundary): this is the line the operator
                // acts on, and a paraphrase is a different claim. It stays,
                // under the sentence above rather than instead of it — the
                // category is coarse and actionable, this is precise.
                <span className="basis-full font-mono text-xs text-red-800">{d.lastError}</span>
              )}
              {d.lastErrorReference && (
                // What somebody quotes (0129 T1): the reference the failure was
                // recorded under, which finds the operator's log row and the
                // server's line with the whole message.
                <span className="basis-full text-xs text-gray-600">
                  {t('failure.reference', { reference: d.lastErrorReference })}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default LiveProgress;
