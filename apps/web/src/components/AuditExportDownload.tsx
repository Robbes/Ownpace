// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE AUDIT EXPORT, DOWNLOADED ON THE OPERATOR'S OWN SESSION (workplan 0129
 * T4, the managed half; the owner, 2026-09-24: "an operator-only route using
 * your own session").
 *
 * The managed API accepts a person's sign-in only, so a log store cannot fetch
 * the download itself: the operator fetches it here and hands the file over.
 * Page after page, until the API says it has caught up, saved as one file of
 * lines, oldest first. It starts after the cursor in the field, or at the first
 * event when the field is empty, and ends with the field holding the cursor
 * after the last line, so the next download carries on from there.
 *
 * A download that stops part-way keeps what it fetched: those pages are saved,
 * and the field holds the cursor after the last of them, so nothing has to be
 * fetched twice. Every page is recorded as one read of every customer, which
 * the screen's disclosure already says.
 */

import React from 'react';
import { useT } from '../i18n/index.tsx';
import { readAuditExportPage } from '../services/support.ts';
import { serverMessage } from '../services/api.ts';
import { Hint } from './Hint.tsx';

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy'; readonly lines: number }
  | { readonly kind: 'done'; readonly lines: number }
  | { readonly kind: 'stopped'; readonly lines: number; readonly message: string };

/** The pages as one file, saved the way the browser saves a download. */
function save(pages: readonly string[]): void {
  const url = URL.createObjectURL(new Blob([...pages], { type: 'application/x-ndjson' }));
  const link = document.createElement('a');
  link.href = url;
  // To the minute, so a second download the same day does not replace the first.
  link.download = `ownpace-audit-${new Date().toISOString().slice(0, 16).replace(':', '')}.ndjson`;
  link.click();
  URL.revokeObjectURL(url);
}

export const AuditExportDownload: React.FC = () => {
  const t = useT();
  const [after, setAfter] = React.useState('');
  const [state, setState] = React.useState<State>({ kind: 'idle' });

  const download = async (e: React.FormEvent) => {
    e.preventDefault();
    const pages: string[] = [];
    let cursor = after.trim();
    let lines = 0;
    setState({ kind: 'busy', lines });
    try {
      for (;;) {
        const page = await readAuditExportPage(cursor);
        pages.push(page.text);
        lines += page.lines;
        cursor = page.next || cursor;
        setState({ kind: 'busy', lines });
        if (page.caughtUp || page.lines === 0) break;
      }
      if (lines > 0) save(pages);
      setState({ kind: 'done', lines });
    } catch (error) {
      if (lines > 0) save(pages);
      setState({ kind: 'stopped', lines, message: serverMessage(error) });
    }
    setAfter(cursor);
  };

  const status =
    state.kind === 'busy'
      ? t('support.export.busy', { count: state.lines })
      : state.kind === 'done'
        ? state.lines > 0
          ? t('support.export.done', { count: state.lines })
          : t('support.export.nothing')
        : state.kind === 'stopped'
          ? `${t('support.export.stopped', { message: state.message })}${
              state.lines > 0 ? ` ${t('support.export.kept', { count: state.lines })}` : ''
            }`
          : '';

  return (
    <section className="mt-8" aria-labelledby="audit-export-heading">
      <h2
        id="audit-export-heading"
        className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500"
      >
        {t('support.export.heading')}
      </h2>
      <Hint className="mb-3" text={t('support.export.lead')} why={t('support.export.lead.why')} />
      <form className="flex flex-wrap items-end gap-3" onSubmit={download}>
        <div className="min-w-0 flex-1">
          <label htmlFor="audit-export-after" className="mb-1 block text-xs font-medium text-gray-600">
            {t('support.export.after')}
          </label>
          <input
            id="audit-export-after"
            className={
              'block w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-sm text-gray-900 ' +
              'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500'
            }
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <button
          type="submit"
          disabled={state.kind === 'busy'}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {t('support.export.download')}
        </button>
      </form>
      <p role="status" className="mt-2 text-sm text-gray-700">
        {status}
      </p>
    </section>
  );
};
