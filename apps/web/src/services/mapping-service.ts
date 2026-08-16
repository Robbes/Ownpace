// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
import apiClient from './api';
import { z } from 'zod';
import { MAPPING_LIFECYCLES } from '@openmig/shared';
import type { DiscoveryRecord, MappingLifecycle } from '@openmig/shared';

// Schema definitions
//
// These mirror what apps/api/src/routes/tenants actually sends, verified
// against the route code — they had drifted (a status enum without 'invited',
// the value every invite creates; a settings shape the server never sends) and
// the drift went unnoticed for as long as nothing called them. The Tenants
// screen is the caller now; a parse failure here is a contract break, not noise.
export const TenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  settings: z.record(z.string(), z.unknown()).nullish(),
  createdAt: z.string(),
});

/** The tenant's email-summary preference (workplan 0030 T4). */
export const TenantNotificationPrefsSchema = z.object({
  digest: z.enum(['daily', 'weekly', 'off']),
  locale: z.enum(['en', 'nl']),
});
export type TenantNotificationPrefs = z.infer<typeof TenantNotificationPrefsSchema>;

export const TenantNotificationsSchema = z.object({
  id: z.string(),
  notifications: TenantNotificationPrefsSchema,
});

/** PUT /tenants/:id answers with a different shape than GET (no createdAt). */
export const TenantUpdateSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

export const MemberRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export const MemberStatusSchema = z.enum(['active', 'invited', 'suspended', 'removed']);

export const MemberSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  email: z.string(),
  role: MemberRoleSchema,
  status: MemberStatusSchema,
  invitedAt: z.string().nullish(),
  joinedAt: z.string().nullish(),
});

/** PATCH /members/:id answers with the changed fields only, not the member. */
export const MemberRoleUpdateSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  role: MemberRoleSchema,
  updatedAt: z.string(),
});

// Mapping schemas — reconciled against the ROUTES' literal responses (0033 T1).
//
// The previous single MappingSchema described a payload no route ever sent: it
// required tenantId (the list sent tenant_id), the three config objects (the
// list and the create 201 send none), and a status enum
// (draft/completed/error) three-fifths of which the DB CHECK forbids
// (`mailbox_mapping_status_check`: active|paused|cutover|done). The parse
// threw on EVERY non-empty list — masked by the empty-table fallthrough T2
// fixes — and on every successful create. One schema per response shape now,
// each mirroring what its route actually returns; the fixtures in
// mapping-service.unit.test.ts are copies of the route mappers' output and are
// the drift alarm.

/** The four states the server can actually serve; the value comes from shared
 *  so this cannot drift from `mailbox_mapping_status_check` again. */
const MappingLifecycleSchema = z.enum(
  MAPPING_LIFECYCLES as [MappingLifecycle, ...MappingLifecycle[]],
);

const DomainEnum = z.enum(['email', 'calendar', 'contact', 'file']);

/** GET /migrations list items. No configs — the list route doesn't serve
 *  them; sourceType/targetType are CONNECTION KINDS (imap, o365, jmap, ...,
 *  or 'unknown' when the connection row is missing), not the wizard's
 *  imap/oauth2/graph vocabulary, so they stay strings for display. */
export const MappingListItemSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  sourceType: z.string(),
  targetType: z.string(),
  status: MappingLifecycleSchema,
  mode: z.string(),
  pattern: z.string().nullish(),
  domains: z.array(DomainEnum),
  lastSyncAt: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** GET /migrations/:id. Config fields are optional because the route spreads
 *  the connection's config JSON (empty object when the row is missing) and
 *  masks password as '***'; `domainStatus` is listed EXPLICITLY because
 *  z.object strips unknown keys — leaving it out would silently drop the
 *  live per-domain numbers the hub renders (see the discovery-schema comment
 *  below for the history of exactly that failure).
 *
 *  The rows are shared's `DomainStatusReport` — the SAME shape the
 *  appliance's /status serves (both editions call
 *  `buildDomainStatusReports`), so the LiveProgress strip renders either
 *  edition's payload without an adapter fork. */
export const MappingDomainStatusSchema = z.object({
  domain: DomainEnum,
  state: z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped']),
  itemsSynced: z.number(),
  itemsFailed: z.number(),
  bytesTransferred: z.number(),
  itemsRetrying: z.number(),
  itemsNeedingDecision: z.number(),
  lastSyncedAt: z.string().optional(),
  lastError: z.string().optional(),
  /** PassMetrics — counts and durations only, never names or addresses. */
  lastPass: z.record(z.string(), z.number()).optional(),
});

const MaskedConfigSchema = z.object({
  host: z.string().optional(),
  port: z.number().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  useSsl: z.boolean().optional(),
});

export const MappingSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  sourceType: z.string(),
  targetType: z.string(),
  sourceConfig: MaskedConfigSchema,
  targetConfig: MaskedConfigSchema,
  syncConfig: z.object({
    domains: z.array(DomainEnum),
    schedule: z.string().optional(),
  }),
  status: MappingLifecycleSchema,
  mode: z.string(),
  pattern: z.string().nullish(),
  domainStatus: z.array(MappingDomainStatusSchema),
  lastSyncAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** POST /migrations 201 body — no configs (secrets are stored encrypted and
 *  not echoed); sourceType/targetType here ARE the wizard's own vocabulary,
 *  echoed back from the request. Parsing the create response with the detail
 *  schema was what made every SUCCESSFUL create throw client-side, so the
 *  wizard's onSuccess never ran and a retry created a duplicate chain. */
export const CreateMappingResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  // ALL seven wizard vocabularies. This enum sat at the original three long
  // after google-drive and gmail joined, which made every SUCCESSFUL Google
  // create throw client-side — the exact wizard-never-navigates,
  // retry-creates-a-duplicate failure documented above the create schema.
  // The wizard's unit walks mock the service and cannot catch it.
  sourceType: z.enum([
    'imap',
    'oauth2',
    'graph',
    'google-drive',
    'gmail',
    'google-calendar',
    'google-contacts',
  ]),
  targetType: z.enum(['jmap', 'imap', 'caldav', 'carddav', 'webdav']),
  status: MappingLifecycleSchema,
  mode: z.string(),
  pattern: z.string().optional(),
  syncConfig: z.object({
    domains: z.array(DomainEnum),
    schedule: z.string().optional(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** What the wizard posts — mirrors the server's CreateMappingSchema. */
export interface CreateMappingInput {
  name: string;
  sourceType:
    | 'imap'
    | 'oauth2'
    | 'graph'
    | 'google-drive'
    | 'gmail'
    | 'google-calendar'
    | 'google-contacts';
  targetType: 'jmap' | 'imap' | 'caldav' | 'carddav' | 'webdav';
  sourceConfig: {
    /** host/port for an 'imap' source; tenantId/clientId/clientSecret for
     *  'oauth2'/'graph' (the per-customer Entra app registration, 0037 T6);
     *  clientId/clientSecret/refreshToken (+ optional rootFolderId) for
     *  'google-drive' (workplan 0042), the same three minus rootFolderId for
     *  'gmail' (workplan 0044). The server's CreateMappingSchema
     *  refuses the wrong set by name. */
    host?: string;
    port?: number;
    username: string;
    password?: string;
    useSsl?: boolean;
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    rootFolderId?: string;
  };
  targetConfig: {
    host: string;
    port: number;
    username: string;
    password: string;
    useSsl?: boolean;
  };
  syncConfig: {
    domains: Array<'email' | 'calendar' | 'contact' | 'file'>;
    schedule?: string;
  };
  /** Absent/empty = merge into the account root (the default). */
  targetFolderPrefix?: string;
}

// The run shapes live in @openmig/shared (`RunReport`/`RunsResponse`) and the
// reader in operating-service (`fetchRuns`) -- 0026 T3 row 23. The zod schema
// that sat here validated a response no screen requested, at a path
// (`/migrations/.../runs` with no edition split) only the managed edition
// could serve.

export type Tenant = z.infer<typeof TenantSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type Mapping = z.infer<typeof MappingSchema>;
export type MappingListItem = z.infer<typeof MappingListItemSchema>;

// Tenant API — only what the Tenants screen uses. `create` is gone because the
// server answers it with a deliberate 501 (tenant creation is a cross-tenant
// bootstrap operation, see the route's comment); `list` and `delete` had no
// screen and went with the rest of the dead surface (0026 T2).
export const tenantApi = {
  get: async (tenantId: string) => {
    const response = await apiClient.get(`/tenants/${tenantId}`);
    return TenantSchema.parse(response.data);
  },

  update: async (tenantId: string, data: { name?: string; settings?: Record<string, unknown> }) => {
    const response = await apiClient.put(`/tenants/${tenantId}`, data);
    return TenantUpdateSchema.parse(response.data);
  },

  /**
   * How often this organization is emailed a summary (workplan 0030 T4).
   *
   * The server answers with what it STORED, read back through the same reader
   * the digest task uses — so the screen shows the value that will actually be
   * acted on, never the one that was posted.
   */
  setNotifications: async (tenantId: string, prefs: TenantNotificationPrefs) => {
    const response = await apiClient.put(`/tenants/${tenantId}/notifications`, prefs);
    return TenantNotificationsSchema.parse(response.data).notifications;
  },
};

// Member API
export const memberApi = {
  list: async (tenantId: string) => {
    const response = await apiClient.get(`/tenants/${tenantId}/members`);
    return z.array(MemberSchema).parse(response.data.members);
  },

  invite: async (tenantId: string, data: { email: string; role: Member['role'] }) => {
    const response = await apiClient.post(`/tenants/${tenantId}/members`, data);
    return MemberSchema.parse(response.data);
  },

  updateRole: async (tenantId: string, memberId: string, role: Member['role']) => {
    const response = await apiClient.patch(`/tenants/${tenantId}/members/${memberId}`, { role });
    return MemberRoleUpdateSchema.parse(response.data);
  },

  remove: async (tenantId: string, memberId: string) => {
    await apiClient.delete(`/tenants/${tenantId}/members/${memberId}`);
  },
};

// Mapping API
// --- 0013 discovery / confirm ---
/**
 * Runtime validation for the discovery payload.
 *
 * The zod schemas stay — this is a trust boundary and checking what arrived is
 * worth doing — but the TYPE is `@openmig/shared`'s and is no longer inferred
 * from the schema. Inferring it made this file a second, independent
 * declaration of a contract the server already owns, and it drifted: the shared
 * type gained `targetExisting`/`targetColliding` (the "already on the
 * destination" counts) and `excluded`, this copy did not, and because
 * `z.object` STRIPS unknown keys, the fields the server sent were being dropped
 * here at runtime as well as missing from the type. The stripped ones included
 * the adoption count — the number that changes what the customer ends up with,
 * and the one thing they have to see before pressing start.
 *
 * Keeping the type from shared means a field added there is available to the UI
 * immediately; the schema below still has to list it to survive parsing, and
 * that is the check this comment exists to make someone remember.
 */
export const DiscoveryCollectionSchema = z.object({
  name: z.string(),
  items: z.number(),
  bytes: z.number().optional(),
  generatedIdItems: z.number().optional(),
  /** Why this collection will NOT be migrated, when it will not be. */
  excluded: z.string().optional(),
});
export const DiscoveryRecordSchema = z.object({
  domain: z.enum(['email', 'calendar', 'contact', 'file']),
  collections: z.number(),
  items: z.number(),
  bytes: z.number().optional(),
  /** Items the source holds but cannot migrate; NOT part of `items`. */
  generatedIdItems: z.number().optional(),
  /** What the destination already holds, and how much of it we will adopt. */
  targetExisting: z.number().optional(),
  targetColliding: z.number().optional(),
  perCollection: z.array(DiscoveryCollectionSchema).optional(),
  discoveredAt: z.string(),
  lastError: z.string().optional(),
});
export const DiscoveryResponseSchema = z.object({
  mappingId: z.string(),
  discovered: z.boolean(),
  domains: z.array(DiscoveryRecordSchema),
});
export type { DiscoveryRecord };
export type DiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>;

export const ScopeManifestEntrySchema = z.object({ item: z.string(), detail: z.string() });
export const ScopeManifestSchema = z.object({
  version: z.string(),
  migrates: z.array(ScopeManifestEntrySchema),
  partial: z.array(ScopeManifestEntrySchema),
  doesNotMigrate: z.array(ScopeManifestEntrySchema),
});
export type ScopeManifest = z.infer<typeof ScopeManifestSchema>;

export const scopeManifestApi = {
  get: async (): Promise<ScopeManifest> => {
    const response = await apiClient.get('/scope-manifest');
    return ScopeManifestSchema.parse(response.data);
  },
};

export const mappingApi = {
  list: async () => {
    const response = await apiClient.get('/migrations');
    return z.array(MappingListItemSchema).parse(response.data.mappings);
  },

  /** Enqueue read-only discovery for a mapping (0013). */
  discover: async (mappingId: string, domains?: Array<DiscoveryRecord['domain']>) => {
    const response = await apiClient.post(
      `/migrations/${mappingId}/discover`,
      domains ? { domains } : {},
    );
    return response.data;
  },

  /** Poll the stored per-domain discovery counts (0013). */
  getDiscovery: async (mappingId: string): Promise<DiscoveryResponse> => {
    const response = await apiClient.get(`/migrations/${mappingId}/discovery`);
    return DiscoveryResponseSchema.parse(response.data);
  },

  /** The green light: activate a paused (draft) mapping (0013). */
  start: async (mappingId: string) => {
    const response = await apiClient.post(`/migrations/${mappingId}/start`, {});
    return response.data;
  },

  create: async (data: CreateMappingInput) => {
    const response = await apiClient.post('/migrations', data);
    return CreateMappingResponseSchema.parse(response.data);
  },

  get: async (mappingId: string) => {
    const response = await apiClient.get(`/migrations/${mappingId}`);
    return MappingSchema.parse(response.data);
  },

  // `update` is gone (0033 T1): nothing called it, and its parse could never
  // succeed — PUT answers `{id, ...body, updatedAt}`, which has none of the
  // fields the detail schema requires. The 0026 T2 dead-surface precedent
  // applies; when a screen needs to PUT a status, add it back with a schema
  // that mirrors the real response.

  delete: async (mappingId: string) => {
    await apiClient.delete(`/migrations/${mappingId}`);
  },

  triggerSync: async (mappingId: string, type: 'full' | 'delta', forceFullScan = false) => {
    const response = await apiClient.post(`/migrations/${mappingId}/sync`, {
      type,
      forceFullScan,
    });
    return response.data;
  },

  /**
   * Enqueue cutover PREPARATION: final delta sync + the verification gate. On a
   * PASS the mapping becomes READY_FOR_CUTOVER and waits for operator approval —
   * this does not execute the cutover, so there is no grace-period option.
   */
  triggerCutover: async (mappingId: string, options: {
    skipFinalSync?: boolean;
    skipVerification?: boolean;
  }) => {
    const response = await apiClient.post(`/migrations/${mappingId}/cutover`, options);
    return response.data;
  },

};
