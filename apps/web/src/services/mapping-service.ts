import apiClient from './api';
import { z } from 'zod';
import type { DiscoveryRecord } from '@openmig/shared';

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

export const MappingSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  sourceType: z.enum(['imap', 'oauth2', 'graph']),
  targetType: z.enum(['jmap', 'imap', 'caldav', 'carddav', 'webdav']),
  sourceConfig: z.object({
    host: z.string(),
    port: z.number(),
    username: z.string(),
    password: z.string().optional(),
    useSsl: z.boolean().optional(),
  }),
  targetConfig: z.object({
    host: z.string(),
    port: z.number(),
    username: z.string(),
    password: z.string(),
    useSsl: z.boolean().optional(),
  }),
  syncConfig: z.object({
    domains: z.array(z.enum(['email', 'calendar', 'contact', 'file'])),
    schedule: z.string().optional(),
  }),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'error']),
  lastSyncAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export const RunSchema = z.object({
  id: z.string(),
  mappingId: z.string(),
  type: z.enum(['full', 'delta']),
  status: z.enum(['pending', 'running', 'success', 'failed', 'cancelled']),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  itemsProcessed: z.number().optional(),
  errors: z.number().optional(),
  createdAt: z.string(),
});

export type Tenant = z.infer<typeof TenantSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type Mapping = z.infer<typeof MappingSchema>;
export type Run = z.infer<typeof RunSchema>;

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
    return z.array(MappingSchema).parse(response.data.mappings);
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

  create: async (data: Partial<Mapping>) => {
    const response = await apiClient.post('/migrations', data);
    return MappingSchema.parse(response.data);
  },

  get: async (mappingId: string) => {
    const response = await apiClient.get(`/migrations/${mappingId}`);
    return MappingSchema.parse(response.data);
  },

  update: async (mappingId: string, data: Partial<Mapping>) => {
    const response = await apiClient.put(`/migrations/${mappingId}`, data);
    return MappingSchema.parse(response.data);
  },

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

  listRuns: async (mappingId: string) => {
    const response = await apiClient.get(`/migrations/${mappingId}/runs`);
    return z.array(RunSchema).parse(response.data.runs);
  },

  getRun: async (mappingId: string, runId: string) => {
    const response = await apiClient.get(`/migrations/${mappingId}/runs/${runId}`);
    return response.data;
  },
};
