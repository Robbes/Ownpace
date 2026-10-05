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
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { STRINGS } from '../i18n/strings.ts';

const {
  mappingApiGet,
  mappingRenameMock,
  mappingVisitMock,
  mappingDiscoveryMock,
  fetchAllDiscoveryMock,
  fetchRunsMock,
  fetchStatusMock,
  fetchAttentionMock,
  fetchProgressMock,
  editionFlag,
} = vi.hoisted(() => ({
  mappingApiGet: vi.fn(),
  mappingRenameMock: vi.fn(),
  mappingVisitMock: vi.fn(),
  mappingDiscoveryMock: vi.fn(),
  fetchAllDiscoveryMock: vi.fn(),
  fetchRunsMock: vi.fn(),
  fetchStatusMock: vi.fn(),
  fetchAttentionMock: vi.fn(),
  fetchProgressMock: vi.fn(),
  editionFlag: { selfhost: false },
}));

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    get: mappingApiGet,
    getDiscovery: mappingDiscoveryMock,
    rename: mappingRenameMock,
    recordVisit: mappingVisitMock,
  },
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
  fetchRuns: fetchRunsMock,
  fetchStatus: fetchStatusMock,
  // The steps' counts (0154 T4): what waits in each queue.
  fetchAttention: fetchAttentionMock,
  // What the count found, for how long before the first pass (0154 T3 (a)).
  fetchAllDiscovery: fetchAllDiscoveryMock,
  // The links panel asks whose migration this is, since a link is the
  // person's (0153 T5 (b)): nobody's, here.
  fetchPeople: vi.fn().mockResolvedValue({ people: [], unassigned: [] }),
  createPerson: vi.fn(),
  addMigrationToPerson: vi.fn(),
}));

// And the check, from the progress read a person's lines read (0154 T1 (b)).
vi.mock('../services/progress-service', () => ({ fetchProgress: fetchProgressMock }));

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

function renderHub(id = 'acme-mail', qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
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
  mappingVisitMock.mockResolvedValue(undefined);
  fetchStatusMock.mockResolvedValue({ status: 'ok', mappings: [] });
  fetchAttentionMock.mockResolvedValue({ mappings: [] });
  fetchProgressMock.mockResolvedValue({ mappings: [{ mappingId: 'acme-mail', domains: [], check: { state: 'not_run' } }] });
  mappingDiscoveryMock.mockResolvedValue({ mappingId: 'acme-mail', discovered: false, domains: [] });
  fetchAllDiscoveryMock.mockResolvedValue({});
  fetchRunsMock.mockResolvedValue({ runs: [] });
});

const step = (key: string) => document.querySelector(`[data-step="${key}"]`) as HTMLElement;

describe('the per-mapping navigation', () => {
  it('links every operating screen for THIS mapping, in the cutover order', async () => {
    renderHub();

    // Numbered since 0034 T4 — the list IS the cutover sequence and says so,
    // and since 0154 T4 it is one list with a person's page.
    expect(await screen.findByRole('heading', { name: 'Before you switch' })).toBeInTheDocument();
    expect(screen.getByText('Work them from the top, in this order.')).toBeInTheDocument();
    const keys = [...document.querySelectorAll('[data-step]')].map((el) => el.getAttribute('data-step'));
    expect(keys).toEqual(['deletions', 'moves', 'failures', 'sharing', 'check', 'confirmed', 'finish']);
    expect(step('deletions').textContent).toMatch(/^1\.Deletions/);
    expect(step('finish').textContent).toMatch(/^7\.Finish/);
    const expected: Record<string, string> = {
      Deletions: '/mappings/acme-mail/deletions',
      Moves: '/mappings/acme-mail/moves',
      Failures: '/mappings/acme-mail/failures',
      Check: '/mappings/acme-mail/verify',
      Sharing: '/mappings/acme-mail/sharing',
      Confirmed: '/mappings/acme-mail/confirmed',
      Finish: '/mappings/acme-mail/finish',
    };
    for (const [name, href] of Object.entries(expected)) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
    }
  });

  it('shows the mapping name when the detail read succeeds', async () => {
    renderHub();
    expect(await screen.findByRole('heading', { name: 'Acme mail' })).toBeInTheDocument();
    // The report, as a page and as a download (0154 T5).
    expect(screen.getByRole('link', { name: 'The report →' })).toHaveAttribute('href', '/mappings/acme-mail/report');
    expect(screen.getByRole('button', { name: 'Download the report' })).toBeInTheDocument();
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
 * EACH STEP'S COUNT AND STATE, FOR THIS MIGRATION (workplan 0154 T4): the
 * person's page's list, of one migration. The queues come from the read the
 * queue pages share, the check from the progress read, and a step whose read
 * failed says so and claims no state (hard rule 9).
 */
describe('the steps before a switch, with their counts (0154 T4)', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const attention = (over: Record<string, unknown> = {}) => ({
    mappings: [
      {
        mappingId: 'acme-mail',
        pendingDecisions: 0,
        deletionsWaiting: 0,
        movesWaiting: 0,
        failuresWaiting: 0,
        readyForCutover: false,
        autoApplied: 0,
        sharingOpen: 0,
        ...over,
      },
    ],
  });

  it('says what waits in each queue, with its state in words', async () => {
    fetchAttentionMock.mockResolvedValue(attention({ deletionsWaiting: 3, failuresWaiting: 12, sharingOpen: 4 }));
    renderHub();
    await vi.waitFor(() => expect(step('deletions').textContent).toContain('3 to decide'));
    expect(step('deletions').textContent).toContain('Needs you');
    expect(step('moves').textContent).toContain('None');
    expect(step('moves').textContent).toContain('Done');
    expect(step('failures').textContent).toContain('12 could not be copied');
    // Sharing is worked after finishing.
    expect(step('sharing').textContent).toContain('4 to go through');
    expect(step('sharing').textContent).toContain('Not yet');
    expect(step('finish').textContent).toContain('Switch mail delivery, then end');
  });

  it('says the check as it last ran, and when, and Confirmed follows it', async () => {
    fetchProgressMock.mockResolvedValue({
      mappings: [{ mappingId: 'acme-mail', domains: [], check: { state: 'passed', at: daysAgo(2) } }],
    });
    renderHub();
    await vi.waitFor(() => expect(step('check').textContent).toContain('Passed 2 days ago'));
    expect(step('check').textContent).toContain('Done');
    expect(step('confirmed').textContent).toContain('Ready to read');
  });

  it('says a check nobody ran as not run, never as one that failed', async () => {
    renderHub();
    await vi.waitFor(() => expect(step('check').textContent).toContain('Not run yet'));
    expect(step('check').textContent).toContain('Not yet');
    expect(step('confirmed').textContent).toContain('After the check');
  });

  it('says a check that could not run as that, with when', async () => {
    fetchProgressMock.mockResolvedValue({
      mappings: [{ mappingId: 'acme-mail', domains: [], check: { state: 'could_not_run', at: daysAgo(1) } }],
    });
    renderHub();
    await vi.waitFor(() => expect(step('check').textContent).toContain('Could not run yesterday'));
  });

  it('says a count could not be read, and claims no state, where its read failed', async () => {
    fetchAttentionMock.mockRejectedValue(new Error('the database is unreachable'));
    fetchProgressMock.mockRejectedValue(new Error('the database is unreachable'));
    renderHub();
    await vi.waitFor(() => expect(step('deletions').textContent).toContain('Could not be read'));
    for (const key of ['deletions', 'moves', 'failures', 'sharing', 'check', 'confirmed']) {
      expect(step(key).textContent, key).toContain('Could not be read');
      expect(step(key).textContent, key).not.toMatch(/Done|Needs you|Not yet/);
    }
    // The links are the deliverable, whatever loads.
    expect(screen.getByRole('link', { name: 'Check' }).getAttribute('href')).toBe('/mappings/acme-mail/verify');
  });

  it('says Finish could not be read when the migration itself could not be', async () => {
    mappingApiGet.mockRejectedValue(new Error('boom'));
    renderHub();
    await vi.waitFor(() => expect(step('finish').textContent).toContain('Could not be read'));
    expect(step('finish').textContent).not.toMatch(/Done|Needs you|Not yet/);
  });

  it('says nothing yet while the counts are still being read', async () => {
    fetchAttentionMock.mockReturnValue(new Promise(() => undefined));
    renderHub();
    await screen.findByRole('heading', { name: 'Acme mail' });
    expect(step('failures').textContent).not.toMatch(/Could not be read|None/);
  });

  it('selfhost: reads the lifecycle from /status, and the check from its last report', async () => {
    editionFlag.selfhost = true;
    fetchStatusMock.mockResolvedValue({
      status: 'ok',
      mappings: [{ mappingId: 'acme-mail', migrationStatus: 'cutover', domains: [] }],
    });
    renderHub();
    // In its cutover: past its check, and Finish needs the person.
    await vi.waitFor(() => expect(step('finish').textContent).toContain('Needs you'));
    expect(step('check').textContent).toContain('Passed');
    expect(step('check').textContent).toContain('Done');
    expect(mappingApiGet).not.toHaveBeenCalled();
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
    expect(screen.getByText(/send them a new grant link\. Links are made per person: see Links below/)).toBeInTheDocument();
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
    // And a side with no name is its provider's, never the kind (0154 T6).
    expect(await screen.findByText(/From Acme Google to Nextcloud$/)).toBeInTheDocument();
    expect(screen.queryByText(/\(\)/)).toBeNull();
  });

  /** 0154 T6: *From gmail · anna@gmail.com (anna@gmail.com)* said the account twice. */
  it('says the provider’s name, not a name made from the account, and the account once', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({
        sourceType: 'gmail',
        targetType: 'soverin',
        sourceConnection: { id: 'c1', name: 'gmail · anna@gmail.com', kind: 'gmail' },
        targetConnection: { id: 'c2', name: 'soverin', kind: 'soverin' },
        sourceConfig: { username: 'anna@gmail.com' },
        targetConfig: { username: 'anna@soverin.example' },
      }),
    );
    renderHub();
    expect(
      await screen.findByText('From Gmail (anna@gmail.com) to Soverin (anna@soverin.example)'),
    ).toBeInTheDocument();
  });
});

/** 0154 T6: the ID is for a support ticket, folded under Details, no longer under the title. */
describe('the migration’s ID', () => {
  it('sits folded under Details, where a support ticket can copy it', async () => {
    renderHub();
    await screen.findByRole('heading', { name: 'Acme mail' });
    const id = screen.getByText('acme-mail', { selector: 'code' });
    const fold = id.closest('details');
    expect(fold).not.toBeNull();
    expect(fold).not.toHaveAttribute('open');
    expect(within(fold!).getByText('Details')).toBeInTheDocument();
    expect(fold!.textContent).toContain('Migration ID: acme-mail');
    // And nowhere else: not under the title, where it was.
    expect(screen.getAllByText('acme-mail')).toHaveLength(1);
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
    expect(await screen.findByRole('heading', { name: 'Before you switch' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Google Docs')).toBeNull();
  });
});

describe('the schedule panel (the owner, 2026-09-28)', () => {
  it('shows the schedule this migration runs on, from the detail read', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ syncConfig: { domains: ['email'], schedule: '0 */6 * * *' } }));
    renderHub();
    const sixHourly = await screen.findByRole('button', { name: /^Every 6 hours/ });
    expect(sixHourly).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Hourly/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('is not on the appliance, whose schedule is its owner’s mapping file', async () => {
    editionFlag.selfhost = true;
    renderHub();
    expect(await screen.findByRole('heading', { name: 'Before you switch' })).toBeInTheDocument();
    expect(screen.queryByText(STRINGS.en['settings.schedule'])).toBeNull();
    expect(mappingApiGet).not.toHaveBeenCalled();
    expect(mappingVisitMock).not.toHaveBeenCalled();
  });

  it('records a visit as the page opens, which brings a migration on Automatic back to every hour (0157 T7)', async () => {
    renderHub();
    await vi.waitFor(() => expect(mappingVisitMock).toHaveBeenCalledWith('acme-mail'));
    expect(mappingVisitMock).toHaveBeenCalledTimes(1);
  });

  it('shows the page as it would without the visit, when the visit is not recorded', async () => {
    mappingVisitMock.mockRejectedValue(new Error('network down'));
    renderHub();
    expect(await screen.findByRole('heading', { name: 'Before you switch' })).toBeInTheDocument();
  });

  it('selects Automatic for a migration with no schedule of its own (0157 T7)', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ syncConfig: { domains: ['email'] } }));
    renderHub();
    const automatic = await screen.findByRole('button', { name: /^Automatic/ });
    expect(automatic).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('where the copies land (0153 open question 5, item 4)', () => {
  it('names the folder they land in, where one was chosen', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ targetFolderPrefix: 'anna@gmail.com' }));
    renderHub();
    expect(
      await screen.findByText('The copies land in the folder anna@gmail.com of the destination.'),
    ).toBeInTheDocument();
  });

  it('says they merge into the destination’s own folders where none was', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ targetFolderPrefix: null }));
    renderHub();
    expect(await screen.findByText("The copies land in the destination's own folders.")).toBeInTheDocument();
  });

  it('says nothing where the read does not say', async () => {
    renderHub();
    await screen.findByRole('heading', { level: 2, name: 'Acme mail' });
    expect(screen.queryByText(/The copies land/)).toBeNull();
  });
});

describe('where its files start (0153 open question 5, item 4)', () => {
  const files = (kind: string, sourceConfig: Record<string, unknown>, domains = ['file']) =>
    aMapping({ sourceConnection: { id: 'c-1', name: 'Anna', kind }, sourceConfig, syncConfig: { domains } });

  it('names the one folder they are read from: a Dropbox path, and a Google folder by its id', async () => {
    mappingApiGet.mockResolvedValue(files('dropbox', { rootPath: '/Holiday/2019' }));
    const { unmount } = renderHub();
    expect(await screen.findByText('Its files are read from /Holiday/2019 only.')).toBeInTheDocument();
    unmount();
    mappingApiGet.mockResolvedValue(files('google', { rootFolderId: 'f-1' }));
    renderHub('acme-mail', new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    expect(await screen.findByText('Its files are read from one folder only: f-1.')).toBeInTheDocument();
  });

  it('says all of the account where no folder was chosen, as a person names it', async () => {
    mappingApiGet.mockResolvedValue(files('google_drive', {}));
    renderHub();
    expect(await screen.findByText('Its files are read from all of My Drive.')).toBeInTheDocument();
  });

  it('says nothing for a migration with no files, or from a source with no folder to start from', async () => {
    mappingApiGet.mockResolvedValue(files('google', {}, ['calendar']));
    const { unmount } = renderHub();
    await screen.findByRole('heading', { level: 2, name: 'Acme mail' });
    expect(screen.queryByText(/Its files are read/)).toBeNull();
    unmount();
    mappingApiGet.mockResolvedValue(files('microsoft', {}));
    renderHub('acme-mail', new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await screen.findByRole('heading', { level: 2, name: 'Acme mail' });
    expect(screen.queryByText(/Its files are read/)).toBeNull();
  });
});

describe('Rename, beside the title (0153 open question 5, item 4)', () => {
  it('renames from beside the title, and the heading reads the stored name', async () => {
    mappingRenameMock.mockResolvedValue({ id: 'acme-mail', name: 'Anna’s mail', updatedAt: '2026-10-04T08:00:00Z' });
    renderHub();
    expect(await screen.findByRole('heading', { level: 2, name: 'Acme mail' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const box = screen.getByLabelText('Name of this migration');
    expect(box).toHaveValue('Acme mail');
    fireEvent.change(box, { target: { value: '  Anna’s mail  ' } });
    mappingApiGet.mockResolvedValue(aMapping({ name: 'Anna’s mail' }));
    fireEvent.click(within(box.closest('form')!).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Anna’s mail' })).toBeInTheDocument();
    expect(mappingRenameMock).toHaveBeenCalledWith('acme-mail', 'Anna’s mail');
  });

  it('says why a rename did not land, and keeps the box with what was typed', async () => {
    mappingRenameMock.mockRejectedValue(new Error('The service is down.'));
    renderHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    const box = screen.getByLabelText('Name of this migration');
    fireEvent.change(box, { target: { value: 'Anna’s mail' } });
    fireEvent.click(within(box.closest('form')!).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not renamed:');
    expect(screen.getByLabelText('Name of this migration')).toHaveValue('Anna’s mail');
  });

  it('waits for a name, and Cancel leaves the title as it was', async () => {
    renderHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    const box = screen.getByLabelText('Name of this migration');
    fireEvent.change(box, { target: { value: '   ' } });
    const form = within(box.closest('form')!);
    expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(form.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Acme mail' })).toBeInTheDocument();
    expect(mappingRenameMock).not.toHaveBeenCalled();
  });

  it('is not offered on the appliance, whose names are its mapping files’', async () => {
    editionFlag.selfhost = true;
    renderHub();
    expect(await screen.findByRole('heading', { name: 'Before you switch' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
  });
});

describe('Pause, where a pause is possible (0128)', () => {
  it('is offered on an active migration', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ status: 'active' }));
    renderHub();
    expect(await screen.findByRole('button', { name: /^Pause/ })).toBeInTheDocument();
  });

  it('is not offered in the continuous lane, where no update brings a migration back before its cutover', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ status: 'continuous' }));
    renderHub();
    // The page has read the migration: its state chip is there.
    expect(await screen.findByRole('heading', { name: 'Before you switch' })).toBeInTheDocument();
    await screen.findByText('Acme mail');
    expect(screen.queryByRole('button', { name: /^Pause/ })).not.toBeInTheDocument();
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
    // What discovery found (0154 T2), on both editions' rows.
    itemsFound: 50,
  };

  it('managed: renders the strip from the detail payload, retrying count included', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ domainStatus: [emailDomain] }));
    renderHub();

    expect(await screen.findByText('42 of ~50')).toBeInTheDocument();
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

    expect(await screen.findByText('42 of ~50')).toBeInTheDocument();
    expect(screen.getByText(/last synced/)).toBeInTheDocument();
    // The other mapping's numbers must not leak into this hub.
    expect(screen.queryByText(/^999 /)).not.toBeInTheDocument();
    expect(mappingApiGet).not.toHaveBeenCalled();
  });
});

/**
 * WHERE IT IS, IN A PERSON'S WORDS (workplan 0154 T1, a migration's own page):
 * what a person's card says of this migration, from the same facts and the
 * same functions. Beside the name, the migration's stage: the least advanced
 * of its data types, the card's data types. On each row of the strip, that
 * data type's own, and a failed pass keeps its word beside it.
 */
describe('where it is, in a person’s words (0154 T1)', () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  /** A row of the strip, as both editions serve it. */
  const stripRow = (domain: string, state: string, over: Record<string, unknown> = {}) => ({
    domain,
    state,
    itemsSynced: 12,
    itemsFailed: 0,
    bytesTransferred: 0,
    itemsRetrying: 0,
    itemsNeedingDecision: 0,
    ...over,
  });
  /** The same data type, as the progress read has it. */
  const progressRow = (domain: string, state: string, over: Record<string, unknown> = {}) => ({
    domain,
    state,
    phase: 'active',
    itemsSynced: 12,
    bytesTransferred: 0,
    ...over,
  });
  const progressOf = (domains: unknown[], check: Record<string, unknown> = { state: 'not_run' }) => ({
    mappings: [{ mappingId: 'acme-mail', domains, check }],
  });
  const kept = { lastSyncedAt: yesterday };
  /** What sits beside the migration's name. */
  const header = async (name = 'Acme mail') => (await screen.findByRole('heading', { name })).parentElement!;
  /** One data type's row of the strip. */
  const row = (domain: string) => {
    const rows = document.querySelectorAll(`li[data-domain="${domain}"]`);
    expect(rows).toHaveLength(1);
    return rows[0]!.textContent ?? '';
  };

  it('says the least advanced beside the name, and each data type’s own on its row', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({
        syncConfig: { domains: ['email', 'calendar'] },
        domainStatus: [stripRow('email', 'completed', kept), stripRow('calendar', 'in_progress')],
      }),
    );
    fetchProgressMock.mockResolvedValue(
      progressOf([progressRow('email', 'completed', kept), progressRow('calendar', 'in_progress')]),
    );
    renderHub();
    const beside = await header();
    await vi.waitFor(() => expect(beside.textContent).toContain('Copying'));
    expect(beside.textContent).not.toContain('Active');
    expect(row('email')).toContain('Kept in step');
    expect(row('email')).not.toContain('Completed');
    expect(row('calendar')).toContain('Copying');
    expect(row('calendar')).not.toContain('Syncing');
  });

  /** The card draws a line for each data type the migration carries, touched by a pass or not. */
  it('counts a data type no pass has touched yet, as the card does', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({ syncConfig: { domains: ['email', 'calendar'] }, domainStatus: [stripRow('email', 'completed', kept)] }),
    );
    fetchProgressMock.mockResolvedValue(progressOf([progressRow('email', 'completed', kept)]));
    renderHub();
    const beside = await header();
    await vi.waitFor(() => expect(row('email')).toContain('Kept in step'));
    expect(beside.textContent).toContain('Copying');
    expect(beside.textContent).not.toContain('Kept in step');
  });

  /** Hard rule 9: Ready to switch needs the check passed and the failures that block Finish counted. */
  it('says Ready to switch only once the check passed and nothing counted blocks Finish', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({ syncConfig: { domains: ['email'] }, domainStatus: [stripRow('email', 'completed', kept)] }),
    );
    fetchProgressMock.mockResolvedValue(
      progressOf([progressRow('email', 'completed', kept)], { state: 'passed', at: yesterday }),
    );
    fetchAttentionMock.mockResolvedValue({
      mappings: [
        {
          mappingId: 'acme-mail',
          pendingDecisions: 0,
          deletionsWaiting: 0,
          movesWaiting: 0,
          failuresWaiting: 0,
          readyForCutover: true,
          autoApplied: 0,
          sharingOpen: 0,
        },
      ],
    });
    const { unmount } = renderHub();
    const beside = await header();
    await vi.waitFor(() => expect(beside.textContent).toContain('Ready to switch'));
    expect(row('email')).toContain('Ready to switch');
    unmount();

    // The failures could not be counted: it stays kept in step.
    fetchAttentionMock.mockRejectedValue(new Error('the database is unreachable'));
    renderHub();
    const again = await header();
    await vi.waitFor(() => expect(row('email')).toContain('Kept in step'));
    expect(again.textContent).toContain('Kept in step');
    expect(again.textContent).not.toContain('Ready to switch');
  });

  it('keeps a failed pass’s word beside the stage', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({
        syncConfig: { domains: ['email'] },
        domainStatus: [stripRow('email', 'failed', { ...kept, itemsFailed: 3 })],
      }),
    );
    fetchProgressMock.mockResolvedValue(progressOf([progressRow('email', 'failed', kept)]));
    renderHub();
    await header();
    await vi.waitFor(() => expect(row('email')).toContain('Kept in step'));
    expect(row('email')).toContain('Failed');
  });

  it('says what the card says until the progress read has it, and each row its pass', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({ syncConfig: { domains: ['email'] }, domainStatus: [stripRow('email', 'completed', kept)] }),
    );
    // Still being read, and failed.
    for (const read of [() => new Promise(() => undefined), () => Promise.reject(new Error('the database is unreachable'))]) {
      fetchProgressMock.mockImplementation(read);
      const { unmount } = renderHub();
      const beside = await header();
      await vi.waitFor(() => expect(row('email')).toContain('Completed'));
      // A migration that has finished a pass, as the list reads it.
      expect(beside.textContent).toContain('Kept in step');
      expect(row('email')).not.toContain('Kept in step');
      unmount();
    }
  });

  it('selfhost: reads the data types and their passes from /status, and says the same', async () => {
    editionFlag.selfhost = true;
    fetchStatusMock.mockResolvedValue({
      status: 'ok',
      mappings: [
        {
          mappingId: 'acme-mail',
          migrationStatus: 'active',
          domains: [stripRow('email', 'completed', kept), stripRow('contact', 'in_progress')],
        },
      ],
    });
    fetchProgressMock.mockResolvedValue(
      progressOf([progressRow('email', 'completed', kept), progressRow('contact', 'in_progress')]),
    );
    renderHub();
    const beside = await header('Migration');
    await vi.waitFor(() => expect(beside.textContent).toContain('Copying'));
    expect(row('email')).toContain('Kept in step');
    expect(row('contact')).toContain('Copying');
    expect(mappingApiGet).not.toHaveBeenCalled();
  });
});

/**
 * STOP AND RESUME ONE DATA TYPE, ON BOTH EDITIONS (workplan 0128 T4, slice
 * 3c; the owner's D4: the appliance gets the same choice). One panel, two
 * payloads: managed's detail carries `stopChoices`, the appliance's `/status`
 * carries each mapping's `stops`. And the strip says whose stop it is.
 */
describe('a data type stopped from this page', () => {
  const row = (domain: string, state: string, extra: Record<string, unknown> = {}) => ({
    domain,
    state,
    itemsSynced: 12,
    itemsFailed: 0,
    bytesTransferred: 0,
    itemsRetrying: 0,
    itemsNeedingDecision: 0,
    ...extra,
  });

  it('managed: offers Stop from the detail payload, and says a switched-off one as switched off', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({
        syncConfig: { domains: ['email', 'calendar'] },
        domainStatus: [row('email', 'in_progress'), row('calendar', 'stopped')],
        kindChoices: [
          { domain: 'email', state: 'on' },
          { domain: 'calendar', state: 'on' },
        ],
        stopChoices: [
          { domain: 'email', stopped: false, offer: 'stop' },
          { domain: 'calendar', stopped: false, offer: 'stop' },
        ],
      }),
    );
    renderHub();

    expect(await screen.findByRole('button', { name: 'Stop Email' })).toBeInTheDocument();
    expect(screen.getByText(STRINGS.en['confirm.progress.stopped'])).toBeInTheDocument();
    expect(screen.queryByText(STRINGS.en['confirm.progress.stoppedByYou'])).not.toBeInTheDocument();
  });

  it('selfhost: offers Resume from /status, THIS mapping’s stops only, and says the stop is yours', async () => {
    editionFlag.selfhost = true;
    fetchStatusMock.mockResolvedValue({
      status: 'ok',
      mappings: [
        {
          mappingId: 'other-mapping',
          migrationStatus: 'active',
          domains: [],
          stops: [{ domain: 'file', stopped: false, offer: 'stop' }],
        },
        {
          mappingId: 'acme-mail',
          migrationStatus: 'active',
          domains: [row('calendar', 'stopped', { stoppedByOwner: true }), row('contact', 'in_progress')],
          stops: [
            { domain: 'calendar', stopped: true, offer: 'resume' },
            { domain: 'contact', stopped: false, offer: null, held: 'last_one_copying' },
          ],
        },
      ],
    });
    renderHub();

    expect(await screen.findByRole('button', { name: 'Resume Calendar' })).toBeInTheDocument();
    expect(screen.getByText(STRINGS.en['settings.kinds.held.lastOne'])).toBeInTheDocument();
    expect(screen.getByText(STRINGS.en['confirm.progress.stoppedByYou'])).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop Files' })).not.toBeInTheDocument();
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

/**
 * HOW LONG, UNTIL THE FIRST PASS REPORTS (workplan 0154 T3 (a)): what the
 * review screen said, from the same count, and nothing once a pass has
 * reported, when the pass's own rate is the better answer.
 */
describe('how long, before the first pass reports (0154 T3 (a))', () => {
  const counted = (bytes: number) => ({
    domain: 'email',
    collections: 4,
    items: 18_000,
    bytes,
    discoveredAt: '2026-10-03T09:00:00.000Z',
  });

  it('says the days Gmail’s ceiling takes, and why, for a Gmail migration', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ status: 'paused', sourceType: 'gmail' }));
    mappingDiscoveryMock.mockResolvedValue({ mappingId: 'acme-mail', discovered: true, domains: [counted(10.4e9)] });
    renderHub();
    expect(
      await screen.findByText('About 4 to 5 days, because Google lets a mailbox download 2.5 GB a day.'),
    ).toBeInTheDocument();
    expect(screen.getByText('How long:')).toBeInTheDocument();
  });

  it('says it will know after the first hour, for a provider with no published ceiling', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ status: 'paused', sourceType: 'imap', sourceConfig: { host: 'mail.example.com' } }));
    mappingDiscoveryMock.mockResolvedValue({ mappingId: 'acme-mail', discovered: true, domains: [counted(30e9)] });
    renderHub();
    expect(await screen.findByText('Depends on the provider; we will know after the first hour.')).toBeInTheDocument();
  });

  it('says nothing once a pass has reported, and does not ask for the count', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({
        sourceType: 'gmail',
        domainStatus: [
          {
            domain: 'email',
            state: 'completed',
            itemsSynced: 12,
            itemsFailed: 0,
            bytesTransferred: 0,
            itemsRetrying: 0,
            itemsNeedingDecision: 0,
            lastSyncedAt: '2026-10-03T09:00:00.000Z',
          },
        ],
      }),
    );
    mappingDiscoveryMock.mockResolvedValue({ mappingId: 'acme-mail', discovered: true, domains: [counted(10.4e9)] });
    // The count as the page read it before the pass, still in the cache.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['mapping-discovery', 'acme-mail'], {
      mappingId: 'acme-mail',
      discovered: true,
      domains: [counted(10.4e9)],
    });
    renderHub('acme-mail', qc);
    await screen.findByRole('heading', { name: 'Acme mail' });
    expect(screen.queryByText('How long:')).not.toBeInTheDocument();
    expect(mappingDiscoveryMock).not.toHaveBeenCalled();
  });

  it('selfhost: reads the appliance’s count, keyed by this migration', async () => {
    editionFlag.selfhost = true;
    fetchStatusMock.mockResolvedValue({
      status: 'ok',
      mappings: [{ mappingId: 'acme-mail', migrationStatus: 'paused', sourceType: 'gmail', domains: [] }],
    });
    fetchAllDiscoveryMock.mockResolvedValue({ 'acme-mail': [counted(1.2e9)], other: [counted(99e9)] });
    renderHub();
    expect(
      await screen.findByText('Within a day, because this mailbox holds less than the 2.5 GB a day Google lets one download.'),
    ).toBeInTheDocument();
  });
});

/**
 * HOW LONG, DURING THE COPY (workplan 0154 T3 (b)): once a pass has reported,
 * from the last passes' own pace and what is left of T2's totals, in place of
 * the count's estimate; nothing once nothing is left.
 */
describe('how long, during the copy (0154 T3 (b))', () => {
  const DAY = 86_400_000;
  const T0 = Date.parse('2026-10-01T02:00:00.000Z');
  /** Newest first: a pass a day, each 50 minutes. */
  const passes = (...items: number[]) =>
    items.map((n, i) => {
      const start = T0 + (items.length - 1 - i) * DAY;
      return {
        id: `r-${i}`,
        mappingId: 'acme-mail',
        type: 'delta',
        kind: 'initial_copy',
        status: 'success',
        startedAt: new Date(start).toISOString(),
        finishedAt: new Date(start + 50 * 60_000).toISOString(),
        itemsProcessed: n,
        errors: 0,
        createdAt: new Date(start).toISOString(),
        events: [],
      };
    });
  const row = (over: Record<string, unknown> = {}) => ({
    domain: 'email',
    state: 'in_progress',
    itemsSynced: 10_000,
    itemsFound: 19_000,
    itemsFailed: 0,
    bytesTransferred: 0,
    itemsRetrying: 0,
    itemsNeedingDecision: 0,
    lastSyncedAt: '2026-10-03T02:50:00.000Z',
    ...over,
  });

  it('says the range the last passes’ pace gives, in place of the count’s estimate', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ sourceType: 'gmail', domainStatus: [row()] }));
    fetchRunsMock.mockResolvedValue({ runs: passes(2_000, 1_500, 1_200) });
    renderHub();
    expect(await screen.findByText('About 4 to 8 days more, from the last 3 passes.')).toBeInTheDocument();
    expect(mappingDiscoveryMock).not.toHaveBeenCalled();
  });

  it('leaves the count’s estimate in place while the first pass is still running', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({ sourceType: 'gmail', domainStatus: [row({ lastSyncedAt: undefined })] }),
    );
    mappingDiscoveryMock.mockResolvedValue({
      mappingId: 'acme-mail',
      discovered: true,
      domains: [{ domain: 'email', collections: 4, items: 19_000, bytes: 10.4e9, discoveredAt: '2026-10-01T00:00:00.000Z' }],
    });
    fetchRunsMock.mockResolvedValue({ runs: passes(2_000, 1_500, 1_200) });
    renderHub();
    expect(
      await screen.findByText('About 4 to 5 days, because Google lets a mailbox download 2.5 GB a day.'),
    ).toBeInTheDocument();
    await screen.findByText('2,000 items this pass');
    expect(document.querySelector('[data-time-while-copying]')).toBeNull();
  });

  it('says it will know after three passes, and how many it has', async () => {
    mappingApiGet.mockResolvedValue(aMapping({ sourceType: 'gmail', domainStatus: [row()] }));
    fetchRunsMock.mockResolvedValue({ runs: passes(2_000) });
    renderHub();
    expect(await screen.findByText('We will know after three passes; 1 so far.')).toBeInTheDocument();
  });

  it('names the provider that slowed it, first', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({ sourceType: 'o365', domainStatus: [row({ lastErrorCategory: 'rate_limited' })] }),
    );
    fetchRunsMock.mockResolvedValue({ runs: passes(2_000, 1_500, 1_200) });
    renderHub();
    expect(
      await screen.findByText('Slowed by Microsoft 365. About 4 to 8 days more, from the last 3 passes.'),
    ).toBeInTheDocument();
  });

  /** Kept in step has no time left; a total nobody counted has no remainder (hard rule 9). */
  it('says nothing once nothing is left, or where a total is not known', async () => {
    mappingApiGet.mockResolvedValue(
      aMapping({ sourceType: 'gmail', domainStatus: [row({ state: 'completed', itemsSynced: 19_000 })] }),
    );
    fetchRunsMock.mockResolvedValue({ runs: passes(2_000, 1_500, 1_200) });
    const { unmount } = renderHub();
    // The run history has landed, so the line had what it needed.
    await screen.findByText('2,000 items this pass');
    expect(screen.queryByText('How long:')).not.toBeInTheDocument();
    unmount();

    mappingApiGet.mockResolvedValue(aMapping({ sourceType: 'gmail', domainStatus: [row({ itemsFound: undefined })] }));
    renderHub();
    await screen.findByText('2,000 items this pass');
    expect(screen.queryByText('How long:')).not.toBeInTheDocument();
  });
});
