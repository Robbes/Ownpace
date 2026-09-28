// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SCREENSHOT ANYONE CAN MAKE (workplan 0130, the owner's "yes, build 1 and
 * 2", 2026-09-28).
 *
 * The report form asked for a screenshot and said nothing about how to make
 * one, and the only way to add it was the file chooser: make a screenshot,
 * find where the system saved it, choose it. Windows+Shift+S, Print Screen, a
 * Chromebook's Ctrl+Show windows and a Mac's Control+Shift+Command+4 all put
 * the picture on the clipboard, and the file, where one is saved at all, sits
 * in a folder the person has to go and find. Now:
 *
 * - **A closed fold under the field**, *How do I make a screenshot?* /
 *   *Hoe maak ik een schermafbeelding?*, with one line for each kind of
 *   device (Windows, Mac, iPhone or iPad, Android, Chromebook) and what to
 *   look at before sending: the picture shows the screen.
 * - **A picture pasted anywhere on the page** (Ctrl+V or Command+V) becomes
 *   the screenshot, through the same type and 5 MB checks as a chosen file,
 *   so a GIF or a picture over 5 MB is refused with the same sentences.
 *   Text pasted into the description still goes into the description: a
 *   paste that carries text, into a place that takes text, is the text's, even
 *   when a picture comes with it (a copy from Word or Excel carries both).
 * - **A picture dropped on the field** is taken the same way.
 * - **What is attached is said**, by its name and size, as a status a
 *   screen reader announces, with a button that removes it.
 * - **A *Paste screenshot* button** where the browser can read a picture from
 *   the clipboard (`navigator.clipboard.read`), and nowhere else. It asks
 *   the browser on the press, which is the gesture the browser wants; a
 *   browser that refuses, or a clipboard with no picture on it, is said so.
 *
 * The link-report form has no screenshot and is not changed.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from '../stores/auth-store.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import { formatBytes } from '../i18n/bytes.ts';
import ReportProblem, { MAX_SCREENSHOT_BYTES } from './ReportProblem.tsx';

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('../services/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api.ts')>();
  return {
    ...actual,
    default: {
      get: (...args: unknown[]) => getMock(...args),
      post: (...args: unknown[]) => postMock(...args),
    },
  };
});

type Locale = 'en' | 'nl';
const LOCALES: readonly Locale[] = ['en', 'nl'];

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);

const renderPage = async (locale: Locale) => {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  render(
    <LocaleProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/report?from=%2F']}>
          <ReportProblem />
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
  return (await screen.findByLabelText(STRINGS[locale]['report.screenshot'])) as HTMLInputElement;
};

// ---------------------------------------------------------------------------
// Pictures, and a clipboard as a browser hands one to a paste or a drop
// ---------------------------------------------------------------------------

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const png = (name = 'image.png') => new File([new Uint8Array(PNG_BYTES)], name, { type: 'image/png' });
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], 'image.jpeg', { type: 'image/jpeg' });
const gif = () => new File(['GIF89a'], 'image.gif', { type: 'image/gif' });
/** A PNG one byte over the form's limit. */
const hugePng = () => {
  const bytes = new Uint8Array(MAX_SCREENSHOT_BYTES + 1);
  bytes.set(PNG_BYTES);
  return new File([bytes], 'huge.png', { type: 'image/png' });
};

/**
 * What a paste or a drop carries, shaped as the browser's `DataTransfer`:
 * the files in both `files` and `items`, as Chrome and Firefox give a
 * picture, and text under `text/plain`.
 */
function carrying({ files = [], text }: { files?: File[]; text?: string }) {
  const items = [
    ...files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f, getAsString: () => undefined })),
    ...(text === undefined
      ? []
      : [{ kind: 'string', type: 'text/plain', getAsFile: () => null, getAsString: (cb: (s: string) => void) => cb(text) }]),
  ];
  return {
    files,
    items,
    types: [...(files.length > 0 ? ['Files'] : []), ...(text === undefined ? [] : ['text/plain'])],
    getData: (format: string) => (text !== undefined && (format === 'text' || format === 'text/plain') ? text : ''),
    dropEffect: 'none',
    effectAllowed: 'all',
  } as unknown as DataTransfer;
}

/** The line that says what is attached, as the page words it. */
const attachedLine = (locale: Locale, file: File) =>
  fill(STRINGS[locale]['report.screenshotAttached'], { name: file.name, size: formatBytes(file.size) });

/** The base64 the form must send for `file`. */
const base64Of = async (file: File) => Buffer.from(await file.arrayBuffer()).toString('base64');

async function sendWith(locale: Locale) {
  const L = STRINGS[locale];
  await userEvent.type(screen.getByLabelText(L['report.description']), 'The Moves screen is empty');
  await userEvent.click(screen.getByRole('button', { name: L['report.send'] }));
  await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
  return postMock.mock.calls[0]![1] as Record<string, unknown>;
}

beforeEach(() => {
  globalThis.localStorage.clear();
  getMock.mockReset();
  postMock.mockReset();
  getMock.mockResolvedValue({ data: { available: true } });
  postMock.mockResolvedValue({ data: { ticket: '31001' } });
  useAuthStore.setState({
    user: { id: 'u1', email: 'someone@example.invalid', name: 'Someone', role: 'owner' },
  });
});

// ---------------------------------------------------------------------------
// How do I make a screenshot?
// ---------------------------------------------------------------------------

describe('How do I make a screenshot?', () => {
  const LINES = ['windows', 'mac', 'iphone', 'android', 'chromebook', 'check'] as const;

  it.each(LOCALES)(
    'is a closed fold under the screenshot field, with a line for each kind of device and what to check (%s)',
    async (locale) => {
      const L = STRINGS[locale];
      const input = await renderPage(locale);
      const summary = screen.getByText(L['report.screenshotHelp']);
      const fold = summary.closest('details');
      expect(fold).not.toBeNull();
      // Under the field: the fold and the chooser are one field, the fold after it.
      expect(fold!.parentElement!.contains(input)).toBe(true);
      expect(input.compareDocumentPosition(fold!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // Closed until asked.
      expect(fold!.open).toBe(false);
      for (const line of LINES) expect(screen.getByText(L[`report.screenshotHelp.${line}`])).not.toBeVisible();

      fireEvent.click(summary);
      for (const line of LINES) expect(screen.getByText(L[`report.screenshotHelp.${line}`])).toBeVisible();
    },
  );

  it.each(LOCALES)('names the keys and buttons each device uses (%s)', (locale) => {
    const L = STRINGS[locale];
    expect(L['report.screenshotHelp.windows']).toMatch(/^Windows: /);
    expect(L['report.screenshotHelp.windows']).toContain('Windows+Shift+S');
    expect(L['report.screenshotHelp.windows']).toContain('Print Screen');
    expect(L['report.screenshotHelp.windows']).toContain('Ctrl+V');
    expect(L['report.screenshotHelp.mac']).toMatch(/^Mac: /);
    expect(L['report.screenshotHelp.mac']).toContain('Shift+Command+4');
    expect(L['report.screenshotHelp.mac']).toContain('Control+Shift+Command+4');
    expect(L['report.screenshotHelp.mac']).toContain('Command+V');
    expect(L['report.screenshotHelp.iphone']).toMatch(/^iPhone (or|of) iPad: /);
    expect(L['report.screenshotHelp.android']).toMatch(/^Android: /);
    expect(L['report.screenshotHelp.chromebook']).toMatch(/^Chromebook: /);
    expect(L['report.screenshotHelp.chromebook']).toContain('Ctrl+');
  });

  it('says the same in Dutch, in the u-form, and not the English again', () => {
    const keys = ['report.screenshotHelp', ...LINES.map((l) => `report.screenshotHelp.${l}` as const)] as const;
    for (const key of keys) {
      expect(STRINGS.nl[key], key).not.toBe(STRINGS.en[key]);
      expect(STRINGS.nl[key], key).not.toMatch(/\b(je|jij|jouw)\b/i);
    }
    expect(STRINGS.nl['report.screenshotHelp']).toBe('Hoe maak ik een schermafbeelding?');
    expect(STRINGS.en['report.screenshotHelp']).toBe('How do I make a screenshot?');
    // The buttons as each vendor names them in the language.
    expect(STRINGS.en['report.screenshotHelp.iphone']).toMatch(/side or top button/);
    expect(STRINGS.en['report.screenshotHelp.iphone']).toMatch(/volume up/);
    expect(STRINGS.en['report.screenshotHelp.iphone']).toMatch(/Home button/);
    expect(STRINGS.nl['report.screenshotHelp.iphone']).toMatch(/zij- of bovenknop/);
    expect(STRINGS.nl['report.screenshotHelp.iphone']).toMatch(/volume omhoog/);
    expect(STRINGS.nl['report.screenshotHelp.iphone']).toMatch(/thuisknop/);
    expect(STRINGS.en['report.screenshotHelp.android']).toMatch(/power and volume down/);
    expect(STRINGS.nl['report.screenshotHelp.android']).toMatch(/aan\/uit-knop en volume omlaag/);
    expect(STRINGS.en['report.screenshotHelp.chromebook']).toContain('Ctrl+Show windows');
    expect(STRINGS.nl['report.screenshotHelp.chromebook']).toContain('Ctrl+Vensters weergeven');
  });
});

// ---------------------------------------------------------------------------
// Paste
// ---------------------------------------------------------------------------

describe('a picture pasted on the page', () => {
  it.each(LOCALES)('attaches a pasted PNG, says so, and sends it (%s)', async (locale) => {
    await renderPage(locale);
    const picture = png();
    await userEvent.paste(carrying({ files: [picture] }));

    expect(await screen.findByRole('status')).toHaveTextContent(attachedLine(locale, picture));
    expect(screen.queryByRole('alert')).toBeNull();
    const body = await sendWith(locale);
    expect(body.screenshot).toEqual({ data: await base64Of(picture) });
  });

  it.each(LOCALES)('attaches a pasted JPEG (%s)', async (locale) => {
    await renderPage(locale);
    const picture = jpeg();
    await userEvent.paste(carrying({ files: [picture] }));

    expect(await screen.findByRole('status')).toHaveTextContent(attachedLine(locale, picture));
    const body = await sendWith(locale);
    expect(body.screenshot).toEqual({ data: await base64Of(picture) });
  });

  it.each(LOCALES)('attaches a picture pasted while the description has the focus (%s)', async (locale) => {
    await renderPage(locale);
    await userEvent.click(screen.getByLabelText(STRINGS[locale]['report.description']));
    const picture = png();
    await userEvent.paste(carrying({ files: [picture] }));

    expect(await screen.findByRole('status')).toHaveTextContent(attachedLine(locale, picture));
    expect(screen.getByLabelText(STRINGS[locale]['report.description'])).toHaveValue('');
  });

  it.each(LOCALES)('puts pasted text into the description and attaches nothing (%s)', async (locale) => {
    await renderPage(locale);
    const description = screen.getByLabelText(STRINGS[locale]['report.description']);
    await userEvent.click(description);
    await userEvent.paste('The Moves screen is empty');

    expect(description).toHaveValue('The Moves screen is empty');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(LOCALES)(
    'puts text into the description even when a picture comes with it, as from Word or Excel (%s)',
    async (locale) => {
      await renderPage(locale);
      const description = screen.getByLabelText(STRINGS[locale]['report.description']);
      await userEvent.click(description);
      await userEvent.paste(carrying({ files: [png()], text: 'Row 3 is missing' }));

      expect(description).toHaveValue('Row 3 is missing');
      expect(screen.queryByRole('status')).toBeNull();
      const body = await sendWith(locale);
      expect(body).not.toHaveProperty('screenshot');
    },
  );

  it.each(LOCALES)('refuses a pasted GIF with the sentence a chosen one gets (%s)', async (locale) => {
    await renderPage(locale);
    await userEvent.paste(carrying({ files: [gif()] }));

    expect(await screen.findByRole('alert')).toHaveTextContent(STRINGS[locale]['report.screenshotType']);
    expect(screen.queryByRole('status')).toBeNull();
    const body = await sendWith(locale);
    expect(body).not.toHaveProperty('screenshot');
  });

  it.each(LOCALES)('refuses a pasted picture over 5 MB with the sentence a chosen one gets (%s)', async (locale) => {
    await renderPage(locale);
    await userEvent.paste(carrying({ files: [hugePng()] }));

    expect(await screen.findByRole('alert')).toHaveTextContent(STRINGS[locale]['report.screenshotTooBig']);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Drop, choose, remove
// ---------------------------------------------------------------------------

describe('a picture dropped on the field', () => {
  it.each(LOCALES)('attaches a dropped PNG and sends it (%s)', async (locale) => {
    const input = await renderPage(locale);
    const picture = png('screen.png');
    fireEvent.dragOver(input, { dataTransfer: carrying({ files: [picture] }) });
    fireEvent.drop(input, { dataTransfer: carrying({ files: [picture] }) });

    expect(await screen.findByRole('status')).toHaveTextContent(attachedLine(locale, picture));
    const body = await sendWith(locale);
    expect(body.screenshot).toEqual({ data: await base64Of(picture) });
  });

  it.each(LOCALES)('refuses a dropped file that is not a PNG or a JPEG (%s)', async (locale) => {
    const input = await renderPage(locale);
    fireEvent.drop(input, {
      dataTransfer: carrying({ files: [new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' })] }),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(STRINGS[locale]['report.screenshotType']);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('what is attached, and taking it off', () => {
  it.each(LOCALES)('names a chosen file too (%s)', async (locale) => {
    const input = await renderPage(locale);
    const picture = png('my-screen.png');
    await userEvent.upload(input, picture);

    expect(await screen.findByRole('status')).toHaveTextContent(attachedLine(locale, picture));
  });

  it.each(LOCALES)('removes the screenshot, and the report goes without it (%s)', async (locale) => {
    const L = STRINGS[locale];
    const input = await renderPage(locale);
    await userEvent.upload(input, png('my-screen.png'));
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: L['report.screenshotRemove'] }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: L['report.screenshotRemove'] })).toBeNull();
    // The chooser is empty again, and has the focus the button had.
    expect(input.files?.length ?? 0).toBe(0);
    expect(input).toHaveFocus();
    const body = await sendWith(locale);
    expect(body).not.toHaveProperty('screenshot');
  });

  it.each(LOCALES)('removes a pasted screenshot the same way (%s)', async (locale) => {
    const L = STRINGS[locale];
    await renderPage(locale);
    await userEvent.paste(carrying({ files: [png()] }));
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: L['report.screenshotRemove'] }));
    expect(screen.queryByRole('status')).toBeNull();
    const body = await sendWith(locale);
    expect(body).not.toHaveProperty('screenshot');
  });
});

// ---------------------------------------------------------------------------
// The Paste screenshot button
// ---------------------------------------------------------------------------

describe('the Paste screenshot button', () => {
  const setClipboard = (read: (() => Promise<unknown>) | undefined) => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: read === undefined ? undefined : { read },
    });
  };
  /** A `ClipboardItem` as `navigator.clipboard.read()` answers with one. */
  const clipboardItem = (blob: Blob) => ({ types: [blob.type], getType: () => Promise.resolve(blob) });

  afterEach(() => {
    setClipboard(undefined);
  });

  it.each(LOCALES)('is not offered where the browser cannot read a picture from the clipboard (%s)', async (locale) => {
    setClipboard(undefined);
    await renderPage(locale);
    expect(screen.queryByRole('button', { name: STRINGS[locale]['report.screenshotPaste'] })).toBeNull();
  });

  it.each(LOCALES)('reads the picture on the press, and attaches it (%s)', async (locale) => {
    const picture = png();
    const read = vi.fn(() => Promise.resolve([clipboardItem(picture)]));
    setClipboard(read);
    await renderPage(locale);
    // Nothing is read before the person asks.
    expect(read).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: STRINGS[locale]['report.screenshotPaste'] }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      fill(STRINGS[locale]['report.screenshotAttached'], { name: 'screenshot.png', size: formatBytes(picture.size) }),
    );
    const body = await sendWith(locale);
    expect(body.screenshot).toEqual({ data: await base64Of(picture) });
  });

  it.each(LOCALES)('refuses a GIF on the clipboard with the sentence a chosen one gets (%s)', async (locale) => {
    setClipboard(() => Promise.resolve([clipboardItem(gif())]));
    await renderPage(locale);
    await userEvent.click(screen.getByRole('button', { name: STRINGS[locale]['report.screenshotPaste'] }));

    expect(await screen.findByRole('alert')).toHaveTextContent(STRINGS[locale]['report.screenshotType']);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(LOCALES)('says there is no picture to paste when the clipboard holds only text (%s)', async (locale) => {
    setClipboard(() => Promise.resolve([clipboardItem(new Blob(['hello'], { type: 'text/plain' }))]));
    await renderPage(locale);
    await userEvent.click(screen.getByRole('button', { name: STRINGS[locale]['report.screenshotPaste'] }));

    expect(await screen.findByRole('alert')).toHaveTextContent(STRINGS[locale]['report.screenshotPasteEmpty']);
  });

  it.each(LOCALES)('says so when the browser will not let the page read the clipboard (%s)', async (locale) => {
    setClipboard(() => Promise.reject(new DOMException('Read permission denied.', 'NotAllowedError')));
    await renderPage(locale);
    await userEvent.click(screen.getByRole('button', { name: STRINGS[locale]['report.screenshotPaste'] }));

    expect(await screen.findByRole('alert')).toHaveTextContent(STRINGS[locale]['report.screenshotPasteFailed']);
    expect(document.body.textContent).not.toContain('permission denied');
  });

  it('says it in Dutch in Dutch, in the u-form', () => {
    for (const key of [
      'report.screenshotAttached',
      'report.screenshotRemove',
      'report.screenshotPaste',
      'report.screenshotPasteEmpty',
      'report.screenshotPasteFailed',
    ] as const) {
      expect(STRINGS.nl[key], key).not.toBe(STRINGS.en[key]);
      expect(STRINGS.nl[key], key).not.toMatch(/\b(je|jij|jouw)\b/i);
    }
  });
});
