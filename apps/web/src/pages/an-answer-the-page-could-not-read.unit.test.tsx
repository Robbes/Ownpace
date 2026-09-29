// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN ANSWER THE PAGE COULD NOT READ, SHOWN AS ZOD'S JSON (reported 2026-09-29).
 *
 * A service that checks an answer with `Schema.parse(response.data)` throws a
 * zod error when the API answers a shape the schema refuses, and the pages
 * rendered that error's message. In zod 4 the message is the pretty-printed
 * JSON of the issue list, so the Migrations page read:
 *
 *   Could not load the migrations list.[ { "code": "invalid_value", "values":
 *   [ "email", "calendar", "contact", "file", "task" ], "path": [ 2, "domains",
 *   2 ], … } ]
 *
 * Seen while taking screenshots with a fixture that sent `"contacts"` where
 * the schema says `"contact"`; in production it is what somebody sees when the
 * API and the web app disagree after a partial deploy.
 *
 * The error here is the REAL one: the reported list through the real
 * `MappingListItemSchema`, so a change to what zod throws reaches this test.
 * What must hold, in both languages: the owner's sentence (2026-09-29), not
 * JSON; a reference, which the server is told once, with where the answer did
 * not fit (the owner's "Log it"); and still a failure, never an empty list
 * (hard rule 9).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Mappings from './Mappings.tsx';
import { mappingApi, MappingListItemSchema } from '../services/mapping-service.ts';
import { fetchAttention, fetchPeople } from '../services/operating-service.ts';
import { forgetUnreadableAnswers } from '../services/unreadable-answer.ts';
import { QueueScreen } from '../components/queues/QueueScreen.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import type { Locale } from '../i18n/strings.ts';

vi.mock('../services/mapping-service', async (importOriginal) => ({
  // The schemas stay real: the error under test is the one they throw.
  ...(await importOriginal<typeof import('../services/mapping-service.ts')>()),
  mappingApi: { list: vi.fn(), triggerSync: vi.fn(), delete: vi.fn(), pause: vi.fn() },
}));
vi.mock('../services/operating-service', () => ({
  fetchPeople: vi.fn(),
  fetchAttention: vi.fn(),
  createPerson: vi.fn(),
  addMigrationToPerson: vi.fn(),
}));

const listMock = vi.mocked(mappingApi.list);
const sent = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));

const item = (id: string, domains: string[]) => ({
  id,
  tenantId: 't1',
  name: `Migration ${id}`,
  sourceType: 'o365',
  targetType: 'jmap',
  status: 'active',
  mode: 'mirror',
  domains,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
});

/** What the reported fixture made the list's parse throw. */
function theReportedRefusal(): unknown {
  try {
    MappingListItemSchema.array().parse([
      item('m1', ['email']),
      item('m2', ['email', 'calendar']),
      item('m3', ['email', 'calendar', 'contacts']),
    ]);
  } catch (err) {
    return err;
  }
  throw new Error('the schema accepted "contacts"; this test no longer reproduces the report');
}

const inLocale = (locale: Locale, ui: React.ReactNode) => {
  window.localStorage.setItem('ownpace.locale', locale);
  return render(
    <LocaleProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/mappings']}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
};

/** The one report sent, as the server receives it. */
async function theReport(): Promise<{ url: string; body: Record<string, unknown> }> {
  await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
  const [url, init] = sent.mock.calls[0]!;
  return { url, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
}

const CASES = [
  {
    locale: 'en',
    lead: 'Could not load the migrations list.',
    notEmpty: /No migrations yet/,
    said: /^The server answered in a form this page does not know\. Reload the page; if it stays like this, report it to support, and mention: reference ([0-9a-f]{8})\.$/,
    queueLead: 'Could not load this queue.',
  },
  {
    locale: 'nl',
    lead: 'De migratielijst kon niet worden geladen.',
    notEmpty: /Nog geen migraties/,
    said: /^De server antwoordde in een vorm die deze pagina niet kent\. Laad de pagina opnieuw; blijft het zo, meld het en geef daarbij het volgende door: referentie ([0-9a-f]{8})\.$/,
    queueLead: 'Deze wachtrij kon niet worden geladen.',
  },
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  forgetUnreadableAnswers();
  vi.stubGlobal('fetch', sent);
  sent.mockImplementation(async () => new Response(null, { status: 204 }));
  vi.mocked(fetchPeople).mockResolvedValue({ people: [], unassigned: [] });
  vi.mocked(fetchAttention).mockResolvedValue({ mappings: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('an answer the page could not read is a sentence, not zod’s JSON', () => {
  it('reproduces the report: the real schema refuses "contacts" at 2.domains.2', () => {
    const err = theReportedRefusal() as Error;
    // The message the pages used to show.
    expect(err.message).toContain('"code": "invalid_value"');
  });

  for (const c of CASES) {
    it(`Migrations, in ${c.locale}: the sentence and a reference, no JSON, and still a failure`, async () => {
      listMock.mockRejectedValue(theReportedRefusal());

      const { container } = inLocale(c.locale, <Mappings />);

      const said = await screen.findByText(c.said);
      // Still a failure (hard rule 9): the lead says the list was not read,
      // and nothing claims it is empty.
      expect(screen.getByText(c.lead)).toBeInTheDocument();
      expect(screen.queryByText(c.notEmpty)).not.toBeInTheDocument();
      expect(container.textContent).not.toContain('"code":');
      expect(container.textContent).not.toContain('invalid_value');

      // The server is told once, under the reference on screen, with where
      // the answer did not fit (the owner's "Log it").
      const reference = c.said.exec(said.textContent ?? '')![1];
      const report = await theReport();
      expect(report.url).toBe('/api/unreadable-answers');
      expect(report.body).toMatchObject({ reference, code: 'invalid_value', path: '2.domains.2' });
    });

    it(`a queue, in ${c.locale}: the render that showed a raw message says the same`, async () => {
      const refusal = theReportedRefusal();
      const { container } = inLocale(
        c.locale,
        <QueueScreen
          title="t"
          intro="i"
          queryKey={`unreadable-${c.locale}`}
          fetcher={() => Promise.reject(refusal)}
          renderMapping={() => null}
        />,
      );

      expect(await screen.findByText(c.said)).toBeInTheDocument();
      expect(screen.getByText(c.queueLead)).toBeInTheDocument();
      expect(container.textContent).not.toContain('"code":');
      await theReport();
    });
  }

  it('keeps showing the same reference, and tells the server once, while the failure stays', async () => {
    listMock.mockRejectedValue(theReportedRefusal());
    const first = inLocale('en', <Mappings />);
    const shownFirst = (await screen.findByText(CASES[0].said)).textContent;
    first.unmount();

    // The same answer refused again, as a page that reads it again would meet it.
    listMock.mockRejectedValue(theReportedRefusal());
    inLocale('en', <Mappings />);
    expect((await screen.findByText(CASES[0].said)).textContent).toBe(shownFirst);
    await theReport();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('shows the sentence all the same when the server cannot be told', async () => {
    sent.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    listMock.mockRejectedValue(theReportedRefusal());

    inLocale('nl', <Mappings />);

    expect(await screen.findByText(CASES[1].said)).toBeInTheDocument();
    expect(screen.getByText(CASES[1].lead)).toBeInTheDocument();
  });
});
