// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Gifts (workplan 0172): the giver's, the door's and the operator's calls to
 * `apps/api/src/routes/gifts.ts`. Making a gift sends the card's language and
 * nothing else: the card's names and message never leave the browser.
 */

import apiClient from './api.ts';

export type GiftState = 'unused' | 'redeemed' | 'revoked' | 'expired';

export interface GiftSummary {
  readonly id: string;
  readonly locale: 'en' | 'nl';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly redeemedAt: string | null;
  readonly revokedAt: string | null;
  readonly state: GiftState;
}

export interface MyGifts {
  readonly gifts: GiftSummary[];
  readonly limit: number;
  readonly held: number;
  /** Where the code is typed, when the deployment knows its own address. */
  readonly redeemAt: string | null;
}

export interface MadeGift {
  readonly id: string;
  /** Shown once: nothing can show it again. */
  readonly code: string;
  readonly expiresAt: string;
  readonly redeemAt: string | null;
}

export async function listMyGifts(): Promise<MyGifts> {
  return (await apiClient.get<MyGifts>('/gifts/mine')).data;
}

export async function makeGift(locale: 'en' | 'nl'): Promise<MadeGift> {
  return (await apiClient.post<MadeGift>('/gifts', { locale })).data;
}

export async function revokeMyGift(id: string): Promise<void> {
  await apiClient.post(`/gifts/${id}/revoke`);
}

// ------------------------------------------------------------ the operator --

export interface OperatorGift extends GiftSummary {
  readonly giverEmail: string | null;
  readonly organisation: string | null;
  readonly request: { readonly id: string; readonly state: string | null; readonly email: string | null } | null;
}

export interface GiftAllowance {
  readonly userId: string;
  readonly email: string | null;
  readonly gifts: number;
  readonly setAt: string;
  readonly note: string | null;
}

export interface OperatorGifts {
  readonly gifts: OperatorGift[];
  readonly giftsPerPerson: number;
  readonly allowances: GiftAllowance[];
  readonly alpha: {
    readonly granted: number;
    readonly open: number;
    readonly openFromGifts: number;
    readonly unusedGifts: number;
  };
}

export async function listAllGifts(): Promise<OperatorGifts> {
  return (await apiClient.get<OperatorGifts>('/gifts/operator')).data;
}

export async function revokeAnyGift(id: string): Promise<void> {
  await apiClient.post(`/gifts/operator/${id}/revoke`);
}

export async function setGiftsPerPerson(giftsPerPerson: number): Promise<void> {
  await apiClient.put('/gifts/operator/rule', { giftsPerPerson });
}

export async function setGiftAllowance(email: string, gifts: number | null, note?: string): Promise<void> {
  await apiClient.put('/gifts/operator/allowance', { email, gifts, ...(note ? { note } : {}) });
}
