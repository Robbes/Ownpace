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
 * So the archive form asks WHERE the export is, from the one descriptor. The
 * Accounts page draws it; the wizard did too, until it retired (0153 D5), and
 * *Start a migration* sets a Takeout up in the destination's files itself
 * (`StartMigration.unit.test.tsx`):
 *
 *  - a folder of the destination's files, or this appliance's disk;
 *  - on managed the destination is the default, and the disk is SHOWN,
 *    disabled, with *Only on a self-hosted appliance* (D10: nothing is hidden;
 *    the owner: *"'Only on a self-hosted appliance': ok"*);
 *  - on the appliance the disk stays the default, so no existing mapping
 *    changes meaning;
 *  - the path's label follows the choice, and the form posts `where`.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

async function openConnectionsForm() {
  render(
    <QueryClientProvider client={client()}>
      <MemoryRouter>
        <Connections />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByText('Add an account'));
}

const pickArchive = () => fireEvent.click(screen.getByRole('button', { name: /^Export archive/ }));
const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${escape(name)}`) }) as HTMLInputElement;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe.each([['the Connections page', openConnectionsForm]])('%s asks where the export is', (_door, open) => {
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
    fireEvent.change(screen.getByLabelText(/^Name for this account/), { target: { value: 'my photos' } });
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
});
