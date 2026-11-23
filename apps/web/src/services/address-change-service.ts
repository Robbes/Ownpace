// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Client for the table of address changes (ADR-0055; workplan 0168 T2, T7).
 *
 * Both editions answer `/address-changes` in one shape: managed at
 * `/api/address-changes`, the appliance at its root, with its door (`page`,
 * or `file` when `address-changes.json` holds the rows and every write is
 * refused). `operatingBaseUrl()` carries that difference, as it does for the
 * people. A module of its own, beside `operating-service.ts`, so a page that
 * reads the table is not a change to every test that stands in for that one.
 *
 * Parsed, for the reason the people are: a row whose shape drifted would
 * otherwise render as an address that changes nothing.
 */

import axios, { type AxiosInstance } from 'axios';
import { z } from 'zod';
import { addressTableDigestInput } from '@openmig/shared';
import { isSelfHost, mappingPath, operatingBaseUrl } from './edition.ts';
import { onUnauthorized } from './api.ts';
import { rememberFault } from './recent-errors.ts';

const client: AxiosInstance = axios.create({
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// The base is read per request, not when the module loads: a page that never
// reads the table never asks which edition it is.
client.interceptors.request.use((config) => {
  config.baseURL = operatingBaseUrl();
  const token = localStorage.getItem('auth_token');
  if (token && config.headers) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Session expiry and a fault's reference, as `operating-service.ts` does.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    rememberFault(error);
    if (!isSelfHost() && error.response?.status === 401) onUnauthorized();
    return Promise.reject(error);
  },
);

const AddressChangeSchema = z.object({
  oldAddress: z.string(),
  oldKey: z.string(),
  newAddress: z.string(),
  state: z.enum(['proposed', 'confirmed']),
  setBy: z.string().nullable(),
  setByYou: z.boolean(),
  confirmedBy: z.string().nullable(),
  confirmedByYou: z.boolean(),
  confirmedByThePerson: z.boolean(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  person: z.object({ id: z.string(), displayName: z.string() }).nullable(),
});
export type AddressChange = z.infer<typeof AddressChangeSchema>;

const AddressChangeTableSchema = z.object({
  rows: z.array(AddressChangeSchema),
  door: z.enum(['api', 'page', 'file']),
  file: z.string().nullable(),
});
export type AddressChangeTable = z.infer<typeof AddressChangeTableSchema>;

export interface CreateAddressChange {
  readonly oldAddress: string;
  readonly newAddress: string;
  /** Confirmed by the asker in the same press. */
  readonly confirm?: boolean;
  /** Managed only: the person whose old address it is. */
  readonly personId?: string;
}

export interface UpdateAddressChange {
  readonly newAddress?: string;
  /** `confirmed` confirms as the asker; `proposed` sends it back (*Not right?*). */
  readonly state?: 'proposed' | 'confirmed';
  readonly personId?: string | null;
}

/** The organisation's table: every row, oldest first, and where it is written. */
export async function fetchAddressChanges(): Promise<AddressChangeTable> {
  return AddressChangeTableSchema.parse((await client.get('/address-changes')).data);
}

/** Add a row; the same change again answers the row as it is. Refusals carry their Dutch. */
export async function createAddressChange(input: CreateAddressChange): Promise<AddressChange> {
  return AddressChangeSchema.parse((await client.post('/address-changes', input)).data);
}

/** Change a row, confirm it, or send it back. */
export async function updateAddressChange(oldKey: string, input: UpdateAddressChange): Promise<AddressChange> {
  return AddressChangeSchema.parse((await client.put(`/address-changes/${encodeURIComponent(oldKey)}`, input)).data);
}

/** Delete a row; copies converge back to the source on the next pass. */
export async function deleteAddressChange(oldKey: string): Promise<AddressChange> {
  return AddressChangeSchema.parse((await client.delete(`/address-changes/${encodeURIComponent(oldKey)}`)).data);
}

/**
 * The press digest of the table a page shows (workplan 0168 S5 (d)): the
 * SHA-256, in hex, of its CONFIRMED rows as `addressTableDigestInput` writes
 * them, which is what both editions' servers compare (`addressTablePressDigest`),
 * taken with the browser's own SHA-256.
 */
export async function pressDigestOf(
  rows: ReadonlyArray<Pick<AddressChange, 'oldKey' | 'newAddress' | 'state'>>,
): Promise<string> {
  const confirmed = rows.filter((r) => r.state === 'confirmed');
  const bytes = new TextEncoder().encode(addressTableDigestInput(confirmed));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * *Apply the new addresses here too* (0168 D5): past a data type's cutover, a
 * changed table reaches that migration only on this press. Both editions, on
 * each one's own path (`mappingPath`, as the decisions are: managed
 * `/api/migrations/{id}/…`, the appliance `/mappings/{id}/…`), naming the
 * table the page showed by its press digest: a table that moved since is
 * refused with 409, in the reader's language (S5 (d)).
 */
export async function applyAddressChangesHere(mappingId: string, digest: string): Promise<unknown> {
  return (await client.post(`${mappingPath(mappingId)}/address-changes/apply`, { digest })).data;
}
