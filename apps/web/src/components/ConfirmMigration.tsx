// Copyright 2026 The Ownpace authors (Apache-2.0)

import React from 'react';
import DiscoveryCounts from './confirm/DiscoveryCounts.tsx';
import {
  RefusedNativeAcknowledgement,
  needsAcknowledgement,
} from './confirm/native-refusals.tsx';
import ScopeManifestPanel from './confirm/ScopeManifestPanel.tsx';
import { scopeFamilyOfConnectionKind, scopeManifestFor, timeBeforeStart, type DiscoveryDomain } from '@openmig/shared';
import { TimeBeforeStartLine } from './TimeBeforeStartLine.tsx';
import { CeilingAtStartNote, measuredBytes } from './CeilingAtStartNote.tsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mappingApi, scopeManifestApi, type DiscoveryResponse } from '../services/mapping-service.ts';
import { forgetMappingLifecycle } from '../services/mapping-cache.ts';
import { serverMessage } from '../services/api.ts';
import { fetchPlatformPause } from '../services/platform-service.ts';
import { useT } from '../i18n/index.tsx';

export interface ConfirmMigrationProps {
  readonly mappingId: string;
  /** Called after the migration is successfully started (green light given). */
  readonly onStarted: () => void;
}

/** How often to ask, and for how long before the screen stops asking. */
const POLL_MS = 2000;
/**
 * AFTER FIVE MINUTES, ASKED MORE SLOWLY (the owner, 2026-09-28: *"Hold, up to
 * 15 min"*). Five minutes was the ceiling itself, and a count that took seven
 * (the owner's Dropbox, 55,245 files) landed on a screen that had stopped
 * asking, while Start had already been pressed. The screen now keeps asking,
 * every ten seconds instead of every two.
 */
const SLOWER_AFTER_MS = 5 * 60 * 1000;
const SLOWER_POLL_MS = 10_000;
/**
 * FIFTEEN MINUTES, then stop asking and say so.
 *
 * Not a timeout on the work — discovery keeps running server-side and the
 * counts land in the database whenever they land. This is a ceiling on the
 * POLLING, because a tab left open on a stuck domain would otherwise ask
 * for ever. When it is reached the rows that arrived stay on screen and the
 * sentence under them gets longer; nothing is discarded and nothing is
 * called a failure. It is also as long as Start waits for the count
 * (`stillCounting` below).
 */
const POLL_CEILING_MS = 15 * 60 * 1000;

/**
 * THE ROWS THAT ANSWER THE COUNT THIS SCREEN ASKED FOR (workplan 0150 T3 (d),
 * D5).
 *
 * The preflight keeps one row per data type and overwrites it (`upsertDiscovery`),
 * so a migration opened here again, *Review and start* on a paused one, still
 * holds the rows of its last count. The screen took them as the answer to the
 * count it had just started: every data type it waited for had a row, so it
 * stopped asking at once. After a change they answer another question. A
 * Dropbox migration whose owner had just chosen Markdown for its Paper docs
 * was shown the count taken before, Paper docs that *will not be copied* and
 * a tick-box for them, while the count under Markdown landed a minute later on
 * a screen that no longer asked.
 *
 * Every change a person makes moves the migration's `updatedAt` (the update
 * door stamps it, the status changes do too), and the preflight's key holds
 * it (`discoveryTriggerOptions`), so a change always starts a new count. A row
 * whose counts were taken before that moment is waited for, not shown. Nothing
 * the worker does moves `updatedAt`, so the count this screen started always
 * lands after it.
 *
 * A row with an error is shown whatever its age, as before: an error is a
 * final answer, and `recordDiscoveryError` keeps the time of the counts beside
 * it rather than of the error, so its age says nothing about the error.
 * Without the migration's time, every row is shown, as it was.
 */
export function countedSinceChange<
  T extends { readonly discoveredAt: string; readonly lastError?: string; readonly lastErrorWithheld?: true },
>(domains: ReadonlyArray<T>, changedAt: string | undefined): T[] {
  const since = changedAt === undefined ? NaN : Date.parse(changedAt);
  if (Number.isNaN(since)) return [...domains];
  // A withheld error is an error all the same (ADR-0035 decision 5).
  return domains.filter(
    (d) => d.lastError !== undefined || d.lastErrorWithheld === true || Date.parse(d.discoveredAt) >= since,
  );
}

/** One migration's count, as a green light reads it (`useMigrationCount`). */
export interface MigrationCount {
  /** The rows that answer the count this screen asked for (`countedSinceChange`). */
  readonly domains: ReadonlyArray<DiscoveryResponse['domains'][number]>;
  /** The data types the migration carries: what the count waits for. Undefined until the migration answers. */
  readonly expected: ReadonlyArray<DiscoveryDomain> | undefined;
  /** The source's connection kind, as the detail route answers it: whose manifest rows are true. */
  readonly sourceKind: string | undefined;
  /** The server's words for a refused count; null while nothing was refused. */
  readonly countRefused: string | null;
  /** Whether the operator holds the platform, read only while a count stands refused. */
  readonly held: boolean | undefined;
  /** The polling stopped at its ceiling. */
  readonly gaveUp: boolean;
  /** A count this screen waits for is still coming: Start waits too. */
  readonly stillCounting: boolean;
  /** The polling stopped before every count landed. */
  readonly countUnfinished: boolean;
}

/**
 * THE COUNT BEHIND A GREEN LIGHT (workplan 0013 T6). Kicks off read-only
 * discovery for one migration and polls the per-domain counts until every
 * data type it carries has answered. The confirm screen below holds one;
 * *Start a migration* holds one per migration it made, under one Start
 * (0153 T4).
 *
 * ## Polling stopped at the FIRST domain, not the last (2026-09-07)
 *
 * `discovered` is true as soon as ONE row exists — the route computes it as
 * `domains.length > 0`. So the poll ran until the quickest domain answered
 * and then stopped, with however many were still being counted left
 * permanently absent. The owner's four-domain migration settled on a
 * three-row table and stayed there; he found the fourth by reloading the page
 * himself.
 *
 * The right question is not "has anything landed" but "has everything this
 * migration carries landed", and only the mapping knows what it carries —
 * hence the second query. That list is the same `scope_selection` the
 * preflight job now counts (`resolveDiscoveryJob`), so the screen waits for
 * exactly the rows that are coming: no fourth row expected on a three-domain
 * migration, and no waiting for mail on one that carries none.
 *
 * A domain that answered with an error counts as landed. `lastError` is a
 * final answer and it is already shown in its row; treating it as unfinished
 * would spin for ever on the one thing that had definitely stopped.
 *
 * ## A count from before the last change is not an answer (2026-09-28)
 *
 * See `countedSinceChange`.
 */
export function useMigrationCount(mappingId: string): MigrationCount {
  const queryClient = useQueryClient();
  const startedAt = React.useRef(Date.now());
  const [gaveUp, setGaveUp] = React.useState(false);

  // Kick off discovery on mount, and keep the answer when it is a no.
  //
  // THE REFUSAL IS SHOWN (0132 T6 (b)). While the operator holds the platform
  // the door answers 409 with the operator's sentence, as every door does, and
  // a refused press is not remembered: nothing is counting. This screen threw
  // that answer away and went on saying it was scanning. The sentence goes
  // through `serverMessage`, as the refused Start below does, so any other
  // refusal (a migration not found, a server fault) says its own words too.
  const [countRefused, setCountRefused] = React.useState<string | null>(null);
  const [countAsked, setCountAsked] = React.useState(0);
  const sawHold = React.useRef(false);
  React.useEffect(() => {
    let current = true;
    setCountRefused(null);
    sawHold.current = false;
    mappingApi.discover(mappingId).catch((error: unknown) => {
      if (current) setCountRefused(serverMessage(error));
    });
    return () => {
      current = false;
    };
  }, [mappingId, countAsked]);

  // AND ASKED AGAIN WHEN THE HOLD LIFTS. The operator's sentence says to try
  // again after, and on this screen there is nothing to press: the count has
  // no button, and *Start* with no rows landed skips the refused-files tick
  // (`needsAcknowledgement([])` is false). So while a count stands refused the
  // screen reads the hold the banner reads (same key, same cache), and when a
  // hold it saw open is lifted it counts again, with the polling's five
  // minutes started afresh. Only a hold it SAW is waited on: a refusal for
  // any other reason, with no hold open, is not asked again in a loop.
  const hold = useQuery({
    queryKey: ['platform-pause'],
    queryFn: fetchPlatformPause,
    retry: false,
    refetchInterval: 60_000,
    enabled: countRefused !== null,
  });
  const held = countRefused === null ? undefined : hold.data?.held;
  React.useEffect(() => {
    if (held === true) {
      sawHold.current = true;
    } else if (held === false && sawHold.current) {
      sawHold.current = false;
      startedAt.current = Date.now();
      setGaveUp(false);
      setCountAsked((n) => n + 1);
      void queryClient.invalidateQueries({ queryKey: ['discovery', mappingId] });
    }
  }, [held, mappingId, queryClient]);

  // WHAT TO WAIT FOR. Read from the mapping rather than assumed, for the same
  // reason the job reads scope_selection rather than defaulting: assuming all
  // five would leave "still counting: Email" under a migration that carries
  // no mail, waiting for a row that is never coming.
  const mapping = useQuery({
    queryKey: ['mapping', mappingId],
    queryFn: () => mappingApi.get(mappingId),
    // Read afresh, not from `App.tsx`'s five minutes: its `updatedAt` decides
    // which counts answer this screen (`countedSinceChange`).
    staleTime: 0,
  });
  const expected = mapping.data?.syncConfig.domains;
  const changedAt = mapping.data?.updatedAt;

  const discovery = useQuery({
    queryKey: ['discovery', mappingId],
    queryFn: () => mappingApi.getDiscovery(mappingId),
    refetchInterval: (query) => {
      const waited = Date.now() - startedAt.current;
      if (waited > POLL_CEILING_MS) {
        // Rendering during another component's render is what React forbids;
        // this runs from the query client's own timer, well after.
        setGaveUp(true);
        return false;
      }
      const every = waited > SLOWER_AFTER_MS ? SLOWER_POLL_MS : POLL_MS;
      // Until the mapping answers we do not know what to wait for, so keep
      // asking — stopping here would be the old bug with a new cause.
      if (!expected) return every;
      const landed = new Set(
        countedSinceChange(query.state.data?.domains ?? [], changedAt).map((d) => d.domain),
      );
      return expected.every((d) => landed.has(d)) ? false : every;
    },
  });

  const domains = countedSinceChange(discovery.data?.domains ?? [], changedAt);

  /**
   * START WAITS FOR THE COUNT, FIFTEEN MINUTES AT MOST (the owner, 2026-09-28:
   * *"Hold, up to 15 min"*).
   *
   * The count is what this screen exists to show: the files a format would
   * refuse, with their tick-box, and the numbers a person decides on. Start
   * did not wait for it. The owner pressed it at 17:23, and the Dropbox count,
   * with the Paper line and its tick-box, landed at 17:30, on a migration
   * already copying.
   *
   * So Start stays greyed out while a count this screen is waiting for is
   * still coming, with a line saying so. Not while nothing is counting: a
   * refused count leaves it as it was. Not for ever either: after fifteen
   * minutes, when the screen stops asking, Start opens with a line saying the
   * count did not finish. Until the migration answers, the screen cannot know
   * what to wait for, so it waits; if the migration cannot be read at all,
   * it does not.
   */
  const everyCountLanded =
    expected !== undefined && expected.every((d) => domains.some((row) => row.domain === d));
  const stillCounting =
    countRefused === null && !gaveUp && (expected !== undefined ? !everyCountLanded : mapping.isPending);
  const countUnfinished = countRefused === null && gaveUp && !everyCountLanded;
  return {
    domains,
    expected,
    sourceKind: mapping.data?.sourceType,
    countRefused,
    held,
    gaveUp,
    stillCounting,
    countUnfinished,
  };
}

/**
 * One migration's part of a green light: its counts, a refused count's
 * reason, and the tick for files a format would refuse, beside the count it
 * acknowledges. The confirm screen draws one; *Start a migration* one per
 * migration, each with its own heading and its own tick-box.
 */
export function MigrationCountSection({
  count,
  acked,
  onAcked,
  heading,
  ackId,
}: {
  readonly count: MigrationCount;
  readonly acked: boolean;
  readonly onAcked: (next: boolean) => void;
  /** What the section is called; the confirm screen's own words when left out. */
  readonly heading?: string;
  /** Distinguishes the tick-boxes where a page draws one per migration. */
  readonly ackId?: string;
}): React.ReactElement {
  const t = useT();
  const countsHeadingId = React.useId();
  const { domains, expected, countRefused, held, gaveUp } = count;
  return (
    <section aria-labelledby={countsHeadingId}>
      <h3 id={countsHeadingId} className="text-sm font-medium text-gray-700 mb-2">{heading ?? t('confirm.foundInSource')}</h3>
      {/* With nothing landed, the counts say *Scanning your source*, which a
          refused count makes untrue. A count begun a moment before the hold
          still lands (the door refused the join, not the count), so rows
          that arrive are shown with the refusal under them. */}
      {(countRefused === null || domains.length > 0) && (
        <DiscoveryCounts domains={domains} expected={expected} slow={gaveUp} />
      )}
      {/* HOW LONG (0154 T3 (a)), once everything the migration carries is
          counted: Gmail's mail by its published ceiling, anything else said
          not to be known yet. Never while counting, when a Gmail mailbox's
          size is not in yet and the line would say the other thing. */}
      {expected !== undefined && !count.stillCounting && countRefused === null && (
        <TimeBeforeStartLine
          className="mt-2 text-sm text-gray-700"
          time={timeBeforeStart({
            source: count.sourceKind,
            domains: expected,
            mailBytes: domains.find((d) => d.domain === 'email' && d.lastError === undefined)?.bytes,
          })}
        />
      )}
      {countRefused !== null && (
        <p className="text-sm text-red-600" role="alert">
          {t('confirm.countError')} {countRefused}
          {held === true && <> {t('confirm.countAgain')}</>}
        </p>
      )}
      {/* Beside the count it acknowledges, not in a dialog after the press:
          the thing being confirmed is a number on this screen. */}
      <RefusedNativeAcknowledgement
        domains={domains}
        checked={acked}
        onChange={onAcked}
        {...(ackId === undefined ? {} : { id: ackId })}
      />
    </section>
  );
}

/**
 * Pre-sync confirm screen (workplan 0013 T6): one migration's count
 * (`useMigrationCount`), shown next to the §11.2 scope manifest, and the
 * "Start migration" green light that activates the (paused) mapping.
 */
export function ConfirmMigration({ mappingId, onStarted }: ConfirmMigrationProps): React.ReactElement {
  const t = useT();
  const queryClient = useQueryClient();
  const count = useMigrationCount(mappingId);
  const { domains, stillCounting, countUnfinished } = count;
  const [refusedAcked, setRefusedAcked] = React.useState(false);

  const manifest = useQuery({
    queryKey: ['scope-manifest'],
    queryFn: () => scopeManifestApi.get(),
  });

  // WHOSE PROMISES TO SHOW. The manifest is one public document and the server
  // serves all of it; which rows are TRUE here depends on what this migration
  // is leaving, and this screen already knows — it reads the mapping above for
  // `syncConfig.domains`. Until 2026-09-22 it showed every row to everybody,
  // so a Google migration was confirmed under a list naming SharePoint, Teams
  // and Planner and mentioning Drive nowhere.
  //
  // An unrecognised source narrows to the rows true of every source rather
  // than falling back to a provider: the lookup returns undefined and the
  // filter is given nothing, which under-tells instead of mis-telling.
  //
  // THE KIND, NOT THE TYPE (workplan 0153 T1 (a)). The detail route answers
  // `sourceType` with the source CONNECTION KIND (`google_drive`, `o365`),
  // not the mapping file's type (`google-drive`) that `scopeFamilyOf` reads
  // on the appliance's own page. Asked in the wrong vocabulary, a Drive
  // migration had no family and was shown every provider's rows.
  const family = scopeFamilyOfConnectionKind(count.sourceKind ?? '');
  const scoped =
    manifest.data && scopeManifestFor(manifest.data, family ? [family] : []);

  const startMutation = useMutation({
    mutationFn: () => mappingApi.start(mappingId),
    /**
     * THE CACHE GOES BEFORE THE NAVIGATION (owner, 2026-09-17).
     *
     * Pressing this makes the migration `active`, and until today it told
     * nothing: the migration's own page kept answering `paused` from the copy
     * it had fetched before the press — for five minutes, by `App.tsx`'s
     * `staleTime` — with *Review and start* beside it. The list, fetched
     * after the navigation, said `active`. Two answers, and the stale one
     * offered to start a migration that was already running.
     *
     * Awaited, so the page the navigation lands on reads the server rather
     * than the cache it is about to be handed.
     */
    onSuccess: async () => {
      await forgetMappingLifecycle(queryClient, mappingId);
      onStarted();
    },
  });

  const startWaitsId = React.useId();

  return (
    <div className="space-y-6">
      <div>
        {/* Localized 2026-08-09: this wizard step shipped with hardcoded
            English through 0024, unrecorded -- the recorded T5 debt names
            Dashboard/Mappings only. Keys are shared with the appliance's
            Confirm page, so the two editions' prose cannot drift. The
            "nothing has been copied yet" sentence is CORRECT here, unlike on
            the appliance page: this step only exists before the start. */}
        <h2 className="text-lg font-semibold text-gray-900">{t('confirm.title')}</h2>
        <p className="text-sm text-gray-600">{t('confirm.intro')}</p>
      </div>

      {/* Discovery counts — shared with the appliance's confirm screen. */}
      <MigrationCountSection count={count} acked={refusedAcked} onAcked={setRefusedAcked} />

      {/* Scope manifest (§11.2) */}
      {scoped && <ScopeManifestPanel manifest={scoped} />}
      {/* "I could not read it" is not "there is nothing to say" (hard rule 9).
          Without this line a manifest that failed to load, or failed to parse,
          left the screen where somebody decides whether to start with no
          "does not migrate" list and no sign that one was missing. */}
      {manifest.isError && (
        <p className="text-sm text-red-600" role="alert">
          {t('confirm.manifestError')} {serverMessage(manifest.error)}
        </p>
      )}

      {/* The server's sentence, not the transport's: a refused Start (an
          operator hold, 0132 T6 (b), or a grant still awaited or withdrawn)
          carries its reason in the body. */}
      {startMutation.isError && (
        <p className="text-sm text-red-600" role="alert">
          {t('confirm.startError')}{' '}
          {startMutation.error instanceof Error
            ? serverMessage(startMutation.error)
            : t('confirm.startErrorFallback')}
        </p>
      )}

      {/* Beside Start, so the greyed-out button says why, and when it opens
          without the count, that it did. See `stillCounting`. */}
      {stillCounting && (
        <p id={startWaitsId} className="text-right text-sm text-gray-500">
          {t('confirm.startWaits')}
        </p>
      )}
      {countUnfinished && (
        <p className="text-right text-sm text-amber-700" role="note">
          {t('confirm.countUnfinished')}
        </p>
      )}

      {/* The data ceiling, before the press (0109 T6): a note, never a block. */}
      {!stillCounting && <CeilingAtStartNote bytes={measuredBytes(domains)} />}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => startMutation.mutate()}
          // NOT A BLOCK — a tick-box one line up, and only when something is
          // actually refused. A migration with nothing to warn about starts
          // exactly as it did. The count, while it is coming, is the other
          // wait: fifteen minutes at most.
          disabled={startMutation.isPending || stillCounting || (needsAcknowledgement(domains) && !refusedAcked)}
          aria-describedby={stillCounting ? startWaitsId : undefined}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {startMutation.isPending ? t('confirm.starting') : t('confirm.start')}
        </button>
      </div>
    </div>
  );
}

export default ConfirmMigration;
