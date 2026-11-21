// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ORGANISATION THE OPERATOR CAN CLOSE, from the support screens (workplan
 * 0139 T7 (b)).
 *
 * The API decides who may close and what a close does
 * (`an-organisation-the-operator-can-close.unit.test.ts` in apps/api). What a
 * person using these screens could get wrong is what this file asserts:
 *
 *  1. **Which organisations nobody uses.** The list says it beside the name,
 *     from the counts it already has, and a filter shows only those; a closed
 *     one says when it goes instead.
 *  2. **That nothing closes by accident.** Close arms first; it needs a window
 *     and the request it acts on; and a window of 0, which cannot be undone,
 *     needs the organisation's name typed as well.
 *  3. **That what was asked is what is sent**: the window and the reference,
 *     trimmed, and nothing else.
 *  4. **That the answer can be passed on**: both dates, and the sentences in
 *     English and in Dutch, the Dutch marked as Dutch.
 *  5. **That a reopen is offered only while it can happen**, and needs a reason.
 *  6. **That a close stays on its organisation's page** (0162 T1's re-review):
 *     the route keeps the page mounted from one organisation to the next, and
 *     the section is keyed by the organisation, so one's answer never shows
 *     on another's.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupportTenants, SupportTenantDetail } from './Support.tsx';
import {
  listSupportTenants,
  getSupportTenant,
  getSupportPlatform,
  closeSupportTenant,
  reopenSupportTenant,
  type SupportTenant,
  type SupportClosedAccount,
} from '../services/support.ts';
import { OPERATOR_STRINGS } from '../i18n/operator-strings.ts';
import { STRINGS } from '../i18n/strings.ts';
import { formatDateTime } from '../i18n/datetime.ts';

vi.mock('../services/support.ts', () => ({
  listSupportTenants: vi.fn(),
  getSupportTenant: vi.fn(),
  getSupportMigration: vi.fn(),
  searchSupportPeople: vi.fn(),
  recordPersonOpened: vi.fn(),
  getSupportPlatform: vi.fn(),
  listRetainedInvoices: vi.fn(),
  readSupportLog: vi.fn(),
  closeSupportTenant: vi.fn(),
  reopenSupportTenant: vi.fn(),
}));

const S = OPERATOR_STRINGS;
/** A shared word on an operator screen, which renders in English (`EnglishOnly`). */
const STRINGS_CANCEL = STRINGS.en['common.cancel'];
const fill = (text: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), text);

const IN_USE: SupportTenant = {
  tenant_id: 'c105e000-0000-0000-0000-000000000001',
  tenant_name: 'In Use BV',
  tenant_status: 'active',
  joined_at: '2026-10-01T09:00:00.000Z',
  migration_count: '2',
  failing_domain_count: '0',
  pending_decision_count: '0',
  connection_count: '3',
  member_count: '4',
  last_pass_at: '2026-11-17T09:00:00.000Z',
  closed_at: null,
  purge_after: null,
};

/** A granted request nobody claimed: the shape of the two test organisations on live. */
const NOBODY: SupportTenant = {
  ...IN_USE,
  tenant_id: 'c105e000-0000-0000-0000-000000000002',
  tenant_name: 'Nobody BV',
  migration_count: '0',
  connection_count: '0',
  member_count: '0',
  last_pass_at: null,
};

/** Somebody signed in, and never connected anything. */
const NOTHING: SupportTenant = {
  ...NOBODY,
  tenant_id: 'c105e000-0000-0000-0000-000000000003',
  tenant_name: 'Nothing BV',
  member_count: '1',
};

const FAR_AHEAD = '2099-01-01T00:00:00.000Z';
const CLOSED: SupportTenant = {
  ...NOBODY,
  tenant_id: 'c105e000-0000-0000-0000-000000000004',
  tenant_name: 'Closed BV',
  tenant_status: 'closed',
  closed_at: '2026-11-17T10:00:00.000Z',
  purge_after: FAR_AHEAD,
};

const ANSWER: SupportClosedAccount = {
  status: 'closed',
  purgeAfter: '2026-12-17T10:00:00.000Z',
  windowDays: 30,
  backupsExpireAt: '2026-12-24T10:00:00.000Z',
  erasureCompletesText: {
    en: 'The service stops holding your data on 2026-12-17.',
    nl: 'De dienst bewaart uw gegevens niet meer na 2026-12-17.',
  },
  canReopenUntil: '2026-12-17T10:00:00.000Z',
  passesStopped: 0,
  outlivingAccess: {
    en: [{ heading: 'Google', body: 'Remove the access you gave.', where: 'myaccount.google.com' }],
    nl: [{ heading: 'Google', body: 'Trek de toegang in die u gaf.', where: 'myaccount.google.com' }],
  },
};

const detail = (tenant: SupportTenant) => ({
  tenant,
  connections: [],
  migrations: [],
  invoices: [],
  members: [],
});

const mount = (ui: React.ReactNode, path = '/support', route = '/support') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const mountDetail = (tenant: SupportTenant) => {
  vi.mocked(getSupportTenant).mockResolvedValue(detail(tenant));
  return mount(<SupportTenantDetail />, `/support/tenants/${tenant.tenant_id}`, '/support/tenants/:tenantId');
};

const closeSection = async () =>
  screen.findByRole('region', { name: S['support.close.title'] });

beforeEach(() => {
  vi.mocked(listSupportTenants).mockReset();
  vi.mocked(getSupportTenant).mockReset();
  vi.mocked(closeSupportTenant).mockReset();
  vi.mocked(reopenSupportTenant).mockReset();
  vi.mocked(getSupportPlatform)
    .mockReset()
    .mockResolvedValue({ ready: { status: 'ok', database: 'up', signIn: 'up' }, statusPage: { state: 'off' } });
});

describe('the list says which organisations nobody uses', () => {
  it('names why beside the name, and nothing for one in use', async () => {
    vi.mocked(listSupportTenants).mockResolvedValue([IN_USE, NOBODY, NOTHING]);
    mount(<SupportTenants />);
    const nobodyRow = (await screen.findByRole('link', { name: 'Nobody BV' })).closest('tr')!;
    expect(nobodyRow).toHaveTextContent(`${S['support.unused.nobody']} · ${S['support.unused.nothing']}`);
    const nothingRow = screen.getByRole('link', { name: 'Nothing BV' }).closest('tr')!;
    expect(nothingRow).toHaveTextContent(S['support.unused.nothing']);
    expect(nothingRow).not.toHaveTextContent(S['support.unused.nobody']);
    const inUseRow = screen.getByRole('link', { name: 'In Use BV' }).closest('tr')!;
    expect(inUseRow).not.toHaveTextContent(S['support.unused.nobody']);
    expect(inUseRow).not.toHaveTextContent(S['support.unused.nothing']);
  });

  it('counts people, connections and the last pass, and says never for none', async () => {
    vi.mocked(listSupportTenants).mockResolvedValue([IN_USE, NOBODY]);
    mount(<SupportTenants />);
    const inUseRow = (await screen.findByRole('link', { name: 'In Use BV' })).closest('tr')!;
    const cells = within(inUseRow).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toContain('4');
    expect(cells).toContain('3');
    expect(cells).toContain(formatDateTime(IN_USE.last_pass_at!, 'en', { timeStyle: undefined }));
    const nobodyRow = screen.getByRole('link', { name: 'Nobody BV' }).closest('tr')!;
    expect(within(nobodyRow).getAllByRole('cell').map((c) => c.textContent)).toContain(S['support.never']);
  });

  it('says when a closed one is erased, and does not call it unused', async () => {
    vi.mocked(listSupportTenants).mockResolvedValue([CLOSED]);
    mount(<SupportTenants />);
    const row = (await screen.findByRole('link', { name: 'Closed BV' })).closest('tr')!;
    expect(row).toHaveTextContent(
      fill(S['support.status.erasedAfter'], { day: formatDateTime(FAR_AHEAD, 'en', { timeStyle: undefined }) }),
    );
    expect(row).not.toHaveTextContent(S['support.unused.nobody']);
  });

  it('filters to the ones not in use, and to the closed ones, from the one list read', async () => {
    vi.mocked(listSupportTenants).mockResolvedValue([IN_USE, NOBODY, NOTHING, CLOSED]);
    mount(<SupportTenants />);
    await screen.findByRole('link', { name: 'In Use BV' });
    const select = screen.getByLabelText(S['support.filter.label']);
    expect(within(select).getByRole('option', { name: fill(S['support.filter.unused'], { count: 2 }) })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: fill(S['support.filter.closed'], { count: 1 }) })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'unused' } });
    expect(screen.queryByRole('link', { name: 'In Use BV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Closed BV' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nobody BV' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nothing BV' })).toBeInTheDocument();
    expect(screen.getByText(S['support.filter.unused.why'])).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'closed' } });
    expect(screen.getByRole('link', { name: 'Closed BV' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nobody BV' })).not.toBeInTheDocument();
    // One read for every choice: the filter never asks the API again.
    expect(vi.mocked(listSupportTenants)).toHaveBeenCalledTimes(1);
  });
});

describe('closing an organisation from its page', () => {
  it('arms only with a window and the request, and sends exactly those', async () => {
    vi.mocked(closeSupportTenant).mockResolvedValue(ANSWER);
    mountDetail(NOBODY);
    const section = await closeSection();
    const arm = within(section).getByRole('button', { name: S['support.close.arm'] });
    expect(arm).toBeDisabled();

    fireEvent.click(within(section).getByLabelText(fill(S['support.close.window.n'], { days: 30 })));
    expect(arm).toBeDisabled();
    fireEvent.change(within(section).getByRole('textbox'), { target: { value: '  their mail of 17 November  ' } });
    expect(arm).toBeEnabled();

    fireEvent.click(arm);
    expect(within(section).getByText(fill(S['support.close.confirm'], { name: 'Nobody BV', days: 30 }))).toBeInTheDocument();
    expect(vi.mocked(closeSupportTenant)).not.toHaveBeenCalled();
    fireEvent.click(within(section).getByRole('button', { name: S['support.close.yes'] }));

    expect(await within(section).findByText(S['support.close.done'])).toBeInTheDocument();
    expect(vi.mocked(closeSupportTenant)).toHaveBeenCalledWith(NOBODY.tenant_id, {
      windowDays: 30,
      reference: 'their mail of 17 November',
    });
  });

  it('a window of 0 asks for the name as well, and cancel sends nothing', async () => {
    vi.mocked(closeSupportTenant).mockResolvedValue({ ...ANSWER, windowDays: 0, canReopenUntil: null });
    mountDetail(NOBODY);
    const section = await closeSection();
    fireEvent.click(within(section).getByLabelText(S['support.close.window.0']));
    fireEvent.change(within(section).getByRole('textbox'), { target: { value: 'test organisation' } });

    // Cancel first: nothing is sent.
    fireEvent.click(within(section).getByRole('button', { name: S['support.close.arm'] }));
    fireEvent.click(within(section).getByRole('button', { name: STRINGS_CANCEL }));
    expect(vi.mocked(closeSupportTenant)).not.toHaveBeenCalled();

    fireEvent.click(within(section).getByRole('button', { name: S['support.close.arm'] }));
    expect(within(section).getByText(fill(S['support.close.confirm.0'], { name: 'Nobody BV' }))).toBeInTheDocument();
    const yes = within(section).getByRole('button', { name: S['support.close.yes'] });
    expect(yes).toBeDisabled();
    const typeName = within(section).getByLabelText(S['support.close.typeName']);
    fireEvent.change(typeName, { target: { value: 'Nobody' } });
    expect(yes).toBeDisabled();
    fireEvent.change(typeName, { target: { value: 'Nobody BV' } });
    expect(yes).toBeEnabled();
    fireEvent.click(yes);

    expect(await within(section).findByText(S['support.close.done.final'])).toBeInTheDocument();
    expect(vi.mocked(closeSupportTenant)).toHaveBeenCalledWith(NOBODY.tenant_id, {
      windowDays: 0,
      reference: 'test organisation',
    });
  });

  it('shows what to tell them, in English and in Dutch, the Dutch marked as Dutch', async () => {
    vi.mocked(closeSupportTenant).mockResolvedValue(ANSWER);
    mountDetail(NOBODY);
    const section = await closeSection();
    fireEvent.click(within(section).getByLabelText(fill(S['support.close.window.n'], { days: 30 })));
    fireEvent.change(within(section).getByRole('textbox'), { target: { value: 'ticket 1' } });
    fireEvent.click(within(section).getByRole('button', { name: S['support.close.arm'] }));
    fireEvent.click(within(section).getByRole('button', { name: S['support.close.yes'] }));

    const status = await within(section).findByRole('status');
    expect(within(status).getByText(ANSWER.erasureCompletesText.en)).toBeInTheDocument();
    const dutch = within(status).getByText(ANSWER.erasureCompletesText.nl);
    expect(dutch.closest('[lang]')).toHaveAttribute('lang', 'nl');
    expect(status).toHaveTextContent('Trek de toegang in die u gaf.');
    expect(status).toHaveTextContent(S['support.close.idp']);
  });

  it('says why when the close is refused', async () => {
    vi.mocked(closeSupportTenant).mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 409, data: { message: 'It is closed already' } },
      }),
    );
    mountDetail(NOBODY);
    const section = await closeSection();
    fireEvent.click(within(section).getByLabelText(fill(S['support.close.window.n'], { days: 7 })));
    fireEvent.change(within(section).getByRole('textbox'), { target: { value: 'ticket 2' } });
    fireEvent.click(within(section).getByRole('button', { name: S['support.close.arm'] }));
    fireEvent.click(within(section).getByRole('button', { name: S['support.close.yes'] }));
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent(fill(S['support.close.failed'], { message: 'It is closed already' }));
  });

  it('a closed organisation offers the reopen, with a reason, while its window is open', async () => {
    vi.mocked(reopenSupportTenant).mockResolvedValue();
    mountDetail(CLOSED);
    const section = await closeSection();
    expect(within(section).queryByRole('button', { name: S['support.close.arm'] })).not.toBeInTheDocument();
    expect(
      within(section).getByText(
        fill(S['support.closed.on'], {
          closed: formatDateTime(CLOSED.closed_at!, 'en'),
          purge: formatDateTime(FAR_AHEAD, 'en'),
        }),
      ),
    ).toBeInTheDocument();
    const arm = within(section).getByRole('button', { name: S['support.reopen.arm'] });
    expect(arm).toBeDisabled();
    fireEvent.change(within(section).getByRole('textbox'), { target: { value: ' closed by mistake ' } });
    fireEvent.click(arm);
    fireEvent.click(within(section).getByRole('button', { name: S['support.reopen.yes'] }));
    await vi.waitFor(() =>
      expect(vi.mocked(reopenSupportTenant)).toHaveBeenCalledWith(CLOSED.tenant_id, 'closed by mistake'),
    );
  });

  it('a window that has run out offers no reopen', async () => {
    mountDetail({ ...CLOSED, purge_after: '2026-01-01T00:00:00.000Z' });
    const section = await closeSection();
    expect(within(section).getByText(S['support.closed.final'])).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: S['support.reopen.arm'] })).not.toBeInTheDocument();
  });

  it('an organisation being erased offers nothing to press', async () => {
    mountDetail({ ...CLOSED, tenant_status: 'deleting' });
    const section = await closeSection();
    expect(within(section).getByText(S['support.closed.erasing'])).toBeInTheDocument();
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('a close stays on its own organisation’s page', () => {
  it('never shows one organisation’s close on another’s page, back from the cache too', async () => {
    // The page is kept mounted from one organisation to the next. An
    // organisation read for the first time is loaded afresh, but one already
    // read comes back from the cache at once, into the same page: that is
    // where a section that kept its state would show the last one's answer.
    const closed = new Set<string>();
    vi.mocked(getSupportTenant).mockImplementation(async (id: string) =>
      detail(
        id !== NOTHING.tenant_id
          ? NOBODY
          : closed.has(id)
            ? { ...NOTHING, tenant_status: 'closed', closed_at: '2026-11-17T10:00:00.000Z', purge_after: ANSWER.purgeAfter }
            : NOTHING,
      ),
    );
    vi.mocked(closeSupportTenant).mockImplementation(async (id: string) => {
      closed.add(id);
      return ANSWER;
    });
    const Go: React.FC = () => {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate(`/support/tenants/${NOTHING.tenant_id}`)}>
            to Nothing
          </button>
          <button type="button" onClick={() => navigate(`/support/tenants/${NOBODY.tenant_id}`)}>
            to Nobody
          </button>
        </>
      );
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/support/tenants/${NOBODY.tenant_id}`]}>
          <Go />
          <Routes>
            <Route path="/support/tenants/:tenantId" element={<SupportTenantDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', { name: /Nobody BV/ });

    // Closed on the next organisation's page, its answer shown there.
    fireEvent.click(screen.getByRole('button', { name: 'to Nothing' }));
    await screen.findByRole('heading', { name: /Nothing BV/ });
    const there = within(await closeSection());
    fireEvent.click(there.getByLabelText(fill(S['support.close.window.n'], { days: 30 })));
    fireEvent.change(there.getByRole('textbox'), { target: { value: 'their mail of 17 November' } });
    fireEvent.click(there.getByRole('button', { name: S['support.close.arm'] }));
    fireEvent.click(there.getByRole('button', { name: S['support.close.yes'] }));
    expect(await there.findByText(S['support.close.done'])).toBeInTheDocument();
    expect(vi.mocked(closeSupportTenant)).toHaveBeenCalledWith(NOTHING.tenant_id, {
      windowDays: 30,
      reference: 'their mail of 17 November',
    });

    // Back to the first, which comes from the cache into the same page: open,
    // never closed, and nothing of the other's close on it.
    fireEvent.click(screen.getByRole('button', { name: 'to Nobody' }));
    await screen.findByRole('heading', { name: /Nobody BV/ });
    const back = within(await closeSection());
    expect(back.queryByText(S['support.close.done'])).toBeNull();
    expect(back.queryByRole('status')).toBeNull();
    expect(back.queryByText(ANSWER.erasureCompletesText.en)).toBeNull();
    expect(back.getByRole('button', { name: S['support.close.arm'] })).toBeDisabled();
    expect(back.getByRole('textbox')).toHaveValue('');
    expect(vi.mocked(closeSupportTenant)).toHaveBeenCalledTimes(1);
  });
});
