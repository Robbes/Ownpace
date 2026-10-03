// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * MIGRATIONS: ONE CARD PER PERSON (workplan 0153 T3; ADR-0050, amended by the
 * owner on 2026-09-28).
 *
 * The page lists people, not rows. A card is a person's name, where their data
 * comes from and goes to, one line per data type with its stage in words (0154
 * T1), and a count of what needs them. A person's stage is the least advanced
 * of their migrations' (the owner, 2026-09-28: *"One stage per person"*); the
 * lifecycle words stay the operator's, on the migration's own page.
 *
 * A PERSON CHANGES NOTHING ABOUT A MIGRATION, so every migration keeps its own
 * controls here, as the table had them: *Trigger sync* or *Pause* while it
 * runs, *Review and start* for a draft, *Open*, and *Delete* in two presses.
 * The migration's own page has no Delete and no Sync now, so a list without
 * them would have taken away the only way to either.
 *
 * Migrations that belong to nobody, which is every one made before people
 * existed, are listed under the cards, each with one press to add it to a
 * person, and a person can be added there.
 *
 * THREE READS. The migrations and the people make the page: if either fails,
 * the page says so and shows neither cards nor an empty state (hard rule 9).
 * What needs a person only counts: when that read fails, the counts say they
 * could not be taken, never zero.
 *
 * The stage is read from what the list carries: the lifecycle, and whether a
 * pass has completed. A migration whose check passed shows *Kept in step*
 * here, not *Ready to switch*, until the list carries the check (0154 T2).
 */
import React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, Plus, Play, Pause, Trash2, Edit, AlertCircle } from 'lucide-react';
import { leastAdvancedStage, type Person } from '@openmig/shared';
import { mappingApi, type MappingListItem } from '../services/mapping-service.ts';
import { forgetMappingLifecycle } from '../services/mapping-cache.ts';
import {
  addMigrationToPerson,
  createPerson,
  fetchAttention,
  fetchPeople,
} from '../services/operating-service.ts';
import { serverMessage } from '../services/api.ts';
import StateChip from '../components/StateChip.tsx';
import { providerName } from '../components/ProviderTile.tsx';
import { MigrationLines, listStage } from '../components/MigrationLines.tsx';
import { useT, useFormatters, type StringKey } from '../i18n/index.tsx';
import { Hint } from '../components/Hint.tsx';
import { waitingOn } from '../services/needs-you.ts';


/** The names on one side of a person's migrations, once each, in the order met. */
function providerNames(migrations: readonly MappingListItem[], side: 'sourceType' | 'targetType'): string[] {
  const names: string[] = [];
  for (const m of migrations) {
    const kind = m[side];
    // The route's word for a connection it could not find: no name to say.
    if (kind === 'unknown') continue;
    const name = providerName(kind, side === 'sourceType' ? 'source' : 'target');
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

type SyncOutcome = { state: 'pending' } | { state: 'failed'; text: string };

const Mappings: React.FC = () => {
  const t = useT();
  const { list } = useFormatters();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mappingsQuery = useQuery({ queryKey: ['mappings'], queryFn: mappingApi.list });
  const peopleQuery = useQuery({ queryKey: ['people'], queryFn: fetchPeople });
  const attentionQuery = useQuery({ queryKey: ['attention'], queryFn: fetchAttention });

  /**
   * `?status=` — where the dashboard's counts land (workplan 0074). Filters
   * the migrations; a card with none left is not shown. An unknown status
   * filters to nothing rather than showing everything: an empty page under a
   * banner naming the filter is an answer, a full one under a filter that did
   * not apply is a lie.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get('status');

  // Per-migration sync outcome (0033 T3): a refusal renders under the
  // migration with the server's words, never only in the console.
  const [syncOutcomes, setSyncOutcomes] = React.useState<Record<string, SyncOutcome>>({});
  // Delete arming (0037 T5): two presses, and the sentence between them says
  // what goes and what is not touched.
  const [deleteArm, setDeleteArm] = React.useState<{ id: string } | null>(null);
  const [deleteFailed, setDeleteFailed] = React.useState<string | null>(null);
  const [deletePending, setDeletePending] = React.useState(false);

  const refreshLists = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['mappings'] }),
      queryClient.invalidateQueries({ queryKey: ['people'] }),
    ]);
  };

  const handleDelete = async (mappingId: string) => {
    setDeletePending(true);
    setDeleteFailed(null);
    try {
      await mappingApi.delete(mappingId);
      setDeleteArm(null);
      await refreshLists();
    } catch (error) {
      setDeleteFailed(serverMessage(error));
    } finally {
      setDeletePending(false);
    }
  };

  /**
   * Pause (0121). Refreshes this list AND the migration's own cached page
   * (2026-09-17): the list alone left `['mapping', id]` saying `active`, with
   * a Pause button offered on a paused migration.
   */
  const handlePause = async (mappingId: string) => {
    setSyncOutcomes((o) => ({ ...o, [mappingId]: { state: 'pending' } }));
    try {
      await mappingApi.pause(mappingId);
      setSyncOutcomes((o) => {
        const { [mappingId]: _done, ...rest } = o;
        return rest;
      });
      await forgetMappingLifecycle(queryClient, mappingId);
    } catch (error) {
      setSyncOutcomes((o) => ({ ...o, [mappingId]: { state: 'failed', text: serverMessage(error) } }));
    }
  };

  const handleSync = async (mappingId: string, type: 'full' | 'delta') => {
    setSyncOutcomes((o) => ({ ...o, [mappingId]: { state: 'pending' } }));
    try {
      await mappingApi.triggerSync(mappingId, type);
      setSyncOutcomes((o) => {
        const { [mappingId]: _done, ...rest } = o;
        return rest;
      });
      await refreshLists();
    } catch (error) {
      setSyncOutcomes((o) => ({ ...o, [mappingId]: { state: 'failed', text: serverMessage(error) } }));
    }
  };

  if (mappingsQuery.isLoading || peopleQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const failures = [
    ...(mappingsQuery.error != null ? [{ lead: t('mappings.loadFailed'), error: mappingsQuery.error }] : []),
    ...(peopleQuery.error != null ? [{ lead: t('people.loadFailed'), error: peopleQuery.error }] : []),
  ];

  const allMappings = mappingsQuery.data ?? [];
  const byId = new Map(allMappings.map((m) => [m.id, m]));
  const shown = (m: MappingListItem) => !statusFilter || m.status === statusFilter;
  const people = peopleQuery.data?.people ?? [];
  const attentionRead = attentionQuery.isSuccess;
  const attentionById = new Map((attentionQuery.data?.mappings ?? []).map((a) => [a.mappingId, a]));

  // Each person's migrations, as the list has them; one the list does not
  // have is not shown (the list is what exists).
  const cards = people.map((person) => ({
    person,
    migrations: person.migrations.map((pm) => byId.get(pm.id)).filter((m): m is MappingListItem => Boolean(m)),
  }));
  const grouped = new Set(cards.flatMap((c) => c.migrations.map((m) => m.id)));
  const withNobody = allMappings.filter((m) => !grouped.has(m.id));

  const needsOf = (migrations: readonly MappingListItem[]): number | undefined => {
    let total = 0;
    for (const m of migrations) {
      const n = waitingOn(attentionById.get(m.id), attentionRead);
      if (n === undefined) return undefined;
      total += n;
    }
    return total;
  };

  const namedPeople = people.filter((p) => !p.implicit);
  const canAddPeople = !people.some((p) => p.implicit);
  const nothingAtAll = allMappings.length === 0 && people.length === 0;
  const needYou = cards.filter((c) => (needsOf(c.migrations) ?? 0) > 0).length;

  const migrationBlock = (m: MappingListItem, extra?: React.ReactNode) => {
    const outcome = syncOutcomes[m.id];
    return (
      <div key={m.id} className="py-3 border-t border-gray-100 first:border-t-0">
        {/* The whole migration opens it, as the table's row did (owner
            feedback 2026-08-11: a list where only a small icon navigates is
            a hunt). The name is also a real link, for a keyboard and a
            middle click, and the actions stop the click, so a button never
            doubles as the way in. */}
        <div
          data-migration={m.id}
          className="-mx-2 px-2 rounded-lg hover:bg-gray-50 cursor-pointer"
          onClick={() => navigate(`/mappings/${m.id}`)}
        >
          {/* The actions wrap onto their own line on a phone, rather than
              running off the edge (0073: a control that cannot be reached does
              not exist). */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              to={`/mappings/${m.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium text-gray-900 hover:underline"
            >
              {m.name}
            </Link>
            <div className="flex flex-wrap items-center gap-3" onClick={(e) => e.stopPropagation()}>
              {m.status === 'active' ? (
                <>
                  <button
                    onClick={() => void handleSync(m.id, 'delta')}
                    disabled={outcome?.state === 'pending'}
                    className="p-1 text-blue-600 hover:text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('mappings.action.triggerSync')}
                    aria-label={t('mappings.action.triggerSync')}
                  >
                    <Play className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => void handlePause(m.id)}
                    disabled={outcome?.state === 'pending'}
                    className="p-1 text-amber-600 hover:text-amber-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('mappings.action.pause')}
                    aria-label={t('mappings.action.pause')}
                  >
                    <Pause className="w-5 h-5" />
                  </button>
                </>
              ) : m.status === 'paused' ? (
                // A paused migration's green light lives on the confirm screen
                // (0037 T2); a Play here would post a sync the server refuses.
                <Link to={`/mappings/${m.id}/confirm`} className="text-green-700 hover:text-green-900 text-sm font-medium">
                  {t('mappings.action.reviewAndStart')}
                </Link>
              ) : (
                <button
                  onClick={() => void handleSync(m.id, 'full')}
                  disabled={outcome?.state === 'pending'}
                  className="p-1 text-green-600 hover:text-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t('mappings.action.startSync')}
                  aria-label={t('mappings.action.startSync')}
                >
                  <Play className="w-5 h-5" />
                </button>
              )}
              <Link to={`/mappings/${m.id}`} aria-label={t('mappings.action.open')} className="p-1 text-blue-600 hover:text-blue-800">
                <Edit className="w-5 h-5" />
              </Link>
              <button
                onClick={() => {
                  setDeleteFailed(null);
                  setDeleteArm((arm) => (arm?.id === m.id ? null : { id: m.id }));
                }}
                className="p-1 text-red-600 hover:text-red-800"
                title={t('mappings.action.delete')}
                aria-label={t('mappings.action.delete')}
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>
          <MigrationLines migration={m} />
        </div>
        {extra}
        {deleteArm?.id === m.id && (
          <div className="mt-2 px-3 py-3 rounded-lg bg-red-50 text-sm text-red-900">
            <Hint className="" tone="body" label="more" text={t('mappings.delete.explain')} why={t('mappings.delete.more')} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => void handleDelete(m.id)}
                disabled={deletePending}
                className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('mappings.delete.confirm')}
              </button>
              <button
                onClick={() => {
                  setDeleteArm(null);
                  setDeleteFailed(null);
                }}
                className="px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                {t('mappings.delete.cancel')}
              </button>
            </div>
            {deleteFailed !== null && (
              <p className="mt-2">
                <span className="font-medium">{t('mappings.delete.failed')}</span> {deleteFailed}
              </p>
            )}
          </div>
        )}
        {outcome?.state === 'failed' && (
          <p className="mt-2 px-3 py-2 rounded-lg bg-red-50 text-sm text-red-800">
            <span className="font-medium">{t('mappings.syncFailed')}</span> {outcome.text}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('mappings.title')}</h1>
          {failures.length === 0 && people.length > 0 && (
            <p className="text-gray-600 mt-1">
              {people.length === 1 ? t('people.count.one') : t('people.count.many', { n: people.length })}
              {attentionRead && needYou > 0 && (
                <>
                  {' · '}
                  {needYou === 1 ? t('people.needYou.one') : t('people.needYou.many', { n: needYou })}
                </>
              )}
            </p>
          )}
        </div>
        {/* Start a migration is the flow (0153 T4); the four-step wizard stays
            reachable, by hand, until it carries every card. */}
        <div className="flex flex-col items-end gap-2">
          <Link
            to="/start"
            className="flex min-h-[44px] items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5 mr-2" />
            {t('mappings.new')}
          </Link>
          <Link to="/mappings/new" className="text-sm text-blue-700 hover:underline">
            {t('start.byHand')}
          </Link>
        </div>
      </div>

      {statusFilter && failures.length === 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          <span className="text-blue-900">
            {t('mappings.filtered.lead')} {t(`state.lifecycle.${statusFilter}` as StringKey)}
          </span>
          <button type="button" onClick={() => setSearchParams({})} className="text-blue-700 underline hover:no-underline">
            {t('mappings.filtered.clear')}
          </button>
        </div>
      )}

      {failures.length > 0 ? (
        <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            {failures.map((f) => (
              <React.Fragment key={f.lead}>
                <p className="font-medium">{f.lead}</p>
                <p className="mt-1">{serverMessage(f.error)}</p>
              </React.Fragment>
            ))}
          </div>
        </div>
      ) : nothingAtAll ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <FolderGit2 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">{t('mappings.empty.title')}</h3>
          <p className="text-gray-500 mb-6">{t('mappings.empty.hint')}</p>
          <Link
            to="/start"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5 mr-2" />
            {t('mappings.empty.cta')}
          </Link>
        </div>
      ) : (
        <>
          {cards.map(({ person, migrations }) => {
            const visible = migrations.filter(shown);
            if (statusFilter && visible.length === 0) return null;
            const stage = leastAdvancedStage(migrations.map(listStage));
            const needs = needsOf(migrations);
            const from = providerNames(migrations, 'sourceType');
            const to = providerNames(migrations, 'targetType');
            const headingId = `person-${person.id}`;
            return (
              <section key={person.id} aria-labelledby={headingId} className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 id={headingId} className="text-lg font-semibold text-gray-900">
                      {person.implicit ? (
                        t('people.implicit')
                      ) : (
                        // The person's own page (0153 T5): what waits on them,
                        // and their steps before they switch.
                        <Link to={`/people/${encodeURIComponent(person.id)}`} className="hover:underline">
                          {person.displayName}
                        </Link>
                      )}
                    </h2>
                    {stage && <StateChip entity="stage" state={stage} />}
                  </div>
                  {needs === undefined ? (
                    attentionQuery.isLoading ? null : <span className="text-sm text-gray-600">{t('people.needsUnknown')}</span>
                  ) : needs > 0 ? (
                    <Link
                      to={person.implicit ? '/decisions' : `/people/${encodeURIComponent(person.id)}#before-you-switch`}
                      className="text-sm font-medium text-blue-700 hover:underline"
                    >
                      {t('people.needsYou', { n: needs })} →
                    </Link>
                  ) : null}
                </div>
                {from.length > 0 && to.length > 0 && (
                  <p className="mt-1 text-sm text-gray-600">{t('people.fromTo', { from: list(from), to: list(to) })}</p>
                )}
                <div className="mt-3">
                  {visible.length === 0 ? (
                    <p className="text-sm text-gray-500">{t('people.noneYet')}</p>
                  ) : (
                    visible.map((m) => migrationBlock(m))
                  )}
                </div>
                {!person.implicit && (
                  <Link
                    to={`/start?person=${encodeURIComponent(person.id)}`}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
                  >
                    <Plus className="w-4 h-4" />
                    {t('people.addMigration')}
                  </Link>
                )}
              </section>
            );
          })}

          {withNobody.filter(shown).length > 0 && (
            <section aria-labelledby="people-unassigned" className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
              <h2 id="people-unassigned" className="text-lg font-semibold text-gray-900">
                {t('people.unassigned.title')}
              </h2>
              {namedPeople.length > 0 && <p className="mt-1 text-sm text-gray-600">{t('people.unassigned.hint')}</p>}
              <div className="mt-3">
                {withNobody
                  .filter(shown)
                  .map((m) =>
                    migrationBlock(
                      m,
                      namedPeople.length > 0 ? <AddToPerson mappingId={m.id} people={namedPeople} /> : undefined,
                    ),
                  )}
              </div>
            </section>
          )}

          {canAddPeople && !statusFilter && <NewPerson />}
        </>
      )}
    </div>
  );
};

/** One press to add a migration that belongs to nobody to a person (ADR-0050 rule 2). */
const AddToPerson: React.FC<{ mappingId: string; people: readonly Person[] }> = ({ mappingId, people }) => {
  const t = useT();
  const queryClient = useQueryClient();
  const id = React.useId();
  const [personId, setPersonId] = React.useState(people[0]?.id ?? '');
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  const add = async () => {
    setPending(true);
    setFailed(null);
    try {
      await addMigrationToPerson(personId, mappingId);
      await queryClient.invalidateQueries({ queryKey: ['people'] });
    } catch (error) {
      setFailed(serverMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={id} className="text-gray-700">
          {t('people.addTo')}
        </label>
        <select
          id={id}
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
          className="px-2 py-1 border border-gray-300 rounded-lg"
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void add()}
          disabled={pending || personId === ''}
          className="px-3 py-1 bg-white border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          {t('people.addTo.submit')}
        </button>
      </div>
      {failed !== null && (
        <p role="alert" className="mt-1 text-sm text-red-800">
          <span className="font-medium">{t('people.addTo.failed')}</span> {failed}
        </p>
      )}
    </div>
  );
};

/** A person to add migrations to: a name, and an address for a grant link or none. */
const NewPerson: React.FC = () => {
  const t = useT();
  const queryClient = useQueryClient();
  const nameId = React.useId();
  const emailId = React.useId();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setFailed(null);
    try {
      await createPerson({ displayName: name, email: email === '' ? null : email });
      setName('');
      setEmail('');
      await queryClient.invalidateQueries({ queryKey: ['people'] });
    } catch (error) {
      setFailed(serverMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-gray-900">{t('people.new.title')}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={nameId} className="block text-sm font-medium text-gray-700">
            {t('people.new.name')}
          </label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <div>
          <label htmlFor={emailId} className="block text-sm font-medium text-gray-700">
            {t('people.new.email')}
          </label>
          <input
            id={emailId}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            autoComplete="off"
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={pending || name.trim() === ''}
        className="mt-3 px-4 py-2 bg-white border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 disabled:opacity-50"
      >
        {t('people.new.submit')}
      </button>
      {failed !== null && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          <span className="font-medium">{t('people.new.failed')}</span> {failed}
        </p>
      )}
    </form>
  );
};

export default Mappings;
