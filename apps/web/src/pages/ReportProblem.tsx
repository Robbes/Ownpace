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
 * The report becomes a ticket on the owner's helpdesk, or, on a service with no
 * helpdesk, a mail to its support mailbox (the owner, for the alpha,
 * 2026-09-28). The reply comes by email either way, so the page says which
 * address before it is sent, and afterwards names the ticket's number, or the
 * report's reference when there is no ticket.
 *
 * The screenshot (the owner's "yes, build 1 and 2", 2026-09-28): a closed fold
 * under the field says how to make one on each kind of device, and a picture
 * can be chosen, dropped, or pasted anywhere on the page, since most of those
 * ways put it on the clipboard and paste is quicker than finding the file.
 * Every way goes through the same checks (`choose`), the page says which
 * picture is attached, and it can be removed. A paste that carries text, into
 * a place that takes text, stays the text's
 * (`a-screenshot-anyone-can-make.unit.test.tsx`).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FAILURE_CATEGORIES } from '@openmig/shared';
import { useT } from '../i18n/index.tsx';
import { formatBytes } from '../i18n/bytes.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { serverMessage } from '../services/api.ts';
import {
  fetchReportingAvailable,
  refusedAsTooLarge,
  REPORT_TIMEOUT_MS,
  reportablePage,
  sendProblemReport,
  timedOut,
} from '../services/problem-report-service.ts';

export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const REFERENCE = /^[0-9a-f]{8}$/;
/** The pictures a report takes; the API checks each by its first bytes again. */
const PICTURE_TYPES: readonly string[] = ['image/png', 'image/jpeg'];

/**
 * The file a paste or a drop carries, a PNG or a JPEG before any other.
 * Another file is still returned, so that `choose` refuses it with the
 * sentence a chosen one gets; undefined when it carries no file at all.
 * Browsers give a pasted picture in `files`, in `items`, or in both.
 */
function carriedFile(data: DataTransfer | null): File | undefined {
  if (!data) return undefined;
  const files = [
    ...Array.from(data.files),
    ...Array.from(data.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null),
  ];
  return files.find((file) => PICTURE_TYPES.includes(file.type)) ?? files[0];
}

/** Whether a paste lands where text goes: the description, or any other text box. */
function takesText(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !['file', 'button', 'submit', 'checkbox', 'radio'].includes(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

/** `navigator.clipboard.read`, where this browser has it; the Paste button shows only then. */
function clipboardRead(): (() => Promise<ClipboardItems>) | undefined {
  const clipboard = (navigator as { clipboard?: Partial<Clipboard> }).clipboard;
  const read = clipboard?.read;
  return typeof read === 'function' ? () => read.call(clipboard) : undefined;
}

/** The picture on the clipboard as a file, a PNG or a JPEG before any other image. */
async function clipboardPicture(items: ClipboardItems): Promise<File | undefined> {
  const offered = items.flatMap((item) => item.types.map((type) => ({ item, type })));
  const found =
    offered.find(({ type }) => PICTURE_TYPES.includes(type)) ?? offered.find(({ type }) => type.startsWith('image/'));
  if (!found) return undefined;
  const blob = await found.item.getType(found.type);
  const extension = found.type === 'image/jpeg' ? 'jpg' : found.type.slice('image/'.length);
  return new File([blob], `screenshot.${extension}`, { type: found.type });
}

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
  const [dragging, setDragging] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);

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

  const choose = useCallback(
    (file: File | undefined) => {
      setScreenshotProblem(undefined);
      setScreenshot(undefined);
      if (!file) return;
      if (!PICTURE_TYPES.includes(file.type)) {
        setScreenshotProblem(t('report.screenshotType'));
        return;
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        setScreenshotProblem(t('report.screenshotTooBig'));
        return;
      }
      setScreenshot(file);
    },
    [t],
  );

  /**
   * A picture that came some other way than the chooser: the chooser is
   * emptied, so it never shows a file that is not the one attached.
   */
  const take = useCallback(
    (file: File) => {
      if (chooser.current) chooser.current.value = '';
      choose(file);
    },
    [choose],
  );

  const remove = () => {
    if (chooser.current) chooser.current.value = '';
    choose(undefined);
    chooser.current?.focus();
  };

  const read = clipboardRead();
  const pasteFromClipboard = async (readClipboard: () => Promise<ClipboardItems>) => {
    setScreenshotProblem(undefined);
    let picture: File | undefined;
    try {
      picture = await clipboardPicture(await readClipboard());
    } catch {
      // Refused by the browser or the person, or unreadable: said, and the
      // keyboard's paste still works.
      setScreenshotProblem(t('report.screenshotPasteFailed'));
      return;
    }
    if (!picture) {
      setScreenshotProblem(t('report.screenshotPasteEmpty'));
      return;
    }
    take(picture);
  };

  // A picture pasted anywhere on the page, or dropped on it, while the form is
  // on screen. A drop that missed the field is taken too, rather than left to
  // the browser, which would open the picture in place of the form.
  const formShown = available.data !== false && !send.isSuccess;
  useEffect(() => {
    if (!formShown) return;
    const onPaste = (e: ClipboardEvent) => {
      // Text pasted into the description is the text's, even when a picture
      // comes with it (a copy from Word or Excel carries both).
      if (takesText(e.target) && (e.clipboardData?.getData('text/plain') ?? '') !== '') return;
      const file = carriedFile(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      take(file);
    };
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      // Left the window, not only one element for the next.
      if (e.relatedTarget === null) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      setDragging(false);
      const file = carriedFile(e.dataTransfer);
      if (!file) return;
      e.preventDefault();
      take(file);
    };
    document.addEventListener('paste', onPaste);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [formShown, take]);

  const field =
    'block w-full px-3 py-2 border border-gray-300 text-gray-900 rounded-md ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm';
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
          {'ticket' in send.data
            ? t('report.sent', { ticket: send.data.ticket, email: email ?? '' })
            : t('report.sent.mail', { reference: send.data.reference, email: email ?? '' })}
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

        <div
          className={
            'rounded-md border-2 border-dashed p-3 ' +
            (dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300')
          }
        >
          <label htmlFor="report-screenshot" className={label}>
            {t('report.screenshot')}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={chooser}
              id="report-screenshot"
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => choose(e.target.files?.[0])}
              className="block text-sm text-gray-700"
            />
            {read && (
              <button
                type="button"
                onClick={() => void pasteFromClipboard(read)}
                className="px-3 py-1 rounded-md border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50"
              >
                {t('report.screenshotPaste')}
              </button>
            )}
          </div>
          <p className={hint}>{t('report.screenshotHint')}</p>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer select-none text-gray-600 hover:text-gray-900">
              {t('report.screenshotHelp')}
            </summary>
            <ul className="mt-2 ml-5 list-disc space-y-1 text-gray-700">
              <li>{t('report.screenshotHelp.windows')}</li>
              <li>{t('report.screenshotHelp.mac')}</li>
              <li>{t('report.screenshotHelp.iphone')}</li>
              <li>{t('report.screenshotHelp.android')}</li>
              <li>{t('report.screenshotHelp.chromebook')}</li>
            </ul>
            <p className="mt-2 text-gray-700">{t('report.screenshotHelp.check')}</p>
          </details>
          {screenshot && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p role="status" className="text-sm text-gray-900">
                {t('report.screenshotAttached', { name: screenshot.name, size: formatBytes(screenshot.size) })}
              </p>
              <button
                type="button"
                onClick={remove}
                className="text-sm text-blue-700 underline hover:text-blue-900"
              >
                {t('report.screenshotRemove')}
              </button>
            </div>
          )}
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
            {/* A 413 from any front says so in its own words, or in HTML, and
                a timeout in axios's English: these say what each means, in
                the reader's language. */}
            {refusedAsTooLarge(send.error)
              ? t('report.tooLarge')
              : timedOut(send.error)
                ? t('report.timedOut', { minutes: REPORT_TIMEOUT_MS / 60_000 })
                : serverMessage(send.error)}
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
