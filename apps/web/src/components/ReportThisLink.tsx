// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * "Report this link" (workplan 0108 T8 (d); the owner, 2026-09-24: a report
 * goes to *"the problem report forms"*).
 *
 * On the grant page, under the question it answers: *do you know who asked?*
 * A person who does not can tell us instead of continuing. On the progress
 * page too, since that is where somebody who granted and then had doubts comes
 * back to. Offered only where a report can reach somebody.
 *
 * Folded under one line until pressed, and then it says, before anything is
 * sent, where the report goes (to us, never to the organisation that asked),
 * what goes with it, and what the address is for. The address may be left
 * out (the owner, 2026-09-24): a report is taken without one, and the person
 * is told that nobody can then answer them.
 *
 * ## Where the keyboard is
 *
 * These pages are read by somebody's parent, on a phone or with a screen
 * reader (workplan 0145), so pressing must never lose their place. The line
 * is a disclosure: the button stays where it is, says whether the form is
 * open, and the form follows it in the tab order. Sending takes away the
 * button that was pressed, so the answer takes the focus, and is read out.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useT, type StringKey } from '../i18n/index.tsx';
import { serverMessage } from '../services/api.ts';
import { linkReportApi, type ReportedLink } from '../services/link-report-service.ts';
import type { SentReport } from '../services/problem-report-service.ts';
import { usePersonsPage } from './persons-page.tsx';

interface Props {
  readonly kind: ReportedLink;
  readonly link: string;
  /** The organisation that asked, as the page names it. */
  readonly organisation: string;
  /** What the person can do next, said once the report is sent. */
  readonly next?: StringKey;
  /**
   * How it is drawn on a person's own page (workplan 0176 §5.1): a button
   * where it answers something (*Not yet*), and a quiet link at the foot of
   * every other screen. Either way a disclosure: the form follows it.
   */
  readonly look?: 'link' | 'button';
}

const ReportThisLink: React.FC<Props> = ({ kind, link, organisation, next, look = 'link' }) => {
  const t = useT();
  // 18-pixel sentences and targets a finger finds on a person's own page (0176 T9).
  const personsPage = usePersonsPage() !== null;
  const formId = useId();
  const sentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [replyTo, setReplyTo] = useState('');

  const available = useQuery({
    queryKey: ['link-report', kind, link],
    queryFn: () => linkReportApi.available(kind, link),
    retry: false,
    // Asked once a visit: a step of a person's page that draws it again asks
    // nothing more of the server (workplan 0176 T1.2, §5.6).
    staleTime: Infinity,
  });
  const send = useMutation({
    mutationFn: () =>
      linkReportApi.send(kind, link, {
        description: description.trim(),
        ...(replyTo.trim() === '' ? {} : { replyTo: replyTo.trim() }),
      }),
  });

  useEffect(() => {
    if (send.isSuccess) sentRef.current?.focus();
  }, [send.isSuccess]);

  if (available.data !== true) return null;

  /** The ticket's number from a helpdesk, or the report's reference when it went by mail. */
  const sentSentence = (sent: SentReport, email: string): string => {
    if ('ticket' in sent) {
      return email === ''
        ? t('linkReport.sent.anonymous', { ticket: sent.ticket })
        : t('linkReport.sent', { ticket: sent.ticket, email });
    }
    return email === ''
      ? t('linkReport.sent.mail.anonymous', { reference: sent.reference })
      : t('linkReport.sent.mail', { reference: sent.reference, email });
  };

  if (send.isSuccess) {
    return (
      <div
        ref={sentRef}
        tabIndex={-1}
        role="status"
        className={`mt-4 p-4 border border-gray-200 rounded-lg text-gray-900 ${personsPage ? 'text-lg bg-white' : 'text-sm'}`}
      >
        <p>{sentSentence(send.data, replyTo.trim())}</p>
        {next && <p className="mt-2">{t(next)}</p>}
      </div>
    );
  }

  const field = personsPage
    ? 'block w-full min-h-[44px] px-3 py-2 border-2 border-gray-600 text-gray-900 rounded-md text-lg ' +
      'focus:border-blue-700'
    : 'block w-full px-3 py-2 border border-gray-300 text-gray-900 rounded-md ' +
      'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm';
  const opener = !personsPage
    ? 'text-sm underline text-gray-700'
    : look === 'button'
      ? 'block w-full min-h-[60px] px-4 py-3 rounded-lg border-2 border-gray-700 bg-white text-lg font-semibold text-gray-900 hover:bg-gray-50'
      : 'inline-flex min-h-[44px] items-center text-lg underline text-gray-900';
  const small = personsPage ? 'text-lg text-gray-900' : 'text-sm text-gray-700';
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => setOpen((was) => !was)}
        className={opener}
        data-look={look}
        {...(personsPage && look === 'button' ? { 'data-main': true } : {})}
      >
        {t('linkReport.open')}
      </button>
      {open && (
        <form
          id={formId}
          className={`mt-3 p-4 border border-gray-200 rounded-lg space-y-4 ${personsPage ? 'bg-white' : ''}`}
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <p className={small}>{t('linkReport.intro', { organisation })}</p>
          <div>
            <label htmlFor={`${formId}-description`} className={`block font-medium mb-1 ${small}`}>
              {t('linkReport.description')}
            </label>
            <textarea
              id={`${formId}-description`}
              required
              rows={4}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label htmlFor={`${formId}-reply-to`} className={`block font-medium mb-1 ${small}`}>
              {t('linkReport.replyTo')}
            </label>
            <input
              id={`${formId}-reply-to`}
              type="email"
              autoComplete="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              className={field}
            />
            <p className={`mt-1 ${personsPage ? 'text-base text-gray-800' : 'text-xs text-gray-500'}`}>{t('linkReport.replyTo.hint')}</p>
          </div>
          <p className={personsPage ? 'text-lg text-gray-800' : 'text-sm text-gray-600'}>{t('linkReport.sentWith')}</p>
          {send.isError && (
            <p role="alert" className={personsPage ? 'text-lg text-red-800' : 'text-sm text-red-700'}>
              {serverMessage(send.error)}
            </p>
          )}
          <button
            type="submit"
            disabled={send.isPending || description.trim() === ''}
            className={
              personsPage
                ? 'block w-full min-h-[60px] px-4 py-3 rounded-lg bg-gray-800 text-white text-lg font-semibold hover:bg-gray-900 disabled:opacity-50'
                : 'px-4 py-2 rounded-md bg-gray-800 text-white text-sm font-medium hover:bg-gray-900 disabled:opacity-50'
            }
            {...(personsPage ? { 'data-main': true } : {})}
          >
            {send.isPending ? t('linkReport.sending') : t('linkReport.send')}
          </button>
        </form>
      )}
    </div>
  );
};

export default ReportThisLink;
