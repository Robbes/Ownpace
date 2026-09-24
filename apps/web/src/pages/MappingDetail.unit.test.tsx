// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One migration's hub (workplan 0019 T4).
 *
 * The links ARE the deliverable: before this page, every per-mapping operating
 * screen was reachable only by typing an address. So these tests pin the five
 * destinations — and that the links survive the detail read failing, because
 * navigation degrading to a dead end would recreate the problem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';

const { mappingApiGet, fetchStatusMock, editionFlag } = vi.hoisted(() => ({
  mappingApiGet: vi.fn(),
  fetchStatusMock: vi.fn(),
  editionFlag: { selfhost: false },
}));

vi.mock('../services/mapping-service', () => ({
  mappingApi: { get: mappingApiGet },
}));

// VITE_EDITION is baked in by vite `define` (edition.unit.test.ts explains why
// stubbing the env at runtime cannot work), so component-level edition tests
// mock the module — the edition helpers keep their own pure tests.
vi.mock('../services/edition', () => ({
  isSelfHost: () => editionFlag.selfhost,
}));

// The runs panel has its own tests (RunsPanel.unit.test.tsx); here it only
// needs to not fetch over the network while the hub's links are asserted.
vi.mock('../services/operating-service', () => ({
  fetchRuns: vi.fn().mockResolvedValue({ runs: [] }),
  fetchStatus: fetchStatusMock,
}));

import MappingDetail, {
  progressRefetchInterval,
  PROGRESS_POLL_ACTIVE_MS,
  PROGRESS_POLL_IDLE_MS,
} from './MappingDetail.tsx';

/**
 * A detail payload the way the route actually answers one.
 *
 * The fixtures here were minimal — `{name, status}` and whatever the test under
 * it looked at — which was fine while the page read only those. It stopped
 * being fine when the page grew the export-policy panel (0125 T3): that asks
 * what the migration CARRIES, and `syncConfig` is a field `MappingSchema`
 * requires, so no real payload can arrive without it. A double thinner than the
 * schema is the test's defect and not the page's, and it shows up as a crash in
 * a screen that works.
 */
function aMapping(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acme-mail',
    name: 'Acme mail',
    status: 'active',
    sourceType: 'imap',
    targetType: 'jmap',
    sourceConfig: {},
    targetConfig: {},
    syncConfig: { domains: ['email'] },
    domainStatus: [],
    ...overrides,
  };
}

function renderHub(id = 'acme-mail') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/mappings/${id}`]}>
        <Routes>
          <Route path="/mappings/:id" element={<MappingDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  editionFlag.selfhost = false;
  mappingApiGet.mockResolvedValue(aMapping());
  fetchStatusMock.mockResolvedValue({ status: 'ok', mappings: [] });
});

describe('the per-mapping navigation', () => {
  it('links every operating screen for THIS mapping, in the cutover order', async () => {
    renderHub();

    // Numbered since 0034 T4 — the list IS the cutover sequence and says so.
    expect(await screen.findByText('1. Deletions')).toBeInTheDocument();
    expect(screen.getByText(/in cutover order/)).toBeInTheDocument();
    const expected: Record<string, string> = {
      Deletions: '/mappings/acme-mail/deletions',
      Moves: '/mappings/acme-mail/moves',
      Failures: '/mappings/acme-mail/failures',
      Check: '/mappings/acme-mail/verify',
      Finish: '/mappings/acme-mail/finish',
    };
    for (const [name, href] of Object.entries(expected)) {
      const link = screen.getByRole('link', { name: new RegExp(name) });
      expect(link.getAttribute('href')).toBe(href);
    }
  });

  it('shows the mapping name when the detail read succeeds', async () => {
    renderHub();
    expect(await screen.findByRole('heading', { name: 'Acme mail' })).toBeInTheDocument();
  });

  it('keeps every link working when the detail read fails — navigation never dead-ends', async () => {
    mappingApiGet.mockRejectedValue(new Error('boom'));
    renderHub();

    expect(
      await screen.findByText(/Could not read this migration's details/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Finish/ }).getAttribute('href')).toBe(
      '/mappings/acme-mail/finish',
    );
  });
});

/**
 * The live per-domain strip (0033 T5): one component, two data sources —
 * managed from GET /migrations/{id}'s domainStatus, selfhost from the
 * appliance-wide /status filtered to this mapping. Both payloads are
 * DomainStatusReport rows built by the same shared function; the managed
 * test pins the RETRYING count specifically, because raw MigrationStatus
 * rows lacked it and the strip silently rendered nothing there before.
 */
describe('a grant the person took back (0108 T8 (c))', () => {
  it('says so above the progress, with the day, and what brings the migration back', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ grantWithdrawnAt: '2026-09-24T06:00:00.000Z' }));
    renderHub();

    expect(await screen.findByText(/the person being migrated withdrew their access/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing reads their account now/)).toBeInTheDocument();
    expect(screen.getByText(/create a grant link below and send it to them/)).toBeInTheDocument();
  });

  it('says nothing about a migration whose grant stands', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ grantWithdrawnAt: null }));
    renderHub();

    expect(await screen.findByRole('heading', { name: 'Acme mail' })).toBeInTheDocument();
    expect(screen.queryByText(/withdrew their access/)).not.toBeInTheDocument();
  });
});

describe('whose account, on each side (owner, 2026-09-17)', () => {
  /**
   * *"in the migration overview or 'Migration Details' view ... it doesnt list
   * the username within the source and username within target ... please that
   * those in this overview."*
   *
   * The name is what somebody typed and can be anything — "G to Sov", "test".
   * The address is the fact: which mailbox is read, which account is written
   * to. It was already on the wire and no screen printed it.
   */
  it('prints the connection name AND the account beside it', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({
        sourceType: 'google',
        targetType: 'nextcloud',
        sourceConnection: { id: 'c1', name: 'Acme Google', kind: 'google' },
        targetConnection: { id: 'c2', name: 'Anna’s Nextcloud', kind: 'nextcloud' },
        sourceConfig: { username: 'owner@acme.example' },
        targetConfig: { username: 'anna@nc.example' },
      }),
    );
    renderHub();
    expect(
      await screen.findByText(
        /From Acme Google \(owner@acme\.example\) to Anna’s Nextcloud \(anna@nc\.example\)/,
      ),
    ).toBeInTheDocument();
  });

  it('prints no empty brackets where the account is not known', async () => {
    // An older row, or a kind that stores neither. "Acme Google ()" would read
    // as a connection with no account rather than a page that cannot say.
    mappingApiGet.mockResolvedValue(
      aMapping({
        sourceType: 'google',
        targetType: 'nextcloud',
        sourceConnection: { id: 'c1', name: 'Acme Google', kind: 'google' },
      }),
    );
    renderHub();
    expect(await screen.findByText(/From Acme Google to nextcloud/)).toBeInTheDocument();
    expect(screen.queryByText(/\(\)/)).toBeNull();
  });
});

/**
 * THE SCREEN BEHIND THE REMEDY IS ON THIS PAGE (0125 T3).
 *
 * The panel has its own tests; this one is about the wiring, which is the half
 * that was missing for a month: `nativeFilePolicy` existed, the engine read it,
 * the create door stored it — and the only screen that could set it was the
 * creation wizard. A component nobody renders is the same defect one file
 * along, so the page asserts it renders one, with the policy the mapping holds.
 */
describe('the export-policy panel', () => {
  it('shows the policy this migration is running under', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({
        sourceType: 'google',
        syncConfig: { domains: ['file', 'email'] },
        sourceConfig: { username: 'owner@acme.test', nativeFilePolicy: 'export-pdf' },
      }),
    );
    renderHub();
    const select = await screen.findByLabelText('Google Docs');
    expect((select as HTMLSelectElement).value).toBe('export-pdf');
  });

  /**
   * THE WHOLE SOURCE CONFIG REACHES THE PANEL (workplan 0042 T9), not the
   * single format alone: handed only that, the panel would show "Office" for
   * decks the migration exports as `.odp`.
   */
  it('shows a kind’s own format where the migration has one', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({
        sourceType: 'google',
        syncConfig: { domains: ['file'] },
        sourceConfig: {
          username: 'owner@acme.test',
          nativeFilePolicy: 'export-office',
          nativeFilePolicies: { presentation: 'export-odf' },
        },
      }),
    );
    renderHub();
    const slides = await screen.findByLabelText('Google Slides');
    expect((slides as HTMLSelectElement).value).toBe('export-odf');
    expect((screen.getByLabelText('Google Docs') as HTMLSelectElement).value).toBe(
      'export-office',
    );
  });

  it('is absent from a migration with no Google files to decide about', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ sourceType: 'imap' }));
    renderHub();
    // The hub's own content still arrives, so this is "the panel is not here"
    // rather than "nothing rendered".
    expect(await screen.findByText(/cutover order/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Google Docs')).toBeNull();
  });
});

describe('the live progress strip', () => {
  const emailDomain = {
    domain: 'email',
    state: 'in_progress',
    itemsSynced: 42,
    itemsFailed: 3,
    bytesTransferred: 1024,
    itemsRetrying: 2,
    itemsNeedingDecision: 1,
    lastSyncedAt: '2026-08-09T10:00:00.000Z',
    lastError: 'IMAP LIST failed: connection reset',
  };

  it('managed: renders the strip from the detail payload, retrying count included', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ domainStatus: [emailDomain] }));
    renderHub();

    expect(await screen.findByText('42 synced')).toBeInTheDocument();
    expect(screen.getByText('3 failed')).toBeInTheDocument();
    expect(screen.getByText('2 retrying')).toBeInTheDocument();
    // The per-domain as-of (0036 T1) — must render from BOTH editions'
    // payloads or the strip becomes a single-edition feature (hard rule 5).
    expect(screen.getByText(/last synced/)).toBeInTheDocument();
    // The error verbatim — the prose boundary.
    expect(screen.getByText('IMAP LIST failed: connection reset')).toBeInTheDocument();
    expect(fetchStatusMock).not.toHaveBeenCalled();
  });

  it('selfhost: renders the strip from /status filtered to THIS mapping', async () => {
    editionFlag.selfhost = true;
    fetchStatusMock.mockResolvedValue({
      status: 'ok',
      mappings: [
        { mappingId: 'other-mapping', migrationStatus: 'active', domains: [{ ...emailDomain, itemsSynced: 999 }] },
        { mappingId: 'acme-mail', migrationStatus: 'active', domains: [emailDomain] },
      ],
    });
    renderHub();

    expect(await screen.findByText('42 synced')).toBeInTheDocument();
    expect(screen.getByText(/last synced/)).toBeInTheDocument();
    // The other mapping's numbers must not leak into this hub.
    expect(screen.queryByText('999 synced')).not.toBeInTheDocument();
    expect(mappingApiGet).not.toHaveBeenCalled();
  });
});

/**
 * HOW FAST THE LIVE STRIP ASKS AGAIN.
 *
 * `a-live-progress-that-needed-f5` holds that every source the strip reads
 * HAS an interval; this holds what that interval is. The two halves are
 * deliberately apart: the guard reads the page's wiring and would still pass
 * if the rate were nonsense, and these cases would still pass if the rate
 * were never wired to anything.
 */
describe('the live strip\'s refresh rate', () => {
  it('runs fast while any domain is still moving', () => {
    for (const moving of ['pending', 'in_progress']) {
      expect(
        progressRefetchInterval([{ state: 'completed' }, { state: moving }]),
        `one ${moving} domain should have earned the fast rate`,
      ).toBe(PROGRESS_POLL_ACTIVE_MS);
    }
  });

  it('drops to the idle rate when nothing is moving', () => {
    expect(
      progressRefetchInterval([{ state: 'completed' }, { state: 'failed' }, { state: 'skipped' }]),
    ).toBe(PROGRESS_POLL_IDLE_MS);
  });

  it('keeps asking when there is nothing to show yet', () => {
    // NOT `false`. A migration started from another screen has to appear here
    // without a reload too — that is the same bug one step further out, and
    // stopping on an empty list is how it would come back.
    for (const nothing of [undefined, []]) {
      expect(progressRefetchInterval(nothing)).toBe(PROGRESS_POLL_IDLE_MS);
    }
  });

  it('polls faster when active than when idle, whatever the numbers become', () => {
    expect(PROGRESS_POLL_ACTIVE_MS).toBeLessThan(PROGRESS_POLL_IDLE_MS);
  });
});
