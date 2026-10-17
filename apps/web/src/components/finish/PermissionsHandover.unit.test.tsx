// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The permission handover on Finish (workplan 0029 T4).
 *
 * The two things worth pinning: that the one class of right nobody can read
 * is said ON THE SCREEN and not only inside the downloaded document — a
 * person who never opens the file should still learn it — and that a refusal
 * renders the server's own words, because "this migration does not record
 * which mailbox it reads" is actionable and "the request failed" is not.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { fetchPermissionReport } = vi.hoisted(() => ({ fetchPermissionReport: vi.fn() }));
vi.mock('../../services/operating-service', () => ({ fetchPermissionReport }));
// The migration's name is read from the query cache the screen already holds;
// a read past it would be a request no test should make.
vi.mock('../../services/mapping-service', () => ({
  mappingApi: { get: vi.fn(() => Promise.reject(new Error('not in this test'))) },
}));

import PermissionsHandover from './PermissionsHandover.tsx';
import { LocaleProvider } from '../../i18n/index.tsx';
import { STRINGS } from '../../i18n/strings.ts';

beforeEach(() => {
  vi.clearAllMocks();
  fetchPermissionReport.mockResolvedValue('# Who can see what');
  // jsdom has no object URLs; the component only needs them not to throw.
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:x'),
    revokeObjectURL: vi.fn(),
  });
});

describe('what it says before anybody clicks', () => {
  it('tells the owner to do this BEFORE delivery moves', () => {
    render(<PermissionsHandover mappingId="m1" />);

    // Rights carried across afterwards were missing for however long that
    // took — the whole reason this sits above the numbered steps.
    expect(screen.getByText(/before you move delivery/i)).toBeInTheDocument();
    expect(screen.getByText(/rights added afterwards were missing/i)).toBeInTheDocument();
  });

  it('names the blind spot on screen, not only inside the document', () => {
    render(<PermissionsHandover mappingId="m1" sourceKind="o365" />);

    // Somebody who never opens the file should still learn that full access
    // and send-as on a mailbox cannot be read at all (Exchange's FullAccess and
    // Send-As, in a tester's words since 2026-10-14).
    expect(screen.getByText(/who could open or send from someone else's mailbox/)).toBeInTheDocument();
    expect(screen.getByText(/does not give us that to migrate/)).toBeInTheDocument();
  });

  it('does not promise file sharing this installation may not have read', () => {
    render(<PermissionsHandover mappingId="m1" sourceKind="o365" />);

    // `Files.Read.All` is not consented by default (owner decision
    // 2026-08-04), so drive sharing is a stated blind spot in most
    // deployments. The panel used to read as though the list always covered
    // it — a promise the document then quietly did not keep.
    expect(screen.getByText(/sharing on OneDrive and SharePoint\./)).toBeInTheDocument();
    expect(screen.getByText(/read only if Ownpace was given an extra permission/)).toBeInTheDocument();
    // And what to do where it was not, as the managed report's own sentence
    // says it (`DRIVE_SHARING_NOT_INVENTORIED_FOR_A_TESTER`).
    expect(screen.getByText(/note your file and folder sharing by hand before you switch over/)).toBeInTheDocument();
    // And it points at the document for the per-run answer, because that is
    // where the truth for THIS report lives.
    expect(screen.getByText(/which of the two it actually read/)).toBeInTheDocument();
  });
});

describe("the blind spots are the migration's own source's (the owner, 2026-10-03)", () => {
  // The Microsoft line was shown on every Finish page, a Google migration's
  // included, beside a list that had read the organisation's other sources.

  it('a Google migration is told its own two blind spots, not Exchange and OneDrive', () => {
    render(<PermissionsHandover mappingId="m1" sourceKind="google" />);

    expect(screen.getByText(/Gmail delegation and send-as/)).toBeInTheDocument();
    expect(screen.getByText(/Sharing on Google Drive is read/)).toBeInTheDocument();
    expect(screen.queryByText(/someone else's mailbox/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OneDrive and SharePoint/)).not.toBeInTheDocument();
  });

  it("reads either vocabulary: the managed edition's kind and the appliance's type", () => {
    const { unmount } = render(<PermissionsHandover mappingId="m1" sourceKind="o365" />);
    expect(screen.getByText(/who could open or send from someone else's mailbox/)).toBeInTheDocument();
    unmount();

    render(<PermissionsHandover mappingId="m1" sourceKind="google-drive" />);
    expect(screen.getByText(/Gmail delegation and send-as/)).toBeInTheDocument();
  });

  it('a source with no line of its own gets none, rather than another provider’s', () => {
    render(<PermissionsHandover mappingId="m1" sourceKind="dropbox" />);

    expect(screen.queryByText(/blind spots/)).not.toBeInTheDocument();
    // The panel itself and its button stay: the document still names what
    // it could not read, at the top.
    expect(screen.getByRole('button', { name: /permission list/i })).toBeInTheDocument();
  });

  it('says nothing about blind spots while the source is not yet known', () => {
    render(<PermissionsHandover mappingId="m1" />);

    expect(screen.queryByText(/blind spots/)).not.toBeInTheDocument();
  });
});

describe('a Microsoft account connected with its own sign-in (the owner, 2026-10-16)', () => {
  // An Outlook.com tester read about someone else's mailbox and every file in
  // their organisation. The `microsoft` kind is one person's own sign-in, and
  // its line says what Ownpace did not read of THAT account.
  it('is told its own three blind spots, with no organisation in them', () => {
    render(<PermissionsHandover mappingId="m1" sourceKind="microsoft" />);

    expect(screen.getByText(/who else could open or send from this mailbox, calendar sharing, and OneDrive sharing/)).toBeInTheDocument();
    expect(screen.queryByText(/someone else's mailbox/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SharePoint|organisation|Exchange|PowerShell/)).not.toBeInTheDocument();
  });

  it('in Dutch too', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    try {
      render(
        <LocaleProvider>
          <PermissionsHandover mappingId="m1" sourceKind="microsoft" />
        </LocaleProvider>,
      );
      expect(screen.getByText(/Drie blinde vlekken/)).toBeInTheDocument();
      expect(screen.queryByText(/SharePoint|organisatie|Exchange/)).not.toBeInTheDocument();
    } finally {
      window.localStorage.removeItem('ownpace.locale');
    }
  });
});

describe('fetching the list', () => {
  it('asks for the report by mapping, not by a retyped address', async () => {
    render(<PermissionsHandover mappingId="m-42" />);

    await userEvent.click(screen.getByRole('button', { name: /permission list/i }));

    await waitFor(() => expect(fetchPermissionReport).toHaveBeenCalledWith('m-42', 'en'));
  });

  // The document comes in the reader's language (workplan 0144): the screen's
  // own locale is what the report is asked in, so a Dutch tester's list is Dutch.
  it('asks for the report in the language the screen is in', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    try {
      render(
        <LocaleProvider>
          <PermissionsHandover mappingId="m-42" />
        </LocaleProvider>,
      );

      await userEvent.click(screen.getByRole('button', { name: /rechtenlijst/i }));

      await waitFor(() => expect(fetchPermissionReport).toHaveBeenCalledWith('m-42', 'nl'));
    } finally {
      window.localStorage.removeItem('ownpace.locale');
    }
  });

  it("renders the server's own refusal, which is the actionable one", async () => {
    fetchPermissionReport.mockRejectedValue({
      response: {
        data: {
          message:
            'This migration does not record which mailbox it reads, so its permissions could not be read. Please contact us.',
        },
      },
    });
    render(<PermissionsHandover mappingId="m1" />);

    await userEvent.click(screen.getByRole('button', { name: /permission list/i }));

    expect(
      await screen.findByText(/does not record which mailbox it reads/),
    ).toBeInTheDocument();
  });

  it("renders the server's Dutch to a Dutch reader, where it sent one (the owner, 2026-10-16)", async () => {
    fetchPermissionReport.mockRejectedValue({
      response: { data: { message: 'In English.', messageNl: 'In het Nederlands.' } },
    });
    window.localStorage.setItem('ownpace.locale', 'nl');
    try {
      render(
        <LocaleProvider>
          <PermissionsHandover mappingId="m1" />
        </LocaleProvider>,
      );
      await userEvent.click(screen.getByRole('button'));
      expect(await screen.findByText('In het Nederlands.')).toBeInTheDocument();
    } finally {
      window.localStorage.removeItem('ownpace.locale');
    }
  });

  it('falls back to its own words when the server said nothing useful', async () => {
    fetchPermissionReport.mockRejectedValue(new Error('Network Error'));
    render(<PermissionsHandover mappingId="m1" />);

    await userEvent.click(screen.getByRole('button', { name: /permission list/i }));

    // Never silent: a button that does nothing reads as "there is nothing".
    expect(await screen.findByText(/could not be fetched/)).toBeInTheDocument();
  });
});

describe('a migration without mail is not told about delivery (the UX sweep)', () => {
  // A files-only migration (Box to Nextcloud) has no delivery to move, and
  // Finish rightly leaves step 4 out; this panel still said "before you move
  // delivery" and "do not move with the mail".
  it('says to carry the permissions across before the switch', () => {
    render(<PermissionsHandover mappingId="m1" sourceKind="dropbox" carriesMail={false} />);

    expect(screen.getByText(STRINGS.en['permissions.heading.noMail'])).toBeInTheDocument();
    expect(screen.getByText(STRINGS.en['permissions.body.noMail'])).toBeInTheDocument();
    expect(screen.getByText(STRINGS.en['permissions.body.noMail.more'])).toBeInTheDocument();
    expect(screen.queryByText(/delivery|mail/i)).not.toBeInTheDocument();
  });

  it('in Dutch too', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    try {
      render(
        <LocaleProvider>
          <PermissionsHandover mappingId="m1" sourceKind="dropbox" carriesMail={false} />
        </LocaleProvider>,
      );
      expect(screen.getByText('Zet de rechten over voordat u overstapt')).toBeInTheDocument();
      expect(screen.getByText(STRINGS.nl['permissions.body.noMail'])).toBeInTheDocument();
      expect(screen.queryByText(/bezorging|e-mail/i)).not.toBeInTheDocument();
    } finally {
      window.localStorage.removeItem('ownpace.locale');
    }
  });

  it('keeps the delivery words where the migration carries mail, as it does unless told otherwise', () => {
    render(<PermissionsHandover mappingId="m1" />);
    expect(screen.getByText(STRINGS.en['permissions.heading'])).toBeInTheDocument();
    expect(screen.queryByText(STRINGS.en['permissions.heading.noMail'])).not.toBeInTheDocument();
  });
});

describe('the list is saved under a name a person can read (the UX sweep)', () => {
  // It was `permissions-<uuid>.md`, in English, whatever the screen's language.
  let names: string[];
  beforeEach(() => {
    names = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const withName = (name: string) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['mapping', 'm-42'], { id: 'm-42', name });
    return client;
  };

  it('names the migration and the day, in the screen’s language', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    try {
      render(
        <LocaleProvider>
          <QueryClientProvider client={withName('Pieter: Box/Nextcloud')}>
            <PermissionsHandover mappingId="m-42" />
          </QueryClientProvider>
        </LocaleProvider>,
      );
      await userEvent.click(screen.getByRole('button', { name: /rechtenlijst/i }));
      await waitFor(() => expect(names).toHaveLength(1));
      expect(names[0]).toMatch(/^Ownpace-rechtenlijst - Pieter BoxNextcloud - \d{4}-\d{2}-\d{2}\.md$/);
    } finally {
      window.localStorage.removeItem('ownpace.locale');
    }
  });

  it('keeps the old name where no name is known', async () => {
    render(<PermissionsHandover mappingId="m-42" />);
    await userEvent.click(screen.getByRole('button', { name: /permission list/i }));
    await waitFor(() => expect(names).toEqual(['permissions-m-42.md']));
  });
});
