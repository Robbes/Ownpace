// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The operator's support surface, from the browser (workplan 0110 T4).
 *
 * Every call here is authorised by the VIEWS behind it, not by this file and
 * not by the screens that use it. A non-operator calling `listTenants()` gets
 * `[]`, and asking for an organisation gets a 404 — because to the database
 * those rows are invisible, and "not found" is the honest answer about a row
 * you cannot see. So there is nothing to check client-side that would mean
 * anything; `Me.operator` decides whether to SHOW the screens, never whether
 * they work.
 *
 * The same doctrine `access-requests.ts` states, and for the same reason: a
 * client-side check that is then trusted is the copy that rots.
 *
 * ## Every one of these calls is recorded
 *
 * The server writes a `support_read` row in the same transaction it serves the
 * answer. That is not a detail of the API — it is what stands in place of the
 * consent switch the owner decided against on 2026-08-27. A screen that
 * re-fetched on every keystroke would fill that record with noise, so the
 * queries below are deliberately plain: one fetch per screen, no polling, no
 * background refetch.
 */

import apiClient from './api.ts';

/** One organisation, as an operator sees it. Metadata only, by construction. */
export interface SupportTenant {
  readonly tenant_id: string;
  readonly tenant_name: string;
  readonly tenant_status: string;
  readonly joined_at: string;
  readonly migration_count: number | string;
  readonly failing_domain_count: number | string;
  /**
   * Pending decisions across the whole organisation, INCLUDING the ones that
   * belong to no migration yet (workplan 0110 T5). Deliberately does not add
   * up with the per-migration counts — a newly discovered mailbox belongs to
   * no migration, and that difference is the interesting part.
   */
  readonly pending_decision_count: number | string;
}

export interface SupportConnection {
  readonly connection_id: string;
  readonly role: 'source' | 'target';
  readonly kind: string;
  readonly display_name: string | null;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SupportMigration {
  readonly tenant_id?: string;
  readonly mapping_id: string;
  readonly name: string | null;
  readonly lifecycle: string;
  readonly mode: string | null;
  readonly pattern: string | null;
  readonly schedule: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  /** THIS migration's pending decisions — a count, never the decisions. */
  readonly pending_decision_count?: number | string;
}

export interface SupportInvoice {
  readonly invoice_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly status: string;
  readonly total: string;
  readonly currency: string;
  readonly paid_at: string | null;
}

/**
 * One domain of one migration.
 *
 * `last_error_category` and NOT `last_error`: the view does not select the
 * prose, so there is nothing here to accidentally render. The category is the
 * actionable half (workplan 0110 T3) and it is the same one the customer is
 * shown on their own screen — which is the point of an operator being able to
 * see it.
 */
export interface SupportMigrationDomain {
  readonly domain: 'email' | 'calendar' | 'contact' | 'file';
  readonly state: string;
  readonly started_at: string | null;
  readonly updated_at: string;
  readonly completed_at: string | null;
  readonly last_error_category: string | null;
  readonly last_pass_metrics: unknown;
}

/**
 * The tier this month has earned so far, with the evidence an invoice would
 * quote (ADR-0014's two axes; 0109 T4 surfaced on this screen).
 *
 * Derived read-only on the server: the recorded peak and the live count of
 * slot-holding paths are folded together exactly as the tier calculator's
 * true-up would write them — so this and a bill drawn at the same moment
 * agree — but LOOKING at it moves no billing mark. `tier` is null past the
 * published table's end, the same deliberate "talk to us" the pricing page
 * has. Counts, one data total and two timestamps; nothing here names what is
 * moving.
 */
export interface SupportTenantUsage {
  readonly tier: {
    readonly id: 'tiny' | 'small' | 'medium' | 'large' | 'xl';
    readonly name: string;
    readonly paths: number;
    readonly data_gb: number;
    readonly setup: number;
    readonly monthly: number;
  } | null;
  /** Which axis forced the answer — the higher one wins. */
  readonly decided_by: 'paths' | 'data' | 'both';
  /** Exactly what an invoice would quote; `peak_paths` is the EFFECTIVE peak. */
  readonly evidence: { readonly peak_paths: number; readonly gb_moved: number };
  /** The month's recorded high-water mark; 0 when nothing raised it. */
  readonly recorded_peak_paths: number;
  readonly recorded_peak_at: string | null;
  /** Paths holding a slot right now — `active` and `paused`. */
  readonly paths_now: number;
  /** Every path row counted per lifecycle state, e.g. `{"active": 2}`. */
  readonly paths_by_state: Readonly<Record<string, number>>;
}

/**
 * Who may act on an organisation (migration 0018).
 *
 * `user_id` is the identity provider's SUBJECT, not an Ownpace id — it is what
 * makes a link to the right account possible, and it is opaque to anybody who
 * cannot already sign in to that provider.
 */
export interface SupportTenantMember {
  readonly user_id: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly invited_at: string | null;
  readonly joined_at: string | null;
}

export interface SupportTenantDetail {
  readonly tenant: SupportTenant;
  readonly connections: SupportConnection[];
  readonly migrations: SupportMigration[];
  readonly invoices: SupportInvoice[];
  /** Absent only from an API older than this screen — render nothing then. */
  readonly members: ReadonlyArray<SupportTenantMember>;
  readonly usage?: SupportTenantUsage;
}

export interface SupportMigrationDetail {
  readonly migration: SupportMigration;
  readonly domains: SupportMigrationDomain[];
}

/** Level 1. Empty for anybody who is not a platform operator. */
export async function listSupportTenants(): Promise<SupportTenant[]> {
  const response = await apiClient.get<{ tenants: SupportTenant[] }>('/support/tenants');
  return response.data.tenants;
}

/** Level 2. A 404 for an id that does not exist AND for one you may not see. */
export async function getSupportTenant(tenantId: string): Promise<SupportTenantDetail> {
  const response = await apiClient.get<SupportTenantDetail>(`/support/tenants/${tenantId}`);
  return response.data;
}

/**
 * An invoice that outlived the customer it billed.
 *
 * `tenant_ref` is a sha256 of the tenant id and never the id: `erasure_record`
 * holds a hash precisely so it cannot be read back into a list of former
 * customers, and this screen inherits that. `billed_to_name` is the only thing
 * here that says who an invoice was for, captured when the purge ran rather
 * than read from a tenant that no longer exists.
 */
export interface SupportRetainedInvoice {
  readonly tenant_ref: string;
  readonly erasure_requested_at: string;
  readonly purged_at: string | null;
  readonly invoice_id: string;
  readonly billed_to_name: string | null;
  readonly period_start: string;
  readonly period_end: string;
  readonly status: string;
  readonly total: string;
  readonly currency: string;
  readonly paid_at: string | null;
}

/**
 * The invoices an erasure kept. Not a level — a different grain.
 *
 * Every other call here hangs off a tenant. This one cannot: the tenants it
 * concerns are deleted, so it is keyed on the erasure instead.
 */
export async function listRetainedInvoices(): Promise<SupportRetainedInvoice[]> {
  const response = await apiClient.get<{ invoices: SupportRetainedInvoice[] }>(
    '/support/retained-invoices',
  );
  return response.data.invoices;
}

/** Level 3. There is deliberately no level 4 — see the route's own comment. */
export async function getSupportMigration(mappingId: string): Promise<SupportMigrationDetail> {
  const response = await apiClient.get<SupportMigrationDetail>(
    `/support/migrations/${mappingId}`,
  );
  return response.data;
}
