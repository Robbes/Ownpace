// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PAGE PER PERSON (workplan 0153 T5; drawn in `wf-person-page.svg`).
 *
 * `/people/:personId` keeps the code's name, as `/mappings/:id` does (D6). It
 * holds what the card on Migrations holds, and the person's steps before they
 * switch:
 *
 * - their name, where from and where to, one stage (the least advanced of
 *   their migrations', the owner's *"One stage per person"*), and what waits
 *   on them;
 * - each migration's lines per data type, as the card draws them, with a link
 *   to the migration's own page as *Details*: its run history, its schedule,
 *   its settings and its controls stay there;
 * - *Before you switch*: the hub's seven steps as one ordered list, each
 *   summed across the person's migrations, with its state in words
 *   (`cutover-steps.ts`, 0154 T4). A step opens each migration's own page for
 *   it, and on a queue's step each link carries that migration's own count,
 *   so the person sees which one the work is in;
 * - *Add a migration*.
 *
 * - *For {name}*: one grant link for all of their Google accounts (ADR-0035,
 *   amended 2026-09-29; 0153 T5 (b)), on managed;
 * - beside a migration that waits for their grant, what the grant does to it
 *   when it lands: it starts by itself once their move runs, or the owner
 *   reviews and starts it, or it had run and gets its way in back (start when
 *   granted, per person; the owner, 2026-10-03). Managed only, as their links
 *   are. A failed read says so under the migrations, and claims nothing.
 *
 * ON THE APPLIANCE TOO (0153 T8; the owner's D5): the same page for its one
 * implicit person, which is its landing once every migration has started
 * (`landingPath` in `apps/selfhost`). It has no list of migrations (ADR-0034),
 * so each migration's row is read from the status every appliance page polls
 * (`rowsFromStatus`), named by its file or by where it goes. There is no
 * Migrations page to go back to, no *Add a migration*, and no links.
 *
 * NOT YET HERE, and said in the plan: the one-line progress on each data type
 * (0154 T2's totals).
 *
 * THREE READS, as on Migrations. A failed read of the people or the list is a
 * failure on screen (hard rule 9). A step whose count could not be read says
 * so, and claims no state.
 */
import React from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Clock, Plus } from 'lucide-react';
import { leastAdvancedStage, type StatusReport } from '@openmig/shared';
import { mappingApi, type MappingListItem } from '../services/mapping-service.ts';
import { fetchAttention, fetchPeople, fetchStatus } from '../services/operating-service.ts';
import { serverMessage } from '../services/api.ts';
import { waitingOn } from '../services/needs-you.ts';
import { personSteps, type Step, type StepState } from '../services/cutover-steps.ts';
import StateChip from '../components/StateChip.tsx';
import { MigrationLines, listStage } from '../components/MigrationLines.tsx';
import { providerName } from '../components/ProviderTile.tsx';
import { SCREENS } from './hub-screens.ts';
import { PersonGrantLinkSection, PersonViewLinkSection } from '../components/MappingLinksPanel.tsx';
import { personLinkApi, type AwaitingGrant } from '../services/grant-link-service.ts';
import { isSelfHost } from '../services/edition.ts';
import { useT, useFormatters, type StringKey } from '../i18n/index.tsx';

/** The hub's step for each of the seven, for its name, its line and its path. */
const SCREEN_OF: Readonly<Record<Step['key'], (typeof SCREENS)[number]>> = {
  deletions: SCREENS.find((s) => s.path === 'deletions')!,
  moves: SCREENS.find((s) => s.path === 'moves')!,
  failures: SCREENS.find((s) => s.path === 'failures')!,
  sharing: SCREENS.find((s) => s.path === 'sharing')!,
  check: SCREENS.find((s) => s.path === 'verify')!,
  confirmed: SCREENS.find((s) => s.path === 'confirmed')!,
  finish: SCREENS.find((s) => s.path === 'finish')!,
};

const STATE_WORD: Readonly<Record<StepState, StringKey>> = {
  done: 'person.state.done',
  needsYou: 'person.state.needsYou',
  notYet: 'person.state.notYet',
};

const STATE_TONE: Readonly<Record<StepState, string>> = {
  done: 'bg-green-50 text-green-800',
  needsYou: 'bg-amber-100 text-amber-900',
  notYet: 'bg-gray-100 text-gray-700',
};

/** What a person's grant does to a migration that waits for it, in words. */
const ONCE_GRANTED_WORDS: Readonly<Record<AwaitingGrant['then'], StringKey>> = {
  starts_by_itself: 'person.awaiting.startsByItself',
  review_and_start: 'person.awaiting.reviewAndStart',
  ran_before: 'person.awaiting.ranBefore',
};

/** The steps that count a queue, whose link to each migration carries that migration's own count. */
const QUEUE_STEPS: ReadonlySet<Step['key']> = new Set(['deletions', 'moves', 'failures', 'sharing']);

/**
 * What the page reads of each migration: the list's row on managed. The
 * appliance has no list (ADR-0034), so its rows come from the status it serves
 * (`rowsFromStatus`), where a migration has a name only if its file gives one.
 */
type PersonRow = Pick<MappingListItem, 'id' | 'sourceType' | 'targetType' | 'status' | 'domains' | 'lastSyncAt'> & {
  readonly name?: string;
};

/**
 * The appliance's rows (0153 T8): one per migration it is configured with,
 * from `/status`. Its data types are the ones the status reports, and its last
 * pass is the latest any of them completed.
 */
function rowsFromStatus(report: StatusReport): PersonRow[] {
  return report.mappings.map((m) => {
    let lastSyncAt: string | undefined;
    for (const d of m.domains) {
      if (d.lastSyncedAt && (lastSyncAt === undefined || d.lastSyncedAt > lastSyncAt)) lastSyncAt = d.lastSyncedAt;
    }
    return {
      id: m.mappingId,
      ...(m.name ? { name: m.name } : {}),
      sourceType: m.sourceType ?? 'unknown',
      targetType: m.targetType ?? 'unknown',
      status: m.migrationStatus,
      domains: m.domains.map((d) => d.domain),
      lastSyncAt,
    };
  });
}

/** The names on one side of a person's migrations, once each, in the order met. */
function names(migrations: readonly PersonRow[], side: 'sourceType' | 'targetType'): string[] {
  const out: string[] = [];
  for (const m of migrations) {
    if (m[side] === 'unknown') continue;
    const name = providerName(m[side], side === 'sourceType' ? 'source' : 'target');
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

const Person: React.FC = () => {
  const { personId } = useParams<{ personId: string }>();
  const t = useT();
  const { list } = useFormatters();

  const selfHost = isSelfHost();
  // Each migration's row: the list on managed, the status on the appliance.
  const listQuery = useQuery({ queryKey: ['mappings'], queryFn: mappingApi.list, enabled: !selfHost });
  const statusQuery = useQuery({ queryKey: ['status'], queryFn: fetchStatus, enabled: selfHost, select: rowsFromStatus });
  const rowsQuery = selfHost ? statusQuery : listQuery;
  const rows: readonly PersonRow[] | undefined = selfHost ? statusQuery.data : listQuery.data;
  const peopleQuery = useQuery({ queryKey: ['people'], queryFn: fetchPeople });
  const attentionQuery = useQuery({ queryKey: ['attention'], queryFn: fetchAttention });
  // Their one grant link (ADR-0035, amended 2026-09-29; 0153 T5 (b)). Managed
  // only: the appliance moves one implicit person and serves no links.
  const linksQuery = useQuery({
    queryKey: ['person-links', personId],
    queryFn: () => personLinkApi.list(personId!),
    enabled: Boolean(personId) && !selfHost,
    retry: false,
  });
  // Which of their migrations wait for their grant, and what it does to each.
  const awaitingQuery = useQuery({
    queryKey: ['person-awaiting-grant', personId],
    queryFn: () => personLinkApi.awaiting(personId!),
    enabled: Boolean(personId) && !selfHost,
    retry: false,
  });

  if (rowsQuery.isLoading || peopleQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // The appliance has no Migrations page to go back to: its menu leads here.
  const back = selfHost ? null : (
    <Link to="/mappings" className="text-sm text-blue-700 hover:underline">
      {t('person.back')}
    </Link>
  );

  const failure = rowsQuery.error ?? peopleQuery.error;
  if (failure != null) {
    return (
      <div className="space-y-4">
        {back}
        <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t('person.loadFailed')}</p>
            <p className="mt-1">{serverMessage(failure)}</p>
          </div>
        </div>
      </div>
    );
  }

  const person = peopleQuery.data?.people.find((p) => p.id === personId);
  if (!person) {
    return (
      <div className="space-y-4">
        {back}
        <p className="text-gray-700">{t('person.notFound')}</p>
      </div>
    );
  }

  const byId = new Map((rows ?? []).map((m) => [m.id, m]));
  const migrations = person.migrations.map((pm) => byId.get(pm.id)).filter((m): m is PersonRow => Boolean(m));
  // A migration's name, or where it goes when its file gives none (the appliance).
  const label = (m: PersonRow): string =>
    m.name ?? t('person.rowName', { from: providerName(m.sourceType, 'source'), to: providerName(m.targetType, 'target') });
  const attention = attentionQuery.isSuccess
    ? new Map(attentionQuery.data.mappings.map((a) => [a.mappingId, a]))
    : undefined;
  const stage = leastAdvancedStage(migrations.map(listStage));
  const awaiting = new Map((awaitingQuery.data ?? []).map((a) => [a.mappingId, a.then]));
  const theirName = person.displayName ?? '';
  const from = names(migrations, 'sourceType');
  const to = names(migrations, 'targetType');

  let needs: number | undefined = 0;
  for (const m of migrations) {
    const n = waitingOn(attention?.get(m.id), attentionQuery.isSuccess);
    if (n === undefined) {
      needs = undefined;
      break;
    }
    needs += n;
  }

  const steps = personSteps(migrations, attentionQuery.isLoading ? undefined : attention);

  const countWords = (step: Step): string => {
    if (step.key === 'check') {
      if (step.count === undefined) return t('person.step.unread');
      if (step.state === 'done') return t('person.step.check.passed');
      return step.count > 0
        ? t('person.step.check.partly', { n: step.count, total: migrations.length })
        : t('person.step.check.notYet');
    }
    if (step.key === 'confirmed') {
      if (step.state === undefined) return t('person.step.unread');
      return step.state === 'done' ? t('person.step.confirmed.done') : t('person.step.confirmed.notYet');
    }
    if (step.key === 'finish') {
      return step.state === 'done' ? t('person.step.finish.done') : t('person.step.finish.notYet');
    }
    if (step.count === undefined) return t('person.step.unread');
    if (step.count === 0) return t('person.step.none');
    if (step.key === 'failures') {
      return step.count === 1 ? t('person.step.failures.one') : t('person.step.failures.many', { n: step.count });
    }
    return t(`person.step.${step.key}` as StringKey, { n: step.count });
  };

  return (
    <div className="space-y-6">
      {back}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{person.displayName ?? t('people.implicit')}</h1>
          {stage && <StateChip entity="stage" state={stage} />}
        </div>
        {from.length > 0 && to.length > 0 && (
          <p className="mt-1 text-gray-600">{t('people.fromTo', { from: list(from), to: list(to) })}</p>
        )}
        {needs === undefined ? (
          attentionQuery.isLoading ? null : <p className="mt-1 text-sm text-gray-600">{t('people.needsUnknown')}</p>
        ) : needs > 0 ? (
          <a href="#before-you-switch" className="mt-1 inline-block text-sm font-medium text-blue-700 hover:underline">
            {t('people.needsYou', { n: needs })} →
          </a>
        ) : null}
      </div>

      <section className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        {migrations.length === 0 ? (
          <p className="text-sm text-gray-500">{t('people.noneYet')}</p>
        ) : (
          migrations.map((m) => (
            <div key={m.id} data-migration={m.id} className="py-3 border-t border-gray-100 first:border-t-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-900">{label(m)}</span>
                <Link to={`/mappings/${encodeURIComponent(m.id)}`} className="text-sm text-blue-700 hover:underline">
                  {t('person.details')} →
                </Link>
              </div>
              {awaiting.has(m.id) && (
                <p data-awaiting-grant={awaiting.get(m.id)} className="mt-1 flex items-start gap-1.5 text-sm text-gray-700">
                  <Clock className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-500" aria-hidden="true" />
                  <span>{t(ONCE_GRANTED_WORDS[awaiting.get(m.id)!], { name: theirName })}</span>
                </p>
              )}
              <MigrationLines migration={m} />
            </div>
          ))
        )}
        {awaitingQuery.isError && migrations.length > 0 && (
          <p className="mt-2 text-sm text-gray-600">{t('person.awaiting.unread', { name: theirName })}</p>
        )}
        {!person.implicit && (
          // *Start a migration* for this person, and the four-step wizard
          // beside it, by hand, until the flow carries every card (0153 T4).
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link
              to={`/start?person=${encodeURIComponent(person.id)}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
            >
              <Plus className="w-4 h-4" />
              {t('people.addMigration')}
            </Link>
            <Link
              to={`/mappings/new?person=${encodeURIComponent(person.id)}`}
              className="text-sm text-blue-700 hover:underline"
            >
              {t('start.byHand')}
            </Link>
          </div>
        )}
      </section>

      {migrations.length > 0 && (
        <section aria-labelledby="before-you-switch" className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <h2 id="before-you-switch" className="text-lg font-semibold text-gray-900 scroll-mt-20">
            {t('person.steps.title')}
          </h2>
          <p className="mt-1 text-sm text-gray-600">{t('person.steps.hint')}</p>
          <ol className="mt-3 divide-y divide-gray-100">
            {steps.map((step) => {
              const screen = SCREEN_OF[step.key];
              const only = migrations.length === 1 ? migrations[0]! : undefined;
              const name = t(screen.nameKey);
              return (
                <li key={step.key} data-step={step.key} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {only ? (
                      <Link
                        to={`/mappings/${encodeURIComponent(only.id)}/${screen.path}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="font-medium text-gray-900">{name}</span>
                    )}
                    <span className="text-sm text-gray-700">{countWords(step)}</span>
                    {step.state && (
                      <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${STATE_TONE[step.state]}`}>
                        {t(STATE_WORD[step.state])}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{t(screen.blurbKey)}</p>
                  {!only && (
                    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {migrations.map((m) => {
                        // Which migration holds what the row sums, so the
                        // person knows which of the links has work behind it.
                        const own = QUEUE_STEPS.has(step.key)
                          ? step.perMigration.find((p) => p.id === m.id)
                          : undefined;
                        return (
                          <li key={m.id}>
                            <Link
                              to={`/mappings/${encodeURIComponent(m.id)}/${screen.path}`}
                              className="text-blue-700 hover:underline"
                            >
                              {own === undefined
                                ? label(m)
                                : own.count === undefined
                                  ? t('person.step.linkUnread', { name: label(m) })
                                  : `${label(m)} (${own.count})`}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* For them (the drawing's "For Anna"): one grant link for all of their
          Google accounts, made, copied and revoked here (ADR-0035, amended
          2026-09-29). The server refuses one, in words, when nothing of
          theirs can be granted through it. */}
      {!person.implicit && !selfHost && migrations.length > 0 && (
        <section aria-labelledby="for-them" className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <h2 id="for-them" className="text-lg font-semibold text-gray-900">
            {t('person.links.title', { name: person.displayName ?? '' })}
          </h2>
          <PersonGrantLinkSection personId={person.id} links={linksQuery.data} loadFailed={linksQuery.error != null} />
          <PersonViewLinkSection personId={person.id} links={linksQuery.data} loadFailed={linksQuery.error != null} />
        </section>
      )}
    </div>
  );
};

export default Person;
