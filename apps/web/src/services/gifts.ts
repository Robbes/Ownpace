// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Recommendations (workplans 0172 and 0177): the giver's, the door's and the
 * operator's calls to `apps/api/src/routes/gifts.ts`. In code a
 * recommendation is still a gift. Making one sends the card's language and
 * nothing else: the card's names and message never leave the browser.
 *
 * The door's two calls are 0177 §19's contracts. The check reads a code and
 * spends nothing; the redeem lets the person in. Every bad code gets one
 * refusal, said by the server in both languages (`linkRefusal`), and two
 * answers are not a refusal of the code: the Alpha is full, and the address
 * already has access. Each keeps the code, and each is read here by the one
 * field that names it, `error`.
 */

import axios from 'axios';
import apiClient from './api.ts';
import { linkRefusal } from './link-refusal.ts';
import type { Locale, StringKey } from '../i18n/strings.ts';

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
  /**
   * Whether the Alpha has a place for a new card (0177 §20.3, rule 1). Absent
   * from a server older than step A, which had no ceiling: then it has.
   */
  readonly room?: boolean;
  /**
   * During the Alpha, a member let in by a recommendation has none until the
   * Alpha ends, and their `limit` is nought (0177 D18, §20.7). Absent from a
   * server older than step A: then they have.
   */
  readonly onlyAfterAlpha?: boolean;
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

// ----------------------------------------------------------------- the door --

/** The check's yes (§19): the code's last day, and the address the mail comes from, where one is set. */
export interface CheckedCode {
  readonly ok: true;
  readonly until: string;
  readonly answersFrom?: string;
}

/** Step 1: whether the code can be used. Writes nothing and spends nothing. */
export async function checkCode(code: string): Promise<CheckedCode> {
  return (await apiClient.post<CheckedCode>('/gifts/check', { code })).data;
}

/** What step 3 sends (§5): the code, the address, a name if one was typed, the answer about Google, the language. */
export interface CodeToUse {
  readonly code: string;
  readonly email: string;
  readonly name?: string;
  readonly google: boolean;
  readonly locale: 'en' | 'nl';
  /** The form's trap (0093 T2d), sent only when filled. */
  readonly website?: string;
}

/** The redeem's yes (§19): the person is in, and whether the yes mail went out. */
export interface LetIn {
  readonly letIn: true;
  readonly mailed: boolean;
}

/** Step 3: let the person in, in one transaction, or none of it. */
export async function redeemCode(body: CodeToUse): Promise<LetIn> {
  return (await apiClient.post<LetIn>('/gifts/redeem', body)).data;
}

/** A 409 that keeps the code: the Alpha is full, or the address already has access. */
export interface KeptCode {
  readonly error: 'full' | 'already_in';
  readonly reason: string;
  readonly reasonNl?: string;
  /** The code's last day, on `full`. */
  readonly until?: string;
}

/** The answer that keeps the code, or null for anything else (a refusal, a fault, a limit). */
export function keptCode(err: unknown): KeptCode | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 409) return null;
  const body = err.response.data as Partial<KeptCode> | undefined;
  if (body?.error !== 'full' && body?.error !== 'already_in') return null;
  if (typeof body.reason !== 'string' || body.reason === '') return null;
  return {
    error: body.error,
    reason: body.reason,
    ...(typeof body.reasonNl === 'string' && body.reasonNl !== '' ? { reasonNl: body.reasonNl } : {}),
    ...(typeof body.until === 'string' ? { until: body.until } : {}),
  };
}

/**
 * A refusal from these routes, in the page's language. Their sentences come
 * in pairs, `reason` and `reasonNl` (`reasonPair` in `@openmig/shared`); a
 * 429 and the giver's `only_after_alpha` also carry the English as `message`,
 * which `linkRefusal` would read first and show in English on a Dutch page.
 * So the pair is read first, and the Dutch half shown under `nl` is always
 * the Dutch of the same sentence. Anything else is `linkRefusal`'s, which
 * says no answer and an unreadable one in the page's own words.
 */
export function refusalSaid(err: unknown, locale: Locale, t: (key: StringKey) => string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { reason?: unknown; reasonNl?: unknown } | undefined;
    if (data && typeof data.reason === 'string' && data.reason !== '') {
      return locale === 'nl' && typeof data.reasonNl === 'string' && data.reasonNl !== '' ? data.reasonNl : data.reason;
    }
  }
  return linkRefusal(err, locale, t);
}

/** Whether a failure is a refusal of the code itself (410), which the reader mends in its field. */
export function refusedCode(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 410;
}

/** Why the server would not make a card the page offered, when the page has words of its own for it. */
export type CardRefusal = 'gift_limit' | 'no_room' | 'only_after_alpha';

/**
 * A card refused for a reason the giver's page says itself (0177 §19, as
 * built): the number each person may recommend reached, a full Alpha, and,
 * during it, a member let in by a recommendation (D18). The page loaded with
 * room and the answer changed before the press: a second tab, or the Alpha
 * filling up. The server's sentences for the first two are English only, so
 * the page says all three in its own words and language, as its panel does
 * when it knows before the press.
 */
export function cardRefused(err: unknown): CardRefusal | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 409) return null;
  const code = (err.response.data as { error?: unknown } | undefined)?.error;
  return code === 'gift_limit' || code === 'no_room' || code === 'only_after_alpha' ? code : null;
}

/**
 * A card the server would not withdraw because it is no longer unused, or no
 * longer there (409, 404): used at the door, expired, or withdrawn in another
 * tab while the page stood open. The server says it in English, with the old
 * name; the list, read again, says which in the page's words.
 */
export function withdrawalOutdated(err: unknown): boolean {
  return axios.isAxiosError(err) && (err.response?.status === 404 || err.response?.status === 409);
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
  /** The Alpha's two counts and their ceilings (0177 §20), and the cards not used yet. */
  readonly alpha: {
    readonly byOwner: number;
    readonly ownerCeiling: number;
    readonly byRecommendation: number;
    readonly recommendationCeiling: number;
    readonly unusedGifts: number;
  };
}

export async function listAllGifts(): Promise<OperatorGifts> {
  return (await apiClient.get<OperatorGifts>('/gifts/operator')).data;
}

export async function revokeAnyGift(id: string): Promise<void> {
  await apiClient.post(`/gifts/operator/${id}/revoke`);
}

/** One number of the rule's row: per person, or either ceiling (§19). One at a time, as each has its own field. */
export type RuleNumber = 'giftsPerPerson' | 'ownerCeiling' | 'recommendationCeiling';

export async function setRuleNumber(which: RuleNumber, value: number): Promise<void> {
  await apiClient.put('/gifts/operator/rule', { [which]: value });
}

export async function setGiftAllowance(email: string, gifts: number | null, note?: string): Promise<void> {
  await apiClient.put('/gifts/operator/allowance', { email, gifts, ...(note ? { note } : {}) });
}
