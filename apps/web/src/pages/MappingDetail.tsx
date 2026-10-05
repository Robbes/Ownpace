// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * One migration's hub (workplan 0019 T4).
 *
 * Every per-mapping operating screen existed and was URL-reachable ONLY — a
 * managed operator could not reach the decision queues without typing an
 * address, which made §11.2's "the owner stays in control" a claim about
 * routes rather than about people. This page is the navigation: the queues,
 * the check, and the finish checklist for THIS mapping, in the runbook's
 * cutover order.
 *
 * The links are the deliverable and must not depend on anything loading —
 * the detail card above them is best-effort (managed has a mapping API; a
 * failure to read it degrades to the links, never to a dead end).
 *
 * THE STEPS, AS ONE LIST (workplan 0154 T4): the seven in cutover order, each
 * with its count, its state in words and what it is, as a person's page draws
 * them (`CutoverSteps`). The queues are counted by the read the queue pages
 * share, the check is what the progress read says it last did, and Finish
 * and Sharing rest on the migration's lifecycle. A count that could not be
 * read says so; one still being read says nothing.
 */

import React from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause } from 'lucide-react';
import { isSelfHost } from '../services/edition.ts';

// The strip's refresh rule, shared with a person's lines (0154 T1 (b)).
export { progressRefetchInterval, PROGRESS_POLL_ACTIVE_MS, PROGRESS_POLL_IDLE_MS } from '../services/progress-poll.ts';
import { progressRefetchInterval } from '../services/progress-poll.ts';
import { mappingApi } from '../services/mapping-service.ts';
import { forgetMappingLifecycle } from '../services/mapping-cache.ts';
import { fetchAllDiscovery, fetchAttention, fetchRuns, fetchStatus } from '../services/operating-service.ts';
import { fetchProgress } from '../services/progress-service.ts';
import { checksOf } from '../services/cutover-steps.ts';
import { linesProgressOf } from '../services/stage-line.ts';
import { useT, useFormatters } from '../i18n/index.tsx';
import RunsPanel from '../components/RunsPanel.tsx';
import MappingLinksPanel from '../components/MappingLinksPanel.tsx';
import ExportPolicyPanel from '../components/ExportPolicyPanel.tsx';
import { RenameMigration } from '../components/RenameMigration.tsx';
import SchedulePanel from '../components/SchedulePanel.tsx';
import MigrationKindsPanel from '../components/MigrationKindsPanel.tsx';
import CompletionReportDownload from '../components/CompletionReportDownload.tsx';
import LiveProgress from '../components/LiveProgress.tsx';
import { lineStages, stagesByDomain } from '../components/MigrationLines.tsx';
import StateChip from '../components/StateChip.tsx';
import { connectionKindName } from '../components/ProviderTile.tsx';
import { CutoverSteps } from '../components/CutoverSteps.tsx';
import { TimeBeforeStartLine } from '../components/TimeBeforeStartLine.tsx';
import { TimeWhileCopyingLine } from '../components/TimeWhileCopyingLine.tsx';
import { PaceLine } from '../components/PaceLine.tsx';
import { leastAdvancedStage, remainingItemsOf, timeBeforeStart, timeWhileCopying } from '@openmig/shared';
import { providerName } from '../components/ProviderTile.tsx';
import { serverMessage } from '../services/api.ts';

/**
 * ONE SIDE OF THE LINE: the connection's name, AND THE ACCOUNT IT SIGNS IN AS
 * (owner, 2026-09-17).
 *
 * *"in the migration overview or 'Migration Details' view ... it doesnt list
 * the username within the source and username within target ... please that
 * those in this overview."*
 *
 * The name is what somebody typed and can be anything — "G to Sov", "test",
 * the default. The address is the fact: which mailbox is being read, which
 * account is being written to. It was already on the wire (the detail route
 * returns it beside a masked password) and no screen printed it.
 *
 * Falls back exactly as the line did before: the connection's name if there is
 * one, the provider kind if there is not, and no parenthesis at all when the
 * account is unknown — an empty `()` would read as a connection with no
 * account rather than as a page that could not say.
 */
function sideLabel(name: string | null | undefined, kind: string, account: string | undefined): string {
  const known = account !== undefined && account !== '';
  // A NAME MADE FROM WHAT IT CONNECTS TO says nothing the provider and the
  // address do not (0154 T6): the wizard named an account it was not given a
  // name for `gmail · anna@gmail.com`, and the line read *From gmail ·
  // anna@gmail.com (anna@gmail.com)*. Such a name, or none, is the provider
  // card's own: *From Gmail (anna@gmail.com)*. A name somebody chose stays.
  const provider = connectionKindName(kind) ?? kind;
  const made = name == null || name === kind || name === provider || (known && name.includes(account));
  const head = made ? provider : name;
  return known ? `${head} (${account})` : head;
}

/** The source kinds whose files start from a folder, by the key they keep it under. */
const FOLDER_KEY_OF_KIND: Readonly<Record<string, 'rootFolderId' | 'rootPath'>> = {
  google: 'rootFolderId',
  google_drive: 'rootFolderId',
  box: 'rootFolderId',
  dropbox: 'rootPath',
};

/**
 * WHERE A MIGRATION'S FILES START (0153 open question 5, item 4): one folder,
 * chosen under *Only one folder* on *Start a migration*, or all of the
 * account. Undefined where the migration moves no files, or reads them from a
 * source that has no folder to start from. A Google folder is named by its id,
 * which is all the migration holds.
 */
export function filesFromLine(
  t: ReturnType<typeof useT>,
  m: {
    readonly sourceConnection?: { readonly kind: string } | null | undefined;
    readonly sourceConfig: { readonly rootFolderId?: string | undefined; readonly rootPath?: string | undefined };
    readonly syncConfig: { readonly domains: ReadonlyArray<string> };
  },
): string | undefined {
  const kind = m.sourceConnection?.kind;
  const key = kind === undefined ? undefined : FOLDER_KEY_OF_KIND[kind];
  if (key === undefined || !m.syncConfig.domains.includes('file')) return undefined;
  const folder = m.sourceConfig[key];
  if (folder) return t(key === 'rootPath' ? 'hub.filesFrom.path' : 'hub.filesFrom.id', { folder });
  const place = kind === 'google' || kind === 'google_drive' ? t('start.place.myDrive') : (connectionKindName(kind!) ?? kind!);
  return t('hub.filesFrom.all', { place });
}

/**
 * The latest pass any of its data types completed: what the list carries as a
 * migration's last pass, and what a person's card reads before the progress
 * read has it (`listStage`).
 */
function latestPass(rows: readonly { readonly lastSyncedAt?: string }[] | undefined): string | undefined {
  let latest: string | undefined;
  for (const d of rows ?? []) {
    if (d.lastSyncedAt && (latest === undefined || d.lastSyncedAt > latest)) latest = d.lastSyncedAt;
  }
  return latest;
}

const MappingDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { dateTime } = useFormatters();

  // A VISIT BRINGS BACK THE HOUR (workplan 0157 T7): a migration with no
  // schedule of its own looks every hour again for 14 days once somebody opens
  // it. Sent as the page opens; the server moves it at most once an hour.
  // Managed only, as the schedule is. A visit that is not recorded changes
  // nothing on this page, and the server logs its own faults, so its answer
  // is not waited for and a failure is not shown.
  React.useEffect(() => {
    if (!id || isSelfHost()) return;
    mappingApi.recordVisit(id).catch(() => undefined);
  }, [id]);

  // Best-effort context; managed-only (the appliance has no mapping API and
  // its operators reach the queues from the top-level nav anyway).
  const detail = useQuery({
    queryKey: ['mapping', id],
    queryFn: () => mappingApi.get(id!),
    enabled: Boolean(id) && !isSelfHost(),
    retry: false,
    // MANAGED'S HALF OF THE STRIP HAD NO INTERVAL AT ALL, so the panel headed
    // "Live progress" sat on the number it was born with until somebody
    // pressed F5. Live 2026-09-22, on a running Google migration: "Calendar
    // Syncing 439 synced, last active 1 minute ago", unmoved. The selfhost
    // half below polled, which is why this survived — the strip is one
    // component and it was live on the edition its author was looking at.
    refetchInterval: (query) => progressRefetchInterval(query.state.data?.domainStatus),
  });

  // Pause, from the page the operator is actually looking at when a
  // migration misbehaves (live 2026-09-11: a looping migration, and the
  // only stop was `docker stop` on the worker). Same call as the list row.
  const queryClient = useQueryClient();
  const [pauseFailed, setPauseFailed] = React.useState<string | null>(null);
  const [pausing, setPausing] = React.useState(false);
  const pause = async () => {
    if (!id) return;
    setPausing(true);
    setPauseFailed(null);
    try {
      await mappingApi.pause(id);
      // Both screens, from one place (2026-09-17). This page had it right and
      // the other two lifecycle writes did not, which is why it is a helper
      // now rather than a habit.
      await forgetMappingLifecycle(queryClient, id);
    } catch (err) {
      setPauseFailed(serverMessage(err));
    } finally {
      setPausing(false);
    }
  };

  // The live per-domain strip (0033 T5): one component, two data sources.
  // Selfhost reads the appliance-wide /status and filters to this mapping;
  // managed reads it off the detail payload above. Both are
  // DomainStatusReport rows built by the same shared function, so the strip
  // cannot mean different things per edition.
  const status = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    enabled: Boolean(id) && isSelfHost(),
    // The same rule as managed above, from the same function: a strip that
    // cannot mean different things per edition must not REFRESH differently
    // per edition either. This was a flat 30s, which is the idle rate — a
    // running migration now moves at the same ten seconds on both.
    refetchInterval: (query) =>
      progressRefetchInterval(query.state.data?.mappings.find((m) => m.mappingId === id)?.domains),
  });

  // The steps' counts (0154 T4): the queues from the read the queue pages and
  // the menu share, and the check from the progress read a person's lines
  // read, under the same keys, so the three pages agree and share a refresh.
  const attentionQuery = useQuery({ queryKey: ['attention'], queryFn: fetchAttention, enabled: Boolean(id) });
  const progressQuery = useQuery({
    queryKey: ['progress'],
    queryFn: fetchProgress,
    enabled: Boolean(id),
    refetchInterval: (query) => progressRefetchInterval(query.state.data?.mappings.flatMap((m) => m.domains)),
  });

  // HOW LONG, UNTIL THE FIRST PASS REPORTS (0154 T3 (a)): from the count, as
  // the review screen said it. Read once the migration's own read has said no
  // pass completed, and not after, when the pass's own rate is the better
  // answer (T3 (b)).
  const firstPassIn = (
    (isSelfHost()
      ? status.data?.mappings.find((m) => m.mappingId === id)?.domains
      : detail.data?.domainStatus) ?? []
  ).some((d) => d.lastSyncedAt !== undefined);
  const mappingDiscovery = useQuery({
    queryKey: ['mapping-discovery', id],
    queryFn: () => mappingApi.getDiscovery(id!),
    enabled: Boolean(id) && !isSelfHost() && detail.isSuccess && !firstPassIn,
    retry: false,
  });
  const allDiscovery = useQuery({
    queryKey: ['discovery'],
    queryFn: fetchAllDiscovery,
    enabled: Boolean(id) && isSelfHost() && status.isSuccess && !firstPassIn,
    retry: false,
  });

  // HOW LONG, DURING THE COPY (0154 T3 (b)): from the last passes' own pace,
  // once a pass has reported. The run history's own query, so the panel below
  // and this line share one read.
  const runs = useQuery({
    queryKey: ['runs', id],
    queryFn: () => fetchRuns(id!),
    enabled: Boolean(id) && firstPassIn,
    refetchInterval: 30_000,
  });

  if (!id) {
    return <p className="text-sm text-amber-800">{t('hub.noId')}</p>;
  }

  const progressDomains = isSelfHost()
    ? status.data?.mappings.find((m) => m.mappingId === id)?.domains
    : detail.data?.domainStatus;
  // Where this migration is in its life, for the steps that rest on it: the
  // detail read on managed, the status on the appliance.
  const lifecycleRead = isSelfHost() ? status : detail;
  const counted = isSelfHost() ? allDiscovery.data?.[id] : mappingDiscovery.data?.domains;
  const timeBefore =
    firstPassIn || counted === undefined || counted.length === 0
      ? undefined
      : timeBeforeStart({
          source: isSelfHost() ? status.data?.mappings.find((m) => m.mappingId === id)?.sourceType : detail.data?.sourceType,
          ...(detail.data?.sourceConfig.host ? { sourceHost: detail.data.sourceConfig.host } : {}),
          domains: isSelfHost() ? counted.map((d) => d.domain) : (detail.data?.syncConfig.domains ?? []),
          mailBytes: counted.find((d) => d.domain === 'email' && d.lastError === undefined)?.bytes,
        });
  // What is left, and whether the provider slowed it: from the strip's rows,
  // the totals T2 set each count against. A data type with no total leaves it
  // unknown, and the line says nothing (hard rule 9).
  const sourceType = isSelfHost()
    ? status.data?.mappings.find((m) => m.mappingId === id)?.sourceType
    : detail.data?.sourceType;
  const copyingRows = (progressDomains ?? []).filter((d) => d.state !== 'skipped');
  const timeWhile =
    firstPassIn && runs.data
      ? timeWhileCopying({
          remainingItems: remainingItemsOf(copyingRows),
          passes: runs.data.runs,
          slowed: copyingRows.some((d) => d.lastErrorCategory === 'rate_limited'),
        })
      : undefined;
  const lifecycle = isSelfHost()
    ? status.data?.mappings.find((m) => m.mappingId === id)?.migrationStatus
    : detail.data?.status;
  // WHERE IT IS, IN A PERSON'S WORDS (0154 T1, the migration's own page): what
  // a person's card says of this migration, from the same facts and the same
  // functions (`MigrationLines.tsx`). Its data types are the card's: its
  // selection on managed, as the list carries it, and the status's rows on the
  // appliance, as its person's page reads them. Once the progress read has this
  // migration, each row of the strip says its own stage, and the header the
  // least advanced; before, the header says what the card says then.
  const lineFacts =
    lifecycle === undefined
      ? undefined
      : {
          status: lifecycle,
          domains: isSelfHost() ? (progressDomains ?? []).map((d) => d.domain) : (detail.data?.syncConfig.domains ?? []),
          lastSyncAt: latestPass(progressDomains),
        };
  const lines = linesProgressOf(
    progressQuery.data,
    id,
    attentionQuery.data?.mappings.find((a) => a.mappingId === id),
    attentionQuery.isSuccess,
  );
  const stages = lineFacts && lines ? stagesByDomain(lineFacts, lines) : {};
  const migrationStage = lineFacts ? leastAdvancedStage(lineStages(lineFacts, lines)) : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {/* *Rename* beside the title (0153 open question 5, item 4), where the
            detail read is in: managed only, as the appliance's names are its
            mapping files'. */}
        <RenameMigration
          mappingId={id}
          name={detail.data?.name}
          fallback={t('hub.fallbackTitle')}
          editable={Boolean(detail.data) && !isSelfHost()}
        />
        <div className="ml-auto flex items-center gap-3">
          {/* Active only (0128). A migration in the continuous lane is
              after its cutover, and no update brings it back before one: the
              pause it offered was refused every time it was pressed. The lane
              is ended on the Finish page. */}
          {detail.data?.status === 'active' && (
            <button
              onClick={() => void pause()}
              disabled={pausing}
              className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium rounded border border-amber-300 text-amber-800 hover:bg-amber-50 disabled:opacity-50"
              title={t('mappings.action.pause.why')}
            >
              <Pause className="w-4 h-4" />
              {t('mappings.action.pause')}
            </button>
          )}
          {detail.data?.status === 'paused' && id && (
            <Link
              to={`/mappings/${encodeURIComponent(id)}/confirm`}
              className="text-sm font-medium text-green-700 hover:underline"
            >
              {t('mappings.action.reviewAndStart')}
            </Link>
          )}
          {migrationStage ? (
            <StateChip entity="stage" state={migrationStage} />
          ) : (
            detail.data?.status && <StateChip entity="lifecycle" state={detail.data.status} />
          )}
        </div>
      </div>
      {pauseFailed && <p className="mt-1 text-sm text-red-700">{pauseFailed}</p>}
      {/* WHICH accounts, by name — the mapping's own, not the tenant's first
          (the API read the wrong ones until 2026-09-11). A migration named
          "G to Sov" that is in fact wired to the Nextcloud target is a fact
          this line makes readable without a database. */}
      {detail.data && (detail.data.sourceConnection || detail.data.targetConnection) && (
        <p className="mt-1 text-sm text-gray-600">
          {t('hub.connections', {
            source: sideLabel(
              detail.data.sourceConnection?.name,
              detail.data.sourceType,
              detail.data.sourceConfig.username,
            ),
            target: sideLabel(
              detail.data.targetConnection?.name,
              detail.data.targetType,
              detail.data.targetConfig.username,
            ),
          })}
        </p>
      )}
      {/* WHERE THE COPIES LAND (0153 open question 5, item 4): the folder
          chosen as *Put it in a folder of its own*, or the destination's own
          folders. Said, never offered for change: once anything is copied, a
          move would leave the copies behind. Only where the read says. */}
      {detail.data && detail.data.targetFolderPrefix !== undefined && (
        <p className="mt-1 text-sm text-gray-600">
          {detail.data.targetFolderPrefix
            ? t('hub.lands.folder', { folder: detail.data.targetFolderPrefix })
            : t('hub.lands.merged')}
        </p>
      )}
      {/* WHERE ITS FILES START (0153 open question 5, item 4), said the same
          way: once anything is copied, another folder would be another
          migration. */}
      {detail.data && filesFromLine(t, detail.data) !== undefined && (
        <p className="mt-1 text-sm text-gray-600">{filesFromLine(t, detail.data)}</p>
      )}
      {/* A GRANT THE PERSON TOOK BACK (workplan 0108 T8 (c)), said before
          anything that reads as progress: the status can still say Active,
          and nothing reads their account until they grant it again. The
          new link is the person's (ADR-0035, amended 2026-09-29): the links
          panel below points to their page, or asks who this is for. */}
      {detail.data?.grantWithdrawnAt && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>{t('hub.grantWithdrawn', { date: dateTime(detail.data.grantWithdrawnAt) })}</p>
          <p className="mt-1">{t('hub.grantWithdrawn.next')}</p>
        </div>
      )}
      {/* THE MIGRATION'S ID, folded under *Details* (0154 T6): it is for a
          support ticket, not for reading, and it sat under the title. */}
      <details className="mt-1 text-sm text-gray-500">
        <summary className="cursor-pointer select-none">{t('hub.details')}</summary>
        <p className="mt-1">
          {t('hub.migrationId')} <code className="font-mono select-all">{id}</code>
        </p>
      </details>
      {/* The completion report (workplan 0047): every number on it already
          lives on some screen below — this is the ONE document version, for
          handing over. Since 0154 T5 a page too, in the reader's language. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link to={`/mappings/${encodeURIComponent(id)}/report`} className="text-sm text-blue-700 hover:underline">
          {t('migrationReport.open')} →
        </Link>
        <CompletionReportDownload mappingId={id} />
      </div>
      {detail.error != null && (
        <p className="mt-1 text-sm text-amber-800">{t('hub.detailError')}</p>
      )}

      {progressDomains && progressDomains.length > 0 && (
        <div className="mt-4">
          <LiveProgress domains={progressDomains} stages={stages} />
        </div>
      )}

      {timeBefore && <TimeBeforeStartLine className="mt-4 text-sm text-gray-700" time={timeBefore} />}
      {timeWhile && (
        <TimeWhileCopyingLine
          className="mt-4 text-sm text-gray-700"
          time={timeWhile}
          provider={providerName(sourceType ?? '', 'source')}
        />
      )}
      {/* Free's pace, and this migration's next pass by it (0157 T5). */}
      <PaceLine
        className="mt-2 text-sm text-gray-700"
        leastMinutesBetweenPasses={detail.data?.pace?.leastMinutesBetweenPasses}
        nextPassAt={detail.data?.pace?.nextPassAt}
      />

      {/* The list IS a sequence (0034 T4), and since 0154 T4 one list with a
          person's page: each step with its count, its state in words, and
          what it is, in cutover order with its number. No wizard and no
          gating: the screens gate themselves (Finish refuses over open
          failures). The names link whatever loads. */}
      <section aria-labelledby="before-you-switch" className="mt-6">
        <h3 id="before-you-switch" className="text-base font-semibold text-gray-900">
          {t('person.steps.title')}
        </h3>
        <p className="mt-1 text-sm text-gray-600">{t('hub.orderIntro')}</p>
        <CutoverSteps
          migrations={[{ id, status: lifecycle, label: detail.data?.name ?? id }]}
          attention={
            attentionQuery.isSuccess ? new Map(attentionQuery.data.mappings.map((a) => [a.mappingId, a])) : undefined
          }
          checks={checksOf(progressQuery.data)}
          pending={{
            queues: attentionQuery.isPending,
            check: progressQuery.isPending,
            lifecycle: lifecycleRead.isPending,
          }}
        />
      </section>

      {/* WHAT HAPPENS TO THIS MIGRATION'S GOOGLE DOCS (0125 T3).
          The remedy on every `policy_refused` item says to set an export
          policy on the mapping, and until now there was nowhere to do it:
          `nativeFilePolicy` appeared in one file in the whole web app, the
          creation wizard. Here because this is the page the failures screen
          hangs off — the person reading that remedy is one link from this
          panel. Renders nothing for a migration with no Google files to
          decide about, and nothing at all until the detail read lands: a
          chooser built on a policy we could not read would show `refuse`
          about a migration that exports (hard rule 9). */}
      {detail.data && (
        <ExportPolicyPanel
          mappingId={id}
          sourceType={detail.data.sourceType}
          domains={detail.data.syncConfig.domains}
          current={detail.data.sourceConfig}
        />
      )}

      {/* HOW OFTEN THIS MIGRATION SYNCS (the owner, 2026-09-28: the schedule
          can be changed here, where it was fixed when the migration was
          made). Managed only, like the panel above: it renders on the detail
          read, which the appliance does not serve, and the appliance's
          schedule is its owner's mapping file. */}
      {detail.data && (
        <SchedulePanel
          mappingId={id}
          current={detail.data.syncConfig.schedule}
          leastMinutesBetweenPasses={detail.data.pace?.leastMinutesBetweenPasses}
        />
      )}

      {/* WHAT THIS MIGRATION COPIES, what it may still gain (0125 T6), and
          each data type's Stop and Resume (0128 T4, slice 3c). Beside the
          export format because all three are settings of a migration that is
          already running; renders nothing when there is nothing to add and
          nothing to stop, and nothing until its read lands. Both editions:
          the appliance's stops come off `/status`, as its strip does. */}
      {(detail.data || (isSelfHost() && status.data)) && (
        <MigrationKindsPanel
          mappingId={id}
          choices={detail.data?.kindChoices}
          stops={
            isSelfHost()
              ? status.data?.mappings.find((m) => m.mappingId === id)?.stops
              : detail.data?.stopChoices
          }
        />
      )}

      {/* Links (0108 T3, 0153 T5 (b)) — how the person being migrated gives
          access to their own account. Made on the person's page since the
          owner's answer of 2026-10-03 (*"yes, replace the per-migration
          links"*): this panel points there, asks who the migration is for, and
          lists the links it was given before. Above the run history because it
          is a thing to DO, and often the first: until somebody grants, there
          is nothing to run. Renders nothing on the appliance, which issues no
          links. */}
      <MappingLinksPanel mappingId={id} />

      {/* Run history (0026 T3 row 23) — what each pass did, errors verbatim.
          Below the links on purpose: the queues are decisions, this is the
          record. */}
      <RunsPanel mappingId={id} />
    </div>
  );
};

export default MappingDetail;
