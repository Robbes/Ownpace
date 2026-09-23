// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE SCREEN BEHIND THE REMEDY (workplan 0125 T3).
 *
 * Twenty-one of the owner's refused files carried, per item, by name:
 *
 * > *"…is not copied here because this migration is configured with
 * > `nativeFilePolicy="refuse"`. Set an export policy on the mapping…"*
 *
 * There was nowhere to do it. `nativeFilePolicy` appeared in the whole web app
 * in one file — the creation wizard — and the PUT route parsed a `sourceConfig`
 * and dropped it. So these guards are about a remedy being CARRYABLE: the panel
 * shows the policy actually in force, states what changing it does and does not
 * do before the press, sends the change, and renders a refusal as a refusal.
 *
 * And, since 0125 T5, HOW MANY it does not do it to. §7 asks the change to
 * report *"21 items were refused under the old policy"*; the sentence shipped
 * without the number. The guards below hold the number to hard rule 9: it
 * appears when the queue was read and had some, and the sentence keeps its
 * number-free wording both when the queue could not be read and when it had
 * none — a count nobody took must never read as a count of nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import { FAILURE_GUIDANCE, type FailuresResponse, type ItemFailure } from '@openmig/shared';
import { STRINGS } from '../i18n/strings.ts';

const { setNativeFilePolicies } = vi.hoisted(() => ({ setNativeFilePolicies: vi.fn() }));
vi.mock('../services/mapping-service', () => ({ mappingApi: { setNativeFilePolicies } }));

const { fetchFailures } = vi.hoisted(() => ({ fetchFailures: vi.fn() }));
vi.mock('../services/operating-service', () => ({ fetchFailures }));

import ExportPolicyPanel, {
  policiesInForce,
  policyInForce,
  refusedByPolicy,
} from './ExportPolicyPanel.tsx';

/** One failure row, with the field the count reads and enough to be a row. */
const failure = (over: Partial<ItemFailure> & { naturalKeyHash: string }): ItemFailure => ({
  domain: 'file',
  attempts: 1,
  lastError: 'a Google native file, refused by this migration\u2019s export policy',
  needsDecision: true,
  ...over,
});

/** The queue endpoint's answer for one mapping, split the way the route splits it. */
const queueOf = (failures: ItemFailure[]): FailuresResponse => ({
  'm-1': {
    migrationStatus: 'active',
    needsDecision: failures.filter((f) => f.needsDecision),
    retrying: failures.filter((f) => !f.needsDecision),
    howToResolve: FAILURE_GUIDANCE,
  },
});

const EN = STRINGS.en;

/** An axios-shaped refusal, the way the real apiClient delivers one. */
const axiosError = (status: number, data: unknown): AxiosError => {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = {
    status,
    statusText: 'Conflict',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  };
  return err;
};

function renderPanel(
  props: Partial<React.ComponentProps<typeof ExportPolicyPanel>> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    // Handed back so a test can wait for the failures query to have SETTLED.
    // Without it, asserting that a sentence stayed number-free races the
    // request: the number-free wording is also what is on screen while the
    // count is still in flight, so the assertion would pass before the answer
    // arrived and would keep passing if the answer were rendered wrongly.
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ExportPolicyPanel
            mappingId="m-1"
            sourceType="google"
            domains={['file', 'email']}
            current={undefined}
            {...props}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The default for every test that is not about the count: the queue is not
  // readable, so the sentence keeps its number-free wording.
  fetchFailures.mockRejectedValue(new Error('no queue in this test'));
  setNativeFilePolicies.mockResolvedValue({
    id: 'm-1',
    sourceConfig: { nativeFilePolicies: { document: 'export-pdf' } },
    updatedAt: '2026-09-18T20:00:00.000Z',
  });
});

/** The select for one kind, by the name the reader sees beside it. */
const docs = () => screen.getByLabelText(EN['discovery.refusedNative.kind.document']);

/** Every kind left behind but the Docs, which go as `docsAs`. */
const onlyDocs = (docsAs: string) => ({
  document: docsAs,
  spreadsheet: 'refuse',
  presentation: 'refuse',
  drawing: 'refuse',
});

/** Choose PDF for the Docs and press save — the two steps every count test needs. */
async function saveExportPdf() {
  await userEvent.selectOptions(docs(), 'export-pdf');
  await userEvent.click(
    screen.getByRole('button', { name: EN['settings.exportPolicy.save'] }),
  );
}

describe('whose migration the question belongs to', () => {
  /**
   * The SAME two conditions the wizard asks before offering the chooser. A
   * migration from an IMAP mailbox has no Google Docs to decide about, and a
   * settings panel offering a format for files it does not carry is a setting
   * that changes nothing — which is the shape of remedy this whole plan is
   * about.
   */
  it('renders nothing for a source with no Google files', () => {
    const { container } = renderPanel({ sourceType: 'imap' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a migration that carries no files', () => {
    const { container } = renderPanel({ domains: ['email', 'calendar'] });
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['google', 'google-drive'])('renders for the %s source', (sourceType) => {
    renderPanel({ sourceType });
    expect(screen.getByText(EN['settings.exportPolicy'])).toBeInTheDocument();
  });
});

describe('the policy in force', () => {
  /**
   * ABSENT IS `refuse`, AND SAYS SO. That is what the engine does with an
   * absent value, and it is why thirty of the owner's files were refused by a
   * setting he had never been offered. A blank select would read as "no answer
   * yet" about a migration that has already acted on one.
   */
  it('reads an absent policy as refuse', () => {
    expect(policyInForce(undefined)).toBe('refuse');
    expect(policyInForce(null)).toBe('refuse');
    expect(policyInForce('')).toBe('refuse');
    // Not a value this product knows: still `refuse`, never rendered raw.
    expect(policyInForce('export-wordperfect')).toBe('refuse');
  });

  it.each(['export-odf', 'export-office', 'export-pdf'] as const)(
    'shows %s for every kind when that is the one format the mapping holds',
    (policy) => {
      renderPanel({ current: { nativeFilePolicy: policy } });
      for (const kind of ['document', 'spreadsheet', 'presentation', 'drawing'] as const) {
        const select = screen.getByLabelText(EN[`discovery.refusedNative.kind.${kind}`]);
        expect((select as HTMLSelectElement).value, kind).toBe(policy);
      }
    },
  );

  /**
   * A KIND'S OWN FORMAT WINS (workplan 0042 T9), as it does in the engine: a
   * panel showing "Office" for decks that go out as `.odp` would be offering a
   * change away from something the migration never did.
   */
  it('shows each kind’s own format over the single one', () => {
    renderPanel({
      current: { nativeFilePolicy: 'export-office', nativeFilePolicies: { presentation: 'export-odf' } },
    });
    const slides = screen.getByLabelText(EN['discovery.refusedNative.kind.presentation']);
    expect((slides as HTMLSelectElement).value).toBe('export-odf');
    expect((docs() as HTMLSelectElement).value).toBe('export-office');
    expect(policiesInForce({ nativeFilePolicies: { drawing: 'export-pdf' } })).toEqual({
      document: 'refuse',
      spreadsheet: 'refuse',
      presentation: 'refuse',
      drawing: 'export-pdf',
    });
  });
});

describe('before the press', () => {
  /**
   * NOTHING TO SAVE IS NOT A BUTTON TO PRESS. A save of the value already in
   * force would write `updated_at` and send the person back to a screen that
   * looks exactly the same.
   */
  it('cannot be pressed until the choice differs from what is in force', async () => {
    renderPanel({ current: { nativeFilePolicy: 'export-pdf' } });
    expect(screen.getByRole('button', { name: EN['settings.exportPolicy.save'] })).toBeDisabled();
    await userEvent.selectOptions(docs(), 'export-office');
    expect(
      screen.getByRole('button', { name: EN['settings.exportPolicy.save'] }),
    ).toBeEnabled();
  });

  /**
   * A CHANGE TO ANY ONE KIND IS A CHANGE (workplan 0042 T9): switching the
   * decks alone, the case the per-kind choice exists for, must be savable.
   */
  it('can be pressed once any one kind differs, not only the Docs', async () => {
    renderPanel({ current: { nativeFilePolicy: 'export-office' } });
    expect(screen.getByRole('button', { name: EN['settings.exportPolicy.save'] })).toBeDisabled();
    await userEvent.selectOptions(
      screen.getByLabelText(EN['discovery.refusedNative.kind.presentation']),
      'export-odf',
    );
    expect(screen.getByRole('button', { name: EN['settings.exportPolicy.save'] })).toBeEnabled();
    expect(screen.getByText(EN['settings.exportPolicy.consequence'])).toBeInTheDocument();
  });

  /**
   * THE CONSEQUENCE IS STATED BEFORE THE PRESS, NOT AFTER.
   *
   * Items already copied keep the format they were copied in, because this
   * product never overwrites what is on a target. Somebody should have that
   * before they choose, not discover it about their own migration afterwards.
   */
  it('states what will NOT change, once a change is actually proposed', async () => {
    renderPanel({ current: { nativeFilePolicy: 'refuse' } });
    expect(screen.queryByText(EN['settings.exportPolicy.consequence'])).toBeNull();
    await userEvent.selectOptions(docs(), 'export-pdf');
    expect(screen.getByText(EN['settings.exportPolicy.consequence'])).toBeInTheDocument();
    // What the new names do to the copies already there, before the save
    // (0042 T8 (b), the owner: "The export-format setting says this before you
    // save"): copied under new names, old copies kept as earlier exports.
    expect(EN['settings.exportPolicy.consequence']).toMatch(/copied under their new names/);
    expect(EN['settings.exportPolicy.consequence']).toMatch(/Old copies stay, listed as earlier exports/);
    // And it is there BEFORE anything is sent.
    expect(setNativeFilePolicies).not.toHaveBeenCalled();
  });
});

describe('the press', () => {
  it('sends a format for every kind and says it landed', async () => {
    renderPanel({ current: { nativeFilePolicy: 'refuse' } });
    await userEvent.selectOptions(docs(), 'export-pdf');
    await userEvent.click(
      screen.getByRole('button', { name: EN['settings.exportPolicy.save'] }),
    );
    // All four named, so the single format the migration may also hold decides
    // nothing about them.
    await waitFor(() =>
      expect(setNativeFilePolicies).toHaveBeenCalledWith('m-1', onlyDocs('export-pdf')),
    );
    expect(await screen.findByText(EN['settings.exportPolicy.saved'])).toBeInTheDocument();
  });

  /**
   * AND WHAT THE SAVE DOES NOT DO (0125 T5, offered rather than automatic).
   * The items refused under the old policy stay refused until somebody says to
   * try them again: a settings save that silently reset a queue of recorded
   * decisions would be the bulk mutation of the ledger this codebase
   * consistently refuses to make. The Failures page already presses them as a
   * group, so this is a link to it and not a second button.
   */
  it('points at the failures already recorded, rather than reopening them', async () => {
    renderPanel({ current: { nativeFilePolicy: 'refuse' } });
    await userEvent.selectOptions(docs(), 'export-pdf');
    await userEvent.click(
      screen.getByRole('button', { name: EN['settings.exportPolicy.save'] }),
    );
    expect(
      await screen.findByText(EN['settings.exportPolicy.refusedBefore']),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: EN['settings.exportPolicy.toFailures'] }),
    ).toHaveAttribute('href', '/mappings/m-1/failures');
  });
});

describe('a refusal is a refusal', () => {
  /**
   * HARD RULE 9. The route answers 409 with every refused field and the reason
   * `mayRevise` gave. This panel only ever proposes the export policy, which
   * the table permits — so a 409 here means the rule changed under it, and the
   * one thing that must not happen is for it to look like a save that worked.
   */
  it('renders every reason the server refused, and does not claim a save', async () => {
    setNativeFilePolicies.mockRejectedValue(
      axiosError(409, {
        error: 'revision_refused',
        message: 'Some of what was asked for cannot change.',
        refused: [
          { field: 'source.rootFolderId', reason: 'The folder this migration copies from…' },
          { field: 'target.account', reason: 'The account this migration copies into…' },
        ],
      }),
    );
    renderPanel({ current: { nativeFilePolicy: 'refuse' } });
    await userEvent.selectOptions(docs(), 'export-pdf');
    await userEvent.click(
      screen.getByRole('button', { name: EN['settings.exportPolicy.save'] }),
    );
    // EVERY one, never the first: somebody told about one fixes it and is
    // refused again.
    expect(
      await screen.findByText('The folder this migration copies from…'),
    ).toBeInTheDocument();
    expect(screen.getByText('The account this migration copies into…')).toBeInTheDocument();
    // Neither the confirmation nor the retry pointer, which is what a reader
    // acts on: a refused change that offers "go and retry your failures" sends
    // somebody to press a button for a format that was never applied.
    expect(screen.queryByText(EN['settings.exportPolicy.saved'])).toBeNull();
    expect(screen.queryByText(EN['settings.exportPolicy.refusedBefore'])).toBeNull();
  });

  /**
   * A REFUSAL DOES NOT SURVIVE THE PRESS THAT FIXES IT.
   *
   * The guard the panel actually leans on. "Saved" and a refusal are kept off
   * the screen together by clearing what the last press said before this one
   * speaks — not by a compound condition on each render, which with the reset
   * in place nothing could ever reach. Drop the reset and this goes red with
   * the old reasons still under a screen that says the save landed.
   */
  it('clears the last refusal when the next press succeeds', async () => {
    setNativeFilePolicies.mockRejectedValueOnce(
      axiosError(409, {
        error: 'revision_refused',
        refused: [{ field: 'source.type', reason: 'The system this migration copies FROM…' }],
      }),
    );
    renderPanel({ current: { nativeFilePolicy: 'refuse' } });
    const select = docs();
    const press = () =>
      userEvent.click(screen.getByRole('button', { name: EN['settings.exportPolicy.save'] }));

    await userEvent.selectOptions(select, 'export-pdf');
    await press();
    expect(await screen.findByText('The system this migration copies FROM…')).toBeInTheDocument();

    await userEvent.selectOptions(select, 'export-office');
    await press();
    expect(await screen.findByText(EN['settings.exportPolicy.saved'])).toBeInTheDocument();
    expect(screen.queryByText('The system this migration copies FROM…')).toBeNull();
  });

  /**
   * And anything else falls through to the SERVER'S OWN SENTENCE rather than
   * axios's "Request failed with status code 400" — the wrapper is not the
   * words the route wrote for this moment.
   */
  it('shows the server’s sentence for a refusal that is not a revision one', async () => {
    setNativeFilePolicies.mockRejectedValue(
      axiosError(400, { error: 'Validation error', message: 'nativeFilePolicy: unsupported' }),
    );
    renderPanel({ current: { nativeFilePolicy: 'refuse' } });
    await userEvent.selectOptions(docs(), 'export-pdf');
    await userEvent.click(
      screen.getByRole('button', { name: EN['settings.exportPolicy.save'] }),
    );
    expect(await screen.findByText(/nativeFilePolicy: unsupported/)).toBeInTheDocument();
    expect(screen.queryByText(EN['settings.exportPolicy.saved'])).toBeNull();
  });
});

describe('how many were refused by the format it had (0125 T5)', () => {
  /**
   * THE DISTINCTION THE WHOLE SECTION TURNS ON. `undefined` is "we did not
   * ask, or could not"; `0` is "we asked and there are none". A count that
   * defaulted a missing queue to zero would tell somebody their migration
   * refused nothing on the strength of a request that never came back.
   */
  it('answers undefined for a queue it never read, and 0 for one that was empty', () => {
    expect(refusedByPolicy(undefined)).toBeUndefined();
    expect(refusedByPolicy(queueOf([])['m-1'])).toBe(0);
  });

  it('counts only the rows refused by the policy, in both halves of the queue', () => {
    const counted = refusedByPolicy(
      queueOf([
        failure({ naturalKeyHash: 'a', category: 'policy_refused' }),
        failure({ naturalKeyHash: 'b', category: 'policy_refused', needsDecision: false }),
        failure({ naturalKeyHash: 'c', category: 'target_refused' }),
        // No category at all — a row written before migration 0049. Absent is
        // not `policy_refused`, and counting it would put a number under a
        // failure nobody classified.
        failure({ naturalKeyHash: 'd' }),
      ])['m-1'],
    );
    expect(counted).toBe(2);
  });

  it('says the number once a save has landed', async () => {
    fetchFailures.mockResolvedValue(
      queueOf([
        failure({ naturalKeyHash: 'a', category: 'policy_refused' }),
        failure({ naturalKeyHash: 'b', category: 'policy_refused' }),
        failure({ naturalKeyHash: 'c', category: 'policy_refused' }),
        failure({ naturalKeyHash: 'd', category: 'quota_exceeded' }),
      ]),
    );
    renderPanel({ current: { nativeFilePolicy: 'refuse' } });
    await saveExportPdf();

    expect(
      await screen.findByText(
        EN['settings.exportPolicy.refusedBefore.count'].replace('{count}', '3'),
      ),
    ).toBeInTheDocument();
    expect(fetchFailures).toHaveBeenCalledWith('m-1');
  });

  /**
   * HARD RULE 9. The queue could not be read, so there is no number to say —
   * and the sentence that was always there says what it always said. What must
   * never happen is a zero appearing where a failed request was.
   */
  it('keeps the number-free sentence when the queue could not be read', async () => {
    fetchFailures.mockRejectedValue(new Error('the queue did not answer'));
    const { qc } = renderPanel({ current: { nativeFilePolicy: 'refuse' } });
    await saveExportPdf();

    // Settled in FAILURE, so there is nothing to count and never will be.
    await waitFor(() =>
      expect(qc.getQueryState(['failures', 'm-1'])?.status).toBe('error'),
    );
    expect(screen.getByText(EN['settings.exportPolicy.refusedBefore'])).toBeInTheDocument();
    expect(screen.queryByText(/file\(s\) already refused/)).toBeNull();
  });

  /**
   * AND WHEN THE ANSWER IS GENUINELY NONE. "0 files already refused" is a
   * sentence about nothing, and the link below still leads somewhere worth
   * looking: the owner's own thirty read `unknown` until they are next
   * attempted (§7), so a zero here is not a promise that nothing is waiting.
   */
  it('keeps the number-free sentence, and the link, when the count is zero', async () => {
    fetchFailures.mockResolvedValue(queueOf([failure({ naturalKeyHash: 'a', category: 'unknown' })]));
    const { qc } = renderPanel({ current: { nativeFilePolicy: 'refuse' } });
    await saveExportPdf();

    // The queue ARRIVED and held none. Waiting for that is the whole point:
    // "0 file(s) already refused" is a sentence about nothing, and the
    // number-free wording is also what is on screen while the count is in
    // flight — so an assertion that did not wait would pass either way.
    await waitFor(() => expect(qc.getQueryData(['failures', 'm-1'])).toBeDefined());
    expect(screen.getByText(EN['settings.exportPolicy.refusedBefore'])).toBeInTheDocument();
    expect(screen.queryByText(/file\(s\) already refused/)).toBeNull();
    expect(
      screen.getByRole('link', { name: EN['settings.exportPolicy.toFailures'] }),
    ).toBeInTheDocument();
  });

  /**
   * THE QUEUE IS NOT READ ON A NORMAL PAGE LOAD. The number is part of what a
   * SAVE reports; counting it every time somebody opens the migration page
   * would be a request for a line nobody has asked for yet.
   */
  it('asks for nothing until a save has landed', async () => {
    fetchFailures.mockResolvedValue(queueOf([]));
    renderPanel({ current: { nativeFilePolicy: 'refuse' } });
    await userEvent.selectOptions(docs(), 'export-pdf');
    expect(fetchFailures).not.toHaveBeenCalled();
  });
});
