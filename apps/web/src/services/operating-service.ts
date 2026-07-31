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
} from '@openmig/shared';
import { mappingPath, operatingBaseUrl, queuePath } from './edition';

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
 * Follow a source deletion through and remove the target's copy.
 *
 * THE ONLY DESTRUCTIVE CALL IN THIS CLIENT. Every gate is on the server
 * (ADR-0024) and this cannot weaken any of them — `mayOfferApply` decides what
 * the UI SHOWS, `applyDeletion` decides what actually happens.
 */
export function applyDeletion(mappingId: string, hash: string): Promise<DecisionAccepted> {
  return decide(`${mappingPath(mappingId)}/deletions/${encodeURIComponent(hash)}/apply`);
}

/** Accept the target's layout for a moved item, and stop reporting it. */
export function keepMove(mappingId: string, hash: string): Promise<DecisionAccepted> {
  return decide(`${mappingPath(mappingId)}/moves/${encodeURIComponent(hash)}/keep`);
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
 */
export async function startVerification(): Promise<VerifyStartResponse> {
  return (await client.post<VerifyStartResponse>('/verify/start')).data;
}

/** The current run's state. A status read — safe to poll, starts nothing. */
export async function fetchVerifyReport(): Promise<VerificationRunReport> {
  return (await client.get<VerificationRunReport>('/verify/report')).data;
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
