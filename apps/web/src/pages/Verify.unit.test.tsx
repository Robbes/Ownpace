// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Verify screen on the start + poll pair (workplan 0017 T5).
 *
 * The behaviours worth pinning are the ones a passing typecheck cannot see:
 * nothing fires on mount (the scan is behind the button — the UI-smoke e2e
 * proves it for the built artefact, this proves it for the component), the
 * poll LOOP stops on every terminal state rather than spinning forever, and
 * `failed` renders as "not a result" with the reason — never as a clean page.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter, Route, Routes } from 'react-router';
const { editionFlag } = vi.hoisted(() => ({ editionFlag: { selfhost: false } }));
vi.mock('../services/edition', () => ({
  isSelfHost: () => editionFlag.selfhost,
}));

import Verify from './Verify.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import * as service from '../services/operating-service.ts';
import type { VerificationResult } from '@openmig/shared';
import { VERIFICATION_DOMAINS } from '@openmig/shared';

vi.mock('../services/operating-service', () => ({
  startVerification: vi.fn(),
  fetchVerifyReport: vi.fn(),
}));

const started = vi.mocked(service.startVerification);
const fetched = vi.mocked(service.fetchVerifyReport);

// Each domain carries its OWN dataType, because that is what the screen looks
// its label up by. The fixture used to be one shared object with no dataType at
// all, spread across four hand-written keys — which is how the report gaining a
// fifth domain went unnoticed here: nothing named the domains, so nothing could
// be missing.
const domainFor = (dataType: string) =>
  ({
    dataType,
    status: 'PASS',
    sourceCount: 1,
    targetCount: 1,
    checksumSampled: 0,
    checksumMismatches: 0,
    totalBytesSource: 0,
    totalBytesTarget: null,
    issues: [],
  }) as never;

const RESULT: VerificationResult = {
  tenantId: 't' as never,
  mappingId: 'm' as never,
  timestamp: '2026-07-31T12:00:00Z',
  overallStatus: 'PASS',
  // Nothing in this fixture is hashed, so this is what the engine would say
  // about it. See `summariseContentEvidence`.
  contentEvidence: 'none',
  score: 1,
  ...(Object.fromEntries(
    VERIFICATION_DOMAINS.map((d) => [d, domainFor(d)]),
  ) as Record<(typeof VERIFICATION_DOMAINS)[number], never>),
  totalItemsSource: 1,
  totalItemsTarget: 1,
  totalDiscrepancies: 0,
  totalBytesTransferred: 0,
  canProceedToCutover: true,
  recommendations: [],
};

beforeEach(() => {
  editionFlag.selfhost = false;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.removeItem('ownpace.locale');
});

describe('the Verify screen', () => {
  it('STARTS nothing on mount — but reads the stored report once (0038 T6)', async () => {
    fetched.mockResolvedValue({ state: 'never-run' });
    render(<MemoryRouter><Verify /></MemoryRouter>);
    // The behind-a-button rationale applies to the SCAN, not to the safe
    // status read: navigation must not cost a re-scan, so mount reads the
    // report endpoint once (it starts nothing) and renders what is stored.
    expect(started).not.toHaveBeenCalled();
    await waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
    // And says what pressing it costs, before it is pressed.
    expect(screen.getByText(/takes minutes/i)).toBeInTheDocument();
  });

  it('renders a STORED done report on mount, labelled with its as-of', async () => {
    fetched.mockResolvedValue({
      state: 'done',
      startedAt: '2026-07-31T12:00:00Z',
      finishedAt: '2026-07-31T12:03:00Z',
      report: { 'mapping-1': RESULT },
    });
    render(<MemoryRouter><Verify /></MemoryRouter>);

    // The operator who ran the minutes-long check, visited Deletions, and
    // came back used to find it GONE though both servers retain it.
    expect(await screen.findByRole('link', { name: 'mapping-1' })).toBeInTheDocument();
    expect(started).not.toHaveBeenCalled();
    expect(screen.getByText(/^Checked/)).toBeInTheDocument();
  });

  it('gives EVERY domain in the report a row, not just the four it used to list', async () => {
    // The screen's label map has been total since 0113 T5 — and the array it
    // rendered from listed four, so Tasks had a translated name and no row.
    // A domain the report measured and the operator cannot see is worse than an
    // unmeasured one: the page reads as complete.
    //
    // Asserted by NAME rather than by row count, so a fifth row appearing for
    // the wrong reason does not satisfy it.
    fetched.mockResolvedValue({
      state: 'done',
      startedAt: '2026-07-31T12:00:00Z',
      finishedAt: '2026-07-31T12:03:00Z',
      report: { 'mapping-1': RESULT },
    });
    render(<MemoryRouter><Verify /></MemoryRouter>);
    await screen.findByRole('link', { name: 'mapping-1' });

    for (const label of ['Email', 'Calendar', 'Contacts', 'Files', 'Tasks']) {
      expect(
        screen.getByRole('cell', { name: label }),
        `the report carries ${VERIFICATION_DOMAINS.length} domains and the screen has no ${label} row`,
      ).toBeInTheDocument();
    }
  });

  it('says the gate opened on COUNTS when nothing could be compared', async () => {
    // The owner's decision of 2026-09-21, on the screen. A run that hashed
    // nothing reads PASS, score 1, ready to switch — and
    // `determineVerificationStatus` never sees the `CHECKSUM_UNAVAILABLE_*`
    // issue that would say why, because it is handed percentages and counts.
    // Since the owner's D2 of 2026-09-24 (workplan 0149 T4) that is only a
    // target with no way to hash, JMAP contacts; one that can hash and
    // answered nothing fails. This fixture is still that first, valid state.
    //
    // So the person about to delete their Google account sees a page that is
    // indistinguishable from one where every sampled item matched. This is the
    // line that makes it distinguishable, and it belongs in the SENTENCE they
    // act on, not only in the word beside the score.
    fetched.mockResolvedValue({
      state: 'done',
      startedAt: '2026-07-31T12:00:00Z',
      finishedAt: '2026-07-31T12:03:00Z',
      report: { 'mapping-1': { ...RESULT, contentEvidence: 'none' } },
    });
    render(<MemoryRouter><Verify /></MemoryRouter>);
    await screen.findByRole('link', { name: 'mapping-1' });

    expect(screen.getByText('counts only')).toBeInTheDocument();
    // Beside the verdict, not instead of it: both facts, together.
    expect(screen.getByText(/ready to switch/i)).toBeInTheDocument();
    expect(screen.getByText(/No content was compared/)).toBeInTheDocument();
  });

  it('does not say it when the content really was compared', async () => {
    // The control. Without it, the sentence above could be unconditional and
    // every report would carry a caveat it had earned the right not to.
    fetched.mockResolvedValue({
      state: 'done',
      startedAt: '2026-07-31T12:00:00Z',
      finishedAt: '2026-07-31T12:03:00Z',
      report: { 'mapping-1': { ...RESULT, contentEvidence: 'checked' } },
    });
    render(<MemoryRouter><Verify /></MemoryRouter>);
    await screen.findByRole('link', { name: 'mapping-1' });

    expect(screen.getByText('content checked')).toBeInTheDocument();
    expect(screen.queryByText(/No content was compared/)).not.toBeInTheDocument();
  });

  it('starts on click, polls to done, renders the report, and STOPS polling', async () => {
    vi.useFakeTimers();
    started.mockResolvedValue({
      started: true,
      report: { state: 'running', startedAt: '2026-07-31T12:00:00Z' },
    });
    fetched
      .mockResolvedValueOnce({ state: 'running', startedAt: '2026-07-31T12:00:00Z' })
      .mockResolvedValue({
        state: 'done',
        startedAt: '2026-07-31T12:00:00Z',
        finishedAt: '2026-07-31T12:03:00Z',
        report: { 'mapping-1': RESULT },
      });

    render(<MemoryRouter><Verify /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /run the check/i }));
    // Let the start promise settle and arm the interval, then run it once.
    await act(async () => {});
    expect(started).toHaveBeenCalledTimes(1);

    // First (immediate) poll says running; the interval's next says done.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(screen.getByRole('link', { name: 'mapping-1' }).getAttribute('href')).toBe(
      '/mappings/mapping-1',
    );
    // The report says WHEN it was generated (0036 T1) — finishedAt was
    // served all along and discarded; a stale report read as current.
    expect(screen.getByText(/^Checked/)).toBeInTheDocument();

    // The loop is DEAD after a terminal state: minutes later, no more reads.
    const callsAtDone = fetched.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetched.mock.calls.length).toBe(callsAtDone);
  });

  it('renders failed as NOT-a-result, with the reason, and stops polling', async () => {
    vi.useFakeTimers();
    started.mockResolvedValue({
      started: true,
      report: { state: 'running', startedAt: '2026-07-31T12:00:00Z' },
    });
    fetched.mockResolvedValue({
      state: 'failed',
      startedAt: '2026-07-31T12:00:00Z',
      error: 'the scan fell over',
    });

    render(<MemoryRouter><Verify /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /run the check/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByText(/the scan fell over/)).toBeInTheDocument();
    // The sentence that stops a red box being misread as a verdict.
    expect(screen.getByText(/not a result/i)).toBeInTheDocument();

    const callsAtFailure = fetched.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetched.mock.calls.length).toBe(callsAtFailure);
  });

  it('a mid-run appliance restart is said out loud, not polled against forever', async () => {
    vi.useFakeTimers();
    started.mockResolvedValue({
      started: true,
      report: { state: 'running', startedAt: '2026-07-31T12:00:00Z' },
    });
    // The appliance restarted and honestly forgot the run (its report lives in
    // memory — the contract documents this instead of hiding it).
    fetched.mockResolvedValue({ state: 'never-run' });

    render(<MemoryRouter><Verify /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /run the check/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByText(/restarted while the check ran/i)).toBeInTheDocument();
  });

  it('a missed poll keeps polling — the run state is authoritative, not the network', async () => {
    vi.useFakeTimers();
    started.mockResolvedValue({
      started: true,
      report: { state: 'running', startedAt: '2026-07-31T12:00:00Z' },
    });
    fetched
      .mockRejectedValueOnce(new Error('laptop lid closed'))
      .mockResolvedValue({
        state: 'done',
        startedAt: '2026-07-31T12:00:00Z',
        finishedAt: '2026-07-31T12:03:00Z',
        report: { 'mapping-1': RESULT },
      });

    render(<MemoryRouter><Verify /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /run the check/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

    // The rejected first poll did not kill the loop or the run.
    expect(screen.getByRole('link', { name: 'mapping-1' }).getAttribute('href')).toBe(
      '/mappings/mapping-1',
    );
  });

  it('hands the route mappingId to BOTH service calls on the managed per-mapping route', async () => {
    // The bare renders above have no router, so `useParams` yields nothing and
    // the service sees `undefined` — the appliance's flat shape. This is the
    // managed shape: the id in the URL must reach start AND report, or the
    // screen would start one mapping's scan and poll another's.
    vi.useFakeTimers();
    started.mockResolvedValue({
      started: true,
      report: { state: 'running', startedAt: '2026-07-31T12:00:00Z' },
    });
    fetched.mockResolvedValue({
      state: 'failed',
      startedAt: '2026-07-31T12:00:00Z',
      error: 'stopped here, deliberately — one poll is enough for this test',
    });

    render(
      <MemoryRouter initialEntries={['/mappings/m-42/verify']}>
        <Routes>
          <Route path="mappings/:mappingId/verify" element={<Verify />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /run the check/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(started).toHaveBeenCalledWith('m-42');
    expect(fetched).toHaveBeenCalledWith('m-42');
  });
});

describe('the appliance-wide scope is stated (0038 T6)', () => {
  it('selfhost says the check covers every configured migration', async () => {
    editionFlag.selfhost = true;
    fetched.mockResolvedValue({ state: 'never-run' });
    render(<MemoryRouter><Verify /></MemoryRouter>);

    expect(
      await screen.findByText(/covers every configured migration/),
    ).toBeInTheDocument();
  });

  it('managed says no such thing — its check IS per-mapping', async () => {
    fetched.mockResolvedValue({ state: 'never-run' });
    render(<MemoryRouter><Verify /></MemoryRouter>);

    await screen.findByText(/takes minutes/i);
    expect(screen.queryByText(/covers every configured migration/)).not.toBeInTheDocument();
  });
});

describe('the check on a phone, and in the reader’s numbers', () => {
  const DONE = {
    state: 'done',
    startedAt: '2026-07-31T12:00:00Z',
    finishedAt: '2026-07-31T12:03:00Z',
    report: { 'mapping-1': RESULT },
  } as const;
  const COLUMNS = ['On the old system', 'On the new system', 'Missing', 'Content sample', 'Size on the new system'];

  it('names its columns by the new system, the words the old one’s column already uses', async () => {
    fetched.mockResolvedValue(DONE);
    render(<MemoryRouter><Verify /></MemoryRouter>);
    await screen.findByRole('link', { name: 'mapping-1' });

    for (const name of ['Type', 'Result', ...COLUMNS]) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
    }
    // A size the new system does not give was not compared; it is not a mismatch.
    expect(screen.getAllByTitle('Not compared: the new system gives no size.')).toHaveLength(
      VERIFICATION_DOMAINS.length,
    );
  });

  it('says each count’s column beside it, for a phone, where the header row is not drawn', async () => {
    // Below 640 pixels each data type is a block of its own: no count sits
    // behind a sideways scroll nobody can see, and each says what it counts.
    fetched.mockResolvedValue(DONE);
    render(<MemoryRouter><Verify /></MemoryRouter>);
    await screen.findByRole('link', { name: 'mapping-1' });

    const row = screen.getByRole('cell', { name: 'Email' }).closest('tr')!;
    for (const label of COLUMNS) {
      const said = within(row).getByText(label);
      expect(said.closest('td'), `${label} is said inside its own cell`).not.toBeNull();
      expect(said.className, `${label} is the phone's label, gone where the header says it`).toContain('sm:hidden');
    }
  });

  it('lets a keyboard reach the table’s box, named by its migration’s heading', async () => {
    // On the appliance the screen draws one report per migration, so a box
    // named by the screen's title would be several landmarks with one name.
    fetched.mockResolvedValue(DONE);
    render(<MemoryRouter><Verify /></MemoryRouter>);
    await screen.findByRole('link', { name: 'mapping-1' });

    const region = screen.getByRole('region', { name: 'mapping-1' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(within(region).getByRole('table')).toBeInTheDocument();
  });

  it('gives each migration’s box its own name when the appliance reports several', async () => {
    editionFlag.selfhost = true;
    fetched.mockResolvedValue({ ...DONE, report: { 'mapping-1': RESULT, 'mapping-2': RESULT } });
    render(<MemoryRouter><Verify /></MemoryRouter>);
    await screen.findByRole('link', { name: 'mapping-2' });

    // Two boxes, and each is found by its own migration's name alone.
    expect(screen.getAllByRole('region')).toHaveLength(2);
    for (const id of ['mapping-1', 'mapping-2']) {
      const region = screen.getByRole('region', { name: id });
      expect(within(region).getByRole('table')).toBeInTheDocument();
    }
  });

  it('says the score in the reader’s decimals', async () => {
    fetched.mockResolvedValue(DONE);
    window.localStorage.setItem('ownpace.locale', 'nl');
    const { unmount } = render(
      <LocaleProvider>
        <MemoryRouter><Verify /></MemoryRouter>
      </LocaleProvider>,
    );
    await screen.findByRole('link', { name: 'mapping-1' });
    expect(screen.getByText('score 100,0%')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Op het nieuwe systeem' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Grootte op het nieuwe systeem' })).toBeInTheDocument();
    unmount();

    window.localStorage.setItem('ownpace.locale', 'en');
    render(
      <LocaleProvider>
        <MemoryRouter><Verify /></MemoryRouter>
      </LocaleProvider>,
    );
    await screen.findByRole('link', { name: 'mapping-1' });
    expect(screen.getByText('score 100.0%')).toBeInTheDocument();
  });
});

/**
 * WHAT THE CHECK FOUND, IN THE READER'S WORDS (the owner, 2026-10-18, on
 * finish-verify-english-findings and words-verdict-evidence-english).
 *
 * A Dutch screen read `ERROR PROPFIND on / failed with 401 Unauthorized` and
 * `NOT_VERIFIABLE` beside `Geverifieerd`. The verdicts and the severities are
 * the client's words now, the server's token kept in the title, where a
 * support thread can still quote it. The four findings the client knows by
 * their id are the client's sentences; the server's own text stays, closed,
 * under *Technical details*, with the recommendations. A finding the client
 * does not know keeps the server's text, so nothing found is ever dropped.
 */
describe('what the check found, in the reader’s words (owner, 2026-10-18)', () => {
  const issue = (id: string, severity: 'ERROR' | 'WARNING', message: string) => ({ id, severity, message });
  const UNREAD = '811 contacts item(s) were copied, but the target could not be read for this domain: PROPFIND on / failed with 401 Unauthorized.';
  const GONE = 'The folder /Ownpace does not exist on the new system any more, so none of the 40 files item(s) copied into it are there.';
  const MISSING = '1234 mail item(s) missing on target';
  const DIFFERS = '2 mail item(s) have content mismatches';
  const EXTRA = '1 calendar item(s) exist on target but not source';
  const RECOMMENDATION = 'Fix all errors before proceeding to cutover';

  /** One data type of the report, as `domainFor` draws it, with what this case changes. */
  const found = (dataType: string, change: Record<string, unknown>) =>
    ({ ...(domainFor(dataType) as object), ...change }) as never;

  const FOUND: VerificationResult = {
    ...RESULT,
    overallStatus: 'FAIL',
    canProceedToCutover: false,
    contentEvidence: 'partial',
    score: 0.5,
    mail: found('mail', {
      status: 'FAIL',
      missingOnTarget: 1234,
      checksumMismatches: 2,
      issues: [issue('MISSING_mail', 'ERROR', MISSING), issue('CHECKSUM_mail', 'ERROR', DIFFERS)],
    }),
    calendar: found('calendar', { status: 'WARN', issues: [issue('EXTRA_calendar', 'WARNING', EXTRA)] }),
    contacts: found('contacts', {
      status: 'NOT_VERIFIABLE',
      issues: [issue('TARGET_UNREAD_contacts', 'ERROR', UNREAD)],
    }),
    files: found('files', {
      status: 'FAIL',
      missingOnTarget: 40,
      issues: [issue('TARGET_FOLDER_MISSING_files', 'ERROR', GONE)],
    }),
    tasks: found('tasks', { status: 'SKIPPED' }),
    recommendations: [RECOMMENDATION],
  };

  async function renderIn(locale: 'en' | 'nl') {
    window.localStorage.setItem('ownpace.locale', locale);
    fetched.mockResolvedValue({
      state: 'done',
      startedAt: '2026-07-31T12:00:00Z',
      finishedAt: '2026-07-31T12:03:00Z',
      report: { 'mapping-1': FOUND },
    });
    render(
      <LocaleProvider>
        <MemoryRouter><Verify /></MemoryRouter>
      </LocaleProvider>,
    );
    await screen.findByRole('link', { name: 'mapping-1' });
  }

  /** Outside the closed fold: what somebody reads without opening anything. */
  const shown = (text: string | RegExp) =>
    screen.queryAllByText(text).filter((el) => el.closest('details') === null);

  const WORDS = {
    en: {
      verdicts: { Email: ['Did not pass', 'FAIL'], Calendar: ['Passed, with warnings', 'WARN'], Contacts: ['Could not be checked', 'NOT_VERIFIABLE'], Files: ['Did not pass', 'FAIL'], Tasks: ['Not checked', 'SKIPPED'] },
      failed: 'Did not pass',
      problem: 'Problem',
      warning: 'Warning',
      fold: 'Technical details',
      sentences: [
        'The files folder is gone from the new system, so the copies in it are missing. Restore it (on Nextcloud: Deleted files), then check again.',
        'The new system did not answer for contacts, so it could not be checked. Look at the account on the Accounts page, then check again.',
        '1,234 email items are on the old system but not on the new one. Let another pass run, then check again.',
        '2 sampled email items differ from the original. Confirmed shows which.',
      ],
    },
    nl: {
      verdicts: { 'E-mail': ['Niet geslaagd', 'FAIL'], Agenda: ['Geslaagd, met waarschuwingen', 'WARN'], Contacten: ['Kon niet worden geverifieerd', 'NOT_VERIFIABLE'], Bestanden: ['Niet geslaagd', 'FAIL'], Taken: ['Niet geverifieerd', 'SKIPPED'] },
      failed: 'Niet geslaagd',
      problem: 'Probleem',
      warning: 'Waarschuwing',
      fold: 'Technische details',
      sentences: [
        'De map voor bestanden staat niet meer op het nieuwe systeem, dus de kopieën daarin ontbreken. Zet de map terug (in Nextcloud: Verwijderde bestanden) en verifieer opnieuw.',
        'Het nieuwe systeem gaf geen antwoord voor contacten, dus dit kon niet worden geverifieerd. Bekijk het account op de pagina Accounts en verifieer daarna opnieuw.',
        '1.234 items (e-mail) staan op het oude systeem maar niet op het nieuwe. Laat nog een ronde lopen en verifieer daarna opnieuw.',
        '2 items (e-mail) uit de steekproef wijken af van het origineel. Bevestigd laat zien welke.',
      ],
    },
  } as const;

  it.each(['en', 'nl'] as const)('says each verdict in words, the token kept in its title, in %s', async (locale) => {
    await renderIn(locale);
    const w = WORDS[locale];
    for (const [type, [word, token]] of Object.entries(w.verdicts)) {
      const row = screen.getByRole('cell', { name: type }).closest('tr')!;
      const said = within(row).getByText(word);
      expect(said.getAttribute('title'), `${type}'s verdict keeps ${token} to quote`).toContain(token);
    }
    // The migration's own verdict, beside its score.
    const overall = shown(w.failed).find((el) => el.closest('tr') === null);
    expect(overall?.getAttribute('title')).toContain('FAIL');
    for (const token of ['PASS', 'WARN', 'FAIL', 'SKIPPED', 'NOT_VERIFIABLE', 'ERROR', 'WARNING']) {
      expect(shown(token), `${token} is said outside the fold`).toEqual([]);
    }
  });

  it.each(['en', 'nl'] as const)('says what it found in sentences of its own, the server’s text closed under the fold, in %s', async (locale) => {
    await renderIn(locale);
    const w = WORDS[locale];
    for (const sentence of w.sentences) {
      expect(shown(sentence), sentence).toHaveLength(1);
    }
    // Each finding's severity in words, its token in the title.
    expect(shown(w.problem)).toHaveLength(4);
    for (const el of shown(w.problem)) expect(el).toHaveAttribute('title', 'ERROR');
    expect(shown(w.warning)).toHaveLength(1);
    expect(shown(w.warning)[0]).toHaveAttribute('title', 'WARNING');

    // The server's words for the four it knows: only in the fold, closed.
    const fold = screen.getByText(w.fold).closest('details')!;
    expect(fold).not.toBeNull();
    expect(fold).not.toHaveAttribute('open');
    for (const text of [UNREAD, GONE, MISSING, DIFFERS, RECOMMENDATION]) {
      expect(shown(new RegExp(text.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&'))), text).toEqual([]);
      expect(within(fold).getByText(new RegExp(text.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')))).toBeInTheDocument();
    }
    // The ids, for whoever quotes them.
    expect(within(fold).getByText(/TARGET_UNREAD_contacts/)).toBeInTheDocument();
  });

  it('keeps the server’s text for a finding it has no sentence for', async () => {
    await renderIn('nl');
    // Nothing found is dropped: an unknown id says what the server said.
    expect(shown(EXTRA)).toHaveLength(1);
  });

  it('knows only ids the check really writes', () => {
    // The four sentences answer to ids `runVerification` builds. Renamed
    // there and not here, each would fall back to the server's English in
    // silence; so the source is read for each one.
    const core = readFileSync(join(__dirname, '../../../../packages/core/src/verification.ts'), 'utf8');
    expect(core).toContain("export const TARGET_UNREAD = 'TARGET_UNREAD';");
    expect(core).toContain("export const TARGET_FOLDER_MISSING = 'TARGET_FOLDER_MISSING';");
    expect(core).toContain('id: `${TARGET_FOLDER_MISSING}_${dataType}`');
    expect(core).toMatch(/'NOT_VERIFIABLE',[^;]*TARGET_UNREAD,\s*\);/);
    expect(core).toContain('id: `MISSING_${dataType}`');
    expect(core).toContain('id: `CHECKSUM_${dataType}`');
  });
});
