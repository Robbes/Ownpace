// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TEST ORGANISATION, MARKED FROM ITS SUPPORT PAGE (workplan 0162 T1, §3;
 * ADR-0053).
 *
 * The API decides who may mark an organisation and whether it holds a
 * migration (`a-test-organisation-and-its-marker.unit.test.ts` in apps/api).
 * What a person using this screen could get wrong is what this asserts:
 *
 *  1. **What it is now**: a test organisation, with its marker, or not one.
 *  2. **The marker is offered, not assumed**: the field starts at
 *     `[Ownpace-test]`, any other can be typed, and what is sent is what was
 *     typed, trimmed.
 *  3. **Nothing happens by accident**: marking and unmarking each arm first,
 *     and say what they will do, naming the organisation and the marker.
 *  4. **A refusal is the API's own sentence**, shown as it says it: while the
 *     organisation holds a migration, nothing is marked or unmarked.
 *  5. **A test migration carries a *Test* badge** on the organisation's list
 *     of migrations.
 *  6. **Only while it is open**: an organisation that is not is offered no
 *     marking at all, and the field never carries over from one organisation
 *     to the next, nor sets a length of its own: the API is the judge.
 *
 * English only, as every operator screen (ADR-0013, amended 2026-10-11).
 */

import type React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupportTenantDetail } from './Support.tsx';
import {
  getSupportTenant,
  getSupportPlatform,
  setSupportTestMarker,
  clearSupportTestMarker,
  type SupportTenant,
  type SupportMigration,
} from '../services/support.ts';
import { OPERATOR_STRINGS } from '../i18n/operator-strings.ts';

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
  setSupportTestMarker: vi.fn(),
  clearSupportTestMarker: vi.fn(),
}));

const S = OPERATOR_STRINGS;
const fill = (text: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), text);

const ORG: SupportTenant = {
  tenant_id: '0162d100-0000-0000-0000-000000000001',
  tenant_name: 'Proefjes BV',
  tenant_status: 'active',
  joined_at: '2026-11-01T09:00:00.000Z',
  migration_count: '0',
  failing_domain_count: '0',
  pending_decision_count: '0',
  connection_count: '0',
  member_count: '1',
  last_pass_at: null,
  closed_at: null,
  purge_after: null,
  test_marker: null,
};
const MARKED: SupportTenant = { ...ORG, test_marker: '[Ownpace-test]' };

const MIGRATION: SupportMigration = {
  mapping_id: '0162d100-0000-0000-0000-000000000011',
  name: 'Mail and files',
  lifecycle: 'active',
  mode: 'mirror',
  pattern: null,
  schedule: null,
  created_at: '2026-11-02T09:00:00.000Z',
  updated_at: '2026-11-02T09:00:00.000Z',
  test_marker: '[Ownpace-test]',
};

const HOLDS =
  'It holds 1 migration: an organisation becomes a test only while it holds none, so that every migration in a test organisation carries its marker. Delete them first.';

/** An axios-shaped refusal, the way the real apiClient delivers one. */
const refusal = (status: number, data: unknown): AxiosError => {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = { status, statusText: 'Conflict', headers: {}, config: { headers: new AxiosHeaders() }, data };
  return err;
};

const mountDetail = (tenant: SupportTenant, migrations: SupportMigration[] = []) => {
  vi.mocked(getSupportTenant).mockResolvedValue({ tenant, connections: [], migrations, invoices: [], members: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/support/tenants/${tenant.tenant_id}`]}>
        <Routes>
          <Route path="/support/tenants/:tenantId" element={<SupportTenantDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const section = () => screen.findByRole('region', { name: S['support.test.title'] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSupportPlatform).mockResolvedValue({
    ready: { status: 'ok', database: 'up', signIn: 'up' },
    statusPage: { state: 'off' },
  });
});

describe('what it is now', () => {
  it('an ordinary organisation says so, and offers [Ownpace-test] in the field', async () => {
    mountDetail(ORG);
    const here = within(await section());
    expect(here.getByText(S['support.test.isNot'])).toBeInTheDocument();
    expect(here.getByRole('textbox', { name: new RegExp(S['support.test.marker']) })).toHaveValue('[Ownpace-test]');
    expect(here.getByRole('button', { name: S['support.test.arm'] })).toBeEnabled();
    expect(here.queryByRole('button', { name: S['support.test.unarm'] })).not.toBeInTheDocument();
  });

  it('a test organisation says so, with its marker, and offers to stop being one', async () => {
    mountDetail(MARKED);
    const here = within(await section());
    expect(here.getByText(S['support.test.is'])).toBeInTheDocument();
    expect(here.getByText('[Ownpace-test]', { selector: 'code' })).toBeInTheDocument();
    // The same marker again changes nothing, so it is not offered.
    expect(here.getByRole('button', { name: S['support.test.change'] })).toBeDisabled();
    expect(here.getByRole('button', { name: S['support.test.unarm'] })).toBeEnabled();
  });
});

describe('marking it', () => {
  it('arms, names the organisation and the marker, and sends what was typed, trimmed', async () => {
    vi.mocked(setSupportTestMarker).mockResolvedValue({ testMarker: '[Mine-test]' });
    mountDetail(ORG);
    const here = within(await section());
    fireEvent.change(here.getByRole('textbox'), { target: { value: '  [Mine-test] ' } });
    fireEvent.click(here.getByRole('button', { name: S['support.test.arm'] }));
    expect(setSupportTestMarker).not.toHaveBeenCalled();
    expect(here.getByText(fill(S['support.test.confirm'], { name: 'Proefjes BV', marker: '[Mine-test]' }))).toBeInTheDocument();
    fireEvent.click(here.getByRole('button', { name: S['support.test.yes'] }));
    expect(await here.findByRole('status')).toHaveTextContent(fill(S['support.test.done'], { marker: '[Mine-test]' }));
    expect(setSupportTestMarker).toHaveBeenCalledWith(ORG.tenant_id, '[Mine-test]');
    // The page reads the organisation again.
    expect(vi.mocked(getSupportTenant).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a test organisation’s marker can be changed while it holds nothing: another marker, sent as typed', async () => {
    vi.mocked(setSupportTestMarker).mockResolvedValue({ testMarker: '[Other-test]' });
    mountDetail(MARKED);
    const here = within(await section());
    expect(here.getByRole('textbox')).toHaveValue('[Ownpace-test]');
    fireEvent.change(here.getByRole('textbox'), { target: { value: '[Other-test]' } });
    fireEvent.click(here.getByRole('button', { name: S['support.test.change'] }));
    expect(here.getByText(fill(S['support.test.confirm'], { name: 'Proefjes BV', marker: '[Other-test]' }))).toBeInTheDocument();
    fireEvent.click(here.getByRole('button', { name: S['support.test.yes'] }));
    expect(await here.findByRole('status')).toHaveTextContent(fill(S['support.test.done'], { marker: '[Other-test]' }));
    expect(setSupportTestMarker).toHaveBeenCalledWith(MARKED.tenant_id, '[Other-test]');
  });

  it('a cancelled arm sends nothing', async () => {
    mountDetail(ORG);
    const here = within(await section());
    fireEvent.click(here.getByRole('button', { name: S['support.test.arm'] }));
    fireEvent.click(here.getByRole('button', { name: 'Cancel' }));
    expect(here.getByRole('button', { name: S['support.test.arm'] })).toBeInTheDocument();
    expect(setSupportTestMarker).not.toHaveBeenCalled();
  });

  it('while it holds a migration: refused, in the API’s own sentence', async () => {
    vi.mocked(setSupportTestMarker).mockRejectedValue(
      refusal(409, { error: 'holds_a_migration', held: 1, message: HOLDS }),
    );
    mountDetail({ ...ORG, migration_count: '1' });
    const here = within(await section());
    fireEvent.click(here.getByRole('button', { name: S['support.test.arm'] }));
    fireEvent.click(here.getByRole('button', { name: S['support.test.yes'] }));
    expect(await here.findByRole('alert')).toHaveTextContent(fill(S['support.test.failed'], { message: HOLDS }));
    expect(here.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('the same marker again', () => {
  it('says that nothing changed, in the API’s answer', async () => {
    vi.mocked(setSupportTestMarker).mockResolvedValue({ testMarker: '[Ownpace-test]', unchanged: true });
    mountDetail(ORG);
    const here = within(await section());
    fireEvent.click(here.getByRole('button', { name: S['support.test.arm'] }));
    fireEvent.click(here.getByRole('button', { name: S['support.test.yes'] }));
    expect(await here.findByRole('status')).toHaveTextContent(
      fill(S['support.test.unchanged'], { marker: '[Ownpace-test]' }),
    );
  });
});

describe('only while it is open, and only for the organisation on the page', () => {
  it.each(['closed', 'deleting'])('%s: says what it is, and offers no marking at all', async (status) => {
    mountDetail({ ...MARKED, tenant_status: status });
    const here = within(await section());
    expect(here.getByText(S['support.test.notOpen'])).toBeInTheDocument();
    expect(here.getByText('[Ownpace-test]', { selector: 'code' })).toBeInTheDocument();
    expect(here.queryByRole('textbox')).not.toBeInTheDocument();
    expect(here.queryByRole('button')).not.toBeInTheDocument();
  });

  it('sets no length of its own on the field: the API counts the marker, trimmed', async () => {
    mountDetail(ORG);
    expect(within(await section()).getByRole('textbox')).not.toHaveAttribute('maxlength');
  });

  it('offers each organisation its own marker, never what was typed on another’s page', async () => {
    // The page is kept mounted from one organisation to the next. An
    // organisation read for the first time is loaded afresh, but one already
    // read comes back from the cache at once, into the same page: that is
    // where a section that kept its state would offer the last one's marker.
    const OTHER: SupportTenant = { ...ORG, tenant_id: '0162d100-0000-0000-0000-000000000002', tenant_name: 'Ander BV' };
    vi.mocked(getSupportTenant).mockImplementation(async (id: string) => ({
      tenant: id === OTHER.tenant_id ? OTHER : ORG,
      connections: [],
      migrations: [],
      invoices: [],
      members: [],
    }));
    const Go: React.FC = () => {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate(`/support/tenants/${OTHER.tenant_id}`)}>
            to Ander
          </button>
          <button type="button" onClick={() => navigate(`/support/tenants/${ORG.tenant_id}`)}>
            to Proefjes
          </button>
        </>
      );
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/support/tenants/${ORG.tenant_id}`]}>
          <Go />
          <Routes>
            <Route path="/support/tenants/:tenantId" element={<SupportTenantDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', { name: /Proefjes BV/ });
    fireEvent.click(screen.getByRole('button', { name: 'to Ander' }));
    await screen.findByRole('heading', { name: /Ander BV/ });
    const there = within(await section());
    fireEvent.change(there.getByRole('textbox'), { target: { value: '[Typed-for-Ander]' } });
    fireEvent.click(there.getByRole('button', { name: S['support.test.arm'] }));
    expect(there.getByText(fill(S['support.test.confirm'], { name: 'Ander BV', marker: '[Typed-for-Ander]' }))).toBeInTheDocument();

    // Back to the first, which comes from the cache into the same page.
    fireEvent.click(screen.getByRole('button', { name: 'to Proefjes' }));
    await screen.findByRole('heading', { name: /Proefjes BV/ });
    const back = within(await section());
    expect(back.getByRole('textbox')).toHaveValue('[Ownpace-test]');
    expect(back.getByRole('button', { name: S['support.test.arm'] })).toBeEnabled();
    expect(back.queryByText(/\[Typed-for-Ander\]/)).toBeNull();
  });
});

describe('unmarking it', () => {
  it('arms, says what it means, and clears it', async () => {
    vi.mocked(clearSupportTestMarker).mockResolvedValue(undefined);
    mountDetail(MARKED);
    const here = within(await section());
    fireEvent.click(here.getByRole('button', { name: S['support.test.unarm'] }));
    expect(clearSupportTestMarker).not.toHaveBeenCalled();
    expect(here.getByText(fill(S['support.test.unconfirm'], { name: 'Proefjes BV' }))).toBeInTheDocument();
    fireEvent.click(here.getByRole('button', { name: S['support.test.unyes'] }));
    expect(await here.findByRole('status')).toHaveTextContent(S['support.test.undone']);
    expect(clearSupportTestMarker).toHaveBeenCalledWith(MARKED.tenant_id);
  });

  it('while it holds a migration: refused, in the API’s own sentence', async () => {
    const said =
      'It holds 1 migration: an organisation stops being a test only while it holds none, and each test migration keeps its marker until it is deleted. Delete them first.';
    vi.mocked(clearSupportTestMarker).mockRejectedValue(refusal(409, { error: 'holds_a_migration', held: 1, message: said }));
    mountDetail({ ...MARKED, migration_count: '1' }, [MIGRATION]);
    const here = within(await section());
    fireEvent.click(here.getByRole('button', { name: S['support.test.unarm'] }));
    fireEvent.click(here.getByRole('button', { name: S['support.test.unyes'] }));
    expect(await here.findByRole('alert')).toHaveTextContent(fill(S['support.test.unfailed'], { message: said }));
  });
});

describe('the organisation’s list of migrations', () => {
  it('shows a Test badge beside a test migration, with its marker as the badge’s title, and none beside another', async () => {
    mountDetail(MARKED, [MIGRATION, { ...MIGRATION, mapping_id: '0162d100-0000-0000-0000-000000000012', name: 'Older', test_marker: null }]);
    const link = await screen.findByRole('link', { name: 'Mail and files' });
    const badge = link.parentElement!.querySelector('[data-test-badge]');
    expect(badge).toHaveTextContent(S['support.test.badge']);
    expect(badge).toHaveAttribute('title', '[Ownpace-test]');
    expect(screen.getByRole('link', { name: 'Older' }).parentElement!.querySelector('[data-test-badge]')).toBeNull();
  });
});

describe('the migration’s own support page', () => {
  it('says it is a test migration, with its own marker; and nothing for one that is not', async () => {
    const { getSupportMigration } = await import('../services/support.ts');
    const { SupportMigrationDetail } = await import('./Support.tsx');
    const mountMigration = (migration: SupportMigration) => {
      vi.mocked(getSupportMigration).mockResolvedValue({ migration: { ...migration, tenant_id: ORG.tenant_id }, domains: [] });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[`/support/migrations/${migration.mapping_id}`]}>
            <Routes>
              <Route path="/support/migrations/:mappingId" element={<SupportMigrationDetail />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    };
    const { unmount } = mountMigration(MIGRATION);
    const line = await screen.findByText(S['support.test.migration']);
    expect(line.querySelector('code')).toHaveTextContent(/^\[Ownpace-test\]$/);
    unmount();
    mountMigration({ ...MIGRATION, test_marker: null });
    await screen.findByRole('heading', { name: 'Mail and files' });
    expect(document.querySelector('[data-test-migration]')).toBeNull();
  });
});
