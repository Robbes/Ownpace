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
  DecisionAccepted,
  DecisionRefused,
  DeletionsResponse,
  FailuresResponse,
  MovesResponse,
} from '@openmig/shared';
import { operatingBaseUrl } from './edition';

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

export async function fetchDeletions(): Promise<DeletionsResponse> {
  return (await client.get<DeletionsResponse>('/deletions')).data;
}

export async function fetchMoves(): Promise<MovesResponse> {
  return (await client.get<MovesResponse>('/moves')).data;
}

export async function fetchFailures(): Promise<FailuresResponse> {
  return (await client.get<FailuresResponse>('/failures')).data;
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

const enc = encodeURIComponent;

/** Keep the target's copy of a vanished item, and stop reporting it. */
export function keepDeletion(mappingId: string, hash: string): Promise<DecisionAccepted> {
  return decide(`/mappings/${enc(mappingId)}/deletions/${enc(hash)}/keep`);
}

/**
 * Follow a source deletion through and remove the target's copy.
 *
 * THE ONLY DESTRUCTIVE CALL IN THIS CLIENT. Every gate is on the server
 * (ADR-0024) and this cannot weaken any of them — `mayOfferApply` decides what
 * the UI SHOWS, `applyDeletion` decides what actually happens.
 */
export function applyDeletion(mappingId: string, hash: string): Promise<DecisionAccepted> {
  return decide(`/mappings/${enc(mappingId)}/deletions/${enc(hash)}/apply`);
}

/** Accept the target's layout for a moved item, and stop reporting it. */
export function keepMove(mappingId: string, hash: string): Promise<DecisionAccepted> {
  return decide(`/mappings/${enc(mappingId)}/moves/${enc(hash)}/keep`);
}

/** Try a failed item again on the next pass (also clears the mapping's cursors). */
export function retryFailure(mappingId: string, hash: string): Promise<DecisionAccepted> {
  return decide(`/mappings/${enc(mappingId)}/failures/${enc(hash)}/retry`);
}

/** Migrate without a failed item, permanently. */
export function acceptFailure(mappingId: string, hash: string): Promise<DecisionAccepted> {
  return decide(`/mappings/${enc(mappingId)}/failures/${enc(hash)}/accept`);
}
