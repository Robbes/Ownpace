// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The finish checklist (ADR-0026).
 *
 * The property under test is ORDER, not the button. Finishing stops the shadow
 * sync, so doing it before mail delivery has moved means everything arriving on
 * the old system afterwards is never copied — and the appliance has stopped
 * watching, so nothing reports it. That is silent data loss caused by pressing
 * the right button at the wrong time, and it is the whole reason this screen is
 * a checklist.
 *
 * Since 0128 T5 slice 7b the last step lists the migration's data types, each
 * with its own End and Keep copying (the owner's D3 and D8), and step 4 asks
 * for mail only: only mail's buttons wait for it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { PathEndingChoice, StatusReport } from '@openmig/shared';
import { STRINGS } from '../i18n/strings.ts';

const {
  fetchStatus,
  fetchMappingDataTypes,
  fetchFailures,
  fetchMoves,
  fetchDeletions,
  endOrKeepDataType,
  requestFinalPass,
  PathEndingRefusedError,
  fetchVerifyReport,
} = vi.hoisted(() => {
  class PathEndingRefusedError extends Error {
    constructor(
      readonly refusal: { error: string; refused: string; message: string; forceable?: true; count?: number },
    ) {
      super(refusal.message);
      this.name = 'PathEndingRefusedError';
    }
  }
  return {
    fetchStatus: vi.fn(),
    fetchMappingDataTypes: vi.fn(),
    fetchFailures: vi.fn(),
    fetchMoves: vi.fn(),
    fetchDeletions: vi.fn(),
    fetchVerifyReport: vi.fn(),
    endOrKeepDataType: vi.fn(),
    requestFinalPass: vi.fn(),
    PathEndingRefusedError,
  };
});

vi.mock('../services/operating-service', () => ({
  fetchVerifyReport,
  fetchStatus,
  fetchMappingDataTypes,
  fetchFailures,
  fetchMoves,
  fetchDeletions,
  endOrKeepDataType,
  requestFinalPass,
  PathEndingRefusedError,
}));

import Finish from './Finish.tsx';

type Lifecycle = StatusReport['mappings'][number]['migrationStatus'];

/** Mail's ending as the door's rule offers it in each lifecycle, with mail its only data type. */
const MAIL_ENDING: Record<Lifecycle, PathEndingChoice[]> = {
  paused: [],
  active: [{ domain: 'email', phase: 'active', stopped: false, offers: ['end', 'keep'] }],
  cutover: [{ domain: 'email', phase: 'cutover', stopped: false, offers: ['end', 'keep'] }],
  done: [{ domain: 'email', phase: 'done', stopped: false, offers: ['keep'] }],
  continuous: [{ domain: 'email', phase: 'continuous', stopped: false, offers: ['end'] }],
};

function statusReport(
  migrationStatus: Lifecycle,
  needingDecision = 0,
  endings: PathEndingChoice[] = MAIL_ENDING[migrationStatus],
): StatusReport {
  return {
    status: 'ok',
    mappings: [
      {
        mappingId: 'acme-mail',
        migrationStatus,
        endings,
        domains: [
          {
            domain: 'email',
            state: 'completed',
            itemsSynced: 100,
            itemsFailed: needingDecision,
            bytesTransferred: 1000,
            itemsRetrying: 0,
            itemsNeedingDecision: needingDecision,
          },
        ],
      },
    ],
  };
}

const emptyQueue = {
  'acme-mail': {
    migrationStatus: 'active' as const,
    confirmed: [],
    watching: [],
    acknowledged: [],
    open: [],
    needsDecision: [],
    retrying: [],
    whatThisMeans: '',
    howToResolve: {},
  },
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Finish />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchFailures.mockResolvedValue(emptyQueue);
  fetchMoves.mockResolvedValue(emptyQueue);
  fetchDeletions.mockResolvedValue(emptyQueue);
  fetchVerifyReport.mockResolvedValue({ state: 'never-run' });
  fetchMappingDataTypes.mockResolvedValue({ domains: [], endings: MAIL_ENDING.active });
});

const END_MAIL = /^End Email$/;

describe('the cutover order', () => {
  it('will not end mail until delivery has been confirmed moved', async () => {
    // The gate. Everything else on this screen the appliance can check itself;
    // this one is MX/DNS, outside the tool, and ending mail without it is the
    // silent-loss case. Keeping it copying is its cutover too, so it waits as well.
    fetchStatus.mockResolvedValue(statusReport('active'));
    renderScreen();

    const button = await screen.findByRole('button', { name: END_MAIL });
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep copying Email' })).toBeDisabled();

    fireEvent.click(button);
    expect(endOrKeepDataType).not.toHaveBeenCalled();
  });

  it('spells out what happens if you finish first, rather than assuming it is understood', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    renderScreen();

    expect(
      await screen.findByText(/will not be copied, and nothing will report it/),
    ).toBeInTheDocument();
  });

  it('ends mail once delivery is confirmed', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    endOrKeepDataType.mockResolvedValue({ changed: true, migration: { from: 'active', to: 'done' } });
    renderScreen();

    fireEvent.click(await screen.findByLabelText(/Delivery now goes to the new system/));
    const button = screen.getByRole('button', { name: END_MAIL });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await waitFor(() => expect(endOrKeepDataType).toHaveBeenCalledWith('acme-mail', 'email', 'end', false));
  });

  it('asks step 4 for mail only: the calendars end and keep copying without it', async () => {
    fetchStatus.mockResolvedValue(
      statusReport('active', 0, [
        ...MAIL_ENDING.active,
        { domain: 'calendar', phase: 'active', stopped: false, offers: ['end', 'keep'] },
      ]),
    );
    endOrKeepDataType.mockResolvedValue({ changed: true });
    renderScreen();

    expect(await screen.findByRole('button', { name: END_MAIL })).toBeDisabled();
    const calendars = screen.getByRole('button', { name: 'End Calendar' });
    expect(calendars).toBeEnabled();
    fireEvent.click(calendars);
    await waitFor(() => expect(endOrKeepDataType).toHaveBeenCalledWith('acme-mail', 'calendar', 'end', false));
  });

  it('asks nothing of step 4 where there is no mail, and numbers the last step fourth', async () => {
    fetchStatus.mockResolvedValue(
      statusReport('active', 0, [
        { domain: 'calendar', phase: 'active', stopped: false, offers: ['end', 'keep'] },
        { domain: 'file', phase: 'active', stopped: false, offers: ['end', 'keep'] },
      ]),
    );
    renderScreen();

    expect(await screen.findByText(`4. ${STRINGS.en['finish.step5.title']}`)).toBeInTheDocument();
    expect(screen.queryByText(STRINGS.en['finish.step4.title'], { exact: false })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End Files' })).toBeEnabled();
  });

  it('asks nothing of step 4 once mail is past its own cutover: its delivery moved then', async () => {
    fetchStatus.mockResolvedValue(
      statusReport('active', 0, [
        { domain: 'email', phase: 'cutover', stopped: false, offers: ['end', 'keep'] },
        { domain: 'calendar', phase: 'active', stopped: false, offers: ['end', 'keep'] },
      ]),
    );
    renderScreen();

    expect(await screen.findByRole('button', { name: END_MAIL })).toBeEnabled();
    expect(screen.queryByLabelText(/Delivery now goes to the new system/)).not.toBeInTheDocument();
    expect(screen.getByText(STRINGS.en['finish.ending.phase.cutover'])).toBeInTheDocument();
  });

  it('keeps a data type copying in two presses, the first saying what the lane costs', async () => {
    fetchStatus.mockResolvedValue(
      statusReport('active', 0, [{ domain: 'calendar', phase: 'active', stopped: false, offers: ['end', 'keep'] }]),
    );
    endOrKeepDataType.mockResolvedValue({ changed: true });
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Keep copying Calendar' }));
    expect(endOrKeepDataType).not.toHaveBeenCalled();
    expect(screen.getByText(STRINGS.en['lane.intro'])).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: STRINGS.en['lane.confirm'] }));
    await waitFor(() => expect(endOrKeepDataType).toHaveBeenCalledWith('acme-mail', 'calendar', 'keep', false));
  });

  it('offers a data type its owner stopped End only, and says how it is kept', async () => {
    fetchStatus.mockResolvedValue(
      statusReport('active', 0, [
        { domain: 'calendar', phase: 'active', stopped: true, offers: ['end'] },
        { domain: 'file', phase: 'active', stopped: false, offers: ['end', 'keep'] },
      ]),
    );
    renderScreen();

    expect(await screen.findByRole('button', { name: 'End Calendar' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Keep copying Calendar' })).not.toBeInTheDocument();
    expect(screen.getByText(/You stopped Calendar\. End it, or resume it/)).toBeInTheDocument();
  });

  it('says plainly that nothing is added or removed, because "finish" reads destructive', async () => {
    // An operator who thinks this might delete something never presses it, and
    // leaves the appliance syncing a dead source forever.
    fetchStatus.mockResolvedValue(statusReport('active'));
    renderScreen();
    expect(
      await screen.findByText(/Nothing is added to or removed from either system/),
    ).toBeInTheDocument();
  });
});

describe('a grace period that ended while nobody chose (0128 D7)', () => {
  it('says so on the data type it ended for, beside its two presses', async () => {
    fetchStatus.mockResolvedValue(
      statusReport('cutover', 0, [
        {
          domain: 'email',
          phase: 'cutover',
          stopped: false,
          offers: ['end', 'keep'],
          graceEndedAt: '2026-09-23T10:00:00.000Z',
        },
        { domain: 'calendar', phase: 'cutover', stopped: false, offers: ['end', 'keep'] },
      ]),
    );
    renderScreen();

    expect(
      await screen.findByText(
        /^The grace period of Email ended on .+, and nobody chose, so it no longer copies\. End it, or keep it copying\.$/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/The grace period of Calendar/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: END_MAIL })).toBeEnabled();
  });
});

describe('the failure queue', () => {
  it('warns about unresolved items before anything is clicked', async () => {
    // The server would refuse anyway, but discovering the count only after a
    // rejected click makes the product look broken rather than careful.
    fetchStatus.mockResolvedValue(statusReport('active', 3));
    renderScreen();

    expect(await screen.findByText(/3 could not be copied/)).toBeInTheDocument();
  });

  it("offers force only AFTER the server has said what it would cost", async () => {
    fetchStatus.mockResolvedValue(statusReport('active', 3));
    endOrKeepDataType.mockRejectedValueOnce(
      new PathEndingRefusedError({
        error: 'end_refused',
        refused: 'unresolved_failures',
        count: 3,
        message: '3 item(s) of email could not be migrated and are awaiting a decision.',
        forceable: true,
      }),
    );
    renderScreen();

    fireEvent.click(await screen.findByLabelText(/Delivery now goes to the new system/));
    // No force option exists yet.
    expect(screen.queryByText(/anyway, leaving them behind/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: END_MAIL }));

    expect(
      await screen.findByText('3 item(s) of email could not be migrated and are awaiting a decision.'),
    ).toBeInTheDocument();
    // Now it does, with the cost stated above it.
    const force = screen.getByRole('button', { name: 'End Email anyway, leaving them behind' });
    endOrKeepDataType.mockResolvedValue({ changed: true, migration: { from: 'active', to: 'done' } });
    fireEvent.click(force);
    await waitFor(() => expect(endOrKeepDataType).toHaveBeenLastCalledWith('acme-mail', 'email', 'end', true));
  });
});

describe('a migration that cannot be finished', () => {
  it('offers nothing for one that was never started', async () => {
    fetchStatus.mockResolvedValue(statusReport('paused'));
    renderScreen();

    expect(await screen.findByText(/Never started, so there is nothing to finish/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: END_MAIL })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Keep copying/ })).not.toBeInTheDocument();
  });

  it('shows a finished one as finished, with no checklist, and each data type it can keep copying', async () => {
    fetchStatus.mockResolvedValue(statusReport('done'));
    renderScreen();

    expect(await screen.findByText(/no longer syncs/)).toBeInTheDocument();
    expect(screen.queryByText(/Run the check/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: END_MAIL })).not.toBeInTheDocument();
    expect(screen.getByText(STRINGS.en['finish.each.title'])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep copying Email' })).toBeEnabled();
  });
});

describe('the per-mapping mode (workplan 0019 T5)', () => {
  // Reached as `mappings/:mappingId/finish` in EITHER edition. The lifecycle
  // comes from the queue envelopes themselves — never from `/status`, which
  // the managed edition does not serve — and the checklist's links stay inside
  // the mapping.
  function renderPerMapping(id = 'acme-mail') {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/mappings/${id}/finish`]}>
          <Routes>
            <Route path="/mappings/:mappingId/finish" element={<Finish />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('renders the checklist from the queue envelopes and never asks /status', async () => {
    renderPerMapping();

    expect(await screen.findByRole('heading', { name: 'acme-mail' })).toBeInTheDocument();
    expect(screen.getByText(/Run the check/)).toBeInTheDocument();
    expect(fetchStatus).not.toHaveBeenCalled();
    // The queues were asked about THIS mapping, not everything.
    expect(fetchFailures).toHaveBeenCalledWith('acme-mail');
  });

  it('offers each data type’s ending from this migration’s own payload', async () => {
    fetchMappingDataTypes.mockResolvedValue({
      domains: [],
      endings: [{ domain: 'file', phase: 'active', stopped: false, offers: ['end', 'keep'] }],
    });
    renderPerMapping();

    expect(await screen.findByRole('button', { name: 'End Files' })).toBeEnabled();
    expect(fetchMappingDataTypes).toHaveBeenCalledWith('acme-mail');
  });

  it("keeps the checklist's links inside the mapping", async () => {
    renderPerMapping();

    const check = await screen.findByRole('link', { name: /Run the check/ });
    expect(check.getAttribute('href')).toBe('/mappings/acme-mail/verify');
  });

  it('says when no migration with that id answered — not the same as nothing to do', async () => {
    fetchFailures.mockResolvedValue({});
    fetchMoves.mockResolvedValue({});
    fetchDeletions.mockResolvedValue({});
    renderPerMapping('nope');

    expect(await screen.findByText(/No migration with id nope answered/)).toBeInTheDocument();
    expect(screen.queryByText(/Run the check/)).not.toBeInTheDocument();
  });

  it("reports the managed final pass as QUEUED — each edition's temporal shape, said not blurred", async () => {
    requestFinalPass.mockResolvedValue('queued');
    renderPerMapping();

    fireEvent.click(await screen.findByRole('button', { name: /Run a pass now/ }));
    await waitFor(() => expect(requestFinalPass).toHaveBeenCalledWith('acme-mail'));
    expect(await screen.findByText(/Queued as a job/)).toBeInTheDocument();
  });
});

describe('the mapping id goes somewhere (0034 T1)', () => {
  it('links the per-mapping heading to the hub', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    renderScreen();

    const link = await screen.findByRole('link', { name: 'acme-mail' });
    expect(link.getAttribute('href')).toBe('/mappings/acme-mail');
  });
});

describe('force is offered only when the refusal explained it (0038 T1)', () => {
  it('a transport failure renders a plain error and a plain retry — NEVER force', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    endOrKeepDataType.mockRejectedValueOnce(new Error('network timeout'));
    renderScreen();

    fireEvent.click(await screen.findByLabelText(/Delivery now goes to the new system/));
    fireEvent.click(screen.getByRole('button', { name: END_MAIL }));

    expect(await screen.findByText(/network timeout/)).toBeInTheDocument();
    // The missing test the fleet named: clicking force after a timeout would
    // retry with force=true and silently skip the informed-refusal gate.
    expect(screen.queryByText(/anyway, leaving them behind/)).not.toBeInTheDocument();
    // A plain retry, force=false.
    endOrKeepDataType.mockResolvedValue({ changed: true });
    fireEvent.click(screen.getByRole('button', { name: END_MAIL }));
    await waitFor(() => expect(endOrKeepDataType).toHaveBeenLastCalledWith('acme-mail', 'email', 'end', false));
  });

  it('a refusal force cannot satisfy is said WITHOUT a force button', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    endOrKeepDataType.mockRejectedValueOnce(
      new PathEndingRefusedError({
        error: 'end_refused',
        refused: 'not_running',
        message: "email is ended or kept once its migration has started, and this one is 'paused'.",
      }),
    );
    renderScreen();

    fireEvent.click(await screen.findByLabelText(/Delivery now goes to the new system/));
    fireEvent.click(screen.getByRole('button', { name: END_MAIL }));

    expect(await screen.findByText(/once its migration has started/)).toBeInTheDocument();
    expect(screen.queryByText(/anyway, leaving them behind/)).not.toBeInTheDocument();
  });
});

describe('a done mapping keeps its aftermath (0038 T2)', () => {
  it('shows the handover and the take-away links on a done mapping', async () => {
    fetchStatus.mockResolvedValue(statusReport('done'));
    renderScreen();

    expect(await screen.findByText('What remains available')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Verification report' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Run history/ }).getAttribute('href'),
    ).toBe('/mappings/acme-mail');
  });

  it('step 3 failure keeps the server message and stops claiming nothing ran', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    requestFinalPass.mockRejectedValue(new Error('upstream timeout after 30s'));
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: /Run a pass now/ }));

    expect(await screen.findByText(/a pass may still be running/)).toBeInTheDocument();
    expect(screen.getByText('upstream timeout after 30s')).toBeInTheDocument();
    expect(screen.queryByText(/nothing ran/)).not.toBeInTheDocument();
  });
});

describe('the checklist checks what it claims to check (0038 T3)', () => {
  it('step 1 renders PASSED from a done report that can proceed', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    fetchVerifyReport.mockResolvedValue({
      state: 'done',
      startedAt: '2026-08-09T10:00:00Z',
      finishedAt: '2026-08-09T10:05:00Z',
      report: {
        'acme-mail': { overallStatus: 'PASS', canProceedToCutover: true, contentEvidence: 'checked' },
      },
    });
    renderScreen();

    expect(await screen.findByText('The check passed.')).toBeInTheDocument();
    expect(screen.queryByText(/No content was compared/)).not.toBeInTheDocument();
  });

  it('step 1 says WHAT it passed on when no content could be compared', async () => {
    // The last screen before the button nobody can un-press. A green "The
    // check passed." over a run that hashed nothing is the same sentence as a
    // run that compared every sampled item, and the person reading it is about
    // to delete the account the data came from.
    //
    // The verdict does not change — the owner's decision of 2026-09-21 is that
    // count parity still opens the gate — so this is added BESIDE it, in
    // amber, rather than turning the line red.
    fetchStatus.mockResolvedValue(statusReport('active'));
    fetchVerifyReport.mockResolvedValue({
      state: 'done',
      startedAt: '2026-08-09T10:00:00Z',
      finishedAt: '2026-08-09T10:05:00Z',
      report: {
        'acme-mail': { overallStatus: 'PASS', canProceedToCutover: true, contentEvidence: 'none' },
      },
    });
    renderScreen();

    expect(await screen.findByText('The check passed.')).toBeInTheDocument();
    expect(screen.getByText(/No content was compared/)).toBeInTheDocument();
  });

  it('step 1 renders the failing status VERBATIM from a not-ready report', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    fetchVerifyReport.mockResolvedValue({
      state: 'done',
      startedAt: '2026-08-09T10:00:00Z',
      finishedAt: '2026-08-09T10:05:00Z',
      report: { 'acme-mail': { overallStatus: 'FAIL', canProceedToCutover: false } },
    });
    renderScreen();

    expect(await screen.findByText(/The check did not pass:/)).toBeInTheDocument();
    expect(screen.getByText(/FAIL/)).toBeInTheDocument();
  });

  it('step 1 says no check has run when none has', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    renderScreen();

    expect(await screen.findByText('No check has run yet.')).toBeInTheDocument();
  });

  it('a failed moves read surfaces its error — never eternal "Reading…"', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    fetchMoves.mockRejectedValue(new Error('moves table unreachable'));
    renderScreen();

    expect(await screen.findByText(/moves table unreachable/)).toBeInTheDocument();
    expect(screen.getByText(/not the same as clear/)).toBeInTheDocument();
    expect(screen.queryByText('Reading…')).not.toBeInTheDocument();
    // The End stays usable — the server re-checks anyway.
    expect(screen.getByRole('button', { name: END_MAIL })).toBeInTheDocument();
  });
});


/**
 * THE DATA TYPE THE FINAL PASS LEAVES OUT (workplan 0125 T7).
 *
 * Step 3 promises the new system reflects the old one "as of right now", and
 * a data type switched off after copying is the exception: its copies stay as
 * they were when it stopped. The owner: the Finish checklist names it, *"so
 * nobody finishes believing those copies are current"*.
 */
describe('a stopped data type is named where the final pass is', () => {
  const calendar = (state: 'stopped' | 'skipped' | 'completed', itemsSynced: number) => ({
    domain: 'calendar' as const,
    state,
    itemsSynced,
    itemsFailed: 0,
    bytesTransferred: 0,
    itemsRetrying: 0,
    itemsNeedingDecision: 0,
  });

  function withCalendar(row: ReturnType<typeof calendar>): StatusReport {
    const report = statusReport('active');
    return {
      ...report,
      mappings: [{ ...report.mappings[0]!, domains: [...report.mappings[0]!.domains, row] }],
    };
  }

  it('names it, with how many copies stay as they were', async () => {
    fetchStatus.mockResolvedValue(withCalendar(calendar('stopped', 412)));
    renderScreen();
    expect(
      await screen.findByText(
        'Calendar is stopped and not in this pass: its 412 copies stay as they were.',
      ),
    ).toBeInTheDocument();
  });

  it('says one copy as one copy', async () => {
    fetchStatus.mockResolvedValue(withCalendar(calendar('stopped', 1)));
    renderScreen();
    expect(
      await screen.findByText('Calendar is stopped and not in this pass: its one copy stays as it was.'),
    ).toBeInTheDocument();
  });

  for (const [state, synced, what] of [
    ['skipped', 0, 'a data type the migration never had'],
    ['completed', 412, 'one that ran'],
  ] as const) {
    it(`says nothing of ${what}`, async () => {
      fetchStatus.mockResolvedValue(withCalendar(calendar(state, synced)));
      renderScreen();
      await screen.findByText(/Run one final pass/);
      expect(screen.queryByText(/is stopped and not in this pass/)).not.toBeInTheDocument();
    });
  }

  function renderPerMapping(id = 'acme-mail') {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/mappings/${id}/finish`]}>
          <Routes>
            <Route path="/mappings/:mappingId/finish" element={<Finish />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('names it in the per-mapping checklist too, from this migration’s own rows', async () => {
    fetchMappingDataTypes.mockResolvedValue({ domains: [calendar('stopped', 7)] });
    renderPerMapping();
    expect(
      await screen.findByText('Calendar is stopped and not in this pass: its 7 copies stay as they were.'),
    ).toBeInTheDocument();
    expect(fetchMappingDataTypes).toHaveBeenCalledWith('acme-mail');
  });

  // One its owner stopped (0128 T4, slice 3c) is the same exception with a
  // different way back: Resume on the migration's page, not the mapping file.
  it('points one its owner stopped at Resume, and one switched off at switching it back on', async () => {
    fetchMappingDataTypes.mockResolvedValue({
      domains: [
        { ...calendar('stopped', 7), stoppedByOwner: true as const },
        { ...calendar('stopped', 3), domain: 'contact' as const },
      ],
    });
    renderPerMapping();
    expect(await screen.findByText(STRINGS.en['finish.step3.stoppedByYou.why'])).toBeInTheDocument();
    expect(screen.getByText(STRINGS.en['finish.step3.stopped.why'])).toBeInTheDocument();
  });

  it('says it could not read them, rather than implying none is stopped', async () => {
    fetchMappingDataTypes.mockRejectedValue(new Error('the status read timed out'));
    renderPerMapping();
    expect(
      await screen.findByText(/Could not read whether a data type is stopped: the status read timed out/),
    ).toBeInTheDocument();
  });
});
