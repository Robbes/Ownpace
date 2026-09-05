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

import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupportTenants, SupportTenantDetail, SupportMigrationDetail } from './Support.tsx';
import {
  listSupportTenants,
  getSupportTenant,
  getSupportMigration,
  searchSupportPeople,
  recordPersonOpened,
  getSupportPlatform,
  type SupportTenantUsage,
  type SupportTenantMember,
  type PlatformStatus,
} from '../services/support.ts';
import { STRINGS } from '../i18n/strings.ts';

vi.mock('../services/support.ts', () => ({
  listSupportTenants: vi.fn(),
  getSupportTenant: vi.fn(),
  getSupportMigration: vi.fn(),
  searchSupportPeople: vi.fn(),
  recordPersonOpened: vi.fn(),
  getSupportPlatform: vi.fn(),
}));

/**
 * The console link is steered at the module, not through the environment.
 * `import.meta.env` is not shared between modules under vitest — the lesson
 * `oidc.ts` records — so setting the variable here would set it on this file
 * and `idp-console.ts` would go on reading its own. What belongs here is the
 * WIRING (does a row become a link when there is one to make); the helper's own
 * refusals are `idp-console.unit.test.ts`.
 *
 * BUT IT DELEGATES TO THE REAL FUNCTION rather than reimplementing it. This
 * mock used to be `consoleUrl.value.replace('{sub}', sub)` — a second, simpler
 * copy of the rule, which therefore had none of the refusals. When
 * `idpConsoleUserUrl` learned to refuse a `pending:` subject, this file went on
 * rendering links for them and could not have caught it going wrong. The real
 * function takes its environment as an ARGUMENT for exactly this reason, so
 * pass one: the template stays controllable and every rule stays real.
 */
const consoleUrl = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('../services/idp-console.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/idp-console.ts')>();
  return {
    ...actual,
    idpConsoleUserUrl: (sub: string) =>
      actual.idpConsoleUserUrl(sub, {
        ...(consoleUrl.value === null ? {} : { VITE_IDP_CONSOLE_USER_URL: consoleUrl.value }),
      }),
  };
});

const listMock = vi.mocked(listSupportTenants);
const tenantMock = vi.mocked(getSupportTenant);
const migrationMock = vi.mocked(getSupportMigration);
const platformMock = vi.mocked(getSupportPlatform);

/** A healthy platform, which is what every tenant-screen case not about it gets. */
const PLATFORM_OK: PlatformStatus = {
  ready: { status: 'ok', database: 'up', signIn: 'up' },
  statusPage: { state: 'off' },
};

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
  platformMock.mockReset().mockResolvedValue(PLATFORM_OK);
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
    members: [],
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
        failed_side: 'source',
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
    expect(await screen.findByText(new RegExp(STRINGS.en['failure.authExpired'].slice(0, 40)))).toBeInTheDocument();
    // And the side the pass named (0094 T5) — the same words the customer reads.
    expect(screen.getByText(new RegExp(STRINGS.en['failure.side.source']))).toBeInTheDocument();
  });

  it('says nothing about the side when the view predates it, or the pass could not tell', async () => {
    migrationMock.mockResolvedValue({
      ...MIGRATION,
      domains: [{ ...MIGRATION.domains[0]!, failed_side: null }],
    });
    mount(<SupportMigrationDetail />, '/support/migrations/m1', '/support/migrations/:mappingId');
    expect(await screen.findByText(new RegExp(STRINGS.en['failure.authExpired'].slice(0, 40)))).toBeInTheDocument();
    expect(screen.queryByText(/side\./)).not.toBeInTheDocument();
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
      members: [],
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
      members: [],
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
      members: [],
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
      members: [],
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
      members: [],
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

/**
 * WHO IS IN THIS ORGANISATION, and the way through to their account.
 *
 * The first support view carrying people (migration 0018, owner request
 * 2026-08-31). The operator asked for it and named the use: the account-level
 * work — a password nobody can reset, a second factor lost with a phone — is
 * the identity provider's and never Ownpace's (ADR-0042), and without a name to
 * click, "go and look in the console" means searching a list by memory.
 */
describe('the people on an organisation', () => {
  const MEMBERS = [
    {
      user_id: '388706935093854213',
      email: 'owner@acme.test',
      role: 'owner',
      status: 'active',
      invited_at: null,
      joined_at: '2026-08-01T09:00:00.000Z',
    },
    {
      user_id: 'sub-two',
      email: 'gone@acme.test',
      role: 'admin',
      status: 'removed',
      invited_at: null,
      joined_at: '2026-08-02T09:00:00.000Z',
    },
  ];

  // The SERVED type, not `typeof MEMBERS`. Inferring it from one literal made
  // that fixture's nullability the contract — `invited_at` null and
  // `joined_at` a string — so an invitation, which is the other way round, did
  // not typecheck as a member of the table it is displayed in.
  const withMembers = async (members: ReadonlyArray<SupportTenantMember>) => {
    tenantMock.mockResolvedValue({
      tenant: TENANT,
      connections: [],
      migrations: [],
      invoices: [],
      members,
    });
    mount(
      <SupportTenantDetail />,
      `/support/tenants/${TENANT.tenant_id}`,
      '/support/tenants/:tenantId',
    );
    await screen.findByText(TENANT.tenant_name);
  };

  beforeEach(() => {
    consoleUrl.value = null;
  });

  it('lists them, and keeps somebody who was removed', async () => {
    // "This person used to be the owner" is most of what a support
    // conversation about a lost account is about. Dropping the row would make
    // the screen answer a question it was not asked.
    consoleUrl.value = 'https://id.test/ui/console/users/{sub}';
    await withMembers(MEMBERS);

    expect(screen.getByText('owner@acme.test')).toBeInTheDocument();
    expect(screen.getByText('gone@acme.test')).toBeInTheDocument();
    expect(screen.getByText('removed')).toBeInTheDocument();
  });

  it('links each person to their account at the provider', async () => {
    consoleUrl.value = 'https://id.test/ui/console/users/{sub}';
    await withMembers(MEMBERS);

    const link = screen.getByRole('link', { name: 'owner@acme.test' });
    expect(link).toHaveAttribute('href', 'https://id.test/ui/console/users/388706935093854213');
    // It leaves the product for an administrative console, which has no
    // business being handed a window handle or the address it came from.
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('shows the address as plain text when the deployment has no console to point at', async () => {
    // The appliance has no issuer at all (hard rule 5), and a stack
    // mid-upgrade has not been given the variable. Neither may render a dead
    // anchor: a link that goes nowhere is worse than no link, because somebody
    // clicks it.
    await withMembers(MEMBERS);

    expect(screen.getByText('owner@acme.test')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'owner@acme.test' })).not.toBeInTheDocument();
  });

  it('will not link somebody who has not signed in, and says why', async () => {
    // FOUND IN LIVE USE, 2026-08-31. Granting writes `pending:<uuid>` because
    // the person has no subject until they arrive, and the screen linked it —
    // sending an operator to a console page about a user that does not exist,
    // which Zitadel answers with its whole user list and an error. It reads
    // like a broken product rather than like somebody who has not arrived.
    consoleUrl.value = 'https://id.example.test/ui/console/users/{sub}';
    await withMembers([
      {
        user_id: 'pending:038fc2a8-c534-4265-a78b-64342df08efe',
        email: 'invited@acme.test',
        role: 'owner',
        status: 'invited',
        invited_at: '2026-08-31T09:00:00.000Z',
        joined_at: null,
      },
    ]);

    expect(screen.queryByRole('link', { name: 'invited@acme.test' })).not.toBeInTheDocument();
    // And the reason, because a missing link is otherwise indistinguishable
    // from a deployment that never configured one — a setting, not a person.
    expect(screen.getByText('invited@acme.test')).toHaveAttribute(
      'title',
      STRINGS.en['support.notArrivedYet'],
    );
  });

  it('will not link a seeded demo fixture, and says a different why', async () => {
    // FOUND IN LIVE USE, 2026-09-01, one row below the `pending:` one above and
    // by the same person: the owner clicked `owner-a@demo.openmigrate.test` on
    // this screen and landed on the identity provider's whole user list. The
    // demo seed writes its owners straight into `tenant_member`, so no provider
    // has ever had them and none ever will.
    //
    // A DIFFERENT SENTENCE, not the same one. "Has not signed in yet" is true
    // of an invitation and false of a fixture, and reading it here would send
    // somebody waiting for an account that was never going to arrive.
    consoleUrl.value = 'https://id.example.test/ui/console/users/{sub}';
    await withMembers([
      {
        user_id: 'seed:demo-owner-a',
        email: 'owner-a@demo.openmigrate.test',
        role: 'owner',
        status: 'active',
        invited_at: null,
        joined_at: '2026-09-01T09:00:00.000Z',
      },
    ]);

    expect(
      screen.queryByRole('link', { name: 'owner-a@demo.openmigrate.test' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('owner-a@demo.openmigrate.test')).toHaveAttribute(
      'title',
      STRINGS.en['support.seededDemoAccount'],
    );
  });

  it('still links the person once they have arrived', async () => {
    // The control. A refusal that also caught real accounts would remove the
    // feature rather than fix it — and `388706935093854213` is the shape a
    // provider subject actually has.
    consoleUrl.value = 'https://id.example.test/ui/console/users/{sub}';
    await withMembers(MEMBERS);
    expect(screen.getByRole('link', { name: 'owner@acme.test' })).toHaveAttribute(
      'href',
      'https://id.example.test/ui/console/users/388706935093854213',
    );
  });

  it('says so when nobody belongs to it', async () => {
    await withMembers([]);
    expect(screen.getByText(STRINGS.en['support.noPeople'])).toBeInTheDocument();
  });
});

/**
 * FINDING A PERSON, which is the question the surface did not answer.
 *
 * The organisation list answers "show me the customers"; a support day starts
 * with somebody making contact. Reported the day the per-organisation list
 * shipped: "I was expecting ... a search for people or list with them" — and on
 * a deployment with no organisations yet, the People section it was nested
 * inside could not be reached at all.
 */
describe('finding a person', () => {
  const searchMock = vi.mocked(searchSupportPeople);
  const openedMock = vi.mocked(recordPersonOpened);

  const PERSON = {
    tenant_id: 'a1b2c3d4-0000-0000-0000-000000000001',
    tenant_name: 'Alpha BV',
    user_id: '388706935093854213',
    email: 'jan@alpha.test',
    role: 'owner',
    status: 'active',
    joined_at: '2026-08-01T09:00:00.000Z',
  };

  beforeEach(() => {
    searchMock.mockReset();
    openedMock.mockReset();
    consoleUrl.value = 'https://id.test/ui/console/users/{sub}';
    listMock.mockResolvedValue([]);
  });

  /** Type a term and submit, the way somebody actually uses the box. */
  async function search(term: string) {
    mount(<SupportTenants />);
    const box = await screen.findByLabelText(STRINGS.en['support.findPerson']);
    await act(async () => {
      fireEvent.change(box, { target: { value: term } });
      fireEvent.submit(box.closest('form') as HTMLFormElement);
    });
  }

  it('searches across organisations and says which one each person is in', async () => {
    // The organisation is half the answer — "and what are they on" is the next
    // question every time — so a result that named only the person would send
    // the operator back to guessing.
    searchMock.mockResolvedValue({ people: [PERSON], limit: 50 });
    await search('jan');

    expect(searchMock).toHaveBeenCalledWith('jan');
    expect(await screen.findByText('jan@alpha.test')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alpha BV' })).toHaveAttribute(
      'href',
      '/support/tenants/a1b2c3d4-0000-0000-0000-000000000001',
    );
  });

  it('records that an account was opened at the provider', async () => {
    // The owner asked for both halves logged: the search, and the opening of a
    // result. The click leaves Ownpace, so this is the last thing that can
    // honestly be recorded about it.
    searchMock.mockResolvedValue({ people: [PERSON], limit: 50 });
    await search('jan');

    fireEvent.click(await screen.findByRole('link', { name: 'jan@alpha.test' }));
    expect(openedMock).toHaveBeenCalledWith(PERSON.tenant_id, PERSON.user_id);
  });

  it('will not search on one character', async () => {
    // A one-character search matches everybody, and "the operator pressed
    // enter" is not a reason to read every customer's people. The server
    // refuses too; this is the half that says so before the press.
    mount(<SupportTenants />);
    const box = await screen.findByLabelText(STRINGS.en['support.findPerson']);
    fireEvent.change(box, { target: { value: 'j' } });
    expect(screen.getByRole('button', { name: STRINGS.en['support.find'] })).toBeDisabled();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('says the search is recorded, before it is used', async () => {
    // The widest read on this surface. A record nobody is told about is
    // surveillance with paperwork — 0110's words, and the reason the line sits
    // beside the box rather than in a policy.
    mount(<SupportTenants />);
    expect(
      await screen.findByText(STRINGS.en['support.findPersonRecorded']),
    ).toBeInTheDocument();
  });

  it('says so when nobody matches', async () => {
    searchMock.mockResolvedValue({ people: [], limit: 50 });
    await search('nobody');
    expect(await screen.findByText(STRINGS.en['support.noPeopleFound'])).toBeInTheDocument();
  });
});

describe('the platform status the customer sees (workplan 0110 T5)', () => {
  const DETAIL_FOR_PLATFORM = {
    tenant: TENANT,
    connections: [],
    migrations: [],
    invoices: [],
    usage: null,
    members: [],
  };
  const show = () => {
    tenantMock.mockResolvedValue(DETAIL_FOR_PLATFORM as never);
    mount(<SupportTenantDetail />, `/support/tenants/${TENANT.tenant_id}`, '/support/tenants/:tenantId');
  };

  it('reads readiness and the page, grouped as the page groups them, with a down endpoint called out', async () => {
    platformMock.mockResolvedValue({
      ready: { status: 'degraded', database: 'up', signIn: 'down' },
      statusPage: {
        state: 'up',
        endpoints: [
          { group: 'Sources', name: 'Google Workspace', state: 'down', checkedAt: '2026-09-05T13:05:00Z' },
          { group: 'Ownpace', name: 'Identity provider', state: 'up', checkedAt: '2026-09-05T13:05:00Z' },
          { group: 'Ownpace', name: 'Website', state: 'unchecked', checkedAt: null },
        ],
      },
    });
    show();

    expect(await screen.findByText(STRINGS.en['support.platform'])).toBeInTheDocument();
    // The data arrives after the heading: wait for the first line of it.
    expect(await screen.findByText('Google Workspace down')).toBeInTheDocument();
    expect(screen.getByText('Google Workspace down').className).toContain('text-red-700');
    expect(screen.getByText('Identity provider up')).toBeInTheDocument();
    expect(screen.getByText('Website not checked yet')).toBeInTheDocument();
    expect(screen.getByText('Sources:')).toBeInTheDocument();
    expect(screen.getByText('Ownpace:')).toBeInTheDocument();
    // Readiness, component by component — never the roll-up alone.
    expect(screen.getByText('Sign-in').nextElementSibling?.textContent).toBe('down');
    expect(screen.getByText(/^Checked /)).toBeInTheDocument();
  });

  it('says a deployment without a page has none, rather than showing an empty list', async () => {
    show();
    expect(await screen.findByText(STRINGS.en['support.platform.page.off'])).toBeInTheDocument();
    expect(screen.queryByText(/^Checked /)).toBeNull();
  });

  it('says when the page did not answer — on a stack that has one, that is news', async () => {
    platformMock.mockResolvedValue({ ...PLATFORM_OK, statusPage: { state: 'unreachable' } });
    show();
    expect(
      await screen.findByText(STRINGS.en['support.platform.page.unreachable']),
    ).toBeInTheDocument();
  });

  it('does not take the tenant screen down with it when it cannot be read', async () => {
    platformMock.mockRejectedValue(new Error('boom'));
    show();
    expect(await screen.findByText(STRINGS.en['support.platform.unread'])).toBeInTheDocument();
    // The tenant's own facts are still there.
    expect(screen.getByText('Alpha BV')).toBeInTheDocument();
  });
});
