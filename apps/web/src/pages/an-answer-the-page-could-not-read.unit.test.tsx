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
 * What must hold, in both languages: a sentence, not JSON; the path, for
 * support; and still a failure, never an empty list (hard rule 9).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Mappings from './Mappings.tsx';
import { mappingApi, MappingListItemSchema } from '../services/mapping-service.ts';
import { fetchAttention, fetchPeople } from '../services/operating-service.ts';
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

const CASES = [
  {
    locale: 'en',
    lead: 'Could not load the migrations list.',
    notEmpty: /No migrations yet/,
    said:
      'The server answered in a form this page does not know. Reload the page; if it stays like this, ' +
      'report it to support, and mention: invalid_value at 2.domains.2.',
    queueLead: 'Could not load this queue.',
  },
  {
    locale: 'nl',
    lead: 'De migratielijst kon niet worden geladen.',
    notEmpty: /Nog geen migraties/,
    said:
      'De server antwoordde in een vorm die deze pagina niet kent. Laad de pagina opnieuw; blijft het zo, ' +
      'meld het en geef daarbij het volgende door: invalid_value bij 2.domains.2.',
    queueLead: 'Deze wachtrij kon niet worden geladen.',
  },
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  vi.mocked(fetchPeople).mockResolvedValue({ people: [], unassigned: [] });
  vi.mocked(fetchAttention).mockResolvedValue({ mappings: [] });
});

describe('an answer the page could not read is a sentence, not zod’s JSON', () => {
  it('reproduces the report: the real schema refuses "contacts" at 2.domains.2', () => {
    const err = theReportedRefusal() as Error;
    // The message the pages used to show.
    expect(err.message).toContain('"code": "invalid_value"');
  });

  for (const c of CASES) {
    it(`Migrations, in ${c.locale}: the sentence and the path, no JSON, and still a failure`, async () => {
      listMock.mockRejectedValue(theReportedRefusal());

      const { container } = inLocale(c.locale, <Mappings />);

      expect(await screen.findByText(c.said)).toBeInTheDocument();
      // Still a failure (hard rule 9): the lead says the list was not read,
      // and nothing claims it is empty.
      expect(screen.getByText(c.lead)).toBeInTheDocument();
      expect(screen.queryByText(c.notEmpty)).not.toBeInTheDocument();
      expect(container.textContent).not.toContain('"code":');
      expect(container.textContent).not.toContain('invalid_value",');
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
    });
  }
});
