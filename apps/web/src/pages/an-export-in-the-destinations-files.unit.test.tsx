// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN EXPORT IN THE DESTINATION'S OWN FILES (workplan 0148 T9, D11).
 *
 * The export archive's form asked for a path and nothing else, and a path
 * meant one place: the disk of the machine running the pass. On the appliance
 * that is the person's own machine. On managed it is ours, the API refuses it
 * (0136 T5), and so the card was offered on managed with no way to complete
 * it. The owner's answer: *"the wizard should be able to read a Takeout export
 * from a folder in the tester's Nextcloud or other target files-kind
 * supporting target."*
 *
 * So both doors that draw the archive form — the wizard and the Connections
 * page — ask WHERE the export is, from the one descriptor:
 *
 *  - a folder of the destination's files, or this appliance's disk;
 *  - on managed the destination is the default, and the disk is SHOWN,
 *    disabled, with *Only on a self-hosted appliance* (D10: nothing is hidden;
 *    the owner: *"'Only on a self-hosted appliance': ok"*);
 *  - on the appliance the disk stays the default, so no existing mapping
 *    changes meaning;
 *  - the path's label follows the choice, and the doors post `where`.
 *
 * In the wizard, the Test of an export in the destination answers that it is
 * counted at the preflight, and the person continues on that answer; the
 * target step then says, in the create door's own words, when the chosen
 * destination has no files an export can be read from.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { archiveInTargetRefusal } from '@openmig/shared';
import { STRINGS } from '../i18n/strings.ts';

const { editionFlag } = vi.hoisted(() => ({ editionFlag: { selfhost: false } }));

// The edition, through the sanctioned seam. Managed unless a case says not.
vi.mock('../services/edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return { ...actual, isSelfHost: () => editionFlag.selfhost };
});

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    create: vi.fn(),
    testConnection: vi.fn(),
    googleAuthorize: vi.fn(),
    dropboxAuthorize: vi.fn(),
    microsoftAuthorize: vi.fn(),
  },
  connectionsApi: {
    list: vi.fn().mockResolvedValue([]),
    test: vi.fn(),
    add: vi.fn(),
    rotate: vi.fn(),
    remove: vi.fn(),
  },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  providerClientsApi: {
    get: vi.fn().mockResolvedValue({ google: 'connection', dropbox: 'connection', microsoft: 'connection' }),
  },
}));

const { connectionsApi } = await import('../services/mapping-service.ts');
const { default: CreateMapping } = await import('./CreateMapping.tsx');
const { default: Connections } = await import('./Connections.tsx');

const en = STRINGS.en;
const TO_TARGET = en['wizard.archiveWhere.target'];
const ON_DISK = en['wizard.archiveWhere.disk'];
const ONLY_APPLIANCE = en['wizard.archiveWhere.disk.onlyAppliance'];

beforeEach(() => {
  globalThis.sessionStorage.clear();
  editionFlag.selfhost = false;
  vi.mocked(connectionsApi.list).mockResolvedValue([]);
  vi.mocked(connectionsApi.add).mockReset();
});

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

function renderWizard() {
  return render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={['/mappings/new']}>
        <Routes>
          <Route path="/mappings/new" element={<CreateMapping />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openConnectionsForm() {
  render(
    <QueryClientProvider client={client()}>
      <MemoryRouter>
        <Connections />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByText('Add a connection'));
}

const pickArchive = () => fireEvent.click(screen.getByRole('button', { name: /^Export archive/ }));
const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${escape(name)}`) }) as HTMLInputElement;
const nextButton = () => screen.getByRole('button', { name: /^(Next|Create Migration)$/ });
const blockedReason = () => screen.queryByRole('status')?.textContent ?? null;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe.each([
  ['the wizard', async () => renderWizard()],
  ['the Connections page', openConnectionsForm],
])('%s asks where the export is', (_door, open) => {
  it('offers the two places, from the descriptor', async () => {
    await open();
    pickArchive();
    expect(radio(TO_TARGET)).toBeTruthy();
    expect(radio(ON_DISK)).toBeTruthy();
  });

  it('on managed: the destination is the default, and the disk is shown disabled, with its line', async () => {
    await open();
    pickArchive();
    expect(radio(TO_TARGET).checked).toBe(true);
    expect(radio(TO_TARGET).disabled).toBe(false);
    const disk = radio(ON_DISK);
    expect(disk.checked).toBe(false);
    expect(disk.disabled, 'the disk option can be chosen on managed').toBe(true);
    // Shown, not hidden (D10), and it says why it cannot be chosen.
    const option = disk.closest('label')!;
    expect(within(option).getByText(ONLY_APPLIANCE)).toBeTruthy();
    // The path follows the choice: a folder of the person's own files.
    expect(screen.getByText(en['wizard.archivePath.target'], { selector: 'label, span' })).toBeTruthy();
  });

  it('on the appliance: the disk stays the default, and both can be chosen', async () => {
    editionFlag.selfhost = true;
    await open();
    pickArchive();
    expect(radio(ON_DISK).checked).toBe(true);
    expect(radio(ON_DISK).disabled).toBe(false);
    expect(radio(TO_TARGET).disabled).toBe(false);
    expect(screen.queryByText(ONLY_APPLIANCE)).toBeNull();
    expect(screen.getByText(en['wizard.archivePath'], { selector: 'label, span' })).toBeTruthy();
    // And the choice moves the path's label with it.
    fireEvent.click(radio(TO_TARGET));
    expect(screen.getByText(en['wizard.archivePath.target'], { selector: 'label, span' })).toBeTruthy();
  });
});

describe('the doors post where', () => {
  it('the Connections page posts `where: "target"` beside the folder', async () => {
    await openConnectionsForm();
    pickArchive();
    fireEvent.change(screen.getByLabelText(/^Which export/), { target: { value: 'google-takeout' } });
    fireEvent.change(screen.getByLabelText(new RegExp(`^${escape(en['wizard.archivePath.target'])}`)), {
      target: { value: 'Exports/takeout-20260904' },
    });
    fireEvent.change(screen.getByLabelText(/^Connection name/), { target: { value: 'my photos' } });
    vi.mocked(connectionsApi.add).mockResolvedValue({ id: 'c-archive', ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add and test' }));
    await waitFor(() => expect(connectionsApi.add).toHaveBeenCalled());
    expect(vi.mocked(connectionsApi.add).mock.calls[0]![0]).toEqual({
      role: 'source',
      type: 'archive',
      displayName: 'my photos',
      values: { provider: 'google-takeout', path: 'Exports/takeout-20260904', where: 'target' },
    });
  });

  it('the wizard’s Test posts `where`, answers at the preflight, and lets the person continue', async () => {
    vi.mocked(connectionsApi.add).mockResolvedValue({
      id: 'c-archive',
      ok: false,
      reason: 'counted at the preflight',
      outcome: { code: 'countedAtPreflight' },
    });
    renderWizard();
    pickArchive();
    fireEvent.change(screen.getByLabelText(/^Which export/), { target: { value: 'google-takeout' } });
    fireEvent.change(screen.getByLabelText(new RegExp(`^${escape(en['wizard.archivePath.target'])}`)), {
      target: { value: 'Exports/takeout-20260904' },
    });
    fireEvent.click(screen.getByRole('button', { name: en['wizard.testConnections'] }));
    await waitFor(() => expect(connectionsApi.add).toHaveBeenCalled());
    expect(vi.mocked(connectionsApi.add).mock.calls[0]![0]).toMatchObject({
      role: 'source',
      type: 'archive',
      values: { provider: 'google-takeout', path: 'Exports/takeout-20260904', where: 'target' },
    });
    expect(await screen.findByText(en['probe.countedAtPreflight'])).toBeTruthy();
    // KEPT AND USED (0148 T9 review): the answer is not a failure, so the
    // wizard continues on the row it just stored. A connection in use hides
    // what belongs to the connection — which export — and keeps this
    // mapping's own answers, where and which folder. Without that, the create
    // door would store the same archive a second time.
    await waitFor(() => expect(screen.queryByLabelText(/^Which export/)).toBeNull());
    expect(radio(TO_TARGET).checked).toBe(true);
    expect(screen.getByLabelText(new RegExp(`^${escape(en['wizard.archivePath.target'])}`))).toBeTruthy();
    expect(connectionsApi.add).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(nextButton()).toBeEnabled());
  });
});

/**
 * A STORED ROW SAYS WHERE IT IS (0148 T9 review). A reused connection's choice
 * starts from the row's own `where`, not this edition's default: the screen
 * shows the store the pass will read, and the target step judges that one.
 */
describe('the wizard reusing a stored archive connection', () => {
  const stored = (knownValues: Record<string, string>) =>
    [
      {
        id: 'c-stored',
        role: 'source',
        kind: 'archive',
        displayName: 'my photos',
        status: 'connected',
        createdAt: '2026-09-01T00:00:00Z',
        usedByMigrations: 0,
        knownValues,
      },
    ] as never;

  it('on the appliance, a row in the destination’s files shows the destination, not the disk', async () => {
    editionFlag.selfhost = true;
    vi.mocked(connectionsApi.list).mockResolvedValue(stored({ where: 'target' }));
    renderWizard();
    pickArchive();
    await waitFor(() => expect(screen.queryByLabelText(/^Which export/)).toBeNull());
    expect(radio(TO_TARGET).checked).toBe(true);
    expect(radio(ON_DISK).checked).toBe(false);
  });

  it('on managed, a row stored before `where` shows the disk it is on, disabled', async () => {
    vi.mocked(connectionsApi.list).mockResolvedValue(stored({}));
    renderWizard();
    pickArchive();
    await waitFor(() => expect(screen.queryByLabelText(/^Which export/)).toBeNull());
    expect(radio(ON_DISK).checked).toBe(true);
    expect(radio(ON_DISK).disabled).toBe(true);
    // Marked and not answerable here: the create door refuses the disk on
    // managed, so Next says so on this step, and the other answer is the way on.
    fireEvent.change(screen.getByLabelText(new RegExp(`^${escape(en['wizard.archivePath'])}`)), {
      target: { value: 'Exports/takeout-20261104' },
    });
    expect(nextButton()).toBeDisabled();
    expect(blockedReason()).toContain(en['wizard.archiveWhere']);
    fireEvent.click(radio(TO_TARGET));
    await waitFor(() => expect(nextButton()).toBeEnabled());
  });

  it('still asks for this migration’s folder: the door refuses a reuse without one', async () => {
    vi.mocked(connectionsApi.list).mockResolvedValue(stored({ where: 'target' }));
    renderWizard();
    pickArchive();
    await waitFor(() => expect(screen.queryByLabelText(/^Which export/)).toBeNull());
    expect(nextButton()).toBeDisabled();
    expect(blockedReason()).toContain(en['wizard.archivePath.target']);
    fireEvent.change(screen.getByLabelText(new RegExp(`^${escape(en['wizard.archivePath.target'])}`)), {
      target: { value: 'Exports/takeout-20261104' },
    });
    await waitFor(() => expect(nextButton()).toBeEnabled());
  });
});

describe('the wizard’s target step reads the same rule as the create door', () => {
  async function toTargetStep() {
    renderWizard();
    pickArchive();
    fireEvent.change(screen.getByLabelText(/^Which export/), { target: { value: 'google-takeout' } });
    fireEvent.change(screen.getByLabelText(new RegExp(`^${escape(en['wizard.archivePath.target'])}`)), {
      target: { value: 'Exports/takeout-20260904' },
    });
    await waitFor(() => expect(nextButton()).toBeEnabled());
    fireEvent.click(nextButton());
  }

  it('a JMAP destination is refused in the create door’s words, and Next with it', async () => {
    await toTargetStep();
    fireEvent.click(screen.getByRole('button', { name: /^JMAP/ }));
    expect(blockedReason()).toContain(archiveInTargetRefusal('jmap')!);
    expect(nextButton()).toBeDisabled();
  });

  it('a destination with no files is refused, naming the ones that have them', async () => {
    await toTargetStep();
    fireEvent.click(screen.getByRole('button', { name: /^IMAP/ }));
    expect(blockedReason()).toContain(archiveInTargetRefusal('imap')!);
  });

  it('a Nextcloud destination is not refused for it', async () => {
    await toTargetStep();
    fireEvent.click(screen.getByRole('button', { name: /^Nextcloud/ }));
    expect(blockedReason() ?? '').not.toContain('have no files');
    expect(blockedReason() ?? '').not.toContain('JMAP');
  });
});
