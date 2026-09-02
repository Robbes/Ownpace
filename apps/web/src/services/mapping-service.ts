// Copyright 2026 The Ownpace authors (Apache-2.0)
import apiClient from './api.ts';
import { z } from 'zod';
import type { ProbeOutcome } from '@openmig/shared';
import { FAILURE_CATEGORIES, MAPPING_LIFECYCLES } from '@openmig/shared';
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
  /**
   * The failure's category (workplan 0110 T3). Parsed as the closed set the
   * UI has sentences for — an older or newer server sending something else
   * drops the field rather than reaching a screen with nothing to say, and
   * the verbatim `lastError` still renders either way.
   */
  lastErrorCategory: z.enum(FAILURE_CATEGORIES).optional().catch(undefined),
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
    // One Google ACCOUNT, several faces (workplan 0106 T3b).
    'google',
    'dropbox',
    'box',
  ]),
  targetType: z.enum(['jmap', 'imap', 'caldav', 'carddav', 'webdav', 'soverin']),
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
    | 'dropbox'
    | 'box'
    | 'google-contacts'
    | 'google';
  targetType: 'jmap' | 'imap' | 'caldav' | 'carddav' | 'webdav' | 'soverin';
  /** Reuse a stored connection instead of creating one (workplan 0064). When
   *  set, its credentials are used and none need re-sending. */
  sourceConnectionId?: string;
  targetConnectionId?: string;
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
    /** Box only (workplan 0056): the numeric user id the CCG token reads for. */
    userId?: string;
  };
  targetConfig: {
    host: string;
    port: number;
    username: string;
    password: string;
    useSsl?: boolean;
    /** DAV targets (0105 T1): full DAV base URL; wins over host+port when set. */
    url?: string;
    /** soverin only (0106 T4b): the account's mail face — typed, never guessed. */
    mailHost?: string;
    mailPort?: number;
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

/**
 * What one account of each provider kind may serve ON THIS DEPLOYMENT
 * (ADR-0041, owner decision 2026-09-01).
 *
 * ASKED RATHER THAN COMPILED IN. `PROVIDER_ACCOUNT_DOMAINS` is a constant this
 * bundle could import — and did, until the answer stopped being a property of
 * the product. `GOOGLE_ACCOUNT_SCOPE_CLASS` is read by the API at run time and
 * this bundle was built before anybody set it, so a compiled-in answer meant a
 * wizard offering two ticks on a deployment whose consent route would happily
 * ask for four. The alternative — a `VITE_` mirror — is the same fact in two
 * separately settable places, which is how a client comes to offer what the
 * server refuses.
 *
 * The domains are the discovery vocabulary (`email`, not `mail`), and unknown
 * ones are dropped rather than trusted: a value this build has never heard of
 * cannot be rendered as a tick and must not become one.
 *
 * Since 2026-09-01 the same answer carries a second run-time fact for the
 * same reason: whether the deployment holds its own Google OAuth client, so
 * the wizard can stop demanding a pair the server no longer requires.
 */
export const ProviderAccountFactsSchema = z.record(
  z.string(),
  z.object({
    domains: z.array(z.enum(['email', 'calendar', 'contact', 'file'])),
    // Where a Google connection's OAuth client comes from (ADR-0041): the
    // deployment's own, or each connection's. `google` only, and read the
    // same way as the domains — a value this build has never heard of fails
    // the parse, and the wizard falls back to demanding the pair, which is
    // the direction that cannot under-ask.
    client: z.enum(['deployment', 'connection']).optional(),
  }),
);
export type ProviderAccountFacts = z.infer<typeof ProviderAccountFactsSchema>;

export const providerAccountsApi = {
  get: async (): Promise<ProviderAccountFacts> => {
    const response = await apiClient.get('/provider-accounts');
    return ProviderAccountFactsSchema.parse(response.data);
  },
};

/**
 * Which OAuth applications this deployment carries, one fact per provider
 * (2026-09-02: Connect with Dropbox). Asked, not compiled in, for the reason
 * the provider accounts are: the pair is set at run time.
 */
export const ProviderClientFactsSchema = z.object({
  google: z.enum(['deployment', 'connection']),
  dropbox: z.enum(['deployment', 'connection']),
});
export type ProviderClientFacts = z.infer<typeof ProviderClientFactsSchema>;

export const providerClientsApi = {
  get: async (): Promise<ProviderClientFacts> => {
    const response = await apiClient.get('/provider-clients');
    return ProviderClientFactsSchema.parse(response.data);
  },
};

/**
 * Every address this deployment needs registered in somebody else's console
 * (2026-09-01).
 *
 * ASKED, NOT COMPILED IN, for the same reason as the provider accounts above:
 * every string is derived from a runtime value (`API_URL`, `WEB_URL`,
 * `JWT_ISSUER`), and a bundle built before those were set would show a
 * plausible wrong address — which is worse than none, because somebody would
 * register it.
 */
export const RedirectUriEntrySchema = z.object({
  id: z.string(),
  group: z.enum(['migration', 'signIn', 'socialSignIn']),
  provider: z.string(),
  uri: z.string().nullable(),
  why: z.string(),
  unconfigured: z.boolean().optional(),
});
export type RedirectUriEntry = z.infer<typeof RedirectUriEntrySchema>;

export const redirectUriApi = {
  get: async (): Promise<RedirectUriEntry[]> => {
    const response = await apiClient.get('/redirect-uris');
    return z.object({ entries: z.array(RedirectUriEntrySchema) }).parse(response.data).entries;
  },
};

/** One probe's outcome (workplan 0046) — the refusal arrives verbatim. */
export interface TestConnectionResult {
  ok: boolean;
  detail?: string;
  reason?: string;
  /**
   * Whose words `detail`/`reason` are (workplan 0080). Our codes carry their
   * data and get rendered in the reader's language; `providerRefused` means
   * the accompanying sentence is the provider's and renders verbatim. Optional
   * so an older response, or one from a route that has not been taught yet,
   * still shows what it always showed.
   */
  outcome?: ProbeOutcome;
  /**
   * DAV targets only (0105 T0): what this target will DO with the calendar
   * objects a migration writes, measured by one OPTIONS at test time.
   * `capability` is the code a localised screen renders in its own words;
   * `sentence` the server's English for a capability this build has no
   * words for yet.
   */
  scheduling?: { capability: 'auto-schedule' | 'none' | 'unknown'; sentence: string };
  /**
   * The account's per-domain qualification (0106 T0): what the last test
   * MEASURED this account can carry. Three states — yes and no both required
   * an answer; unknown is unmeasured, which a screen must never render as
   * either. `detail` is the English evidence line per domain.
   */
  qualification?: {
    domains: Record<
      'mail' | 'calendar' | 'contact' | 'file',
      {
        answer: 'yes' | 'no' | 'unknown';
        detail: string;
        /** What the face counted when it answered (2026-09-02) — data, so the
         *  line can say "5 calendars" in the reader's language. Absent on an
         *  older record, a no, an unknown. */
        count?: number;
        unit?: 'folder' | 'calendar' | 'addressBook' | 'collection';
        /** How MUCH the face holds, measured when it answered (2026-09-02). */
        volume?: {
          items?: number;
          bytes?: number;
          /** `bytes` extrapolated from a sample — shown as ≈. */
          estimated?: boolean;
          /** Drive: Docs, Sheets and Slides weigh nothing here. */
          nativeFilesExcluded?: boolean;
          /** Why the face answered but could not be measured. */
          failed?: string;
        };
      }
    >;
    scheduling?: { capability: 'auto-schedule' | 'none' | 'unknown'; sentence: string };
  };
}

export const mappingApi = {
  /**
   * Start the authorization-code round-trip against the customer's own
   * Google client (workplan 0089 T1). The answer is Google's consent URL to
   * open in a popup — plus the exact redirect URI the customer must have
   * registered, so a mismatch is shown before Google shows it. Nothing is
   * stored; the refresh token comes back to the wizard window and lands in
   * the same field a pasted one does.
   */
  googleAuthorize: async (
    p:
      | {
          sourceType: 'gmail' | 'google-calendar' | 'google-contacts' | 'google-drive';
          // Both or neither (ADR-0041): absent, the server uses the
          // deployment's own client. Never an empty string — the route's
          // schema refuses one, and rightly.
          clientId?: string;
          clientSecret?: string;
        }
      // The ACCOUNT ask (workplan 0106 T3b): the ticked faces rather than one
      // source type. A union rather than an optional field, so a caller cannot
      // send both and leave the server to pick — the server's schema is a
      // `oneOf` for the same reason.
      | {
          domains: ReadonlyArray<'email' | 'calendar' | 'contact' | 'file'>;
          clientId?: string;
          clientSecret?: string;
        },
  ): Promise<{
    url: string;
    redirectUri: string;
    scope: string;
    /** Echoed for the account ask only, in the same order as `scope`. */
    domains?: ReadonlyArray<string>;
  }> => {
    const response = await apiClient.post('/migrations/google/authorize', p);
    return response.data as { url: string; redirectUri: string; scope: string };
  },

  /**
   * Dropbox's turn at the same round trip (2026-09-02: Connect with Dropbox).
   * One ask and no scopes — the app's own permissions decide what the token
   * can do, and `token_access_type=offline` is pinned server-side so a
   * refresh token comes back. The pair is both or neither (ADR-0041): absent,
   * the server uses the deployment's own Dropbox app. `redirectUri` is the
   * exact string that must be registered under the app's OAuth 2 Redirect
   * URIs before the first consent can work.
   */
  dropboxAuthorize: async (
    p: { clientId?: string; clientSecret?: string } = {},
  ): Promise<{ url: string; redirectUri: string }> => {
    const response = await apiClient.post('/migrations/dropbox/authorize', p);
    return response.data as { url: string; redirectUri: string };
  },

  /**
   * The shared drives a Google credential can see (workplan 0049) — the
   * wizard's "browse" behind rootFolderId. Read-only; nothing stored.
   */
  listSharedDrives: async (creds: {
    // Both or neither (ADR-0041): absent, the server uses the deployment's
    // own client — the same rule as `googleAuthorize`.
    clientId?: string;
    clientSecret?: string;
    refreshToken: string;
  }): Promise<
    { ok: true; drives: Array<{ id: string; name: string }> } | { ok: false; reason: string }
  > => {
    const response = await apiClient.post('/migrations/google-drive/shared-drives', creds);
    return response.data as
      | { ok: true; drives: Array<{ id: string; name: string }> }
      | { ok: false; reason: string };
  },

  /**
   * The folders other accounts shared with the credential (workplan 0051) —
   * the browse's second half; a shared folder migrates by rooting a mapping
   * at its id. Read-only; nothing stored.
   */
  listSharedFolders: async (creds: {
    // Both or neither (ADR-0041): absent, the server uses the deployment's
    // own client — the same rule as `googleAuthorize`.
    clientId?: string;
    clientSecret?: string;
    refreshToken: string;
  }): Promise<
    | { ok: true; folders: Array<{ id: string; name: string; owner?: string }> }
    | { ok: false; reason: string }
  > => {
    const response = await apiClient.post('/migrations/google-drive/shared-folders', creds);
    return response.data as
      | { ok: true; folders: Array<{ id: string; name: string; owner?: string }> }
      | { ok: false; reason: string };
  },

  /**
   * The shared folders a Dropbox credential can see (workplan 0055 follow-up)
   * — the browse behind rootPath. Only a MOUNTED folder carries the path that
   * goes in the field; an unmounted one is shown so the owner knows it
   * exists. Read-only; nothing stored.
   */
  listDropboxSharedFolders: async (creds: {
    // Both or neither (ADR-0041): absent, the server uses the deployment's
    // own Dropbox app — the same rule as `dropboxAuthorize`.
    clientId?: string;
    clientSecret?: string;
    refreshToken: string;
  }): Promise<
    | { ok: true; folders: Array<{ id: string; name: string; path?: string }> }
    | { ok: false; reason: string }
  > => {
    const response = await apiClient.post('/migrations/dropbox/shared-folders', creds);
    return response.data as
      | { ok: true; folders: Array<{ id: string; name: string; path?: string }> }
      | { ok: false; reason: string };
  },

  /**
   * Prove one side's credentials before create (workplan 0046). Read-only on
   * the server; a provider refusal comes back as `{ok:false, reason}` with
   * the provider's words — the same sentence the first pass would have
   * failed with, shown before anything exists.
   */
  testConnection: async (
    payload:
      | { side: 'source'; sourceType: CreateMappingInput['sourceType']; sourceConfig: CreateMappingInput['sourceConfig'] }
      | { side: 'target'; targetType: CreateMappingInput['targetType']; targetConfig: CreateMappingInput['targetConfig'] },
  ): Promise<TestConnectionResult> => {
    const response = await apiClient.post('/migrations/test-connection', payload);
    return response.data as TestConnectionResult;
  },

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

/** One step of a provider setup checklist, with what the owner has said (0061). */
export interface SetupStepStatusDto {
  step: {
    key: string;
    titleKey: string;
    detailKey: string;
    yieldsKey?: string;
    needsAnotherPerson?: boolean;
  };
  state: 'open' | 'done' | 'skipped';
  decidedBy?: string;
  decidedAt?: string;
}

export interface SetupChecklist {
  side: 'source' | 'target';
  provider: string;
  steps: SetupStepStatusDto[];
  progress: {
    total: number;
    done: number;
    skipped: number;
    open: number;
    /** Open steps needing an administrator — why a setup is stuck. */
    blockedOnOthers: number;
    complete: boolean;
  };
}

export const setupApi = {
  /**
   * The platform-side prerequisites for one provider, and how far they have
   * got. Per tenant, so a colleague sees the same progress — the point of
   * persisting it at all.
   */
  get: async (side: 'source' | 'target', provider: string): Promise<SetupChecklist> => {
    const response = await apiClient.get(`/setup/${side}/${encodeURIComponent(provider)}`);
    return response.data as SetupChecklist;
  },
  /** Tick, un-tick or skip one step. Answers the refreshed checklist. */
  setStep: async (
    side: 'source' | 'target',
    provider: string,
    stepKey: string,
    state: 'open' | 'done' | 'skipped',
  ): Promise<SetupChecklist> => {
    const response = await apiClient.put(
      `/setup/${side}/${encodeURIComponent(provider)}/${encodeURIComponent(stepKey)}`,
      { state },
    );
    return response.data as SetupChecklist;
  },
};

/** A stored source or target connection (workplan 0062). Never carries secrets. */
export interface ConnectionSummary {
  id: string;
  role: 'source' | 'target';
  kind: string;
  displayName: string;
  status: 'connected' | 'error' | 'revoked';
  createdAt: string;
  /** How many mailboxes depend on it — whether re-testing this matters. */
  usedByMailboxes: number;
  /**
   * The NON-SECRET values this connection already holds, keyed the way the
   * form keys them (workplan 0078). Built server-side from `connection.config`
   * alone and filtered through the credential descriptor — a secret can never
   * appear here, so a rotation can be prefilled without the encrypted record
   * ever being opened.
   */
  knownValues?: Record<string, string>;
  /**
   * What the LAST test measured this account can carry (0106 T2) — the
   * stored record, so the list shows badges without anybody pressing Test.
   * Null/absent = never qualified (an older row, or a kind qualification
   * does not cover): absence of measurement, never "no".
   */
  qualification?: TestConnectionResult['qualification'] | null;
  /** When the row (and so the qualification) last changed. */
  updatedAt?: string;
}

export const connectionsApi = {
  /**
   * Add a connection without creating a mapping. Which fields to send comes
   * from the shared descriptor (`credentialFieldsFor`), so the form and the
   * server cannot disagree about what a provider needs.
   */
  add: async (payload: {
    role: 'source' | 'target';
    type: string;
    displayName: string;
    values: Record<string, string>;
  }): Promise<TestConnectionResult & { id: string }> => {
    const response = await apiClient.post('/connections', payload);
    return response.data as TestConnectionResult & { id: string };
  },
  /**
   * Replace a connection's credentials in place. Probed first; `rotated:false`
   * means the probe failed and the OLD credentials were kept.
   */
  rotate: async (
    id: string,
    values: Record<string, string>,
  ): Promise<TestConnectionResult & { rotated: boolean }> => {
    const response = await apiClient.put(
      `/connections/${encodeURIComponent(id)}/credentials`,
      { values },
    );
    return response.data as TestConnectionResult & { rotated: boolean };
  },
  /**
   * Delete a connection. The server REFUSES while anything uses it, because
   * mailbox rows cascade and would take the migration ledger with them; the
   * refusal names which migrations, so it is actionable.
   */
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/connections/${encodeURIComponent(id)}`);
  },
  list: async (): Promise<ConnectionSummary[]> => {
    const response = await apiClient.get('/connections');
    return (response.data as { connections: ConnectionSummary[] }).connections;
  },
  /**
   * Probe a stored connection now, through the same builders a pass uses. A
   * provider refusal comes back as `{ok:false, reason}` in its own words.
   */
  test: async (id: string): Promise<TestConnectionResult> => {
    const response = await apiClient.post(`/connections/${encodeURIComponent(id)}/test`);
    return response.data as TestConnectionResult;
  },
};
