// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * ONE MIGRATION'S REPORT, AS A PAGE READS IT (workplan 0154 T5).
 *
 * The completion report (0047) as a person reads it rather than as a file
 * they hand over: what was found, what arrived, what could not come and why,
 * what waits on a decision, what was removed and on whose, what the check
 * compared, and the access only they can withdraw. In the reader's language
 * around the server's findings, which stay verbatim (an error is the
 * provider's own words).
 *
 * One section, for a migration's own report page and for each migration on a
 * person's combined report, so the two say a migration the same way.
 *
 * Nothing here is derived that the report does not say: the verdict is the
 * builder's, a count nobody took says *not counted* (hard rule 9), and the
 * check says what it last did, or that it could not be read.
 */
import React from 'react';
import { Link } from 'react-router';
import {
  accessThatOutlivesErasure,
  checkFactsOf,
  type DiscoveryDomain,
  type VerificationDomain,
  type VerificationResult,
  type VerificationRunReport,
} from '@openmig/shared';
import type { ReadReport } from '../services/report-service.ts';
import { DataTypeLabel } from './icons/data-type-icons.tsx';
import StateChip from './StateChip.tsx';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import { useLocale, useFormatters, type StringKey } from '../i18n/index.tsx';

/** The check's own spelling of a data type (its report is a wire shape of its own). */
const CHECKED_AS: Readonly<Record<DiscoveryDomain, VerificationDomain>> = {
  email: 'mail',
  calendar: 'calendar',
  contact: 'contacts',
  file: 'files',
  task: 'tasks',
};

const VERDICT: Readonly<Record<ReadReport['verdict'], { key: StringKey; tone: string }>> = {
  complete: { key: 'migrationReport.verdict.complete', tone: 'bg-green-50 text-green-900 border-green-200' },
  complete_with_decisions_pending: {
    key: 'migrationReport.verdict.decisionsPending',
    tone: 'bg-amber-50 text-amber-900 border-amber-200',
  },
  in_progress: { key: 'migrationReport.verdict.inProgress', tone: 'bg-gray-50 text-gray-800 border-gray-200' },
};

/**
 * One count on a data type's line. Below 640 pixels the line is a grid and
 * the table's header is not shown, so the count says its own label above
 * itself; from 640 the header says it, and the label goes.
 */
const Count: React.FC<{ label: string; last?: boolean; children: React.ReactNode }> = ({
  label,
  last = false,
  children,
}) => (
  <td
    className={`flex flex-col justify-between tabular-nums sm:table-cell sm:whitespace-nowrap sm:py-1.5 sm:text-right ${last ? '' : 'sm:pr-4'}`}
  >
    <span className="text-xs text-gray-500 sm:hidden">{label}</span>
    <span>{children}</span>
  </td>
);

export const MigrationReport: React.FC<{
  report: ReadReport;
  /** The migration's last check; undefined where it could not be read. */
  check: VerificationRunReport | undefined;
  /** The level of the section's own headings: 2 on a migration's page, 3 inside a person's. */
  level?: 2 | 3;
}> = ({ report, check, level = 2 }) => {
  const { t, locale } = useLocale();
  const { number, dateTime, relativeToNow, list } = useFormatters();
  const H = (level === 2 ? 'h2' : 'h3') as 'h2' | 'h3';
  const id = encodeURIComponent(report.mappingId);
  const lines = report.domains.filter((d) => d.state !== 'skipped');
  const notPart = report.domains.filter((d) => d.state === 'skipped');
  const word = (d: DiscoveryDomain) => t(DOMAIN_STRING_KEY[d]).toLocaleLowerCase(locale);
  const verdict = VERDICT[report.verdict];
  const access = accessThatOutlivesErasure([report.sourceType, report.targetType], locale);
  const heading = 'text-base font-semibold text-gray-900';
  // The check's table, narrow first: at a phone's width its columns keep a
  // tighter gap and its headings a smaller size with room to wrap.
  const gap = 'pr-2 sm:pr-4';
  const th = 'py-1 align-bottom text-xs font-medium sm:text-sm';
  const num = 'py-1.5 text-right tabular-nums whitespace-nowrap';

  const checkSentence = (): string => {
    if (check === undefined) return t('person.step.unread');
    const facts = checkFactsOf(check, report.mappingId);
    switch (facts.state) {
      case 'not_run':
        return t('person.step.check.notRun');
      case 'running':
        return t('person.step.check.running');
      case 'could_not_run':
        return t('person.step.check.couldNotRun', { when: relativeToNow(facts.at) });
      case 'not_passed':
        return t('person.step.check.notPassedWhen', { when: relativeToNow(facts.at) });
      case 'passed':
        return t('person.step.check.passedWhen', { when: relativeToNow(facts.at) });
    }
  };
  const result: VerificationResult | undefined =
    check?.state === 'done' ? (check.report as Record<string, VerificationResult>)[report.mappingId] : undefined;

  return (
    <div className="space-y-6" data-report={report.mappingId}>
      <p className={`rounded border px-3 py-2 text-sm ${verdict.tone}`}>{t(verdict.key)}</p>

      <section>
        <H className={heading}>{t('migrationReport.arrived.heading')}</H>
        {/* A table from 640 pixels. Below that each data type is a block of its own, its name and
            state on top and its four counts labelled beneath, so no count sits behind a sideways
            scroll: the last one, what could not come, is the one a report is read for. */}
        <table className="mt-2 block w-full text-sm sm:table">
          <thead className="hidden sm:table-header-group">
            <tr className="text-left text-gray-500">
              <th className="py-1 pr-4 font-medium">{t('migrationReport.col.type')}</th>
              <th className="py-1 pr-4 text-right font-medium">{t('migrationReport.col.found')}</th>
              <th className="py-1 pr-4 text-right font-medium">{t('migrationReport.col.arrived')}</th>
              <th className="py-1 pr-4 text-right font-medium">{t('migrationReport.col.leftAsIs')}</th>
              <th className="py-1 text-right font-medium">{t('migrationReport.col.couldNotCome')}</th>
            </tr>
          </thead>
          <tbody className="block sm:table-row-group">
            {lines.map((d) => (
              <React.Fragment key={d.domain}>
                <tr
                  className="grid grid-cols-4 gap-x-2 gap-y-1 border-t border-gray-100 py-2 sm:table-row sm:py-0"
                  data-domain={d.domain}
                >
                  <td className="col-span-4 text-gray-900 sm:table-cell sm:py-1.5 sm:pr-4">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="whitespace-nowrap">
                        <DataTypeLabel domain={d.domain} size={16} />
                      </span>
                      <StateChip entity="domain" state={d.state} />
                    </div>
                  </td>
                  <Count label={t('migrationReport.col.found')}>
                    {d.itemsFound === undefined ? (
                      <span className="text-gray-500">{t('migrationReport.notCounted')}</span>
                    ) : (
                      number(d.itemsFound)
                    )}
                  </Count>
                  <Count label={t('migrationReport.col.arrived')}>{number(d.itemsSynced)}</Count>
                  <Count label={t('migrationReport.col.leftAsIs')}>{number(d.itemsAdopted ?? 0)}</Count>
                  <Count label={t('migrationReport.col.couldNotCome')} last>
                    {number(d.itemsFailed)}
                  </Count>
                </tr>
                {d.itemsFailed > 0 && (
                  <tr className="block sm:table-row">
                    <td colSpan={5} className="block pb-2 text-sm text-gray-700 sm:table-cell">
                      {d.lastError ? (
                        <span>
                          {t('migrationReport.why')}{' '}
                          {/* The provider's own words, verbatim (the prose boundary). */}
                          <code className="whitespace-pre-wrap break-words text-xs text-red-800">{d.lastError}</code>{' '}
                        </span>
                      ) : null}
                      <Link to={`/mappings/${id}/failures`} className="text-blue-700 hover:underline">
                        {t('migrationReport.seeWhich')}
                      </Link>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {notPart.length > 0 && (
          <p className="mt-2 text-sm text-gray-600">
            {t('migrationReport.notPart', { types: list(notPart.map((d) => word(d.domain))) })}
          </p>
        )}
      </section>

      <section>
        <H className={heading}>{t('migrationReport.decisions.heading')}</H>
        {report.queues.deletionsOpen + report.queues.movesOpen + report.queues.failuresNeedingDecision === 0 ? (
          <p className="mt-1 text-sm text-gray-700">{t('migrationReport.decisions.none')}</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {report.queues.deletionsOpen > 0 && (
              <li>
                <Link to={`/mappings/${id}/deletions`} className="text-blue-700 hover:underline">
                  {t('hub.deletions.name')}
                </Link>{' '}
                {t('person.step.deletions', { n: report.queues.deletionsOpen })}
              </li>
            )}
            {report.queues.movesOpen > 0 && (
              <li>
                <Link to={`/mappings/${id}/moves`} className="text-blue-700 hover:underline">
                  {t('hub.moves.name')}
                </Link>{' '}
                {t('person.step.moves', { n: report.queues.movesOpen })}
              </li>
            )}
            {report.queues.failuresNeedingDecision > 0 && (
              <li>
                <Link to={`/mappings/${id}/failures`} className="text-blue-700 hover:underline">
                  {t('hub.failures.name')}
                </Link>{' '}
                {report.queues.failuresNeedingDecision === 1
                  ? t('person.step.failures.one')
                  : t('person.step.failures.many', { n: report.queues.failuresNeedingDecision })}
              </li>
            )}
          </ul>
        )}
      </section>

      <section>
        <H className={heading}>{t('migrationReport.removed.heading')}</H>
        <p className="mt-1 text-sm text-gray-700">
          {report.applied
            ? t('migrationReport.removed.counts', {
                deletions: number(report.applied.deletionsApplied),
                relocations: number(report.applied.relocationsApplied),
                refused: number(report.applied.refused),
              })
            : t('migrationReport.removed.inTheLog')}
        </p>
      </section>

      {report.sharing && (
        <section>
          <H className={heading}>{t('migrationReport.sharing.heading')}</H>
          <p className="mt-1 text-sm text-gray-700">
            {t('migrationReport.sharing.counts', {
              applied: number(report.sharing.applied),
              manual: number(report.sharing.doneManual),
              skipped: number(report.sharing.skipped),
              open: number(report.sharing.open),
            })}
          </p>
        </section>
      )}

      <section>
        <H className={heading}>{t('migrationReport.check.heading')}</H>
        <p className="mt-1 text-sm text-gray-700" data-check>
          {checkSentence()}
        </p>
        {result && (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className={`${th} ${gap}`}>{t('migrationReport.col.type')}</th>
                  <th className={`${th} ${gap} text-right`}>{t('migrationReport.check.col.old')}</th>
                  <th className={`${th} ${gap} text-right`}>{t('migrationReport.check.col.new')}</th>
                  <th className={th}>{t('migrationReport.check.col.contents')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((d) => {
                  const c = result[CHECKED_AS[d.domain]];
                  if (!c || c.status === 'SKIPPED') return null;
                  return (
                    <tr key={d.domain} className="border-t border-gray-100" data-checked={d.domain}>
                      <td className={`py-1.5 ${gap} whitespace-nowrap text-gray-900`}>
                        <DataTypeLabel domain={d.domain} size={16} />
                      </td>
                      <td className={`${num} ${gap}`}>{number(c.sourceCount)}</td>
                      <td className={`${num} ${gap}`}>{number(c.targetCount)}</td>
                      <td className="py-1.5 text-gray-700">
                        {t('migrationReport.check.compared', {
                          matched: number(c.checksumMatches),
                          sampled: number(c.checksumSampleSize),
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {access.length > 0 && (
        <section>
          <H className={heading}>{t('migrationReport.access.heading')}</H>
          <p className="mt-1 text-sm text-gray-700">{t('migrationReport.access.lead')}</p>
          <ul className="mt-2 space-y-2 text-sm">
            {access.map((a) => (
              <li key={a.id} className="rounded border border-gray-200 p-3">
                {/* Our descriptions are written in lower case ("your mail provider's…"), and a heading
                    starts with a capital; a provider's label already does, so it stays as it is. */}
                <p className="font-medium text-gray-900">
                  {a.heading.charAt(0).toLocaleUpperCase(locale) + a.heading.slice(1)}
                </p>
                <p className="mt-1 text-gray-700">{a.body}</p>
                <p className="mt-1 text-xs text-gray-500">{a.where}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-gray-500">{t('migrationReport.asOf', { when: dateTime(report.generatedAt) })}</p>
    </div>
  );
};
