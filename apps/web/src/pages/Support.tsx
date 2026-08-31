// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The three screens an operator gets (workplan 0110 T4).
 *
 * ## Nothing here authorises anything
 *
 * Every call is decided by the `EXISTS (… platform_operator …)` inside the
 * views the API reads. A non-operator asking for the list gets `[]`, and asking
 * for an organisation gets a 404 — because to the database those rows are
 * invisible, and "not found" is the honest answer about a row you cannot see.
 * `Me.operator` decides whether the nav OFFERS these screens; a typed URL
 * reaches them and shows nothing, which is exactly right.
 *
 * The same shape `AccessRequests.tsx` uses, and for the same reason: a
 * client-side gate would be a second, weaker copy of a rule the database
 * already enforces, and the weaker copy is the one that rots.
 *
 * ## Why the screens say out loud that they are recorded
 *
 * The owner chose standing, disclosed support access over a consent switch on
 * 2026-08-27. That removed the thing a customer could have pointed at, so the
 * accountability moved to the other end: `support_read` records what was
 * actually looked at, by whom, when.
 *
 * A record nobody is told about is surveillance with paperwork. So the line
 * sits at the top of every one of these screens, addressed to the operator —
 * *this is written down against your name* — rather than buried in a policy.
 * The customer-facing half of the same disclosure is 0110 T6.
 *
 * ## Metadata, and the boundary is not this file's
 *
 * These screens render what the API sends, and the API sends what the views
 * select. There is no message, event, contact or file here and there cannot be
 * one: widening that means editing a migration, in a diff somebody reads. The
 * screens say so, because an operator who does not know where the boundary is
 * will go looking for a page that should not exist.
 *
 * What is shown of a failure is the CATEGORY, rendered with the same remedy
 * sentence the customer sees — one map, in `i18n/failure-key.ts`. The owner's
 * reason for wanting this surface was "people expect me to be able to see what
 * they see", and two copies of those six sentences would make that false the
 * first time one was edited.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { LifeBuoy, ArrowLeft, AlertTriangle, Clock } from 'lucide-react';
import { isFailureCategory } from '@openmig/shared';
import {
  listSupportTenants,
  getSupportTenant,
  getSupportMigration,
  listRetainedInvoices,
  type SupportTenant,
  type SupportTenantUsage,
  type SupportTenantMember,
  type SupportMigrationDomain,
  type SupportRetainedInvoice,
} from '../services/support.ts';
import { idpConsoleUserUrl } from '../services/idp-console.ts';
import { useT, useFormatters } from '../i18n/index.tsx';
import { FAILURE_KEY } from '../i18n/failure-key.ts';

/**
 * One fetch per screen, and no refetching.
 *
 * Every call writes a `support_read` row. A screen that refetched on window
 * focus would fill the record with reads nobody made, and the log's whole value
 * is that a row in it means somebody looked.
 */
const ONCE = {
  refetchOnWindowFocus: false,
  refetchOnMount: false,
  refetchInterval: false,
  staleTime: Infinity,
} as const;

/** The line every one of these screens carries, first. */
const Disclosure: React.FC = () => {
  const t = useT();
  return (
    <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {t('support.recorded')}
    </p>
  );
};

const Heading: React.FC<{ title: string; back?: { to: string; label: string } }> = ({
  title,
  back,
}) => (
  <div className="mb-4">
    {back && (
      <Link
        to={back.to}
        className="mb-2 inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {back.label}
      </Link>
    )}
    <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
      <LifeBuoy className="h-6 w-6 text-gray-400" aria-hidden="true" />
      {title}
    </h1>
  </div>
);

/** A `count(*)` arrives as a string over JSON when it is a bigint. */
const asCount = (value: number | string): number => Number(value ?? 0);

const Section: React.FC<{ title: string; empty: string; rows: number; children: React.ReactNode }> =
  ({ title, empty, rows, children }) => (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {rows === 0 ? (
        <p className="text-sm text-gray-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">{children}</div>
      )}
    </section>
  );

/* ------------------------------------------------------------------ level 1 */

export const SupportTenants: React.FC = () => {
  const t = useT();
  const { dateTime } = useFormatters();
  const query = useQuery({ queryKey: ['support', 'tenants'], queryFn: listSupportTenants, ...ONCE });

  const tenants: SupportTenant[] = query.data ?? [];

  return (
    <div>
      <Heading title={t('support.heading')} />
      <Disclosure />
      <p className="mb-4 text-sm text-gray-600">{t('support.metadataOnly')}</p>

      {/* Reachable from here because it is reachable from nowhere else: the
          organisations it concerns have been erased, so no tenant row leads to
          it. A screen nobody can navigate to is the gap this closed. */}
      <p className="mb-4 text-sm">
        <Link to="/support/retained-invoices" className="text-blue-700 hover:underline">
          {t('support.retained.link')}
        </Link>
      </p>

      {query.isLoading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
      {query.isError && <p className="text-sm text-red-700">{t('common.requestFailed')}</p>}

      {!query.isLoading && !query.isError && tenants.length === 0 && (
        <p className="text-sm text-gray-500">{t('support.noOrganisations')}</p>
      )}

      {tenants.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">{t('support.col.organisation')}</th>
                <th className="px-3 py-2">{t('support.col.status')}</th>
                <th className="px-3 py-2">{t('support.col.joined')}</th>
                <th className="px-3 py-2">{t('support.col.migrations')}</th>
                <th className="px-3 py-2">{t('support.col.failing')}</th>
                <th className="px-3 py-2">{t('support.col.waiting')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tenants.map((tenant) => {
                const failing = asCount(tenant.failing_domain_count);
                const waiting = asCount(tenant.pending_decision_count);
                return (
                  <tr key={tenant.tenant_id}>
                    <td className="px-3 py-2">
                      <Link
                        to={`/support/tenants/${tenant.tenant_id}`}
                        className="text-blue-700 hover:underline"
                      >
                        {tenant.tenant_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{tenant.tenant_status}</td>
                    <td className="px-3 py-2 text-gray-600">{dateTime(tenant.joined_at)}</td>
                    <td className="px-3 py-2 text-gray-600">{asCount(tenant.migration_count)}</td>
                    <td className="px-3 py-2">
                      {failing > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-red-700">
                          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                          {failing}
                        </span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    {/* Failing and waiting are opposite support conversations
                        (workplan 0110 T5), which is why they are two columns
                        and not one "needs attention" number: a migration
                        stopped on a decision is not broken, it is waiting for
                        somebody who probably does not know it. */}
                    <td className="px-3 py-2">
                      {waiting > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-amber-800">
                          <Clock className="h-4 w-4" aria-hidden="true" />
                          {waiting}
                        </span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ level 2 */

/**
 * `decided_by` is a closed vocabulary from the API; mapped to keys the same
 * way `FAILURE_KEY` maps categories, so `t()` stays typed over literal keys.
 */
const DECIDED_KEY = {
  paths: 'support.usage.decidedBy.paths',
  data: 'support.usage.decidedBy.data',
  both: 'support.usage.decidedBy.both',
} as const;

/**
 * The tier the month has earned so far, with its evidence (0109 T4 surfaced).
 *
 * Rendered exactly as the API derived it — this component adds no arithmetic,
 * because the point of the surface is to see what the INVOICE will see, and a
 * screen that recomputed would be a second copy that could drift. The state
 * tokens in the breakdown are product vocabulary, rendered raw like every
 * lifecycle and status column on these screens.
 */
const TenantUsage: React.FC<{ usage: SupportTenantUsage }> = ({ usage }) => {
  const t = useT();
  const { dateTime, number, currency } = useFormatters();
  const byState = Object.entries(usage.paths_by_state).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Section title={t('support.usage')} empty="" rows={1}>
      <div className="px-3 py-2 text-sm">
        <p className="mb-1">
          <span className="font-medium text-gray-900">
            {usage.tier ? usage.tier.name : t('support.usage.beyondTable')}
          </span>
          {usage.tier && (
            <span className="text-gray-600">
              {' '}
              · {currency(usage.tier.monthly * 100, 'EUR')} {t('support.usage.perMonth')}
            </span>
          )}
        </p>
        <p className="mb-3 text-gray-600">{t(DECIDED_KEY[usage.decided_by])}</p>
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="py-1 pr-3 text-gray-500">{t('support.usage.peak')}</td>
              <td className="py-1 text-gray-900">
                {usage.recorded_peak_at ? (
                  <>
                    {usage.recorded_peak_paths}
                    <span className="text-gray-500"> — {dateTime(usage.recorded_peak_at)}</span>
                  </>
                ) : (
                  <span className="text-gray-400">{t('support.usage.noPeak')}</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="py-1 pr-3 text-gray-500">{t('support.usage.now')}</td>
              <td className="py-1 text-gray-900">
                {usage.paths_now}
                {byState.length > 0 && (
                  <span className="text-gray-500">
                    {' '}
                    ({byState.map(([state, n]) => `${state} ${n}`).join(' · ')})
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td className="py-1 pr-3 text-gray-500">{t('support.usage.data')}</td>
              <td className="py-1 text-gray-900">{number(usage.evidence.gb_moved)} GB</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-500">{t('support.usage.note')}</p>
      </div>
    </Section>
  );
};

/**
 * WHO MAY ACT ON THIS ORGANISATION, and the way through to their account.
 *
 * The account-level things — a password nobody can reset, a second factor lost
 * with a phone, an account to disable — are the identity provider's job and
 * never Ownpace's (ADR-0042). So this does not offer to change anything: it
 * says who is there, and links to where the change is actually made.
 *
 * THE LINK IS CONFIGURATION, and absent is an ordinary answer. A deployment
 * that has not set `VITE_IDP_CONSOLE_USER_URL` renders the address as plain
 * text — no link and no broken one — which is the appliance, a stack
 * mid-upgrade, and any provider whose console is not addressable per user.
 *
 * `rel="noreferrer"` with `target="_blank"`: this leaves the product for an
 * administrative console, and the page it lands on has no business being
 * handed a window handle or the address it came from.
 */
const People: React.FC<{ members: ReadonlyArray<SupportTenantMember> }> = ({ members }) => {
  const t = useT();
  const { dateTime } = useFormatters();
  return (
    <Section title={t('support.people')} empty={t('support.noPeople')} rows={members.length}>
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">{t('support.col.email')}</th>
            <th className="px-3 py-2">{t('support.col.role')}</th>
            <th className="px-3 py-2">{t('support.col.status')}</th>
            <th className="px-3 py-2">{t('support.col.joined')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {members.map((m) => {
            const href = idpConsoleUserUrl(m.user_id);
            return (
              <tr key={m.user_id}>
                <td className="px-3 py-2">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 hover:underline"
                      title={t('support.openAtProvider')}
                    >
                      {m.email}
                    </a>
                  ) : (
                    m.email
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600">{m.role}</td>
                <td className="px-3 py-2 text-gray-600">{m.status}</td>
                <td className="px-3 py-2 text-gray-600">
                  {m.joined_at ? dateTime(m.joined_at) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
};

export const SupportTenantDetail: React.FC = () => {
  const t = useT();
  const { dateTime } = useFormatters();
  const { tenantId } = useParams<{ tenantId: string }>();
  const query = useQuery({
    queryKey: ['support', 'tenant', tenantId],
    queryFn: () => getSupportTenant(tenantId as string),
    enabled: Boolean(tenantId),
    retry: false,
    ...ONCE,
  });

  const back = { to: '/support', label: t('support.back') };

  if (query.isLoading) {
    return (
      <div>
        <Heading title={t('support.heading')} back={back} />
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </div>
    );
  }
  if (query.isError || !query.data) {
    // A 404 and "you may not see this" are the same answer on purpose, so the
    // screen says the same thing for both. Telling them apart here would undo
    // the reason the API refuses to.
    return (
      <div>
        <Heading title={t('support.heading')} back={back} />
        <p className="text-sm text-gray-500">{t('support.notFound')}</p>
      </div>
    );
  }

  const { tenant, connections, migrations, invoices, usage, members } = query.data;

  return (
    <div>
      <Heading title={tenant.tenant_name} back={back} />
      <Disclosure />
      <p className="mb-4 text-sm text-gray-600">
        {t('support.joinedOn')} {dateTime(tenant.joined_at)} · {tenant.tenant_status}
      </p>
      {/* Said as a sentence rather than left as a number in a table: the
          operator's next action differs, and "there are two things waiting for
          you on your decisions screen" is the first sentence of that call. */}
      <p className="mb-4 text-sm text-gray-600">
        {asCount(tenant.pending_decision_count) > 0
          ? t('support.waiting.some')
          : t('support.waiting.none')}
      </p>

      <Section
        title={t('support.connections')}
        empty={t('support.noConnections')}
        rows={connections.length}
      >
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">{t('support.col.name')}</th>
              <th className="px-3 py-2">{t('support.col.role')}</th>
              <th className="px-3 py-2">{t('support.col.kind')}</th>
              <th className="px-3 py-2">{t('support.col.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {connections.map((c) => (
              <tr key={c.connection_id}>
                <td className="px-3 py-2">{c.display_name ?? '—'}</td>
                <td className="px-3 py-2 text-gray-600">{c.role}</td>
                <td className="px-3 py-2 text-gray-600">{c.kind}</td>
                <td className="px-3 py-2 text-gray-600">{c.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <People members={members} />

      <Section
        title={t('support.migrations')}
        empty={t('support.noMigrations')}
        rows={migrations.length}
      >
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">{t('support.col.name')}</th>
              <th className="px-3 py-2">{t('support.col.lifecycle')}</th>
              <th className="px-3 py-2">{t('support.col.mode')}</th>
              <th className="px-3 py-2">{t('support.col.updated')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {migrations.map((m) => (
              <tr key={m.mapping_id}>
                <td className="px-3 py-2">
                  <Link
                    to={`/support/migrations/${m.mapping_id}`}
                    className="text-blue-700 hover:underline"
                  >
                    {m.name ?? m.mapping_id}
                  </Link>
                </td>
                <td className="px-3 py-2 text-gray-600">{m.lifecycle}</td>
                <td className="px-3 py-2 text-gray-600">{m.mode ?? '—'}</td>
                <td className="px-3 py-2 text-gray-600">{dateTime(m.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {usage && <TenantUsage usage={usage} />}

      <Section title={t('support.invoices')} empty={t('support.noInvoices')} rows={invoices.length}>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">{t('support.col.period')}</th>
              <th className="px-3 py-2">{t('support.col.status')}</th>
              <th className="px-3 py-2">{t('support.col.total')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {invoices.map((i) => (
              <tr key={i.invoice_id}>
                <td className="px-3 py-2">
                  {i.period_start} → {i.period_end}
                </td>
                <td className="px-3 py-2 text-gray-600">{i.status}</td>
                <td className="px-3 py-2 text-gray-600">
                  {i.total} {i.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
};

/* ------------------------------------------------------------------ level 3 */

/** The remedy sentence, or nothing — never a category name on its own. */
const Remedy: React.FC<{ domain: SupportMigrationDomain }> = ({ domain }) => {
  const t = useT();
  // Read back through the guard rather than cast: the column is `text` with no
  // CHECK, so a value written by an older or newer build must not become a
  // category this screen has no sentence for.
  if (!isFailureCategory(domain.last_error_category)) return null;
  return <p className="mt-1 text-sm text-gray-700">{t(FAILURE_KEY[domain.last_error_category])}</p>;
};

export const SupportMigrationDetail: React.FC = () => {
  const t = useT();
  const { dateTime } = useFormatters();
  const { mappingId } = useParams<{ mappingId: string }>();
  const query = useQuery({
    queryKey: ['support', 'migration', mappingId],
    queryFn: () => getSupportMigration(mappingId as string),
    enabled: Boolean(mappingId),
    retry: false,
    ...ONCE,
  });

  const back = { to: '/support', label: t('support.back') };

  if (query.isLoading) {
    return (
      <div>
        <Heading title={t('support.heading')} back={back} />
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div>
        <Heading title={t('support.heading')} back={back} />
        <p className="text-sm text-gray-500">{t('support.notFound')}</p>
      </div>
    );
  }

  const { migration, domains } = query.data;
  const backToTenant = migration.tenant_id
    ? { to: `/support/tenants/${migration.tenant_id}`, label: t('support.backToOrganisation') }
    : back;

  return (
    <div>
      <Heading title={migration.name ?? migration.mapping_id} back={backToTenant} />
      <Disclosure />
      <p className="mb-4 text-sm text-gray-600">
        {migration.lifecycle}
        {migration.schedule ? ` · ${migration.schedule}` : ''}
      </p>
      <p className="mb-4 text-sm text-gray-600">
        {asCount((migration.pending_decision_count ?? 0) as number | string) > 0
          ? t('support.waiting.some')
          : t('support.waiting.none')}
      </p>

      <Section title={t('support.domains')} empty={t('support.noDomains')} rows={domains.length}>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">{t('support.col.domain')}</th>
              <th className="px-3 py-2">{t('support.col.state')}</th>
              <th className="px-3 py-2">{t('support.col.updated')}</th>
              <th className="px-3 py-2">{t('support.col.whatToDo')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {domains.map((d) => (
              <tr key={d.domain}>
                <td className="px-3 py-2">{d.domain}</td>
                <td className="px-3 py-2 text-gray-600">{d.state}</td>
                <td className="px-3 py-2 text-gray-600">{dateTime(d.updated_at)}</td>
                <td className="px-3 py-2">
                  <Remedy domain={d} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Said on the screen, not only in a comment: an operator who does not
          know where the boundary is will go looking for a page that should not
          exist, and asking somebody for a screenshot of their inbox instead. */}
      <p className="text-sm text-gray-500">{t('support.noFourthLevel')}</p>
    </div>
  );
};

/* --------------------------------------------- not a level: what an erasure kept */

/**
 * The invoices an erasure kept, which no tenant page can reach.
 *
 * A purge detaches invoices — `tenant_id` to NULL, `billed_to_name` stamped —
 * because tax retention outlives the customer relationship. Every other screen
 * here filters by tenant, and the tenant is gone, so before this the rows kept
 * for an administrative obligation were readable only from a database prompt.
 *
 * Grouped by `tenant_ref`, the sha256 the erasure record holds so that it
 * cannot be turned back into a list of former customers. The hash is shown
 * TRUNCATED and only as a grouping handle: it is here so two invoices from the
 * same erasure can be seen to belong together, not so anybody can look one up.
 */
export const SupportRetainedInvoices: React.FC = () => {
  const t = useT();
  const { dateTime } = useFormatters();
  const query = useQuery({
    queryKey: ['support', 'retained-invoices'],
    queryFn: listRetainedInvoices,
    ...ONCE,
  });

  const invoices: SupportRetainedInvoice[] = query.data ?? [];

  return (
    <div>
      <Heading
        title={t('support.retained.heading')}
        back={{ to: '/support', label: t('support.back') }}
      />
      <Disclosure />
      <p className="mb-4 text-sm text-gray-600">{t('support.retained.why')}</p>

      {query.isLoading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
      {query.isError && <p className="text-sm text-red-700">{t('common.requestFailed')}</p>}

      {!query.isLoading && !query.isError && (
        <Section
          title={t('support.retained.heading')}
          empty={t('support.retained.none')}
          rows={invoices.length}
        >
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">{t('support.retained.col.billedTo')}</th>
                <th className="px-3 py-2">{t('support.col.period')}</th>
                <th className="px-3 py-2">{t('support.col.status')}</th>
                <th className="px-3 py-2">{t('support.col.total')}</th>
                <th className="px-3 py-2">{t('support.retained.col.erased')}</th>
                <th className="px-3 py-2">{t('support.retained.col.erasure')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((i) => (
                <tr key={i.invoice_id}>
                  <td className="px-3 py-2 text-gray-900">
                    {/* The purge stamps this. A row without one is an invoice
                        issued before `billed_to_name` existed, and saying so
                        beats rendering an empty cell that reads as a bug. */}
                    {i.billed_to_name ?? (
                      <span className="text-gray-400">{t('support.retained.noName')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {dateTime(i.period_start)} – {dateTime(i.period_end)}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{i.status}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {i.total} {i.currency}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {i.purged_at ? dateTime(i.purged_at) : t('support.retained.notPurged')}
                  </td>
                  <td className="px-3 py-2">
                    <code className="text-xs text-gray-400">{i.tenant_ref.slice(0, 12)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
};
