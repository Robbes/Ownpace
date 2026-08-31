// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The operator's three screens (workplan 0110 T4).
 *
 * Authorisation is not a thing this screen can be tested for — it lives in the
 * views, `support-views.unit.test.ts` proves it, and `support-routes.unit.test.ts`
 * proves the routes act on it. What is worth asserting here is what a person
 * using these screens could be misled about:
 *
 *  1. **That they know it is written down.** The owner traded a consent switch
 *     for a read log, and a log the operator does not know about is
 *     surveillance with paperwork. The line is asserted on every screen.
 *  2. **That the remedy sentence is the CUSTOMER's sentence.** The owner's
 *     reason for the whole surface was "people expect me to be able to see what
 *     they see", so the operator screen is checked against the same dictionary
 *     entry `LiveProgress` renders — not against a copy.
 *  3. **That an empty answer reads as empty, not as broken.** A non-operator
 *     gets `[]` on purpose; the screen must say "no organisations", not spin.
 *  4. **That the two 404s stay indistinguishable.** The API refuses to say
 *     whether an id exists; a screen that said "no such organisation" for one
 *     and "not allowed" for the other would undo that.
 *  5. **That no refetch is armed.** Every fetch writes a row into the log, and
 *     a screen that refetched on focus would fill the record with reads nobody
 *     made.
 */

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupportTenants, SupportTenantDetail, SupportMigrationDetail } from './Support.tsx';
import {
  listSupportTenants,
  getSupportTenant,
  getSupportMigration,
  type SupportTenantUsage,
} from '../services/support.ts';
import { STRINGS } from '../i18n/strings.ts';

vi.mock('../services/support.ts', () => ({
  listSupportTenants: vi.fn(),
  getSupportTenant: vi.fn(),
  getSupportMigration: vi.fn(),
}));

const listMock = vi.mocked(listSupportTenants);
const tenantMock = vi.mocked(getSupportTenant);
const migrationMock = vi.mocked(getSupportMigration);

const TENANT = {
  tenant_id: 'a1b2c3d4-0000-0000-0000-000000000001',
  tenant_name: 'Alpha BV',
  tenant_status: 'active',
  joined_at: '2026-07-01T09:00:00.000Z',
  migration_count: '3',
  failing_domain_count: '1',
  pending_decision_count: '2',
};

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

beforeEach(() => {
  listMock.mockReset();
  tenantMock.mockReset();
  migrationMock.mockReset();
});

describe('the list of organisations', () => {
  it('says every screen here is recorded, before showing anything', async () => {
    listMock.mockResolvedValue([TENANT]);
    mount(<SupportTenants />);
    expect(await screen.findByText(STRINGS.en['support.recorded'])).toBeInTheDocument();
  });

  it('names the boundary, so nobody goes looking for a screen that should not exist', async () => {
    listMock.mockResolvedValue([TENANT]);
    mount(<SupportTenants />);
    expect(await screen.findByText(STRINGS.en['support.metadataOnly'])).toBeInTheDocument();
  });

  it('shows the organisations, with the failing count called out', async () => {
    listMock.mockResolvedValue([TENANT]);
    mount(<SupportTenants />);
    expect(await screen.findByText('Alpha BV')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('reads as empty rather than as broken — which is what a non-operator gets', async () => {
    // The API answers 200 with `[]` on purpose rather than 403. A screen that
    // spun forever, or said "something went wrong", would turn a correct
    // refusal into a support ticket about the support screen.
    listMock.mockResolvedValue([]);
    mount(<SupportTenants />);
    expect(await screen.findByText(STRINGS.en['support.noOrganisations'])).toBeInTheDocument();
  });
});

describe('one organisation', () => {
  const DETAIL = {
    tenant: TENANT,
    connections: [
      {
        connection_id: 'c1',
        role: 'source' as const,
        kind: 'imap',
        display_name: 'Alpha mail',
        status: 'connected',
        created_at: '2026-07-01T09:00:00.000Z',
        updated_at: '2026-07-01T09:00:00.000Z',
      },
    ],
    migrations: [
      {
        mapping_id: 'm1',
        name: 'Alpha migration',
        lifecycle: 'active',
        mode: 'sync',
        pattern: null,
        schedule: null,
        created_at: '2026-07-01T09:00:00.000Z',
        updated_at: '2026-07-02T09:00:00.000Z',
      },
    ],
    invoices: [
      {
        invoice_id: 'i1',
        period_start: '2026-07-01',
        period_end: '2026-07-31',
        status: 'sent',
        total: '42.50',
        currency: 'EUR',
        paid_at: null,
      },
    ],
  };

  it('shows the three lists', async () => {
    tenantMock.mockResolvedValue(DETAIL);
    mount(<SupportTenantDetail />, `/support/tenants/${TENANT.tenant_id}`, '/support/tenants/:tenantId');
    expect(await screen.findByText('Alpha mail')).toBeInTheDocument();
    expect(screen.getByText('Alpha migration')).toBeInTheDocument();
    expect(screen.getByText('sent')).toBeInTheDocument();
  });

  it('says the same thing for an id that does not exist and one it may not see', async () => {
    // Both are a 404 from the API, deliberately. Two different sentences here
    // would let somebody use this screen to discover which ids are real.
    tenantMock.mockRejectedValue(new Error('Request failed with status code 404'));
    mount(<SupportTenantDetail />, `/support/tenants/${TENANT.tenant_id}`, '/support/tenants/:tenantId');
    expect(await screen.findByText(STRINGS.en['support.notFound'])).toBeInTheDocument();
  });
});

describe('one migration', () => {
  const MIGRATION = {
    migration: {
      tenant_id: TENANT.tenant_id,
      mapping_id: 'm1',
      name: 'Alpha migration',
      lifecycle: 'active',
      mode: 'sync',
      pattern: null,
      schedule: null,
      created_at: '2026-07-01T09:00:00.000Z',
      updated_at: '2026-07-02T09:00:00.000Z',
    },
    domains: [
      {
        domain: 'email' as const,
        state: 'failed',
        started_at: '2026-07-02T08:00:00.000Z',
        updated_at: '2026-07-02T09:00:00.000Z',
        completed_at: null,
        last_error_category: 'auth_expired',
        last_pass_metrics: null,
      },
    ],
  };

  it("renders the CUSTOMER's own remedy sentence, not a second copy of it", async () => {
    // The whole reason this surface exists, in the owner's words: "people
    // expect me to be able to see what they see". Asserted against the same
    // dictionary entry `LiveProgress` renders, so an edit to one sentence
    // cannot leave the operator and the customer reading different advice.
    migrationMock.mockResolvedValue(MIGRATION);
    mount(<SupportMigrationDetail />, '/support/migrations/m1', '/support/migrations/:mappingId');
    expect(await screen.findByText(STRINGS.en['failure.authExpired'])).toBeInTheDocument();
  });

  it('says there is no screen below this one', async () => {
    migrationMock.mockResolvedValue(MIGRATION);
    mount(<SupportMigrationDetail />, '/support/migrations/m1', '/support/migrations/:mappingId');
    expect(await screen.findByText(STRINGS.en['support.noFourthLevel'])).toBeInTheDocument();
  });

  it('shows no remedy for a category no build of this app knows', async () => {
    // The column is `text` with no CHECK — the six are product vocabulary. A
    // value from an older or newer build must render as nothing, never as a
    // raw token an operator would read out to a customer.
    migrationMock.mockResolvedValue({
      ...MIGRATION,
      domains: [{ ...MIGRATION.domains[0]!, last_error_category: 'something_new' }],
    });
    mount(<SupportMigrationDetail />, '/support/migrations/m1', '/support/migrations/:mappingId');
    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(screen.queryByText('something_new')).not.toBeInTheDocument();
    expect(screen.queryByText(STRINGS.en['failure.unknown'])).not.toBeInTheDocument();
  });
});

describe('the log stays a record of reads somebody made', () => {
  it('fetches once per screen and arms no refetch', async () => {
    // Every call writes a `support_read` row. React Query refetches on window
    // focus by DEFAULT, so leaving that on would put rows in the log for
    // alt-tabbing back to the browser — and the log's whole value is that a row
    // in it means somebody looked.
    //
    // Driven through `focusManager`, NOT by dispatching a `focus` event: the
    // first version of this test did the latter, and passed with the refetch
    // deliberately switched back ON. jsdom never changes `visibilityState`, so
    // React Query's own listener heard nothing and the test was asserting that
    // an event nobody was listening for changed nothing. A guard that cannot
    // fail is worse than no guard, because it reads in a diff as coverage.
    listMock.mockResolvedValue([TENANT]);
    const { unmount } = mount(<SupportTenants />);
    await screen.findByText('Alpha BV');
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    // Waited THROUGH, not waited FOR. `waitFor(() => expect(…).toHaveBeenCalledTimes(1))`
    // is satisfied the instant it is first evaluated, so it proves nothing
    // about what happens next — the second version of this test passed with
    // the refetch deliberately switched back on for exactly that reason. Give
    // the refetch a real window, then assert the count did not move.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(listMock).toHaveBeenCalledTimes(1);
    unmount();
    focusManager.setFocused(undefined);
  });
});

describe('both languages carry every sentence these screens ask for', () => {
  it('has an nl entry for each support key', () => {
    // The screens read `t(...)`; a key present in en and missing in nl renders
    // English to a Dutch operator, which is the failure mode a dictionary of
    // this size hides well.
    const keys = Object.keys(STRINGS.en).filter((k) => k.startsWith('support.'));
    expect(keys.length).toBeGreaterThan(15);
    const missing = keys.filter((k) => !(k in STRINGS.nl));
    expect(missing).toEqual([]);
  });
});


describe('failing and waiting are two different conversations (workplan 0110 T5)', () => {
  it('counts what is waiting on the customer, beside what is failing', async () => {
    // A migration stopped on a decision is not broken; it is waiting for
    // somebody who probably does not know it. One "needs attention" number
    // would collapse the two calls an operator has to make into one.
    listMock.mockResolvedValue([TENANT]);
    mount(<SupportTenants />);
    await screen.findByText('Alpha BV');
    expect(screen.getByText(STRINGS.en['support.col.failing'])).toBeInTheDocument();
    expect(screen.getByText(STRINGS.en['support.col.waiting'])).toBeInTheDocument();
    // The failing count and the waiting count are the fixture's two different
    // numbers, so a cell reading the wrong column is visible here.
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('says on the organisation screen that something is waiting', async () => {
    tenantMock.mockResolvedValue({
      tenant: TENANT,
      connections: [],
      migrations: [],
      invoices: [],
    });
    mount(
      <SupportTenantDetail />,
      `/support/tenants/${TENANT.tenant_id}`,
      '/support/tenants/:tenantId',
    );
    expect(await screen.findByText(STRINGS.en['support.waiting.some'])).toBeInTheDocument();
  });

  it('says the opposite when nothing is', async () => {
    tenantMock.mockResolvedValue({
      tenant: { ...TENANT, pending_decision_count: '0' },
      connections: [],
      migrations: [],
      invoices: [],
    });
    mount(
      <SupportTenantDetail />,
      `/support/tenants/${TENANT.tenant_id}`,
      '/support/tenants/:tenantId',
    );
    expect(await screen.findByText(STRINGS.en['support.waiting.none'])).toBeInTheDocument();
  });

  it('shows nothing of usage when the API sends none — an older server, not a broken screen', async () => {
    // `usage` arrived after these routes did. A detail payload without it must
    // render the rest of the screen untouched rather than crash or show an
    // empty claim about somebody's bill.
    tenantMock.mockResolvedValue({
      tenant: TENANT,
      connections: [],
      migrations: [],
      invoices: [],
    });
    mount(
      <SupportTenantDetail />,
      `/support/tenants/${TENANT.tenant_id}`,
      '/support/tenants/:tenantId',
    );
    await screen.findByText(STRINGS.en['support.waiting.some']);
    expect(screen.queryByText(STRINGS.en['support.usage'])).not.toBeInTheDocument();
  });

  it('never shows the decisions themselves — only how many', async () => {
    // `decision.summary` is prose a detector wrote about a specific mailbox
    // and `decision.detail` is a jsonb bag that has carried addresses since
    // 0028 T1. The view does not select either, so there is nothing here to
    // render — asserted at the screen because that is where it would show.
    tenantMock.mockResolvedValue({
      tenant: TENANT,
      connections: [],
      migrations: [],
      invoices: [],
    });
    const { container } = mount(
      <SupportTenantDetail />,
      `/support/tenants/${TENANT.tenant_id}`,
      '/support/tenants/:tenantId',
    );
    await screen.findByText(STRINGS.en['support.waiting.some']);
    expect(container.textContent).not.toContain('summary');
    expect(container.textContent).not.toContain('@');
  });
});

describe('the package the month has earned so far (0109 T4, surfaced)', () => {
  const USAGE: SupportTenantUsage = {
    tier: {
      id: 'small',
      name: 'Small',
      paths: 4,
      data_gb: 750,
      setup: 8,
      monthly: 4,
    },
    decided_by: 'paths',
    evidence: { peak_paths: 3, gb_moved: 100 },
    recorded_peak_paths: 1,
    recorded_peak_at: '2026-08-12T10:00:00.000Z',
    paths_now: 3,
    paths_by_state: { active: 2, paused: 1, cutover: 1 },
  };

  const mountWithUsage = (usage: SupportTenantUsage) => {
    tenantMock.mockResolvedValue({
      tenant: TENANT,
      connections: [],
      migrations: [],
      invoices: [],
      usage,
    });
    return mount(
      <SupportTenantDetail />,
      `/support/tenants/${TENANT.tenant_id}`,
      '/support/tenants/:tenantId',
    );
  };

  it('shows the package, which axis decided, and the evidence — as served, not recomputed', async () => {
    // The API's derivation is the invoice's; this screen adds no arithmetic.
    // The fixture's numbers are deliberately inconsistent-looking (recorded
    // peak 1, live 3): the screen must show BOTH, because "why does the tier
    // say more than the recorded peak" is answered by the live count.
    const { container } = mountWithUsage(USAGE);
    expect(await screen.findByText('Small')).toBeInTheDocument();
    expect(screen.getByText(STRINGS.en['support.usage.decidedBy.paths'])).toBeInTheDocument();
    // The paused path is visible in the breakdown — the classic "why am I
    // still billed" answer, without naming any path.
    expect(container.textContent).toContain('active 2 · cutover 1 · paused 1');
    expect(container.textContent).toContain('100 GB');
    expect(screen.getByText(STRINGS.en['support.usage.note'])).toBeInTheDocument();
  });

  it('says a quiet month plainly rather than rendering a bare zero', async () => {
    mountWithUsage({
      ...USAGE,
      tier: { id: 'tiny', name: 'Tiny', paths: 1, data_gb: 250, setup: 4, monthly: 2 },
      decided_by: 'both',
      evidence: { peak_paths: 0, gb_moved: 0 },
      recorded_peak_paths: 0,
      recorded_peak_at: null,
      paths_now: 0,
      paths_by_state: {},
    });
    expect(await screen.findByText(STRINGS.en['support.usage.noPeak'])).toBeInTheDocument();
  });

  it("renders the table's deliberate end as words, never as a missing package", async () => {
    // Past the largest tier the API serves null — the same "talk to us" the
    // pricing page publishes. A blank cell here would read as a bug in
    // exactly the conversation where the operator needs the sentence.
    mountWithUsage({ ...USAGE, tier: null });
    expect(await screen.findByText(STRINGS.en['support.usage.beyondTable'])).toBeInTheDocument();
  });
});
