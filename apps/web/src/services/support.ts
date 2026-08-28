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

export interface SupportTenantDetail {
  readonly tenant: SupportTenant;
  readonly connections: SupportConnection[];
  readonly migrations: SupportMigration[];
  readonly invoices: SupportInvoice[];
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

/** Level 3. There is deliberately no level 4 — see the route's own comment. */
export async function getSupportMigration(mappingId: string): Promise<SupportMigrationDetail> {
  const response = await apiClient.get<SupportMigrationDetail>(
    `/support/migrations/${mappingId}`,
  );
  return response.data;
}
