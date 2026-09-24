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
 * what goes with it, and what the address is for.
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

interface Props {
  readonly kind: ReportedLink;
  readonly link: string;
  /** The organisation that asked, as the page names it. */
  readonly organisation: string;
  /** What the person can do next, said once the report is sent. */
  readonly next?: StringKey;
}

const ReportThisLink: React.FC<Props> = ({ kind, link, organisation, next }) => {
  const t = useT();
  const formId = useId();
  const sentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [replyTo, setReplyTo] = useState('');

  const available = useQuery({
    queryKey: ['link-report', kind, link],
    queryFn: () => linkReportApi.available(kind, link),
    retry: false,
  });
  const send = useMutation({
    mutationFn: () => linkReportApi.send(kind, link, { description: description.trim(), replyTo: replyTo.trim() }),
  });

  useEffect(() => {
    if (send.isSuccess) sentRef.current?.focus();
  }, [send.isSuccess]);

  if (available.data !== true) return null;

  if (send.isSuccess) {
    return (
      <div
        ref={sentRef}
        tabIndex={-1}
        role="status"
        className="mt-4 p-4 border border-gray-200 rounded-lg text-sm text-gray-900"
      >
        <p>{t('linkReport.sent', { ticket: send.data, email: replyTo.trim() })}</p>
        {next && <p className="mt-2">{t(next)}</p>}
      </div>
    );
  }

  const field =
    'block w-full px-3 py-2 border border-gray-300 text-gray-900 rounded-md ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm';
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => setOpen((was) => !was)}
        className="text-sm underline text-gray-700"
      >
        {t('linkReport.open')}
      </button>
      {open && (
        <form
          id={formId}
          className="mt-3 p-4 border border-gray-200 rounded-lg space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <p className="text-sm text-gray-700">{t('linkReport.intro', { organisation })}</p>
          <div>
            <label htmlFor={`${formId}-description`} className="block text-sm font-medium text-gray-700 mb-1">
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
            <label htmlFor={`${formId}-reply-to`} className="block text-sm font-medium text-gray-700 mb-1">
              {t('linkReport.replyTo')}
            </label>
            <input
              id={`${formId}-reply-to`}
              type="email"
              required
              autoComplete="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              className={field}
            />
            <p className="mt-1 text-xs text-gray-500">{t('linkReport.replyTo.hint')}</p>
          </div>
          <p className="text-sm text-gray-600">{t('linkReport.sentWith')}</p>
          {send.isError && (
            <p role="alert" className="text-sm text-red-700">
              {serverMessage(send.error)}
            </p>
          )}
          <button
            type="submit"
            disabled={send.isPending || description.trim() === '' || replyTo.trim() === ''}
            className="px-4 py-2 rounded-md bg-gray-800 text-white text-sm font-medium hover:bg-gray-900 disabled:opacity-50"
          >
            {send.isPending ? t('linkReport.sending') : t('linkReport.send')}
          </button>
        </form>
      )}
    </div>
  );
};

export default ReportThisLink;
