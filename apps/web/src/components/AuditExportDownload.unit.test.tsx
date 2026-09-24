// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE AUDIT EXPORT, DOWNLOADED ON THE OPERATOR'S OWN SESSION (workplan 0129
 * T4, the managed half): the panel under the operator's log.
 *
 *  - it fetches page after page, from the cursor in the field or from the
 *    first event, until the API says it has caught up, and saves them as one
 *    file, oldest first;
 *  - the field then holds the cursor after the last line, so the next download
 *    carries on from there;
 *  - nothing new saves no file, and says so;
 *  - a download that stops part-way saves what it fetched, says why in the
 *    server's own words, and leaves the field where to carry on;
 *  - a page with no lines ends it, whatever the page says about catching up.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STRINGS } from '../i18n/strings.ts';
import { readAuditExportPage, type AuditExportPage } from '../services/support.ts';
import { AuditExportDownload } from './AuditExportDownload.tsx';

vi.mock('../services/support.ts', () => ({ readAuditExportPage: vi.fn() }));

const EN = STRINGS.en;
const pageMock = vi.mocked(readAuditExportPage);

const ID = (n: string) => `0e2d0000-e29b-41d4-a716-4466554401${n}`;
const line = (n: string) => `{"Body":"share.decided","Attributes":{"ownpace.audit.id":"${ID(n)}"}}\n`;
const cursor = (n: string) => `1788343200000000${n}000-${ID(n)}`;
const page = (text: string, next: string, caughtUp: boolean): AuditExportPage => ({
  text,
  lines: text.split('\n').filter(Boolean).length,
  next,
  caughtUp,
});

let saved: Blob[];
let names: string[];

/** What a saved file holds, read the way jsdom can. */
const textOf = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

beforeEach(() => {
  pageMock.mockReset();
  saved = [];
  names = [];
  // Where the browser would save it: the name it would save it under.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  // jsdom has no object URLs: the file is caught where the browser would save it.
  Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => {
      saved.push(blob);
      return 'blob:audit';
    }),
    revokeObjectURL: vi.fn(),
  });
});

const field = () => screen.getByLabelText(EN['support.export.after']) as HTMLInputElement;
const download = () => userEvent.click(screen.getByRole('button', { name: EN['support.export.download'] }));

describe('the audit export, downloaded on the operator’s own session', () => {
  it('fetches every page from the first event until caught up, and saves them as one file', async () => {
    pageMock
      .mockResolvedValueOnce(page(line('01') + line('02'), cursor('02'), false))
      .mockResolvedValueOnce(page(line('03'), cursor('03'), true));
    render(<AuditExportDownload />);

    await download();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Lines downloaded: 3.'));
    expect(pageMock.mock.calls).toEqual([[''], [cursor('02')]]);
    expect(saved).toHaveLength(1);
    expect(await textOf(saved[0]!)).toBe(line('01') + line('02') + line('03'));
    expect(saved[0]!.type).toBe('application/x-ndjson');
    expect(names).toEqual([expect.stringMatching(/^ownpace-audit-\d{4}-\d{2}-\d{2}T\d{4}\.ndjson$/)]);
    expect(field().value).toBe(cursor('03'));
  });

  it('starts after the cursor in the field, and carries on from where it ended the next time', async () => {
    pageMock
      .mockResolvedValueOnce(page(line('05'), cursor('05'), true))
      .mockResolvedValueOnce(page('', cursor('05'), true));
    render(<AuditExportDownload />);

    await userEvent.type(field(), `  ${cursor('04')} `);
    await download();
    await waitFor(() => expect(field().value).toBe(cursor('05')));
    await download();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(EN['support.export.nothing']));
    expect(pageMock.mock.calls).toEqual([[cursor('04')], [cursor('05')]]);
    // The second found nothing new, and saved nothing.
    expect(saved).toHaveLength(1);
  });

  it('a download that stops part-way saves what it fetched, in the server’s words, and says where to carry on', async () => {
    pageMock.mockResolvedValueOnce(page(line('01'), cursor('01'), false)).mockRejectedValueOnce(
      new AxiosError('Request failed with status code 500', '500', undefined, undefined, {
        status: 500,
        statusText: 'Internal Server Error',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { error: 'Internal server error', message: 'The audit export could not be read.' },
      }),
    );
    render(<AuditExportDownload />);

    await download();

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The download stopped: The audit export could not be read. Lines saved: 1.',
      ),
    );
    expect(await textOf(saved[0]!)).toBe(line('01'));
    expect(field().value).toBe(cursor('01'));
  });

  it('a page with no lines ends it, whatever the page says about catching up', async () => {
    pageMock.mockResolvedValueOnce(page('', '', false));
    render(<AuditExportDownload />);

    await download();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(EN['support.export.nothing']));
    expect(pageMock).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([]);
  });
});
