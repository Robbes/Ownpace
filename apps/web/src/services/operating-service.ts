// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Client for the operating surface (ADR-0026): the three decision queues and
 * the decisions an owner can make about them.
 *
 * Every shape here comes from `@openmig/shared` — this file adds no type of its
 * own on purpose. The contract is the server's, and a client that redeclared it
 * would be free to drift from the thing it is talking to.
 */

import axios, { type AxiosInstance } from 'axios';
import type {
  RunsResponse,
  ApplyDeletionsFlag,
  ApplyQueuedResponse,
  ApplyReceipt,
  VerificationRunReport,
  VerifyStartResponse,
  DecisionAccepted,
  DecisionRefused,
  DeletionsResponse,
  FailuresResponse,
  FinishAccepted,
  FinishRefused,
  MovesResponse,
  DiscoveryRecord,
  ScopeManifest,
  StatusReport,
  DecisionRow,
} from '@openmig/shared';
import { isSelfHost, mappingPath, operatingBaseUrl, queuePath, verifyPath } from './edition';
import { onUnauthorized } from './api';

const client: AxiosInstance = axios.create({
  baseURL: operatingBaseUrl(),
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// The appliance has no login (see `edition.ts`); the managed edition will need
// this header once it implements the contract, and sending it when there is no
// token costs nothing.
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token && config.headers) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Session expiry, same behaviour as services/api.ts (release-readiness,
// 2026-08-10): without this, an expired token redirected Dashboard/Mappings
// to login while every operating screen sat on a raw 401 error — half the
// app logged out, half stranded. The appliance never answers 401, so this
// only ever fires on the managed edition.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!isSelfHost() && error.response?.status === 401) {
      onUnauthorized();
    }
    return Promise.reject(error);
  },
);

// `mappingId` is required by the managed edition and ignored by the appliance —
// see `queuePath()` for why the two differ, and why the difference stops there.
export async function fetchDeletions(mappingId?: string): Promise<DeletionsResponse> {
  return (await client.get<DeletionsResponse>(queuePath('deletions', mappingId))).data;
}

export async function fetchMoves(mappingId?: string): Promise<MovesResponse> {
  return (await client.get<MovesResponse>(queuePath('moves', mappingId))).data;
}

export async function fetchFailures(mappingId?: string): Promise<FailuresResponse> {
  return (await client.get<FailuresResponse>(queuePath('failures', mappingId))).data;
}

/**
 * Run history for one mapping (0026 T3 row 23) — newest first, events inline.
 * Per-mapping in BOTH editions, so `mappingPath` composes the whole URL and
 * no new path logic exists to drift.
 */
export async function fetchRuns(mappingId: string): Promise<RunsResponse> {
  return (await client.get<RunsResponse>(`${mappingPath(mappingId)}/runs`)).data;
}

// The §11.1 drift decision queue (workplan 0028 T1). TENANT-level, unlike the
// three item queues — a new mailbox belongs to no mapping yet — so both
// editions serve the same path under their base and no mappingId enters it.
export async function fetchDriftDecisions(): Promise<{ decisions: ReadonlyArray<DecisionRow> }> {
  return (await client.get<{ decisions: ReadonlyArray<DecisionRow> }>('/decisions')).data;
}

/** One shared address as discovery found it (workplan 0027 T1/T4). */
export interface SharedAddressRow {
  readonly id: string;
  readonly address: string;
  readonly displayName?: string;
  /** Absent means the source did not say — the S-or-D question is open. */
  readonly pattern?: 'shared_s' | 'distribution_d';
  readonly members: readonly string[];
  /** False when the member list could not be read; `members` is then empty. */
  readonly membersKnown: boolean;
  readonly status: 'pending' | 'created' | 'error';
}

/**
 * What shared-address discovery found (workplan 0027 T4).
 *
 * TENANT-level like the decision queue, and for the same reason: info@ is the
 * organisation's address, not any one mapping's. An empty list is NOT proof
 * the organisation has none — see the screen's empty state.
 */
export async function fetchSharedAddresses(): Promise<{
  addresses: ReadonlyArray<SharedAddressRow>;
}> {
  return (await client.get<{ addresses: ReadonlyArray<SharedAddressRow> }>('/shared-addresses'))
    .data;
}

/**
 * The Pattern D runbook, as Markdown (workplan 0027 T2).
 *
 * Fetched through the client rather than linked with an `<a href>`: the
 * managed edition needs the bearer token, and a link that 401s would look
 * like an empty runbook. Returned as text so the caller can hand it to the
 * browser as a file.
 */

/**
 * Re-throw a text-request failure with its JSON body PARSED (0038 T7).
 *
 * The two markdown fetches use `responseType: 'text'`, which makes axios
 * hand error bodies over as unparsed strings — so the carefully-written
 * server refusals ("This migration does not record which mailbox it
 * reads…") arrived as a string nobody probed, and the components' `.message`
 * / `.reason` reads got undefined. In production those sentences could NEVER
 * render; the unit tests passed only because they mocked an already-parsed
 * object. Parse here, fall through to the raw string when it is not JSON.
 */
function rethrowWithParsedBody(err: unknown): never {
  if (axios.isAxiosError(err) && typeof err.response?.data === 'string') {
    try {
      err.response.data = JSON.parse(err.response.data);
    } catch {
      // Not JSON — keep the string; downstream fallbacks handle it.
    }
  }
  throw err;
}

export async function fetchGroupRunbook(): Promise<string> {
  try {
    return (await client.get<string>('/shared-addresses/runbook', { responseType: 'text' })).data;
  } catch (err) {
    rethrowWithParsedBody(err);
  }
}

/**
 * The §14.2 permission inventory for a migration's mailbox (workplan 0029).
 *
 * By mappingId rather than by address: the screen knows which migration the
 * operator is looking at, not which mailbox is behind it, and asking somebody
 * to retype their own address is a way to get it wrong. The server resolves
 * it, and says which fact is missing when it cannot.
 */
export async function fetchPermissionReport(mappingId: string): Promise<string> {
  try {
    return (
      await client.get<string>(
        `/permissions/report?mappingId=${encodeURIComponent(mappingId)}`,
        { responseType: 'text' },
      )
    ).data;
  } catch (err) {
    rethrowWithParsedBody(err);
  }
}

/**
 * The tenant's standing answers, and what an absent category means (0028 T5).
 *
 * `defaultAction` is returned by the server rather than assumed here: a
 * client that inferred "absent = auto" would show a tenant as auto-answering
 * things it actually asks about, which is the wrong way round to be wrong.
 */
export async function fetchDecisionPresets(): Promise<{
  presets: ReadonlyArray<{ category: string; action: 'auto' | 'ask' }>;
  defaultAction: 'auto' | 'ask';
}> {
  return (
    await client.get<{
      presets: ReadonlyArray<{ category: string; action: 'auto' | 'ask' }>;
      defaultAction: 'auto' | 'ask';
    }>('/decisions/presets')
  ).data;
}

export async function setDecisionPreset(
  category: string,
  action: 'auto' | 'ask',
): Promise<{ category: string; action: 'auto' | 'ask' }> {
  return (
    await client.put<{ category: string; action: 'auto' | 'ask' }>(
      `/decisions/presets/${encodeURIComponent(category)}`,
      { action },
    )
  ).data;
}

export async function resolveDriftDecision(
  decisionId: string,
  resolution: Record<string, unknown>,
): Promise<DecisionRow & { effect?: string }> {
  return (
    await client.post<DecisionRow & { effect?: string }>(
      `/decisions/${encodeURIComponent(decisionId)}/resolve`,
      { resolution },
    )
  ).data;
}

export async function dismissDriftDecision(
  decisionId: string,
): Promise<DecisionRow & { effect?: string }> {
  return (
    await client.post<DecisionRow & { effect?: string }>(
      `/decisions/${encodeURIComponent(decisionId)}/dismiss`,
      {},
    )
  ).data;
}

/**
 * A refusal the server explained, as distinct from a transport failure.
 *
 * The server's 403s and 404s on these routes are not errors in the usual
 * sense — they are the gates doing their job, and each carries text written to
 * be read by the person who just clicked. Losing that to a generic "request
 * failed" would strip exactly the explanation that tells an operator why the
 * product declined to delete their data.
 */
export class DecisionRefusedError extends Error {
  constructor(
    readonly refusal: DecisionRefused,
    readonly httpStatus: number,
  ) {
    super(refusal.reason ?? refusal.hint ?? refusal.error);
    this.name = 'DecisionRefusedError';
  }
}

async function decide(path: string): Promise<DecisionAccepted> {
  try {
    return (await client.post<DecisionAccepted>(path)).data;
  } catch (err) {
    const res = (err as { response?: { status: number; data?: DecisionRefused } }).response;
    // Only a body that actually carries the server's refusal shape is treated as
    // one. A 502 from a proxy has a status too, and reporting its HTML as the
    // reason we would not delete something would be worse than saying nothing
    // (hard rule 9: never dress a failure up as an answer).
    if (res?.data?.error) throw new DecisionRefusedError(res.data, res.status);
    throw err;
  }
}

/** Keep the target's copy of a vanished item, and stop reporting it. */
export function keepDeletion(mappingId: string, hash: string): Promise<DecisionAccepted> {
  return decide(`${mappingPath(mappingId)}/deletions/${encodeURIComponent(hash)}/keep`);
}

/**
 * What one `apply` request came back as — the ONE success-shape difference
 * ADR-0026 permits the client to contain (workplan 0019 T1).
 *
 * The appliance answers synchronously: the removal has happened (or been
 * refused) by the time the response arrives. The managed edition answers
 * **202 `ApplyQueuedResponse`**: the ledger-side gates were all passed on this
 * request, and the outcome arrives later on the RECEIPT, because the target's
 * half (can it remove; has the owner edited our copy) belongs to the worker.
 * Before this type existed the client parsed the managed reply as the
 * appliance's shape — a mis-parse on the one route that destroys data.
 */
export type ApplyOutcome =
  | { readonly mode: 'immediate'; readonly result: DecisionAccepted }
  | { readonly mode: 'queued'; readonly receipt: ApplyReceipt };

/**
 * Follow a source deletion through and remove the target's copy.
 *
 * THE ONLY DESTRUCTIVE CALL IN THIS CLIENT. Every gate is on the server
 * (ADR-0024) and this cannot weaken any of them — `mayOfferApply` decides what
 * the UI SHOWS, `applyDeletion` decides what actually happens.
 *
 * Refusals arrive the same way in both editions (403/404 with the shared code
 * + reason shape → `DecisionRefusedError`); only the SUCCESS shape differs,
 * per `ApplyOutcome`.
 */
export async function applyDeletion(mappingId: string, hash: string): Promise<ApplyOutcome> {
  const path = `${mappingPath(mappingId)}/deletions/${encodeURIComponent(hash)}/apply`;
  if (isSelfHost()) {
    return { mode: 'immediate', result: await decide(path) };
  }
  try {
    const { data } = await client.post<ApplyQueuedResponse>(path);
    return { mode: 'queued', receipt: data.receipt };
  } catch (err) {
    const res = (err as { response?: { status: number; data?: DecisionRefused } }).response;
    if (res?.data?.error) throw new DecisionRefusedError(res.data, res.status);
    throw err;
  }
}

/**
 * The receipt an apply's job lands its outcome on (managed only).
 *
 * A status read — safe to poll, starts nothing. Terminal states are
 * `applied`, `refused` and `failed`; `queued` means keep polling.
 */
export async function fetchApplyReceipt(mappingId: string, hash: string): Promise<ApplyReceipt> {
  return (
    await client.get<ApplyReceipt>(
      `${mappingPath(mappingId)}/deletions/${encodeURIComponent(hash)}/receipt`,
    )
  ).data;
}

/** Gate 1 of the destructive path, as a readable fact — both editions (0019 T3). */
export async function fetchApplyDeletionsFlag(mappingId: string): Promise<ApplyDeletionsFlag> {
  return (await client.get<ApplyDeletionsFlag>(`${mappingPath(mappingId)}/apply-deletions`)).data;
}

/**
 * Flip gate 1 (managed only; owner role — the server enforces both).
 *
 * The appliance answers 405 here on purpose: its flag is config-file-owned,
 * and the panel never offers this call there (`source: 'config'`).
 */
export async function setApplyDeletionsFlag(
  mappingId: string,
  flags: { allowApplyDeletions?: boolean; autoApplyRelocations?: boolean },
): Promise<ApplyDeletionsFlag> {
  try {
    return (
      await client.patch<ApplyDeletionsFlag>(`${mappingPath(mappingId)}/apply-deletions`, flags)
    ).data;
  } catch (err) {
    const res = (err as { response?: { status: number; data?: DecisionRefused } }).response;
    // requireRole's 403 and the appliance's 405 both carry words meant for the
    // person who clicked — keep them, same as every other refusal.
    if (res?.data?.error) throw new DecisionRefusedError(res.data, res.status);
    throw err;
  }
}

/** Accept the target's layout for a moved item, and stop reporting it. */
export function keepMove(mappingId: string, hash: string): Promise<DecisionAccepted> {
  return decide(`${mappingPath(mappingId)}/moves/${encodeURIComponent(hash)}/keep`);
}

/**
 * Remove the target's OLD copy of a RELOCATED item (ADR-0030).
 *
 * The second destructive call in this client, and the same rules apply: every
 * gate is on the server, and `mayOfferRelocationApply` decides only what the UI
 * SHOWS. What makes this one admissible is checked server-side at the moment of
 * removal — the same bytes must be on the target under the key the source moved
 * the item to, and the managed worker asks the TARGET itself before acting.
 *
 * Same success-shape split as `applyDeletion`, same reason: the appliance
 * answers synchronously; the managed edition answers 202 with a receipt,
 * because the target's half belongs to the worker (`run-apply-relocation`).
 */
export async function applyMove(mappingId: string, hash: string): Promise<ApplyOutcome> {
  const path = `${mappingPath(mappingId)}/moves/${encodeURIComponent(hash)}/apply`;
  if (isSelfHost()) {
    return { mode: 'immediate', result: await decide(path) };
  }
  try {
    const { data } = await client.post<ApplyQueuedResponse>(path);
    return { mode: 'queued', receipt: data.receipt };
  } catch (err) {
    const res = (err as { response?: { status: number; data?: DecisionRefused } }).response;
    if (res?.data?.error) throw new DecisionRefusedError(res.data, res.status);
    throw err;
  }
}

/**
 * The receipt a relocation apply's job lands its outcome on (managed only).
 *
 * Deliberately a separate path from the deletion receipt: one item can be in
 * BOTH destructive queues at once, and each poller must be answered about the
 * question it asked (migration 0010's `action` discriminator).
 */
export async function fetchMoveApplyReceipt(
  mappingId: string,
  hash: string,
): Promise<ApplyReceipt> {
  return (
    await client.get<ApplyReceipt>(
      `${mappingPath(mappingId)}/moves/${encodeURIComponent(hash)}/receipt`,
    )
  ).data;
}

/** Try a failed item again on the next pass (also clears the mapping's cursors). */
export function retryFailure(mappingId: string, hash: string): Promise<DecisionAccepted> {
  return decide(`${mappingPath(mappingId)}/failures/${encodeURIComponent(hash)}/retry`);
}

/** Migrate without a failed item, permanently. */
export function acceptFailure(mappingId: string, hash: string): Promise<DecisionAccepted> {
  return decide(`${mappingPath(mappingId)}/failures/${encodeURIComponent(hash)}/accept`);
}

export async function fetchStatus(): Promise<StatusReport> {
  return (await client.get<StatusReport>('/status')).data;
}

/**
 * The appliance's discovery counts, for every configured mapping.
 *
 * Appliance-only, like `/status`: the managed edition answers per mapping
 * (`/api/migrations/{id}/discovery`) through `mapping-service.ts`, because a
 * tenant's confirm step is about the ONE mapping they just created rather than
 * everything they have.
 */
export async function fetchAllDiscovery(): Promise<Readonly<Record<string, DiscoveryRecord[]>>> {
  return (await client.get<Record<string, DiscoveryRecord[]>>('/discovery')).data;
}

export async function fetchScopeManifest(): Promise<ScopeManifest> {
  return (await client.get<ScopeManifest>('/scope-manifest')).data;
}

/**
 * The green light: activate a paused (draft) mapping so it starts syncing.
 *
 * Idempotent for one already active; refused once a migration has moved on to
 * cutover or done.
 */
export async function startMigration(mappingId: string): Promise<unknown> {
  return (await client.post(`${mappingPath(mappingId)}/start`)).data;
}

/**
 * Run one pass now and answer when it finishes.
 *
 * Single-flight per mapping on the server, so this can never start a second
 * concurrent pass — but with a sharp edge worth knowing: the pass you get back
 * may have STARTED BEFORE you asked. A caller that needs "a pass that saw my
 * change" has to re-check and ask again rather than trusting one call.
 */
export async function runPass(mappingId: string): Promise<unknown> {
  return (await client.post(`${mappingPath(mappingId)}/run`, undefined, {
    timeout: 15 * 60 * 1000,
  })).data;
}

/**
 * Run the §20 verification gate.
 *
 * **Starting is expensive and does real work**: the scan counts and samples
 * the TARGET for every enabled domain. That is why it is a POST behind a
 * button the operator presses — and why POLLING is safe: `fetchVerifyReport`
 * reads the run's state and never triggers anything (workplan 0017 T0).
 *
 * The pair replaced a synchronous GET that held one HTTP request open for the
 * whole scan, behind a 15-minute axios timeout. That worked exactly as long as
 * nothing between the browser and the appliance cut a quarter-hour request —
 * and could never work on managed, where target I/O belongs to the worker.
 *
 * `mappingId` is required by the managed edition and ignored by the appliance —
 * see `verifyPath()`, the same split the queues have.
 */
export async function startVerification(mappingId?: string): Promise<VerifyStartResponse> {
  return (await client.post<VerifyStartResponse>(verifyPath('start', mappingId))).data;
}

/** The current run's state. A status read — safe to poll, starts nothing. */
export async function fetchVerifyReport(mappingId?: string): Promise<VerificationRunReport> {
  return (await client.get<VerificationRunReport>(verifyPath('report', mappingId))).data;
}

/**
 * Ask for one more sync pass, in each edition's own temporal shape (0019 T5).
 *
 * The appliance runs the pass and answers when it FINISHES (single-flight —
 * see `runPass`, including its started-before-you-asked sharp edge). The
 * managed edition enqueues a delta-sync job and answers at once; the pass
 * itself lands in the run history, executed by the same task the sync tick
 * triggers. The Finish screen says which of the two happened rather than
 * letting "done" mean two different things.
 */
export async function requestFinalPass(mappingId: string): Promise<'finished' | 'queued'> {
  if (isSelfHost()) {
    await runPass(mappingId);
    return 'finished';
  }
  await client.post(`${mappingPath(mappingId)}/sync`, { type: 'delta' });
  return 'queued';
}

/** A refusal to finish, kept distinct from a transport failure — see `DecisionRefusedError`. */
export class FinishRefusedError extends Error {
  constructor(
    readonly refusal: FinishRefused,
    readonly httpStatus: number,
  ) {
    super(refusal.error);
    this.name = 'FinishRefusedError';
  }
}

/**
 * End a migration: stop syncing, stop reporting.
 *
 * Nothing changes on either side — this is a statement about what the tool does
 * next. `force` proceeds over items still awaiting a decision in the failure
 * queue, and exists so that choice is explicit and on the record rather than
 * something the operator discovers afterwards.
 */
export async function finishMigration(
  mappingId: string,
  force = false,
): Promise<FinishAccepted> {
  const path = `${mappingPath(mappingId)}/finish${force ? '?force=true' : ''}`;
  try {
    return (await client.post<FinishAccepted>(path)).data;
  } catch (err) {
    const res = (err as { response?: { status: number; data?: FinishRefused } }).response;
    if (res?.data?.error) throw new FinishRefusedError(res.data, res.status);
    throw err;
  }
}
