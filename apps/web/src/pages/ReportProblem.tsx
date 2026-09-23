// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Report a problem" (workplan 0130 T1): what the person writes, and what goes
 * with it, said before anything is sent.
 *
 * Reached from the link beside Sign out, which carries the page the person was
 * on as `?from=`, and later from the failure line (T3), which also carries the
 * error's category and reference. All three come from a URL anybody can edit,
 * so each is checked here: the page is shown and sent as a report records it
 * (no link secret, no query), a reference only in its own shape, and a category
 * only if it is one this product has. The server checks each again.
 *
 * The report becomes a ticket on the owner's helpdesk, and the reply comes by
 * email, so the page says which address before it is sent.
 */

import React, { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FAILURE_CATEGORIES } from '@openmig/shared';
import { useT } from '../i18n/index.tsx';
import { useAuthStore } from '../stores/auth-store.ts';
import { serverMessage } from '../services/api.ts';
import {
  fetchReportingAvailable,
  reportablePage,
  sendProblemReport,
} from '../services/problem-report-service.ts';

export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const REFERENCE = /^[0-9a-f]{8}$/;

/** The file's bytes as base64, without the data-URL prefix. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const ReportProblem: React.FC = () => {
  const t = useT();
  const [search] = useSearchParams();
  const email = useAuthStore((s) => s.user?.email);

  const from = search.get('from') ?? '';
  const page = reportablePage(from.startsWith('/') ? from : '/');
  const askedReference = search.get('reference') ?? '';
  const reference = REFERENCE.test(askedReference) ? askedReference : undefined;
  const askedCategory = search.get('category') ?? '';
  const category = (FAILURE_CATEGORIES as readonly string[]).includes(askedCategory) ? askedCategory : undefined;

  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<File | undefined>();
  const [screenshotProblem, setScreenshotProblem] = useState<string | undefined>();

  const available = useQuery({ queryKey: ['problem-reports', 'available'], queryFn: fetchReportingAvailable });

  const send = useMutation({
    mutationFn: async () =>
      sendProblemReport({
        description: description.trim(),
        page,
        ...(reference ? { reference } : {}),
        ...(category ? { category } : {}),
        ...(screenshot ? { screenshot: { data: await readAsBase64(screenshot) } } : {}),
      }),
  });

  const choose = (file: File | undefined) => {
    setScreenshotProblem(undefined);
    setScreenshot(undefined);
    if (!file) return;
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setScreenshotProblem(t('report.screenshotType'));
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setScreenshotProblem(t('report.screenshotTooBig'));
      return;
    }
    setScreenshot(file);
  };

  const field =
    'block w-full px-3 py-2 border border-gray-300 text-gray-900 rounded-md ' +
    'focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm';
  const label = 'block text-sm font-medium text-gray-700 mb-1';
  const hint = 'mt-1 text-xs text-gray-500';

  if (available.data === false) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{t('report.title')}</h1>
        <p className="text-gray-700">{t('report.unavailable')}</p>
      </div>
    );
  }

  if (send.isSuccess) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{t('report.title')}</h1>
        <p role="status" className="text-gray-900">
          {t('report.sent', { ticket: send.data, email: email ?? '' })}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('report.title')}</h1>
      <p className="text-gray-600 mb-6">{t('report.lead')}</p>
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <div>
          <label htmlFor="report-description" className={label}>
            {t('report.description')}
          </label>
          <textarea
            id="report-description"
            required
            rows={6}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={field}
          />
          <p className={hint}>{t('report.descriptionHint')}</p>
        </div>

        <div>
          <label htmlFor="report-screenshot" className={label}>
            {t('report.screenshot')}
          </label>
          <input
            id="report-screenshot"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => choose(e.target.files?.[0])}
            className="block text-sm text-gray-700"
          />
          <p className={hint}>{t('report.screenshotHint')}</p>
          {screenshotProblem && (
            <p role="alert" className="mt-1 text-sm text-red-700">
              {screenshotProblem}
            </p>
          )}
        </div>

        <div className="rounded-md bg-gray-50 border border-gray-200 p-4 text-sm text-gray-700">
          <p className="font-medium mb-1">{t('report.sentWith')}</p>
          <ul className="list-disc ml-5 space-y-1">
            <li>{t('report.page', { page })}</li>
            {reference && <li>{t('report.reference', { reference })}</li>}
            {category && <li>{t('report.category', { category })}</li>}
          </ul>
          {email && <p className="mt-2">{t('report.replyTo', { email })}</p>}
        </div>

        {send.isError && (
          <p role="alert" className="text-sm text-red-700">
            {serverMessage(send.error)}
          </p>
        )}

        <button
          type="submit"
          disabled={send.isPending || description.trim() === ''}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {send.isPending ? t('report.sending') : t('report.send')}
        </button>
      </form>
    </div>
  );
};

export default ReportProblem;
